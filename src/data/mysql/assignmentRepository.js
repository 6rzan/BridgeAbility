'use strict';

const { query, queryEscaped, withTransaction } = require('./pool');

/**
 * Data access for a coordinator assigning a volunteer to a confirmed booking (F7) and recording
 * how it finished (F8).
 *
 * NO PER-ROW OWNERSHIP. Unlike bookingRepository or providerServiceRepository, nothing here is
 * keyed on the signed-in coordinator's own id -- any coordinator may act on any booking, which
 * is what the role guard (requireRole('coordinator')) on the router is for. There is no
 * "this coordinator's bookings" concept anywhere in the schema, the same choice F5/F6 already
 * made for administrators.
 *
 * ONE FILE, TWO FUNCTIONALITIES. F7 (assign) and F8 (log completion) act on the same row -- one
 * `assignments` per booking -- and share the same detail page, so they share this repository the
 * same way F3 houses seven actions on one resource in one file. `docs/crud-matrix.md` still
 * carries two separate sections so attribution at the documentation layer stays exact.
 */

// Every row a coordinator needs to see, whichever of the three buckets it is in. The LEFT JOIN
// to `assignments` is what makes one query cover "not yet assigned" as well as "assigned" and
// "completed" -- an unassigned booking simply comes back with every assignment column NULL.
const LIST_COLUMNS = `
  b.booking_id, b.status, b.requested_datetime, b.created_at,
  s.service_id, s.title,
  p.provider_id, p.org_name,
  u.full_name AS requester_name, u.phone AS requester_phone,
  a.assignment_id, a.volunteer_name, a.volunteer_contact, a.assigned_at,
  a.completion_status, a.completed_at
`;

/**
 * The three states a booking can be in from a coordinator's point of view. `bookings.status`
 * is the source of truth for which bucket a booking falls into -- it is set by the same
 * transaction that writes the `assignments` row (see createAssignment/updateCompletion), so
 * there is never a second query needed to work out which of the three a booking belongs to.
 */
const VIEW_STATUS = {
  awaiting: 'accepted',
  assigned: 'assigned',
  completed: 'completed',
};
const VIEWS = Object.keys(VIEW_STATUS);

/** One page of one bucket, newest confirmed booking first. */
async function findForCoordinator({ view, limit, offset }) {
  return queryEscaped(
    `SELECT ${LIST_COLUMNS}
       FROM bookings b
       JOIN services s  ON s.service_id  = b.service_id
       JOIN providers p ON p.provider_id = s.provider_id
       JOIN users u     ON u.user_id     = b.requester_id
       LEFT JOIN assignments a ON a.booking_id = b.booking_id
      WHERE b.status = ?
      ORDER BY b.created_at DESC
      LIMIT ? OFFSET ?`,
    [VIEW_STATUS[view], limit, offset]
  );
}

/** Total for the pagination links, under the same bucket as the page itself. */
async function countForCoordinator({ view }) {
  const rows = await query('SELECT COUNT(*) AS total FROM bookings WHERE status = ?', [
    VIEW_STATUS[view],
  ]);
  return rows[0].total;
}

/** How many bookings sit in each of the three buckets, for the tab bar's counts. */
async function countsByView() {
  const rows = await query(
    `SELECT status, COUNT(*) AS total
       FROM bookings
      WHERE status IN (?, ?, ?)
      GROUP BY status`,
    Object.values(VIEW_STATUS)
  );
  const byStatus = Object.fromEntries(rows.map((row) => [row.status, row.total]));

  return Object.fromEntries(VIEWS.map((view) => [view, byStatus[VIEW_STATUS[view]] || 0]));
}

/**
 * One booking, whichever bucket it is in, with everything the detail page shows: the service,
 * provider, requester, and the assignment if one exists. No ownership filter -- see the file
 * header.
 */
