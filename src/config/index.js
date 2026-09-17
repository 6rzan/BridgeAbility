'use strict';

const { z } = require('zod');

const schema = z.object({
  NODE_ENV: z.enum(['production', 'development', 'test']).default('production'),
  PORT: z.coerce.number().int().positive().default(8080),

  AWS_REGION: z.string().min(1),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().min(1),
  DB_POOL_LIMIT: z.coerce.number().int().positive().default(10),

  S3_BUCKET: z.string().min(1),
  DDB_TIMELINE_TABLE: z.string().min(1),
  DDB_SESSIONS_TABLE: z.string().min(1),

  SNS_BOOKING_EVENTS_TOPIC_ARN: z.string().optional(),

  REPORTS_API_URL: z.string().optional(),

  TIMELINE_API_URL: z.string().optional(),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 8),

  SESSION_COOKIE_SECURE: z.enum(['true', 'false']).default('false'),

  PRESIGN_GET_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  PRESIGN_PUT_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const detail = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${detail}`);
}

const env = parsed.data;

module.exports = {
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  port: env.PORT,
  region: env.AWS_REGION,

  db: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    connectionLimit: env.DB_POOL_LIMIT,
  },

  s3: {
    bucket: env.S3_BUCKET,
    getTtlSeconds: env.PRESIGN_GET_TTL_SECONDS,
    putTtlSeconds: env.PRESIGN_PUT_TTL_SECONDS,
    uploadMaxBytes: env.UPLOAD_MAX_BYTES,
  },

  dynamo: {
    timelineTable: env.DDB_TIMELINE_TABLE,
    sessionsTable: env.DDB_SESSIONS_TABLE,
  },

  sns: {

    bookingEventsTopicArn: env.SNS_BOOKING_EVENTS_TOPIC_ARN || null,
  },

  reports: {
    recentlyCompletedApiUrl: env.REPORTS_API_URL || null,
  },

  timeline: {
    apiUrl: env.TIMELINE_API_URL || null,
  },

  session: {
    secret: env.SESSION_SECRET,
    ttlSeconds: env.SESSION_TTL_SECONDS,
    cookieSecure: env.SESSION_COOKIE_SECURE === 'true',
  },
};
