'use strict';

const { z } = require('zod');

const config = require('../config');
const { CATEGORIES } = require('./serviceSchemas');

/**
 * Validation for a provider's own listings (F3).
 *
 * F1 validates a *query* — text a stranger types to search the catalogue. This file validates
 * a *record* — the thing that then appears in that catalogue under an approved organisation's
 * name. The bar is therefore different: a bad filter shows the wrong results, a bad listing is
 * published, so every field here has a length, a range or a fixed set behind it and none of
 * them is optional in the sense of unchecked.
 */

/** Category names as a person reads them. The stored value stays the schema's ENUM token. */
const CATEGORY_LABELS = {
  transport: 'Accessible transport',
  interpreter: 'Sign language interpreting',
  caregiver: 'Caregiving and personal support',
  mobility: 'Mobility equipment',
  other: 'Other accessibility support',
};

/** Days as stored in `availability_json`, in week order rather than alphabetically. */
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** 'HH:MM-HH:MM' on a 24-hour clock. The stored shape the F1 detail page already reads. */
const HOURS_RANGE = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * The image types a browser can be trusted to render and a screen reader can be given alt
 * text for. The list is short on purpose: it is bound into the presigned PUT signature, so
 * anything outside it cannot be uploaded even by a caller writing its own request.
 */
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

/**
 * A checkbox group posts nothing when none is ticked, one string when one is, and an array
 * when several are. Normalising all three here means the schema below sees a list every time
 * and the "no days chosen" case is an empty array rather than three different shapes.
 */
function toDayArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * The listing itself. Used unchanged for both create and update: the fields a provider may
 * set are the same either way, and the difference between the two is which row the result is
 * written to, which is the repository's business rather than the schema's.
 *
 * `provider_id` is deliberately absent. It is never read from the form — it comes from the
 * providers row belonging to the signed-in user, so there is no field here to tamper with.
 * Neither is `is_active`: publishing and withdrawing is its own route with its own guard.
 */
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

  // DECIMAL(10,2) in MySQL. A third decimal place is rejected rather than rounded: silently
  // changing a price a provider typed is worse than telling them it was not accepted.
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

  // Availability is optional as a whole — a provider who works to no fixed timetable should
  // not be forced to invent one — but if any of it is given, both halves have to make sense.
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
  // Hours without days would render as ", 09:00 to 17:00" on the public detail page — a
  // fragment with nothing to attach to. The pair is meaningful; each half alone is not.
  if (value.hours && value.days.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['days'],
      message: 'Choose the days these hours apply to.',
    });
  }
});

/**
 * The upload request, answered with a presigned PUT.
 *
 * Both fields are bound into the signature by the S3 client, so they are not advisory: a
 * browser that asks for a 2 MB JPEG and then sends a 40 MB one is refused by S3 itself, not
 * by us. Validating them here is what makes that binding meaningful — S3 enforces whatever we
 * sign, so signing an unchecked value would enforce nothing.
 */
const uploadRequestSchema = z.object({
  contentType: z.enum(Object.keys(IMAGE_TYPES), {
    errorMap: () => ({ message: 'Upload a JPEG, PNG or WebP image.' }),
  }),

  contentLength: z.coerce.number()
    .int()
    .positive('The file appears to be empty.')
    .max(config.s3.uploadMaxBytes, `Images must be under ${Math.floor(config.s3.uploadMaxBytes / (1024 * 1024))} MB.`),
});

/**
 * Confirming an upload that has already landed in S3.
 *
 * ALT TEXT IS REQUIRED HERE, NOT IN THE COLUMN
 *
 * `services.image_alt_text` is nullable in the schema because a listing legitimately has no
 * image. What must never exist is an image *without* alt text, and that is a relationship
 * between two columns rather than a property of one, so it is enforced at the only point
 * where an image is attached: this schema. A listing on a platform for people with
 * disabilities that publishes an undescribed photograph refutes its own premise, so the
 * upload simply cannot be completed without one.
 */
const imageConfirmSchema = z.object({
  key: z.string().min(1).max(400),

  altText: z.string()
    .trim()
    .min(10, 'Describe the image in at least 10 characters, so a screen reader user learns what it shows.')
    .max(255, 'Keep the description under 255 characters.'),
});

/**
 * The S3 key for a listing image, derived rather than accepted.
 *
 * The provider and the service are in the path, which is what makes the confirm step safe:
 * the key a provider submits is checked against this exact shape for their own provider id
 * and their own listing (see isOwnedImageKey), so a key naming somebody else's listing is
 * rejected before it reaches the database. The random segment stops a re-upload from
 * overwriting the object a page is still showing through a presigned URL that has not expired.
 */
function buildImageKey({ providerId, serviceId, contentType, unique }) {
  return `services/provider-${providerId}/service-${serviceId}/${unique}.${IMAGE_TYPES[contentType]}`;
}

/** Does this key belong to this provider's listing? The confirm step's authorisation check. */
function isOwnedImageKey(key, { providerId, serviceId }) {
  const extensions = Object.values(IMAGE_TYPES).join('|');
  const pattern = new RegExp(
    `^services/provider-${providerId}/service-${serviceId}/[0-9a-f-]{36}\\.(${extensions})$`
  );
  return pattern.test(key);
}

/**
 * Fold the validated days and hours back into the JSON column's shape, or null when a provider
 * gave neither. Stored as text by the caller; `availability_json` is a JSON column, so MySQL
 * validates the document a second time on the way in.
 */
function toAvailabilityJson({ days, hours }) {
  if (!days || days.length === 0) {
    return null;
  }

  // Sorted into week order rather than the order the checkboxes happened to post in, so
  // "Mon, Wed, Fri" never renders as "Wed, Fri, Mon" on the public page.
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
