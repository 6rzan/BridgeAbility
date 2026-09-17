'use strict';

const providerListingService = require('../services/providerListingService');
const providerBookingService = require('../services/providerBookingService');
const { bookingListSchema, STATUS_LABELS, STATUSES } = require('../validation/bookingSchemas');

async function requireProvider(req, next) {
  const provider = await providerListingService.findProvider(req.session.user.id);

  if (!provider) {
    const error = new Error('Your account is not linked to an organisation.');
    error.statusCode = 403;
    next(error);
    return null;
  }

  return provider;
}

function parseBookingId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

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

async function getIncomingQueue(req, res, next) {
  try {
    const provider = await requireProvider(req, next);
    if (!provider) return undefined;

    const parsed = bookingListSchema.safeParse(req.query);

    if (!parsed.success) {
      return res.redirect('/provider/bookings');
    }

    const { status } = parsed.data;
    const page = parsePage(req.query.page);

    const { bookings, pagination, counts, total } = await providerBookingService.listIncoming(
      provider.provider_id,
      { status, page }
    );

    return res.render('provider/bookings/index', {
      title: 'Incoming requests',
      provider,
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
    const provider = await requireProvider(req, next);
    if (!provider) return undefined;

    const bookingId = parseBookingId(req.params.id);
    if (!bookingId) return next();

    const result = await providerBookingService.findForProvider(bookingId, provider.provider_id);
    if (!result) return next();

    return res.render('provider/bookings/detail', {
      title: `Request #${result.booking.booking_id}`,
      booking: result.booking,
      timeline: result.timeline,
      timelineAvailable: result.timelineAvailable,
    });
  } catch (error) {
    return next(error);
  }
}

async function postDecision(req, res, next, decision) {
  try {
    const provider = await requireProvider(req, next);
    if (!provider) return undefined;

    const bookingId = parseBookingId(req.params.id);
    if (!bookingId) return next();

    const actor = { id: req.session.user.id, name: req.session.user.name };
    const result = await providerBookingService.decide({ bookingId, provider, actor, decision });

    if (result.outcome === 'not-found') return next();

    if (result.outcome === 'not-pending') {
      req.session.flash = {
        type: 'error',
        message: `This request was already ${STATUS_LABELS[result.status].toLowerCase()} -- no change was made.`,
      };
      return res.redirect(`/provider/bookings/${bookingId}`);
    }

    req.session.flash = decision === 'accepted'
      ? { type: 'success', message: 'Request accepted. The requester has been told.' }
      : { type: 'success', message: 'Request declined. The requester has been told.' };

    return res.redirect(`/provider/bookings/${bookingId}`);
  } catch (error) {
    return next(error);
  }
}

async function postAccept(req, res, next) {
  return postDecision(req, res, next, 'accepted');
}

async function postReject(req, res, next) {
  return postDecision(req, res, next, 'rejected');
}

module.exports = {
  getIncomingQueue,
  getBookingDetail,
  postAccept,
  postReject,
  parseBookingId,
  parsePage,
  buildQueryString,
};
