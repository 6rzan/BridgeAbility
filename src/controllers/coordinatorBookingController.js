'use strict';

const coordinatorBookingService = require('../services/coordinatorBookingService');
const assignmentRepository = require('../data/mysql/assignmentRepository');
const { assignmentCreateSchema, completionUpdateSchema, COMPLETION_LABELS } = require('../validation/assignmentSchemas');
const { fieldErrors } = require('../validation/authSchemas');

const DEFAULT_VIEW = 'awaiting';

const VIEW_LABELS = {
  awaiting: 'Awaiting assignment',
  assigned: 'Assigned',
  completed: 'Completed',
};

function parseBookingId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseView(raw) {
  return assignmentRepository.VIEWS.includes(raw) ? raw : DEFAULT_VIEW;
}

function parsePage(raw) {
  const page = Number.parseInt(raw, 10);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function buildQueryString(view, { page } = {}) {
  const params = new URLSearchParams();
  if (view && view !== DEFAULT_VIEW) params.set('view', view);
  if (page && page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `?${query}` : '';
}

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

function detailViewModel(result, overrides = {}) {
  return {
    title: `Booking #${result.booking.booking_id}`,
    booking: result.booking,
    timeline: result.timeline,
    timelineAvailable: result.timelineAvailable,
    values: { volunteerName: '', volunteerContact: '' },
    errors: {},
    completionValues: {
      completionStatus: result.booking.completion_status || 'pending',
      completionNotes: result.booking.completion_notes || '',
    },
    completionErrors: {},
    completionLabels: COMPLETION_LABELS,
    ...overrides,
  };
}

async function getBookingDetail(req, res, next) {
  try {
    const bookingId = parseBookingId(req.params.id);
    if (!bookingId) return next();

    const result = await coordinatorBookingService.findDetail(bookingId);
    if (!result) return next();

    return res.render('coordinator/bookings/detail', detailViewModel(result));
  } catch (error) {
    return next(error);
  }
}

async function postAssign(req, res, next) {
  try {
    const bookingId = parseBookingId(req.params.id);
    if (!bookingId) return next();

    const parsed = assignmentCreateSchema.safeParse(req.body);

    if (!parsed.success) {
      const result = await coordinatorBookingService.findDetail(bookingId);
      if (!result) return next();

      return res.status(422).render('coordinator/bookings/detail', detailViewModel(result, {
        values: {
          volunteerName: req.body.volunteerName || '',
          volunteerContact: req.body.volunteerContact || '',
        },
        errors: fieldErrors(parsed.error),
      }));
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

async function postUpdateCompletion(req, res, next) {
  try {
    const bookingId = parseBookingId(req.params.id);
    if (!bookingId) return next();

    const parsed = completionUpdateSchema.safeParse(req.body);

    if (!parsed.success) {
      const result = await coordinatorBookingService.findDetail(bookingId);
      if (!result) return next();

      return res.status(422).render('coordinator/bookings/detail', detailViewModel(result, {
        completionValues: {
          completionStatus: req.body.completionStatus || 'pending',
          completionNotes: req.body.completionNotes || '',
        },
        completionErrors: fieldErrors(parsed.error),
      }));
    }

    const actor = { id: req.session.user.id, name: req.session.user.name };
    const result = await coordinatorBookingService.updateCompletion({
      bookingId,
      actor,
      ...parsed.data,
    });

    if (result.outcome === 'not-found') return next();

    if (result.outcome === 'already-completed') {
      req.session.flash = {
        type: 'error',
        message: 'This booking was already marked completed -- no change was made.',
      };
      return res.redirect(`/coordinator/bookings/${bookingId}`);
    }

    req.session.flash = {
      type: 'success',
      message: `Marked ${COMPLETION_LABELS[result.outcome].toLowerCase()}.`,
    };
    return res.redirect(`/coordinator/bookings/${bookingId}`);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getQueue,
  getBookingDetail,
  postAssign,
  postUpdateCompletion,
  parseBookingId,
  parseView,
  parsePage,
  buildQueryString,
  VIEW_LABELS,
};
