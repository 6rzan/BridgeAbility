'use strict';

const adminProviderService = require('../services/adminProviderService');
const {
  adminProviderListSchema,
  PROVIDER_STATUSES,
  PROVIDER_STATUS_LABELS,
} = require('../validation/adminProviderSchemas');

/**
 * F5 -- an administrator reviews and approves or rejects provider registrations.
 *
 * Every route is mounted behind requireRole('admin'). There is no per-row ownership here: any
 * administrator may review any provider, so unlike the provider- and requester-facing
 * controllers, there is no requireX guard resolving an owner before a query runs.
 */

/** A provider id from the URL. Anything that is not a positive integer is simply not one. */
function parseProviderId(raw) {
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

/** GET /admin/providers -- every registration, filterable by review status. */
async function getQueue(req, res, next) {
  try {
    const parsed = adminProviderListSchema.safeParse(req.query);

    if (!parsed.success) {
      return res.redirect('/admin/providers');
    }

    const { status } = parsed.data;
    const page = parsePage(req.query.page);

    const { providers, pagination, counts, total } = await adminProviderService.listQueue({
      status,
      page,
    });

    return res.render('admin/providers/index', {
      title: 'Provider registrations',
      providers,
      pagination,
      counts,
      total,
      status,
      statuses: PROVIDER_STATUSES,
      statusLabels: PROVIDER_STATUS_LABELS,
      buildQueryString: (overrides) => buildQueryString(status, overrides),
    });
  } catch (error) {
    return next(error);
  }
}

/** GET /admin/providers/:id -- one registration, with its verification document. */
async function getProviderDetail(req, res, next) {
  try {
    const providerId = parseProviderId(req.params.id);
    if (!providerId) return next();

    const provider = await adminProviderService.findOne(providerId);
    if (!provider) return next();

    return res.render('admin/providers/detail', {
      title: provider.org_name,
      provider,
    });
  } catch (error) {
    return next(error);
  }
}

/** Shared body for approve/reject: run the decision, flash the outcome, redirect to the detail page. */
async function postDecision(req, res, next, decision) {
  try {
    const providerId = parseProviderId(req.params.id);
    if (!providerId) return next();

    const result = await adminProviderService.review({
      providerId,
      reviewerId: req.session.user.id,
      decision,
    });

    if (result.outcome === 'not-found') return next();

    if (result.outcome === 'not-pending') {
      req.session.flash = {
        type: 'error',
        message: `This registration was already ${PROVIDER_STATUS_LABELS[result.status].toLowerCase()} -- no change was made.`,
      };
      return res.redirect(`/admin/providers/${providerId}`);
    }

    req.session.flash = decision === 'approved'
      ? { type: 'success', message: `${result.orgName} approved. Its listings are now visible to requesters.` }
      : { type: 'success', message: `${result.orgName}'s registration was rejected.` };

    return res.redirect(`/admin/providers/${providerId}`);
  } catch (error) {
    return next(error);
  }
}

/** POST /admin/providers/:id/approve */
async function postApprove(req, res, next) {
  return postDecision(req, res, next, 'approved');
}

/** POST /admin/providers/:id/reject */
async function postReject(req, res, next) {
  return postDecision(req, res, next, 'rejected');
}

module.exports = {
  getQueue,
  getProviderDetail,
  postApprove,
  postReject,
  parseProviderId,
  parsePage,
  buildQueryString,
};
