'use strict';

/**
 * Applies db/schema.sql and, on an empty database, db/seed.sql.
 *
 * This runs ON AWS, from the Elastic Beanstalk instance inside the VPC -- it is wired into
 * .ebextensions so it executes on every deploy. That is not a convenience: the RDS instance
 * is PubliclyAccessible = false and its security group admits 3306 only from the application
 * security group, so a developer laptop has no route to the database at all. Running
 * migrations from inside the VPC is the only path that exists.
 *
 * Safe to run repeatedly. Schema statements are IF NOT EXISTS; index creation tolerates the
 * duplicate-key-name error MySQL raises when the index is already there; seeding is skipped
 * unless the users table is empty.
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// MySQL has no CREATE INDEX ... IF NOT EXISTS, so a re-run raises these. Both mean
// "already applied", which is exactly the state we want.
const ALREADY_APPLIED = new Set(['ER_DUP_KEYNAME', 'ER_DUP_FIELDNAME']);

/**
 * Split a SQL file into executable statements.
 *
 * Splitting naively on ';' is wrong: our seed data legitimately contains semicolons inside
 * string literals (for example an accessibility note reading "Deaf; communicates in Malaysian
 * Sign Language"), and cutting there produces a truncated, unparseable statement. So this
 * tracks whether the cursor is inside a quoted string and only treats a semicolon as a
 * terminator when it is not.
 *
 * Handles single and double quoted strings, backslash escapes, and the SQL convention of
 * doubling a quote to embed it ('it''s').
 */
function splitStatements(sql) {
  const withoutLineComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  const statements = [];
  let current = '';
  let quote = null; // the quote character we are currently inside, or null

  for (let i = 0; i < withoutLineComments.length; i += 1) {
    const char = withoutLineComments[i];

    if (quote) {
      current += char;
      if (char === '\\') {
        // Escape sequence: consume the next character verbatim.
        current += withoutLineComments[i + 1] ?? '';
        i += 1;
      } else if (char === quote) {
        if (withoutLineComments[i + 1] === quote) {
          current += quote; // a doubled quote is a literal quote, not a terminator
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }

    if (char === ';') {
      statements.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  statements.push(current);
  return statements.map((statement) => statement.trim()).filter(Boolean);
}

async function runFile(connection, file) {
  const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const statements = splitStatements(sql);
  let applied = 0;
  let skipped = 0;

  for (const statement of statements) {
    try {
      await connection.query(statement);
      applied += 1;
    } catch (error) {
      if (ALREADY_APPLIED.has(error.code)) {
        skipped += 1;
        continue;
      }
      throw new Error(`${file}: ${error.message}\n  statement: ${statement.slice(0, 160)}`);
    }
  }

  console.log(`[migrate] ${file}: ${applied} applied, ${skipped} already present`);
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: false,
  });

  try {
    await runFile(connection, 'schema.sql');

    const [rows] = await connection.query('SELECT COUNT(*) AS total FROM users');
    if (rows[0].total > 0) {
      console.log(`[migrate] seed skipped — users table already holds ${rows[0].total} rows`);
      return;
    }

    await runFile(connection, 'seed.sql');
    console.log('[migrate] seed applied');
  } finally {
    await connection.end();
  }
}

// Only run when invoked directly, so tests can import splitStatements without connecting
// to a database.
if (require.main === module) {
  main()
    .then(() => {
      console.log('[migrate] complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[migrate] FAILED:', error.message);
      process.exit(1);
    });
}

module.exports = { splitStatements };
