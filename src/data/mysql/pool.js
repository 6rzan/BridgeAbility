'use strict';

const mysql = require('mysql2/promise');
const config = require('../../config');



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


async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}



async function queryEscaped(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}



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


async function ping() {
  await pool.query('SELECT 1');
}

module.exports = { pool, query, queryEscaped, withTransaction, ping };
