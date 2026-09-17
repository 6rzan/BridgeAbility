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

function parsePage(raw) {
  const page = Number.parseInt(raw, 10);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function buildQueryString(status, { page } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (page && page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `?${query}` : '';
}

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

      requestKey: crypto.randomUUID(),
      earliest: earliestBookableLocal(),
      pageScript: 'form-validate.js',
    });
  } catch (error) {
    return next(error);
  }
}

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

async function getBookings(req, res, next) {
  try {
    const parsed = bookingListSchema.safeParse(req.query);

    if (!parsed.success) {

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
