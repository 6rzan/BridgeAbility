'use strict';

require('../helpers/env');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  listingSchema,
  uploadRequestSchema,
  imageConfirmSchema,
  buildImageKey,
  isOwnedImageKey,
  toAvailabilityJson,
  CATEGORY_LABELS,
  DAYS,
} = require('../../src/validation/providerServiceSchemas');
const {
  decorate,
  toColumns,
} = require('../../src/services/providerListingService');
const {
  submittedValues,
  listingToValues,
  parseServiceId,
} = require('../../src/controllers/providerServiceController');


function validListing(overrides = {}) {
  return {
    title: 'Wheelchair-accessible airport transfer',
    category: 'transport',
    description: 'Ramp-equipped van with securement straps, door to door, KLIA and Subang.',
    price: '150.00',
    location: 'Kuala Lumpur',
    days: ['Mon', 'Wed'],
    hours: '09:00-17:00',
    ...overrides,
  };
}



test('a complete listing is accepted and its price becomes a number', () => {
  const parsed = listingSchema.safeParse(validListing());

  assert.equal(parsed.success, true);
  assert.equal(parsed.data.price, 150);
  assert.equal(parsed.data.title, 'Wheelchair-accessible airport transfer');
  assert.deepEqual(parsed.data.days, ['Mon', 'Wed']);
});

test('provider_id and is_active cannot be set from the form', () => {
  const parsed = listingSchema.safeParse(validListing({ provider_id: 99, is_active: 0 }));

  assert.equal(parsed.success, true);

  assert.equal('provider_id' in parsed.data, false);
  assert.equal('is_active' in parsed.data, false);
});

test('a title shorter than eight characters is refused', () => {
  const parsed = listingSchema.safeParse(validListing({ title: 'Van' }));
  assert.equal(parsed.success, false);
  assert.match(parsed.error.issues[0].message, /at least 8/);
});

test('a category outside the five is refused', () => {
  const parsed = listingSchema.safeParse(validListing({ category: 'plumbing' }));
  assert.equal(parsed.success, false);
});

test('a blank description is refused with a message, not a type error', () => {
  const parsed = listingSchema.safeParse(validListing({ description: '   ' }));
  assert.equal(parsed.success, false);
  assert.match(parsed.error.issues[0].message, /Describe/);
});

test('a negative price is refused and zero is accepted', () => {
  assert.equal(listingSchema.safeParse(validListing({ price: '-5' })).success, false);
  assert.equal(listingSchema.safeParse(validListing({ price: '0' })).success, true);
});

test('a price with three decimal places is refused rather than rounded', () => {

  const parsed = listingSchema.safeParse(validListing({ price: '150.555' }));
  assert.equal(parsed.success, false);
  assert.match(parsed.error.issues[0].message, /two decimal places/);
});

test('a price that is not a number is refused', () => {
  assert.equal(listingSchema.safeParse(validListing({ price: 'free' })).success, false);
});



test('a single ticked day arrives as a string and is still read as a list', () => {

  const parsed = listingSchema.safeParse(validListing({ days: 'Sat' }));

  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data.days, ['Sat']);
});

test('no availability at all is accepted', () => {
  const parsed = listingSchema.safeParse(validListing({ days: undefined, hours: '' }));

  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data.days, []);
  assert.equal(parsed.data.hours, null);
});

test('hours without days are refused, and the error is put on the days field', () => {
  const parsed = listingSchema.safeParse(validListing({ days: undefined }));

  assert.equal(parsed.success, false);

  assert.deepEqual(parsed.error.issues[0].path, ['days']);
});

test('hours outside a 24-hour range are refused', () => {
  assert.equal(listingSchema.safeParse(validListing({ hours: '9am-5pm' })).success, false);
  assert.equal(listingSchema.safeParse(validListing({ hours: '25:00-26:00' })).success, false);
  assert.equal(listingSchema.safeParse(validListing({ hours: '00:00-23:59' })).success, true);
});

test('days are stored in week order, not the order the boxes posted in', () => {

  const json = toAvailabilityJson({ days: ['Fri', 'Mon', 'Wed'], hours: '09:00-17:00' });

  assert.deepEqual(JSON.parse(json), { days: ['Mon', 'Wed', 'Fri'], hours: '09:00-17:00' });
});

