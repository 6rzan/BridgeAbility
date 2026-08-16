# Session handoff — 2026-08-17

Working note, not a deliverable. Delete before packaging the submission.

## Where things stand

| | |
|---|---|
| Live URL | `http://bridgeability-env.eba-ucukykqf.us-east-1.elasticbeanstalk.com` |
| `main` | pushed and deployed (`app-dc0a`). Env **Ready/Green**, `/health` reports RDS, DynamoDB and S3 all `ok` |
| Working tree | clean |
| Unit tests | 127 passing (`npm test`) |
| Phase | C — functionalities. F-auth, F1, F2 verified live; **F3 deployed, partly verified**; F4–F8 not started |

## Read this first — what F3 still owes

F3 is deployed and its unauthenticated and cross-origin behaviour is verified. **The
provider-authenticated walkthrough has not been done.** The assistant cannot type a password
into a login field, so it stops at the sign-in page every time; a human has to sign in as
`provider@bridgeability.demo` (`tp078003`) and then hand the browser back.

Owed, in this order, all as that provider:

1. **Create** a listing — check it saves, redirects to the edit page, and the flash reads
   "Listing published" (the org is approved).
2. **Upload an image** to it. *This is the one that matters.* The CORS preflight is proven at
   the protocol level (below) but no file has ever actually been PUT by a browser. Watch for:
   the upload form revealing itself, the status text going "Uploading…" → "Uploaded. Saving…",
   the image appearing on the edit page afterwards, and the object existing under
   `services/provider-1/service-<id>/<uuid>.jpg` in the bucket.
3. **Edit** it — change the price, confirm it persists.
4. **Withdraw** it, confirm it disappears from `/services`, **publish** it again, confirm it
   returns.
5. **Delete** the listing created in step 1 (it has no bookings, so the button is offered).
6. **Try to delete a booked listing** — service 1 has bookings, so no delete button should be
   rendered for it at all. Posting to `/provider/services/1/delete` by hand should redirect
   with the "cannot be deleted" flash rather than cascading away booking history.
7. **Ownership probe:** as this provider, open `/provider/services/11/edit` (service 11 belongs
   to provider 5, the rejected one). It must answer **404, not 403**.

### Verified live already, so do not re-litigate these

| Check | Result |
|---|---|
| `GET /provider/services`, `/new`, `/:id/edit` signed out | 302 → `/login` |
| `POST /provider/services` with no CSRF token | 403 |
| `GET /provider/services` signed in **as a requester** | 403, "Your account does not have access to that page" |
| S3 preflight: our origin + `PUT` + `content-type` | **200**, correct `Access-Control-Allow-*` headers |
| S3 preflight from `https://evil.example` | 403 — the rule is our origin, not `*` |
| S3 preflight for `DELETE` | 403 — only `PUT` is allowed |
| Anonymous `GET` of a private object | 403 — Block Public Access holds |
| `/js/listing-image.js` on the deployed URL | 200, `application/javascript`, fingerprinted |

The four S3 rows together are a good viva answer to "how do you know the bucket is not public":
the same object is reachable by a presigned URL and refused without one, and the CORS rule
that lets our own page upload refuses every other origin and every other method.

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

## Shipped this session — F3

**F3 — a provider creates and manages service listings** (`0778eb7`, author Abubaker;
CORS policy `92cf5f2`). Full vertical slice, 36 new unit tests, 127 passing overall. Every
EJS view was rendered against a real model in every state (approved/pending/rejected
provider, empty list, create form, edit form, error states) so template locals are known good.
Deployed and serving; see above for what is verified and what is still owed.

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

### What is most likely to be wrong when a provider first drives it

**`SELECT ... FOR SHARE` and `FOR UPDATE`.** `deleteUnbookedService`, `setImage` and
`clearImage` use MySQL 8 locking reads inside `withTransaction`. They are correct syntax for
8.0.43 but have **never executed against the real instance** — no authenticated request has
reached them. If one is going to fail, it fails the first time a provider deletes a listing or
attaches an image, and it fails as a 500 rather than a validation message.

**The upload's happy path.** CORS is proven, but the whole chain — presign → browser PUT →
confirm → row update → presigned GET on the way back — has only ever run in unit tests against
pure functions. Step 2 of the checklist above is what closes this.

Applied and confirmed this session: `S3_BUCKET=bridgeability-media-tp078281 bash
scripts/apply-s3-cors.sh`. It is idempotent, so re-running it after any environment rebuild is
safe and is the right reflex.

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
- **The lab expires without warning, and the symptom is misleading.** It happened mid-session
  on 2026-08-17. `eb deploy` reported `NotFoundError - Environment "bridgeability-env" not
  Found` and `describe-environments` returned `[]` — both of which read as "the environment was
  reaped" when in fact nothing had been touched. The real tell is any AWS call answering
  `AccessDenied ... explicit deny in an identity-based policy: .../voc-cancel-cred`, which is
  what AWS Academy attaches when a session stops. **Do not rebuild anything on that evidence.**
  Restart the lab from the AWS Academy console, refresh the credentials, and everything is
  exactly where it was — the environment, the RDS instance and the bucket all survived intact
  and the deploy then succeeded. Commit and push *before* deploying, so an expiry costs a
  deploy rather than the work.
- **The redirect trap is real and it fired again.** Two more 0-byte files (`buildQueryString(status`
  and `{console.error('RENDER`) were created by `=>` inside a `node -e` argument acting as a
  shell redirect. Both were cleaned up. It then fired a **third** time, from `->` inside a
  `curl -w "GET %{url_effective} -> %{http_code}"` format string, creating a file literally
  named `%{http_code}` — which `git add -A` duly staged. Check `git status` before every
  `git add -A`, and quote or avoid `->` and `=>` anywhere in a shell argument.
- **`secret-scan.sh` earns its keep — let it.** It caught the real AWS account id inside an IAM
  ARN pasted into this very file while documenting the expiry above. Pasting AWS error output
  into docs is the likeliest way the account id ever gets committed. Write it as
  `<account-id>`, and always run the scan *after* `git add`.
- **`git shortlog -sne` hangs** in this shell (pager). Use `git log --format='%an'` and count,
  or pass `--no-pager`, if you need the attribution table.
