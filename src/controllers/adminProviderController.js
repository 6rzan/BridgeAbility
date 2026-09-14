'use strict';

const adminProviderService = require('../services/adminProviderService');
const {
  adminProviderListSchema,
  PROVIDER_STATUSES,
  PROVIDER_STATUS_LABELS,
} = require('../validation/adminProviderSchemas');





function parseProviderId(raw) {
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


async function postApprove(req, res, next) {
  return postDecision(req, res, next, 'approved');
}


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
