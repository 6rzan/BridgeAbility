# Session handoff — 2026-08-16

Working note, not a deliverable. Delete before packaging the submission.

## Where things stand

| | |
|---|---|
| Live URL | `http://bridgeability-env.eba-ucukykqf.us-east-1.elasticbeanstalk.com` |
| `main` | `791e4da` — pushed, deployed (`app-791e`), verified in a browser. Env Ready/Green |
| Working tree | clean |
| Unit tests | 91 passing (`npm test`) |
| Phase | C — functionalities. F-auth, F1 and **F2 shipped and verified live**; F3–F8 not started |

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

## Shipped and verified this session

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

## Next: F3–F8

Same vertical-slice shape as F1/F2: route → controller → service → data access → view → test →
`docs/crud-matrix.md` entry. The `bookings` table, `assignments` table, the DynamoDB timeline
(`appendEvent` with the `EVENTS` map) and `status-pill.ejs` already exist and are what F4/F7/F8
build on.

- **F3/F4 — Abubaker (provider).** F3 create/manage listings (RDS CRUD on `services`, S3
  presigned PUT for images); F4 accept/reject/update bookings (RDS update `bookings.status`,
  DynamoDB `BOOKING_ACCEPTED`/`REJECTED` events). Deploy after F4 → Checkpoint 3.
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
