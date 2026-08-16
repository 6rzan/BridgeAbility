'use strict';

const { query } = require('./pool');

/**
 * Data access for the system-wide activity report (F6).
 *
 * NO PER-ROW OWNERSHIP, same as adminProviderRepository -- every function here summarises the
 * whole platform, not one administrator's slice of it. Each is a single GROUP BY, the same
 * shape as bookingRepository.countByStatusForRequester, just without a WHERE narrowing it to
 * one person.
 */

/** How many bookings sit in each of the six statuses, across every requester and provider. */
async function bookingsByStatus() {
  const rows = await query('SELECT status, COUNT(*) AS total FROM bookings GROUP BY status');
  return Object.fromEntries(rows.map((row) => [row.status, row.total]));
}

/** How many provider registrations sit in each of the three review statuses. */
async function providersByStatus() {
  const rows = await query('SELECT status, COUNT(*) AS total FROM providers GROUP BY status');
  return Object.fromEntries(rows.map((row) => [row.status, row.total]));
}

/** How many volunteer assignments sit in each of the three completion statuses. */
async function assignmentsByCompletionStatus() {
  const rows = await query(
    'SELECT completion_status, COUNT(*) AS total FROM assignments GROUP BY completion_status'
  );
  return Object.fromEntries(rows.map((row) => [row.completion_status, row.total]));
}

module.exports = {
  bookingsByStatus,
  providersByStatus,
  assignmentsByCompletionStatus,
};
