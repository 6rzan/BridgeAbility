'use strict';

const serviceRepository = require('../data/mysql/serviceRepository');
const { presignGet } = require('../data/s3/client');
const { PER_PAGE } = require('../validation/serviceSchemas');

/**
 * The service catalogue (F1): search, pagination and image URLs.
 *
 * Sits between the controller and the repository so the page-number arithmetic and the S3
 * work are testable without a request, and so the HTML page and the JSON/fragment responses
 * are guaranteed to be looking at the same data.
 */

/**
 * Page arithmetic, kept pure.
 *
 * `page` has already been validated as an integer >= 1, but a user can still ask for page 9
 * of a 2-page result -- by editing the URL, or by holding a link while listings change under
 * them. That returns an empty page rather than an error: the surrounding UI still shows the
 * filters and the real page count, which is a better answer than a 404.
 */
function paginate(totalItems, page, perPage = PER_PAGE) {
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
  const currentPage = Math.min(page, totalPages);
  const offset = (currentPage - 1) * perPage;

  return {
    totalItems,
    totalPages,
    currentPage,
    perPage,
    offset,
    hasPrevious: currentPage > 1,
    hasNext: currentPage < totalPages,
    firstOnPage: totalItems === 0 ? 0 : offset + 1,
    lastOnPage: Math.min(offset + perPage, totalItems),
  };
}

/**
 * Attach a short-lived presigned URL to each listing that has an image.
 *
 * The bucket has Block Public Access on and no bucket policy grants anonymous reads, so these
 * URLs are the only way an image reaches a browser. They are generated per request and expire
 * in minutes, which means a URL copied out of the page stops working rather than becoming a
 * permanent public link to private storage.
 *
 * Presigning is a local signing operation -- no network call per image -- so doing it for a
 * page of results costs nothing measurable.
 *
 * A listing with no image is normal, not an error: images arrive through the provider upload
 * flow in F3, and the catalogue must render a listing that has not had one yet.
 */
async function attachImageUrls(services) {
  return Promise.all(services.map(async (service) => {
    if (!service.image_s3_key) {
      return { ...service, imageUrl: null };
    }

    try {
      return { ...service, imageUrl: await presignGet(service.image_s3_key) };
    } catch (error) {
      // A signing failure must not take the catalogue down. Log it and fall back to the
      // no-image rendering, which is a complete and usable listing.
      console.error('[catalogue] could not presign image', {
        serviceId: service.service_id,
        key: service.image_s3_key,
        message: error.message,
      });
      return { ...service, imageUrl: null };
    }
  }));
}

/**
 * Run a catalogue search.
 *
 * The count runs before the page query because the requested page may be past the end, and
 * the offset has to be clamped to a page that exists before the rows are fetched.
 */
async function search(criteria) {
  const totalItems = await serviceRepository.countServices(criteria);
  const pagination = paginate(totalItems, criteria.page);

  const rows = totalItems === 0
    ? []
    : await serviceRepository.searchServices(criteria, {
      limit: pagination.perPage,
      offset: pagination.offset,
    });

  return { services: await attachImageUrls(rows), pagination };
}

/** One listing for the detail page, with its image URL. Null when it is not public. */
async function findVisibleService(serviceId) {
  const service = await serviceRepository.findVisibleServiceById(serviceId);
  if (!service) {
    return null;
  }

  const [withImage] = await attachImageUrls([service]);
  return withImage;
}

/**
 * Parse the availability column for display.
 *
 * mysql2 already returns a JSON column as an object, but the column is nullable and older
 * rows could hold a string, so this normalises both and never throws on bad data -- a listing
 * with unreadable availability should still render everything else.
 */
function parseAvailability(value) {
  if (!value) {
    return null;
  }

  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || !Array.isArray(parsed.days)) {
      return null;
    }
    return { days: parsed.days, hours: parsed.hours || null };
  } catch {
    return null;
  }
}

module.exports = { search, findVisibleService, paginate, parseAvailability };
