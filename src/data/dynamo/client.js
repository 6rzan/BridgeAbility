'use strict';

const { DynamoDBClient, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const config = require('../../config');

/**
 * Shared DynamoDB clients.
 *
 * No credentials are passed. The SDK's default provider chain resolves temporary credentials
 * from the EC2 instance metadata service, which serves the LabInstanceProfile -> LabRole
 * identity attached to the Beanstalk instances. This is why no access key appears anywhere
 * in this repository.
 */
const baseClient = new DynamoDBClient({ region: config.region });

/**
 * The document client marshals plain JavaScript objects to and from DynamoDB's typed
 * attribute format, so callers write `{ PK: 'BOOKING#42' }` instead of `{ PK: { S: '...' } }`.
 */
const documentClient = DynamoDBDocumentClient.from(baseClient, {
  marshallOptions: { removeUndefinedValues: true },
});

/** Liveness probe used by /health. */
async function ping() {
  await baseClient.send(new DescribeTableCommand({ TableName: config.dynamo.timelineTable }));
}

module.exports = { baseClient, documentClient, ping };
