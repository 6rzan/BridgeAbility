'use strict';

const catalogueService = require('../services/catalogueService');
const serviceRepository = require('../data/mysql/serviceRepository');
const { serviceSearchSchema, CATEGORIES, SORT_OPTIONS } = require('../validation/serviceSchemas');
const { fieldErrors } = require('../validation/authSchemas');

/**
 * F1 — search and browse verified listings.
 *
 * WHY THIS PAGE IS NOT BEHIND A ROLE GUARD
 *
 * The catalogue is deliberately public. Someone deciding whether to create an account has to
 * be able to see what is on offer first, and requiring sign-in to read a list of services
 * would be a barrier with no security benefit -- there is nothing here that is not intended
 * to be published. The access control that matters on this page is in the query itself: only
 * an active listing from an administrator-approved provider is ever selected, which is
 * enforced in serviceRepository and cannot be bypassed by any URL.
 *
 * Acting on a listing is a different matter. Submitting a booking (F2) is requester-only and
 * carries its own server-side guard.
 */

/** Rebuild the query string from the validated criteria, so links carry the current filters. */
function buildQueryString(criteria, overrides = {}) {
  const merged = { ...criteria, ...overrides };
  const params = new URLSearchParams();

  for (const key of ['q', 'category', 'location', 'maxPrice', 'sort', 'page']) {
    const value = merged[key];
    if (value === null || value === undefined || value === '') continue;
    // The defaults are implied by their absence, which keeps a shared URL short and readable.
    if (key === 'sort' && value === 'relevance') continue;
    if (key === 'page' && value === 1) continue;
    params.set(key, String(value));
  }

  const queryString = params.toString();
  return queryString ? `?${queryString}` : '';
}

/** A short sentence naming the filters in force, for the results heading and screen readers. */
function describeFilters(criteria) {
  const parts = [];
  if (criteria.q) parts.push(`matching “${criteria.q}”`);
  if (criteria.category) parts.push(`in ${criteria.category}`);
  if (criteria.location) parts.push(`in ${criteria.location}`);
  if (criteria.maxPrice) parts.push(`up to RM ${Number(criteria.maxPrice).toFixed(2)}`);
  return parts.join(', ');
}

async function getServices(req, res, next) {
  const parsed = serviceSearchSchema.safeParse(req.query);

  // A malformed filter is the user's typo or a broken link, not a server fault. Fall back to
  // an unfiltered catalogue and say why, rather than showing an error page with no listings.
  const criteria = parsed.success
    ? parsed.data
    : serviceSearchSchema.parse({});
  const errors = parsed.success ? {} : fieldErrors(parsed.error);

  try {
    const [{ services, pagination }, locations] = await Promise.all([
      catalogueService.search(criteria),
      serviceRepository.listVisibleLocations(),
    ]);

    const model = {
      title: 'Find services',
      services,
      pagination,
      criteria,
      errors,
      locations,
      categories: CATEGORIES,
      sortOptions: SORT_OPTIONS,
      filterSummary: describeFilters(criteria),
      buildQueryString: (overrides) => buildQueryString(criteria, overrides),
      pageScript: 'service-search.js',
    };

    // The enhanced page asks for just the results region and swaps it in. Rendering the same
    // partial the full page uses means the two can never disagree about how a listing looks.
    if (req.query.partial === 'results') {
      return res.render('services/_results', model);
    }

    return res.render('services/index', model);
  } catch (error) {
    return next(error);
  }
}

async function getServiceDetail(req, res, next) {
  const serviceId = Number(req.params.id);

  if (!Number.isInteger(serviceId) || serviceId < 1) {
    return next(Object.assign(new Error('That listing does not exist.'), { statusCode: 404 }));
  }

  try {
    const service = await catalogueService.findVisibleService(serviceId);

    // Same answer for "no such listing" and "not public", on purpose. See the repository.
    if (!service) {
      return next(Object.assign(new Error('That listing does not exist.'), { statusCode: 404 }));
    }

    return res.render('services/detail', {
      title: service.title,
      service,
      availability: catalogueService.parseAvailability(service.availability_json),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { getServices, getServiceDetail, buildQueryString, describeFilters };
