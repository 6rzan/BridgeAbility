'use strict';

require('../helpers/env');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  bookingCreateSchema,
  bookingListSchema,
  toMysqlDatetime,
  wallClockEpoch,
  nowWallClockEpoch,
  earliestBookableLocal,
  formatWallClock,
  toDatetimeAttribute,
  toKualaLumpur,
  STATUS_LABELS,
  STATUS_EXPLANATIONS,
  STATUSES,
  CANCELLABLE,
  MAX_LEAD_DAYS,
} = require('../../src/validation/bookingSchemas');
const { paginate } = require('../../src/services/bookingService');
const { buildQueryString, parsePage } = require('../../src/controllers/bookingController');

function futureLocalDatetime(daysAhead = 7) {
  const ahead = nowWallClockEpoch() + daysAhead * 24 * 60 * 60 * 1000;
  return new Date(ahead).toISOString().slice(0, 16);
}

const VALID_KEY = '3f1a6c4e-9d2b-4a77-8e51-0b6c2d9a1f34';

test('a time already past in Malaysia is past, even though it is still ahead on the server clock', () => {

  const now = Date.UTC(2026, 7, 20, 6, 45);
  const typedThisMorning = '2026-08-20T10:00';

  assert.ok(wallClockEpoch(typedThisMorning) < nowWallClockEpoch(now));

  assert.ok(wallClockEpoch(typedThisMorning) > now);
});

test('the form min and the validator read the same clock, so they cannot disagree', () => {
  const now = Date.UTC(2026, 7, 20, 6, 45);

  assert.equal(earliestBookableLocal(now), '2026-08-20T14:45');
  assert.equal(wallClockEpoch(earliestBookableLocal(now)), nowWallClockEpoch(now));
});

test('a DATETIME is shown as the wall clock that was typed, not shifted again', () => {

  const fromMysql = new Date(Date.UTC(2026, 7, 20, 14, 30));

  assert.match(formatWallClock(fromMysql), /20 August 2026/);
  assert.match(formatWallClock(fromMysql), /14:30/);
  assert.equal(toDatetimeAttribute(fromMysql), '2026-08-20T14:30');
});

test('a real UTC instant is moved onto the Malaysian clock before it is shown', () => {
  const instant = new Date('2026-08-20T06:45:00Z');

  assert.match(formatWallClock(toKualaLumpur(instant)), /14:45/);

  assert.match(formatWallClock(instant), /06:45/);
});

test('a null timestamp formats to nothing rather than to 1 January 1970', () => {

  assert.equal(formatWallClock(null), '');
  assert.equal(toDatetimeAttribute(null), '');
  assert.equal(toKualaLumpur(null), null);
});

test('a well-formed request parses, and blank notes become null rather than an empty string', () => {
  const parsed = bookingCreateSchema.parse({
    serviceId: '4',
    requestedDatetime: futureLocalDatetime(),
    notes: '   ',
    requestKey: VALID_KEY,
  });

  assert.equal(parsed.serviceId, 4);
  assert.equal(parsed.notes, null);
});

