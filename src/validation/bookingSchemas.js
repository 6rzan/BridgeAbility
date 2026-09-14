'use strict';

const { z } = require('zod');

/**
 * Validation for the requester's booking flow (F2).
 *
 * Everything here runs on the server. The same rules are mirrored in the browser by
 * public/js/form-validate.js and by the input types and `min` attributes in the markup, but
 * that mirror exists to give a person a fast, kind answer -- it is not the check. A request
 * arriving from curl with no scripting at all meets exactly these rules.
 */

/** How the six statuses are shown, in words. Colour is never the only signal (SC 1.4.1). */
const STATUS_LABELS = {
  pending: 'Awaiting provider',
  accepted: 'Accepted',
  rejected: 'Declined',
  assigned: 'Volunteer assigned',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** What each status means for the requester, said plainly rather than in system terms. */
const STATUS_EXPLANATIONS = {
  pending: 'The provider has not answered yet. You can still cancel this request.',
  accepted: 'The provider accepted. A coordinator will assign a volunteer assistant.',
  rejected: 'The provider could not take this request. Nothing further will happen.',
  assigned: 'A volunteer assistant has been assigned and will carry out the booking.',
  completed: 'This booking has been carried out and closed.',
  cancelled: 'You cancelled this request before the provider answered.',
};

const STATUSES = Object.keys(STATUS_LABELS);

/** A requester may only walk away from a request the provider has not answered yet. */
const CANCELLABLE = new Set(['pending']);

/**
 * A booking has to be requested for a moment that has not happened yet.
 *
 * The tolerance is deliberate. The form is filled in over a minute or two and the browser's
 * clock is not the server's, so rejecting anything not strictly in the future turns a valid
 * "in one hour" into an error for a user whose laptop is two minutes slow.
 */
const CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

/** Nobody is booking an interpreter for a date two years out; a typo in the year is likelier. */
const MAX_LEAD_DAYS = 365;

/**
 * `datetime-local` posts 'YYYY-MM-DDTHH:MM' with no timezone, which is what we want: the
 * requester means a wall-clock time in Malaysia, not an instant on a global timeline. It is
 * stored in a MySQL DATETIME, which is equally timezone-free, so the value the requester typed
 * is the value the provider reads.
 */
const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

function blankToNull(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** 'YYYY-MM-DDTHH:MM' -> the MySQL DATETIME literal for the same wall-clock moment. */
function toMysqlDatetime(localDatetime) {
  const [date, time] = localDatetime.split('T');
  const [hours, minutes] = time.split(':');
  return `${date} ${hours}:${minutes}:00`;
}

/**
 * WHOSE CLOCK DECIDES WHETHER A BOOKING IS IN THE FUTURE
 *
 * The requester types a wall-clock time in Malaysia. The Beanstalk instance runs on UTC.
 * Comparing one against the other is wrong by eight hours: at 14:45 in Kuala Lumpur the
 * server reads 06:45, so a booking typed for 10:00 this morning -- already past -- would be
 * accepted as future. Nothing in the deployed environment would reveal that except a user
 * being told their mistake was fine.
 *
 * Both sides are therefore converted to the same thing: a wall-clock reading in Malaysia,
 * expressed as an epoch offset. The typed string is read as if its fields were UTC, and
 * "now" is shifted forward by the Malaysian offset so its UTC fields read as the local clock.
 * The two are then directly comparable and the server's own timezone stops mattering.
 *
 * The offset is a constant rather than a lookup because Malaysia is a single timezone and has
 * observed UTC+8 with no daylight saving since 1982.
 */
const KUALA_LUMPUR_OFFSET_MINUTES = 8 * 60;

/** The typed wall clock, as an epoch offset. Not an instant -- a reading on a Malaysian clock. */
function wallClockEpoch(localDatetime) {
  const [date, time] = localDatetime.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return Date.UTC(year, month - 1, day, hours, minutes, 0, 0);
}

/** What a clock on a wall in Kuala Lumpur reads now, in the same units. */
function nowWallClockEpoch(nowMs = Date.now()) {
  return nowMs + KUALA_LUMPUR_OFFSET_MINUTES * 60 * 1000;
}

/**
 * The `min` the date field carries, so the browser's own picker refuses a past time before
 * the user submits. Same clock as the validator above, so the two cannot disagree.
 */
function earliestBookableLocal(nowMs = Date.now()) {
  return new Date(nowWallClockEpoch(nowMs)).toISOString().slice(0, 16);
}

/**
 * SHOWING A TIME BACK TO THE REQUESTER
 *
 * The two databases hand back timestamps that both have to appear as a Malaysian clock, but
 * they mean different things and must not share one conversion.
 *
 * `bookings.requested_datetime` is a MySQL DATETIME -- a wall-clock reading carrying no
 * timezone at all. The pool is opened with `timezone: 'Z'` (data/mysql/pool.js), so mysql2
 * builds a Date whose UTC fields hold exactly the digits the requester typed. Formatting
 * those fields returns the typed time on any server, whatever timezone it is set to.
 *
 * A DynamoDB `occurredAt`, and any MySQL TIMESTAMP such as `created_at`, is the opposite: a
 * real instant recorded in UTC when something happened. Shown unconverted it is eight hours
 * behind the clock the reader is looking at, so it is shifted first.
 */
const WALL_CLOCK_FORMAT = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'full',
  timeStyle: 'short',
  timeZone: 'UTC',
});

