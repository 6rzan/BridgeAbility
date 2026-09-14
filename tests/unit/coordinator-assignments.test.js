'use strict';

require('../helpers/env');

const test = require('node:test');
const assert = require('node:assert/strict');

const { assignmentCreateSchema } = require('../../src/validation/assignmentSchemas');
const { decorate } = require('../../src/services/coordinatorBookingService');
const {
  parseBookingId,
  parseView,
  parsePage,
  buildQueryString,
  VIEW_LABELS,
} = require('../../src/controllers/coordinatorBookingController');
const { VIEWS } = require('../../src/data/mysql/assignmentRepository');



test('a well-formed assignment is accepted and trimmed', () => {
  const parsed = assignmentCreateSchema.safeParse({
    volunteerName: '  Aisyah Rahman  ',
    volunteerContact: ' 012-3456789 ',
  });

  assert.equal(parsed.success, true);
  assert.equal(parsed.data.volunteerName, 'Aisyah Rahman');
  assert.equal(parsed.data.volunteerContact, '012-3456789');
});

test('a volunteer name under two characters is rejected', () => {
  const parsed = assignmentCreateSchema.safeParse({
    volunteerName: 'A',
    volunteerContact: '012-3456789',
  });
  assert.equal(parsed.success, false);
});

test('a volunteer contact under five characters is rejected', () => {
  const parsed = assignmentCreateSchema.safeParse({
    volunteerName: 'Aisyah Rahman',
    volunteerContact: '012',
  });
  assert.equal(parsed.success, false);
});

test('a name or contact over 120 characters is rejected', () => {
  const tooLong = 'x'.repeat(121);
  assert.equal(
    assignmentCreateSchema.safeParse({ volunteerName: tooLong, volunteerContact: '012-3456789' }).success,
    false
  );
  assert.equal(
    assignmentCreateSchema.safeParse({ volunteerName: 'Aisyah Rahman', volunteerContact: tooLong }).success,
    false
  );
});

test('a field that is only whitespace is rejected, not accepted as blank', () => {
  const parsed = assignmentCreateSchema.safeParse({
    volunteerName: '   ',
    volunteerContact: '012-3456789',
  });
  assert.equal(parsed.success, false);
});



test('only an accepted booking can be assigned', () => {
  const base = {
    booking_id: 1,
    status: 'accepted',
    requested_datetime: new Date('2026-08-20T02:00:00Z'),
    created_at: new Date('2026-08-01T00:00:00Z'),
    assigned_at: null,
    completed_at: null,
  };

  assert.equal(decorate(base).canAssign, true);
  assert.equal(decorate({ ...base, status: 'assigned' }).canAssign, false);
  assert.equal(decorate({ ...base, status: 'completed' }).canAssign, false);
  assert.equal(decorate({ ...base, status: 'pending' }).canAssign, false);
});

test('a booking with no assignment yet has no assigned or completed label', () => {
  const decorated = decorate({
    booking_id: 1,
    status: 'accepted',
    requested_datetime: new Date('2026-08-20T02:00:00Z'),
    created_at: new Date('2026-08-01T00:00:00Z'),
    assigned_at: null,
    completed_at: null,
  });

  assert.equal(decorated.assignedLabel, null);
  assert.equal(decorated.completedLabel, null);
});



test('a positive integer string is a valid booking id', () => {
  assert.equal(parseBookingId('7'), 7);
});

test('anything that is not a positive integer is not a booking id', () => {
  assert.equal(parseBookingId('0'), null);
  assert.equal(parseBookingId('-3'), null);
  assert.equal(parseBookingId('abc'), null);
});

test('each of the three views is accepted as itself', () => {
  for (const view of VIEWS) {
    assert.equal(parseView(view), view);
  }
});

test('an unrecognised view falls back to the default rather than 404ing', () => {
  assert.equal(parseView('bogus'), 'awaiting');
  assert.equal(parseView(undefined), 'awaiting');
});

test('every view has a label', () => {
  for (const view of VIEWS) {
    assert.ok(VIEW_LABELS[view], `missing a label for "${view}"`);
  }
});

test('the query string omits the default view but keeps a non-default one', () => {
  assert.equal(buildQueryString('awaiting'), '');
  assert.equal(buildQueryString('assigned'), '?view=assigned');
  assert.equal(buildQueryString('assigned', { page: 2 }), '?view=assigned&page=2');
});

test('page 1 never appears in the query string', () => {
  assert.equal(buildQueryString('completed', { page: 1 }), '?view=completed');
});
