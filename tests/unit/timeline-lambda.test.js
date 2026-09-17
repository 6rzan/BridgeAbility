'use strict';

require('../helpers/env');

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseBookingId } = require('../../services/timeline/index.js');

test('parseBookingId accepts a plain positive integer string', () => {
  assert.equal(parseBookingId({ bookingId: '1' }), 1);
  assert.equal(parseBookingId({ bookingId: '42' }), 42);
});

test('parseBookingId rejects missing path parameters', () => {
  assert.equal(parseBookingId(undefined), null);
  assert.equal(parseBookingId(null), null);
  assert.equal(parseBookingId({}), null);
});

test('parseBookingId rejects anything not a clean positive integer', () => {
  assert.equal(parseBookingId({ bookingId: '0' }), null);
  assert.equal(parseBookingId({ bookingId: '-1' }), null);
  assert.equal(parseBookingId({ bookingId: 'abc' }), null);
  assert.equal(parseBookingId({ bookingId: '1.5' }), null);
  assert.equal(parseBookingId({ bookingId: '01' }), null);
  assert.equal(parseBookingId({ bookingId: ' 1' }), null);
  assert.equal(parseBookingId({ bookingId: '1; DROP TABLE bookings' }), null);
});
