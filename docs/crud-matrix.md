# CRUD matrix

Which functionality exercises which operation, against which cloud data store, and the route
that does it. Every cell marked *live* is reachable through the user interface on the deployed
environment — none of them needs a script or a console to demonstrate.

This file grows one section per functionality as each is delivered. Rows that are not yet
built are listed as **planned** rather than left out, so the gap between what is claimed and
what exists is visible at a glance.

Data stores: **RDS** (Amazon RDS for MySQL 8) · **DDB** (Amazon DynamoDB) · **S3** (Amazon S3).

---

## Coverage summary

| Store | Create | Read | Update | Delete |
|---|---|---|---|---|
| RDS | F-auth (users, providers) · F2 (bookings) · F3 (services) · *live* | F1 (services, providers) · F2 (own bookings) · F3 (own listings) · F4 (incoming queue) · F5 (registration queue) · *live* | F2 (cancel) · F3 (edit, withdraw, publish) · F4 (accept/reject) · F5 (approve/reject) · *live* — F7, F8 planned | F3 (delete an unbooked listing) · *live* |
| DDB | F-auth (sessions) · F2 (timeline events) · F4 (accept/reject events) · *live* | F-auth (sessions) · F2 (booking history) · F4 (booking history) · *live* | F-auth (session touch) · *live* | F-auth (sign-out) · *live* |
| S3 | F-media (placeholder illustrations, verification documents) · F3 (presigned PUT) · *live* | F1 (presigned GET) · F3 (own listing images) · F5 (verification document) · *live* | F3 (replace an image) · *live* | F3 (remove an image, delete a listing) · *live* |

"F-auth" is the cross-cutting authentication slice, owned jointly. Every other row has one
named owner.

---

## F-auth — registration, sign-in, sign-out (cross-cutting, all four members)

| Verb | Store | What | Where |
|---|---|---|---|
| Create | RDS | `users` row; `providers` row in the same transaction when the role is provider | `POST /register` → `authService.register` |
| Create | DDB | Session item with a TTL | `POST /login` → `DynamoSessionStore.set` |
| Read | RDS | Credential lookup by email; account reload on the dashboard | `POST /login`, `GET /dashboard` |
| Read | DDB | Session lookup on every authenticated request, strongly consistent | `DynamoSessionStore.get` |
| Update | DDB | `expiresAt` refreshed on activity, without rewriting the item | `DynamoSessionStore.touch` |
| Delete | DDB | Session removed on sign-out | `POST /logout` → `DynamoSessionStore.destroy` |

---

## F1 — search and browse verified listings (Taha Fahd Ahmed Mohammed, TP078281)

| Verb | Store | What | Where |
|---|---|---|---|
| Read | RDS | Paged, filtered catalogue joining `services` to `providers` | `GET /services` → `serviceRepository.searchServices` |
| Read | RDS | Match count, for the result total and page links | `GET /services` → `serviceRepository.countServices` |
| Read | RDS | Distinct locations, to build the filter menu from real data | `GET /services` → `serviceRepository.listVisibleLocations` |
| Read | RDS | One listing, under the same visibility rule as the list | `GET /services/:id` → `serviceRepository.findVisibleServiceById` |
| Read | S3 | Short-lived presigned GET for each listing image | `catalogueService.attachImageUrls` → `presignGet` |

**Filters:** free text across title, description and provider name; category; location;
maximum price; four sort orders; pagination at six per page.

**The visibility rule.** A listing is returned only when `s.is_active = 1 AND p.status =
'approved'`. Both halves live in the SQL, in one constant shared by the list, the count and
the detail lookup, so no URL or page number can reach a hidden listing. The seed data proves
it: service 10 is inactive and service 11 belongs to a rejected provider, so the catalogue
shows **9 of 11** seeded services.

**Why this route has no role guard.** The catalogue is public on purpose — someone deciding
whether to register has to be able to see what is offered. Nothing here is not intended for
publication, and the access control that matters is the visibility rule above. Acting on a
listing is separate: submitting a booking (F2) is requester-only and carries its own
server-side check.

---

## F2 — submit a booking request and track its status (Taha Fahd Ahmed Mohammed, TP078281)

