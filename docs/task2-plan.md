# Task 2 — Cloud Service Integration & Monitoring: audit and plan

Group 21 · Topic 4 · CT071-3-3-DDAC
Deadline: **Friday 18 September 2026, 17:00** — four working days from 14 September.

Three deliverables, all named for the group number (the brief's template says `G1_`; we are
Group 21, so confirm with the lecturer whether to use `G21_` or the literal `G1_`):

| File | Section | Marks |
|---|---|---|
| `G21_Task_2_Final_System.zip` | 2 | 10 |
| `G21_Task_2_System_Demo.mp4` (15 min) | 2 | — |
| `G21_Task_2_Final Report.docx` (≤ 40 pages, ≤ 4,000 words) | 1, 3, 4 | 3 + 3 + 4 |

---

# Part A — audit of Task 1

Audited against `CLAUDE.md` (the conventions the team locked for Task 1) and the code as it
stands on `main`. **The Task 1 brief PDF is not in this repo or in Downloads** — someone should
re-read it against this list before Friday in case it asks for anything not captured here.

## What is in good shape

- **All eight functionalities are implemented.** Routes, controllers, services, repositories,
  views and tests exist for F1–F8 plus the cross-cutting auth slice. 37 routes across 10
  routers.
- **173 unit tests pass** (`npm test`, clean).
- **`scripts/secret-scan.sh` is clean** across 123 tracked files. No `.env`, no `*.pem`, no
  `.elasticbeanstalk/` state, no AWS keys tracked. `.gitignore` is correct.
- **The locked stack is honoured with no substitutions**: Elastic Beanstalk + Express, RDS
  MySQL through a `mysql2` pool with parameterised queries only, DynamoDB for the session store
  and the booking timeline, S3 reached only through presigned URLs, AWS SDK v3 resolving
  credentials from the instance profile, bcrypt + `express-session`, `zod` on every boundary,
  `helmet` + hand-rolled double-submit CSRF + login rate limiting. No `if (isLocal)` branch
  anywhere, no mocked AWS client, no local database.
- **`docs/crud-matrix.md` is genuinely strong** — full CRUD × three stores, every cell naming
  the owning functionality and the route that reaches it. This is marking evidence; keep it.
- **Accessibility is built in, not bolted on**: `scripts/check-contrast.js`, `a11y.js`, a
  `field.ejs` / `error-summary.ejs` partial pair wiring `aria-describedby`, skip link, status
  pills that are not colour-only.
- **The DynamoDB key design already anticipates Task 2.** `GSI-1` is keyed on `status` and
  `GSI-2` on `providerId`, both sorted by timestamp, explicitly "for F6". A reporting Lambda
  can read those directly — the microservice extraction below is not a retrofit, it is the
  design's own next step.

## What must be fixed before the Task 2 zip goes in

Ordered by how much it costs if it is left alone.

### A1. The deployed environment no longer exists — **blocker, fix first**

`bridgeability-env.eba-ucukykqf.us-east-1.elasticbeanstalk.com` does not resolve (NXDOMAIN),
and `aws sts get-caller-identity` returns `InvalidClientTokenId`. The Learner Lab session
expired and the environment is gone.

This blocks **Section 3 outright**. That section needs *measured* CloudWatch/X-Ray numbers for
the Task 1 architecture to compare against Task 2 — and you cannot measure an architecture that
is not running. Standing the environment back up is on the critical path for the report, not
just for the demo.

Re-provisioning also needs the RDS instance, the DynamoDB tables and the S3 bucket recreated,
because a terminated lab takes those too. Budget a full session for it (Day 1 below) and script
it so the second and third re-provision cost minutes, not hours.

### A2. Git attribution does not read like the workload matrix

`CLAUDE.md` calls this "load-bearing, not cosmetic", and it is currently broken in exactly the
way that section warns about:

```
14  Taha Fahd <tahafahd40@gmail.com>
 8  Taha Thabit <tahafahd40@gmail.com>          <- the alias CLAUDE.md says to avoid
 3  Abubaker Elsiddig <tagabobakr@gmail.com>
 3  Noor <noorkhalil6867@gmail.com>
 2  Lama Aldhahyani <Aldhahyanilama@gmail.com>
 2  Noor Khalil <noorkhalil6867@gmail.com>
 2  Taha Fahd <125373395+6rzan@users.noreply.github.com>
 1  Abubaker <tagabobakr@gmail.com>
```

