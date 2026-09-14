'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

/**
 * MS-2's Lambda: the "recently completed bookings" panel on the admin report (F6), moved
 * behind API Gateway.
 *
 * WHY THIS IS THE WHOLE SCOPE OF MS-2, AND NOT THE OTHER THREE PANELS ON THAT PAGE
 *
 * adminReportService.buildReport() shows four things: three RDS COUNT(*)...GROUP BY summaries
 * (bookings by status, providers by status, assignments by completion status) and this list.
 * The three RDS summaries reflect *current* live state -- bookings.status is the source of
 * truth, and a booking can move through several statuses over its life. DynamoDB's GSI-1 is a
 * history of events, not a live-state index: querying it for, say, every 'accepted' event would
 * overcount, because a booking that later became 'assigned' then 'completed' still has an
 * 'accepted' event sitting in the timeline forever. Building a Lambda that aggregated GSI-1 by
 * status and called it equivalent to the RDS counts would be quietly wrong, not just a different
 * architecture -- CLAUDE.md's own "no stretch features" rule is a second reason not to invent a
 * new panel just to have more to migrate.
 *
 * "Recently completed" is different: 'completed' is a terminal status a booking never leaves, so
 * GSI-1's per-event view and RDS's live-state view agree here, which is exactly why
 * timelineRepository.queryCompletedEvents already reads DynamoDB for this one panel and nothing
 * else on the page. Moving that one query behind API Gateway + Lambda is a genuine, correctness-
 * preserving extraction -- not a new feature, not a guess at equivalence.
 *
 * No credentials configured here, the same as every other AWS client in this project -- the
 * Lambda's execution role (LabRole) supplies them.
 */
const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));
const TABLE_NAME = process.env.DDB_TIMELINE_TABLE;

/**
 * Same query timelineRepository.queryCompletedEvents runs, byte-for-byte -- this Lambda is a
 * relocation of that logic, not a reimplementation of it, so the two must never drift apart in
 * a way that changes what "recently completed" means.
 */
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

/** Parses and bounds the `limit` query parameter. Pure -- no AWS call, unit-testable. */
function parseLimit(queryStringParameters) {
  const raw = queryStringParameters && queryStringParameters.limit;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 10;
  }
  return Math.min(parsed, 50);
}

/**
 * API Gateway (REST API, Lambda proxy integration) handler for GET /reports/recently-completed.
 *
 * Returns the same shape the monolith already builds from these items
 * (adminReportService.buildReport), so the caller does not need any Lambda-specific parsing.
 */
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
