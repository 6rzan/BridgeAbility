'use strict';

const assignmentRepository = require('../data/mysql/assignmentRepository');
const bookingService = require('./bookingService');
const timelineRepository = require('../data/dynamo/timelineRepository');
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
    canAssign: booking.status === 'accepted',
    requestedLabel: formatWallClock(booking.requested_datetime),
    requestedAttribute: toDatetimeAttribute(booking.requested_datetime),
    createdLabel: formatWallClock(toKualaLumpur(booking.created_at)),
    assignedLabel: booking.assigned_at ? formatWallClock(toKualaLumpur(booking.assigned_at)) : null,
    completedLabel: booking.completed_at ? formatWallClock(toKualaLumpur(booking.completed_at)) : null,
  };
}

async function listQueue({ view, page }) {
  const totalItems = await assignmentRepository.countForCoordinator({ view });
  const pagination = bookingService.paginate(totalItems, page, PER_PAGE);

  const rows = await assignmentRepository.findForCoordinator({
    view,
    limit: pagination.perPage,
    offset: pagination.offset,
  });

  const counts = await assignmentRepository.countsByView();

  return {
    bookings: rows.map(decorate),
    pagination,
    counts,
  };
}

async function findDetail(bookingId) {
  const booking = await assignmentRepository.findDetail(bookingId);

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

async function assign({ bookingId, actor, volunteerName, volunteerContact }) {
  const booking = await assignmentRepository.findDetail(bookingId);

  if (!booking) {
    return { outcome: 'not-found' };
  }

  const result = await assignmentRepository.createAssignment({
    bookingId,
    assignedBy: actor.id,
    volunteerName,
    volunteerContact,
  });

  if (result.outcome !== 'assigned') {
    return { outcome: result.outcome, status: booking.status };
  }

  await bookingService.appendEventSafely({
    bookingId,
    event: timelineRepository.EVENTS.ASSIGNED,
    status: 'assigned',
    providerId: booking.provider_id,
    actorId: actor.id,
    actorRole: 'coordinator',
    actorName: actor.name,
    detail: `Volunteer: ${volunteerName}`,
  });

  return { outcome: 'assigned' };
}

async function updateCompletion({ bookingId, actor, completionStatus, completionNotes }) {
  const booking = await assignmentRepository.findDetail(bookingId);

  if (!booking || !booking.assignment_id) {
    return { outcome: 'not-found' };
  }

  const result = await assignmentRepository.updateCompletion(bookingId, {
    completionStatus,
    completionNotes,
  });

  if (result.outcome === 'already-completed') {
    return { outcome: 'already-completed' };
  }

  if (completionStatus === 'completed') {
    await bookingService.appendEventSafely({
      bookingId,
      event: timelineRepository.EVENTS.COMPLETED,
      status: 'completed',
      providerId: booking.provider_id,
      actorId: actor.id,
      actorRole: 'coordinator',
      actorName: actor.name,
      detail: completionNotes,
    });
  }

  return { outcome: completionStatus };
}

module.exports = {
  listQueue,
  findDetail,
  updateCompletion,
  assign,
  decorate,
};
