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

/**
 * Apply every file in db/patches in filename order.
 *
 * Seeding only runs against an empty database, so once an environment has been seeded there
 * is no way to correct or extend that data through seed.sql. Patches fill that gap: they run
 * on every deploy and each one is written to be idempotent, so re-running is a no-op. Ordering
 * by filename is why they are numbered.
 */
async function runPatches(connection) {
  const directory = path.join(__dirname, 'patches');

  if (!fs.existsSync(directory)) {
    return;
  }

  const files = fs.readdirSync(directory)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    await runFile(connection, path.join('patches', file));
  }
}

async function main() {
  const databaseName = process.env.DB_NAME;

  // No `database` here on purpose: a freshly created RDS instance has no schema at all (this
  // project hit exactly that -- an instance whose DBName was null, from a provisioning session
  // that never got past this step), and connecting straight to a database that does not exist
  // yet fails with ER_BAD_DB_ERROR before a single statement runs. Connecting bare and creating
  // the database as this script's own first step means there is no separate manual "create the
  // schema" step for anyone to forget.
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: false,
  });

  try {
    // Backtick-quoted because an identifier cannot be parameterised the way a value can --
    // safe here because databaseName is this app's own DB_NAME environment variable, never
    // user input.
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\``);
    await connection.query(`USE \`${databaseName}\``);

    await runFile(connection, 'schema.sql');

    const [rows] = await connection.query('SELECT COUNT(*) AS total FROM users');
    if (rows[0].total > 0) {
      console.log(`[migrate] seed skipped — users table already holds ${rows[0].total} rows`);
    } else {
      await runFile(connection, 'seed.sql');
      console.log('[migrate] seed applied');
    }

    // Patches run whether or not the database was just seeded, because their job is to
    // correct or extend data in an environment that was seeded on an earlier deploy.
    await runPatches(connection);
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
