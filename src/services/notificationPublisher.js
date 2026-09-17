'use strict';

const snsClient = require('../data/sns/client');
const config = require('../config');

const EVENT_TYPES = {
  BOOKING_ACCEPTED: 'BOOKING_ACCEPTED',
  BOOKING_REJECTED: 'BOOKING_REJECTED',
  PROVIDER_APPROVED: 'PROVIDER_APPROVED',
  PROVIDER_REJECTED: 'PROVIDER_REJECTED',
};

async function publishBookingEventSafely({ eventType, recipientUserId, message, detail = {} }) {
  if (!config.sns.bookingEventsTopicArn) {

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