async function findDetail(bookingId) {
  const rows = await query(
    `SELECT ${LIST_COLUMNS},
            s.description, s.location, s.price,
            p.contact AS provider_contact,
            u.email AS requester_email,
            a.completion_notes
       FROM bookings b
       JOIN services s  ON s.service_id  = b.service_id
       JOIN providers p ON p.provider_id = s.provider_id
       JOIN users u     ON u.user_id     = b.requester_id
       LEFT JOIN assignments a ON a.booking_id = b.booking_id
      WHERE b.booking_id = ?
      LIMIT 1`,
    [bookingId]
  );

  return rows[0] || null;
}

/**
 * Assign a volunteer to a confirmed booking.
 *
 * A genuine two-statement compound write -- unlike F4's and F5's single guarded UPDATE, this
 * inserts a new row and flips a status in the same transaction, the same shape as
 * providerServiceRepository.deleteUnbookedService/setImage. `FOR UPDATE` holds the booking row
 * for the length of the transaction, so two coordinators racing on the same booking resolve to
 * whichever gets the lock first; the second sees `status` already moved on and reports
 * 'not-assignable' without ever attempting the insert.
 *
 * The UNIQUE index on `assignments.booking_id` is the backstop behind the lock, not the primary
 * defence -- caught here so a race the lock somehow missed reports the same outcome as one it
 * caught, rather than a 500.
 */
async function createAssignment({ bookingId, assignedBy, volunteerName, volunteerContact }) {
  try {
    return await withTransaction(async (connection) => {
      const [rows] = await connection.query(
        `SELECT booking_id FROM bookings WHERE booking_id = ? AND status = 'accepted' FOR UPDATE`,
        [bookingId]
      );

      if (rows.length === 0) {
        return { outcome: 'not-assignable' };
      }

      await connection.query(
        `INSERT INTO assignments (booking_id, volunteer_name, volunteer_contact, assigned_by)
         VALUES (?, ?, ?, ?)`,
        [bookingId, volunteerName, volunteerContact, assignedBy]
      );

      await connection.query(
        `UPDATE bookings SET status = 'assigned' WHERE booking_id = ? AND status = 'accepted'`,
        [bookingId]
      );

      return { outcome: 'assigned' };
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return { outcome: 'already-assigned' };
    }
    throw error;
  }
}

/**
 * Record how an assignment finished.
 *
 * `completed` is terminal: once set, `FOR UPDATE` still takes the lock but the guard below
 * refuses to move a completed assignment anywhere else, the same "no further change accepted"
 * rule cancelPending and setProviderDecision already enforce with a plain WHERE clause -- here
 * it has to be inside the transaction because the compound write (assignment row and
 * `bookings.status` together) is what has to stay atomic, not the check alone.
 *
 * `pending` and `in_progress` may move freely either direction; that covers an ordinary
 * mis-click correction without a fuller forward-only state machine nobody asked for.
 */
async function updateCompletion(bookingId, { completionStatus, completionNotes }) {
  return withTransaction(async (connection) => {
    const [rows] = await connection.query(
      `SELECT completion_status FROM assignments WHERE booking_id = ? FOR UPDATE`,
      [bookingId]
    );

    if (rows.length === 0) {
      return { outcome: 'not-assigned' };
    }

    if (rows[0].completion_status === 'completed') {
      return { outcome: 'already-completed' };
    }

    // completedAt is a bound parameter, not NOW()/NULL spliced into the statement -- every
    // caller here is trusted to have validated completionStatus already (it comes off a Zod
    // enum), but this file's own rule is that nothing gets to lean on that from inside a query.
    const completedAt = completionStatus === 'completed' ? new Date() : null;

    await connection.query(
      `UPDATE assignments
          SET completion_status = ?, completion_notes = ?, completed_at = ?
        WHERE booking_id = ?`,
      [completionStatus, completionNotes, completedAt, bookingId]
    );

    if (completionStatus === 'completed') {
      await connection.query(
        `UPDATE bookings SET status = 'completed' WHERE booking_id = ? AND status = 'assigned'`,
        [bookingId]
      );
    }

    return { outcome: completionStatus };
  });
}

module.exports = {
  VIEWS,
  VIEW_STATUS,
  findForCoordinator,
  countForCoordinator,
  countsByView,
  findDetail,
  createAssignment,
  updateCompletion,
};
