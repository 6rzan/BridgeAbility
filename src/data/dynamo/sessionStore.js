'use strict';

const { Store } = require('express-session');
const {
  GetCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');

const { documentClient } = require('./client');
const config = require('../../config');

/**
 * An express-session store backed by Amazon DynamoDB.
 *
 * WHY SESSIONS LIVE IN DYNAMODB AND NOT IN THE PROCESS OR IN MYSQL
 *
 *  1. express-session's default MemoryStore keeps sessions in the Node process. Phase F puts
 *     this application behind a load balancer across two Availability Zones, and the moment a
 *     user's second request lands on the other instance their session would be gone. Sticky
 *     sessions only hide that, and they still lose every session when an instance is replaced
 *     during a deploy or scale-in.
 *
 *  2. A session is an ephemeral key/value item read by primary key on literally every request
 *     and thrown away on expiry. That is the shape DynamoDB is built for: single-digit
 *     millisecond point reads, no joins, no schema. Putting it in MySQL would add a write to
 *     the relational tier on every page view and leave us hand-rolling a cleanup job.
 *
 *  3. TTL does the cleanup. We set `expiresAt` and DynamoDB deletes expired items for free,
 *     with no scheduled task to write, deploy or monitor.
 *
 * WHY THIS IS ~90 LINES OF OUR OWN CODE RATHER THAN `connect-dynamodb`
 *
 * The store is four methods over three SDK calls. Writing it means every member can open this
 * file and explain what happens to a session, which a dependency would not allow.
 *
 * Store contract: https://github.com/expressjs/session#session-store-implementation
 * (accessed 16 August 2026)
 */

/** Convert an express-session cookie lifetime into an absolute epoch-seconds expiry. */
function expiryEpochSeconds(session, nowMs = Date.now()) {
  const maxAgeMs = session && session.cookie ? session.cookie.maxAge : null;
  const seconds = Number.isFinite(maxAgeMs) && maxAgeMs > 0
    ? Math.ceil(maxAgeMs / 1000)
    : config.session.ttlSeconds;

  return Math.floor(nowMs / 1000) + seconds;
}

/**
 * DynamoDB's TTL sweeper is asynchronous and AWS documents deletion as typically happening
 * within a few days of the expiry time, not at it. An expired item is therefore still
 * readable, so the store must enforce expiry itself rather than trusting TTL to have removed
 * it. TTL is a housekeeping mechanism, not an access control.
 *
 * https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/howitworks-ttl.html
 * (accessed 16 August 2026)
 */
function isExpired(item, nowMs = Date.now()) {
  if (!item || typeof item.expiresAt !== 'number') {
    return true;
  }
  return item.expiresAt * 1000 <= nowMs;
}

class DynamoSessionStore extends Store {
  constructor({ client = documentClient, tableName = config.dynamo.sessionsTable } = {}) {
    super();
    this.client = client;
    this.tableName = tableName;
  }

  /**
   * Reads are strongly consistent. Sign-in writes the session and immediately redirects, and
   * the browser's very next request reads it back; an eventually consistent read can miss a
   * write that recent and would log the user straight back out.
   */
  get(sessionId, callback) {
    this.client
      .send(new GetCommand({
        TableName: this.tableName,
        Key: { sessionId },
        ConsistentRead: true,
      }))
      .then(({ Item }) => {
        if (isExpired(Item)) {
          return callback(null, null);
        }
        return callback(null, JSON.parse(Item.data));
      })
      .catch((error) => {
        // A corrupt item must not lock a user out of the site forever. Treat it as no
        // session, which sends them to sign-in, and log it for us.
        if (error instanceof SyntaxError) {
          console.error('[session] unparseable session item, discarding', { sessionId });
          return callback(null, null);
        }
        return callback(error);
      });
  }

  set(sessionId, session, callback) {
    this.client
      .send(new PutCommand({
        TableName: this.tableName,
        Item: {
          sessionId,
          data: JSON.stringify(session),
          expiresAt: expiryEpochSeconds(session),
          updatedAt: new Date().toISOString(),
        },
      }))
      .then(() => callback(null))
      .catch(callback);
  }

  /**
   * Called on every request of an unchanged session because the cookie is rolling. Updating
   * only `expiresAt` avoids rewriting the whole session payload just to push the clock
   * forward, which is the difference between a small update and a full item write per page.
   */
  touch(sessionId, session, callback) {
    this.client
      .send(new UpdateCommand({
        TableName: this.tableName,
        Key: { sessionId },
        UpdateExpression: 'SET expiresAt = :expiresAt',
        // Do not resurrect a session that has already been signed out or swept away.
        ConditionExpression: 'attribute_exists(sessionId)',
        ExpressionAttributeValues: { ':expiresAt': expiryEpochSeconds(session) },
      }))
      .then(() => callback(null))
      .catch((error) => {
        if (error.name === 'ConditionalCheckFailedException') {
          return callback(null);
        }
        return callback(error);
      });
  }

  destroy(sessionId, callback) {
    this.client
      .send(new DeleteCommand({ TableName: this.tableName, Key: { sessionId } }))
      .then(() => callback(null))
      .catch(callback);
  }
}

module.exports = DynamoSessionStore;
module.exports.expiryEpochSeconds = expiryEpochSeconds;
module.exports.isExpired = isExpired;
