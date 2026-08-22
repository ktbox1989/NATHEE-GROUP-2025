# NATHEE GROUP 2025 — Canonical Project State

Updated: 2026-08-23 (Asia/Bangkok)

## Source checkpoint

- Branch: `main`
- Full HEAD: `1f3b9c4fedcd7617bbc5785b1c2170a99adfd663`
- Remote `origin/main` verified equal to local HEAD.
- Latest verified implementation milestone: Customer isolation regression guard (`6b36aca`)
- Public website Production: **CLOSED/PASS** at `7d24518e67a562c9df45d999d8f3144fccb86f6a`. Preserved; do not rework.
- Canonical repository: `ktbox1989/NATHEE-GROUP-2025`
- Working rule: resolve the current checkpoint-document commit with `git rev-parse HEAD`; never infer Production deployment from source HEAD.

## Production evidence

Measured directly against the live domain at `2026-08-23T00:12+07:00`, after
the guarded Z.com deployment of `7d24518e67a562c9df45d999d8f3144fccb86f6a`.

### Public website — LIVE and correct

| Check | Before deploy | Now |
| --- | --- | --- |
| Homepage | 12,490 bytes, 0 real photographs | **23,513 bytes, 7 real photographs** |
| `/gallery/` | 0 images, 1 loading placeholder | **9 server-rendered images, 0 placeholders** |
| Gallery assets | 32 of 54 resolving | **54 of 54 resolving** |
| Web App Manifest | absent | **200, `application/manifest+json`** |
| App icons | absent | **all 4 resolving** |

- Public routes: 11, all HTTP 200, with SEO/noindex/mobile gates.
- `scripts/audit-production-components.sh` reports `public-static-site=LIVE`,
  `public-gallery=LIVE_STATIC_MANIFEST` and `PRODUCTION_COMPONENT_AUDIT_PASS`.
- The stale-release and 404-asset defects recorded at the previous checkpoint
  are resolved and are guarded against by `scripts/test-public-site-gate.sh`.

### Application — NOT DEPLOYED

- Canonical `/login/`: static noindex status page. `login-auth` remains
  `STATIC_PLACEHOLDER_ONLY`; this is **not** real Auth.
- Canonical `/app`: 404. Canonical `/api/health`: 404.
- Protected Sites artifact: version 4, source `9afd58d`, owner-only access,
  zero environment variables, and only the ten `0000` base tables in D1. It
  predates migrations `0001`-`0021` and is
  `PRIVATE_SITES_RUNTIME_NOT_ACCEPTED`, not Production.
- Full application Production acceptance: **NOT PASSED**. Real login, OWNER
  mapping, customer isolation, QR scanning and the authenticated app checks are
  all unproven, and no report may claim otherwise.

## Closed local milestones

### Customer isolation regression guard (`6b36aca`)

- Audited every route for cross-tenant leakage: 49 files read company-owned tables and all 49 perform an authorization check. No leak was found, but nothing prevented the next edit from introducing one.
- `tests/customer-isolation.test.ts` now proves both halves of the property. On `can()`: a customer role is denied every write capability even for its own company, denied everything for another company, denied when the target company is unknown, and denied when it has no company. That "unknown company" rule is what makes the common `can(actor, "jobs:read")` call a safe internal-only gate, which Trip, Truck, Yard and Print Center depend on.
- On the route surface: every file under `app/api` and `app/app` reading a company-owned table must establish authority by one of six recognised mechanisms. The test asserts it inspected the whole route set, so a broken scan cannot pass by finding nothing, and a fixture proves the detection logic reports an unguarded route.
- Verification: full tests 188/188 (113 unit + 75 integration), TypeScript PASS, ESLint PASS, production build PASS. No route behaviour changed.

### Honest application readiness audit (`a4a304a`)

