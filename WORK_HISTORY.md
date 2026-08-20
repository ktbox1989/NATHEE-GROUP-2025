# NATHEE GROUP 2025 — Work History

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
