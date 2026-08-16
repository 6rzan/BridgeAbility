'use strict';

const bookingRepository = require('../data/mysql/bookingRepository');
const serviceRepository = require('../data/mysql/serviceRepository');
const timelineRepository = require('../data/dynamo/timelineRepository');
const { toMysqlDatetime, STATUS_LABELS, STATUS_EXPLANATIONS, CANCELLABLE } = require('../validation/bookingSchemas');

/**
 * Booking submission and status tracking (F2).
 *
 * This is the one place in the application where both databases are written for the same
 * user action, so the ordering rule is stated here and followed everywhere:
 *
 *   1. MySQL commits first. It holds the authoritative status of a booking.
 *   2. DynamoDB is appended afterwards, outside that transaction.
 *   3. If step 2 fails, the booking still exists and the failure is logged for reconciliation.
 *
 * The alternative ordering -- history first -- can leave a timeline entry for a booking that
 * was never created, which is worse: the requester is told their request was sent when no
 * provider will ever see it. A booking with one missing history line is visibly incomplete
 * and recoverable. There is no distributed transaction across RDS and DynamoDB and pretending
 * otherwise would be the real mistake.
 */

const PER_PAGE = 8;

/**
 * A DynamoDB append that fails must not fail the user's action, but it must not vanish either.
 *
 * The log line is deliberately greppable and carries everything needed to replay the event by
 * hand: this is the reconciliation record, and CloudWatch Logs is where it lands.
 */
async function appendEventSafely(payload) {
  try {
    return await timelineRepository.appendEvent(payload);
  } catch (error) {
    console.error('[timeline] APPEND FAILED — reconcile by hand', {
      bookingId: payload.bookingId,
      event: payload.event,
      status: payload.status,
      actorId: payload.actorId,
      occurredAt: (payload.occurredAt || new Date()).toISOString(),
      error: error.message,
    });
    return null;
  }
}

/** Page arithmetic, shared with the catalogue's rules so the two lists behave the same way. */
function paginate(totalItems, page, perPage = PER_PAGE) {
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const offset = (currentPage - 1) * perPage;

  return {
    totalItems,
    totalPages,
    currentPage,
    perPage,
    offset,
    firstOnPage: totalItems === 0 ? 0 : offset + 1,
    lastOnPage: Math.min(offset + perPage, totalItems),
    hasPrevious: currentPage > 1,
    hasNext: currentPage < totalPages,
  };
}

/** Decorate a booking row with everything a view needs and nothing it has to work out. */
function decorate(booking) {
  return {
    ...booking,
    statusLabel: STATUS_LABELS[booking.status],
    statusExplanation: STATUS_EXPLANATIONS[booking.status],
    canCancel: CANCELLABLE.has(booking.status),
  };
}

/**
 * Submit a booking request.
 *
 * Returns a discriminated result rather than throwing, because "the service was withdrawn
 * while you were filling in the form" is an ordinary outcome the requester has to be told
 * about clearly, not an exception.
 */
async function submit({ criteria, requester }) {
  const service = await serviceRepository.findVisibleServiceById(criteria.serviceId);

  if (!service) {
    return { outcome: 'unavailable', bookingId: null };
  }

  const { booking, created, reason } = await bookingRepository.createBooking({
    serviceId: criteria.serviceId,
    requesterId: requester.id,
    requestedDatetime: toMysqlDatetime(criteria.requestedDatetime),
    notes: criteria.notes,
    requestKey: criteria.requestKey,
  });

  if (!booking) {
    // The visibility re-check inside the transaction lost a race with a withdrawal.
    return { outcome: 'unavailable', bookingId: null };
  }

  if (!created) {
    // A resubmission of the same form. The booking already exists; say so rather than
    // pretending a second one was made.
    return { outcome: 'duplicate', bookingId: booking.bookingId };
  }

  await appendEventSafely({
    bookingId: booking.bookingId,
    event: timelineRepository.EVENTS.CREATED,
    status: 'pending',
    providerId: service.provider_id,
    actorId: requester.id,
    actorRole: 'requester',
    actorName: requester.name,
    detail: `Requested for ${criteria.requestedDatetime.replace('T', ' ')}`,
  });

  return { outcome: 'created', bookingId: booking.bookingId, reason };
}

/** One page of this requester's bookings, with the counts the filter menu shows. */
async function listForRequester(requesterId, { status, page }) {
  const totalItems = await bookingRepository.countForRequester(requesterId, { status });
  const pagination = paginate(totalItems, page);

  const rows = await bookingRepository.listForRequester(requesterId, {
    status,
    limit: pagination.perPage,
    offset: pagination.offset,
  });

  const counts = await bookingRepository.countByStatusForRequester(requesterId);

  return {
    bookings: rows.map(decorate),
    pagination,
    counts,
    total: Object.values(counts).reduce((sum, value) => sum + value, 0),
  };
}

/**
 * One booking and its history, or null if this requester does not own it.
 *
 * A DynamoDB failure here degrades to an empty timeline with the booking still shown. The
 * status in MySQL is the fact the requester needs; the history is how it got there.
 */
async function findForRequester(bookingId, requesterId) {
  const booking = await bookingRepository.findForRequester(bookingId, requesterId);

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
    })),
    timelineAvailable,
  };
}

/**
 * Cancel a pending request.
 *
 * The guard is the UPDATE's own WHERE clause (see bookingRepository.cancelPending), so this
 * cannot cancel a booking a provider accepted a moment ago. Only a cancellation that actually
 * changed a row writes a timeline event -- a no-op must not leave a history line saying
 * something happened.
 */
async function cancel({ bookingId, requester }) {
  const booking = await bookingRepository.findForRequester(bookingId, requester.id);

  if (!booking) {
    return { outcome: 'not-found' };
  }

  const cancelled = await bookingRepository.cancelPending(bookingId, requester.id);

  if (!cancelled) {
    return { outcome: 'not-cancellable', status: booking.status };
  }

  await appendEventSafely({
    bookingId,
    event: timelineRepository.EVENTS.CANCELLED,
    status: 'cancelled',
    providerId: booking.provider_id,
    actorId: requester.id,
    actorRole: 'requester',
    actorName: requester.name,
    detail: null,
  });

  return { outcome: 'cancelled' };
}

module.exports = {
  submit,
  listForRequester,
  findForRequester,
  cancel,
  paginate,
  decorate,
  appendEventSafely,
  PER_PAGE,
};
