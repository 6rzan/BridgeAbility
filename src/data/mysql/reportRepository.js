'use strict';

const { query } = require('./pool');





async function bookingsByStatus() {
  const rows = await query('SELECT status, COUNT(*) AS total FROM bookings GROUP BY status');
  return Object.fromEntries(rows.map((row) => [row.status, row.total]));
}


async function providersByStatus() {
  const rows = await query('SELECT status, COUNT(*) AS total FROM providers GROUP BY status');
  return Object.fromEntries(rows.map((row) => [row.status, row.total]));
}


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
