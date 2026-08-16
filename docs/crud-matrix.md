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
| RDS | F-auth (users, providers) · *live* | F1 (services, providers) · *live* | planned — F4, F5, F7, F8 | planned — F3 |
| DDB | F-auth (sessions) · *live* | F-auth (sessions) · *live* | F-auth (session touch) · *live* | F-auth (sign-out) · *live* |
| S3 | F-media (placeholder illustrations) · *live* | F1 (presigned GET) · *live* | planned — F3 | planned — F3 |

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

## Planned

| | Owner | Verbs it will add |
|---|---|---|
| F2 | Taha Fahd Ahmed Mohammed | RDS create (`bookings`), DDB create (timeline event), RDS read (own bookings) |
| F3 | Abubaker Elsiddig Tageldeen | RDS create/update/delete (`services`), S3 create/delete (presigned PUT) |
| F4 | Abubaker Elsiddig Tageldeen | RDS update (`bookings.status`), DDB create (timeline event) |
| F5 | Aldhahyani Lama M. A. | RDS update (`providers.status`), S3 read (presigned GET of verification document) |
| F6 | Aldhahyani Lama M. A. | RDS read (aggregates), DDB read (GSI-1 query) |
| F7 | Noor Khalil Abdullah Khaled | RDS create (`assignments`), RDS update (`bookings.status`) |
| F8 | Noor Khalil Abdullah Khaled | RDS update (`assignments.completion_status`), DDB create (timeline event) |
