# BridgeAbility — project conventions

Cloud platform for booking and coordinating accessibility services for persons with
disabilities in Malaysia. Module CT071-3-3-DDAC, Asia Pacific University, Group 21, Topic 4.
Originally scoped to **Task 1** — Frontend & Backend Development + Cloud Database Service —
this repo now also carries **Task 2** — Cloud Service Integration & Monitoring: serverless
components (API Gateway, Lambda, SNS, SQS) and CloudWatch/X-Ray monitoring layered onto the
same Task 1 system. See `docs/task2-plan.md` for the plan and `docs/references.md` for what's
cited where.

## The one rule that overrides everything

**This is a cloud project, not a local one.** Every read and write hits a real AWS service.

- No Docker MySQL, no DynamoDB Local, no SQLite, no in-memory store, no mocked AWS clients.
- **No `if (isLocal)` branch anywhere.** If you are about to write one, stop.
- Migrations and seeding run *on AWS*, from the Beanstalk instance inside the VPC.
- Running Express on a laptop is tolerated as a brief edit loop against those same AWS
  services. It is never a supported mode and never appears in the README as "how to run this".
- Demos and integration tests run against the deployed URL. Never localhost.

## Stack — locked, no substitutions

| Layer | Choice |
|---|---|
| Compute | AWS Elastic Beanstalk, **Node.js 24 on AL2023 v6.11.6** (Node 20 is not offered in `us-east-1`) |
| Runtime | Node.js 24, Express |
| Views | EJS server-rendered, progressively enhanced with vanilla JS (`fetch`) |
| Relational | Amazon RDS for MySQL 8.0.43, **`Publicly Accessible = No`** |
| Driver | `mysql2/promise` pool, **parameterised queries only** |
| NoSQL | Amazon DynamoDB, on-demand |
| Objects | Amazon S3, Block Public Access ON, **presigned URLs only** |
| AWS access | AWS SDK v3, credentials from the **instance profile** — never from code |
| Auth | bcrypt + `express-session`, DynamoDB session store with TTL |
| Validation | `zod` on every body and query, plus client-side validation |
| Security | `helmet`, double-submit CSRF, login rate limiting, secure session cookies |
| Tests | Node test runner + `supertest`; integration runs against the deployed URL |
| Monitoring (Task 2) | AWS X-Ray (`aws-xray-sdk-core`/`-mysql`/`-express`, wrapping `mysql2`, DynamoDB, S3 and the Express request cycle) + CloudWatch |
| Serverless (Task 2) | API Gateway + Lambda, at least one of S3 / SNS / SQS per microservice — see `docs/task2-plan.md` |

Region is `us-east-1` (AWS Academy Learner Lab constraint). Service role `LabRole`,
instance profile `LabInstanceProfile` — the lab blocks creating our own IAM roles.

### Deliberately rejected — every member must be able to say why on camera

- **Cognito** — Chapter 4 teaches authentication vs authorization, least privilege and
  implicit deny, and never teaches Cognito. We implement auth at the application layer.
- **`csurf`** — deprecated and unmaintained. We hand-roll a double-submit token.
- **`connect-dynamodb`** — the session store is ~40 lines of our own SDK v3 code, because
  "why do sessions live in DynamoDB" is a graded question and a black box cannot be defended.

## Security — non-negotiable

- RDS `PubliclyAccessible = false`. Security group admits 3306 **only** from the app's SG.
- S3 Block Public Access ON, versioning ON, encryption ON. All access via backend-generated
  presigned URLs with short expiry and enforced content type.
- **Never** commit `.env`, keys, `*.pem`, `.elasticbeanstalk/` state, or the AWS account ID.
  Run `scripts/secret-scan.sh` before every push. Never force-push `main`.
- Authorization is re-checked **server-side on every route**. Hiding a button is not access
  control. A user must not be able to reach another user's resource by calling the route.

## The eight functionalities — one owner each, no overlap

