'use strict';

const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const AWSXRay = require('../../lib/xray');
const config = require('../../config');

const client = AWSXRay.captureAWSv3Client(new SNSClient({ region: config.region }));

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
