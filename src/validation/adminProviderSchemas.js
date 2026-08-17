'use strict';

const { z } = require('zod');



const PROVIDER_STATUSES = ['pending', 'approved', 'rejected'];


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


const adminProviderListSchema = z.object({
  status: z.preprocess(blankToNull, z.enum(PROVIDER_STATUSES).nullable().default(null)),
});

module.exports = {
  PROVIDER_STATUSES,
  PROVIDER_STATUS_LABELS,
  adminProviderListSchema,
};