- `scripts/audit-production-components.sh` decides whether the protected runtime may be called working, and it claimed more than it proved.
- It inspected five of the six readiness gates. `antiAbuse` was never checked, so a runtime with no Turnstile configuration was reported healthy. An absent gate also passed silently, so an older runtime predating a check looked identical to one satisfying it. Both now fail closed.
- It printed `full-application=LIVE` from `/api/health` alone. Health proves configuration and schema, not that the app refuses an anonymous request. The audit now probes `/app`, `/api/companies`, `/api/motorcycles` and `/api/jobs` signed out and fails on any 200, reports `RUNTIME_HEALTHY_ANONYMOUS_GATED` instead of `LIVE`, and prints explicit `PRODUCTION_NOT_PROVEN` lines for real login, OWNER mapping, customer isolation and QR scanning.
- Decisions moved to `scripts/lib/app-readiness.sh` in pure bash, because the audit runs from Z.com where Node is optional. `scripts/test-app-readiness.sh` proves 16 cases including every gate false, every gate absent, an empty body, a string that only looks boolean, and a rejected anonymous 200.
- Verification: readiness 16/16, full tests 181/181 (106 unit + 75 integration), TypeScript PASS, ESLint PASS, production build PASS.
- No Production runtime, D1 row, credential or public file changed.

### Verifiable canonical OWNER bootstrap (`0f3205b`)

- Creating the first OWNER is the one privileged write made by hand against live Production, and the procedure was a raw INSERT snippet. It could mistype the UUID into an identity the runtime silently refuses, wrote only the legacy `users.role` column instead of the authoritative `user_role_assignments` row, left no audit record, was not idempotent, and would bind an email already belonging to someone else.
- `npm run owner:bootstrap` validates the UUID against the exact pattern `lib/auth-identity.ts` enforces, normalises the email, and emits guarded SQL: preflight queries, an insert skipped when the identity or email exists, the canonical role assignment, an audit entry and a verify query that states plainly whether it applied.
- It takes no secret, so it lives in the repository; a generated file maps a privileged identity and is gitignored.
- `tests/owner-bootstrap.test.mjs` proves it against the real schema with all 22 migrations applied: the identity resolves as OWNER through the same query `lib/current-actor.ts` uses, re-running changes nothing, a conflicting email or already-mapped identity is refused without altering the existing row, a deliberate second owner still works, and a display name of `O'Brien'); DROP TABLE users; --` is stored literally.
- No Supabase identity, D1 row or Production runtime changed.

### Installable public website (`9e75d5c`)

- PWA readiness was in scope but entirely absent: no Web App Manifest, no icons beyond a 385-byte favicon and no Apple touch icon, so adding the site to a home screen produced a generic bookmark.
- Added `/site.webmanifest` (same-origin, `standalone`, scope `/`, Thai locale) with shortcuts to the real `/quotation/`, `/gallery/` and `/contact/` routes, plus 192, 512, maskable 512 and Apple 180 icons. The manifest link, Apple touch icon and `theme-color` are present on all eleven public routes and `/login/`.
- `scripts/generate-pwa-icons.mjs` derives every icon from the Owner-supplied brand artwork; nothing is invented. It is idempotent, rejects artwork that is not square or under 512px, pads maskable icons into a 64% safe zone and uses 256-colour palette PNGs (312KB total rather than 879KB).
- `.htaccess` declares `application/manifest+json`, because shared hosting serves an unmapped `.webmanifest` as `text/plain` and the browser then ignores it. The live postcheck asserts the response `Content-Type`.
- **No Service Worker is shipped and both verifiers fail if one appears.** A cache-first worker on a static marketing site can keep serving a superseded release, which is the exact failure Production is recovering from. Offline support stays a separate reviewed decision.
- Verification: icon PNG `IHDR` headers parsed and matched against the declared sizes, release gate 9 negative cases + 1 positive, postcheck contract 29 routes PASS, full tests 174/174 (106 unit + 68 integration), TypeScript PASS, ESLint PASS, Vinext production build PASS, SEO and deploy-tools gates PASS. Critical mobile payload 61,081 of 102,400 bytes.
- No Production file, backup, DNS record or credential was changed. This ships with the same pending public deployment.

### Repaired the Z.com release gates (`3df9c43`, `f01f561`, `53ec689`)

- Found the reason Production is stale: **the deployment could not succeed.**
  Both release gates still required the homepage to embed the brand artwork as
  an `<img>`, which the accepted homepage no longer does because the hero now
  leads with real company work photography.
