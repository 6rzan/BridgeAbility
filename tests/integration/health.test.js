'use strict';

/**
 * Integration suite entry point.
 *
 * Runs against a deployed URL -- there is no local database, no local DynamoDB and no mocked
 * AWS client anywhere in this project, so "integration" means the real Elastic Beanstalk
 * environment, the real RDS instance, the real DynamoDB tables and the real S3 bucket.
 *
 * Usage:
 *   BASE_URL=http://bridgeability-env.<hash>.us-east-1.elasticbeanstalk.com npm run test:integration
 *
 * BASE_URL defaults to nothing on purpose: a missing BASE_URL fails loudly at the top of the
 * suite rather than silently testing localhost, which this project does not run for demos.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const baseUrl = process.env.BASE_URL;

test('BASE_URL is set', () => {
  assert.ok(
    baseUrl,
    'Set BASE_URL to the deployed Elastic Beanstalk URL, e.g. '
      + 'BASE_URL=http://bridgeability-env.<hash>.us-east-1.elasticbeanstalk.com npm run test:integration',
  );
});

test('GET /health reports RDS, DynamoDB and S3 as ok', { skip: !baseUrl }, async () => {
  const response = await fetch(new URL('/health', baseUrl));
  const body = await response.json();

  assert.equal(response.status, 200, `expected 200, got ${response.status}: ${JSON.stringify(body)}`);
  assert.equal(body.status, 'ok');

  for (const dependency of body.dependencies) {
    assert.equal(
      dependency.status,
      'ok',
      `${dependency.name} reported ${dependency.status}: ${dependency.error ?? '(no error message)'}`,
    );
  }
});

test('GET /services renders the public catalogue', { skip: !baseUrl }, async () => {
  const response = await fetch(new URL('/services', baseUrl));
  assert.equal(response.status, 200);

  const body = await response.text();
  assert.match(body, /<html/i);
});

test('GET /login redirects an unauthenticated visitor to no dashboard', { skip: !baseUrl }, async () => {
  const response = await fetch(new URL('/dashboard', baseUrl), { redirect: 'manual' });
  // Unauthenticated dashboard access is a redirect to sign-in, never a 200.
  assert.equal(response.status, 302);
  assert.match(response.headers.get('location') ?? '', /\/login$/);
});
