'use strict';

const { query, queryEscaped } = require('./pool');

const LIST_COLUMNS = `
  p.provider_id, p.org_name, p.description, p.contact, p.verification_doc_s3_key,
  p.status, p.reviewed_by, p.reviewed_at, p.created_at,
  p.user_id,
  u.full_name AS applicant_name, u.email AS applicant_email
`;

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

async function countAllByStatus() {
  const rows = await query('SELECT status, COUNT(*) AS total FROM providers GROUP BY status');
  return Object.fromEntries(rows.map((row) => [row.status, row.total]));
}

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
