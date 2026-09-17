'use strict';

const { z } = require('zod');

const config = require('../config');
const { CATEGORIES } = require('./serviceSchemas');

const CATEGORY_LABELS = {
  transport: 'Accessible transport',
  interpreter: 'Sign language interpreting',
  caregiver: 'Caregiving and personal support',
  mobility: 'Mobility equipment',
  other: 'Other accessibility support',
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const HOURS_RANGE = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/;

const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const blankToNull = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

function toDayArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

const listingSchema = z.object({
  title: z.string()
    .trim()
    .min(8, 'Give the listing a title of at least 8 characters.')
    .max(160, 'Keep the title under 160 characters.'),

  category: z.enum(CATEGORIES, {
    errorMap: () => ({ message: 'Choose one of the listed categories.' }),
  }),

  description: z.preprocess(
    blankToNull,
    z.string()
      .min(20, 'Describe the service in at least 20 characters.')
      .max(2000, 'Keep the description under 2000 characters.')
      .nullable()
      .refine((value) => value !== null, {
        message: 'Describe what the service includes, so a requester knows what they are asking for.',
      })
  ),

  price: z.coerce.number({ invalid_type_error: 'Enter the price as a number, for example 150 or 150.50.' })
    .min(0, 'A price cannot be negative. Enter 0 for a free service.')
    .max(99999999.99, 'Enter a price under RM 99,999,999.99.')
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9, {
      message: 'Use at most two decimal places.',
    }),

  location: z.string()
    .trim()
    .min(2, 'Enter the town or city this service covers.')
    .max(120, 'Keep the location under 120 characters.'),

  days: z.preprocess(
    toDayArray,
    z.array(z.enum(DAYS, { errorMap: () => ({ message: 'Choose days from the list.' }) }))
      .max(7)
  ),

  hours: z.preprocess(
    blankToNull,
    z.string()
      .regex(HOURS_RANGE, 'Enter hours as a 24-hour range, for example 09:00-17:00.')
      .nullable()
  ),
}).superRefine((value, ctx) => {

  if (value.hours && value.days.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['days'],
      message: 'Choose the days these hours apply to.',
    });
  }
});

const uploadRequestSchema = z.object({
  contentType: z.enum(Object.keys(IMAGE_TYPES), {
    errorMap: () => ({ message: 'Upload a JPEG, PNG or WebP image.' }),
  }),

  contentLength: z.coerce.number()
    .int()
    .positive('The file appears to be empty.')
    .max(config.s3.uploadMaxBytes, `Images must be under ${Math.floor(config.s3.uploadMaxBytes / (1024 * 1024))} MB.`),
});

const imageConfirmSchema = z.object({
  key: z.string().min(1).max(400),

  altText: z.string()
    .trim()
    .min(10, 'Describe the image in at least 10 characters, so a screen reader user learns what it shows.')
    .max(255, 'Keep the description under 255 characters.'),
});

function buildImageKey({ providerId, serviceId, contentType, unique }) {
  return `services/provider-${providerId}/service-${serviceId}/${unique}.${IMAGE_TYPES[contentType]}`;
}

function isOwnedImageKey(key, { providerId, serviceId }) {
  const extensions = Object.values(IMAGE_TYPES).join('|');
  const pattern = new RegExp(
    `^services/provider-${providerId}/service-${serviceId}/[0-9a-f-]{36}\\.(${extensions})$`
  );
  return pattern.test(key);
}

function toAvailabilityJson({ days, hours }) {
  if (!days || days.length === 0) {
    return null;
  }

  const ordered = DAYS.filter((day) => days.includes(day));
  return JSON.stringify({ days: ordered, hours: hours || null });
}

module.exports = {
  listingSchema,
  uploadRequestSchema,
  imageConfirmSchema,
  buildImageKey,
  isOwnedImageKey,
  toAvailabilityJson,
  CATEGORY_LABELS,
  DAYS,
  HOURS_RANGE,
  IMAGE_TYPES,
};
