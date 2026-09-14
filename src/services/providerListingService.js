'use strict';

const crypto = require('node:crypto');

const providerServiceRepository = require('../data/mysql/providerServiceRepository');
const { presignGet, presignPut, deleteObject } = require('../data/s3/client');
const { parseAvailability } = require('./catalogueService');
const {
  buildImageKey,
  isOwnedImageKey,
  toAvailabilityJson,
  CATEGORY_LABELS,
} = require('../validation/providerServiceSchemas');

/**
 * Creating and managing service listings (F3).
 *
 * ORDERING BETWEEN MySQL AND S3
 *
 * The same principle as the booking timeline, applied to a different pair of stores: the row
 * in MySQL is authoritative and commits first, and the object in S3 is reconciled around it.
 *
 *   Attaching an image — the object is already in S3 (the browser PUT it directly), so the
 *   row is updated and only then is the *replaced* object deleted. If that delete fails, the
 *   listing is correct and one unreferenced object is left behind, which costs a fraction of
 *   a cent and can be swept up later.
 *
 *   Deleting a listing — the row is deleted first, then the object. The other order can
 *   delete an image out from under a listing that is still published if the DELETE then fails,
 *   which every visitor sees immediately.
 *
 * In both directions the failure mode is an orphaned object rather than a listing pointing at
 * something that is no longer there. Orphans are invisible to users and cheap; broken
 * references are neither. There is no transaction spanning RDS and S3, and writing the code as
 * though there were would be the actual mistake.
 */

/**
 * A listing image is never a public URL.
 *
 * The bucket has Block Public Access on, so the provider's own management pages get the same
 * short-lived presigned GET the public catalogue does (see catalogueService.attachImageUrls).
 * A failure to sign degrades to no image rather than an error page — the provider still needs
 * to be able to edit the price of a listing whose photograph will not load.
 */
async function attachImageUrl(listing) {
  if (!listing.image_s3_key) {
    return { ...listing, imageUrl: null };
  }

  try {
    return { ...listing, imageUrl: await presignGet(listing.image_s3_key) };
  } catch (error) {
    console.error('[listings] could not presign image', {
      serviceId: listing.service_id,
      key: listing.image_s3_key,
      message: error.message,
    });
    return { ...listing, imageUrl: null };
  }
}

/** Everything a view needs about one listing, worked out here rather than in the template. */
function decorate(listing) {
  const bookingCount = Number(listing.booking_count || 0);

  return {
    ...listing,
    bookingCount,
    categoryLabel: CATEGORY_LABELS[listing.category] || listing.category,
    availability: parseAvailability(listing.availability_json),
    isActive: listing.is_active === 1,
    // Deletion is permanent and cascades to bookings, so it is only ever offered for a listing
    // nobody has booked. Everything else is withdrawn instead. The page says which it is
    // offering before the provider commits to anything.
    canDelete: bookingCount === 0,
  };
}

/** The provider record behind the signed-in user, or null for an account that has none. */
function findProvider(userId) {
  return providerServiceRepository.findProviderByUserId(userId);
}

/** Every listing this provider owns, with image URLs and the counts the page shows. */
async function listOwn(providerId) {
  const rows = await providerServiceRepository.listForProvider(providerId);
  const listings = await Promise.all(rows.map((row) => attachImageUrl(decorate(row))));

  return {
    listings,
    counts: {
      total: listings.length,
      active: listings.filter((listing) => listing.isActive).length,
      withdrawn: listings.filter((listing) => !listing.isActive).length,
    },
  };
}

/** One listing this provider owns, or null. */
async function findOwn(serviceId, providerId) {
  const row = await providerServiceRepository.findForProvider(serviceId, providerId);
  return row ? attachImageUrl(decorate(row)) : null;
}

/** Turn validated form data into the columns the repository writes. */
function toColumns(listing) {
  return {
    title: listing.title,
    category: listing.category,
    description: listing.description,
    price: listing.price,
    location: listing.location,
    availabilityJson: toAvailabilityJson(listing),
  };
}

/** Publish a new listing. */
async function create(providerId, listing) {
  const serviceId = await providerServiceRepository.createService(providerId, toColumns(listing));
  return { outcome: 'created', serviceId };
}

