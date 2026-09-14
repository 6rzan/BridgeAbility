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


function decorate(listing) {
  const bookingCount = Number(listing.booking_count || 0);

  return {
    ...listing,
    bookingCount,
    categoryLabel: CATEGORY_LABELS[listing.category] || listing.category,
    availability: parseAvailability(listing.availability_json),
    isActive: listing.is_active === 1,

    canDelete: bookingCount === 0,
  };
}


function findProvider(userId) {
  return providerServiceRepository.findProviderByUserId(userId);
}


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


async function findOwn(serviceId, providerId) {
  const row = await providerServiceRepository.findForProvider(serviceId, providerId);
  return row ? attachImageUrl(decorate(row)) : null;
}


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


async function create(providerId, listing) {
  const serviceId = await providerServiceRepository.createService(providerId, toColumns(listing));
  return { outcome: 'created', serviceId };
}


async function update(serviceId, providerId, listing) {
  const updated = await providerServiceRepository.updateService(
    serviceId,
    providerId,
    toColumns(listing)
  );
  return { outcome: updated ? 'updated' : 'not-found' };
}


async function setVisibility(serviceId, providerId, isActive) {
  const changed = await providerServiceRepository.setActive(serviceId, providerId, isActive);
  return { outcome: changed ? (isActive ? 'published' : 'withdrawn') : 'not-found' };
}



async function remove(serviceId, providerId) {
  const result = await providerServiceRepository.deleteUnbookedService(serviceId, providerId);

  if (result.outcome === 'deleted' && result.imageKey) {
    await deleteObjectSafely(result.imageKey, { serviceId, reason: 'listing deleted' });
  }

  return result;
}



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
