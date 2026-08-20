# NATHEE GROUP 2025 — Canonical Project State

Updated: 2026-08-21 (Asia/Bangkok)

## Source checkpoint

- Review branch: `codex/nathee-media-owner-2`
- Integration baseline: `3cfd65a176cba858c6fd5d76cab61df5c78093f8`
- Latest verified implementation milestone: Fail-closed Gallery batch uploads (`ab3c868681f2e14e9bb1a9f458c5df29de6d25e7`)
- Canonical repository: `ktbox1989/NATHEE-GROUP-2025`
- Working rule: resolve the current checkpoint-document commit with `git rev-parse HEAD`; never infer Production deployment from source HEAD.

## Production evidence

- Public static website: LIVE at `https://natheegroup2025.com/`
- Z.com root: `/home/zptqqwps/public_html/natheegroup2025.com`
- Public routes: 11, with mandatory SEO/noindex/mobile gates
- Public Gallery Production: LIVE manifest v1 with nine Owner-supplied real photographs, responsive thumbnails, captions and Alt text
- Canonical `/login/`: static noindex status page, not real Auth
- Canonical `/app`: 404
- Canonical `/api/health`: 404
- Protected Sites artifact: Version 4, source `9afd58d`, owner-only access
- Protected Sites environment variables: none configured
- Protected Sites D1: only the ten base tables from migration `0000`
- Full application Production acceptance: NOT PASSED

## Closed local milestones

### Fail-closed Gallery batch uploads (`ab3c868`)

- Repaired a real false-success defect: XHR previously followed an API validation redirect to an HTML page and treated the resulting HTTP 200 as a completed Draft. The uploader now accepts success only from a complete JSON contract containing `ok=true`, the canonical Gallery item ID and duplicate state.
- Each queued file receives one cryptographically secure request key that survives network-error retry. The API strictly validates that identity; duplicate and concurrent requests return the same canonical item instead of creating a second Draft.
- The server bounds aggregate request size, rejects non-multipart uploads and returns explicit JSON errors for the client contract while preserving redirect behavior for non-XHR forms. A failed D1/race path best-effort removes only its own new R2 objects and checks the unique request key before reporting failure.
- Added the same 80-million decoded-pixel safety ceiling used by private evidence processing, and centralized browser UUID generation with a secure `getRandomValues` fallback.
- Verification: full tests 168/168 (103 unit + 65 integration), TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, false-success/identity regressions PASS, scoped secret scan PASS and `git diff --check` PASS.
- No migration was added and Production remains unchanged. Real browser upload/R2 acceptance still requires the gated Auth/D1/R2 application runtime.

### Private signed Proof of Delivery (`7a5bf0d`)

- New POD creation captures the real recipient, time, location, same-motorcycle `DELIVERY` photograph and a recipient signature in one fail-closed flow. The browser shows upload progress/cancel/retry states and uses cryptographically secure UUID request identities without relying on `crypto.randomUUID` availability alone.
- Signature PNG bytes are checked server-side for MIME signature, actual IHDR dimensions, size and SHA-256 before being written to private R2. D1 commits POD, immutable signature metadata and a redacted Audit entry atomically; a failed or concurrency-losing write compensating-deletes only its newly created R2 object.
- Additive migration `0021_zippy_impossible_man` leaves every legacy POD unchanged with `signature_required=0`. It requires all new POD rows to declare signed evidence, prevents signed POD delivery until the matching signature row exists and makes signature metadata immutable/non-deletable.
- Authorized detail and print views show the private signature; legacy unsigned records are labelled honestly. A new record missing its signature is visibly invalid and cannot move the motorcycle to `DELIVERED`.
- Verification: full tests 166/166 (101 unit + 65 integration), TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, migration preservation/integrity/immutability/query-plan checks PASS, scoped secret scan PASS and `git diff --check` PASS.
- Production remains unchanged. Browser acceptance of real pen/touch input and private R2 retrieval requires the gated application runtime, Auth/Owner mapping and migration `0021`; no D1 row, R2 object, Z.com file or Production setting was changed.

### Private motorcycle evidence derivatives (`0f3f182`)

