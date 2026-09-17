'use strict';

const { z } = require('zod');

const STATUS_LABELS = {
  pending: 'Awaiting provider',
  accepted: 'Accepted',
  rejected: 'Declined',
  assigned: 'Volunteer assigned',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const STATUS_EXPLANATIONS = {
  pending: 'The provider has not answered yet. You can still cancel this request.',
  accepted: 'The provider accepted. A coordinator will assign a volunteer assistant.',
  rejected: 'The provider could not take this request. Nothing further will happen.',
  assigned: 'A volunteer assistant has been assigned and will carry out the booking.',
  completed: 'This booking has been carried out and closed.',
  cancelled: 'You cancelled this request before the provider answered.',
};

const STATUSES = Object.keys(STATUS_LABELS);

const CANCELLABLE = new Set(['pending']);

const CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

const MAX_LEAD_DAYS = 365;

const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

function blankToNull(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function toMysqlDatetime(localDatetime) {
  const [date, time] = localDatetime.split('T');
  const [hours, minutes] = time.split(':');
  return `${date} ${hours}:${minutes}:00`;
}

const KUALA_LUMPUR_OFFSET_MINUTES = 8 * 60;

function wallClockEpoch(localDatetime) {
  const [date, time] = localDatetime.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return Date.UTC(year, month - 1, day, hours, minutes, 0, 0);
}

function nowWallClockEpoch(nowMs = Date.now()) {
  return nowMs + KUALA_LUMPUR_OFFSET_MINUTES * 60 * 1000;
}

function earliestBookableLocal(nowMs = Date.now()) {
  return new Date(nowWallClockEpoch(nowMs)).toISOString().slice(0, 16);
}

const WALL_CLOCK_FORMAT = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'full',
  timeStyle: 'short',
  timeZone: 'UTC',
});

function formatWallClock(value) {
  if (value == null) return '';
  const date = value instanceof Date ? value : new Date(value);
  return WALL_CLOCK_FORMAT.format(date);
}

function toDatetimeAttribute(value) {
  if (value == null) return '';
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 16);
}

function toKualaLumpur(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getTime() + KUALA_LUMPUR_OFFSET_MINUTES * 60 * 1000);
}

const bookingCreateSchema = z.object({
  serviceId: z.coerce.number().int().positive(),

  requestedDatetime: z.string()
    .regex(LOCAL_DATETIME, 'Choose a date and time for the booking.')

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

  requestKey: z.string().uuid('This form has expired. Reload the page and try again.'),
});

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
