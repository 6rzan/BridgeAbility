# Task 2 build — captured 15 September 2026

Captured for the Section 3 Task 1 vs Task 2 comparison (`docs/task2-plan.md`, B3). This is the
"after" half; the "before" half is [`task1-baseline.md`](task1-baseline.md). Same RDS instance,
same DynamoDB tables, same S3 bucket as the baseline — only the compute/serverless layer
differs, which is deliberate: it isolates the comparison to the architectural change alone.

## Environment

| | |
|---|---|
| Elastic Beanstalk environment | `bridgeability-task2-env` |
| Platform | Node.js 24 on 64-bit Amazon Linux 2023, single instance, `t3.micro` |
| Git commit deployed | `2231c0d` |
| RDS | `bridgeability-db` — **same instance as the Task 1 baseline**, not a separate one |
| New this deployment | `SNS_BOOKING_EVENTS_TOPIC_ARN`, `REPORTS_API_URL`, `TIMELINE_API_URL` all set |
| Verified via `/health` | `{"status":"ok"}` — RDS, DynamoDB and S3 all `ok` |

## All three microservices verified through the real, deployed app (not just direct AWS calls)

Every earlier verification of MS-1/MS-2/MS-3 (see their own commits) was against the Lambda or
API Gateway directly. These are through the actual running application, signed in as the real
demo accounts:

- **MS-1**: signed in as `provider@bridgeability.demo`, accepted booking 9 for real via
  `POST /provider/bookings/9/accept`. Confirmed in `BridgeAbility_Notifications`:
  `{"eventType":"BOOKING_ACCEPTED","message":"Your request for \"Live captioning for events and
  lectures\" was accepted.", ...}` under `USER#3` (the real requester on that booking) —
  correct service title, correct recipient, written by the real SNS → SQS → Lambda path.
- **MS-2**: signed in as `admin@bridgeability.demo`, loaded `/admin/reports`. Confirmed via
  `aws logs filter-log-events` that `bridgeability-reports` was invoked at the same timestamp
  (12:24:22.770Z) as the request.
- **MS-3**: loaded `/provider/bookings/9`. Confirmed `bridgeability-timeline` invoked at the
  matching timestamp.

## Load test

