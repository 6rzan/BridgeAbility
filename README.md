# BridgeAbility

A cloud platform for booking and coordinating accessibility services for persons with
disabilities in Malaysia — sign-language interpreters, wheelchair-accessible transport,
caregivers and mobility assistance. A requester finds a verified listing, sends a booking
request, and follows it through to completion; providers, administrators and coordinators
each act on their own part of that flow.

Built for **CT071-3-3-DDAC** (Designing and Developing Applications on the Cloud), Asia Pacific
University — Group 21, Topic 4. The repository holds both parts of the module:

- **Task 1** — the frontend and backend, plus the cloud database layer (RDS, DynamoDB, S3),
  deployed on Elastic Beanstalk.
- **Task 2** — serverless services (API Gateway, Lambda, SNS, SQS) added to the same system,
  with CloudWatch and X-Ray monitoring and a measured before/after comparison.

## What this project demonstrates

We built this to learn cloud deployment on AWS by doing it end to end, on a real account, with
no local database and no mocked AWS clients. Hands-on work in this repo covers:

- **Deploying and operating a web app on AWS.** Elastic Beanstalk with `.ebextensions` for
  configuration, schema migrations that run on the instance inside the VPC, and a repeatable
  re-provisioning path (`scripts/provision.sh`, `db/dynamodb/create-tables.sh`) because the
  AWS Academy lab wipes its network on every reset.
- **Choosing a data store per access pattern.** RDS MySQL for transactional state, DynamoDB
  for the append-only booking history and the session store (with TTL), S3 for images served
  only through presigned URLs.
- **Network and identity security.** A private RDS reachable only from the app's security
  group, S3 Block Public Access with encryption and versioning, credentials from the EC2
  instance profile with no access keys in the repo, and authorisation checked server-side on
  every route.
- **Moving work to serverless.** Three microservices: booking notifications over
  SNS → SQS → Lambda with a dead-letter queue, plus the admin reports and booking timeline
  behind API Gateway + Lambda. The main app falls back to a direct read if a gateway call
  fails, so users never see the outage.
- **Monitoring and load testing.** X-Ray tracing on the Express app, a CloudWatch dashboard
  comparing Task 1 and Task 2, and `scripts/loadtest.js` runs recorded in `docs/baselines/`,
  open findings included.

It also had to work within real limits: no IAM role creation, a burstable instance that runs
out of CPU credits under load, and lab sessions that expire mid-deploy. The notes in
`docs/baselines/` and `docs/task2-plan.md` record how each one was handled.

