'use strict';

require('../helpers/env');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  withZeroCounts,
  COMPLETION_STATUSES,
  COMPLETION_LABELS,
} = require('../../src/services/adminReportService');

// --- withZeroCounts ------------------------------------------------------------------

test('a status the GROUP BY returned is passed through unchanged', () => {
  const filled = withZeroCounts(['pending', 'completed'], { pending: 4, completed: 2 });
  assert.deepEqual(filled, { pending: 4, completed: 2 });
});

test('a status the GROUP BY did not return a row for is filled in as 0', () => {
  const filled = withZeroCounts(['pending', 'approved', 'rejected'], { pending: 3 });
  assert.deepEqual(filled, { pending: 3, approved: 0, rejected: 0 });
});

test('an empty result fills every key with 0', () => {
  const filled = withZeroCounts(['pending', 'in_progress', 'completed'], {});
  assert.deepEqual(filled, { pending: 0, in_progress: 0, completed: 0 });
});

test('a key nobody asked for is not invented from the raw counts', () => {
  const filled = withZeroCounts(['pending'], { pending: 1, cancelled: 9 });
  assert.deepEqual(filled, { pending: 1, cancelled: 9 });
  // withZeroCounts only guarantees the keys it was given are present -- it does not strip
  // anything extra the raw query happened to include.
});

// --- COMPLETION_LABELS completeness -----------------------------------------------------
//
// The same class of lock-step check as bookingSchemas.js's STATUS_LABELS/STATUS_EXPLANATIONS
// pair and adminProviderSchemas.js's PROVIDER_STATUS_LABELS -- every status this file knows
// about must have something to show for it.

test('every completion status has a label', () => {
  for (const status of COMPLETION_STATUSES) {
    assert.ok(COMPLETION_LABELS[status], `missing a label for "${status}"`);
  }
});

test('there are exactly three completion statuses, matching the schema ENUM', () => {
  assert.deepEqual(COMPLETION_STATUSES, ['pending', 'in_progress', 'completed']);
});