Two problems. **Split identities** — eight rows for four people; Taha appears under three.
**Skew** — collapsed, that is Taha 24, Noor 5, Abubaker 4, Lama 2, for a matrix in which every
member owns two functionalities equally.

Fix the split identities with a `.mailmap` at the repo root. It is a tracked file, it rewrites
nothing, and `git shortlog -sne` honours it immediately:

```
Taha Fahd Ahmed Mohammed <tahafahd40@gmail.com> Taha Thabit <tahafahd40@gmail.com>
Taha Fahd Ahmed Mohammed <tahafahd40@gmail.com> Taha Fahd <125373395+6rzan@users.noreply.github.com>
Abubaker Elsiddig Tageldeen <tagabobakr@gmail.com> Abubaker <tagabobakr@gmail.com>
Noor Khalil Abdullah Khaled <noorkhalil6867@gmail.com> Noor <noorkhalil6867@gmail.com>
```

The skew cannot be fixed retroactively and should not be faked. Fix it *going forward*: Task 2
is four microservices, one per member (Part B), each committed by its owner with an explicit
`--author`. By Friday the Task 2 half of the history reads correctly, and the report's workload
matrix explains the Task 1 half honestly.

### A3. `main` has diverged from `origin/main`

Local `main` is 3 commits ahead and 2 behind:

- unpushed locally: `495bf13`, `1eea15c`, `d2ed482` (the personal-deploy fixes, see A4)
- on origin only: `27333ab` *docs: add navigable role-workflow diagram*, `208d44c` *Removed
  unnecessary comments*

Reconcile before anything else is built on top, or the Task 2 branches fork from the wrong base
and the zip ships a history nobody can read.

### A4. `.ebextensions/02-options.config` is pinned to one member's personal lab

Commit `495bf13` ("Personal deploy: use my own Learner Lab VPC/subnet/security group") hardcodes
`vpc-00e5ec931276e927d`, three subnet IDs and `sg-021100f4ae72d73b4` into a tracked file.

Three consequences: every other member's `eb deploy` fails; it contradicts the project's own
"config is env-driven with zero literals" rule; and — most immediately — **AWS Academy hands out
a new VPC on every lab reset**, so these IDs are already stale and will be stale again by
Friday. Move them into `.elasticbeanstalk/config.yml` (untracked) or supply them at
`eb create` time, and leave the tracked `.ebextensions` file holding only the platform settings
that are genuinely the same for everyone.

### A5. The README describes a project that does not match the repo

- **F3–F8 are marked "Planned"** in the status table. All six are implemented and tested. The
  README currently understates the team's own work to an assessor reading it first.
- **Three referenced things do not exist**: `scripts/package-submission.js` (so `npm run package`
  fails), `docs/references.md`, and `tests/integration/` (so `npm run test:integration` matches
  no files).
- The live URL is dead (A1).

`docs/references.md` is the one with teeth: `CLAUDE.md` requires it under the module's
plagiarism rule, and the inline citations it is supposed to index already exist in the code
(`sessionStore.js` cites the express-session store contract and the DynamoDB TTL docs,
`csrf.js` cites the OWASP CSRF cheat sheet, `authSchemas.js` cites NIST SP 800-63B). The file
has to be written and those four entries carried into it with URLs and access dates — they also
feed the report's APA reference list.

### A6. Housekeeping before the zip

- `dynamo-timeline-table.json` sits untracked at the repo root — either track it under `db/` as
  the table definition it is, or delete it.
- `docs/notes/handoff.md` says on line 3 "Working note, not a deliverable. Delete before
  packaging the submission." It is still there, and it contains a local filesystem path from
  another member's machine.
- `src/public/css/main.css` is 706 lines against the project's own 500-line ceiling. Lowest
  priority on this list; split it by concern only if there is spare time.

---

# Part B — Task 2 plan

## B0. The shape of the answer

The brief asks for three things that have to agree with each other: two architecture diagrams,
a working serverless/microservices implementation, and monitoring data comparing the two. The
usual way teams lose marks here is that the diagram shows five services, the demo shows two, and
the monitoring section shows a screenshot of an idle dashboard. **Build the smaller thing and
make all three agree.**

Mandatory floor from Section 2: API Gateway **and** Lambda, plus at least one of S3 / SNS / SQS.
The plan below delivers all four of S3, SNS, SQS and API Gateway across three microservices,
with a fourth as a stretch — one owner each, which also repairs the attribution problem in A2.

