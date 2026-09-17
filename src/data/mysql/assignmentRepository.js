'use strict';

const { query, queryEscaped, withTransaction } = require('./pool');

const LIST_COLUMNS = `
  b.booking_id, b.status, b.requested_datetime, b.created_at,
  s.service_id, s.title,
  p.provider_id, p.org_name,
  u.full_name AS requester_name, u.phone AS requester_phone,
  a.assignment_id, a.volunteer_name, a.volunteer_contact, a.assigned_at,
  a.completion_status, a.completed_at
`;

const VIEW_STATUS = {
  awaiting: 'accepted',
  assigned: 'assigned',
  completed: 'completed',
};
const VIEWS = Object.keys(VIEW_STATUS);

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

async function countForCoordinator({ view }) {
  const rows = await query('SELECT COUNT(*) AS total FROM bookings WHERE status = ?', [
    VIEW_STATUS[view],
  ]);
  return rows[0].total;
}

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
