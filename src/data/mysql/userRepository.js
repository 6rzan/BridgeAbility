'use strict';

const { query } = require('./pool');

const PUBLIC_COLUMNS = `
  u.user_id, u.full_name, u.email, u.role, u.phone,
  u.accessibility_needs, u.created_at, u.is_active
`;

async function findAuthRecordByEmail(email) {
  const rows = await query(
    `SELECT u.user_id, u.full_name, u.email, u.role, u.password_hash, u.is_active
       FROM users u
      WHERE u.email = ?
      LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

async function findById(userId) {
  const rows = await query(
    `SELECT ${PUBLIC_COLUMNS},
            p.provider_id, p.org_name, p.status AS provider_status
       FROM users u
       LEFT JOIN providers p ON p.user_id = u.user_id
      WHERE u.user_id = ?
      LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function insertUser(connection, user) {
  const [result] = await connection.execute(
    `INSERT INTO users (full_name, email, password_hash, role, phone, accessibility_needs)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      user.fullName,
      user.email,
      user.passwordHash,
      user.role,
      user.phone,
      user.accessibilityNeeds,
    ]
  );
  return result.insertId;
}

async function insertProvider(connection, provider) {
  const [result] = await connection.execute(
    `INSERT INTO providers (user_id, org_name, contact)
     VALUES (?, ?, ?)`,
    [provider.userId, provider.orgName, provider.contact]
  );
  return result.insertId;
}

module.exports = { findAuthRecordByEmail, findById, insertUser, insertProvider };
