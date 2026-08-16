# Session handoff — 2026-08-17

Working note, not a deliverable. Delete before packaging the submission.

## Where things stand

| | |
|---|---|
| Live URL | `http://bridgeability-env.eba-ucukykqf.us-east-1.elasticbeanstalk.com` |
| `main` | `92cf5f2` — pushed. **Not deployed:** the Learner Lab session expired mid-session |
| Last deployed | `791e4da` (`app-791e`), verified in a browser before the lab expired |
| Working tree | clean |
| Unit tests | 127 passing (`npm test`) |
| Phase | C — functionalities. F-auth, F1, F2 verified live; **F3 written and committed, not yet deployed**; F4–F8 not started |

## Read this first — the deploy is blocked

`eb deploy` fails with `NotFoundError - Environment "bridgeability-env" not Found`, and every
AWS call is refused:

```
AccessDenied ... with an explicit deny in an identity-based policy:
arn:aws:iam::<account-id>:policy/voc-cancel-cred
```

`voc-cancel-cred` is the policy AWS Academy attaches when a Learner Lab session is stopped or
has timed out. It is an explicit deny on everything, so nothing can be read or written until
the lab is started again from the AWS Academy console — including finding out whether the
Beanstalk environment and the RDS instance still exist or were reaped. `describe-environments`
returning `[]` is not evidence either way while the deny is in force.

**First three things next session,** after starting the lab and refreshing credentials:

1. `eb deploy`, or recreate the environment if the lab reaped it.
2. `S3_BUCKET=<bucket> bash scripts/apply-s3-cors.sh` — F3's upload cannot work until this is
   applied. See below.
3. Verify F3 live as `provider@bridgeability.demo` (`tp078003`), including one image upload.

## Standing instructions from the user

- **Commit and push directly to `main`.** The user dropped the branch-per-functionality flow
  for their own commits (2026-08-16). No more `feat/...` branch + `--no-ff` merge — commit on
  `main`, `git push origin main`. Still keep: one explicit `--author "Taha Fahd
  <tahafahd40@gmail.com>"` on F1/F2 feature commits (no co-author trailers); co-author trailers
  listing all four **only** on genuinely shared cross-cutting work (README, docs, layout);
  never force-push `main`.
- **After every finished unit of work: commit, push, redeploy.**
- Run `bash scripts/secret-scan.sh` *after* `git add`, never before — it only scans tracked
  files, so run early it misses the new file you are about to commit.

Deploy is `eb deploy` with the CLI on PATH:

```bash
export PATH="$PATH:/c/Users/tahaf/AppData/Roaming/Python/Python312/Scripts:/c/Program Files/Amazon/AWSCLIV2"
eb deploy
```

## Written this session — F3, committed but unverified

**F3 — a provider creates and manages service listings** (`0778eb7`, author Abubaker;
CORS policy `92cf5f2`). Full vertical slice, 36 new unit tests, 127 passing overall. Every
EJS view was rendered against a real model in every state (approved/pending/rejected
provider, empty list, create form, edit form, error states) so template locals are known good.
**Nothing here has been exercised against AWS.** It is written and tested, not verified.

- Routes under `/provider/services`, all behind `requireAuth` + `requireRole('provider')`.
  `provider_id` is resolved from the session through `providers.user_id` in every handler; no
  form field or URL segment names an organisation. Every statement in
  `providerServiceRepository` is keyed on the service AND that provider — 404, not 403.
- **Delete is guarded because `bookings.service_id` is `ON DELETE CASCADE`.** Deleting a booked
  listing would silently delete other people's booking history. `deleteUnbookedService` counts
  and deletes in one transaction behind `SELECT ... FOR SHARE`. A booked listing is withdrawn
  (`is_active = 0`) instead, and the delete button is not rendered for it.
- **Images go browser → S3 directly** over a presigned PUT with the content type and exact byte
  length bound into the signature. The key is derived (`services/provider-N/service-M/<uuid>.<ext>`),
  never accepted; the confirm step re-derives and re-checks it, since presign and confirm are
  two separate requests.
- **Alt text is required by `imageConfirmSchema`** even though the column is nullable — an
  image without a description must never exist.
- Everything degrades without JavaScript except the upload itself, which says so in a
  `<noscript>`.

### The one thing most likely to be wrong when it is first run live

**S3 CORS.** The upload is a cross-origin PUT, which is not a CORS-simple method, so the
browser preflights it and refuses the real request unless the bucket answers. Every
server-side test passes and the upload still fails in the browser. `scripts/s3-cors.json` and
`scripts/apply-s3-cors.sh` are committed but **not applied** — the lab expired before they
could be. Apply them, then upload an image in a real browser; `curl` will not reveal this.

Second most likely: `SELECT ... FOR SHARE` in `deleteUnbookedService` and `FOR UPDATE` in
`setImage`/`clearImage` are MySQL 8 syntax and have never run against the real instance.

## Shipped and verified in the previous session

1. **F2 — submit a booking request and track its status** (`cf9c4ac`, merged `9f47d2f`).
   Full vertical slice, verified end to end on the live URL as `requester@bridgeability.demo`:
   submit → detail page with the DynamoDB timeline → `?status=` filter with live counts →
   cancel (guarded MySQL UPDATE + a `BOOKING_CANCELLED` timeline event). The KL wall-clock
   conversion is correct live — the typed wall time is preserved and `created_at` (UTC) is
   shifted +8h for display.