| Verb | Store | What | Where |
|---|---|---|---|
| Create | RDS | `bookings` row, inside a transaction with a re-check that the listing is still visible | `POST /bookings` → `bookingRepository.createBooking` |
| Create | DDB | `BOOKING_CREATED` timeline event | `POST /bookings` → `timelineRepository.appendEvent` |
| Read | RDS | One page of this requester's own bookings, filtered by status | `GET /bookings` → `bookingRepository.listForRequester` |
| Read | RDS | Match count, and the per-status counts the filter menu shows | `GET /bookings` → `countForRequester`, `countByStatusForRequester` |
| Read | RDS | One booking, joined to its service, provider and assignment | `GET /bookings/:id` → `bookingRepository.findForRequester` |
| Read | DDB | The whole history of one booking, one Query on `PK BOOKING#<id>` | `GET /bookings/:id` → `timelineRepository.listEvents` |
| Update | RDS | `bookings.status` → `cancelled`, guarded on the row still being pending | `POST /bookings/:id/cancel` → `bookingRepository.cancelPending` |
| Create | DDB | `BOOKING_CANCELLED` timeline event, written only when a row actually changed | `POST /bookings/:id/cancel` → `timelineRepository.appendEvent` |

**Authorization is in the WHERE clause.** There is no function in `bookingRepository` that
fetches a booking by id alone. Every read and write is keyed on the booking *and* the
requester who owns it, so changing `/bookings/4` to `/bookings/5` returns nothing from the
database and answers 404 — not 403, which would confirm that booking 5 exists and belongs to
someone else. The role guard on the router is the second line, not the only one.

**Why the history is in DynamoDB and the status is not.** A booking's current state must be
transactional, joined and constrained by foreign keys, which is MySQL's job. Its history is an
append-only stream, never updated, always read as "everything about one booking, in order",
written by four different roles, and unbounded in growth. That is a key-and-range access
pattern with no joins: partition key the booking, sort key the moment, so one Query returns
the ordered history at a cost that does not change as the table passes a million events.

**Ordering across the two stores.** MySQL commits first, always, because it holds the
authoritative status. DynamoDB is appended afterwards and outside that transaction; if the
append fails, the booking still exists and the failure is written to CloudWatch Logs as a
greppable reconciliation line rather than failing the user's action. There is no distributed
transaction across RDS and DynamoDB, and pretending otherwise would be the real mistake. The
opposite order can leave a timeline entry for a booking that was never created, which tells
the requester their request was sent when no provider will ever see it.

**Double submission.** `request_key` is a UUID generated once per rendering of the form and
carries a UNIQUE index. A double-click, a refresh on the POST, or a retry over a dropping
mobile connection all arrive with the same key, so the second insert raises `ER_DUP_ENTRY` and
the requester is shown the booking the first one made.

---

## F3 — create and manage service listings (Abubaker Elsiddig Tageldeen, TP078003)

| Verb | Store | What | Where |
|---|---|---|---|
| Create | RDS | `services` row against the signed-in user's own organisation | `POST /provider/services` → `providerServiceRepository.createService` |
| Read | RDS | Every listing this provider owns, published and withdrawn, each with its booking count | `GET /provider/services` → `providerServiceRepository.listForProvider` |
| Read | RDS | One listing, only if this provider owns it | `GET /provider/services/:id/edit` → `providerServiceRepository.findForProvider` |
| Update | RDS | Title, category, description, price, location and availability | `POST /provider/services/:id` → `providerServiceRepository.updateService` |
| Update | RDS | `services.is_active` — withdraw a listing from the catalogue, or publish it again | `POST /provider/services/:id/visibility` → `providerServiceRepository.setActive` |
| Delete | RDS | The `services` row, but only one with no bookings against it | `POST /provider/services/:id/delete` → `providerServiceRepository.deleteUnbookedService` |
| Create | S3 | Presigned PUT so the browser uploads the image directly | `POST /provider/services/:id/image/presign` → `presignPut` |
| Update | RDS | `image_s3_key` and `image_alt_text`, written together | `POST /provider/services/:id/image` → `providerServiceRepository.setImage` |
| Read | S3 | Presigned GET for the provider's own management pages | `providerListingService.attachImageUrl` → `presignGet` |
| Delete | S3 | The replaced object after an image is changed, and the object behind a removed image or a deleted listing | `providerListingService.deleteObjectSafely` → `deleteObject` |

