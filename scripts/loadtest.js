#!/usr/bin/env node
'use strict';

const autocannon = require('autocannon');

const baseUrl = process.env.BASE_URL;
const bookingId = process.env.BOOKING_ID || '1';
const duration = Number(process.argv[2] || 20);
const connections = Number(process.argv[3] || 10);

if (!baseUrl) {
  console.error('loadtest: set BASE_URL, e.g. BASE_URL=http://<env>.elasticbeanstalk.com node scripts/loadtest.js');
  process.exit(1);
}

const DEMO = {
  requester: { email: 'requester@bridgeability.demo', password: 'tp078281' },
  admin: { email: 'admin@bridgeability.demo', password: 'tp078792' },
};

function mergeCookies(jar, response) {
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [];
  for (const raw of setCookies) {
    const [pair] = raw.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) {
      jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  return jar;
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function extractCsrfFromMeta(html) {
  const match = html.match(/name="csrf-token" content="([^"]+)"/);
  if (!match) {
    throw new Error('loadtest: could not find the csrf-token meta tag -- did the page shape change?');
  }
  return match[1];
}

function extractCsrfFromForm(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  if (!match) {
    throw new Error('loadtest: could not find the login form\'s _csrf field -- did the page shape change?');
  }
  return match[1];
}

async function signIn({ email, password }) {
  const jar = new Map();

  const loginPage = await fetch(new URL('/login', baseUrl));
  mergeCookies(jar, loginPage);
  const loginToken = extractCsrfFromForm(await loginPage.text());

  const loginResponse = await fetch(new URL('/login', baseUrl), {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookieHeader(jar),
    },
    body: new URLSearchParams({ email, password, _csrf: loginToken }),
  });
  mergeCookies(jar, loginResponse);

  if (loginResponse.status !== 302) {
    throw new Error(`loadtest: sign-in as ${email} did not redirect (got ${loginResponse.status}) -- check the password against README.md#demo-accounts`);
  }

  const dashboard = await fetch(new URL('/dashboard', baseUrl), {
    headers: { cookie: cookieHeader(jar) },
  });
  mergeCookies(jar, dashboard);
  const csrfToken = extractCsrfFromMeta(await dashboard.text());

  return { cookie: cookieHeader(jar), csrfToken };
}

async function runTarget(name, opts) {
  console.log(`\n== ${name} ==`);
  const result = await autocannon({ url: baseUrl, connections, duration, ...opts });
  console.log(
    `requests: ${result.requests.total} total, ${result.requests.average.toFixed(1)}/sec avg | `
    + `latency: ${result.latency.average.toFixed(1)}ms avg, ${result.latency.p99}ms p99 | `
    + `errors: ${result.errors}, timeouts: ${result.timeouts}, non-2xx: ${result['4xx'] + result['5xx']}`,
  );
  return result;
}

async function runFetchTarget(name, { path, method = 'GET', headers = {} }) {
  console.log(`\n== ${name} (custom runner -- see file header, autocannon bug) ==`);
  const url = new URL(path, baseUrl);
  const latencies = [];
  const statusCounts = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
  let errors = 0;
  const deadline = Date.now() + duration * 1000;

  async function worker() {
    while (Date.now() < deadline) {
      const startedAt = Date.now();
      try {
        const response = await fetch(url, { method, headers, redirect: 'manual' });
        await response.arrayBuffer();
        latencies.push(Date.now() - startedAt);
        const bucket = `${Math.floor(response.status / 100)}xx`;
        if (statusCounts[bucket] !== undefined) statusCounts[bucket] += 1;
      } catch {
        errors += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: connections }, worker));

  latencies.sort((a, b) => a - b);
  const total = latencies.length;
  const average = total ? latencies.reduce((sum, value) => sum + value, 0) / total : 0;
  const p99 = total ? latencies[Math.min(total - 1, Math.floor(total * 0.99))] : 0;

  console.log(
    `requests: ${total} total, ${(total / duration).toFixed(1)}/sec avg | `
    + `latency: ${average.toFixed(1)}ms avg, ${p99}ms p99 | `
    + `errors: ${errors}, timeouts: 0, non-2xx: ${statusCounts['4xx'] + statusCounts['5xx']}`,
  );
  return { total, average, p99, errors, statusCounts };
}

async function main() {
  console.log(`loadtest: BASE_URL=${baseUrl} BOOKING_ID=${bookingId} duration=${duration}s connections=${connections}`);

  console.log('\nsigning in as requester and admin demo accounts...');
  const requester = await signIn(DEMO.requester);
  const admin = await signIn(DEMO.admin);
  console.log('signed in.');

  const results = {};

  results.catalogue = await runTarget('GET /services (public)', {
    method: 'GET',
    path: '/services',
  });

  results.serviceDetail = await runTarget('GET /services/1 (public)', {
    method: 'GET',
    path: '/services/1',
  });

  results.bookingDetail = await runTarget(`GET /bookings/${bookingId} (authenticated, requester)`, {
    method: 'GET',
    path: `/bookings/${bookingId}`,
    headers: { cookie: requester.cookie },
  });

  results.adminReports = await runTarget('GET /admin/reports (authenticated, admin)', {
    method: 'GET',
    path: '/admin/reports',
    headers: { cookie: admin.cookie },
  });

  results.statusChange = await runFetchTarget(`POST /bookings/${bookingId}/cancel (authenticated, requester -- mutates once, see file header)`, {
    method: 'POST',
    path: `/bookings/${bookingId}/cancel`,
    headers: {
      cookie: requester.cookie,
      'x-csrf-token': requester.csrfToken,
    },
  });

  console.log('\nloadtest: done. Paste the per-target summary lines above into the Section 3');
  console.log('comparison table alongside the matching CloudWatch/X-Ray screenshots.');
}

main().catch((error) => {
  console.error(`loadtest: ${error.message}`);
  process.exit(1);
});
