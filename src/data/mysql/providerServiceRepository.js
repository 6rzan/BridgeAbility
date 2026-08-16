'use strict';

const { query, withTransaction } = require('./pool');

/**
 * Data access for a provider's own listings (F3).
 *
 * AUTHORIZATION LIVES IN THE WHERE CLAUSE
 *
 * The same rule as bookingRepository, for the same reason. There is no function here that
 * reads or writes a service by `service_id` alone: every statement is keyed on the service
 * AND the provider who owns it. A provider who edits the id in `/provider/services/7/edit`
 * gets nothing back from the database, so the controller answers 404 without ever having had
 * the chance to forget a check. The role guard on the router stops the wrong *kind* of user;
 * this stops the right kind of user reaching the wrong row, which is the harder half.
 *
 * `provider_id` itself never comes from a request. It is resolved from the signed-in user's
 * id by findProviderByUserId below, so there is no field in any form that names it.
 */

// What the provider's own list shows. Wider than the public catalogue's columns: a provider
// sees their withdrawn listings and their booking counts, neither of which is public.
const OWN_COLUMNS = `
  s.service_id, s.provider_id, s.title, s.category, s.description, s.price, s.location,
  s.availability_json, s.image_s3_key, s.image_alt_text, s.is_active, s.created_at
`;

/** The provider record behind a signed-in user, or null if the account has none. */
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

/**
 * Every listing this provider owns, newest first, each with the number of bookings against it.
 *
 * The booking count is not decoration: it decides whether a listing can be deleted or only
 * withdrawn (see deleteUnbookedService), so the page can say which of the two it is offering
 * before the provider clicks anything.
 *
 * A LEFT JOIN with GROUP BY rather than a correlated subquery per row, so the count comes back
 * in the same pass through idx_bookings_service.
 */
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

/** One listing, but only if this provider owns it. Null is the answer to both "no" questions. */
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

/**
 * Publish a new listing.
 *
 * A listing starts active. It is still invisible to requesters until an administrator approves
 * the organisation (F5) — that half of the visibility rule lives in the catalogue's WHERE
 * clause, not here — so "active" means "the provider is offering it", which is the only part
 * of the decision that belongs to the provider.
 */
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

/**
 * Edit a listing. Returns false when the row does not belong to this provider, which the
 * controller turns into a 404 — the same answer as a listing that does not exist.
 *
 * The image columns are untouched here on purpose: an image is attached and removed by its own
 * routes, so a provider correcting a typo in the price cannot drop the photograph as a side
 * effect of a form that did not carry it.
 */
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

/**
 * Withdraw a listing from the catalogue, or put it back.
 *
 * This is the reversible half of "remove a listing". `is_active = 0` takes it out of every
 * public query immediately while leaving the bookings already made against it intact and
 * readable by the requesters who made them.
 */
async function setActive(serviceId, providerId, isActive) {
  const result = await query(
    `UPDATE services SET is_active = ? WHERE service_id = ? AND provider_id = ?`,
    [isActive ? 1 : 0, serviceId, providerId]
  );
  return result.affectedRows === 1;
}

/**
 * Delete a listing outright — but only one nobody has ever booked.
 *
 * WHY THE GUARD IS IN THE STATEMENT
 *
 * `bookings.service_id` is declared ON DELETE CASCADE. Deleting a service that has bookings
 * would therefore not fail: it would silently delete other people's booking history along with
 * it, and a requester would find a booking they were tracking simply gone. The NOT EXISTS is
 * what stands between an ordinary "delete this listing" click and that outcome.
 *
 * It runs inside a transaction so the check and the delete cannot be separated by a booking
 * arriving in between: the SELECT ... FOR SHARE holds the service row long enough that a
 * concurrent INSERT into bookings — which must read that row to satisfy its foreign key —
 * waits behind it. A read-then-delete outside a transaction has a window where a booking made
 * in that instant is cascaded away.
 *
 * Returns the outcome rather than a boolean, because "you own it but it has bookings" is a
 * different thing to tell the provider than "no such listing".
 */
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

    // Handed back so the caller can delete the object from S3 after MySQL has committed.
    return { outcome: 'deleted', imageKey: owned[0].image_s3_key };
  });
}

/**
 * Attach an uploaded image, returning the key it replaced so the caller can delete the old
 * object from S3. Alt text and key are written together — the schema will not let one arrive
 * without the other, and neither will this statement.
 */
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

/** Remove the image from a listing, returning the key so the object can be deleted too. */
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