- `scripts/verify-public-site.sh` runs before any backup or mutation, so it
  aborted the deploy outright. `scripts/postcheck-production.sh` runs *after*
  the release is applied and `deploy-zcom.sh` restores the backup when it
  fails, so a correct release would have been applied and then rolled straight
  back. Both are fixed.
- Both gates now verify the real contract: brand artwork through structured
  data and Open Graph, a homepage that server-renders real work photography,
  a `/gallery/` that server-renders the nine approved photographs, no
  server-rendered loading placeholder, and no reference to an `/assets/` file
  the release does not ship (covering `src`, `href` and every `srcset`
  candidate). The postcheck additionally requires the JPEG, WebP and thumbnail
  variants to resolve over HTTP, so a release that 404s its own images fails.
- Fixed a silent-failure defect in the verifier: under `set -o pipefail` a
  zero-match `grep` made a count assignment return non-zero, so `set -e` killed
  the script with no output before `fail()` could report the reason.
- `scripts/test-public-site-gate.sh` proves all four new guards by rejecting
  deliberately broken copies of the real release, and confirms the unmodified
  release still passes. `scripts/test-production-postcheck-contract.sh`
  resolves every route the postcheck fetches against the real release and runs
  the postcheck's own extracted assertions against those bytes, so the two
  cannot drift; restoring the old assertion makes it fail, so it is not
  vacuous. Both run in CI and in the documented Z.com runbook.
- Both tests create scratch directories through the shared
  `nathee_make_temp_dir` helper, verified with `NATHEE_DISABLE_MKTEMP=1` and a
  home-directory parent to match Z.com shared hosting.
- Verification: gate negative tests 4/4 plus 1 positive, postcheck contract 24
  routes PASS, full tests 174/174 (106 unit + 68 integration), TypeScript PASS,
  ESLint PASS, Vinext production build PASS, `verify-public-site.sh`,
  `test-public-seo-gates.sh` and `test-deploy-file-tools.sh` PASS.
- No Production file, backup, DNS record or credential was changed. The public
  release is unblocked but **not yet deployed**; it needs one Z.com Terminal
  run, which this runtime cannot reach.

### Bounded multipart uploads before parsing (`c9f20f7`)

- Closed a request-budget bypass: several heavy endpoints converted a missing `Content-Length` to zero and then parsed the multipart body. Gallery, private evidence, signed POD, motorcycle import and public quotation now share one fail-closed contract before `request.formData()`.
- The contract requires `multipart/form-data` with a non-empty bounded boundary and an explicit positive integer byte length. Missing/invalid length returns 411, unsupported media returns 415 and over-budget payload returns 413 (or the existing safe form error redirect).
- Static coverage requires all five heavy routes to keep the shared guard, while unit coverage checks quoted boundaries, missing/zero/fractional lengths and exact/over-limit sizes.
- Verification: full tests 174/174 (106 unit + 68 integration), TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, scoped secret scan PASS and `git diff --check` PASS.
- No migration was added and Production remains unchanged. Real browser/Cloudflare multipart acceptance remains part of the gated application runtime acceptance.

### Server-verified image artifacts and R2 compensation (`5629c21`)

- Closed a data-correctness gap shared by Gallery and private motorcycle evidence: the server previously verified MIME signatures but persisted width/height supplied by the browser. New uploads now derive JPEG, PNG, WebP and ISO-media (AVIF/HEIC/HEIF) dimensions from the actual bytes, reject mismatched client claims and reject decoded geometry above 80 million pixels.
- Verified the parser against the real checked-in JPEG, WebP and AVIF release variants (1600×900). Persisted responsive metadata now describes the stored artifact rather than an untrusted request field, protecting aspect ratio, layout stability and evidence review.
- Gallery, evidence and quotation object writes now register every candidate key before the potentially ambiguous R2 call. Cleanup uses all-settled compensation; image routes report cleanup uncertainty explicitly and never throw past reconciliation or claim an unproved success.
- Verification: full tests 172/172 (105 unit + 67 integration), TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, real-artifact dimension checks PASS, scoped secret scan PASS and `git diff --check` PASS.
- No migration was added and Production remains unchanged. Real R2/browser acceptance still requires the gated full application runtime, Auth/Owner mapping and existing migrations.

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

