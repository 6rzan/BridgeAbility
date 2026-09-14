'use strict';

const mysql = require('mysql2/promise');
const config = require('../../config');

/**
 * Shared MySQL connection pool against Amazon RDS.
 *
 * The RDS instance is `PubliclyAccessible = false` and its security group admits 3306 only
 * from the application tier's security group, so this pool is reachable exclusively from
 * inside the VPC.
 *
 * Every caller MUST use parameterised queries (`?` placeholders). String-concatenated SQL is
 * forbidden -- see CLAUDE.md.
 */
const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: config.db.connectionLimit,
  queueLimit: 0,
  enableKeepAlive: true,
  timezone: 'Z',
});

/** Run a parameterised query and return the rows. */
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/**
 * Run a parameterised query through the driver's text protocol.
 *
 * `query()` above uses prepared statements, which is what almost everything should use. This
 * variant exists for one specific case: a paginated query whose LIMIT and OFFSET are bound
 * values. mysql2's prepared-statement path and LIMIT placeholders interact badly depending on
 * the driver version, and pagination failing because of a patch release is not a risk worth
 * carrying. The text protocol has no such quirk.
 *
 * The important part: values are still passed separately and escaped by the driver. This is
 * not string concatenation, and the rule in CLAUDE.md still holds -- no caller ever builds SQL
 * by joining user input into a string.
 */
async function queryEscaped(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

/**
 * Run `fn` inside a transaction, committing on success and rolling back on any throw.
 * Used wherever a booking's state changes, so a partial write can never be observed.
 */
async function withTransaction(fn) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Liveness probe used by /health. */
async function ping() {
  await pool.query('SELECT 1');
}

module.exports = { pool, query, queryEscaped, withTransaction, ping };
