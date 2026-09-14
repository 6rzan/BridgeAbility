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

## What is not yet captured

- **CloudWatch dashboard screenshot** (EC2 `CPUUtilization`, RDS `CPUUtilization` /
  `DatabaseConnections` / `ReadLatency` / `WriteLatency`, taken during a load test run) — no
  console screenshot capability from this session; take this from the AWS console with the load
  test running, not idle (see `docs/task2-plan.md`, B3).
- **X-Ray service map** — X-Ray is wired into the app (`src/lib/xray.js`) and the daemon is
  enabled (`.ebextensions/02-options.config`), but this session's own IAM role does not have
  `xray:GetTraceSummaries` to verify traces arrived via CLI. Check the X-Ray console directly:
  Services → the map should show Express → RDS / DynamoDB / S3 as separate nodes.
- Both are needed before Section 3 can be written up; capture them from a browser with console
  access, ideally while `scripts/loadtest.js` is running so the dashboard is not idle.

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
