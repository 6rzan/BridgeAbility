'use strict';

const snsClient = require('../data/sns/client');
const config = require('../config');

/**
 * Publishes booking/provider events to SNS for MS-1, the notification microservice (Task 2,
 * docs/task2-plan.md). The monolith's job ends at "one message, published"; everything after
 * that -- fan-out to SQS, retries, the dead-letter queue, formatting, writing the notification
 * record -- is MS-1's Lambda (services/notification/index.js), not this file's concern.
 *
 * WHY publishBookingEventSafely EXISTS, AND WHY IT NEVER THROWS
 *
 * A user accepting a booking or an admin approving a provider is the real action; a
 * notification about it is a side effect. The same reasoning bookingService.appendEventSafely
 * already applies to the DynamoDB timeline append applies here: a publish failure must not fail
 * the request that triggered it, and it must not vanish silently either -- the log line is the
 * reconciliation record. This also means the notification path degrades exactly like the rest
 * of the app when a Task 2 piece is not deployed: config.sns.bookingEventsTopicArn is optional
 * (see src/config/index.js), and this function no-ops, not throws, when it is unset.
 */

const EVENT_TYPES = {
  BOOKING_ACCEPTED: 'BOOKING_ACCEPTED',
  BOOKING_REJECTED: 'BOOKING_REJECTED',
  PROVIDER_APPROVED: 'PROVIDER_APPROVED',
  PROVIDER_REJECTED: 'PROVIDER_REJECTED',
};

/**
 * @param {object} payload
 * @param {string} payload.eventType   One of EVENT_TYPES.
 * @param {number} payload.recipientUserId  Who MS-1's Lambda should notify.
 * @param {string} payload.message     Human-readable text, ready to store/display as-is.
 * @param {object} [payload.detail]    Event-specific fields (bookingId, providerId, ...).
 */
async function publishBookingEventSafely({ eventType, recipientUserId, message, detail = {} }) {
  if (!config.sns.bookingEventsTopicArn) {
    // MS-1 is not deployed on this environment. Not an error -- the Task 1 baseline environment
    // never sets this, and a booking accept/reject must work identically either way.
    return null;
  }

  const envelope = {
    eventType,
    recipientUserId,
    message,
    detail,
    occurredAt: new Date().toISOString(),
  };

  try {
    return await snsClient.publishBookingEvent(envelope);
  } catch (error) {
    console.error('[notification] PUBLISH FAILED — reconcile by hand', {
      eventType,
      recipientUserId,
      detail,
      error: error.message,
    });
    return null;
  }
}

module.exports = { EVENT_TYPES, publishBookingEventSafely };
