# MS-1 — Notification Service

Owner: Abubaker Elsiddig Tageldeen (TP078003). Part of Task 2 — see
[`docs/task2-plan.md`](../../docs/task2-plan.md), B1.

## What it replaces

Today, when a provider accepts/rejects a booking (F4) or an admin approves/rejects a provider
(F5), the request handler does all its work inline before responding: write MySQL, append a
DynamoDB timeline event. Any notification work would extend that same synchronous chain — the
user waits on work they never see.

## Architecture

```
monolith (F4 / F5 handler)
  -> SNS topic bridgeability-booking-events
       -> SQS queue bridgeability-notifications
            -> this Lambda (batches of messages)
                 -> DynamoDB BridgeAbility_Notifications
       -> (after maxReceiveCount retries) SQS dead-letter queue bridgeability-notifications-dlq
```

The monolith's own side is [`src/services/notificationPublisher.js`](../../src/services/notificationPublisher.js):
`publishBookingEventSafely` publishes one message and returns immediately, and never throws —
the same "must not fail the user's action" contract `bookingService.appendEventSafely` already
gives the DynamoDB timeline append.

## Message shape

The monolith publishes (and this Lambda expects, after unwrapping the SNS envelope):

```json
{
  "eventType": "BOOKING_ACCEPTED",
  "recipientUserId": 1,
  "message": "Your request for \"Malaysian Sign Language interpreter\" was accepted.",
  "detail": { "bookingId": 1, "providerId": 1 },
  "occurredAt": "2026-09-15T02:00:00.000Z"
}
```

`eventType` is one of `BOOKING_ACCEPTED`, `BOOKING_REJECTED`, `PROVIDER_APPROVED`,
`PROVIDER_REJECTED` (`src/services/notificationPublisher.js`'s `EVENT_TYPES`).

## Why SNS in front of SQS, not a direct publish to SQS

SNS is the fan-out point: today there is one consumer (this Lambda), but the same published
event is the natural place to add a second subscriber later (email via SES, a websocket push)
without the monolith knowing or caring how many things are listening. Publishing straight to
SQS would tie the monolith to "there is exactly one queue", which is the thing about to change.

## Why the SNS -> SQS subscription, not SNS -> Lambda directly

SQS is what gives this Lambda batching, at-least-once delivery with retry, and a dead-letter
queue for a message that keeps failing — none of which SNS -> Lambda alone provides. It is also
what makes "stop the Lambda, watch the backlog grow, start it again, watch it drain" a real,
demonstrable thing on camera (`docs/task2-plan.md`, MS-1).

## Local testing

The parsing logic (`parseRecord`, `buildNotificationItem`) is pure — no AWS call, no
randomness beyond the notification id — and is unit-tested in the main suite:
[`tests/unit/notification-lambda.test.js`](../../tests/unit/notification-lambda.test.js).
Run it the same way as everything else: `npm test` from the repo root.

The DynamoDB write itself is only exercised for real once this Lambda is deployed and actually
consuming the queue — per this project's "no mocked AWS client anywhere" rule, there is no unit
test that fakes a DynamoDB response.

## Deploying

See [`scripts/deploy-notification-lambda.sh`](../../scripts/deploy-notification-lambda.sh) at
the repo root, and `docs/task2-plan.md` for the SNS topic / SQS queue / event source mapping
setup this Lambda depends on.
