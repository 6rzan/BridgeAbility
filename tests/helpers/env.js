'use strict';

/**
 * Placeholder environment for the unit suite.
 *
 * src/config validates process.env at require time and throws if anything is missing, so a
 * unit test that imports any module reaching config needs these present.
 *
 * These values never reach AWS. The unit suite only imports pure modules -- validation
 * schemas, the CSRF comparison, the authorisation guards, the session store's expiry maths --
 * and none of them opens a connection. Anything that talks to RDS, DynamoDB or S3 is covered
 * by the integration suite, which runs against the deployed environment. There is no local
 * database, local DynamoDB or mocked AWS client anywhere in this project.
 */
const PLACEHOLDERS = {
  NODE_ENV: 'test',
  AWS_REGION: 'us-east-1',
  DB_HOST: 'unit-test.invalid',
  DB_USER: 'unit-test',
  DB_PASSWORD: 'unit-test',
  DB_NAME: 'unit_test',
  S3_BUCKET: 'unit-test',
  DDB_TIMELINE_TABLE: 'unit-test-timeline',
  DDB_SESSIONS_TABLE: 'unit-test-sessions',
  SESSION_SECRET: 'unit-test-session-secret-value-32-chars-min',
};

for (const [key, value] of Object.entries(PLACEHOLDERS)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}
