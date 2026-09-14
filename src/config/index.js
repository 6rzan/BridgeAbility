'use strict';

const { z } = require('zod');

/**
 * Environment-driven configuration. Zero literals, no local-development branch.
 *
 * Real values are supplied as Elastic Beanstalk environment properties. Credentials for AWS
 * itself are NEVER read from here -- the SDK resolves them from the EC2 instance profile
 * (LabInstanceProfile -> LabRole), so no access key exists anywhere in this repo.
 *
 * This module fails fast: a missing or malformed variable stops the process at boot rather
 * than surfacing as a confusing runtime error on a request.
 */
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

  // Task 2, MS-1 (docs/task2-plan.md). Optional and unset on the Task 1 baseline environment on
  // purpose: a booking accept/reject or a provider approve/reject must keep working exactly as
  // it does today even where this microservice has not been deployed, the same "must not fail
  // the user's action" principle bookingService.appendEventSafely already applies to the
  // DynamoDB timeline append. See src/services/notificationPublisher.js.
  SNS_BOOKING_EVENTS_TOPIC_ARN: z.string().optional(),

  // Task 2, MS-2 (docs/task2-plan.md). Optional for the same reason: the Task 1 baseline
  // environment never sets it, and src/services/reportsGateway.js falls back to the monolith's
  // own direct DynamoDB query (the pre-Task-2 behaviour) whenever it is unset or unreachable.
  REPORTS_API_URL: z.string().optional(),

  // Task 2, MS-3 (docs/task2-plan.md). Same optional-and-falls-back shape as REPORTS_API_URL,
  // for the same reason: see src/services/timelineGateway.js.
  TIMELINE_API_URL: z.string().optional(),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 8),

  // Sets the Secure attribute on the session and CSRF cookies, which tells the browser to
  // send them over HTTPS only. It is a variable rather than a hardcoded `true` because a
  // Secure cookie is silently dropped over plain HTTP, which would break sign-in outright.
  //
  // Our Beanstalk environment is reached at its *.elasticbeanstalk.com CNAME, and ACM will
  // only issue a certificate for a domain whose ownership you can prove. We do not own that
  // domain, so no certificate can be attached and the load balancer has no HTTPS listener.
  // Put a certificate and a custom domain in front and this becomes SESSION_COOKIE_SECURE=true
  // with no code change. Everything else about the cookies -- HttpOnly, SameSite=Lax, signed,
  // server-side expiry -- is already in force.
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
    // null, not '', when unset -- callers check this with a plain truthiness test.
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
