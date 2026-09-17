'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));
const TABLE_NAME = process.env.DDB_TIMELINE_TABLE;

async function queryCompletedEvents(limit) {
  const result = await client.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'GSI-1',
    KeyConditionExpression: '#status = :status',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':status': 'completed' },
    ScanIndexForward: false,
    Limit: limit,
  }));

  return result.Items || [];
}

function parseLimit(queryStringParameters) {
  const raw = queryStringParameters && queryStringParameters.limit;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 10;
  }
  return Math.min(parsed, 50);
}

exports.handler = async (apiEvent) => {
  try {
    const limit = parseLimit(apiEvent.queryStringParameters);
    const items = await queryCompletedEvents(limit);

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recentlyCompleted: items.map((item) => ({
          bookingId: item.bookingId,
          actorName: item.actorName,
          detail: item.detail,
          occurredAt: item.occurredAt,
        })),
      }),
    };
  } catch (error) {
    console.error('[reports-lambda] query failed', { error: error.message });
    return {
      statusCode: 502,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Could not read the completed-bookings report.' }),
    };
  }
};

exports.parseLimit = parseLimit;
exports.queryCompletedEvents = queryCompletedEvents;
