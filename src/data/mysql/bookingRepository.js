'use strict';

const { query, queryEscaped, withTransaction } = require('./pool');

/**
 * Data access for a requester's own bookings (F2).
 *
 * AUTHORIZATION LIVES IN THE WHERE CLAUSE
 *
 * Every read and write below is keyed on the booking AND the requester who owns it. There is
 * no function here that fetches a booking by id alone, so a controller cannot accidentally
 * hand one user another user's booking by forgetting a check -- the query simply returns
 * nothing. Changing /bookings/4 to /bookings/5 in the address bar is the first thing anyone
 * tries, and the answer has to be a 404 from the database, not a hidden link in a template.
 */

// The requester's view of a booking. The provider's own contact details are deliberately not
// here: they are on the detail page only, and only once the provider has accepted.
const LIST_COLUMNS = `
  b.booking_id, b.status, b.requested_datetime, b.notes, b.created_at, b.updated_at,
  s.service_id, s.title, s.category, s.price, s.location,
  p.provider_id, p.org_name
`;

/**
 * Create a booking, or return the one this submission already created.
 *
 * IDEMPOTENCY. `request_key` is generated once when the form is rendered and carries a UNIQUE
 * index. A double-click, a refresh on the POST, or a retry over a flaky mobile connection all
 * arrive with the same key, so the second insert raises ER_DUP_ENTRY and we return the row the
 * first one made. Without this a requester with a slow connection books the same interpreter
 * three times and a provider has to sort it out.
 *
 * The insert runs inside a transaction with the visibility re-check, so a service that is
 * withdrawn between loading the form and submitting it cannot be booked: the SELECT ... FOR
 * SHARE holds the row long enough for the INSERT to be consistent with it.
 */
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

/** Used only to resolve a duplicate submission back to the booking it already made. */
async function findByRequestKey(requestKey, requesterId) {
  const rows = await query(
    'SELECT booking_id FROM bookings WHERE request_key = ? AND requester_id = ? LIMIT 1',
    [requestKey, requesterId]
  );
  return rows[0] || null;
}

/**
 * One requester's bookings, newest request first.
 *
 * Reads through idx_bookings_requester(requester_id, status): the requester_id narrows to one
 * person's rows and the status, when given, is satisfied by the same index rather than by a
 * filesort over everything they have ever booked.
 */
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

/** Total for the pagination links, under the same filter as the page itself. */
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

/** How many bookings sit in each status, for the filter menu's counts. */
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

/**
 * One booking, but only if this requester owns it.
 *
 * The provider's contact details come back only once the booking is accepted or beyond. A
 * pending request is not a way to extract a phone number from a listing.
 */
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

/**
 * Cancel a booking the provider has not answered yet.
 *
 * The status guard is in the UPDATE, not in a read-then-write around it. Two tabs both showing
 * a pending booking, or a cancel arriving at the same moment as the provider's acceptance,
 * resolve to whichever statement commits first; the loser matches zero rows and is told the
 * booking has moved on. A SELECT followed by an UPDATE would let the second one overwrite the
 * first, which is how a requester cancels a booking a volunteer is already travelling to.
 */
async function cancelPending(bookingId, requesterId) {
  const result = await query(
    `UPDATE bookings
        SET status = 'cancelled'
      WHERE booking_id = ? AND requester_id = ? AND status = 'pending'`,
    [bookingId, requesterId]
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
};
