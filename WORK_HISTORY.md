# NATHEE GROUP 2025 — Work History

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