test('no days means no availability document at all', () => {
  assert.equal(toAvailabilityJson({ days: [], hours: null }), null);
});

test('the stored availability shape is the one the public detail page reads', () => {

  const { parseAvailability } = require('../../src/services/catalogueService');
  const json = toAvailabilityJson({ days: ['Sat', 'Sun'], hours: null });

  assert.deepEqual(parseAvailability(json), { days: ['Sat', 'Sun'], hours: null });
});



test('only the three image types are accepted', () => {
  for (const contentType of ['image/jpeg', 'image/png', 'image/webp']) {
    assert.equal(
      uploadRequestSchema.safeParse({ contentType, contentLength: 1024 }).success,
      true,
      contentType
    );
  }


  for (const contentType of ['image/svg+xml', 'application/pdf', 'text/html']) {
    assert.equal(
      uploadRequestSchema.safeParse({ contentType, contentLength: 1024 }).success,
      false,
      contentType
    );
  }
});

test('an empty file and an oversized file are both refused', () => {
  assert.equal(
    uploadRequestSchema.safeParse({ contentType: 'image/png', contentLength: 0 }).success,
    false
  );
  assert.equal(
    uploadRequestSchema.safeParse({ contentType: 'image/png', contentLength: 50 * 1024 * 1024 }).success,
    false
  );
});



const UUID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

test('an image key is derived from the provider and the listing', () => {
  const key = buildImageKey({
    providerId: 1,
    serviceId: 4,
    contentType: 'image/jpeg',
    unique: UUID,
  });

  assert.equal(key, `services/provider-1/service-4/${UUID}.jpg`);
});

test('a key minted for a listing is accepted for that listing', () => {
  const key = buildImageKey({
    providerId: 1,
    serviceId: 4,
    contentType: 'image/webp',
    unique: UUID,
  });

  assert.equal(isOwnedImageKey(key, { providerId: 1, serviceId: 4 }), true);
});

test('a key naming another provider or another listing is rejected', () => {

  const key = buildImageKey({
    providerId: 2,
    serviceId: 9,
    contentType: 'image/jpeg',
    unique: UUID,
  });

  assert.equal(isOwnedImageKey(key, { providerId: 1, serviceId: 4 }), false);
  assert.equal(isOwnedImageKey(key, { providerId: 2, serviceId: 4 }), false);
  assert.equal(isOwnedImageKey(key, { providerId: 1, serviceId: 9 }), false);
});

test('a traversal or a wrong extension in a key is rejected', () => {
  for (const key of [
    'services/provider-1/service-4/../../../etc/passwd',
    `services/provider-1/service-4/${UUID}.svg`,
    `services/provider-1/service-4/${UUID}.jpg.html`,
    `verification/provider-1/service-4/${UUID}.jpg`,
    `services/provider-1/service-4/${UUID}`,
  ]) {
    assert.equal(isOwnedImageKey(key, { providerId: 1, serviceId: 4 }), false, key);
  }
});

test('a provider id is matched whole, not as a prefix', () => {

  const key = buildImageKey({
    providerId: 11,
    serviceId: 4,
    contentType: 'image/jpeg',
    unique: UUID,
  });

  assert.equal(isOwnedImageKey(key, { providerId: 1, serviceId: 4 }), false);
  assert.equal(isOwnedImageKey(key, { providerId: 11, serviceId: 4 }), true);
});



test('an image cannot be attached without alt text', () => {

  const parsed = imageConfirmSchema.safeParse({ key: 'services/provider-1/service-4/x.jpg', altText: '' });

  assert.equal(parsed.success, false);
  assert.match(parsed.error.issues[0].message, /Describe/);
});

test('alt text shorter than ten characters is refused', () => {
  const parsed = imageConfirmSchema.safeParse({
    key: 'services/provider-1/service-4/x.jpg',
    altText: 'a van',
  });
  assert.equal(parsed.success, false);
});

test('real alt text is accepted and trimmed', () => {
  const parsed = imageConfirmSchema.safeParse({
    key: 'services/provider-1/service-4/x.jpg',
    altText: '  Van with a deployed rear access ramp at a kerbside.  ',
  });

  assert.equal(parsed.success, true);
  assert.equal(parsed.data.altText, 'Van with a deployed rear access ramp at a kerbside.');
});



