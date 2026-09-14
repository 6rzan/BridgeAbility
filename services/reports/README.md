# MS-2 — Reports Service

Owner: Aldhahyani Lama M. A. (TP078792). Part of Task 2 — see
[`docs/task2-plan.md`](../../docs/task2-plan.md), B1.

## What it replaces

The admin report (F6) shows four things: three RDS `COUNT(*) ... GROUP BY` summaries and a list
of recently completed bookings. This service is the second half of that page, moved behind API
Gateway — and *only* that half. See the long comment at the top of
[`index.js`](index.js) for why the three RDS summaries are deliberately out of scope: they
reflect live current state, which DynamoDB's event history cannot correctly reproduce for a
status a booking can move on from (it can for `completed`, which never changes again — that is
exactly why the one DynamoDB-backed panel on this page was always this one).

## Architecture

```
browser
  -> monolith GET /admin/reports
       -> src/services/reportsGateway.js
            -> API Gateway GET /reports/recently-completed
                 -> this Lambda
                      -> DynamoDB BridgeAbility_BookingTimeline, GSI-1 (status)
            -> (falls back here if the above fails or is unconfigured)
            -> direct DynamoDB query, the pre-Task-2 behaviour
```

`src/services/reportsGateway.js` calls the API Gateway URL when `REPORTS_API_URL` is configured,
and falls back to the monolith's own direct DynamoDB query otherwise or on any failure —
`adminReportService.buildReport` does not know or care which one answered; both return the same
shape.

## Local testing

`parseLimit` is pure (no AWS call) and unit-tested in the main suite:
[`tests/unit/reports-lambda.test.js`](../../tests/unit/reports-lambda.test.js). The DynamoDB
query itself (`queryCompletedEvents`) is the same query
`src/data/dynamo/timelineRepository.js`'s `queryCompletedEvents` already runs and is only
exercised for real once this Lambda is deployed — per this project's "no mocked AWS client
anywhere" rule, there is no unit test that fakes a DynamoDB response.

## Deploying

See [`scripts/deploy-reports-lambda.sh`](../../scripts/deploy-reports-lambda.sh) at the repo
root, which also provisions the API Gateway REST API and stage.
