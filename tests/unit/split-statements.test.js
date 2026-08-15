'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { splitStatements } = require('../../db/run-migrations');

// These cases are not hypothetical. A naive split on ';' shipped to Elastic Beanstalk and
// failed the deploy: seed.sql contains accessibility notes such as "Deaf; communicates in
// Malaysian Sign Language", and cutting at that semicolon produced a truncated statement.
test('does not split on a semicolon inside a single-quoted string', () => {
  const sql = "INSERT INTO users (note) VALUES ('Deaf; communicates in MSL');";
  const statements = splitStatements(sql);

  assert.equal(statements.length, 1);
  assert.match(statements[0], /Deaf; communicates in MSL/);
});

test('splits genuine statement terminators', () => {
  const statements = splitStatements('SELECT 1; SELECT 2; SELECT 3;');
  assert.deepEqual(statements, ['SELECT 1', 'SELECT 2', 'SELECT 3']);
});

test('handles a doubled quote used to embed an apostrophe', () => {
  const sql = "INSERT INTO t (v) VALUES ('it''s fine; really'); SELECT 1;";
  const statements = splitStatements(sql);

  assert.equal(statements.length, 2);
  assert.match(statements[0], /it''s fine; really/);
  assert.equal(statements[1], 'SELECT 1');
});

test('handles a backslash-escaped quote', () => {
  const sql = "INSERT INTO t (v) VALUES ('a \\' b; c'); SELECT 2;";
  const statements = splitStatements(sql);

  assert.equal(statements.length, 2);
  assert.equal(statements[1], 'SELECT 2');
});

test('strips line comments, including ones containing a semicolon', () => {
  const sql = '-- a comment; with a semicolon\nSELECT 1;';
  assert.deepEqual(splitStatements(sql), ['SELECT 1']);
});

test('ignores a trailing statement that is only whitespace', () => {
  assert.deepEqual(splitStatements('SELECT 1;\n\n  \n'), ['SELECT 1']);
});

// Guards the real files: every statement must be balanced, which is what the deploy needed.
test('the committed schema and seed split into complete statements', () => {
  for (const file of ['schema.sql', 'seed.sql']) {
    const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'db', file), 'utf8');
    const statements = splitStatements(sql);

    assert.ok(statements.length > 0, `${file} produced no statements`);

    for (const statement of statements) {
      const singleQuotes = (statement.match(/'/g) || []).length;
      assert.equal(
        singleQuotes % 2,
        0,
        `${file}: unbalanced quotes, statement was cut mid-string: ${statement.slice(0, 90)}`
      );
    }
  }
});