- Full test suite: 188 passing
- Authorization/unit/CMS/settings/search/config/readiness/identity/quotation/Turnstile/image/POD-signature tests: 106 passing
- Render/schema/notification/yard/trip/container/inspection/POD/CMS/settings/query-plan/migration tests: 68 passing
- Production Vinext build: PASS
- ESLint: PASS
- Public SEO and deployment architecture guards: PASS
- Migrations through `0021` packaged in `dist/.openai/drizzle/`: PASS
- Release gate negative tests now cover installability: 9 rejections + 1 acceptance
- Postcheck contract test (`test-production-postcheck-contract.sh`): 29 routes, content-only
- TypeScript `tsc --noEmit`: PASS
- Application readiness decisions (`test-app-readiness.sh`): 16 cases, six health gates
- OWNER bootstrap against all 22 migrations (`owner-bootstrap.test.mjs`): 7 cases
- Customer isolation (`customer-isolation.test.ts`): 49 routes guarded, 0 unguarded
- Login redirect regression (`test-login-redirect.sh`): 10 cases, committed state INACTIVE
- Live public audit (`audit-live-public-site.mjs`): 11 routes, 36 references, problems=0
- Public CMS contract, preview, revalidation, SEO, media and quotation: 73 cases
- Static content inventory (`inventory-public-content.mjs`): 11/11 routes map to contract v1

## Open Owner gates

- Approve application routing model: apex edge routes or an application subdomain.
- Supply/configure Supabase Production values through a secure hosting channel.
- Backup and apply migrations `0001`–`0021` to the protected D1 runtime.
- Verify private R2 readiness.
- Bootstrap the real OWNER identity and accept two-company customer isolation.
- Supply/configure Turnstile Production keys through the secure hosting channel, approve untrusted-file/malware handling, and add verified location/map data when supplied.

## Next autonomous work

0. **Deploy the pending public release.** Source, gates and tests are green and
   `main` is pushed. This runtime cannot reach the Z.com Terminal (SSH port 22
   is refused and FTP/SFTP are disproved), so the Owner runs the exact block in
   "Pending Production deployment" below. Nothing else in the public-site scope
   is blocked on code.
1. Close the Production activation gates: canonical app route, Supabase environment/callback, D1 backup+ledger+migrations `0001`–`0021`, R2 readiness, real OWNER mapping and approved quotation anti-abuse/untrusted-file controls.
2. Run real browser acceptance for OWNER and two isolated customer companies before exposing `/app` publicly.
3. Configure external LINE/email notification providers only after credentials, consent, retry and escalation policy are approved.
4. Keep all new migrations unapplied until the Production backup/runtime gates are satisfied.

## Lane A — Public CMS integration prep (inactive)

Prepared while Lane B builds the CMS backend. Nothing is wired into a rendered
route and Production still serves the static release. Full detail:
`docs/PUBLIC_CMS_INTEGRATION.md`.

- **Consumer contract** (`lib/public-cms/contract.ts`). States what the public
  site requires of a CMS and refuses anything else. Only `PUBLISHED` has a
  representation, so drafts cannot leak by construction. Media must be a
  same-origin `/assets/` path, which keeps private customer and job evidence
  off the public site; alt text and intrinsic dimensions are required; a
  canonical may not point away from its own page; heading levels may not skip.
- **Inactive boundary** (`lib/public-cms/source.ts`). Defaults to `STATIC`.
  Reaching `CMS` needs both an explicit opt-in and a declared contract version
  matching this site's. While inactive the CMS loader is never called. An
  invalid payload or a CMS outage falls back to static with a reason.
- **Preview** (`lib/public-cms/preview.ts`). HMAC-signed, timing-safe,
  15-minute maximum, bound to one page AND one revision so a shared link cannot
  be replayed. Responses are noindex/no-store, never in the sitemap, and the
  canonical points at the published URL.
- **Publish without deploying** (`lib/public-cms/revalidation.ts`). An explicit
  dependency map rather than a wildcard purge: unpublishing removes the URL and
  the sitemap entry, media also invalidates `/gallery/` and the home preview,
  settings invalidate every route. The home page cannot be unpublished, and an
  unrecognised event is reported as needing the guarded deploy.
