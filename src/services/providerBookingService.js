'use strict';

const bookingRepository = require('../data/mysql/bookingRepository');
const bookingService = require('./bookingService');
const timelineRepository = require('../data/dynamo/timelineRepository');
const { EVENT_TYPES, publishBookingEventSafely } = require('./notificationPublisher');
const {
  formatWallClock,
  toDatetimeAttribute,
  toKualaLumpur,
  STATUS_LABELS,
  STATUS_EXPLANATIONS,
} = require('../validation/bookingSchemas');

/**
 * A provider's incoming booking requests (F4) -- accept or reject, nothing else.
 *
 * There is no column on `bookings` a provider is entitled to edit: `requested_datetime` and
 * `notes` are the requester's own input, and no route anywhere lets a provider change them.
 * "Update" in this functionality's name is the status transition itself.
 *
 * appendEventSafely, decorate's timestamp shaping and the page-arithmetic helper are all reused
 * from bookingService (F2) rather than re-implemented -- they are generic to a booking, not
 * specific to the requester's half of the flow.
 */

const PER_PAGE = bookingService.PER_PAGE;

/** A provider-side decoration: no cancel affordance, but accept/reject visibility instead. */
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

/** One page of this provider's incoming requests, with the counts the filter menu shows. */
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

/**
 * One incoming request and its history, or null if it is not against a listing this provider
 * owns. A DynamoDB read failure degrades to an empty timeline -- the status in MySQL is the
 * fact the provider needs, the history is how it got there.
 */
async function findForProvider(bookingId, providerId) {
  const booking = await bookingRepository.findForProvider(bookingId, providerId);

  if (!booking) {
    return null;
  }

  let timeline = [];
  let timelineAvailable = true;

  try {
    timeline = await timelineRepository.listEvents(bookingId);
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

/**
 * Accept or reject a pending request.
 *
 * The guard is setProviderDecision's own UPDATE (see bookingRepository), so this cannot act on
 * a request the requester has already cancelled or that another tab already decided. Only a
 * decision that actually changed a row writes a timeline event.
 */
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
