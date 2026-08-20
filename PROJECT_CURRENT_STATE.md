# NATHEE GROUP 2025 — Canonical Project State

Updated: 2026-08-21 (Asia/Bangkok)

## Source checkpoint

- Branch: `main`
- Latest verified implementation milestone: Revisioned global Site Settings plus full textual public-page CMS coverage (resolve the final commit with `git rev-parse HEAD`)
- Canonical repository: `ktbox1989/NATHEE-GROUP-2025`
- Working rule: resolve the current checkpoint-document commit with `git rev-parse HEAD`; never infer Production deployment from source HEAD.

## Production evidence

- Public static website: LIVE at `https://natheegroup2025.com/`
- Z.com root: `/home/zptqqwps/public_html/natheegroup2025.com`
- Public routes: 11, with mandatory SEO/noindex/mobile gates
- Public Gallery Production: LIVE manifest v1 with the two Owner-supplied real photographs, responsive thumbnails, captions and Alt text
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

### Audited Member Lifecycle (`cdfc445`)

- OWNER can change another member's canonical role, customer company, explicit permissions and ACTIVE/INACTIVE state without hard deletion.
- The current OWNER cannot demote or deactivate their own identity; database triggers independently preserve at least one active OWNER.
- D1 mutations use a revision/request claim, atomic batch, stale-write rejection and an Audit Log reason.
- Member rendering is bounded to 50 records per keyset page; permissions are queried only for visible users.
- Migration `0005_member_lifecycle_safety` is additive and remains unapplied in Production.

### Recipient-scoped In-app Notifications (`bc10879`)

- Motorcycle status events atomically create real notifications for active same-company customers, other OWNER identities and internal users explicitly granted `status:read`.
- The event actor, inactive users, unauthorized staff and customers from other companies are excluded.
- Recipient queries and read mutations always require the authenticated `recipient_user_id`; notification links are normalized local `/app/` paths.
- Unique event/recipient idempotency keys prevent duplicate notifications; unread lookup and inbox rendering are indexed and bounded to 50 records per keyset page.
- Private application metadata is `noindex`; LINE/Email delivery is intentionally not enabled without provider credentials and policy.
- Migration `0006_in_app_notifications` is additive and remains unapplied in Production.

### Truck and Trip Foundation (`5b392dc`)

- Added real truck records for verified 4-wheel/6-wheel/other classification, optional confirmed capacity, registration uniqueness and non-destructive status.
- Added trip records with transaction-safe TRIP numbering, optional active DRIVER assignment, Bangkok-to-UTC planning times and a guarded DRAFT→PLANNED→LOADING→IN_TRANSIT→ARRIVED→COMPLETED lifecycle.
- Create operations use unique request keys to prevent double-submit duplication; status updates use optimistic state, append-only trip events and Audit Log in one D1 batch.
- Database triggers independently reject inactive trucks and users without the active DRIVER role.
- Internal UI is customer-blocked, responsive and bounded to 50 trips per keyset page; the fleet selector/list is capped at 200 pending a dedicated fleet search contract.
- Migration `0007_truck_trip_foundation` is additive and remains unapplied in Production.

### Audited Trip–Motorcycle Load Board (`8dd8e8a`)

- Added an additive trip/motorcycle assignment ledger with request-key idempotency, one active trip per motorcycle, company matching, truck-capacity enforcement and a hard ceiling of 1,000 assignments when confirmed capacity is absent.
- Assignment state is coordinated with the existing audited motorcycle workflow: a trip never changes motorcycle status implicitly, so existing status events, notifications and audit evidence remain authoritative.
- Database triggers independently require DRAFT/PLANNED + SCHEDULED for assignment, LOADING + LOADED for load confirmation, ARRIVED + ARRIVED/DELIVERED/CLOSED for unload confirmation, and complete delivery readiness before trip completion.
- Cancellation/completion preserves assignment history by releasing records in the same D1 batch as trip event and Audit writes; assignment hard delete is rejected.
- Added a responsive real-data Load Board with readiness explanations, bounded 50-record keyset pages, 100-item eligible selector and no fake load counts.
- Motorcycle detail now exposes its active trip/assignment context to authorized internal users, while customer views remain isolated from internal trip operations.
- Fleet and eligible-motorcycle search uses validated prefix terms, separate field-specific index queries and bounded server-side merging; query-plan tests reject the former OR-scan behavior.
- Trip lists can be filtered by indexed lifecycle status without losing keyset bounds.
- Migration `0008_trip_motorcycle_loads` upgrades an existing `0007` database without rewriting prior trips and remains unapplied in Production.