- **Dynamic SEO** (`lib/public-cms/seo.ts`). Unpublished is a hard 404 not a
  soft one, `NOINDEX` pages stay out of the sitemap, renamed slugs 301, and
  redirects cannot point off-site, loop, or lead away from a live route.
  Redirect chains are impossible by construction.
- **Media rendering** (`lib/public-cms/media.ts`). Re-checks every source on the
  way out; avif/webp with a jpeg or png fallback; alt, dimensions, aspect
  ratio, srcset and sizes; lazy except the first image; lightbox always
  labelled. A broken item is skipped and reported rather than rendered.
- **Quotation frontend** (`lib/public-forms/quotation-contract.ts`). Success
  requires a complete acknowledgement whose request key matches. A bare 200, an
  HTML page or a missing reference are failures, so no fake runtime success.
  One request key reused across retries prevents duplicate enquiries.
- **Content inventory** (`scripts/inventory-public-content.mjs`). Maps the live
  release onto the contract and validates it: 11 routes, 70 sections, 159
  paragraphs, 32 page images, 9 gallery items all with alt and dimensions. All
  11 map cleanly. Runs in the suite; migrates nothing.

### Blocked on Lane B

Migration cannot start until Lane B publishes the canonical CMS schema and API
contract. When it exists the remaining work here is a mapping function into
`PublicPage`; if the contract or validators need changing to accommodate it,
that is a finding worth discussing rather than patching around.

## Lane A — Public ↔ Application integration and release control

Lane A owns the public website, the release scripts and the handoff to the
application. Lane B owns Auth, Supabase, D1, R2, Owner/Admin and the
application runtime. Neither lane redeploys the other's component.

Full detail: `docs/PUBLIC_APP_HANDOFF.md`.

### Public Production regression — PASS, no changes needed

`node scripts/audit-live-public-site.mjs` inspects the deployed bytes, not the
repository, and reports against the live domain:

- 11 routes, 11 unique titles, 11 unique descriptions, correct canonical each,
  exactly one `h1`, JSON-LD that parses;
- every image has `alt` and intrinsic `width`/`height`; every gallery image has
  `srcset` and `sizes`;
- 36 internal references resolve; sitemap lists exactly the 11 public routes;
- `robots.txt` excludes `/login/`, `/login-status.html`, `/auth/`, `/app/`,
  `/api/`; `/login/` and unknown paths return a `noindex` `X-Robots-Tag`;
- manifest valid and served as `application/manifest+json`, every icon resolves;
- `www` redirects permanently to the apex;
- accessibility: `lang`, skip link, `main`/`nav` landmarks, no positive
  `tabindex`, every form control named, every link and button has an
  accessible name.

`bash scripts/postcheck-production.sh` also passes against the live site.

### Semantic heading fix — DEPLOYED and verified

`/services/` rendered `h1` then five `h3` cards with no `h2`, skipping a level
and breaking the documented semantic H1/H2 rule. Fixed with a visually hidden
`h2` on the card section, so the accepted design is unchanged.

Deployed and independently verified against the live domain:

- live `/services/` heading order is `1 2 3 3 3 3 3 2 3 3 3 3 2 2 2`, no skip;
- the `sr-only` heading `บริการทั้งหมด` (`id="service-overview-heading"`) is
  present in the served HTML;
- live `/services/` is **byte-identical** to the release
  (`sha256 8f8d17fc390b3de21eb8b4c898a864a92d6822167f6d78cd1d1a327680d98ee2`);
- `node scripts/audit-live-public-site.mjs` reports
  `LIVE_AUDIT_PASS routes=11 links=36 problems=0`;
- `bash scripts/postcheck-production.sh` reports `PRODUCTION_POSTCHECK_PASS`
  with `login-auth=STATIC_PLACEHOLDER_ONLY`.

No file in `public-site/` now differs from what the live site serves.

### Z.com runs portable bash only

