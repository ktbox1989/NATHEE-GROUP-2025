# NATHEE GROUP 2025 — Canonical Project State

Updated: 2026-08-21 (Asia/Bangkok)

## Source checkpoint

- Branch: `main`
- Latest verified implementation milestone: `7b618cc` — Production Role and Permission Foundation
- Canonical repository: `ktbox1989/NATHEE-GROUP-2025`
- Working rule: resolve the current checkpoint-document commit with `git rev-parse HEAD`; never infer Production deployment from source HEAD.

## Production evidence

- Public static website: LIVE at `https://natheegroup2025.com/`
- Z.com root: `/home/zptqqwps/public_html/natheegroup2025.com`
- Public routes: 11, with mandatory SEO/noindex/mobile gates
- Public Gallery: LIVE manifest v1, 10 categories, 0 published real images
- Canonical `/login/`: static noindex status page, not real Auth
- Canonical `/app`: 404
- Canonical `/api/health`: 404
- Protected Sites artifact: Version 4, source `9afd58d`, owner-only access
- Protected Sites environment variables: none configured
- Protected Sites D1: only the ten base tables from migration `0000`
- Full application Production acceptance: NOT PASSED

## Closed local milestones

### Public website and deployment safety

- Multi-page public site, canonical domain guard, SEO, Gallery manifest, Z.com backup/deploy/postcheck/rollback and production-scope disclosure are implemented.
- `DEPLOY_PASS` applies only to the public static component.

### Role and Permission Foundation (`7b618cc`)

- Canonical roles: OWNER, ADMIN, STAFF, SALE, WAREHOUSE, CHECKER, DRIVER, ACCOUNTING, CUSTOMER_ADMIN, CUSTOMER_VIEWER.
- OWNER has business capabilities; every other internal role is fail-closed and requires explicit permissions.
- Customer roles require a company and can read only records belonging to that company.
- Legacy CUSTOMER maps to least-privilege CUSTOMER_VIEWER; legacy OWNER/STAFF remain usable even before role backfill.
- Migration `0004_role_system_foundation` is additive: role-assignment table, legacy backfill, indexes and compatibility triggers.
- No Production migration was applied.

## Verified source gates

- Full test suite: 43 passing
- Authorization/unit tests: 28 passing
- Render/schema/yard tests: 15 passing
- Production Vinext build: PASS
- ESLint: PASS
- Public SEO and deployment architecture guards: PASS
- Migration `0004` packaged in `dist/.openai/drizzle/`: PASS

## Open Owner gates

- Approve application routing model: apex edge routes or an application subdomain.
- Supply/configure Supabase Production values through a secure hosting channel.
- Backup and apply migrations `0001`–`0004` to the protected D1 runtime.
- Verify private R2 readiness.
- Bootstrap the real OWNER identity and accept two-company customer isolation.
- Add real company Gallery photographs and verified location/map data.

## Next autonomous work

1. Complete member lifecycle: server-side role/permission update, deactivate/reactivate, audit and compensating Auth handling.
2. Add notification data model and in-app notification vertical slice without enabling external LINE/Email secrets.
3. Expand logistics schema in dependency order: Trip/Truck, Container, Inspection/Damage, POD, documents and print center.
4. Keep all new migrations local until Production backup/runtime gates are satisfied.

## Prohibited claims

- Do not report the full application as Production-deployed.
- Do not report Auth, D1, R2, QR, Gallery Manager or notifications as Production-ready without live acceptance evidence.
- Do not apply Production migrations, DNS, credentials or deployment changes without the corresponding Owner gate.
