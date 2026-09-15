# Task 1 baseline — captured 14 September 2026

Captured for the Section 3 Task 1 vs Task 2 comparison (`docs/task2-plan.md`, B3). This is the
"before" half of that comparison; the "after" half is captured the same way once Task 2's
serverless/microservices pieces are deployed.

## Environment

| | |
|---|---|
| Elastic Beanstalk environment | `bridgeability-task1-env` |
| Platform | Node.js 24 on 64-bit Amazon Linux 2023, single instance, `t3.micro` |
| Git tag | [`task1-baseline`](../../.git) — `8597255` |
| RDS | `bridgeability-db`, `db.t3.micro`, MySQL 8.4.9 |
| Verified via `/health` | `{"status":"ok"}` — RDS, DynamoDB and S3 all `ok` |
| Catalogue check | `/services` reports "of 9 services" — matches the documented seed (9 of 11 visible) |

## Load test

`BASE_URL=<env-url> node scripts/loadtest.js 20 10` — 20 seconds per target, 10 concurrent
connections. Raw output: [`task1-loadtest-raw.txt`](task1-loadtest-raw.txt).

| Target | Requests | Req/sec | Latency avg | Latency p99 | Errors | Non-2xx |
|---|---|---|---|---|---|---|
| `GET /services` (public) | 401 | 20.1 | 494.2ms | 4186ms | 0 | 0 |
| `GET /services/1` (public) | 484 | 24.2 | 412.2ms | 2141ms | 0 | 0 |
| `GET /bookings/1` (requester) | 470 | 23.5 | 422.4ms | 2156ms | 0 | 0 |
| `GET /admin/reports` (admin) | 505 | 25.3 | 388.0ms | 1788ms | 0 | 0 |
| `POST /bookings/1/cancel` (requester) | 627 | 31.4 | 319.6ms | 617ms | 0 | 0 |

Zero errors, zero timeouts, zero non-2xx responses across every target — the monolith handles
this load cleanly on a single `t3.micro`. The p99 figures (1.8–4.2 seconds on the read paths)
are the number worth carrying into the Section 3 discussion: a single small instance serving
RDS-backed reads under 10 concurrent connections already shows meaningful tail latency, which
is exactly the kind of number a reporting read path moved off the request path (MS-2) or a
notification moved off the synchronous path (MS-1) should visibly improve.

**Note on the `admin/reports` figure**: this endpoint runs three `GROUP BY` aggregates against
RDS per request (`reportRepository.js`) — the exact query shape MS-2 replaces with a Lambda
reading DynamoDB's `GSI-1`/`GSI-2` instead. Its p99 here (1788ms) is the number MS-2's own load
test should be compared against directly.

## CloudWatch metrics during the load test (pulled via CLI, `get-metric-data`)

| Metric | Peak during the run | Note |
|---|---|---|
| EC2 `CPUUtilization` (the app instance) | ~5.8% | Barely moved -- 10 concurrent connections doesn't stress a `t3.micro`'s CPU |
| RDS `CPUUtilization` | ~8.0% | Also barely moved |
| RDS `DatabaseConnections` | 8 (peak) | Roughly tracks the 10 configured connections, as expected |
| RDS `ReadLatency` / `WriteLatency` | ~0.0005–0.002 **seconds** (sub-millisecond to low-millisecond) | Effectively negligible |

**This is the interesting finding, not a footnote.** Neither CPU metric moved meaningfully, and
RDS's own read/write latency is negligible -- yet the load test measured 400–600ms average
application latency with a multi-second p99. The bottleneck in this architecture is not RDS
capacity; it is almost certainly Node's single-threaded event loop on a `t3.micro` serialising
concurrent EJS renders, plus whatever overhead the session/CSRF middleware chain adds per
request. That is directly relevant to Section 3's "evaluate whether the architectural changes
are beneficial" question: moving a read path to a Lambda (MS-2, MS-3) does not help because RDS
was the constraint -- it helps because it removes work from the one instance that is actually
the bottleneck, and lets that read path scale independently of it.

## What is not yet captured

- **A CloudWatch dashboard screenshot.** The numbers above are the real data, pulled via
  `aws cloudwatch get-metric-data`; a visual dashboard (a proper widget layout, screenshotted
  live) is still worth building for the report, since Section 3 explicitly wants a screenshot,
  not just a table -- see `docs/task2-plan.md`, B3, for the dashboard layout this feeds into
  once Task 2's environment exists alongside this one.
- **X-Ray service map -- confirmed unreachable, not just unchecked.** X-Ray is wired into the
  app correctly (verified by reading the code directly): `src/lib/xray.js` wraps the `mysql2`
  pool and the DynamoDB/S3 SDK clients, `app.js` places `xrayExpress.openSegment('BridgeAbility')`
  right after `/health` and `xrayExpress.closeSegment()` right before the error handler, and
  `.ebextensions/02-options.config` enables the daemon. Whether traces actually exist cannot be
  confirmed by anyone in this AWS Academy account, though -- both the CLI (`AccessDeniedException`
  on `xray:GetTraceSummaries`) and the console ("This IAM user does not have permission to view
  the service map for this account", screenshotted directly) refuse the same `voclabs` role. This
  is the same category of constraint as "the lab blocks creating custom IAM roles" (`CLAUDE.md`)
  -- a permanent property of the Learner Lab account, not a step either of us missed. Report the
  code-level implementation as evidence for Section 2 (Design & Implementation); do not claim a
  verified service map for Section 3, since it cannot be produced under this account.

## A defect found while capturing this

`scripts/loadtest.js`'s original status-change target returned 100% non-2xx (404) responses —
not a real application failure. Root cause, confirmed by isolation against this live
environment: `autocannon@8.0.0` (no newer version exists) corrupts a request into a 404 when
two custom headers carry the exact same string value, which is precisely what a double-submit
CSRF request looks like (`cookie` and `x-csrf-token` both carrying the same token). curl sent
with identical values gets the correct `302`. Fixed by replacing that one target with a small
hand-rolled `fetch`-based concurrent runner (`runFetchTarget` in `scripts/loadtest.js`); the
other four targets, which don't share this defect, still use autocannon. See that file's
comments for the full isolation steps.
