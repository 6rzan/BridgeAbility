'use strict';

const { z } = require('zod');

/** Validation for the admin provider-review queue (F5). */

const PROVIDER_STATUSES = ['pending', 'approved', 'rejected'];

/** How the three registration states are shown, in words. */
const PROVIDER_STATUS_LABELS = {
  pending: 'Awaiting review',
  approved: 'Approved',
  rejected: 'Rejected',
};

function blankToNull(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Filters for the review queue. A status that is not one of the three is a bad link, not a hint. */
const adminProviderListSchema = z.object({
  status: z.preprocess(blankToNull, z.enum(PROVIDER_STATUSES).nullable().default(null)),
});

module.exports = {
  PROVIDER_STATUSES,
  PROVIDER_STATUS_LABELS,
  adminProviderListSchema,
};
