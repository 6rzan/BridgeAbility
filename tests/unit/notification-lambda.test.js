'use strict';

require('../helpers/env');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseRecord,
  buildNotificationItem,
} = require('../../services/notification/index.js');

// --- parseRecord -------------------------------------------------------------------------------

function sqsRecord(publishedMessage) {
  // Mirrors the real shape: SNS -> SQS (no raw message delivery) wraps the published message in
  // an envelope, so record.body is itself JSON, and .Message inside it is a second JSON string.
  return {
    messageId: 'sqs-msg-1',
    body: JSON.stringify({
      Type: 'Notification',
      MessageId: 'sns-msg-1',
      TopicArn: 'arn:aws:sns:us-east-1:000000000000:bridgeability-booking-events',
      Message: JSON.stringify(publishedMessage),
      Timestamp: '2026-09-15T02:00:00.000Z',
    }),
  };
}

test('parseRecord unwraps the SNS envelope to recover the published event', () => {
  const published = {
    eventType: 'BOOKING_ACCEPTED',
    recipientUserId: 1,
    message: 'Your request was accepted.',
    detail: { bookingId: 1, providerId: 1 },
    occurredAt: '2026-09-15T02:00:00.000Z',
  };

  const event = parseRecord(sqsRecord(published));

  assert.deepEqual(event, published);
});

test('parseRecord rejects a message missing a required field', () => {
  assert.throws(
    () => parseRecord(sqsRecord({ eventType: 'BOOKING_ACCEPTED' })),
    /malformed booking event/,
  );
});

test('parseRecord rejects a record whose body is not valid JSON', () => {
  assert.throws(() => parseRecord({ messageId: 'x', body: 'not json' }));
});

// --- buildNotificationItem ----------------------------------------------------------------------

test('buildNotificationItem builds the PK/SK pair from the recipient and timestamp', () => {
  const item = buildNotificationItem({
    eventType: 'PROVIDER_APPROVED',
    recipientUserId: 4,
    message: 'Your organisation is approved.',
    detail: { providerId: 1 },
    occurredAt: '2026-09-15T02:00:00.000Z',
  });

  assert.equal(item.PK, 'USER#4');
  assert.equal(item.SK, '2026-09-15T02:00:00.000Z#PROVIDER_APPROVED');
  assert.equal(item.eventType, 'PROVIDER_APPROVED');
  assert.equal(item.message, 'Your organisation is approved.');
  assert.deepEqual(item.detail, { providerId: 1 });
  assert.equal(item.read, false);
  assert.match(item.notificationId, /^[0-9a-f-]{36}$/);
});

test('buildNotificationItem fills in occurredAt when the event did not carry one', () => {
  const before = Date.now();
  const item = buildNotificationItem({
    eventType: 'BOOKING_REJECTED',
    recipientUserId: 2,
    message: 'Your request was declined.',
  });
  const after = Date.now();

  assert.deepEqual(item.detail, {});
  const occurredAtMs = new Date(item.occurredAt).getTime();
  assert.ok(occurredAtMs >= before && occurredAtMs <= after);
  assert.ok(item.SK.startsWith(item.occurredAt));
});
