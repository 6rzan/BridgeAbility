'use strict';

const catalogueService = require('../services/catalogueService');
const serviceRepository = require('../data/mysql/serviceRepository');
const { serviceSearchSchema, CATEGORIES, SORT_OPTIONS } = require('../validation/serviceSchemas');
const { fieldErrors } = require('../validation/authSchemas');

function buildQueryString(criteria, overrides = {}) {
  const merged = { ...criteria, ...overrides };
  const params = new URLSearchParams();

  for (const key of ['q', 'category', 'location', 'maxPrice', 'sort', 'page']) {
    const value = merged[key];
    if (value === null || value === undefined || value === '') continue;

    if (key === 'sort' && value === 'relevance') continue;
    if (key === 'page' && value === 1) continue;
    params.set(key, String(value));
  }

  const queryString = params.toString();
  return queryString ? `?${queryString}` : '';
}

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
