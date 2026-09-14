'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { randomUUID } = require('node:crypto');

/**
 * MS-1's Lambda: consumes the booking-events SQS queue and writes a notification record for
 * each event. Everything before this -- deciding a notification is needed, publishing to SNS --
 * is the monolith's job (src/services/notificationPublisher.js). This function's only job is
 * "one SQS record in, one DynamoDB item out", reliably.
 *
 * No credentials are configured here, the same as every other AWS client in this project -- the
 * Lambda's own execution role (LabRole; the Learner Lab blocks creating custom IAM roles, see
 * CLAUDE.md) supplies them via the standard Lambda credential provider chain.
 */
const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));
const TABLE_NAME = process.env.DDB_NOTIFICATIONS_TABLE;

/**
 * Parses one SQS record into the booking-event envelope
 * src/services/notificationPublisher.js actually published.
 *
 * SNS -> SQS delivery (without "raw message delivery", which this queue's subscription does not
 * use) wraps the real message in an SNS envelope: `record.body` is itself JSON, and
 * `record.body.Message` is a second JSON string underneath that -- the actual
 * `{eventType, recipientUserId, message, detail, occurredAt}` envelope. Two JSON.parse calls,
 * not one; getting this wrong silently drops every message with no error until someone notices
 * the notifications table stays empty.
 *
 * Exported and pure (throws on bad input, makes no AWS call) so this parsing -- the part that is
 * easy to get subtly wrong -- is unit-testable without a mocked SQS or SNS client, per this
 * project's "no mocked AWS client anywhere" rule (CLAUDE.md). The DynamoDB write below it is
 * what the integration test against a real deployed queue and Lambda covers instead.
 */
function parseRecord(record) {
  const snsEnvelope = JSON.parse(record.body);
  const event = JSON.parse(snsEnvelope.Message);

  if (!event.eventType || !event.recipientUserId || !event.message) {
    throw new Error(`malformed booking event, missing a required field: ${record.body.slice(0, 200)}`);
  }

  return event;
}

/**
 * Builds the DynamoDB item for one notification. Pure -- no AWS calls, no randomness beyond the
 * id, straightforward to unit-test.
 *
 * Key design mirrors src/data/dynamo/timelineRepository.js on purpose (same project, same
 * reasoning): PK is the recipient, so "every notification for this user" is one Query; SK is
 * the timestamp, so results come back already in order. There is no GSI here -- nothing in this
 * microservice's own scope needs to query notifications any way other than by recipient.
 */
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

/**
 * SQS-triggered handler.
 *
 * Reports partial batch failures (the event source mapping must have
 * FunctionResponseTypes: ["ReportBatchItemFailures"] configured for this to take effect) so one
 * malformed message in a batch of ten does not force all ten back onto the queue for retry --
 * only the ones that actually failed. Everything that fails ends up back on the queue and,
 * after the configured number of receives, in the dead-letter queue rather than silently lost.
 */
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