test('a booking in the past is rejected', () => {
  const yesterday = new Date(nowWallClockEpoch() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
  const result = bookingCreateSchema.safeParse({
    serviceId: 4,
    requestedDatetime: yesterday,
    notes: null,
    requestKey: VALID_KEY,
  });

  assert.equal(result.success, false);
});

test('a couple of minutes of clock drift is tolerated', () => {
  const twoMinutesAgo = new Date(nowWallClockEpoch() - 2 * 60 * 1000).toISOString().slice(0, 16);
  const result = bookingCreateSchema.safeParse({
    serviceId: 4,
    requestedDatetime: twoMinutesAgo,
    notes: null,
    requestKey: VALID_KEY,
  });

  assert.equal(result.success, true);
});

test('a date beyond the lead-time limit is rejected, because a typo in the year is likelier', () => {
  const result = bookingCreateSchema.safeParse({
    serviceId: 4,
    requestedDatetime: futureLocalDatetime(MAX_LEAD_DAYS + 1),
    notes: null,
    requestKey: VALID_KEY,
  });

  assert.equal(result.success, false);
});

test('a datetime that is not the format the input posts is rejected', () => {
  for (const value of ['20-08-2026 14:30', '2026-08-20', 'tomorrow', '']) {
    const result = bookingCreateSchema.safeParse({
      serviceId: 4,
      requestedDatetime: value,
      notes: null,
      requestKey: VALID_KEY,
    });
    assert.equal(result.success, false, `${value} must not parse`);
  }
});

test('a request key that is not a uuid is rejected', () => {
  const result = bookingCreateSchema.safeParse({
    serviceId: 4,
    requestedDatetime: futureLocalDatetime(),
    notes: null,
    requestKey: 'not-a-uuid',
  });

  assert.equal(result.success, false);
});

test('a service id that is not a positive integer is rejected', () => {
  for (const value of ['0', '-3', 'abc', '2.5']) {
    const result = bookingCreateSchema.safeParse({
      serviceId: value,
      requestedDatetime: futureLocalDatetime(),
      notes: null,
      requestKey: VALID_KEY,
    });
    assert.equal(result.success, false, `${value} must not parse`);
  }
});

test('notes longer than the column allows are rejected before they reach MySQL', () => {
  const result = bookingCreateSchema.safeParse({
    serviceId: 4,
    requestedDatetime: futureLocalDatetime(),
    notes: 'x'.repeat(1001),
    requestKey: VALID_KEY,
  });

  assert.equal(result.success, false);
});

test('no status filter means all bookings, not a filter on the empty string', () => {
  assert.equal(bookingListSchema.parse({}).status, null);
  assert.equal(bookingListSchema.parse({ status: '' }).status, null);
});

test('every real status is accepted and anything else is not', () => {
  for (const status of STATUSES) {
    assert.equal(bookingListSchema.parse({ status }).status, status);
  }

  assert.equal(bookingListSchema.safeParse({ status: 'deleted' }).success, false);
});

test('a page number in the query string does not fail the status filter', () => {
  assert.equal(bookingListSchema.safeParse({ status: 'pending', page: '2' }).success, true);
});

test('every status has a label and a plain-language explanation', () => {
  for (const status of STATUSES) {
    assert.equal(typeof STATUS_LABELS[status], 'string');
    assert.ok(STATUS_LABELS[status].length > 0, `${status} needs a label`);
    assert.ok(STATUS_EXPLANATIONS[status].length > 0, `${status} needs an explanation`);
  }
});

test('only a pending booking can be cancelled by the requester', () => {
  assert.ok(CANCELLABLE.has('pending'));

  for (const status of STATUSES.filter((value) => value !== 'pending')) {
    assert.equal(CANCELLABLE.has(status), false, `${status} must not be cancellable`);
  }
});

test('an empty list is one page and reports no results', () => {
  const page = paginate(0, 1);

  assert.equal(page.totalPages, 1);
  assert.equal(page.currentPage, 1);
  assert.equal(page.firstOnPage, 0);
  assert.equal(page.hasPrevious, false);
  assert.equal(page.hasNext, false);
});

test('the middle page reports the right window and both neighbours', () => {
  const page = paginate(20, 2, 8);

  assert.equal(page.totalPages, 3);
  assert.equal(page.offset, 8);
  assert.equal(page.firstOnPage, 9);
  assert.equal(page.lastOnPage, 16);
  assert.equal(page.hasPrevious, true);
  assert.equal(page.hasNext, true);
});

test('the last page never claims more results than exist', () => {
  const page = paginate(17, 3, 8);

  assert.equal(page.firstOnPage, 17);
  assert.equal(page.lastOnPage, 17);
  assert.equal(page.hasNext, false);
});

test('a page number outside the range is clamped into it', () => {
  assert.equal(paginate(20, 99, 8).currentPage, 3);
  assert.equal(paginate(20, 0, 8).currentPage, 1);
  assert.equal(paginate(20, -5, 8).offset, 0);
});

test('a page number that is not a number at all falls back to the first page', () => {
  assert.equal(parsePage('3'), 3);
  assert.equal(parsePage('abc'), 1);
  assert.equal(parsePage('0'), 1);
  assert.equal(parsePage('-2'), 1);
  assert.equal(parsePage(undefined), 1);
});

test('the active filter is carried across the pagination links', () => {
  assert.equal(buildQueryString('pending', { page: 3 }), '?status=pending&page=3');
  assert.equal(buildQueryString('pending', {}), '?status=pending');
});

test('the first page and no filter produce a bare url', () => {
  assert.equal(buildQueryString(null, {}), '');
  assert.equal(buildQueryString(null, { page: 1 }), '');
});
