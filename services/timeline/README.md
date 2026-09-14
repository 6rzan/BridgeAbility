# MS-3 — Booking Timeline Service

Owner: Noor Khalil Abdullah Khaled (TP078880). Part of Task 2 — see
[`docs/task2-plan.md`](../../docs/task2-plan.md), B1.

## What it replaces

`src/data/dynamo/timelineRepository.js`'s `listEvents(bookingId)` -- one booking's whole
history, read from DynamoDB inside the Express process -- on the booking detail page (F2), the
provider's incoming-request detail page (F4), and the coordinator's booking detail page (F7/F8).

## Architecture, and why the call stays server-side

```
browser
  -> monolith GET /bookings/:id  (or the F4 / F7-F8 equivalents)
       -> src/services/timelineGateway.js
            -> API Gateway GET /timeline/{bookingId}
                 -> this Lambda
                      -> DynamoDB BridgeAbility_BookingTimeline (Query on PK)
            -> (falls back here if the above fails or is unconfigured)
            -> direct DynamoDB query, the pre-Task-2 behaviour
```

The plan for MS-3 originally described the booking detail page fetching this "after first
paint" — the browser calling API Gateway directly. That is not what is deployed, on purpose:
`bookingService.findForRequester`, `providerBookingService.findForProvider` and
`coordinatorBookingService.findDetail` all verify, server-side, that the signed-in user actually
owns or is entitled to see that specific booking *before* they ever call the timeline read. This
Lambda has no such check — it will return whatever `bookingId` it is asked for. A browser
calling it directly would let anyone read any booking's history by guessing an id, which is
exactly what `CLAUDE.md`'s "a user must not be able to reach another user's resource by calling
the route" rule forbids. Keeping the call inside the three services above — which have already
done the ownership check — keeps that guarantee intact. API Gateway and Lambda are still
genuinely in the request path; they are just not exposed to the browser.

## Local testing

`parseBookingId` is pure (no AWS call) and unit-tested in the main suite:
[`tests/unit/timeline-lambda.test.js`](../../tests/unit/timeline-lambda.test.js). The DynamoDB
query itself (`listEvents`) is the same query
`src/data/dynamo/timelineRepository.js`'s `listEvents` already runs, and is only exercised for
real once this Lambda is deployed — per this project's "no mocked AWS client anywhere" rule,
there is no unit test that fakes a DynamoDB response.

## Deploying

See [`scripts/deploy-timeline-lambda.sh`](../../scripts/deploy-timeline-lambda.sh) at the repo
root, which provisions the API Gateway REST API (with the `{bookingId}` path parameter) and
stage.