The Z.com runtime probe proved the web host has no `node`, `npm` or `npx`, and
none will be installed. A deployment attempt stopped safely before Production
because `test-login-redirect.sh` drives Node and had been listed as a Z.com
gate. That was a runbook error, not a defect in the release.

Gates are now split by interpreter:

- **portable bash, Z.com and CI:** `verify-public-site.sh`,
  `verify-login-redirect-state.sh`, `test-public-site-gate.sh`,
  `test-production-postcheck-contract.sh`, `test-public-seo-gates.sh`,
  `test-app-readiness.sh`, `test-deploy-file-tools.sh`,
  `postcheck-production.sh`, `verify-app-integration.sh`;
- **Node, local and CI only:** `test-login-redirect.sh` before push,
  `audit-live-public-site.mjs` after deploy, plus the build and toggle scripts.

The Node suites were not weakened. `test-login-redirect.sh` is unchanged, still
proves all ten cases, and now also runs in CI.

`test-deploy-file-tools.sh` enforces the split: it fails if any Z.com-set
script invokes `node`, `npm` or `npx`, matching command position only so the
optional capability list in `probe-zcom-runtime.sh` is not mistaken for a
dependency. It reports `nodeOnZcom=absent`.

Production still verifies the redirect state, in bash.
`verify-login-redirect-state.sh` reads the managed block from the release being
deployed and defaults to requiring `INACTIVE`. Expecting `ACTIVE` requires
`--evidence` containing `APP_RUNTIME_PASS`, and in that state it re-checks the
rewrite contract portably: 302 never 301, `QSA`, HTTPS target, apex host
condition against looping, and the local login page still shipped for rollback.

The current Z.com deployment command lives in `docs/ZCOM_DEPLOYMENT.md` under
"Verify and deploy (Z.com)" and is portable bash throughout.

### /login handoff — built, tested, INACTIVE

`https://natheegroup2025.com/login/` still serves its own `noindex` page. The
handoff to `https://app.natheegroup2025.com/login` is committed as a managed
block in `public-site/.htaccess`, shipped `INACTIVE`, and a test asserts the
committed release is never accidentally active.

Contract: 302 never 301 so activation stays reversible; `QSA` preserves
`returnTo` and `error`; HTTPS-only absolute target; a `RewriteCond` pins the
rule to the canonical apex so it cannot loop if the application host is pointed
at this document root; `robots.txt` keeps `Disallow: /login/` and the local
login page stays shipped so rollback needs no rebuild.

`scripts/postcheck-production.sh` now reads the state from the release being
deployed. It previously hard-required `/login/` to be 200 with a noindex meta,
so activating the redirect would have made a correct deployment fail its own
postcheck and roll itself back.

### Integration gate — fail-closed, currently failing as expected

`bash scripts/verify-app-integration.sh` must pass before activation. It
requires `/api/health` 200 with all six checks true (an absent check fails
too), application `/login` 200 with a body, `/auth/callback` present, no 5xx,
the application `noindex` and not claiming the public canonical URL, the
application host not serving the public site byte-for-byte, the eight public
routes live, and the public release still passing its own verification.

Run today it fails with `/api/health was unreachable`, because
`app.natheegroup2025.com` does not exist yet. That is the correct state.

Activation is refused without its evidence:

```bash
bash scripts/verify-app-integration.sh > app-integration-gate.txt
node scripts/set-login-redirect.mjs --state active --evidence app-integration-gate.txt
```

`set-login-redirect.mjs` refuses to activate unless that file contains
`APP_INTEGRATION_GATE_PASS`.

### Waiting on Lane B

Activation is blocked until Lane B supplies `APP_RUNTIME_PASS` evidence that
`app.natheegroup2025.com` is live with Login/Auth passing. Lane A will not
activate the redirect before then, and no Lane A change can make the
application ready.

### Lane A verified gates

- Live public audit: 11 routes, 36 references, accessibility and PWA verified
- Login redirect regression: 10 cases, both states deployable, rollback
  byte-for-byte, activation refused without gate evidence
- Release script portability: 15 scripts scanned code-only for rsync, flock,
  `/dev/fd`, process substitution, herestrings, root and package managers
- Source accessibility gate: heading order, single `h1`, skip link, landmark,
  `lang`