| | |
|---|---|
| **Live** | environment is being re-provisioned after an AWS Academy Learner Lab reset (see [Deploying](#deploying)) — no working URL at the moment |
| **Health** | `/health` on whichever URL the current environment answers at — checks RDS, DynamoDB and S3 |
| **Region** | `us-east-1` (AWS Academy Learner Lab constraint) |

> This is a cloud application. It reads and writes real AWS services on every request; there
> is no local database, no mocked AWS client, and no offline mode. Demonstrations and
> integration tests run against a deployed Elastic Beanstalk URL, never against `localhost`.

## What it does

The platform is built as eight vertical functionalities, one owner each. All eight are
implemented, tested and were verified on a live environment; see the table at the top of this
document for the current deployment status.

| | Owner | Role | Functionality |
|---|---|---|---|
| F1 | Taha Fahd Ahmed Mohammed | Requester | Search and browse verified listings |
| F2 | Taha Fahd Ahmed Mohammed | Requester | Submit a booking request and track its status |
| F3 | Abubaker Elsiddig Tageldeen | Provider | Create and manage service listings |
| F4 | Abubaker Elsiddig Tageldeen | Provider | Accept / reject / update booking requests |
| F5 | Aldhahyani Lama M. A. | Admin | Review and approve/reject provider registrations |
| F6 | Aldhahyani Lama M. A. | Admin | Monitor system-wide activity through reports |
| F7 | Noor Khalil Abdullah Khaled | Coordinator | Assign a volunteer to a confirmed booking |
| F8 | Noor Khalil Abdullah Khaled | Coordinator | Update and log completion status |

Registration, sign-in, sign-out, role-based routing, the accessible layout and the `/health`
probe are cross-cutting and jointly owned.

## Architecture

| Concern | Service | Notes |
|---|---|---|
| Compute | AWS Elastic Beanstalk | Node.js 24 on Amazon Linux 2023, Express behind the environment's load balancer and nginx |
| Relational data | Amazon RDS for MySQL 8 | `Publicly Accessible = No`; reached only from inside the VPC; `mysql2` pool, parameterised queries only |
| History / sessions | Amazon DynamoDB (on-demand) | Booking timeline, and the session store with a TTL |
| Objects | Amazon S3 | Service images; Block Public Access on, versioned, encrypted; reached only through short-lived presigned URLs |
| AWS access | AWS SDK v3 | Credentials resolve from the EC2 **instance profile** (`LabInstanceProfile` → `LabRole`); no access key exists in this repository |
| Views | EJS, server-rendered | Progressively enhanced with vanilla `fetch`; every page works with JavaScript disabled |
| Notifications (Task 2) | Amazon SNS + SQS + AWS Lambda | Booking and provider decisions publish to SNS; an SQS queue feeds the notification Lambda, with a dead-letter queue for failures (`services/notification`) |
| Reports, timeline (Task 2) | Amazon API Gateway + AWS Lambda | Admin reports and a booking's history served by Lambda behind API Gateway, with a direct-read fallback in the app (`services/reports`, `services/timeline`) |
| Monitoring (Task 2) | AWS X-Ray + Amazon CloudWatch | Traces across Express, MySQL, DynamoDB and S3; a dashboard comparing the Task 1 and Task 2 builds |

Architecture diagrams for both tasks are in `docs/diagrams/`.

**Why two databases.** A booking's current state is one row in MySQL — transactional, joined
to services and providers, constrained by foreign keys. Its history is a different shape: an
append-only stream, never updated, always read as "everything about one booking, in order".
That is a key-and-range access pattern with no joins, so it lives in DynamoDB, partition key
the booking and sort key the moment. MySQL commits first because it holds the authoritative
status; the timeline is appended after and, if that append fails, the failure is logged for
reconciliation rather than failing the user's action.

## Security

- RDS is not publicly accessible; its security group admits port 3306 only from the
  application tier's security group.
- S3 has Block Public Access on, versioning and encryption on; every object is reached through
  a backend-generated presigned URL with a short expiry.
- Authentication is bcrypt + `express-session` with the session in DynamoDB. Authorisation is
  re-checked **server-side on every route** — hiding a link is not access control, and every
  booking query is keyed on the signed-in owner so no one can reach another user's record by
  editing the URL.
- `helmet`, a hand-rolled double-submit CSRF token, login rate limiting, and `HttpOnly`,
  `SameSite=Lax`, server-expiring session cookies.
- No secrets in the repository: `.env` is gitignored, `.env.example` holds placeholders only,
  and `scripts/secret-scan.sh` gates every push.

## Accessibility

The platform targets **WCAG 2.2 AA**, built in from the first view rather than retrofitted:
semantic HTML with ARIA landmarks and a skip link, full keyboard operability with a visible
focus ring, contrast measured by `scripts/check-contrast.js` (all pairs pass), target sizes
≥ 24 px, errors stated in text and tied with `aria-describedby` so colour is never the only
signal, `prefers-reduced-motion` respected, mandatory alt text on images, and a mobile-first
layout with no horizontal scroll at 320 px.

## Demo accounts

All accounts share the domain `@bridgeability.demo`. One password per role:

Each role's password is the TP number of the group member who owns that role, so the
credential maps straight to the workload matrix.

| Role | Owner | Email | Password |
|---|---|---|---|
| Requester | Taha Fahd Ahmed Mohammed | `requester@bridgeability.demo` | `tp078281` |
| Provider | Abubaker Elsiddig Tageldeen | `provider@bridgeability.demo` | `tp078003` |
| Admin | Aldhahyani Lama M. A. | `admin@bridgeability.demo` | `tp078792` |
| Coordinator | Noor Khalil Abdullah Khaled | `coordinator@bridgeability.demo` | `tp078880` |

There are three requester and five provider accounts (`kumar@`, `meiling@`, `grace@`, `ravi@`,
`nadia@`, `faizal@`) sharing each role's password; the four above are the ones to demonstrate
with.

### About these passwords

Published demo credentials, by design — `db/seed.sql` records that the account hashes are not
secrets, since an assessor has to be able to sign in as each role. They are set, not by the
seed, but by `db/patches/003-demo-account-passwords.sql`, which runs from the Beanstalk
instance on every deploy and updates only the `@bridgeability.demo` accounts, so it never
touches a user who registered through the live site. The seed stores only a bcrypt hash and a
hash cannot be reversed, so if the plaintext is ever lost it is reset through that patch rather
than recovered.

## Seeded data

The seed proves the visibility rule and gives every queue depth to demonstrate:

- **11 services**, of which the catalogue shows **9** — service 10 is inactive and service 11
  belongs to a rejected provider, so neither may appear.
- **10 bookings** covering all six statuses (pending, accepted, assigned, completed, rejected,
  cancelled).
- **Assignments** in `in_progress` and `completed`, for the coordinator flow.

## Running it

This application runs on Elastic Beanstalk. That is the supported and only demonstrated mode —
it needs RDS, DynamoDB and S3, reads its AWS credentials from the instance profile, and reaches
a private database from inside the VPC.

Running Express on a laptop is tolerated only as a brief edit loop against those same AWS
services (a reachable `DB_HOST`, valid AWS credentials in the environment, and every variable
from `.env.example` set). It is not a supported way to run the project and is never how a demo
is given.

## Deploying

**First time in a fresh AWS Academy lab session** (there is no such thing as a VPC ID that
survives a lab reset, so this step cannot be skipped — see `.ebextensions/02-options.config`
for why the VPC/subnet/security group are never hardcoded in this repo):

```bash
# DynamoDB tables — idempotent, safe to re-run after every lab reset. Also reconciles an
# existing table against the tracked definition (adds a missing GSI, enables TTL if it was
# left off) rather than only creating tables from nothing.
AWS_REGION=us-east-1 bash db/dynamodb/create-tables.sh

# Elastic Beanstalk environment, pointed at your *current* lab's network. --single (one
# instance, no load balancer) is why the app security group needs port 80 open directly
# (see scripts/provision.sh's app-tier security group step) rather than only from an ALB.
#
# --instance_profile and --service-role are not optional: without them `eb create` tries to
# auto-create `aws-elasticbeanstalk-service-role` and fails with "No permissions to perform
# iam:CreateRole" -- Academy blocks creating IAM roles (CONVENTIONS.md, "Deliberately rejected").
# LabInstanceProfile / LabRole are the lab-provided ones every member's sandbox already has.
eb create bridgeability-env \
  --single \
  --vpc.id <your-lab-vpc-id> \
  --vpc.ec2subnets <subnet-a,subnet-b,subnet-c> \
  --vpc.securitygroups <your-app-security-group-id> \
  --vpc.publicip \
  --instance_profile LabInstanceProfile \
  --service-role LabRole \
  --envvars "DB_HOST=<rds-endpoint>,DB_USER=<rds-master-username>,DB_NAME=bridgeability,S3_BUCKET=<your-bucket>,DDB_TIMELINE_TABLE=BridgeAbility_BookingTimeline,DDB_SESSIONS_TABLE=BridgeAbility_Sessions,SESSION_SECRET=<32+ random chars>,SESSION_COOKIE_SECURE=false"
```

`DB_PASSWORD` is deliberately left out of that `--envvars` list — a real secret should not sit in
shell history or a command another process on the machine could read via `ps`. Set it
separately, straight into the running environment, either:

```bash
eb setenv DB_PASSWORD=<your-rds-master-password>
```

or Elastic Beanstalk console → the environment → Configuration → Software → Environment
properties.

The RDS instance itself is provisioned separately through the console or CLI (`PubliclyAccessible
= No`, in the same VPC, with a security group that admits 3306 only from the app's security
group), since it is stateful and not something to recreate on every deploy.

Every deploy after that is the EB CLI against the existing environment:

```bash
eb deploy
```

Schema and seed migrations run **on the instance**, inside the VPC, against the private RDS,
via `.ebextensions/01-migrate.config` on every deploy — there is no separate manual step.

Amazon Linux 2023 serves the Node.js version in `package.json`. A returning visitor never gets
a stale stylesheet: static asset URLs carry a hash of their contents and are cached as
`immutable`, while rendered HTML is `no-store`.

## Tests

```bash
npm test              # unit suite — pure modules, no AWS connection
BASE_URL=http://<your-env>.elasticbeanstalk.com npm run test:integration
```

The unit suite covers the validation schemas, the CSRF comparison, the authorisation guards,
the session store's expiry maths, the SQL statement splitter, and the F2 booking flow
(the Kuala Lumpur wall-clock conversion, submission validation, pagination and the status
filter). The integration suite runs `/health`, the public catalogue and the sign-in redirect
against a real deployed URL passed as `BASE_URL` — there is no local database or mocked AWS
client anywhere in the project, so this is the only place RDS, DynamoDB and S3 are exercised
for real.

## Configuration

Every value is environment-driven with no literals in code. Real values are Elastic Beanstalk
environment properties; `.env.example` documents what must be set and holds placeholders only.
`src/config` validates the environment with `zod` at boot and refuses to start if anything is
missing or malformed.

## Repository layout

```
src/
  app.js              Express app: middleware, security headers, routes
  config/             environment validation (zod), fails fast at boot
  routes/             one router per area (auth, dashboard, services, bookings, health)
  controllers/        request handling and view rendering
  services/           business logic (catalogue, bookings, auth, sessions)
  data/mysql/         RDS access — parameterised queries, connection pool
  data/dynamo/        DynamoDB access — session store, booking timeline
  views/              EJS templates and partials
  public/             CSS and progressive-enhancement JavaScript
services/             Task 2 Lambda microservices (notification, reports, timeline)
db/                   schema.sql, seed.sql, patches, migration runner
db/dynamodb/          table definitions and the create-tables script
scripts/              provisioning, load test, secret scan, contrast check, packaging
tests/unit/           unit suite
tests/integration/    suite that runs against the deployed URL (BASE_URL)
docs/                 CRUD matrix, references, working notes
```

## Packaging a submission

```bash
node scripts/package-submission.js [output-name] [git-ref]
```

Builds the zip from `git archive` at a given ref — exactly the committed tree, nothing hand-
picked — after confirming the working tree is clean, `npm test` is green and
`scripts/secret-scan.sh` is clean. Defaults to `G21_Task_2_Final_System.zip` from `HEAD`.

## Team

| Member | ID | Role |
|---|---|---|
| Taha Fahd Ahmed Mohammed | TP078281 | Requester (F1, F2) |
| Abubaker Elsiddig Tageldeen | TP078003 | Provider (F3, F4) |
| Aldhahyani Lama M. A. | TP078792 | Admin (F5, F6) |
| Noor Khalil Abdullah Khaled | TP078880 | Coordinator (F7, F8) |

Third-party snippets and tutorial patterns are acknowledged inline and listed in
`docs/references.md`.
