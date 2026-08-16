'use strict';

const crypto = require('node:crypto');

const bookingService = require('../services/bookingService');
const catalogueService = require('../services/catalogueService');
const { fieldErrors } = require('../validation/authSchemas');
const {
  bookingCreateSchema,
  bookingListSchema,
  earliestBookableLocal,
  STATUS_LABELS,
  STATUSES,
} = require('../validation/bookingSchemas');

/**
 * The requester booking flow (F2).
 *
 * Every route here is mounted behind requireRole('requester') and every query is keyed on
 * req.session.user.id. The session is the only source of the requester identity -- no route
 * takes a requester id from the URL or the body, so there is no parameter to tamper with.
 */

/** A page number can arrive from a link, so it is validated like anything else. */
function parsePage(raw) {
  const page = Number.parseInt(raw, 10);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

/** Preserve the active filter across pagination links. */
function buildQueryString(status, { page } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (page && page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** GET /services/:id/book -- the request form for one listing. */
async function getBookingForm(req, res, next) {
  try {
    const service = await catalogueService.findVisibleService(req.params.id);

    if (!service) {
      return next();
    }

    return res.render('bookings/new', {
      title: `Request ${service.title}`,
      service,
      values: { requestedDatetime: '', notes: '' },
      errors: {},
      // One key per rendering of the form. Two submissions of this page carry the same key and
      // the UNIQUE index on bookings.request_key collapses them into one booking.
      requestKey: crypto.randomUUID(),
      earliest: earliestBookableLocal(),
      pageScript: 'form-validate.js',
    });
  } catch (error) {
    return next(error);
  }
}

/** POST /bookings -- submit the request. */
async function postBooking(req, res, next) {
  try {
    const parsed = bookingCreateSchema.safeParse(req.body);

    if (!parsed.success) {
      const service = await catalogueService.findVisibleService(req.body.serviceId);

      if (!service) {
        return next();
      }

      return res.status(422).render('bookings/new', {
        title: `Request ${service.title}`,
        service,
        values: {
          requestedDatetime: req.body.requestedDatetime || '',
          notes: req.body.notes || '',
        },
        errors: fieldErrors(parsed.error),
        // Reuse the key from the rejected submission: a correction is the same intent, so it
        // must not be able to produce two bookings if the form was also open in another tab.
        requestKey: typeof req.body.requestKey === 'string' && req.body.requestKey
          ? req.body.requestKey
          : crypto.randomUUID(),
        earliest: earliestBookableLocal(),
        pageScript: 'form-validate.js',
      });
    }

    const requester = { id: req.session.user.id, name: req.session.user.name };
    const result = await bookingService.submit({ criteria: parsed.data, requester });

    if (result.outcome === 'unavailable') {
      req.session.flash = {
        type: 'error',
        message: 'That service is no longer available, so the request was not sent.',
      };
      return res.redirect('/services');
    }

    req.session.flash = result.outcome === 'duplicate'
      ? { type: 'info', message: 'This request had already been sent -- here it is.' }
      : { type: 'success', message: 'Request sent. The provider will respond to it here.' };

    return res.redirect(`/bookings/${result.bookingId}`);
  } catch (error) {
    return next(error);
  }
}

/** GET /bookings -- everything this requester has asked for. */
async function getBookings(req, res, next) {
  try {
    const parsed = bookingListSchema.safeParse(req.query);

    if (!parsed.success) {
      // An unknown status is a broken link or a hand-edited URL, not a filter. Fall back to
      // the unfiltered list rather than showing an error page for a query string.
      return res.redirect('/bookings');
    }

    const { status } = parsed.data;
    const page = parsePage(req.query.page);

    const { bookings, pagination, counts, total } = await bookingService.listForRequester(
      req.session.user.id,
      { status, page }
    );

    return res.render('bookings/index', {
      title: 'My bookings',
      bookings,
      pagination,
      counts,
      total,
      status,
      statuses: STATUSES,
      statusLabels: STATUS_LABELS,
      buildQueryString: (overrides) => buildQueryString(status, overrides),
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /bookings/:id -- one booking, its status and its history.
 *
 * A booking belonging to someone else is a 404, not a 403. Answering "forbidden" would confirm
 * that booking 5 exists and belongs to another person, which is information the requester is
 * not entitled to.
 */
async function getBookingDetail(req, res, next) {
  try {
    const result = await bookingService.findForRequester(req.params.id, req.session.user.id);

    if (!result) {
      return next();
    }

    return res.render('bookings/detail', {
      title: `Booking #${result.booking.booking_id}`,
      booking: result.booking,
      timeline: result.timeline,
      timelineAvailable: result.timelineAvailable,
    });
  } catch (error) {
    return next(error);
  }
}

/** POST /bookings/:id/cancel -- withdraw a request the provider has not answered. */
async function postCancel(req, res, next) {
  try {
    const requester = { id: req.session.user.id, name: req.session.user.name };
    const result = await bookingService.cancel({ bookingId: req.params.id, requester });

    if (result.outcome === 'not-found') {
      return next();
    }

    req.session.flash = result.outcome === 'cancelled'
      ? { type: 'success', message: 'Request cancelled. The provider will no longer see it.' }
      : {
        type: 'error',
        message: `This request can no longer be cancelled -- it is now ${STATUS_LABELS[result.status].toLowerCase()}.`,
      };

    return res.redirect(`/bookings/${req.params.id}`);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getBookingForm,
  postBooking,
  getBookings,
  getBookingDetail,
  postCancel,
  buildQueryString,
  parsePage,
};