test('a listing with bookings may be withdrawn but not deleted', () => {

  const booked = decorate({
    service_id: 1, title: 'x', category: 'transport', price: '10.00',
    is_active: 1, booking_count: 3, availability_json: null,
  });

  assert.equal(booked.canDelete, false);
  assert.equal(booked.bookingCount, 3);
  assert.equal(booked.isActive, true);
});

test('a listing nobody has booked may be deleted', () => {
  const unbooked = decorate({
    service_id: 2, title: 'x', category: 'other', price: '10.00',
    is_active: 0, booking_count: 0, availability_json: null,
  });

  assert.equal(unbooked.canDelete, true);
  assert.equal(unbooked.isActive, false);
});

test('every category has a label a person can read', () => {
  for (const category of Object.keys(CATEGORY_LABELS)) {
    const decorated = decorate({ category, booking_count: 0, is_active: 1, availability_json: null });
    assert.equal(decorated.categoryLabel, CATEGORY_LABELS[category]);
    assert.notEqual(decorated.categoryLabel, category);
  }
});

test('an unknown category falls back to its stored value rather than showing undefined', () => {
  const decorated = decorate({ category: 'unmapped', booking_count: 0, is_active: 1, availability_json: null });
  assert.equal(decorated.categoryLabel, 'unmapped');
});

test('validated form data becomes exactly the columns the repository writes', () => {
  const parsed = listingSchema.parse(validListing());
  const columns = toColumns(parsed);

  assert.deepEqual(Object.keys(columns).sort(), [
    'availabilityJson', 'category', 'description', 'location', 'price', 'title',
  ]);
  assert.equal(columns.price, 150);
  assert.deepEqual(JSON.parse(columns.availabilityJson), {
    days: ['Mon', 'Wed'],
    hours: '09:00-17:00',
  });
});



test('a listing id must be a positive integer', () => {
  assert.equal(parseServiceId('4'), 4);
  assert.equal(parseServiceId('0'), null);
  assert.equal(parseServiceId('-1'), null);
  assert.equal(parseServiceId('4.5'), null);
  assert.equal(parseServiceId('abc'), null);
  assert.equal(parseServiceId(''), null);
  assert.equal(parseServiceId(undefined), null);
});

test('a rejected submission is redrawn with what the provider typed', () => {

  const values = submittedValues({
    title: 'Airport transfer',
    category: 'transport',
    description: 'A description',
    price: 'not a price',
    location: 'Klang',
    days: 'Sat',
    hours: '09:00-17:00',
  });

  assert.equal(values.price, 'not a price');
  assert.deepEqual(values.days, ['Sat']);
});

test('a submission with no fields at all redraws as empty strings, never undefined', () => {
  const values = submittedValues({});

  assert.equal(values.title, '');
  assert.deepEqual(values.days, []);
});

test('an existing listing round-trips into the form values', () => {
  const listing = decorate({
    title: 'Overnight respite care',
    category: 'caregiver',
    description: 'Overnight cover so a family carer can rest.',
    price: '300.00',
    location: 'Subang Jaya',
    availability_json: '{"days":["Fri","Sat"],"hours":"19:00-07:00"}',
    is_active: 1,
    booking_count: 0,
  });

  const values = listingToValues(listing);

  assert.deepEqual(values.days, ['Fri', 'Sat']);
  assert.equal(values.hours, '19:00-07:00');
  assert.equal(values.category, 'caregiver');
});

test('a listing with no availability round-trips to empty controls', () => {
  const listing = decorate({
    title: 'x', category: 'other', description: null, price: '0.00', location: 'KL',
    availability_json: null, is_active: 1, booking_count: 0,
  });

  const values = listingToValues(listing);

  assert.deepEqual(values.days, []);
  assert.equal(values.hours, '');
  assert.equal(values.description, '');
});

test('the days offered by the form are the days the schema accepts', () => {

  for (const day of DAYS) {
    assert.equal(listingSchema.safeParse(validListing({ days: [day] })).success, true, day);
  }
  assert.equal(listingSchema.safeParse(validListing({ days: ['Funday'] })).success, false);
});
