'use strict';

const { QueryCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const { documentClient } = require('./client');
const config = require('../../config');

/**
 * The booking timeline, in Amazon DynamoDB.
 *
 * WHY A SECOND DATABASE, AND WHY THIS DATA IN IT
 *
 * A booking's current state is one row in MySQL, and MySQL owns it: it is the thing that must
 * be transactional, joined against services and providers, and constrained by foreign keys.
 * Its history is a different shape entirely -- an append-only stream, never updated, always
 * read as "everything about one booking, in order", and written by four different roles as
 * they act. That is a key-and-range access pattern with no joins, and it grows without bound.
 *
 * Putting it in DynamoDB is not decoration. The partition key is the booking, the sort key is
 * the moment, so one Query returns the whole history of one booking already ordered, at a cost
 * that does not change as the table grows past a million events. The same rows in MySQL would
 * be an ever-growing table scanned by an index we would have to maintain, and every new event
 * type would be a schema change.
 *
 * KEY DESIGN
 *   PK  BOOKING#<booking_id>   one partition per booking; the whole history is one Query
 *   SK  <ISO-8601 timestamp>#<event>  sorts lexicographically, which for ISO-8601 is
 *                                     chronologically; the event suffix keeps two events
 *                                     written in the same millisecond from colliding
 *   GSI-1  status    + SK   "every booking that reached 'completed', newest first" (F6)
 *   GSI-2  providerId + SK  "everything that happened to one provider's bookings" (F6)
 *
 * ORDERING WITH MySQL. MySQL commits first, always. It holds the authoritative status, so a
 * timeline event that exists for a booking that was never created would be a lie; a booking
 * that exists with one missing history line is a gap we can log and reconcile. See
 * bookingService for the reconciliation log that failure writes.
 */

const EVENTS = {
  CREATED: 'BOOKING_CREATED',
  CANCELLED: 'BOOKING_CANCELLED',
  ACCEPTED: 'BOOKING_ACCEPTED',
  REJECTED: 'BOOKING_REJECTED',
  ASSIGNED: 'VOLUNTEER_ASSIGNED',
  COMPLETED: 'BOOKING_COMPLETED',
};

/** How each event is described to a person reading their own booking. */
const EVENT_LABELS = {
  [EVENTS.CREATED]: 'Request sent to the provider',
  [EVENTS.CANCELLED]: 'Request cancelled by the requester',
  [EVENTS.ACCEPTED]: 'Provider accepted the request',
  [EVENTS.REJECTED]: 'Provider declined the request',
  [EVENTS.ASSIGNED]: 'Volunteer assistant assigned',
  [EVENTS.COMPLETED]: 'Booking completed',
};

function partitionKey(bookingId) {
  return `BOOKING#${bookingId}`;
}

/**
 * Append one event. Never updates, never deletes -- a timeline that can be edited is not
 * evidence of anything.
 */
async function appendEvent({
  bookingId,
  event,
  status,
  providerId,
  actorId,
  actorRole,
  actorName,
  detail = null,
  occurredAt = new Date(),
}) {
  const timestamp = occurredAt.toISOString();

  const item = {
    PK: partitionKey(bookingId),
    SK: `${timestamp}#${event}`,
    bookingId: Number(bookingId),
    event,
    // Both GSI keys are strings: DynamoDB requires it, and a number that is only ever used as
    // a key gains nothing from being one.
    status: String(status),
    providerId: String(providerId),
    actorId: Number(actorId),
    actorRole,
    actorName,
    detail,
    occurredAt: timestamp,
  };

  await documentClient.send(new PutCommand({
    TableName: config.dynamo.timelineTable,
    Item: item,
  }));

  return item;
}

/**
 * The whole history of one booking, oldest first.
 *
 * ConsistentRead is on. The common path is a requester submitting a booking and landing
 * straight on its detail page: an eventually consistent read can miss the event written a
 * moment ago and show a booking with an empty history, which reads as "nothing happened".
 * One booking's events are a handful of small items, so the extra cost is not worth the
 * confusion of an empty page.
 */
async function listEvents(bookingId) {
  const result = await documentClient.send(new QueryCommand({
    TableName: config.dynamo.timelineTable,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': partitionKey(bookingId) },
    ScanIndexForward: true,
    ConsistentRead: true,
  }));

  return result.Items || [];
}

module.exports = {
  appendEvent,
  listEvents,
  partitionKey,
  EVENTS,
  EVENT_LABELS,
};
