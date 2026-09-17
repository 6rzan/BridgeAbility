'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));
const TABLE_NAME = process.env.DDB_TIMELINE_TABLE;

async function listEvents(bookingId) {
  const result = await client.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': `BOOKING#${bookingId}` },
    ScanIndexForward: true,
    ConsistentRead: true,
  }));

  return result.Items || [];
}

function parseBookingId(pathParameters) {
  const raw = pathParameters && pathParameters.bookingId;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== String(raw)) {
    return null;
  }
  return parsed;
}

exports.handler = async (apiEvent) => {
  const bookingId = parseBookingId(apiEvent.pathParameters);

  if (bookingId === null) {
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'bookingId must be a positive integer' }),
    };
  }

  try {
    const items = await listEvents(bookingId);
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timeline: items }),
    };
  } catch (error) {
    console.error('[timeline-lambda] query failed', { bookingId, error: error.message });
    return {
      statusCode: 502,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Could not read the booking timeline.' }),
    };
  }
};

exports.parseBookingId = parseBookingId;
exports.listEvents = listEvents;