## B1. The four microservices

Each extraction is chosen because the monolith is genuinely doing the wrong thing today, not
because a service needed to be used. That reasoning is what Section 1 point 4 asks for, so it is
recorded here per service and should be lifted into the report.

### MS-1 — Notification Service · **SNS + SQS + Lambda** · owner: Abubaker (TP078003)

**Today:** when a provider accepts or rejects a booking (F4) or an admin approves a provider
(F5), the request handler writes MySQL, then appends a DynamoDB timeline event, inline, before
responding. Notifying anybody would extend that same synchronous chain.

**Task 2:** the monolith publishes one message to an SNS topic `bridgeability-booking-events`
and returns. SNS fans out to an SQS queue `bridgeability-notifications` with a redrive policy to
a dead-letter queue. A Lambda consumes the queue in batches, formats the notification and writes
a `notifications` item to DynamoDB (and optionally sends mail through SES if the lab allows it).

**Why it is better, in one line for the report:** the user's request no longer waits for work
the user does not read, a notification failure can no longer fail a booking, and the retry and
dead-letter behaviour is the queue's job rather than ours. This is also the clearest place to
demonstrate loose coupling on camera — stop the Lambda, watch `ApproximateNumberOfMessagesVisible`
climb while the site stays fully responsive, start it again, watch the backlog drain.

### MS-2 — Reports Service · **API Gateway + Lambda + DynamoDB** · owner: Lama (TP078792)

**Today:** `GET /admin/reports` runs three `GROUP BY` aggregates against RDS on every page load
(`reportRepository.js`). Aggregates are the query shape that hurts a small RDS instance most,
and they run on the same instance serving every booking write.

**Task 2:** a REST endpoint on API Gateway → a Lambda that reads the DynamoDB timeline through
`GSI-1` (status) and `GSI-2` (providerId) — the indexes the Task 1 design already built for
exactly this — and returns JSON. The EJS page fetches it, degrading to the existing
server-rendered table if JavaScript is off, which keeps the accessibility commitment intact.

**Why it is better:** the reporting read path scales independently of the transactional write
path and stops competing with it for the same database connections. This is the single
cleanest before/after for Section 3 — RDS CPU and connection count under a report-heavy load
test, monolith versus microservice.

### MS-3 — Booking Timeline Service · **API Gateway + Lambda + DynamoDB** · owner: Noor (TP078880)

**Today:** the timeline read is a DynamoDB Query inside the Express process, on the booking
detail page for F2 and the coordinator view for F7/F8.

**Task 2:** move that read behind API Gateway + Lambda. The booking detail page fetches the
timeline after first paint. Small, self-contained, and it gives a second independently
deployable API for the diagram.

**Why it is better:** history is read far more often than it is written and never needs the web
tier's session, so it is free to scale on its own; the booking page renders without waiting on
it.

### MS-4 — Media Processing Service · **S3 event + Lambda** · owner: Taha (TP078281) · *stretch*

**Today:** a provider presigns a PUT and the original bytes are served straight back through a
presigned GET (F3). Nothing validates the real content or size after upload, and a 5 MB photo
is sent to a phone unchanged.

**Task 2:** uploads land under an `uploads/` prefix. The S3 `ObjectCreated` event invokes a
Lambda that verifies the object really is an image of the declared type, generates a thumbnail
into `derived/`, and writes the derived key back. Listings then serve the thumbnail.

**Why it is better:** image work leaves the request path entirely and the bucket enforces its own
content rules rather than trusting a client-declared content type.

**Cut this one first if Day 3 runs late.** MS-1 to MS-3 already satisfy the brief in full
(API Gateway ✓, Lambda ✓, SNS ✓, SQS ✓, and S3 is already integrated from Task 1).

## B2. Cross-cutting decisions to settle on Day 1

- **Lambda runtime:** Node.js 22 or 24, matching the monolith so the same idioms and the same
  SDK v3 clients are reused and can be shown side by side on camera.
- **IAM:** `LabRole` for every Lambda — the Learner Lab blocks creating roles. Say this out loud
  in the demo and name it as a lab constraint, not a design choice, so it does not read as
  ignoring least privilege.
- **Deployment of the Lambdas:** zip-per-function deployed with the AWS CLI from a script in
  `scripts/`. Do not introduce SAM or CDK four days out.
