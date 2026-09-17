'use strict';

require('../helpers/env');

const test = require('node:test');
const assert = require('node:assert/strict');

const { EVENT_TYPES, publishBookingEventSafely } = require('../../src/services/notificationPublisher');

test('publishBookingEventSafely no-ops and returns null when SNS_BOOKING_EVENTS_TOPIC_ARN is unset', async () => {
  const result = await publishBookingEventSafely({
    eventType: EVENT_TYPES.BOOKING_ACCEPTED,
    recipientUserId: 1,
    message: 'Your request for "Test service" was accepted.',
    detail: { bookingId: 1, providerId: 1 },
  });

  assert.equal(result, null);
});

test('publishBookingEventSafely never throws, even with a malformed payload', async () => {

  await assert.doesNotReject(() => publishBookingEventSafely({}));
});

test('EVENT_TYPES covers accept, reject, approve and reject for both F4 and F5', () => {
  assert.deepEqual(Object.keys(EVENT_TYPES).sort(), [
    'BOOKING_ACCEPTED',
    'BOOKING_REJECTED',
    'PROVIDER_APPROVED',
    'PROVIDER_REJECTED',
  ]);
});
