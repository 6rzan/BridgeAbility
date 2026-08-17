'use strict';




const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');


const ALREADY_APPLIED = new Set(['ER_DUP_KEYNAME', 'ER_DUP_FIELDNAME']);



function splitStatements(sql) {
  const withoutLineComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  const statements = [];
  let current = '';
  let quote = null;

  for (let i = 0; i < withoutLineComments.length; i += 1) {
    const char = withoutLineComments[i];

    if (quote) {
      current += char;
      if (char === '\\') {

        current += withoutLineComments[i + 1] ?? '';
        i += 1;
      } else if (char === quote) {
        if (withoutLineComments[i + 1] === quote) {
          current += quote;
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
    } else {
      await runFile(connection, 'seed.sql');
      console.log('[migrate] seed applied');
    }


    await runPatches(connection);
  } finally {
    await connection.end();
  }
}


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
