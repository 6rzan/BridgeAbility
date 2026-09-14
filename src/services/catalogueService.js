'use strict';

const serviceRepository = require('../data/mysql/serviceRepository');
const { presignGet } = require('../data/s3/client');
const { PER_PAGE } = require('../validation/serviceSchemas');






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



async function attachImageUrls(services) {
  return Promise.all(services.map(async (service) => {
    if (!service.image_s3_key) {
      return { ...service, imageUrl: null };
    }

    try {
      return { ...service, imageUrl: await presignGet(service.image_s3_key) };
    } catch (error) {

      console.error('[catalogue] could not presign image', {
        serviceId: service.service_id,
        key: service.image_s3_key,
        message: error.message,
      });
      return { ...service, imageUrl: null };
    }
  }));
}



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


async function findVisibleService(serviceId) {
  const service = await serviceRepository.findVisibleServiceById(serviceId);
  if (!service) {
    return null;
  }

  const [withImage] = await attachImageUrls([service]);
  return withImage;
}



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