- New authorized motorcycle-image uploads retain the original private R2 object and also create bounded WebP Display (long edge 1,600px, at most 3 MB) and Thumbnail (long edge 640px, at most 1 MB) objects. AVIF is optional and content-negotiated only when the browser advertises support.
- The authenticated image endpoint remains company/permission scoped and `private, no-store`. Thumbnail grids no longer request originals; inspection/POD links request Display. Existing rows with no variants safely fall back to their unchanged original object and are not rewritten or deleted.
- Uploads use a cryptographically generated request key plus a database unique index. Concurrent/retried submissions resolve to one canonical image row; failed R2/D1 attempts compensating-delete only the objects they created and never report false success.
- Additive migration `0020_awesome_quentin_quire` creates variant metadata, adds the nullable request key for legacy compatibility and makes motorcycle evidence/variant rows immutable and non-deletable. Preservation, constraints, duplicate-key, foreign-key and EXPLAIN coverage pass.
- Verification: full tests 160/160 (96 unit + 64 integration), TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, scoped secret scan PASS and `git diff --check` PASS.
- Production remains unchanged. Migration `0020`, the full app runtime and Auth/Owner mapping remain Production gates; no D1 row or R2 object was changed.

### Truthful operational reports and Audit keyset pagination (`3232992`)

- Added `/app/reports` with current-state Job, Motorcycle, Trip, Container and Yard aggregates calculated from authorized D1 rows. Customer roles receive only their company Job/Motorcycle counts; missing statuses remain absent and no KPI, finance, SLA or Invoice values are invented.
- Reports are responsive and printable with a render timestamp. The UI states its operational-only boundary and keeps finance reporting blocked until authoritative tables and business policy exist.
- Replaced the Audit UI's fixed latest-200 read with descending `(created_at, id)` keyset pages of 50. Additive migration `0019_supreme_imperial_guard` adds the chronological index only; preservation and EXPLAIN tests prove existing Audit history remains and pagination is index-backed.
- Runtime readiness now requires the `0019` index and stays degraded if Production schema is behind.
- Verification: full tests 153/153 (90 unit + 63 integration), TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, scoped secret scan PASS and `git diff --check` PASS.
- Production remains unchanged. Migration `0019`, the full app runtime and Auth/Owner mapping remain Production gates.

### Bounded real-data Print Center (`28b8c6c`)

- Added internal-only `/app/print-center` for authorized staff to find real Job, Motorcycle, Yard, Truck, Trip and Container records and open their existing QR, Inspection/POD, Trip Load Board or Container Load Manifest print surfaces.
- Search rejects wildcard/control-character scans, requires a 2–80 character prefix and bounds results to 50 plus one truncation sentinel. Dedicated query-plan coverage proves all eight identifier paths use an index, including the partial VIN/engine indexes.
- Every destination repeats server authorization; QR actions remain write-permission-gated. Customer roles cannot enter the operational directory, and missing Invoice/finance-report source contracts are shown as unavailable rather than fabricated.
- Verification: full tests 150/150 (88 unit + 62 integration), TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, scoped secret scan PASS and `git diff --check` PASS.
- No migration was added and Production remains unchanged. The route requires the full application runtime, confirmed Auth mapping and D1 migrations through `0018`; it is not served by the current Z.com static deployment.

### Opaque operational QR identities and labels (`55de6ab`)

- Extended the existing motorcycle QR contract to Job, Yard, Truck and Trip using type-prefixed 128-bit opaque public identities; sequential database IDs and business numbers are never encoded in labels.
- Added authenticated same-origin SVG routes, permission-scoped printable labels and a single scanner that resolves all five entity types from real D1 records. Customers may resolve only their own company Job/Motorcycle; Yard, Truck and Trip remain internal-only and unauthorized records use the same not-found response.
- Migration `0018_unknown_blonde_phantom` safely backfills Job/Yard identities without rebuilding populated tables, canonicalizes pre-Production Truck/Trip identities and enforces valid, unique, immutable identities with indexed lookups and database triggers.
- Verification: full tests 147/147 (86 unit + 61 integration), TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, migration preservation/format/immutability/query-plan checks PASS, scoped secret scan PASS and `git diff --check` PASS.
- Production remains unchanged. Migration `0018`, Auth/Owner mapping and dynamic application routing are still Production gates; no QR identity or operational record was created in Production.

### Atomic motorcycle CSV/XLSX imports (`c314e6f`)