/** Edit an existing one. 'not-found' covers both "no such listing" and "not yours". */
async function update(serviceId, providerId, listing) {
  const updated = await providerServiceRepository.updateService(
    serviceId,
    providerId,
    toColumns(listing)
  );
  return { outcome: updated ? 'updated' : 'not-found' };
}

/** Withdraw a listing from the catalogue, or publish it again. */
async function setVisibility(serviceId, providerId, isActive) {
  const changed = await providerServiceRepository.setActive(serviceId, providerId, isActive);
  return { outcome: changed ? (isActive ? 'published' : 'withdrawn') : 'not-found' };
}

/**
 * Delete a listing nobody has booked, and its image with it.
 *
 * The S3 delete happens after MySQL has committed and cannot fail the operation: the listing
 * is already gone, and telling the provider otherwise because of a storage call would be a lie
 * about what happened.
 */
async function remove(serviceId, providerId) {
  const result = await providerServiceRepository.deleteUnbookedService(serviceId, providerId);

  if (result.outcome === 'deleted' && result.imageKey) {
    await deleteObjectSafely(result.imageKey, { serviceId, reason: 'listing deleted' });
  }

  return result;
}

/**
 * An orphaned object is a cent of storage; a failed delete that breaks the user's action is a
 * broken page. Log it in a form that can be replayed by hand and carry on.
 */
async function deleteObjectSafely(key, context) {
  try {
    await deleteObject(key);
    return true;
  } catch (error) {
    console.error('[listings] S3 DELETE FAILED — orphaned object, sweep by hand', {
      key,
      ...context,
      error: error.message,
    });
    return false;
  }
}

/**
 * Mint a presigned PUT for a listing image.
 *
 * The browser uploads straight to S3 with this URL, so the file never passes through the
 * application tier — no multipart body to buffer, no request size limit to raise, and a
 * 5 MB photograph does not occupy a Node process for the length of a mobile upload. What
 * makes that safe is that the content type and the exact byte length are bound into the
 * signature: S3 rejects a request that does not match what we signed, so "the client could
 * send anything" is not true here.
 *
 * The key is derived from the provider and the service (never accepted from the caller) and
 * carries a random segment, so a re-upload writes a new object rather than overwriting the one
 * an unexpired presigned URL is still serving.
 */
async function presignImageUpload({ serviceId, providerId, contentType, contentLength }) {
  const listing = await providerServiceRepository.findForProvider(serviceId, providerId);

  if (!listing) {
    return { outcome: 'not-found' };
  }

  const key = buildImageKey({
    providerId,
    serviceId,
    contentType,
    unique: crypto.randomUUID(),
  });

  const uploadUrl = await presignPut(key, contentType, contentLength);

  return { outcome: 'signed', uploadUrl, key, contentType };
}

/**
 * Record an image that has finished uploading.
 *
 * The key is re-checked against this provider's own path before it is written, so a caller
 * that skipped the browser and posted the confirm step by hand cannot point their listing at
 * an object belonging to another provider. It is the same distrust the rest of the slice runs
 * on: the presign step said what we would allow, and this step verifies rather than remembers.
 */
async function confirmImage({ serviceId, providerId, key, altText }) {
  if (!isOwnedImageKey(key, { providerId, serviceId })) {
    return { outcome: 'invalid-key' };
  }

  const { updated, previousKey } = await providerServiceRepository.setImage(
    serviceId,
    providerId,
    key,
    altText
  );

  if (!updated) {
    return { outcome: 'not-found' };
  }

  if (previousKey && previousKey !== key) {
    await deleteObjectSafely(previousKey, { serviceId, reason: 'image replaced' });
  }

  return { outcome: 'attached' };
}

/** Take the image off a listing and delete the object behind it. */
async function removeImage(serviceId, providerId) {
  const { updated, previousKey } = await providerServiceRepository.clearImage(
    serviceId,
    providerId
  );

  if (!updated) {
    return { outcome: 'not-found' };
  }

  if (previousKey) {
    await deleteObjectSafely(previousKey, { serviceId, reason: 'image removed by provider' });
  }

  return { outcome: 'removed' };
}

module.exports = {
  findProvider,
  listOwn,
  findOwn,
  create,
  update,
  setVisibility,
  remove,
  presignImageUpload,
  confirmImage,
  removeImage,
  decorate,
  toColumns,
};
