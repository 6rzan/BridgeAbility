'use strict';

require('../helpers/env');

const test = require('node:test');
const assert = require('node:assert/strict');

const { expiryEpochSeconds, isExpired } = require('../../src/data/dynamo/sessionStore');

const NOW_MS = Date.UTC(2026, 7, 16, 12, 0, 0);
const NOW_SECONDS = Math.floor(NOW_MS / 1000);

test('the expiry is the cookie lifetime, expressed in epoch seconds', () => {
  const session = { cookie: { maxAge: 8 * 60 * 60 * 1000 } };
  assert.equal(expiryEpochSeconds(session, NOW_MS), NOW_SECONDS + 8 * 60 * 60);
});

test('a session with no usable cookie lifetime falls back to the configured TTL', () => {
  const configured = require('../../src/config').session.ttlSeconds;

  for (const session of [{}, { cookie: {} }, { cookie: { maxAge: null } }, null]) {
    assert.equal(expiryEpochSeconds(session, NOW_MS), NOW_SECONDS + configured);
  }
});


test('the expiry is in seconds, not milliseconds', () => {
  const expiry = expiryEpochSeconds({ cookie: { maxAge: 1000 } }, NOW_MS);
  assert.ok(expiry < 4_000_000_000, `expected epoch seconds, got ${expiry}`);
});


test('an item past its expiry is treated as absent even though DynamoDB still holds it', () => {
  assert.equal(isExpired({ expiresAt: NOW_SECONDS - 1 }, NOW_MS), true);
});

test('an item exactly at its expiry is treated as expired', () => {
  assert.equal(isExpired({ expiresAt: NOW_SECONDS }, NOW_MS), true);
});

test('an item still within its window is live', () => {
  assert.equal(isExpired({ expiresAt: NOW_SECONDS + 1 }, NOW_MS), false);
});

test('a missing or malformed item is treated as expired, never as valid', () => {
  for (const item of [undefined, null, {}, { expiresAt: 'soon' }, { expiresAt: null }]) {
    assert.equal(isExpired(item, NOW_MS), true, JSON.stringify(item));
  }
});
