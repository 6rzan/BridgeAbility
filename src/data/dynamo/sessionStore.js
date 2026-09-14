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





function expiryEpochSeconds(session, nowMs = Date.now()) {
  const maxAgeMs = session && session.cookie ? session.cookie.maxAge : null;
  const seconds = Number.isFinite(maxAgeMs) && maxAgeMs > 0
    ? Math.ceil(maxAgeMs / 1000)
    : config.session.ttlSeconds;

  return Math.floor(nowMs / 1000) + seconds;
}



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



  touch(sessionId, session, callback) {
    this.client
      .send(new UpdateCommand({
        TableName: this.tableName,
        Key: { sessionId },
        UpdateExpression: 'SET expiresAt = :expiresAt',

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