### Fail-closed Container Registry Foundation (`7bd4bad`)

- Added shipping-container records with ISO 6346 owner/category format and check-digit validation, unique opaque public identity, Seal, 20FT/40FT/40HC type, optional confirmed motorcycle capacity, port and destination country.
- Create is request-key idempotent and commits the DRAFT record, initial status event and redacted Audit entry in one D1 batch.
- Container identity/history cannot be hard-deleted or rewritten. Lifecycle advancement is deliberately blocked at the database until the next vehicle-assignment migration can enforce load, capacity, Seal and motorcycle-state readiness.
- Added internal-only, responsive `/app/containers` registry with a 50-record keyset page and explicit warning that it is not yet a Container Load Manifest.
- Migration `0009_container_registry` is additive and remains unapplied in Production.

### Audited Container Load Manifest (`dad8d22`)

- Migration `0010_container_motorcycle_loads` adds an append-only container/motorcycle assignment ledger and activates the guarded DRAFT→PLANNED→LOADING→SEALED→IN_TRANSIT→ARRIVED→UNLOADING→COMPLETED lifecycle.
- A motorcycle cannot be active in both a trip and a container. D1 independently enforces tenant matching, one active assignment, confirmed capacity (or the existing 1,000-record hard ceiling), motorcycle status, Seal readiness and terminal release rules.
- Container, assignment and status mutations are optimistic/idempotent where applicable and commit Audit in the same D1 batch. Cancellation/completion retain assignment history; Container and event history cannot be hard-deleted.
- Added a responsive, bounded `/app/containers/:id` Load Manifest and active-container context on motorcycle detail. No status is advanced implicitly.
- Migration `0010` remains unapplied in Production.

### Inspection, Damage, POD and Print Center (`8ad52be`)

- Migration `0011_inspection_damage_pod` adds append-only motorcycle inspections, normalized damage findings and version-preserving Proof of Delivery records linked to private R2 image metadata.
- Inspection type is checked against the real motorcycle lifecycle. ISSUE/DAMAGE requires notes; optional findings accept only same-motorcycle `DAMAGE` evidence.
- A motorcycle cannot advance to `INSPECTED` without a passed receipt inspection, or to `DELIVERED` without an active POD backed by same-motorcycle `DELIVERY` evidence.
- POD is immutable after delivery. Before delivery, an incorrect active POD can be voided with a reason and replaced without deleting history. Phone output is masked and Audit records exclude the phone value.
- Motorcycle detail now provides real inspection/finding/POD forms and bounded history. `/app/motorcycles/:id/documents` renders an authorized print/PDF record from the same source data.
- Migration `0011` remains unapplied in Production.

### Owner-supplied public Gallery photographs and brand assets

- Added nine real company-work photographs supplied and approved by the Owner, covering motorcycle truck loading, storage yards, large-batch staging, 4-wheel and 6-wheel transport and Container loading.
- Each photograph has separate responsive JPEG/WebP display and thumbnail variants, factual Thai captions, descriptive alt text, a real Gallery category and deterministic featured ordering.
- Added the Owner-supplied NATHEE GROUP 2025 artwork to the site brand, homepage hero and social metadata. Added the exact Owner-supplied LINE QR to Contact without inventing a LINE ID or external URL; release checks lock its SHA-256.
- The homepage Gallery preview and `/gallery/` consume the same versioned manifest. No location, date, customer identity or unverified performance claim was inferred.
- Production remains on the preceding public-site release until the guarded Z.com pull, backup, deploy and live postcheck pass.

### Full textual Site Content CMS and Gallery batch workflow

