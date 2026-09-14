'use strict';

require('../helpers/env');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  serviceSearchSchema,
  escapeLikeTerm,
  SORT_OPTIONS,
} = require('../../src/validation/serviceSchemas');
const { paginate, parseAvailability } = require('../../src/services/catalogueService');
const { buildQueryString, describeFilters } = require('../../src/controllers/serviceController');



test('an empty query string produces an unfiltered first page', () => {
  const criteria = serviceSearchSchema.parse({});

  assert.deepEqual(criteria, {
    q: null, category: null, location: null, maxPrice: null, sort: 'relevance', page: 1,
  });
});


test('a blank filter is treated as absent, not as a value to match', () => {
  const criteria = serviceSearchSchema.parse({ q: '   ', category: '', location: '', maxPrice: '' });

  assert.equal(criteria.q, null);
  assert.equal(criteria.category, null);
  assert.equal(criteria.location, null);
  assert.equal(criteria.maxPrice, null);
});

test('numbers arrive from the query string as text and are coerced', () => {
  const criteria = serviceSearchSchema.parse({ maxPrice: '150.50', page: '3' });

  assert.equal(criteria.maxPrice, 150.5);
  assert.equal(criteria.page, 3);
});


test('an unknown sort key is rejected rather than passed through', () => {
  const result = serviceSearchSchema.safeParse({ sort: 's.price; DROP TABLE services' });
  assert.equal(result.success, false);
});

test('every sort key maps to a fragment we control', () => {
  for (const [key, option] of Object.entries(SORT_OPTIONS)) {
    assert.equal(serviceSearchSchema.parse({ sort: key }).sort, key);
    assert.match(option.sql, /^s\.[a-z_]+ (ASC|DESC)/, `${key} must order by a known column`);
  }
});

test('an unknown category is rejected', () => {
  assert.equal(serviceSearchSchema.safeParse({ category: 'nonsense' }).success, false);
});

test('a nonsensical page or price is rejected rather than silently clamped', () => {
  assert.equal(serviceSearchSchema.safeParse({ page: '0' }).success, false);
  assert.equal(serviceSearchSchema.safeParse({ page: '-4' }).success, false);
  assert.equal(serviceSearchSchema.safeParse({ maxPrice: '-1' }).success, false);
});




test('LIKE wildcards in a search term are escaped', () => {
  assert.equal(escapeLikeTerm('100%'), '100\\%');
  assert.equal(escapeLikeTerm('a_b'), 'a\\_b');
  assert.equal(escapeLikeTerm('back\\slash'), 'back\\\\slash');
  assert.equal(escapeLikeTerm('interpreter'), 'interpreter');
});



test('pagination reports the range being shown', () => {
  const page = paginate(20, 2, 6);

  assert.equal(page.totalPages, 4);
  assert.equal(page.currentPage, 2);
  assert.equal(page.offset, 6);
  assert.equal(page.firstOnPage, 7);
  assert.equal(page.lastOnPage, 12);
  assert.equal(page.hasPrevious, true);
  assert.equal(page.hasNext, true);
});

test('the last page reports only the items it actually holds', () => {
  const page = paginate(20, 4, 6);

  assert.equal(page.firstOnPage, 19);
  assert.equal(page.lastOnPage, 20);
  assert.equal(page.hasNext, false);
});


test('a page past the end is clamped to the last real page', () => {
  const page = paginate(20, 99, 6);

  assert.equal(page.currentPage, 4);
  assert.equal(page.offset, 18);
});

test('no results still yields one page and a zero range', () => {
  const page = paginate(0, 1, 6);

  assert.equal(page.totalPages, 1);
  assert.equal(page.firstOnPage, 0);
  assert.equal(page.lastOnPage, 0);
  assert.equal(page.hasNext, false);
  assert.equal(page.hasPrevious, false);
});



test('the query string carries the active filters and omits the defaults', () => {
  const criteria = serviceSearchSchema.parse({ category: 'transport', q: 'ramp' });

  const link = buildQueryString(criteria, { page: 2 });

  assert.match(link, /category=transport/);
  assert.match(link, /q=ramp/);
  assert.match(link, /page=2/);

  assert.doesNotMatch(link, /sort=relevance/);
});

test('an unfiltered first page produces no query string at all', () => {
  assert.equal(buildQueryString(serviceSearchSchema.parse({}), {}), '');
  assert.equal(buildQueryString(serviceSearchSchema.parse({}), { page: 1 }), '');
});

test('the filter summary names the filters in force', () => {
  const criteria = serviceSearchSchema.parse({ category: 'transport', location: 'Klang', maxPrice: '200' });
  const summary = describeFilters(criteria);

  assert.match(summary, /transport/);
  assert.match(summary, /Klang/);
  assert.match(summary, /200\.00/);
});



test('availability is read from an object or a JSON string', () => {
  const expected = { days: ['Mon', 'Tue'], hours: '09:00-17:00' };

  assert.deepEqual(parseAvailability({ days: ['Mon', 'Tue'], hours: '09:00-17:00' }), expected);
  assert.deepEqual(parseAvailability('{"days":["Mon","Tue"],"hours":"09:00-17:00"}'), expected);
});


test('unreadable availability yields null instead of throwing', () => {
  for (const value of [null, undefined, '', 'not json', '{}', '{"days":"Mon"}']) {
    assert.equal(parseAvailability(value), null, JSON.stringify(value));
  }
});