2. **Two defects found by the new tests** — a malformed date returned HTTP 500 instead of 422
   (zod ran a `.refine()` past a failed `.regex()`; fixed with a `superRefine` that re-tests
   the format and returns early), and `partials/field.ejs` silently ignored the `min` it was
   passed (now supports `min`/`max`, guarded on `!= null`).
3. **`README.md` written** (`3d720d5`, cross-cutting, four co-authors). Cloud-first; documents
   the deployed platform, architecture, security, accessibility, seed data and deploy/test flow.
4. **Demo passwords** — the originals were unrecoverable (bcrypt-only, never written down), so
   they were reset via `db/patches/003-demo-account-passwords.sql`. As of `791e4da` each
   password is the **TP number of the role's owner**, published in the README:

   | Role | Owner | Email | Password |
   |---|---|---|---|
   | Requester | Taha | `requester@bridgeability.demo` | `tp078281` |
   | Provider | Abubaker | `provider@bridgeability.demo` | `tp078003` |
   | Admin | Lama | `admin@bridgeability.demo` | `tp078792` |
   | Coordinator | Noor | `coordinator@bridgeability.demo` | `tp078880` |

   The patch updates only `@bridgeability.demo` rows, is idempotent, and runs on every deploy
   from the instance (the only place with a route to the private RDS). Log line to confirm a
   deploy applied it: `patches/003-demo-account-passwords.sql: 4 applied`.
   Note: these are 8 chars, under the app's 12-char *registration* floor. Fine here — the patch
   writes hashes directly and sign-in has no length rule — but a person can't set one this short
   through the sign-up form. Pad to e.g. `tp078281-demo` if that inconsistency matters on camera.

## Next: F4–F8

Same vertical-slice shape as F1/F2/F3: route → controller → service → data access → view →
test → `docs/crud-matrix.md` entry. The `bookings` table, `assignments` table, the DynamoDB
timeline (`appendEvent` with the `EVENTS` map) and `status-pill.ejs` already exist and are what
F4/F7/F8 build on. F3 added `providerServiceRepository.findProviderByUserId`, which F4 should
reuse rather than re-resolving the provider itself.

- **F4 — Abubaker (provider).** Accept/reject/update bookings (RDS update `bookings.status`,
  DynamoDB `BOOKING_ACCEPTED`/`REJECTED` events). The provider's incoming queue reads through
  `idx_bookings_service`. Deploy after F4 → Checkpoint 3.
- **F5/F6 — Lama (admin).** F5 approve/reject provider registrations (RDS update
  `providers.status`); F6 system-wide reports (RDS aggregates, DynamoDB GSI-1 query on the
  timeline).
- **F7/F8 — Noor (coordinator).** F7 assign a volunteer to a confirmed booking (RDS create
  `assignments`, update `bookings.status`); F8 update/log completion (RDS update
  `assignments.completion_status`, DynamoDB `VOLUNTEER_ASSIGNED`/`BOOKING_COMPLETED` events).
  Deploy after F8 → Checkpoint 3.

Each owner commits with their own `--author`. Phases D–G unchanged: hardening, mock viva 1,
integration tests against the deployed URL, 2-AZ + RDS Multi-AZ, study kit, mock viva 2.

## Owed, deliberately deferred

- **320px reflow check** — `resize_window` to 320 left `innerWidth` at 1960 (Chrome's minimum
  window width plus DPI scaling). Needs device emulation or a real narrow window. Phase E.
- **`docs/defect-log.md` does not exist yet.** Six real entries owed: the
  `upgrade-insecure-requests` CSP defect, the stale-CSS defect, the interpreter illustration,
  the zod refinement that turned a malformed date into a 500, the `min` the field partial
  ignored, and the honest limitation that `express-rate-limit` counts per process so the login
  limiter weakens once the environment scales past one instance.
- Still unwritten: `docs/workload-matrix.md`, `test-plan.md`, `deployment-runbook.md`,
  `references.md`, `docs/demo/*`, `scripts/package-submission.js`, `deploy.sh`,
  `render-matrix.js`, `spec.md`, `tasks.md`.

## Traps in this environment

- **Heredoc/redirect trap.** Writing files with a bash heredoc sometimes replays the contents
  unquoted, and `=>` acts as a shell redirect, creating 0-byte junk files with names like `'`,
  `span`, `` ` ``. Two were cleaned up this session. Prefer the Write tool for new files, and
  check `git status` before every commit.
- **`curl` ignores CSP.** Anything about rendering has to be checked in a real browser, on the
  deployed URL — a past CSP defect shipped because it was checked with curl.
- **Signing in.** The assistant cannot type a password into a login field (hard rule), even a
  demo one. The user has to sign in; the assistant drives the rest afterward.
- **Screenshot vs viewport scaling.** The browser screenshot is ~1568px wide but the page
  viewport is ~1910px, so coordinate clicks are off. Use `find` + a `ref`-based click for
  buttons (that is why the cancel button took a ref click, not a coordinate click).
- **RDS is private.** No route from a laptop. Migrations, seeding and the password patch run
  from the Beanstalk instance (`.ebextensions/01-migrate.config`, `leader_only`) on each deploy.
- **The lab expires without warning.** It happened mid-session on 2026-08-17, after the code
  was committed and pushed but before it could be deployed. Nothing is lost when it does —
  `main` is the record — but plan on committing and pushing *before* deploying, not after, so
  an expiry costs a deploy rather than the work.
- **The redirect trap is real and it fired again.** Two more 0-byte files (`buildQueryString(status`
  and `{console.error('RENDER`) were created by `=>` inside a `node -e` argument acting as a
  shell redirect. Both were cleaned up. Check `git status` before every `git add -A`.
