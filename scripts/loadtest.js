#!/usr/bin/env node
'use strict';

/**
 * Load-tests the four paths Section 3 compares between Task 1 and Task 2
 * (docs/task2-plan.md, B3): the public catalogue, a service detail page, the admin reports
 * page, and one status-changing POST. The same script runs against both environments so the
 * comparison is reproducible rather than eyeballed -- run it, reseed (`npm run migrate`), point
 * BASE_URL at the other environment, run it again.
 *
 * WHY THIS IS NODE, NOT A PLAIN autocannon CLI INVOCATION
 *
 * Two of the four target paths need an authenticated session, and the status-change POST needs
 * a valid CSRF token bound to that session. There is no way to get autocannon's CLI to sign in
 * first and carry the resulting cookie and token into every request it fires, so this drives
 * autocannon's own Node API instead, after doing the sign-in itself with the platform's real
 * flow (see src/middleware/csrf.js and src/middleware/session.js): fetch the login page for a
 * token, POST credentials, then re-fetch a page for the *rotated* token `rotateToken` issues on
 * sign-in, exactly as a real browser session would.
 *
 * WHAT THE STATUS-CHANGE TARGET ACTUALLY MEASURES
 *
 * POST /bookings/1/cancel mutates state at most once per environment: the first successful
 * call transitions booking 1 from pending to cancelled (bookingService.cancel /
 * bookingRepository.cancelPending), guarded by the UPDATE's own WHERE clause. Every call after
 * that -- including every other connection racing it in the same run -- gets a guarded no-op.
 * That race is the point: this measures write latency and lock contention on one row under
 * concurrent conflicting writes, which is exactly the shape of load a booking-accept endpoint
 * sees for real. For a fair before/after comparison, reseed the database before each
 * environment's run so booking 1 starts 'pending' both times.
 *
 * Usage:
 *   BASE_URL=http://<env>.elasticbeanstalk.com node scripts/loadtest.js [duration-seconds] [connections]
 *
 * duration-seconds defaults to 20, connections defaults to 10 per target -- deliberately
 * modest. The point is a repeatable comparison between two environments, not a stress test
 * that could tip a t3.micro instance, the RDS free-tier class, or a Learner Lab account budget
 * into trouble.
 */

const autocannon = require('autocannon');

const baseUrl = process.env.BASE_URL;
const duration = Number(process.argv[2] || 20);
const connections = Number(process.argv[3] || 10);

if (!baseUrl) {
  console.error('loadtest: set BASE_URL, e.g. BASE_URL=http://<env>.elasticbeanstalk.com node scripts/loadtest.js');
  process.exit(1);
}

// Passwords per README.md#demo-accounts: each demo password is the TP number of the role's
// owner.
const DEMO = {
  requester: { email: 'requester@bridgeability.demo', password: 'tp078281' },
  admin: { email: 'admin@bridgeability.demo', password: 'tp078792' },
};

/** Merge a response's Set-Cookie headers into a running `name=value` jar. */
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

/**
 * Signs in as one demo account, following the real double-submit CSRF flow, and returns the
 * cookie header string a subsequent request needs to act as that user.
 */
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

  // The CSRF token rotates on sign-in (rotateToken in src/middleware/csrf.js), so the token
  // from the login page is now stale. Re-fetch any authenticated page for the current one.
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

async function main() {
  console.log(`loadtest: BASE_URL=${baseUrl} duration=${duration}s connections=${connections}`);

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

  results.bookingDetail = await runTarget('GET /bookings/1 (authenticated, requester)', {
    method: 'GET',
    path: '/bookings/1',
    headers: { cookie: requester.cookie },
  });

  results.adminReports = await runTarget('GET /admin/reports (authenticated, admin)', {
    method: 'GET',
    path: '/admin/reports',
    headers: { cookie: admin.cookie },
  });

  results.statusChange = await runTarget('POST /bookings/1/cancel (authenticated, requester -- mutates once, see file header)', {
    method: 'POST',
    path: '/bookings/1/cancel',
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
