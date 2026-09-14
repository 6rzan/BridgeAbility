'use strict';

const adminProviderRepository = require('../data/mysql/adminProviderRepository');
const bookingService = require('./bookingService');
const { presignGet } = require('../data/s3/client');
const { EVENT_TYPES, publishBookingEventSafely } = require('./notificationPublisher');
const { formatWallClock, toKualaLumpur } = require('../validation/bookingSchemas');
const { PROVIDER_STATUS_LABELS } = require('../validation/adminProviderSchemas');

/**
 * Reviewing provider registrations (F5).
 *
 * This is the second half of F1's visibility rule: a provider may create and edit listings the
 * moment they register (F3), but nothing they publish reaches the public catalogue until
 * `providers.status = 'approved'`, which only happens here.
 */

const PER_PAGE = bookingService.PER_PAGE;

function decorate(provider) {
  return {
    ...provider,
    statusLabel: PROVIDER_STATUS_LABELS[provider.status],
    canDecide: provider.status === 'pending',
    submittedLabel: formatWallClock(toKualaLumpur(provider.created_at)),
    reviewedLabel: provider.reviewed_at ? formatWallClock(toKualaLumpur(provider.reviewed_at)) : null,
  };
}

/**
 * A verification document is never a public URL -- the same reasoning as
 * providerListingService.attachImageUrl. A failure to sign degrades to no link rather than an
 * error page; the administrator still needs to be able to review the rest of the registration.
 */
async function attachDocUrl(provider) {
  if (!provider.verification_doc_s3_key) {
    return { ...provider, docUrl: null };
  }

  try {
    return { ...provider, docUrl: await presignGet(provider.verification_doc_s3_key) };
  } catch (error) {
    console.error('[admin-providers] could not presign verification doc', {
      providerId: provider.provider_id,
      error: error.message,
    });
    return { ...provider, docUrl: null };
  }
}

/** One page of the review queue, with the counts the filter menu shows. */
async function listQueue({ status, page }) {
  const totalItems = await adminProviderRepository.countByStatus({ status });
  const pagination = bookingService.paginate(totalItems, page, PER_PAGE);

  const rows = await adminProviderRepository.listByStatus({
    status,
    limit: pagination.perPage,
    offset: pagination.offset,
  });

  const counts = await adminProviderRepository.countAllByStatus();

  return {
    providers: rows.map(decorate),
    pagination,
    counts,
    total: Object.values(counts).reduce((sum, value) => sum + value, 0),
  };
}

/** One registration, with its document link, or null if it does not exist. */
async function findOne(providerId) {
  const provider = await adminProviderRepository.findById(providerId);
  if (!provider) return null;

  return attachDocUrl(decorate(provider));
}

/**
 * Approve or reject a registration. The guard is decide's own UPDATE (see
 * adminProviderRepository), so this cannot re-decide a registration another administrator has
 * already acted on.
 */
async function review({ providerId, reviewerId, decision }) {
  const provider = await adminProviderRepository.findById(providerId);

  if (!provider) {
    return { outcome: 'not-found' };
  }

  const changed = await adminProviderRepository.decide(providerId, reviewerId, decision);

  if (!changed) {
    return { outcome: 'not-pending', status: provider.status };
  }

  await publishBookingEventSafely({
    eventType: decision === 'approved' ? EVENT_TYPES.PROVIDER_APPROVED : EVENT_TYPES.PROVIDER_REJECTED,
    recipientUserId: provider.user_id,
    message: decision === 'approved'
      ? `${provider.org_name} is approved. Your listings are now visible to requesters.`
      : `${provider.org_name}'s registration was not approved.`,
    detail: { providerId },
  });

  return { outcome: decision, orgName: provider.org_name };
}

module.exports = {
  listQueue,
  findOne,
  review,
  decorate,
};
