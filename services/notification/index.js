'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { randomUUID } = require('node:crypto');

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));
const TABLE_NAME = process.env.DDB_NOTIFICATIONS_TABLE;

function parseRecord(record) {
  const snsEnvelope = JSON.parse(record.body);
  const event = JSON.parse(snsEnvelope.Message);

  if (!event.eventType || !event.recipientUserId || !event.message) {
    throw new Error(`malformed booking event, missing a required field: ${record.body.slice(0, 200)}`);
  }

  return event;
}

function buildNotificationItem(event) {
  const occurredAt = event.occurredAt || new Date().toISOString();
  return {
    PK: `USER#${event.recipientUserId}`,
    SK: `${occurredAt}#${event.eventType}`,
    notificationId: randomUUID(),
    eventType: event.eventType,
    message: event.message,
    detail: event.detail || {},
    read: false,
    occurredAt,
  };
}

exports.handler = async (sqsEvent) => {
  const batchItemFailures = [];

  for (const record of sqsEvent.Records) {
    try {
      const event = parseRecord(record);
      const item = buildNotificationItem(event);
      await client.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
    } catch (error) {
      console.error('[notification-lambda] failed to process record', {
        messageId: record.messageId,
        error: error.message,
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};

exports.parseRecord = parseRecord;
exports.buildNotificationItem = buildNotificationItem;
