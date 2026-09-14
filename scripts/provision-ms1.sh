#!/usr/bin/env bash
# Provisions MS-1's own AWS resources: the SNS topic, the SQS queue and its dead-letter queue,
# the subscription between them, and the queue policy that lets SNS actually deliver to it (SQS
# refuses messages from SNS by default -- a queue with no resource policy silently drops every
# notification and nothing anywhere reports an error, which is the kind of failure that is much
# cheaper to prevent than to debug).
#
# Idempotent throughout -- safe to re-run after a lab reset, matching db/dynamodb/create-tables.sh
# and scripts/provision.sh.
#
# Usage: AWS_REGION=us-east-1 bash scripts/provision-ms1.sh
#
# Prints the topic ARN at the end -- set it as SNS_BOOKING_EVENTS_TOPIC_ARN on the Elastic
# Beanstalk environment (eb setenv or the console; see README.md#deploying for why DB_PASSWORD
# and, by the same reasoning, any other real value never goes inline in a command).
set -euo pipefail

region="${AWS_REGION:-us-east-1}"
topic_name="${SNS_TOPIC_NAME:-bridgeability-booking-events}"
queue_name="${SQS_QUEUE_NAME:-bridgeability-notifications}"
dlq_name="${SQS_DLQ_NAME:-bridgeability-notifications-dlq}"
max_receive_count="${SQS_MAX_RECEIVE_COUNT:-5}"

echo "== SNS topic =="
# create-topic is itself idempotent: calling it again on an existing topic name just returns the
# same ARN rather than erroring, unlike SQS's create-queue below.
topic_arn="$(aws sns create-topic --name "$topic_name" --region "$region" --query TopicArn --output text)"
echo "sns: $topic_arn"

queue_url_for() {
  aws sqs get-queue-url --queue-name "$1" --region "$region" --query QueueUrl --output text 2>/dev/null || true
}

echo
echo "== SQS dead-letter queue =="
dlq_url="$(queue_url_for "$dlq_name")"
if [ -z "$dlq_url" ]; then
  echo "sqs: creating $dlq_name"
  dlq_url="$(aws sqs create-queue --queue-name "$dlq_name" --region "$region" --query QueueUrl --output text)"
else
  echo "sqs: $dlq_name already exists, skipping creation"
fi
dlq_arn="$(aws sqs get-queue-attributes --queue-url "$dlq_url" --attribute-names QueueArn --region "$region" --query 'Attributes.QueueArn' --output text)"
echo "sqs dlq: $dlq_arn"

echo
echo "== SQS main queue =="
queue_url="$(queue_url_for "$queue_name")"
if [ -z "$queue_url" ]; then
  echo "sqs: creating $queue_name"
  queue_url="$(aws sqs create-queue --queue-name "$queue_name" --region "$region" --query QueueUrl --output text)"
else
  echo "sqs: $queue_name already exists, skipping creation"
fi
queue_arn="$(aws sqs get-queue-attributes --queue-url "$queue_url" --attribute-names QueueArn --region "$region" --query 'Attributes.QueueArn' --output text)"
echo "sqs: $queue_arn"

# RedrivePolicy's own value must itself be a JSON string (not a nested object) -- this is an SQS
# quirk, confirmed against the API, not assumed.
redrive_policy_json="$(node -e "
  console.log(JSON.stringify({ deadLetterTargetArn: '$dlq_arn', maxReceiveCount: $max_receive_count }));
")"

# The queue's resource policy: only this specific SNS topic may SendMessage to it. Scoped by
# SourceArn condition, not "any SNS topic in the account" -- the narrowest grant that still
# works, matching the project's own least-privilege framing (CLAUDE.md, "Cognito" section, on
# why the team can defend every permission on camera).
access_policy_json="$(node -e "
  console.log(JSON.stringify({
    Version: '2012-10-17',
    Statement: [{
      Sid: 'AllowSNSPublishFromBookingEventsTopic',
      Effect: 'Allow',
      Principal: { Service: 'sns.amazonaws.com' },
      Action: 'sqs:SendMessage',
      Resource: '$queue_arn',
      Condition: { ArnEquals: { 'aws:SourceArn': '$topic_arn' } },
    }],
  }));
")"

attributes_json="$(node -e "
  console.log(JSON.stringify({
    RedrivePolicy: $(node -e "console.log(JSON.stringify('$redrive_policy_json'))"),
    Policy: $(node -e "console.log(JSON.stringify('$access_policy_json'))"),
    VisibilityTimeout: '60',
  }));
")"

aws sqs set-queue-attributes --queue-url "$queue_url" --region "$region" --attributes "$attributes_json"
echo "sqs: redrive policy (maxReceiveCount=$max_receive_count -> $dlq_name) and SNS access policy applied"

echo
echo "== SNS -> SQS subscription =="
existing_subscription="$(aws sns list-subscriptions-by-topic --topic-arn "$topic_arn" --region "$region" \
  --query "Subscriptions[?Endpoint=='$queue_arn'].SubscriptionArn" --output text)"
if [ -n "$existing_subscription" ] && [ "$existing_subscription" != "None" ]; then
  echo "sns: already subscribed ($existing_subscription)"
else
  aws sns subscribe --topic-arn "$topic_arn" --protocol sqs --notification-endpoint "$queue_arn" \
    --region "$region" >/dev/null
  echo "sns: subscribed $queue_name to $topic_name"
fi

echo
echo "== Done =="
echo "Set this on the Elastic Beanstalk environment (eb setenv or the console), same caution as"
echo "DB_PASSWORD -- not inline in a shared command:"
echo
echo "  SNS_BOOKING_EVENTS_TOPIC_ARN=$topic_arn"
echo
echo "Next: bash scripts/deploy-notification-lambda.sh to create the Lambda and wire it to"
echo "$queue_name as an event source."