- Added an authenticated CMS for all ten textual public pages: Home, Services, motorcycle transport, international transport, storage, Container loading, Dealer/Fleet, Quotation, About and Contact. Every page uses an allowlisted identity and structured sections rather than raw HTML.
- Added fail-safe dynamic rendering and canonical INDEX metadata for the six newly managed public routes. Their factual defaults use only verified services and contact numbers; no price, capacity, service area, performance or timeline claim is invented.
- Added immutable content revisions with SHA-256 hashes, append-only publication events, same-page publication enforcement, Audit records and forward-only rollback by republishing an older revision.
- Added explicit `site:read`, `site:write` and `site:publish` permissions. OWNER retains business-wide rights; every other internal role remains fail-closed and CUSTOMER roles receive no CMS access.
- Added a bounded Gallery batch uploader for up to 20 real images per batch. Images are processed and uploaded sequentially, require title/Alt text, remain Draft until separately published and preserve completed Drafts when a later image fails.
- Public CMS Gallery sections query only `PUBLIC` + `PUBLISHED` items, remain bounded to 24 images per section and fail safely to an honest empty state when Gallery storage is unavailable.
- Kept Gallery media management separate from text editing so categories, Alt text, featured selection, ordering, visibility, responsive variants and audit history remain intact. The Site Content dashboard links directly to Media Library.
- Migration `0012` adds Site Content pages/revisions/publication history and the new permissions. It remains unapplied in Production.

### Revisioned global Site Settings

- Added `/app/site-settings` so an authorized operator can manage the shared brand name, legal name, abbreviation, tagline, optional public Gallery logo, verified telephone numbers, public navigation, Login label and Footer from one source.
- Settings use immutable SHA-256 revisions and append-only publication events. Save and publish are same-origin, permission-gated, request-idempotent and write redacted Audit records in the same D1 batch.
- Navigation is bounded to eight unique public paths, must include Home and rejects external, protocol-relative, `/api`, `/app` and `/auth` destinations. The admin UI offers only real public routes and includes a responsive Header/Footer preview.
- Public pages fail safely to verified source defaults when D1 is absent, a revision is malformed or the selected logo is no longer `PUBLIC` + `PUBLISHED`. Structured Organization data and Open Graph site identity use the same published settings.
- Migration `0013_wakeful_moon_knight` adds append-only global setting revisions/publication history. It remains unapplied in Production.

## Verified source gates

- Full test suite: 106 passing
- Authorization/unit/CMS/settings parser tests: 59 passing
- Render/schema/notification/yard/trip/container/inspection/POD/CMS/settings/query-plan tests: 47 passing
- Production Vinext build: PASS
- ESLint: PASS
- Public SEO and deployment architecture guards: PASS
- Migrations through `0013` packaged in `dist/.openai/drizzle/`: PASS

## Open Owner gates

- Approve application routing model: apex edge routes or an application subdomain.
- Supply/configure Supabase Production values through a secure hosting channel.
- Backup and apply migrations `0001`–`0013` to the protected D1 runtime.
- Verify private R2 readiness.
- Bootstrap the real OWNER identity and accept two-company customer isolation.
- Deploy the two approved Gallery photographs and add verified location/map data when supplied.

## Next autonomous work

1. Stop adding broad local modules and close the Production activation gates: canonical app route, Supabase environment/callback, D1 backup+ledger+migrations `0001`–`0013`, R2 readiness and real OWNER mapping.
2. Run real browser acceptance for OWNER and two isolated customer companies before exposing `/app` publicly.
3. Add bounded Company Search and indexed Driver Search before large customer/staff rollout; current selectors remain deliberately capped.
4. Configure external LINE/email notification providers only after credentials, consent, retry and escalation policy are approved.
5. Keep all new migrations unapplied until the Production backup/runtime gates are satisfied.

## Prohibited claims

- Do not report the full application as Production-deployed.
- Do not report Auth, D1, R2, QR, Gallery Manager or notifications as Production-ready without live acceptance evidence.
- Do not apply Production migrations, DNS, credentials or deployment changes without the corresponding Owner gate.
