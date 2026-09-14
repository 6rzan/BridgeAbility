'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

/**
 * MS-3's Lambda: one booking's history, moved behind API Gateway (Task 2, docs/task2-plan.md).
 *
 * WHY THIS IS CALLED SERVER-SIDE, NOT FETCHED DIRECTLY FROM THE BROWSER
 *
 * The plan for MS-3 originally described the booking detail page fetching this "after first
 * paint" -- i.e. the browser itself calling API Gateway. That is not what this deploys, and the
 * reason is not a style preference: src/services/bookingService.js, providerBookingService.js
 * and coordinatorBookingService.js all call timelineRepository.listEvents(bookingId) only AFTER
 * verifying, server-side, that the current session's user actually owns or is entitled to see
 * that booking (findForRequester / findForProvider / assignmentRepository.findDetail all check
 * this before the timeline is ever read). This Lambda has no such check -- it trusts whatever
 * bookingId it is given. A browser calling it directly, with no session or ownership check in
 * front of it, could read any booking's history by guessing an id, which is exactly what
 * CLAUDE.md's "a user must not be able to reach another user's resource by calling the route"
 * rule forbids. Keeping the call server-side (src/services/timelineGateway.js, called from the
 * three services above, which have already done the ownership check by the time they call it)
 * preserves that guarantee; api gateway + lambda is still genuinely in the request path, just
 * not exposed to the browser directly.
 *
 * No credentials configured here, the same as every other AWS client in this project -- the
 * Lambda's execution role (LabRole) supplies them.
 */
const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));
const TABLE_NAME = process.env.DDB_TIMELINE_TABLE;

/**
 * The exact query timelineRepository.listEvents runs, byte-for-byte -- a relocation of that
 * logic, not a reimplementation, so the two return the same ordering and the same items.
 */
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

/**
 * Parses and validates the {bookingId} path parameter. Pure -- no AWS call, unit-testable.
 * Returns null for anything that is not a positive integer, so the handler can answer 400
 * rather than pass a malformed partition key straight into a DynamoDB call.
 */
function parseBookingId(pathParameters) {
  const raw = pathParameters && pathParameters.bookingId;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== String(raw)) {
    return null;
  }
  return parsed;
}

/**
 * API Gateway (REST API, Lambda proxy integration) handler for GET /timeline/{bookingId}.
 *
 * Returns the same shape timelineRepository.listEvents already returns, so
 * timelineGateway.fetchTimeline's caller does not need any Lambda-specific parsing.
 */
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