/** Format the UTC fields of a value -- that is, read it as a wall clock, not as an instant. */
function formatWallClock(value) {
  if (value == null) return '';
  const date = value instanceof Date ? value : new Date(value);
  return WALL_CLOCK_FORMAT.format(date);
}

/** The same reading as an HTML `datetime` attribute: 'YYYY-MM-DDTHH:MM'. */
function toDatetimeAttribute(value) {
  if (value == null) return '';
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 16);
}

/** An instant, moved so that reading its UTC fields gives the Kuala Lumpur wall clock. */
function toKualaLumpur(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getTime() + KUALA_LUMPUR_OFFSET_MINUTES * 60 * 1000);
}

const bookingCreateSchema = z.object({
  serviceId: z.coerce.number().int().positive(),

  requestedDatetime: z.string()
    .regex(LOCAL_DATETIME, 'Choose a date and time for the booking.')
    // A refinement still runs after the regex above has failed, so the format has to be
    // re-checked here before the value is taken apart. Without that guard a request carrying
    // '2026-08-20' -- no time, no 'T' -- reaches wallClockEpoch, which splits on 'T', gets
    // undefined and throws, turning an ordinary invalid form into a 500. The format is the
    // precondition for the range, so a value that failed it is simply left to the regex's
    // own message rather than being reported twice.
    .superRefine((value, ctx) => {
      if (!LOCAL_DATETIME.test(value)) return;

      const requested = wallClockEpoch(value);
      const now = nowWallClockEpoch();

      if (requested <= now - CLOCK_TOLERANCE_MS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Choose a date and time in the future.',
        });
      } else if (requested >= now + MAX_LEAD_DAYS * 24 * 60 * 60 * 1000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Choose a date within the next ${MAX_LEAD_DAYS} days.`,
        });
      }
    }),

  notes: z.preprocess(
    blankToNull,
    z.string()
      .max(1000, 'Keep the notes under 1000 characters.')
      .nullable()
  ),

  // Generated by the form, one per rendering. Two submissions of the same form carry the same
  // key, and the UNIQUE index on bookings.request_key turns the second one into a no-op
  // instead of a duplicate booking. See bookingService.submit.
  requestKey: z.string().uuid('This form has expired. Reload the page and try again.'),
});

/** Filters for "my bookings". A status that is not one of the six is a bad request, not a hint. */
const bookingListSchema = z.object({
  status: z.preprocess(blankToNull, z.enum(STATUSES).nullable().default(null)),
});

module.exports = {
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
  CLOCK_TOLERANCE_MS,
};
