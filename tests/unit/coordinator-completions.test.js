'use strict';

require('../helpers/env');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  completionUpdateSchema,
  COMPLETION_STATUSES,
  COMPLETION_LABELS,
} = require('../../src/validation/assignmentSchemas');

test('each of the three completion statuses is accepted', () => {
  for (const completionStatus of COMPLETION_STATUSES) {
    const parsed = completionUpdateSchema.safeParse({ completionStatus, completionNotes: '' });
    assert.equal(parsed.success, true);
    assert.equal(parsed.data.completionStatus, completionStatus);
  }
});

test('a status outside the three is rejected, not silently ignored', () => {
  const parsed = completionUpdateSchema.safeParse({ completionStatus: 'done', completionNotes: '' });
  assert.equal(parsed.success, false);
});

test('blank notes become null rather than an empty string', () => {
  const parsed = completionUpdateSchema.safeParse({ completionStatus: 'pending', completionNotes: '  ' });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.completionNotes, null);
});

test('real notes are kept and trimmed', () => {
  const parsed = completionUpdateSchema.safeParse({
    completionStatus: 'in_progress',
    completionNotes: '  volunteer running 10 minutes late  ',
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.completionNotes, 'volunteer running 10 minutes late');
});

test('notes over 1000 characters are rejected', () => {
  const parsed = completionUpdateSchema.safeParse({
    completionStatus: 'completed',
    completionNotes: 'x'.repeat(1001),
  });
  assert.equal(parsed.success, false);
});

test('a missing status is rejected rather than defaulted', () => {
  const parsed = completionUpdateSchema.safeParse({ completionNotes: '' });
  assert.equal(parsed.success, false);
});

test('every completion status has a label', () => {
  for (const status of COMPLETION_STATUSES) {
    assert.ok(COMPLETION_LABELS[status], `missing a label for "${status}"`);
  }
});

test('there are exactly three completion statuses, matching the schema ENUM', () => {
  assert.deepEqual(COMPLETION_STATUSES, ['pending', 'in_progress', 'completed']);
});
