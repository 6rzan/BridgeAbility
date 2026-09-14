'use strict';

const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const AWSXRay = require('../../lib/xray');
const config = require('../../config');

/**
 * Shared SNS client (Task 2, MS-1: docs/task2-plan.md).
 *
 * No credentials are passed, the same as the DynamoDB and S3 clients -- the SDK's default
 * provider chain resolves temporary credentials from the EC2 instance metadata service, which
 * serves the LabInstanceProfile -> LabRole identity attached to the Beanstalk instance.
 *
 * Wrapped with captureAWSv3Client for the same reason src/data/dynamo/client.js and
 * src/data/s3/client.js are: every publish becomes a subsegment on the request's X-Ray trace,
 * which is exactly what Section 3's "how does the notification path show up in the service map"
 * comparison needs.
 */
const client = AWSXRay.captureAWSv3Client(new SNSClient({ region: config.region }));

/**
 * Publish one JSON-serialisable message to the booking-events topic.
 *
 * Returns the SNS MessageId on success. Throws on failure -- callers that must not let a
 * notification failure fail the user's own action are responsible for catching this, the same
 * shape as bookingService.appendEventSafely for the DynamoDB timeline append.
 */
async function publishBookingEvent(message) {
  const response = await client.send(new PublishCommand({
    TopicArn: config.sns.bookingEventsTopicArn,
    Message: JSON.stringify(message),
    MessageAttributes: {
      eventType: { DataType: 'String', StringValue: message.eventType },
    },
  }));

  return response.MessageId;
}

module.exports = { client, publishBookingEvent };
