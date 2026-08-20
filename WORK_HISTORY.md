# NATHEE GROUP 2025 — Work History

## 2026-08-21 — First Owner-supplied public Gallery release

- Added two real company-work photographs to the versioned public Gallery manifest: motorcycle truck loading and storage-yard operations.
- Added separate mobile-friendly thumbnails, factual captions, descriptive alt text, category filtering and featured ordering without inventing location, dates, customers or statistics.
- Verification: public files 25, published Gallery items 2, SEO/mobile-performance guards PASS, full tests 88/88, production build PASS and lint PASS.
- Deployment: source prepared locally; Production remains unchanged until the guarded Z.com deployment and postcheck pass.
- Rollback: restore the preceding public-site backup or revert this Gallery commit; the managed R2 Gallery and D1 are unaffected.

## 2026-08-21 — Inspection, Damage, POD and Print Center

- Implementation commit: `8ad52be`
- Added additive migration `0011_inspection_damage_pod` with append-only inspections/findings, version-preserving POD, same-motorcycle evidence checks and no-hard-delete triggers.
- Database guards require a passed receipt inspection before `INSPECTED` and an active DELIVERY-evidence POD before `DELIVERED`.
- Added responsive inspection, damage finding, POD correction/history and authorized print/PDF UI on motorcycle detail.
- Verification: full tests 88/88, production build PASS, lint PASS, public SEO/deployment guards PASS, scoped secret scan found no embedded credential value.
- Deployment: source prepared locally; migration `0011` was not applied and Production remained unchanged.
- Rollback: before Production apply, revert `8ad52be`. After apply, restore the pre-migration D1 backup or use a reviewed forward migration; never delete inspection/POD history.

## 2026-08-21 — Audited Container Load Manifest

- Implementation commit: `dad8d22`
- Added additive migration `0010_container_motorcycle_loads` with trip/container exclusivity, tenant/capacity/Seal/motorcycle-state invariants and append-only assignment history.
- Activated the full audited container lifecycle and added a bounded responsive Load Manifest plus motorcycle active-container context.
- Cancellation/completion release assignments atomically without deleting history; Container and event records are immutable at their evidence boundaries.
- Verification: full tests 79/79 at the milestone, production build PASS, lint PASS and public SEO/deployment guards PASS.
- Deployment: source prepared locally; migration `0010` was not applied and Production remained unchanged.
- Rollback: before Production apply, revert `dad8d22`. After apply, restore the pre-migration D1 backup or use a reviewed forward migration.

## 2026-08-21 — Fail-closed Container Registry Foundation

- Implementation commit: `7bd4bad`
- Added additive migration `0009_container_registry` for shipping containers and append-only status events.
- ISO 6346 container numbers are normalized and check-digit validated in the server path; database constraints preserve format, type, capacity, port/country bounds and unique identity.
- Create is idempotent and atomically writes DRAFT, initial event and redacted Audit.
- Database triggers reject identity rewrite, hard delete and all non-DRAFT lifecycle transitions until the vehicle-load assignment milestone provides readiness invariants.
- Added internal-only responsive registry UI with bounded 50-record keyset pages and no fake manifest/status controls.
- Verification: full tests 71/71, build PASS, lint PASS, public SEO/deployment guards PASS, scoped secret scan found no embedded credential value.
- Deployment: source pushed to `main`; migration `0009` was not applied and Production remained unchanged.

## 2026-08-21 — Load Board Operational Context and Discovery

- Commits: `bc90bb3`, `bc3e1f1`
- Added internal-only active-trip context to motorcycle detail so operators can reconcile the motorcycle timeline with the separate trip assignment ledger.
- Added validated, bounded prefix search for eligible motorcycles, fleet code/registration and indexed trip-status filters.
- Replaced a demonstrated SQLite OR-index scan with separate field-specific range queries and bounded de-duplicated server merge.
- Query-plan tests prove the truck code, truck registration, Job number, motorcycle Public ID, motorcycle registration and active-assignment indexes are selected.
- Verification: full tests 68/68, build PASS, lint PASS, public SEO/deployment guards PASS.
- Deployment: source pushed to `main`; no Production runtime, database or public website was changed.

## 2026-08-21 — Audited Trip–Motorcycle Load Board