- **Repo layout:** `services/notification/`, `services/reports/`, `services/timeline/`,
  `services/media/`, each with its own `index.js`, `package.json` and README. The monolith stays
  where it is. This makes "each microservice functions independently" visible in the zip's
  directory tree, which is the first thing a marker looks at.
- **Keep the monolith's fallback paths.** If the reports Lambda is unreachable the server-rendered
  table must still render. Graceful degradation is already a project commitment and it also
  means a Lambda failure cannot kill the live demo.

## B3. Monitoring — Section 3 (3 marks), the part that needs planning earliest

The comparison has to be **measured**, not asserted. That means the Task 1 architecture has to be
running and load-tested *before* the refactor replaces it.

**Run two environments side by side.** Tag the current commit as `task1-baseline`, create
`bridgeability-task1-env` from that tag, and keep `bridgeability-env` for the Task 2 build.
Both alive at once means you can run identical load against both on the same afternoon and
screenshot one dashboard containing both. Running the baseline first and then upgrading in place
means any lab hiccup costs you the baseline permanently.

**Instrumentation:**

- X-Ray on Beanstalk via `aws:elasticbeanstalk:xray: XRayEnabled: true` plus `aws-xray-sdk-core`
  wrapping the `mysql2`, DynamoDB and S3 clients. The service map showing Express → RDS/DDB/S3
  before, and Express → API Gateway → Lambda → DDB after, is the single best screenshot in the
  whole report.
- Active tracing enabled on every Lambda and on the API Gateway stage.

**Metrics to capture, both architectures, same load:**

| Source | Metrics |
|---|---|
| Elastic Beanstalk / ELB | `ApplicationLatencyP99`, `ApplicationLatencyP50`, `ApplicationRequests5xx`, `ApplicationRequests2xx` |
| EC2 | `CPUUtilization`, `NetworkOut` |
| RDS | `CPUUtilization`, `DatabaseConnections`, `ReadLatency`, `WriteLatency` |
| Lambda | `Duration`, `Errors`, `Throttles`, `ConcurrentExecutions`, `IteratorAge` |
| API Gateway | `Count`, `Latency`, `IntegrationLatency`, `4XXError`, `5XXError` |
| SQS | `ApproximateNumberOfMessagesVisible`, `ApproximateAgeOfOldestMessage`, `NumberOfMessagesDeleted` |
| DynamoDB | `ConsumedReadCapacityUnits`, `SuccessfulRequestLatency`, `ThrottledRequests` |

**Load generation:** one script in `scripts/loadtest.sh` using `autocannon`, fixed concurrency
and duration, hitting the same four paths (`/services`, a booking detail, `/admin/reports`, and a
status-change POST) against whichever base URL it is given. Same script, both environments, so
the comparison is honest and reproducible — and say in the report that it was the same script.

**One CloudWatch dashboard** with both environments' widgets side by side, plus a math expression
for p99 latency delta. Screenshot it once with load running, not idle — an idle dashboard is the
classic way this section loses its marks.

**Expected finding, and be ready to report it honestly:** for a small load the serverless path
will likely show *higher* per-request latency (cold starts, an extra network hop) while showing
better RDS utilisation and better isolation of failure. The brief asks you to "evaluate and
justify whether the architectural changes are necessary and beneficial" — it does not ask you to
prove they are. A measured trade-off, argued well, scores better than a claimed win the numbers
do not support.

## B4. Day-by-day

Four days. Lab sessions are time-boxed and expire, so each day ends with everything committed,
pushed and re-creatable.

**Day 1 — Monday 14 Sep · infrastructure back up, and the baseline captured**
1. Reconcile `main` with `origin/main` (A3); add `.mailmap` (A2).
2. Un-pin `.ebextensions` from the personal lab (A4); write `scripts/provision.sh` so the whole
   stack — RDS, both DynamoDB tables, the S3 bucket, the EB environment — comes back from one
   command. This script pays for itself the first time the lab resets.
3. Stand the Task 1 stack up, tag it `task1-baseline`, verify `/health` reports RDS, DynamoDB and
   S3 all `ok`.
4. Write `scripts/loadtest.sh`. Enable X-Ray on the baseline environment.
5. **Capture the Task 1 baseline: run the load test, screenshot every metric in the table above,
   export the X-Ray service map.** Do not end the day without this — it is the half of Section 3
   that becomes impossible to recover once the refactor lands.
