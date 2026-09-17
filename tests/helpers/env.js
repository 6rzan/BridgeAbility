'use strict';

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

  SESSION_SECRET: 'unit-test-placeholder-not-a-real-secret-value',
};

for (const [key, value] of Object.entries(PLACEHOLDERS)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}
