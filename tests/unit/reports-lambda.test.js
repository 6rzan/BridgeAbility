'use strict';

require('../helpers/env');

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseLimit } = require('../../services/reports/index.js');

// --- parseLimit ----------------------------------------------------------------------------
//
// Pure: no AWS call. queryCompletedEvents (the actual DynamoDB read) is the same query
// src/data/dynamo/timelineRepository.js's queryCompletedEvents already runs, and is exercised
// for real only once this Lambda is deployed -- per this project's "no mocked AWS client
// anywhere" rule (CLAUDE.md).

test('parseLimit defaults to 10 with no query string at all', () => {
  assert.equal(parseLimit(undefined), 10);
  assert.equal(parseLimit(null), 10);
  assert.equal(parseLimit({}), 10);
});

test('parseLimit parses a valid limit', () => {
  assert.equal(parseLimit({ limit: '5' }), 5);
});

test('parseLimit caps at 50, matching this being a small admin report, not a bulk export', () => {
  assert.equal(parseLimit({ limit: '1000' }), 50);
});

test('parseLimit falls back to 10 for anything not a positive integer', () => {
  assert.equal(parseLimit({ limit: 'not-a-number' }), 10);
  assert.equal(parseLimit({ limit: '0' }), 10);
  assert.equal(parseLimit({ limit: '-5' }), 10);
  assert.equal(parseLimit({ limit: '3.7' }), 3); // parseInt truncates, matching Number.parseInt's own documented behaviour
});
