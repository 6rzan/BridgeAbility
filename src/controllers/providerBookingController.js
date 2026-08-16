'use strict';

const providerListingService = require('../services/providerListingService');
const providerBookingService = require('../services/providerBookingService');
const { bookingListSchema, STATUS_LABELS, STATUSES } = require('../validation/bookingSchemas');

/**
 * F4 -- a provider accepts or rejects incoming booking requests.
 *
 * Every route below is mounted behind requireRole('provider') and every one of them resolves
 * the provider record from req.session.user.id before it touches a booking, the same shape as
 * providerServiceController (F3). A request against a listing this provider does not own is
 * answered 404, not 403, for the same reason as everywhere else in the application:
 * "forbidden" would confirm the booking exists and belongs to a competitor.
 */

/** Resolve the signed-in user's provider record, or hand back a 403 for an account with none. */
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

/** A booking id from the URL. Anything that is not a positive integer is simply not a booking. */
function parseBookingId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

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

/** GET /provider/bookings -- everything requested against this organisation's listings. */
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

/** GET /provider/bookings/:id -- one request and its history. */
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

/** Shared body for accept/reject: run the decision, flash the outcome, redirect to the detail page. */
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

/** POST /provider/bookings/:id/accept */
async function postAccept(req, res, next) {
  return postDecision(req, res, next, 'accepted');
}

/** POST /provider/bookings/:id/reject */
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
