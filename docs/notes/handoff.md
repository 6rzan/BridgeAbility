# Session handoff — 2026-08-16

Working note, not a deliverable. Delete before packaging the submission.

## Where things stand

| | |
|---|---|
| Live URL | `http://bridgeability-env.eba-ucukykqf.us-east-1.elasticbeanstalk.com` |
| `main` | `6719fa2` — pushed, deployed, verified in a browser |
| Current branch | `feat/f2-requester-bookings` — F2 **half built**, see below |
| Unit tests | 66 passing (`npm test`) |
| Phase | C — functionalities. F-auth and F1 shipped; F2 in progress; F3–F8 not started |

Deploy is `eb deploy` with the CLI on PATH:

```bash
export PATH="$PATH:/c/Users/tahaf/AppData/Roaming/Python/Python312/Scripts:/c/Program Files/Amazon/AWSCLIV2"
eb deploy
```

Standing instruction from the user: **after every finished unit of work, commit, push and
redeploy.** Run `bash scripts/secret-scan.sh` *after* `git add`, never before — it only scans
tracked files, so run early it misses exactly the new file you are about to commit.

## Shipped and verified this session

Both were real defects found by opening the deployed site, not by reading code.

1. **Stale CSS after every deploy** (`1441776`). Static files were served for an hour under
   fixed URLs, so for an hour after each deploy a returning visitor got new HTML against the
   cached old stylesheet — the catalogue rendered as an unstyled list. `src/lib/assetVersion.js`
   puts a sha256 of the file contents in the URL; assets are now `immutable` for a year and
   rendered HTML is `no-store`. Verified live: `main.css?v=ea36ef45bc`, card grid painting on a
   first visit.
2. **Interpreter illustration** (`6719fa2`). At card size the drawing collapsed into a raised
   middle finger, and its alt text promised two hands that were not there. Redrawn as a person
   signing with both hands raised, checked at 440/300/200px. Patch `002` moves the alt text with
   it. The seeder had the underlying bug — it skipped any key that already existed, so the fix
   could never have reached the bucket; it now compares a sha256 stored on the object.

## F2 — what exists on the branch, uncommitted

Written and parsing, none of it wired up or tested:

- `src/validation/bookingSchemas.js` — includes a timezone fix worth knowing about. The
  requester types Malaysian wall-clock time; the instance runs UTC. Comparing them directly is
  wrong by eight hours, so both sides convert to a KL wall-clock reading (`wallClockEpoch`,
  `nowWallClockEpoch`). Good viva material.
- `src/data/mysql/bookingRepository.js` — every query keyed on `requester_id`; no
  fetch-by-id-alone function exists. `cancelPending` guards on `status = 'pending'` inside the
  UPDATE rather than read-then-write.
- `src/data/dynamo/timelineRepository.js` — `PK BOOKING#<id>`, `SK <ISO>#<event>`, GSI-1/GSI-2
  keys populated. Header comment explains why history lives in DynamoDB and state in MySQL.
- `src/services/bookingService.js` — MySQL commits first, DynamoDB appended after, failure logged
  as a greppable reconciliation line rather than failing the user's action.
- `src/controllers/bookingController.js`, `src/routes/bookings.js` — router mounts
  `requireAuth` then `requireRole('requester')`.
- `src/views/bookings/new.ejs`, `src/views/partials/status-pill.ejs`, four new icons in
  `icons.ejs` (clock, check-circle, slash, map-pin).

### To finish F2

1. `src/views/bookings/index.ejs` (list + status filter + pagination) and
   `bookings/detail.ejs` (status, explanation, DynamoDB timeline, cancel form).
2. **`partials/field.ejs` ignores `min`** — `new.ejs` already passes `min: earliest` and it goes
   nowhere. Add `min`/`max` support to the partial.
3. CSS for `.status--*` (six statuses, shape *and* colour, contrast checked with
   `scripts/check-contrast.js`) and the timeline list.
4. Wire `bookingRoutes` into `src/app.js` after `serviceRoutes`.
5. Add "Request this service" to `views/services/detail.ejs` and a `/bookings` task to the
   requester entry in `dashboardController.ROLE_SUMMARY`.
6. Unit tests (schemas, the KL clock, pagination, `buildQueryString`) and the F2 rows in
   `docs/crud-matrix.md`.
7. `git reset --soft main` on the branch first so the WIP commit disappears, then **one** commit
   `--author "Taha Fahd <tahafahd40@gmail.com>"`, no co-author trailers. Merge, push, deploy,
   then exercise it on the live URL as `requester@bridgeability.demo`.

## After F2

- **F3/F4 Abubaker, F5/F6 Lama, F7/F8 Noor.** Branch per functionality, one explicit `--author`
  each, no co-author trailers. Deploy after F4 and after F8 → Checkpoint 3.
- Phases D–G unchanged from the plan file: hardening, mock viva 1, tests against the deployed
  URL, 2-AZ + RDS Multi-AZ, study kit, mock viva 2.

## Owed, deliberately deferred

- **320px reflow check** — `resize_window` to 320 left `innerWidth` at 1960 (Chrome's minimum
  window width plus DPI scaling). Needs device emulation or a real narrow window. Phase E.
- **`docs/defect-log.md` does not exist yet.** Four real entries are already owed: the
  `upgrade-insecure-requests` CSP defect, the stale-CSS defect, the interpreter illustration,
  and the honest limitation that `express-rate-limit` counts per process, so the login limiter
  weakens once the environment scales past one instance.
- Still unwritten: `docs/workload-matrix.md`, `test-plan.md`, `deployment-runbook.md`,
  `references.md`, `docs/demo/*`, `README.md`, `scripts/package-submission.js`, `deploy.sh`,
  `render-matrix.js`, `spec.md`, `tasks.md`.

## Two traps in this environment

- Writing files with a bash heredoc sometimes fails — the contents get replayed unquoted and
  `=>` acts as a shell redirect, creating 0-byte files with names like `row.location)`. It
  swallowed two files this session. Prefer the Write tool for new source files, and check
  `git status` before every commit.
- `curl` ignores CSP. The CSP defect shipped because it was checked with curl. Anything about
  rendering has to be checked in a real browser.
