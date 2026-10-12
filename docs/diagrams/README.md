# Architecture diagrams — Task 1 vs Task 2

Two diagrams for Section 1 of the Task 2 report:

- [`task1-architecture.svg`](task1-architecture.svg) — the server-based, monolithic
  architecture as deployed and measured for the baseline (`docs/baselines/task1-baseline.md`,
  tag `task1-baseline`).
- [`task2-architecture.svg`](task2-architecture.svg) — the same monolith with Task 2's three
  serverless additions (MS-1, MS-2, MS-3) layered on, matching what is actually deployed
  (`docs/task2-plan.md`).

Open either file directly in a browser to view or export at full resolution for the Word
report; both are plain SVG with no external dependencies.

## What changed, and what did not

**Unchanged**: Elastic Beanstalk (Express monolith, one `t3.micro`), Amazon RDS for MySQL 8,
Amazon S3, and the parts of DynamoDB the monolith already used (sessions, the booking timeline).
The monolith's own request handling, authorization checks and views are untouched — every
Task 2 addition is either a new outbound call the monolith makes (a publish, a gateway fetch)
or a new consumer of data the monolith already writes.

**Added**: three microservices, one per member, each independently deployable.

| | Service | AWS components | What it does |
|---|---|---|---|
| MS-1 | Notification Service (Abubaker) | SNS, SQS + DLQ, Lambda | F4/F5's booking and provider decisions publish one message each; a Lambda consumes the queue and writes a notification record |
| MS-2 | Reports Service (Lama) | API Gateway, Lambda | The admin report's "recently completed bookings" panel, moved off the monolith's request path |
| MS-3 | Booking Timeline Service (Noor) | API Gateway, Lambda | One booking's history, moved off the monolith's request path, called from F2/F4/F7/F8 |

## Why these three, and not others

Each extraction targets something the monolith was doing that a serverless component does
better — not a component added because the brief asked for one:

- **MS-1** turns a notification into a genuine side effect. Today, F4/F5's handler does all its
  work — the MySQL write, the DynamoDB timeline append, and (with Task 2) the SNS publish —
  before responding; the user never waits on the notification actually being processed, because
  publishing to SNS returns immediately and the real work (formatting, writing the record,
  retrying on failure) happens in the Lambda afterward, off the request path entirely.
- **MS-2 and MS-3** both move a DynamoDB read behind API Gateway + Lambda. Deliberately *not*
  the three RDS `GROUP BY` aggregates on the same report page: those reflect live current state
  (`bookings.status` is the source of truth), which DynamoDB's event history cannot correctly
  reproduce for anything but a terminal status. Moving those would have been quietly wrong, not
  just a different architecture (see `services/reports/index.js`'s own comment for the full
  reasoning). "Recently completed" and "one booking's timeline" are both queries DynamoDB was
  always the right store for — Task 2 moves *where they run*, not *what they mean*.

## How this improves scalability, flexibility, efficiency and maintainability

- **Scalability.** The Day 1 baseline load test found the bottleneck was never RDS — CPU and
  connection counts barely moved under load, while application latency was still
  400–600ms average with multi-second p99s (`docs/baselines/task1-baseline.md`). That points at
  the single `t3.micro` instance's own event loop. Every read or publish moved to a Lambda now
  scales independently of that instance and of each other: a spike in report views does not
  compete with a spike in booking submissions for the same process.
- **Flexibility.** SNS decouples "an event happened" from "something reacts to it". Today there
  is one subscriber (the notification Lambda); adding a second (email via SES, a websocket push)
  needs no change to F4/F5 at all — the monolith already does not know or care how many things
  are listening.
- **Efficiency.** Notification work — formatting, retrying, writing a record nobody is waiting
  on — no longer runs synchronously inside the request that triggered it. The admin report's
  slowest panel and a booking's timeline read both leave the monolith's own process entirely.
- **Maintainability.** Each microservice is one Lambda with one job, one small test file for its
  pure logic, and one README explaining what it replaces and why (`services/notification/`,
  `services/reports/`, `services/timeline/`). Redeploying MS-2 cannot break MS-1, and neither
  can break the monolith — every gateway call (`src/services/reportsGateway.js`,
  `src/services/timelineGateway.js`) falls back to the pre-Task-2 direct query on any failure,
  so the monolith works identically whether or not a given microservice is even deployed.

## A deliberate omission

The plan considered a fourth microservice (S3-event-triggered image processing on listing
uploads) but cut it: MS-1 through MS-3 already satisfy the brief's floor (API Gateway, Lambda,
and at least one of S3/SNS/SQS — this deployment has all four), and CONVENTIONS.md's own rule that
the rubric rewards completing what was proposed, not adding to it, argued against building a
fourth service just to have one more to show.