- Added authenticated internal-only upload, reconciliation and confirmation routes for 1–500 motorcycles tied to one active Job. No motorcycle is created during upload; confirmation is disabled until every row passes validation.
- The bounded UTF-8 CSV/native XLSX parser supports Thai/English headers and the full operational vehicle fields. It rejects unknown/duplicate headers, missing identifiers, formulas, malformed worksheet references, unsafe ZIP paths, oversized requests/files and XLSX expansion beyond the declared safety budget.
- Migration `0017_parallel_spirit` adds an immutable import batch/row ledger and extends motorcycle records with variant, model year, province, NEW/USED/UNKNOWN condition and notes without rebuilding the existing motorcycle table or removing earlier lifecycle triggers. Existing per-Job sequence counters are reconciled upward, never reused.
- Exact D1 confirmation SQL is shared with the integration harness: one transactional plan claims the batch, allocates the full sequence range, creates 500 motorcycles/status events/Audit entries, advances the Job and closes reconciliation. A late VIN collision rolls back every change and consumes no sequence range.
- Verification: full tests 143/143 (84 unit + 59 integration), including a real XLSX ZIP, 500-row atomic import, retry rejection and uniqueness-race rollback; TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, migration preservation/integrity checks PASS, scoped secret scan PASS and `git diff --check` PASS.
- Production remains unchanged. Migration `0017`, Auth/Owner mapping and dynamic application routing are still Production gates; no real customer/fleet file was imported.

### Server-verified quotation anti-abuse (`a2873da`)

- Added Cloudflare Turnstile implicit widget support only when both the public site key and server-only secret pass validation. With missing/placeholder/partial configuration the online form is not rendered and verified phone contacts remain available.
- `POST /api/quotation` now requires Siteverify before reading/storing attachment bytes. Validation is server-only, uses a five-second timeout, one idempotent retry, the client request UUID, optional trusted Cloudflare IP and exact `hostname=natheegroup2025.com` plus `action=quotation` matching.
- Existing successful request keys still resolve idempotently without consuming a second one-time challenge. New requests fail closed on token absence, expiry/replay, provider error, action mismatch or hostname mismatch.
- `/api/health` now has a sixth `antiAbuse` gate; both Turnstile values are required while the secret is excluded from rendered HTML, public variable names, logs and repository values.
- Verification: full tests 133/133 (78 unit + 55 integration), TypeScript PASS, ESLint PASS, Production build PASS, configured/unconfigured SSR PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, secret scan PASS and `git diff --check` PASS.
- Production remains unchanged. Real Turnstile keys and the untrusted-file handling policy are Owner gates; no credential, Sites version, D1/R2 resource or Z.com file was changed.

### Private quotation evidence and audited Owner retrieval (`af2b397`)

- Extended the real quotation form with up to five private PDF/CSV/XLSX/image attachments. The server enforces an 8 MB per-file and 20 MB combined bound plus extension/MIME/signature agreement before storing bytes.
- R2 stores unique private objects; additive migration `0016_numerous_shatterstar` stores immutable filename/type/size/storage-key/SHA-256 metadata, rejects duplicate content in one request and prohibits update or hard delete.
- A quotation, all attachment metadata and redacted submission Audit commit in one D1 batch. Any R2 objects created before a failed/concurrent D1 write are compensating-deleted; cleanup failure is fail-closed and never reports success.
- Only OWNER can retrieve an attachment. Download is forced with no-store/nosniff headers, missing/cross-role records return a generic denial and every successful read requires an Audit write first.
- Verification: full tests 130/130 (76 unit + 54 integration), TypeScript PASS, ESLint PASS, Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, migration upgrade/integrity/index checks PASS, secret scan PASS and `git diff --check` PASS.
- Deployment boundary: migration `0016`, dynamic form/API and R2 flow are source-only. Z.com public static files and all Production services remain unchanged. Production activation still requires the existing Auth/routing/D1/R2 gates plus an approved anti-abuse and untrusted-file policy.

### Commercial proof and durable quotation intake (`c5fbaa5`)

