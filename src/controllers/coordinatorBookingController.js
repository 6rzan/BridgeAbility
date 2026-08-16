'use strict';

const coordinatorBookingService = require('../services/coordinatorBookingService');
const assignmentRepository = require('../data/mysql/assignmentRepository');
const { assignmentCreateSchema } = require('../validation/assignmentSchemas');
const { fieldErrors } = require('../validation/authSchemas');

/**
 * F7 -- a coordinator assigns a volunteer to a confirmed booking.
 *
 * Every route below is mounted behind requireRole('coordinator'). There is no per-row
 * ownership check anywhere here -- any coordinator may act on any booking, the same model F5
 * and F6 already use for administrators.
 */

const DEFAULT_VIEW = 'awaiting';

/** How each of the three tabs reads to a coordinator, in words. */
const VIEW_LABELS = {
  awaiting: 'Awaiting assignment',
  assigned: 'Assigned',
  completed: 'Completed',
};

/** A booking id from the URL. Anything that is not a positive integer is simply not a booking. */
function parseBookingId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Which of the three tabs to show. Anything else falls back to the default rather than 404ing. */
function parseView(raw) {
  return assignmentRepository.VIEWS.includes(raw) ? raw : DEFAULT_VIEW;
}

/** A page number can arrive from a link, so it is validated like anything else. */
function parsePage(raw) {
  const page = Number.parseInt(raw, 10);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

/** Preserve the active tab across pagination links. */
function buildQueryString(view, { page } = {}) {
  const params = new URLSearchParams();
  if (view && view !== DEFAULT_VIEW) params.set('view', view);
  if (page && page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** GET /coordinator/bookings -- awaiting assignment, assigned, or completed. */
async function getQueue(req, res, next) {
  try {
    const view = parseView(req.query.view);
    const page = parsePage(req.query.page);

    const { bookings, pagination, counts } = await coordinatorBookingService.listQueue({
      view,
      page,
    });

    return res.render('coordinator/bookings/index', {
      title: 'Volunteer assignments',
      bookings,
      pagination,
      counts,
      view,
      views: assignmentRepository.VIEWS,
      viewLabels: VIEW_LABELS,
      buildQueryString: (overrides) => buildQueryString(view, overrides),
    });
  } catch (error) {
    return next(error);
  }
}

/** GET /coordinator/bookings/:id -- one booking, its history, and the assign form if it applies. */
async function getBookingDetail(req, res, next) {
  try {
    const bookingId = parseBookingId(req.params.id);
    if (!bookingId) return next();

    const result = await coordinatorBookingService.findDetail(bookingId);
    if (!result) return next();

    return res.render('coordinator/bookings/detail', {
      title: `Booking #${result.booking.booking_id}`,
      booking: result.booking,
      timeline: result.timeline,
      timelineAvailable: result.timelineAvailable,
      values: { volunteerName: '', volunteerContact: '' },
      errors: {},
    });
  } catch (error) {
    return next(error);
  }
}

/** POST /coordinator/bookings/:id/assign */
async function postAssign(req, res, next) {
  try {
    const bookingId = parseBookingId(req.params.id);
    if (!bookingId) return next();

    const parsed = assignmentCreateSchema.safeParse(req.body);

    if (!parsed.success) {
      const result = await coordinatorBookingService.findDetail(bookingId);
      if (!result) return next();

      return res.status(422).render('coordinator/bookings/detail', {
        title: `Booking #${result.booking.booking_id}`,
        booking: result.booking,
        timeline: result.timeline,
        timelineAvailable: result.timelineAvailable,
        values: {
          volunteerName: req.body.volunteerName || '',
          volunteerContact: req.body.volunteerContact || '',
        },
        errors: fieldErrors(parsed.error),
      });
    }

    const actor = { id: req.session.user.id, name: req.session.user.name };
    const result = await coordinatorBookingService.assign({
      bookingId,
      actor,
      ...parsed.data,
    });

    if (result.outcome === 'not-found') return next();

    if (result.outcome !== 'assigned') {
      req.session.flash = {
        type: 'error',
        message: 'This booking is no longer awaiting assignment -- no change was made.',
      };
      return res.redirect(`/coordinator/bookings/${bookingId}`);
    }

    req.session.flash = { type: 'success', message: 'Volunteer assigned to this booking.' };
    return res.redirect(`/coordinator/bookings/${bookingId}`);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getQueue,
  getBookingDetail,
  postAssign,
  parseBookingId,
  parseView,
  parsePage,
  buildQueryString,
  VIEW_LABELS,
};
