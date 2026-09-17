'use strict';

const bookingRepository = require('../data/mysql/bookingRepository');
const bookingService = require('./bookingService');
const timelineRepository = require('../data/dynamo/timelineRepository');
const { EVENT_TYPES, publishBookingEventSafely } = require('./notificationPublisher');
const { fetchTimeline } = require('./timelineGateway');
const {
  formatWallClock,
  toDatetimeAttribute,
  toKualaLumpur,
  STATUS_LABELS,
  STATUS_EXPLANATIONS,
} = require('../validation/bookingSchemas');

const PER_PAGE = bookingService.PER_PAGE;

function decorate(booking) {
  return {
    ...booking,
    statusLabel: STATUS_LABELS[booking.status],
    statusExplanation: STATUS_EXPLANATIONS[booking.status],
    canDecide: booking.status === 'pending',
    requestedLabel: formatWallClock(booking.requested_datetime),
    requestedAttribute: toDatetimeAttribute(booking.requested_datetime),
    createdLabel: formatWallClock(toKualaLumpur(booking.created_at)),
  };
}

async function listIncoming(providerId, { status, page }) {
  const totalItems = await bookingRepository.countIncomingForProvider(providerId, { status });
  const pagination = bookingService.paginate(totalItems, page, PER_PAGE);

  const rows = await bookingRepository.findIncomingForProvider(providerId, {
    status,
    limit: pagination.perPage,
    offset: pagination.offset,
  });

  const counts = await bookingRepository.countByStatusForProvider(providerId);

  return {
    bookings: rows.map(decorate),
    pagination,
    counts,
    total: Object.values(counts).reduce((sum, value) => sum + value, 0),
  };
}

async function findForProvider(bookingId, providerId) {
  const booking = await bookingRepository.findForProvider(bookingId, providerId);

  if (!booking) {
    return null;
  }

  let timeline = [];
  let timelineAvailable = true;

  try {
    timeline = await fetchTimeline(bookingId);
  } catch (error) {
    console.error('[timeline] read failed', { bookingId, error: error.message });
    timelineAvailable = false;
  }

  return {
    booking: decorate(booking),
    timeline: timeline.map((event) => ({
      ...event,
      label: timelineRepository.EVENT_LABELS[event.event] || event.event,
      occurredLabel: formatWallClock(toKualaLumpur(event.occurredAt)),
    })),
    timelineAvailable,
  };
}

async function decide({ bookingId, provider, actor, decision }) {
  const booking = await bookingRepository.findForProvider(bookingId, provider.provider_id);

  if (!booking) {
    return { outcome: 'not-found' };
  }

  const changed = await bookingRepository.setProviderDecision(
    bookingId,
    provider.provider_id,
    decision
  );

  if (!changed) {
    return { outcome: 'not-pending', status: booking.status };
  }

  await bookingService.appendEventSafely({
    bookingId,
    event: decision === 'accepted' ? timelineRepository.EVENTS.ACCEPTED : timelineRepository.EVENTS.REJECTED,
    status: decision,
    providerId: provider.provider_id,
    actorId: actor.id,
    actorRole: 'provider',
    actorName: actor.name,
    detail: null,
  });

  await publishBookingEventSafely({
    eventType: decision === 'accepted' ? EVENT_TYPES.BOOKING_ACCEPTED : EVENT_TYPES.BOOKING_REJECTED,
    recipientUserId: booking.requester_id,
    message: decision === 'accepted'
      ? `Your request for "${booking.title}" was accepted.`
      : `Your request for "${booking.title}" was declined.`,
    detail: { bookingId, providerId: provider.provider_id },
  });

  return { outcome: decision };
}

module.exports = {
  listIncoming,
  findForProvider,
  decide,
  decorate,
};