**`provider_id` is never in a request.** It is resolved from `req.session.user.id` through
`providers.user_id` at the top of every handler, so there is no field in any form and no
segment in any URL that names an organisation. Every statement in
`providerServiceRepository` is then keyed on the service *and* that provider id — there is no
function in the file that reads or writes a service by `service_id` alone. Editing
`/provider/services/7/edit` to a listing owned by someone else returns nothing from the
database and answers 404, for the same reason F2 answers 404 rather than 403: "forbidden"
would confirm that listing 7 exists and belongs to a competitor.

**Why deletion is guarded rather than offered freely.** `bookings.service_id` is declared
`ON DELETE CASCADE`. Deleting a service that has bookings would therefore not fail — it would
silently delete other people's booking history along with it, and a requester tracking a
booking would find it simply gone. `deleteUnbookedService` counts bookings and deletes inside
one transaction, holding the service row with `SELECT ... FOR SHARE` so a booking arriving in
that instant waits behind it rather than being cascaded away. A listing that has been booked
is withdrawn instead: `is_active = 0` removes it from every public query immediately and
leaves the bookings intact. The button for the wrong one of the two is not rendered, so the
provider is never invited to try something the database will refuse.

**Why the image never passes through the application tier.** The browser asks for permission,
gets a presigned PUT, and sends the bytes straight to S3. A 5 MB photograph on a slow mobile
connection therefore does not occupy a Node process for the length of the upload, and there is
no multipart body to buffer or request size limit to raise. What makes that safe is that the
content type and the exact byte length are bound into the signature, so S3 itself rejects a
request that does not match what the server authorised — "the client could send anything" is
not true here. The key is derived from the provider and the listing (`services/provider-N/
service-M/<uuid>.<ext>`) and never accepted from the caller; the confirm step re-derives that
shape and rejects a key naming another provider's object, because presigning and confirming
are two separate requests and the second one must verify rather than remember.

**Alt text is required by the application, not by the column.** `services.image_alt_text` is
nullable because a listing legitimately has no image. What must never exist is an image
*without* a description — a relationship between two columns rather than a property of one —
so it is enforced at the only point where an image is attached, in `imageConfirmSchema`. A
platform for persons with disabilities that publishes an undescribed photograph refutes its
own premise.

**What needs JavaScript, and what does not.** Creating, editing, withdrawing, publishing,
deleting a listing and removing its image are all plain form posts that work with scripting
off. Uploading an image is the one interaction that genuinely requires it, because the file is
sent to S3 by the browser; the upload form is hidden until `listing-image.js` reveals it and a
`<noscript>` beside it says so, rather than presenting a control that quietly does nothing.

**A listing is not the same as a visible listing.** A provider may create and edit listings
while their organisation is still `pending`. The second half of F1's visibility rule
(`p.status = 'approved'`) keeps those out of the public catalogue until an administrator
approves them in F5, and both the listings page and the edit page say so rather than leaving
the provider to wonder why nobody can find them.

---

## F4 — provider accepts/rejects/updates booking requests (Abubaker Elsiddig Tageldeen, TP078003)

| Verb | Store | What | Where |
|---|---|---|---|
| Read | RDS | This provider's incoming queue, joined to the requester and filterable by status | `GET /provider/bookings` → `bookingRepository.findIncomingForProvider` |
| Read | RDS | Match count, and the per-status counts the filter menu shows | `GET /provider/bookings` → `countIncomingForProvider`, `countByStatusForProvider` |
| Read | RDS | One incoming request and its history, only if this provider owns the underlying service | `GET /provider/bookings/:id` → `bookingRepository.findForProvider` |
| Read | DDB | The whole history of one booking | `GET /provider/bookings/:id` → `timelineRepository.listEvents` |
| Update | RDS | `bookings.status` → `accepted`, guarded on the row still being `pending` and the service belonging to this provider | `POST /provider/bookings/:id/accept` → `bookingRepository.setProviderDecision` |
| Create | DDB | `BOOKING_ACCEPTED` timeline event, written only when a row actually changed | `POST /provider/bookings/:id/accept` → `timelineRepository.appendEvent` |
| Update | RDS | `bookings.status` → `rejected`, same guard | `POST /provider/bookings/:id/reject` → `bookingRepository.setProviderDecision` |
| Create | DDB | `BOOKING_REJECTED` timeline event, written only when a row actually changed | `POST /provider/bookings/:id/reject` → `timelineRepository.appendEvent` |