- Implementation commit: `8dd8e8a`
- Added additive migration `0008_trip_motorcycle_loads` with an append-only assignment ledger, active-motorcycle uniqueness, capacity/tenant/state triggers and guarded trip-readiness transitions.
- Assignment and load/unload mutations are idempotent or optimistic and write Audit in the same D1 batch; cancellation/completion release records without deleting history.
- The system deliberately does not change motorcycle status from a trip mutation, preserving the existing status event and notification chain.
- Added responsive `/app/trips/:id` Load Board with real eligible motorcycles, capacity visibility, readiness explanations and bounded keyset pagination.
- Verification: full tests 65/65, production build PASS, lint PASS, public/SEO/deployment guards PASS, scoped secret scan found no embedded credential value.
- Deployment: source pushed to `main`; migration `0008` was not applied and Production remained unchanged.
- Rollback: before Production apply, revert the implementation commit. After apply, restore the pre-migration D1 backup or use a reviewed forward migration; do not hard-delete assignment history.

## 2026-08-21 — Truck and Trip Foundation

- Implementation commit: `5b392dc`
- Added trucks, trips and append-only trip status events in additive migration `0007`.
- Added idempotent create APIs, active DRIVER/truck validation, Bangkok-to-UTC planning and optimistic status transitions with Audit.
- Added DB triggers for resource validity, unique business identities and planning/actual time-order constraints.
- Added customer-blocked internal operations UI with truck/driver selectors, transition actions and 50-record keyset pagination.
- Verification: full tests 59/59, build PASS, lint PASS, public/SEO guards PASS, scoped secret scan PASS.
- Deployment: source pushed to `main`; migration `0007` was not applied and Production remained unchanged.
- Known next dependency: trips do not yet carry motorcycle assignments; capacity/load reconciliation is the next slice.

## 2026-08-21 — Recipient-scoped In-app Notifications

- Implementation commit: `bc10879`
- Added additive `notifications` schema with source-event foreign key, per-recipient idempotency and unread/chronological indexes.
- Status changes now create notifications in the same atomic batch for authorized active recipients only.
- Added bounded inbox, unread navigation count and recipient-scoped mark-read/open flow.
- Added private application `noindex` metadata and fail-closed local-link normalization.
- Tests prove cross-company exclusion, inactive/unauthorized exclusion, duplicate suppression, recipient-only reads and index selection.
- Verification: full tests 54/54, build PASS, lint PASS, public/SEO guards PASS.
- Deployment: source pushed to `main`; migration `0006` was not applied and Production remained unchanged.
- Browser acceptance remains gated by the unapplied migrations and missing Production Auth environment; no fake browser PASS was claimed.

## 2026-08-21 — Audited Member Lifecycle

- Implementation commit: `cdfc445`
- Added OWNER-only role, customer company, explicit permission and ACTIVE/INACTIVE management.
- Added revision/request claims so concurrent writes fail stale instead of overwriting access state.
- Added database triggers preventing deactivation, demotion or role-assignment deletion of the final active OWNER.
- Added mandatory reason and before/after Audit Log for every effective access change.
- Bounded member rendering to 50 users per keyset page and scoped permission queries to visible users.
- Migration: additive `0005_member_lifecycle_safety`; not applied to Production.
- Verification: full tests 49/49, build PASS, lint PASS, public/SEO guards PASS and secret-pattern scan found no embedded credential value.
- Deployment: source pushed to `main`; Production and protected Sites runtime unchanged.
- Rollback: revert `cdfc445` before applying migration `0005`; after applying, use a reviewed forward migration and retain the last-owner triggers until an equivalent invariant replaces them.

## 2026-08-21 — Role and Permission Foundation

- Implementation commit: `7b618cc`
- Added ten canonical roles with server-side, explicit-permission enforcement.
- Added company-scoped CUSTOMER_ADMIN/CUSTOMER_VIEWER authorization.
- Added backward-compatible legacy-role fallback to prevent account lockout.
- Added additive migration `0004_role_system_foundation` with backfill and consistency triggers.
- Updated invitation UI/API, navigation, customer filtering, Audit permission and role labels.
- Verification: full tests 43/43, build PASS, lint PASS, migration packaging PASS.
- Deployment: source pushed to `main`; Production and protected Sites runtime unchanged.
- Rollback: revert the implementation commit before applying migration `0004`; after migration is applied, use a reviewed forward migration rather than deleting role assignments.

## 2026-08-21 — Deployment Evidence Boundary

- Commits: `918d19a`, `5531922`
- Z.com scripts now disclose that deployment covers only `public-site/`.
- Added runtime capability probe and component audit.
- Recorded protected Sites Version 4 as an unaccepted owner-only artifact with no Supabase environment and incomplete D1 migrations.
- Production remained unchanged.

## 2026-08-20 — Public Website

- Commits through `81ef060` established 11 public routes, canonical domain, SEO gates, public Gallery manifest and portable Z.com deployment safeguards.
- Live evidence: canonical root and public Gallery return 200; `/app` and `/api/health` return 404.
- The public website is available, but it is not evidence of the protected logistics application.
