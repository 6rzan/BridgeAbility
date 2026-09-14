'use strict';

const AWSXRay = require('aws-xray-sdk-core');
const captureMySQL = require('aws-xray-sdk-mysql');

/**
 * X-Ray setup. Required once from app.js, before any AWS client is constructed, so every
 * later `new DynamoDBClient(...)` / `new S3Client(...)` / mysql2 pool picks up tracing.
 *
 * WHY setContextMissingStrategy IS SET EXPLICITLY
 *
 * By default the SDK *throws* when a captured client is called with no X-Ray segment open in
 * the current async context (see "Context Missing Strategy" in aws-xray-sdk-core's README).
 * That default is not survivable here: /health is deliberately mounted before
 * xrayExpress.openSegment in app.js (health must not depend on the session layer, and by the
 * same reasoning must not depend on request tracing either -- see app.js's own comment on
 * why healthRoutes is mounted first). Left at the default, every health check's RDS/DynamoDB/S3
 * probe would throw and the load balancer would take every instance out of rotation on the
 * first poll. LOG_ERROR logs instead and falls through to the real, untraced call -- which is
 * already how aws-xray-sdk-mysql's own capture behaves with no segment open (it has its own
 * built-in fallback, unaffected by this setting, confirmed by reading its source directly).
 *
 * EXPECTED LOG NOISE: every /health poll logs one "Failed to get the current sub/segment from
 * the context" [ERROR] line for the DynamoDB probe and one for the S3 probe (not RDS -- the
 * mysql2 capture's fallback logs at info level, not error). This is that fallback working
 * exactly as designed, not a fault -- verified directly by booting the app and hitting /health
 * with no AWS credentials available (see docs/task2-plan.md, Day 1). Filter these two lines
 * out of any log-based error-rate metric for Section 3, or /health's own design -- reporting
 * each dependency separately rather than masking a failure -- will read as an application
 * fault it is not.
 */
AWSXRay.setContextMissingStrategy('LOG_ERROR');

/**
 * Patches the mysql2 module's shared Pool/Connection prototypes so query(), execute() and
 * getConnection() are all traced -- confirmed directly against both packages' source, not
 * assumed from the (mysql-only, callback-only) usage examples in aws-xray-sdk-mysql's README:
 *
 *  - src/data/mysql/pool.js creates its pool via `require('mysql2/promise').createPool(...)`.
 *    mysql2/promise's PromisePool wraps a plain mysql2.Pool instance and calls that instance's
 *    own .query()/.execute() methods internally (verified: pp.pool.query ===
 *    mysql2.Pool.prototype.query), so patching mysql2's prototype here, before pool.js ever
 *    runs, instruments the promise layer too.
 *  - aws-xray-sdk-mysql's patchObject() (lib/mysql_p.js) explicitly patches both .query AND
 *    .execute -- the prepared-statement path pool.js's own `query()` helper uses for nearly
 *    every read and write in the app, not just the text-protocol path `queryEscaped()` uses
 *    for pagination. Skipping this check would have left most of the app's real traffic
 *    silently untraced.
 */
captureMySQL(require('mysql2'));

module.exports = AWSXRay;
