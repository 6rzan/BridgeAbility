'use strict';

const bookingRepository = require('../data/mysql/bookingRepository');
const serviceRepository = require('../data/mysql/serviceRepository');
const timelineRepository = require('../data/dynamo/timelineRepository');
const {
  toMysqlDatetime,
  formatWallClock,
  toDatetimeAttribute,
  toKualaLumpur,
  STATUS_LABELS,
  STATUS_EXPLANATIONS,
  CANCELLABLE,
} = require('../validation/bookingSchemas');




const PER_PAGE = 8;



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



function decorate(booking) {
  return {
    ...booking,
    statusLabel: STATUS_LABELS[booking.status],
    statusExplanation: STATUS_EXPLANATIONS[booking.status],
    canCancel: CANCELLABLE.has(booking.status),
    requestedLabel: formatWallClock(booking.requested_datetime),
    requestedAttribute: toDatetimeAttribute(booking.requested_datetime),
    createdLabel: formatWallClock(toKualaLumpur(booking.created_at)),
  };
}



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

    return { outcome: 'unavailable', bookingId: null };
  }

  if (!created) {

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

      occurredLabel: formatWallClock(toKualaLumpur(event.occurredAt)),
    })),
    timelineAvailable,
  };
}



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
