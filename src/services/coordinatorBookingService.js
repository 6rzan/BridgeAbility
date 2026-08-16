'use strict';

const assignmentRepository = require('../data/mysql/assignmentRepository');
const bookingService = require('./bookingService');
const timelineRepository = require('../data/dynamo/timelineRepository');
const {
  formatWallClock,
  toDatetimeAttribute,
  toKualaLumpur,
  STATUS_LABELS,
  STATUS_EXPLANATIONS,
} = require('../validation/bookingSchemas');

/**
 * A coordinator assigns a volunteer to a confirmed booking (F7) and later logs how it went
 * (F8). One service file for both, mirroring assignmentRepository -- see that file's header for
 * why they share.
 *
 * appendEventSafely, decorate's timestamp shaping and the page-arithmetic helper are reused
 * from bookingService (F2) rather than re-implemented, the same choice F4's
 * providerBookingService already made.
 */

const PER_PAGE = bookingService.PER_PAGE;

/** A coordinator-side decoration: no accept/reject or cancel affordance, just the facts. */
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

/** One page of one of the three buckets, with the counts the tab bar shows. */
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

/**
 * One booking and its history, or null if it does not exist. No ownership check -- any
 * coordinator may look at any booking, the role guard on the router is the whole model.
 */
async function findDetail(bookingId) {
  const booking = await assignmentRepository.findDetail(bookingId);

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
 * Assign a volunteer to a confirmed booking.
 *
 * The guard is createAssignment's own transaction (see assignmentRepository), so this cannot
 * double-assign a booking two coordinators opened at the same moment. Only an assignment that
 * actually happened writes a timeline event.
 */
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

/**
 * Record how an assignment finished (F8).
 *
 * The guard is updateCompletion's own transaction (see assignmentRepository): a completed
 * assignment cannot be moved anywhere else, regardless of what a stale form submits. Only a
 * transition that lands on 'completed' writes a timeline event -- 'pending' and 'in_progress'
 * are ordinary corrections, not milestones worth a history line.
 */
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
