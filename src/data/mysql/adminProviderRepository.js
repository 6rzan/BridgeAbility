'use strict';

const { query, queryEscaped } = require('./pool');

/**
 * Data access for reviewing provider registrations (F5).
 *
 * NO PER-ROW OWNERSHIP. Unlike bookingRepository or providerServiceRepository, nothing here is
 * keyed on the signed-in administrator's own id -- any administrator may review any provider,
 * which is what the role guard (requireRole('admin')) on the router is for. There is no
 * "this admin's providers" concept anywhere in the schema.
 */

const LIST_COLUMNS = `
  p.provider_id, p.org_name, p.description, p.contact, p.verification_doc_s3_key,
  p.status, p.reviewed_by, p.reviewed_at, p.created_at,
  p.user_id,
  u.full_name AS applicant_name, u.email AS applicant_email
`;

/** One page of provider registrations, newest submission first. */
async function listByStatus({ status = null, limit, offset }) {
  const clauses = [];
  const params = [];

  if (status) {
    clauses.push('p.status = ?');
    params.push(status);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  return queryEscaped(
    `SELECT ${LIST_COLUMNS}
       FROM providers p
       JOIN users u ON u.user_id = p.user_id
      ${where}
      ORDER BY p.created_at ASC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
}

/** Total for the pagination links, under the same filter as the page itself. */
async function countByStatus({ status = null }) {
  const clauses = [];
  const params = [];

  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = await query(`SELECT COUNT(*) AS total FROM providers ${where}`, params);
  return rows[0].total;
}

/** How many registrations sit in each review status, for the filter menu's counts. */
async function countAllByStatus() {
  const rows = await query('SELECT status, COUNT(*) AS total FROM providers GROUP BY status');
  return Object.fromEntries(rows.map((row) => [row.status, row.total]));
}

/** One registration, with the reviewer's name once it has been decided. */
async function findById(providerId) {
  const rows = await query(
    `SELECT ${LIST_COLUMNS}, r.full_name AS reviewer_name
       FROM providers p
       JOIN users u ON u.user_id = p.user_id
       LEFT JOIN users r ON r.user_id = p.reviewed_by
      WHERE p.provider_id = ?
      LIMIT 1`,
    [providerId]
  );

  return rows[0] || null;
}

/**
 * Approve or reject a registration.
 *
 * A single guarded UPDATE, not a transaction -- one write with no second statement to keep
 * atomic with it, the same shape as bookingRepository.cancelPending and
 * bookingRepository.setProviderDecision. Two administrators opening the same pending
 * registration and clicking Approve and Reject a moment apart resolve to whichever commits
 * first; the loser's UPDATE matches zero rows.
 */
async function decide(providerId, reviewerId, decision) {
  const result = await query(
    `UPDATE providers
        SET status = ?, reviewed_by = ?, reviewed_at = NOW()
      WHERE provider_id = ? AND status = 'pending'`,
    [decision, reviewerId, providerId]
  );

  return result.affectedRows === 1;
}

module.exports = {
  listByStatus,
  countByStatus,
  countAllByStatus,
  findById,
  decide,
};
