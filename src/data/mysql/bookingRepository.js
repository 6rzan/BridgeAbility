'use strict';

const { query, queryEscaped, withTransaction } = require('./pool');

const LIST_COLUMNS = `
  b.booking_id, b.status, b.requested_datetime, b.notes, b.created_at, b.updated_at,
  s.service_id, s.title, s.category, s.price, s.location,
  p.provider_id, p.org_name
`;

async function createBooking({ serviceId, requesterId, requestedDatetime, notes, requestKey }) {
  try {
    return await withTransaction(async (connection) => {
      const [visible] = await connection.query(
        `SELECT s.service_id
           FROM services s
           JOIN providers p ON p.provider_id = s.provider_id
          WHERE s.service_id = ? AND s.is_active = 1 AND p.status = 'approved'
          FOR SHARE`,
        [serviceId]
      );

      if (visible.length === 0) {
        return { booking: null, created: false, reason: 'unavailable' };
      }

      const [result] = await connection.query(
        `INSERT INTO bookings (service_id, requester_id, requested_datetime, notes, request_key)
         VALUES (?, ?, ?, ?, ?)`,
        [serviceId, requesterId, requestedDatetime, notes, requestKey]
      );

      return { booking: { bookingId: result.insertId }, created: true, reason: null };
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      const existing = await findByRequestKey(requestKey, requesterId);
      if (existing) {
        return { booking: { bookingId: existing.booking_id }, created: false, reason: 'duplicate' };
      }
    }
    throw error;
  }
}

async function findByRequestKey(requestKey, requesterId) {
  const rows = await query(
    'SELECT booking_id FROM bookings WHERE request_key = ? AND requester_id = ? LIMIT 1',
    [requestKey, requesterId]
  );
  return rows[0] || null;
}

async function listForRequester(requesterId, { status = null, limit, offset }) {
  const clauses = ['b.requester_id = ?'];
  const params = [requesterId];

  if (status) {
    clauses.push('b.status = ?');
    params.push(status);
  }

  return queryEscaped(
    `SELECT ${LIST_COLUMNS}
       FROM bookings b
       JOIN services s  ON s.service_id  = b.service_id
       JOIN providers p ON p.provider_id = s.provider_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY b.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
}

async function countForRequester(requesterId, { status = null }) {
  const clauses = ['requester_id = ?'];
  const params = [requesterId];

  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }

  const rows = await query(
    `SELECT COUNT(*) AS total FROM bookings WHERE ${clauses.join(' AND ')}`,
    params
  );

  return rows[0].total;
}

async function countByStatusForRequester(requesterId) {
  const rows = await query(
    `SELECT status, COUNT(*) AS total
       FROM bookings
      WHERE requester_id = ?
      GROUP BY status`,
    [requesterId]
  );

  return Object.fromEntries(rows.map((row) => [row.status, row.total]));
}

async function findForRequester(bookingId, requesterId) {
  const rows = await query(
    `SELECT ${LIST_COLUMNS},
            s.description AS service_description,
            s.image_s3_key, s.image_alt_text,
            CASE WHEN b.status IN ('accepted','assigned','completed') THEN p.contact END AS provider_contact,
            a.volunteer_name, a.volunteer_contact, a.completion_status,
            a.completion_notes, a.completed_at
       FROM bookings b
       JOIN services s     ON s.service_id  = b.service_id
       JOIN providers p    ON p.provider_id = s.provider_id
       LEFT JOIN assignments a ON a.booking_id = b.booking_id
      WHERE b.booking_id = ? AND b.requester_id = ?
      LIMIT 1`,
    [bookingId, requesterId]
  );

  return rows[0] || null;
}

async function cancelPending(bookingId, requesterId) {
  const result = await query(
    `UPDATE bookings
        SET status = 'cancelled'
      WHERE booking_id = ? AND requester_id = ? AND status = 'pending'`,
    [bookingId, requesterId]
  );

  return result.affectedRows === 1;
}

const PROVIDER_LIST_COLUMNS = `
  b.booking_id, b.status, b.requested_datetime, b.notes, b.created_at,
  b.requester_id,
  s.service_id, s.title,
  u.full_name AS requester_name, u.phone AS requester_phone
`;

async function findIncomingForProvider(providerId, { status = null, limit, offset }) {
  const clauses = ['s.provider_id = ?'];
  const params = [providerId];

  if (status) {
    clauses.push('b.status = ?');
    params.push(status);
  }

  return queryEscaped(
    `SELECT ${PROVIDER_LIST_COLUMNS}
       FROM bookings b
       JOIN services s ON s.service_id = b.service_id
       JOIN users u    ON u.user_id    = b.requester_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY b.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
}

async function countIncomingForProvider(providerId, { status = null }) {
  const clauses = ['s.provider_id = ?'];
  const params = [providerId];

  if (status) {
    clauses.push('b.status = ?');
    params.push(status);
  }

  const rows = await query(
    `SELECT COUNT(*) AS total
       FROM bookings b
       JOIN services s ON s.service_id = b.service_id
      WHERE ${clauses.join(' AND ')}`,
    params
  );

  return rows[0].total;
}

async function countByStatusForProvider(providerId) {
  const rows = await query(
    `SELECT b.status, COUNT(*) AS total
       FROM bookings b
       JOIN services s ON s.service_id = b.service_id
      WHERE s.provider_id = ?
      GROUP BY b.status`,
    [providerId]
  );

  return Object.fromEntries(rows.map((row) => [row.status, row.total]));
}

async function findForProvider(bookingId, providerId) {
  const rows = await query(
    `SELECT ${PROVIDER_LIST_COLUMNS},
            s.description AS service_description, s.location, s.price
       FROM bookings b
       JOIN services s ON s.service_id = b.service_id
       JOIN users u    ON u.user_id    = b.requester_id
      WHERE b.booking_id = ? AND s.provider_id = ?
      LIMIT 1`,
    [bookingId, providerId]
  );

  return rows[0] || null;
}

async function setProviderDecision(bookingId, providerId, decision) {
  const result = await query(
    `UPDATE bookings b
       JOIN services s ON s.service_id = b.service_id
        SET b.status = ?
      WHERE b.booking_id = ? AND s.provider_id = ? AND b.status = 'pending'`,
    [decision, bookingId, providerId]
  );

  return result.affectedRows === 1;
}

module.exports = {
  createBooking,
  findByRequestKey,
  listForRequester,
  countForRequester,
  countByStatusForRequester,
  findForRequester,
  cancelPending,
  findIncomingForProvider,
  countIncomingForProvider,
  countByStatusForProvider,
  findForProvider,
  setProviderDecision,
};
