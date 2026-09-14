'use strict';

require('../helpers/env');

const test = require('node:test');
const assert = require('node:assert/strict');

const { decorate } = require('../../src/services/providerBookingService');
const {
  parseBookingId,
  parsePage,
  buildQueryString,
} = require('../../src/controllers/providerBookingController');

// --- parseBookingId ------------------------------------------------------------
//
// The id comes straight off the URL, so anything that is not a positive integer must simply
// not be a booking -- the same reasoning as providerServiceController.parseServiceId.

test('a positive integer string is a valid booking id', () => {
  assert.equal(parseBookingId('7'), 7);
  assert.equal(parseBookingId('123'), 123);
});

test('anything that is not a positive integer is not a booking id', () => {
  assert.equal(parseBookingId('0'), null);
  assert.equal(parseBookingId('-4'), null);
  assert.equal(parseBookingId('3.5'), null);
  assert.equal(parseBookingId('abc'), null);
  assert.equal(parseBookingId(''), null);
  assert.equal(parseBookingId(undefined), null);
});

// --- parsePage / buildQueryString -----------------------------------------------
//
// Copied in shape from bookingController's own helpers (F2) rather than imported, because the
// two lists are independent URLs with independent query strings; the logic is identical but
// there is no shared "pagination" module either side already depends on.

test('an invalid page number falls back to page 1', () => {
  assert.equal(parsePage('0'), 1);
  assert.equal(parsePage('-1'), 1);
  assert.equal(parsePage('abc'), 1);
  assert.equal(parsePage(undefined), 1);
});

test('a valid page number is used as-is', () => {
  assert.equal(parsePage('3'), 3);
});

test('the query string carries only the filters actually in force', () => {
  assert.equal(buildQueryString(null), '');
  assert.equal(buildQueryString('pending'), '?status=pending');
  assert.equal(buildQueryString(null, { page: 2 }), '?page=2');
  assert.equal(buildQueryString('pending', { page: 1 }), '?status=pending');
});

// --- decorate --------------------------------------------------------------------
//
// canDecide is what the view uses to decide whether to show the accept/reject forms at all --
// getting this wrong either hides a legitimate action or offers one the guarded UPDATE would
// refuse anyway.

test('a pending request can be decided; nothing else can', () => {
  const base = {
    booking_id: 1,
    status: 'pending',
    requested_datetime: new Date('2026-09-01T10:00:00Z'),
    created_at: new Date('2026-08-20T06:45:00Z'),
  };

  assert.equal(decorate(base).canDecide, true);
  assert.equal(decorate({ ...base, status: 'accepted' }).canDecide, false);
  assert.equal(decorate({ ...base, status: 'rejected' }).canDecide, false);
  assert.equal(decorate({ ...base, status: 'assigned' }).canDecide, false);
  assert.equal(decorate({ ...base, status: 'completed' }).canDecide, false);
  assert.equal(decorate({ ...base, status: 'cancelled' }).canDecide, false);
});

test('decoration adds a status label and explanation from the shared booking vocabulary', () => {
  const decorated = decorate({
    booking_id: 1,
    status: 'accepted',
    requested_datetime: new Date('2026-09-01T10:00:00Z'),
    created_at: new Date('2026-08-20T06:45:00Z'),
  });

  assert.equal(decorated.statusLabel, 'Accepted');
  assert.ok(decorated.statusExplanation.length > 0);
});
