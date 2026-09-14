'use strict';

require('../helpers/env');

const test = require('node:test');
const assert = require('node:assert/strict');

const { EVENT_TYPES, publishBookingEventSafely } = require('../../src/services/notificationPublisher');

// --- publishBookingEventSafely, MS-1 not deployed ---------------------------------------------
//
// This is the one branch of the notification publisher that is pure and safe to unit-test: no
// SNS_BOOKING_EVENTS_TOPIC_ARN is set anywhere in the unit-test environment (tests/helpers/env.js
// deliberately does not set it, matching the Task 1 baseline environment), so every call here
// takes the "MS-1 is not deployed" branch and never touches the network. Anything past that
// branch -- an actual SNS PublishCommand -- needs a real AWS credential and is exercised by the
// integration suite against a deployed environment instead, per the project's own "no mocked AWS
// client anywhere" rule (CLAUDE.md).

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
  // No eventType, no recipientUserId -- if a caller ever gets this wrong, the request that
  // triggered it must still succeed, the same contract bookingService.appendEventSafely gives
  // the DynamoDB timeline append.
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