- Replaced public Home/Gallery loading placeholders with server-rendered Owner-approved photography. Home, Services, the five service detail routes, About and Contact use the same nine-item public manifest and 54 verified JPEG/WebP/AVIF variants.
- Every service route has a unique SEO title/description, service-specific four-step workflow, related real Gallery proof, at least three factual FAQs, FAQPage structured data and quotation/telephone CTA. No price, capacity, delivery-time or performance statistic is invented.
- About presents only capabilities visible in supplied evidence: working yard, large motorcycle staging, 4-wheel and 6-wheel transport and Container loading. Contact includes real telephone/LINE navigation and a Google Maps search-by-company-name action; no street address or map pin is claimed until Owner supplies a verified link.
- Full App public Gallery sections and `/gallery` use the approved static manifest as a real-photo fallback when D1 is absent or empty, while D1 `PUBLIC` + `PUBLISHED` rows remain authoritative when available.
- Added a real `/quotation` form and `POST /api/quotation` D1 path. Validation is bounded, same-origin, consented and honeypot-protected; a database-unique request key makes retries and concurrent submissions idempotent, and success appears only after the request and a redacted Audit record commit.
- Added OWNER-only `/app/quotations` with bounded 50-record keyset pages and audited status updates. Migration `0015_graceful_ben_urich` preserves legacy rows, requires consent for public submissions, makes submission identity immutable and prohibits hard deletion.
- Verification: full tests 125/125 (73 unit + 52 integration), TypeScript PASS, ESLint PASS, Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, secret scan PASS and `git diff --check` PASS.
- Deployment boundary: improved static pages are eligible for the existing guarded Z.com flow after integration. The online quotation form remains NOT Production-live until the separate Cloudflare runtime, Supabase Auth/Owner mapping, D1 backup plus migrations through `0016`, R2 and approved anti-abuse/untrusted-file controls pass.

### Responsive layout and public media delivery (`22a5454`)

- Added bounded fluid containers, responsive typography and gutters, mobile touch targets, overflow guards and collapsible public/authenticated navigation without changing the accepted premium visual identity.
- Made Company, Job, Motorcycle, Yard and Audit tables usable as named keyboard-focusable scoped scroll regions; cards, filters, forms, dashboard grids and QR/Print surfaces retain their existing bounded responsive layouts.
- Added intrinsic dimensions, aspect-ratio, `object-fit`, responsive `srcset`/`sizes`, lazy loading and lightbox-safe rendering for the real public motorcycle/truck/yard photographs without stretching portraits into landscape slots.
- Generated JPEG/WebP/AVIF thumbnail and display variants for all nine real public Gallery photographs. The idempotent optimizer limits thumbnails to 640px and displays to 1600px and rejects oversized/non-beneficial variants.
- Regression coverage validates structural contracts at 320, 375, 390, 768, 1024, 1366 and 1440px, five responsive data tables and all 54 responsive Gallery assets.
- Verification: full tests 117/117 (68 unit + 49 integration), responsive/public guards PASS, Production build PASS, ESLint PASS, image-optimizer idempotency PASS and `git diff --check` PASS.
- Browser screenshot acceptance remains pending because the bundled in-app browser service cannot start (`Trusted RPC dependency must resolve within a configured trusted code path`). This is recorded as an evidence blocker, not a visual PASS.
- The private-evidence byte risk recorded at this milestone was resolved by `0f3f182`: new uploads create bounded derivatives and legacy rows use an explicit original fallback without data rewriting.
- Deployment: source only. Z.com, Sites, Supabase, D1, R2, DNS and Production were not changed.

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
- Public CMS Gallery sections query only `PUBLIC` + `PUBLISHED` D1 items, remain bounded to 24 images per section and fall back to the checked-in Owner-approved real-photo manifest when Gallery storage is unavailable or empty.
- Kept Gallery media management separate from text editing so categories, Alt text, featured selection, ordering, visibility, responsive variants and audit history remain intact. The Site Content dashboard links directly to Media Library.
- Migration `0012` adds Site Content pages/revisions/publication history and the new permissions. It remains unapplied in Production.

### Revisioned global Site Settings

- Added `/app/site-settings` so an authorized operator can manage the shared brand name, legal name, abbreviation, tagline, optional public Gallery logo, verified telephone numbers, public navigation, Login label and Footer from one source.
- Settings use immutable SHA-256 revisions and append-only publication events. Save and publish are same-origin, permission-gated, request-idempotent and write redacted Audit records in the same D1 batch.
- Navigation is bounded to eight unique public paths, must include Home and rejects external, protocol-relative, `/api`, `/app` and `/auth` destinations. The admin UI offers only real public routes and includes a responsive Header/Footer preview.
- Public pages fail safely to verified source defaults when D1 is absent, a revision is malformed or the selected logo is no longer `PUBLIC` + `PUBLISHED`. Structured Organization data and Open Graph site identity use the same published settings.
- Migration `0013_wakeful_moon_knight` adds append-only global setting revisions/publication history. It remains unapplied in Production.