| | Owner | Role | Functionality |
|---|---|---|---|
| F1 | Taha Fahd Ahmed Mohammed (TP078281) | Requester | Search and browse verified listings |
| F2 | Taha Fahd Ahmed Mohammed | Requester | Submit booking request and track status |
| F3 | Abubaker Elsiddig Tageldeen (TP078003) | Provider | Create and manage service listings |
| F4 | Abubaker Elsiddig Tageldeen | Provider | Accept / reject / update booking requests |
| F5 | Aldhahyani Lama M. A. (TP078792) | Admin | Review and approve/reject provider registrations |
| F6 | Aldhahyani Lama M. A. | Admin | Monitor system-wide activity through reports |
| F7 | Noor Khalil Abdullah Khaled (TP078880) | Coordinator | Assign a volunteer to a confirmed booking |
| F8 | Noor Khalil Abdullah Khaled | Coordinator | Update and log completion status |

Each functionality is a **vertical slice**: route → controller → service → data access →
view → test → `docs/crud-matrix.md` entry.

Cross-cutting and jointly owned: registration/login/logout, role-based routing, layout and
navigation, accessibility and responsive baseline, `/health`, seed data, deployment.

## Git attribution — load-bearing, not cosmetic

The distinction band requires contributions "clearly verifiable through the submitted source
code". `git shortlog -sne` must read like the workload matrix, row for row.

- Branch per functionality: `feat/f1-requester-search`, `feat/f4-provider-decisions`, …
- Subject scoped by role: `feat(requester): add service search filters and pagination`
- **Feature commits: one explicit `--author`, the single owner, no co-author trailers.**
  Putting four names on every commit destroys exactly the verifiability being marked.
- **Co-author trailers only on genuinely shared cross-cutting work**, listing all four:

```
Co-authored-by: Taha Fahd <tahafahd40@gmail.com>
Co-authored-by: Abubaker Elsiddig <tagabobakr@gmail.com>
Co-authored-by: Lama Aldhahyani <Aldhahyanilama@gmail.com>
Co-authored-by: Noor Khalil <noorkhalil6867@gmail.com>
```

Local git config says `Taha Thabit`; the workload matrix says `Taha Fahd Ahmed Mohammed`.
Always pass `--author "Taha Fahd <tahafahd40@gmail.com>"` on F1/F2 so the shortlog maps.

Small commits, one logical change each.

## Accessibility — WCAG 2.2 AA, built in from the first view

Topic 4 is a platform for persons with disabilities; one that fails an accessibility audit
refutes its own premise. This is the team's claim on 14–15 rather than 12, and it **cannot be
retrofitted**. Every view, from the first:

- Semantic HTML and ARIA landmarks; skip link; full keyboard operability with visible focus
- Contrast ≥ 4.5:1 body, ≥ 3:1 large text and UI components
- 2.5.8 targets ≥ 24×24 CSS px · 2.4.11 focus never obscured
- 3.3.8 no cognitive test at login; paste allowed; password managers supported
- Errors in text, tied via `aria-describedby` — **never colour alone**
- `prefers-reduced-motion` respected · alt text **mandatory** on uploads
- Responsive mobile-first; no horizontal scroll at 320px; tables reflow, never overflow
- Interactive behaviour degrades gracefully with JavaScript disabled

## Code style

- Keep files under 500 lines. Validate input at every system boundary.
- Config is env-driven with zero literals. Real values are EB environment variables;
  `.env.example` holds placeholders only.
- Cite any third-party snippet or tutorial pattern with an inline comment naming the source,
  and list it in `docs/references.md` with URL and access date. The module's plagiarism rule
  requires acknowledgement even for paraphrased material.
- No stretch features. The rubric rewards completing what was proposed, not adding to it.

## Terminology — slips lose marks on camera

EBS is not Multi-AZ · a read replica is not a failover target · security groups are stateful
while NACLs are stateless · IAM is global, not regional.