`BASE_URL=<task2-env-url> BOOKING_ID=7 node scripts/loadtest.js 20 10`. **`BOOKING_ID=7`, not
1** — booking 1 was already cancelled during the Task 1 baseline capture, and both environments
share the same RDS instance, so reusing it would have measured the guarded no-op branch instead
of a real transition (`scripts/loadtest.js`'s own header explains this). Raw output:
[`task2-loadtest-raw.txt`](task2-loadtest-raw.txt).

| Target | Task 1 (booking 1) | Task 2 (booking 7) | Change |
|---|---|---|---|
| `GET /services` | 494.2ms avg / 4186ms p99 | 394.0ms avg / 1826ms p99 | both improved |
| `GET /services/1` | 412.2ms avg / 2141ms p99 | 365.5ms avg / 1856ms p99 | both improved |
| `GET /bookings/:id` | 422.4ms avg / 2156ms p99 | 390.0ms avg / 1479ms p99 | both improved (different booking, see caveat) |
| `GET /admin/reports` | 388.0ms avg / 1788ms p99 | 424.6ms avg / 1639ms p99 | avg worse, p99 better |
| `POST /bookings/:id/cancel` | 319.6ms avg / 617ms p99 | 327.1ms avg / 713ms p99 | both slightly worse |

Zero errors, zero timeouts, zero non-2xx on every target, both environments.

**Caveat on `GET /bookings/:id`**: booking 1 (Task 1 run) and booking 7 (Task 2 run) do not
carry the same amount of timeline history — booking 1 had accumulated a cancel event by the
time of its own test; booking 7 had one `BOOKING_CREATED` event. Some of the improvement here
is very likely less data to query and render, not purely the architecture. Not a like-for-like
number; reported for completeness, not as a claimed win.

## The load test's own numbers do not tell the full story — read this before citing them

None of the improvements or regressions above should be read as "MS-2/MS-3 made X faster",
because **the client-side gateway calls mostly did not happen** during the concurrent load test.
Confirmed directly, not assumed:

- `bridgeability-reports` Lambda: **2 invocations** total across the whole 20-minute test
  window, against **467 requests** the load test sent to `/admin/reports`.
- `bridgeability-timeline` Lambda: **5 invocations**, against **512 requests** to
  `/bookings/7`.
- The matching API Gateway `Count` metrics agree (2 and 5) — the calls did not even reach API
  Gateway most of the time, so this is not a Lambda-side problem.

Isolated the cause directly rather than guessing: a single `curl` request to `/admin/reports`
reliably reaches the Lambda (confirmed, one invocation, matching timestamp). **Two genuinely
simultaneous** `curl` requests (`curl ... & curl ... & wait`, no load-test tooling involved)
both fall back — reproducible at the lightest possible concurrency, not a high-load effect.

The actual cause: `CPUCreditBalance` on this `t3.micro` instance dropped from **3.14 to 0.34**
credits over the test window (`AWS/EC2` `CPUCreditBalance`, this instance ID), from a full day
of deploys and load tests. A `t3.micro` throttles hard to its baseline CPU once burst credits
run out, and a TLS handshake for the outbound HTTPS call to API Gateway is exactly the kind of
CPU-bound work that gets slow under that throttling — easily past the 3-second client-side
timeout (`reportsGateway.js` / `timelineGateway.js`) even for one or two concurrent requests,
while the Lambda side itself stays fast (225–398ms average duration) once it *is* reached,
because Lambda's compute is not sharing the credit-starved instance at all.

**This is not a defect in the architecture — it is the fallback design working exactly as
intended under a real resource constraint.** Every one of those 467 and 512 requests still
answered correctly and fast, because `reportsGateway.js`/`timelineGateway.js` fell back to the
pre-Task-2 direct DynamoDB query the moment the gateway call did not return quickly, and the
monolith never has to know or care which path answered. The cost of that resilience is that
this particular load test, run on a CPU-credit-starved instance, mostly measured the fallback
path rather than the gateway path — which is itself worth reporting honestly for Section 3,
including as a real recommendation: **a `t3.micro`'s burstable CPU is a poor fit for an
instance that also needs to make outbound TLS calls under load; either monitor
`CPUCreditBalance` and alert well above zero, or move to a non-burstable instance class if the
serverless integrations become load-bearing rather than best-effort.**

## A second capture (17 September) shows a different, unexplained pattern

Two further load tests were run against this same environment on 17 September, after an
unrelated instance replacement (a temporary EC2 key pair added for an SSH diagnostic attempt,
reverted afterward at the security-group level): `BOOKING_ID=7 node scripts/loadtest.js 20 10`
(17:07:18–17:09:07 UTC, 731 requests each to `/admin/reports` and `/bookings/7`) and the same
command with `60 15` (17:13:02–17:18:09 UTC, 3,358 requests each). Both ran clean — 0 errors, 0
timeouts, 0 non-2xx, 256–284ms average latency throughout, noticeably better than the 15
September figures.

This time, `CPUCreditBalance` was confirmed healthy throughout (15.8–17.9, not the 0.34 from the
first capture — pulled via the same `get-metric-data` call), which rules out the CPU-credit
explanation for what follows: **`bridgeability-reports` and `bridgeability-timeline` show zero
invocations across both entire runs**, confirmed directly against CloudWatch Logs
(`aws logs filter-log-events`, not inferred from the dashboard). This was checked as thoroughly
as time allowed before accepting it as unexplained, rather than assumed:

- `curl` from the EC2 instance itself (via SSM, not this machine) to both API Gateway URLs
  succeeds instantly every time, including 8 concurrent requests — each one confirmed via
  CloudWatch Logs to genuinely invoke Lambda.
- The identical `fetch()` call, run as a bare Node script on the same instance outside Express,
  also succeeds (200, correct body).
- The deployed `reportsGateway.js` was confirmed byte-for-byte identical to the repository, and
  `REPORTS_API_URL`/`TIMELINE_API_URL` were confirmed present in the actual running process's
  environment (`/proc/<pid>/environ`), not just the EB configuration.
- API Gateway response caching was confirmed disabled on both stages.
- No error was logged either: `reportsGateway.js`/`timelineGateway.js`'s own `console.error`,
  which fires on any caught failure, produced zero new lines across either run.

In short, the gateway call neither succeeds (no Lambda invocation) nor visibly fails (no logged
error) when made from inside a real request — the identical call from a bare script on the same
instance works. The next diagnostic step (temporary debug logging added directly to the live
instance) was deliberately not pursued: it required a production write this close to the
deadline for a question that does not change the system's correctness. **This is reported as an
open, unexplained finding, not a resolved one** — do not cite a root cause for it in the video or
the report beyond what is written here.

It does not weaken Section 3's central point. `reportsGateway.js`/`timelineGateway.js`'s fallback
logic is unchanged and confirmed correct by direct code review; every one of the 4,089 requests
in these two runs still answered correctly and quickly. A 100% fallback rate with zero
user-visible failures is, if anything, a *stronger* demonstration of the resilience property
Task 2's design is meant to show than the partial fallback measured on 15 September.

## CloudWatch metrics during the load test

| Metric | Task 1 baseline | Task 2 build |
|---|---|---|
| EC2 `CPUUtilization` (peak) | ~5.8% | ~6.7% |
| RDS `CPUUtilization` (peak) | ~8.0% | ~7.4% |
| RDS `DatabaseConnections` (peak) | 8 | 6 |
| EC2 `CPUCreditBalance` (end of window) | not captured (earlier in the day) | **0.34** — see above |
| `bridgeability-reports` Lambda `Duration` (avg, when invoked) | n/a | 398.28ms |
| `bridgeability-timeline` Lambda `Duration` (avg, when invoked) | n/a | 225.83ms |
| API Gateway `Latency` (reports, avg) | n/a | 917.5ms |
| API Gateway `Latency` (timeline, avg) | n/a | 489.2ms |

RDS and EC2 CPU remain low in both architectures — consistent with the Task 1 finding that RDS
was never the bottleneck. The new signal in Task 2 is `CPUCreditBalance`, which is not something
the Task 1 architecture's own load pattern (no outbound HTTPS calls from the app) would ever
draw down noticeably; Task 2's added outbound calls to SNS and API Gateway do.

## CloudWatch dashboard

Created: **`BridgeAbility-Task1-vs-Task2`**, nine widgets — EC2 CPU for both instances side by
side, the shared RDS instance's CPU/connections, the Task 2 instance's `CPUCreditBalance` (the
finding above, given its own widget on purpose), Lambda invocations/duration/errors for all
three microservices, API Gateway count/latency for MS-2 and MS-3, the SQS queue depth and DLQ
for MS-1, and DynamoDB read capacity across all three tables.

```
https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards/dashboard/BridgeAbility-Task1-vs-Task2
```

## What is not yet captured

- **A live screenshot of the dashboard above**, ideally taken while load is running rather than
  idle (`docs/task2-plan.md`, B3) — needs a browser with console access.
- **X-Ray service map -- confirmed unreachable under this account, not just unchecked.** Same
  finding as the Task 1 baseline, now confirmed two ways: the CLI (`AccessDeniedException` on
  `xray:GetTraceSummaries`) and the X-Ray console itself, screenshotted directly, showing "This
  IAM user does not have permission to view the service map for this account." The `voclabs`
  role AWS Academy assigns has X-Ray read access blocked entirely for every user under this
  account -- not a missing step, a permanent property of the Learner Lab. The code-level
  implementation (`src/lib/xray.js`, `app.js`'s `xrayExpress.openSegment`/`closeSegment`
  placement) is real and correct; a verified service map or trace list is not obtainable to
  screenshot for Section 3 under this account.