### Bounded Company, Job and Driver directories

- Company and Transport Job pages now use 50-record bounded pages instead of loading every Production row. Job pagination uses a stable `created_at` + `id` cursor, while the Company directory uses its unique code cursor.
- Job creation searches active companies by safe code/name prefixes and never renders more than 50 options. Trip planning searches active DRIVER identities by name/email only when requested instead of preloading 200 users.
- Wildcards, control characters, one-character scans and oversized search terms fail closed. Multiple indexed prefix queries are merged and deduplicated without an unbounded OR scan.
- Migration `0014_past_sphinx` adds only the seven indexes proven by these real queries. Upgrade tests preserve pre-existing Company, Job and User counts, and query-plan tests verify bounded index use. It remains unapplied in Production.

### Trusted Production Auth origin and runtime readiness

- Added a single allowlisted application-origin contract. Production accepts only `https://natheegroup2025.com`; private `*.chatgpt.site` previews and localhost are explicit non-Production cases.
- Password recovery, invitations and the Auth callback no longer derive sensitive redirect destinations from the request Host. Same-origin mutation checks now reject Host-spoofed requests and a Production runtime without `APP_ORIGIN` fails closed.
- Supabase public/admin configuration rejects placeholders, malformed URLs, secret/public key confusion and values outside the approved `sb_publishable_...` / `sb_secret_...` contract.
- `/api/health` now requires six independent checks: public Auth, admin Auth, canonical origin, required D1 tables/indexes/triggers through migration `0021`, a read-only R2 metadata probe and anti-abuse readiness. A bare database connection or binding name can no longer claim Production readiness.
- This is source-only. No Supabase value, D1 migration, R2 object, Sites version, DNS record or Z.com Production file was changed.

### Exact confirmed Auth identity mapping

- A protected request now resolves an application user only from a confirmed Supabase email identity with a valid UUID that exactly matches `users.external_auth_id`.
- Removed the unused legacy `pending:` email fallback that could rewrite an Auth mapping during a read without an explicit administrative action or Audit record.
- Email similarity alone can no longer grant an application role, company scope or permission. Identity repair remains a reviewed Owner procedure rather than an implicit login side effect.
- No user, role, database row, Supabase identity or Production runtime was changed.

## Verified source gates

- Full test suite: 168 passing
- Authorization/unit/CMS/settings/search/config/readiness/identity/quotation/Turnstile/image/POD-signature tests: 103 passing
- Render/schema/notification/yard/trip/container/inspection/POD/CMS/settings/query-plan/migration tests: 65 passing
- Production Vinext build: PASS
- ESLint: PASS
- Public SEO and deployment architecture guards: PASS
- Migrations through `0021` packaged in `dist/.openai/drizzle/`: PASS

## Open Owner gates

- Approve application routing model: apex edge routes or an application subdomain.
- Supply/configure Supabase Production values through a secure hosting channel.
- Backup and apply migrations `0001`–`0021` to the protected D1 runtime.
- Verify private R2 readiness.
- Bootstrap the real OWNER identity and accept two-company customer isolation.
- Supply/configure Turnstile Production keys through the secure hosting channel, approve untrusted-file/malware handling, and add verified location/map data when supplied.

## Next autonomous work

1. Close the Production activation gates: canonical app route, Supabase environment/callback, D1 backup+ledger+migrations `0001`–`0021`, R2 readiness, real OWNER mapping and approved quotation anti-abuse/untrusted-file controls.
2. Run real browser acceptance for OWNER and two isolated customer companies before exposing `/app` publicly.
3. Configure external LINE/email notification providers only after credentials, consent, retry and escalation policy are approved.
4. Keep all new migrations unapplied until the Production backup/runtime gates are satisfied.

## Prohibited claims

- Do not report the full application as Production-deployed.
- Do not report Auth, D1, R2, QR, Gallery Manager or notifications as Production-ready without live acceptance evidence.
- Do not apply Production migrations, DNS, credentials or deployment changes without the corresponding Owner gate.
