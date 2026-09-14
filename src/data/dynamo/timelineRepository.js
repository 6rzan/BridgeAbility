'use strict';

const { QueryCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const { documentClient } = require('./client');
const config = require('../../config');




const EVENTS = {
  CREATED: 'BOOKING_CREATED',
  CANCELLED: 'BOOKING_CANCELLED',
  ACCEPTED: 'BOOKING_ACCEPTED',
  REJECTED: 'BOOKING_REJECTED',
  ASSIGNED: 'VOLUNTEER_ASSIGNED',
  COMPLETED: 'BOOKING_COMPLETED',
};


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



async function queryCompletedEvents({ limit = 10 } = {}) {
  const result = await documentClient.send(new QueryCommand({
    TableName: config.dynamo.timelineTable,
    IndexName: 'GSI-1',
    KeyConditionExpression: '#status = :status',
    ExpressionAttributeNames: { '#status': 'status' },

    ExpressionAttributeValues: { ':status': 'completed' },
    ScanIndexForward: false,
    Limit: limit,
  }));

  return result.Items || [];
}

module.exports = {
  appendEvent,
  listEvents,
  queryCompletedEvents,
  partitionKey,
  EVENTS,
  EVENT_LABELS,
};
