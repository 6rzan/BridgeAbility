'use strict';

const { query } = require('./pool');

/**
 * Data access for users and their provider records.
 *
 * Every statement below uses `?` placeholders and passes values separately, so the driver
 * sends the SQL and the data apart and a value can never be parsed as SQL. There is no string
 * concatenation into a query anywhere in this file, by rule.
 */

// Columns the application reads about a signed-in user. `password_hash` is listed explicitly
// only where a password is actually being verified, so it cannot leak into a view by accident
// through a `SELECT *`.
const PUBLIC_COLUMNS = `
  u.user_id, u.full_name, u.email, u.role, u.phone,
  u.accessibility_needs, u.created_at, u.is_active
`;

/** Used by sign-in. The only query that returns the hash. */
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

/**
 * Reloads the user on every request that needs current data. The session snapshot is enough
 * for routing, but anything acting on a user's behalf reads the row, so an account
 * deactivated or a provider approved mid-session takes effect without a re-login.
 */
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

/**
 * Creates the user and, for a provider, their pending provider record in one transaction.
 *
 * The caller supplies the connection because these two inserts must not half-succeed: a
 * provider user with no provider row could sign in and reach nothing, and would be invisible
 * to the administrator's approval queue.
 */
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

/**
 * New providers start at 'pending' and the column defaults to it -- the status is never taken
 * from the request. A provider becomes visible to requesters only after an administrator
 * approves them in F5.
 */
async function insertProvider(connection, provider) {
  const [result] = await connection.execute(
    `INSERT INTO providers (user_id, org_name, contact)
     VALUES (?, ?, ?)`,
    [provider.userId, provider.orgName, provider.contact]
  );
  return result.insertId;
}

module.exports = { findAuthRecordByEmail, findById, insertUser, insertProvider };