**What "update" means here.** `bookings` carries no field a provider is entitled to edit —
`requested_datetime` and `notes` are the requester's own input, and no route anywhere lets a
provider change them. The "update" in this functionality's name is the status transition
itself: `pending → accepted` or `pending → rejected`. There is no third action.

**Ownership.** `provider_id` is resolved from `req.session.user.id` through
`providerServiceRepository.findProviderByUserId` (F3), reused rather than re-implemented. Every
statement in `bookingRepository`'s provider-facing functions joins `bookings` to `services` and
filters on `s.provider_id`, so a booking against another organisation's listing is a 404, not a
403 — the same rule F2 and F3 already established.

**The guard is the UPDATE's own WHERE clause.** `setProviderDecision` runs a single multi-table
`UPDATE bookings b JOIN services s ... WHERE b.status = 'pending' AND s.provider_id = ?`, the
same shape as F2's `cancelPending`, not a `SELECT ... FOR UPDATE` transaction — there is no
second statement to keep atomic with the first. Two tabs both showing a pending request, or an
accept and a reject racing each other, resolve to whichever commits first; the loser's UPDATE
matches zero rows and the page tells them the request was already decided.

---

## F5 — admin reviews and approves/rejects provider registrations (Aldhahyani Lama M. A., TP078792)

| Verb | Store | What | Where |
|---|---|---|---|
| Read | RDS | Every provider registration, filterable by review status | `GET /admin/providers` → `adminProviderRepository.listByStatus` |
| Read | RDS | Match count, and the per-status counts the filter menu shows | `GET /admin/providers` → `countByStatus`, `countAllByStatus` |
| Read | RDS | One registration, with the reviewer's name and date once decided | `GET /admin/providers/:id` → `adminProviderRepository.findById` |
| Read | S3 | Short-lived presigned GET for the uploaded verification document | `GET /admin/providers/:id` → `adminProviderService.attachDocUrl` → `presignGet` |
| Update | RDS | `providers.status` → `approved`, `reviewed_by`, `reviewed_at`, guarded on the row still being `pending` | `POST /admin/providers/:id/approve` → `adminProviderRepository.decide` |
| Update | RDS | `providers.status` → `rejected`, same audit fields, same guard | `POST /admin/providers/:id/reject` → `adminProviderRepository.decide` |

**Why this is the second half of F1's visibility rule.** F1's catalogue shows a listing only
when `p.status = 'approved'` as well as `s.is_active = 1`. A provider can create and edit
listings the moment they register (F3), but nothing they publish is visible to a requester
until this decision is made here — F5 is the gate F1 and F3 both assume exists.

**Read-only access to the verification document, not a copy of it.** The document never leaves
S3; the administrator gets a presigned GET with the same short expiry every other presigned URL
in this application carries, minted only when this page is opened. The seeded document itself is
a small placeholder PDF, uploaded by `db/seed-media.js` to whichever key each provider row
actually carries — the fixture reads the key from the database rather than assuming a naming
pattern, so it still works against the one seeded row whose key differs from the others.

**The guard is the UPDATE's own WHERE clause.** `decide` is one statement —
`UPDATE providers SET status=?, reviewed_by=?, reviewed_at=NOW() WHERE provider_id=? AND
status='pending'` — the same shape as F2's `cancelPending` and F4's `setProviderDecision`. Two
administrators opening the same pending registration and clicking Approve and Reject a moment
apart resolve to whichever commits first; the loser's UPDATE matches zero rows and is told the
registration was already decided.

---

## Planned

| | Owner | Verbs it will add |
|---|---|---|
| F6 | Aldhahyani Lama M. A. | RDS read (aggregates), DDB read (GSI-1 query) |
| F7 | Noor Khalil Abdullah Khaled | RDS create (`assignments`), RDS update (`bookings.status`) |
| F8 | Noor Khalil Abdullah Khaled | RDS update (`assignments.completion_status`), DDB create (timeline event) |
