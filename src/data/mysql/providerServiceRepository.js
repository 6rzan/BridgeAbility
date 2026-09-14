'use strict';

const { query, withTransaction } = require('./pool');





const OWN_COLUMNS = `
  s.service_id, s.provider_id, s.title, s.category, s.description, s.price, s.location,
  s.availability_json, s.image_s3_key, s.image_alt_text, s.is_active, s.created_at
`;


async function findProviderByUserId(userId) {
  const rows = await query(
    `SELECT provider_id, org_name, description, contact, status
       FROM providers
      WHERE user_id = ?
      LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}



async function listForProvider(providerId) {
  return query(
    `SELECT ${OWN_COLUMNS}, COUNT(b.booking_id) AS booking_count
       FROM services s
       LEFT JOIN bookings b ON b.service_id = s.service_id
      WHERE s.provider_id = ?
      GROUP BY s.service_id
      ORDER BY s.is_active DESC, s.created_at DESC`,
    [providerId]
  );
}


async function findForProvider(serviceId, providerId) {
  const rows = await query(
    `SELECT ${OWN_COLUMNS},
            (SELECT COUNT(*) FROM bookings b WHERE b.service_id = s.service_id) AS booking_count
       FROM services s
      WHERE s.service_id = ? AND s.provider_id = ?
      LIMIT 1`,
    [serviceId, providerId]
  );
  return rows[0] || null;
}



async function createService(providerId, listing) {
  const result = await query(
    `INSERT INTO services
       (provider_id, title, category, description, price, location, availability_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      providerId,
      listing.title,
      listing.category,
      listing.description,
      listing.price,
      listing.location,
      listing.availabilityJson,
    ]
  );
  return result.insertId;
}



async function updateService(serviceId, providerId, listing) {
  const result = await query(
    `UPDATE services
        SET title = ?, category = ?, description = ?, price = ?, location = ?,
            availability_json = ?
      WHERE service_id = ? AND provider_id = ?`,
    [
      listing.title,
      listing.category,
      listing.description,
      listing.price,
      listing.location,
      listing.availabilityJson,
      serviceId,
      providerId,
    ]
  );
  return result.affectedRows === 1;
}



async function setActive(serviceId, providerId, isActive) {
  const result = await query(
    `UPDATE services SET is_active = ? WHERE service_id = ? AND provider_id = ?`,
    [isActive ? 1 : 0, serviceId, providerId]
  );
  return result.affectedRows === 1;
}



async function deleteUnbookedService(serviceId, providerId) {
  return withTransaction(async (connection) => {
    const [owned] = await connection.query(
      `SELECT service_id, image_s3_key
         FROM services
        WHERE service_id = ? AND provider_id = ?
        FOR SHARE`,
      [serviceId, providerId]
    );

    if (owned.length === 0) {
      return { outcome: 'not-found', imageKey: null };
    }

    const [[{ total }]] = await connection.query(
      'SELECT COUNT(*) AS total FROM bookings WHERE service_id = ?',
      [serviceId]
    );

    if (total > 0) {
      return { outcome: 'has-bookings', bookingCount: total, imageKey: null };
    }

    await connection.query(
      'DELETE FROM services WHERE service_id = ? AND provider_id = ?',
      [serviceId, providerId]
    );


    return { outcome: 'deleted', imageKey: owned[0].image_s3_key };
  });
}



async function setImage(serviceId, providerId, key, altText) {
  return withTransaction(async (connection) => {
    const [rows] = await connection.query(
      `SELECT image_s3_key FROM services WHERE service_id = ? AND provider_id = ? FOR UPDATE`,
      [serviceId, providerId]
    );

    if (rows.length === 0) {
      return { updated: false, previousKey: null };
    }

    await connection.query(
      `UPDATE services SET image_s3_key = ?, image_alt_text = ?
        WHERE service_id = ? AND provider_id = ?`,
      [key, altText, serviceId, providerId]
    );

    return { updated: true, previousKey: rows[0].image_s3_key };
  });
}


async function clearImage(serviceId, providerId) {
  return withTransaction(async (connection) => {
    const [rows] = await connection.query(
      `SELECT image_s3_key FROM services WHERE service_id = ? AND provider_id = ? FOR UPDATE`,
      [serviceId, providerId]
    );

    if (rows.length === 0) {
      return { updated: false, previousKey: null };
    }

    await connection.query(
      `UPDATE services SET image_s3_key = NULL, image_alt_text = NULL
        WHERE service_id = ? AND provider_id = ?`,
      [serviceId, providerId]
    );

    return { updated: true, previousKey: rows[0].image_s3_key };
  });
}

module.exports = {
  findProviderByUserId,
  listForProvider,
  findForProvider,
  createService,
  updateService,
  setActive,
  deleteUnbookedService,
  setImage,
  clearImage,
};