## Public website Production — CLOSED

The guarded Z.com deployment completed and passed at commit
`7d24518e67a562c9df45d999d8f3144fccb86f6a`. The live site was independently
re-confirmed by `scripts/audit-production-components.sh`, which reports
`public-static-site=LIVE`, `public-gallery=LIVE_STATIC_MANIFEST` and
`login-auth=STATIC_PLACEHOLDER_ONLY`.

Do not rework or redeploy the public website as part of application work. The
two deployments are independent and the public site stays live throughout.

## Application deployment — the current work

`login-auth` is still `STATIC_PLACEHOLDER_ONLY` and the full application is
still `NOT_DEPLOYED`. The remaining work is the protected runtime: real Auth,
the canonical OWNER identity, Role/Permission enforcement and
Customer/Job/Vehicle operations.

Follow `docs/PRODUCTION_GO_LIVE.md` in order. Section 0 now covers building and
deploying the artifact itself, which the checklist previously assumed had
already happened.

### What is ready in source

- Real server-side Supabase Auth. An application user is resolved only from a
  confirmed identity whose UUID exactly matches `users.external_auth_id`; there
  is no email fallback, no demo account and no client-side permission.
- Role and Permission enforcement for all ten canonical roles. `can()` is
  fail-closed: every non-OWNER internal role needs an explicit capability, and
  a customer role is denied unless the target company matches. A `can()` call
  with no company argument therefore denies customers by construction, which is
  how internal-only surfaces such as Trip, Truck, Yard and Print Center are
  gated.
- A verified OWNER bootstrap generator (`npm run owner:bootstrap`) replacing the
  hand-written INSERT.
- An audit that refuses to overclaim (`scripts/audit-production-components.sh`).

### Owner gates that block deployment

These need values or decisions only the Owner can supply. Each blocks the
runtime, not the source.

1. **Application routing.** Edge-route `/login`, `/auth`, `/app` and `/api`
   from the apex to the application runtime, or use an application subdomain.
   This changes DNS or the Supabase callback, so it is an explicit Owner
   decision. Nothing else can be accepted until it is made.
2. **Supabase Production values**, set as hosting environment variables and
   never in Git: `APP_ORIGIN`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_...`) and
   `SUPABASE_SECRET_KEY` (`sb_secret_...`, server-only).
3. **Turnstile Production keys**: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and
   `TURNSTILE_SECRET_KEY`. `/api/health` fails closed without both.
4. **D1 migrations `0000`-`0021`**, applied once each in order with a ledger
   and a pre-migration backup. The current artifact has only the ten `0000`
   base tables.
5. **Private R2 binding `FILES`** confirmed and private.
6. **The real OWNER Supabase account**, created and email-confirmed, so its
   UUID can be passed to the bootstrap generator.

### Exact next actions

```bash
# 1. Prove the source is releasable and record the commit to deploy.
npm ci && npm run lint && npm test && bash scripts/test-app-readiness.sh
git rev-parse HEAD

# 2. Deploy that commit through the Sites integration, configure the
#    environment values above, then apply migrations 0000-0021.

# 3. Map the canonical OWNER (after the Supabase account is confirmed).
npm run owner:bootstrap -- \
  --auth-id '<SUPABASE-USER-UUID>' \
  --email '<CONFIRMED-EMAIL>' \
  --display-name '<OWNER NAME>' \
  > owner-bootstrap.sql

# 4. Verify the runtime and prove it refuses anonymous access.
NATHEE_APP_BASE_URL='https://OWNER_APPROVED_APP_HOST' \
  bash scripts/audit-production-components.sh
```

Step 4 passing means `RUNTIME_HEALTHY_ANONYMOUS_GATED`. It does **not** mean
Production is complete: real login, OWNER mapping, customer isolation and QR
scanning still require the signed-in acceptance flow in section 5 of
`docs/PRODUCTION_GO_LIVE.md`.

## Prohibited claims

- Do not report the full application as Production-deployed.
- Do not report Auth, D1, R2, QR, Gallery Manager or notifications as Production-ready without live acceptance evidence.
- Do not apply Production migrations, DNS, credentials or deployment changes without the corresponding Owner gate.