6. Fix the README (A5), write `docs/references.md`, clear the housekeeping (A6).

**Day 2 — Tuesday 15 Sep · MS-1 and MS-2**
- Abubaker: SNS topic, SQS queue + DLQ, notification Lambda, and the monolith's publish call
  replacing the inline work in F4/F5.
- Lama: reports Lambda, API Gateway REST API, the `/admin/reports` page fetching it with the
  server-rendered table kept as the no-JS fallback.
- Everyone commits under their own `--author`. Deploy and smoke-test both.

**Day 3 — Wednesday 16 Sep · MS-3, MS-4 if there is room, and the diagrams**
- Noor: timeline Lambda + API Gateway route; booking detail page fetching it.
- Taha: media Lambda on the S3 event — **or drop it** and move to diagrams if Day 2 slipped.
- Both architecture diagrams drawn (draw.io with the AWS 2024 icon set, exported at print
  resolution). Diagram 1 must depict what was actually measured on Day 1; diagram 2 must depict
  what is actually deployed. They will be compared against the demo.
- Full CloudWatch dashboard built with both environments on it.

**Day 4 — Thursday 17 Sep · measure, record, write**
- Run the identical load test against the Task 2 environment. Capture every metric and the new
  X-Ray service map.
- Record the 15-minute demo. Suggested split — 2 min architecture diagrams and what changed,
  4 min the working application across the four roles, 5 min the AWS console (SNS topic, SQS
  queue with the deliberate backlog demo, Lambda configuration and a live log stream, API Gateway
  stage, S3 event notification), 3 min CloudWatch and X-Ray side by side, 1 min the Task 1 → Task 2
  transformation restated. **Every member speaks**, and each introduces their own microservice.
- Write the report against the six-part structure in the brief, ≤ 40 pages and ≤ 4,000 words.
  Reflections are individual and must actually differ from one another — a marker reads four
  paraphrases of the same paragraph instantly.

**Friday 18 Sep, morning · submit**
- Regenerate the zip, run `scripts/secret-scan.sh` one final time, confirm the three filenames
  match the template, and submit before 17:00 with room to spare. Do not leave the upload to the
  last hour.

## B5. Report structure → where the content comes from

| Report section | Source |
|---|---|
| 1. Cover page | Topic 4, BridgeAbility, Group 21, four members with TP numbers |
| 2. Design & implementation | Diagram 1 and 2 (Day 3), the per-service "why it is better" paragraphs in B1, code screenshots of each Lambda handler and the API Gateway / SNS / SQS / S3-event console configuration |
| 3. Results & discussion | The two metric captures (Day 1 and Day 4) and the X-Ray service maps, with the honest trade-off argument from B3 |
| 4. Reflections | One per member, written individually, naming their own microservice and a real difficulty |
| 5. Workload matrix | Task 1 F1–F8 owners from `CLAUDE.md`, plus Task 2: Abubaker MS-1, Lama MS-2, Noor MS-3, Taha MS-4 + diagrams |
| 6. References | APA, seeded from `docs/references.md` and the four citations already inline in the code |

## B6. Risks

| Risk | Mitigation |
|---|---|
| Lab session expires mid-build and takes the stack with it | `scripts/provision.sh` from Day 1; everything committed at the end of each session |
| Misdiagnosing an expired lab as a deleted environment | `eb deploy` reporting `NotFoundError - Environment ... not Found`, or `describe-environments` returning `[]`, reads exactly like the environment was deleted — it wasn't. The real tell is an `AccessDenied ... explicit deny ... voc-cancel-cred` on *any* AWS call, which is what Academy attaches the moment a lab session stops. **Do not rebuild anything on the first symptom.** Restart the lab from the Academy console, refresh credentials, retry — the environment, RDS and S3 bucket are usually still there. This is what happened to `bridgeability-env` on 17 Aug and cost a rebuild that a credential refresh would have avoided. |
| Task 1 baseline never captured, Section 3 has nothing to compare | Day 1 step 5 — treat it as the day's definition of done |
| Four microservices in three days is too many | MS-4 is explicitly the one to cut; MS-1–3 already satisfy the brief |
| Learner Lab blocks SES, so the notification Lambda has nothing to send | Write the notification to DynamoDB and show the CloudWatch log — the assessed thing is the SNS→SQS→Lambda path, not the email |
| Diagrams drift from what is deployed | Draw them on Day 3, after the build, not before |
