# NATHEE GROUP 2025 — Work History

## 2026-08-23 — Lane A: public/application integration and release control

- Implementation commits: `eac3414`, `49196cd`, `b4abdb8`
- Audited the live public release: 11 routes, unique titles and descriptions, 36 internal references resolving, sitemap exact, images with alt and intrinsic dimensions, valid manifest, www canonical. No regression, so nothing was changed to "fix" it.
- Built the `/login` handoff to `app.natheegroup2025.com` and left it INACTIVE. 302 not 301 so it stays reversible, QSA preserves `returnTo` and `error`, and a host condition prevents a loop. Activation requires evidence from the integration gate, which fails closed today because the application host does not exist.
- Fixed a latent rollback trap: `postcheck-production.sh` hard-required `/login/` to be 200, so activating the redirect would have made a correct deployment fail its own postcheck and roll itself back.
- Widened the release portability guard from 6 to 15 scripts, scanning executable lines only, and added herestring and root/package-manager checks. It immediately found six herestrings, now explicit pipes.
- Found and fixed one real accessibility defect: `/services/` skipped `h1 -> h3`. A visually hidden `h2` restores the outline with no visual change. Guarded in both the source verifier and the live audit.
- Verification: full tests 188/188 (113 unit + 75 integration), TypeScript PASS, ESLint PASS, production build PASS, login redirect 10/10, public gate 9+1, postcheck contract 29 routes, app readiness 16/16, SEO 7 mutations, deploy tools PASS, live production postcheck PASS.
- Deployment: source only. No redirect is active, no Production file changed, and the public release at `7d24518` is untouched. The `/services/` heading fix awaits the next public deploy.
- Rollback: revert `b4abdb8` to drop the heading fix and its guards; revert `eac3414` to remove the handoff machinery. Neither affects the currently deployed site, which has no redirect active.

## 2026-08-23 — Application readiness: OWNER bootstrap and honest audit

- Implementation commits: `0f3205b`, `a4a304a`
- Public website Production is CLOSED/PASS at `7d24518e67a562c9df45d999d8f3144fccb86f6a` and was preserved untouched; the application is a separate deployment.
- Replaced the hand-written OWNER INSERT with a validated generator that emits idempotent, guarded, audited SQL, proven against the real schema with all 22 migrations applied.
- Fixed the application audit, which checked five of six readiness gates and claimed `full-application=LIVE` from a health probe alone. It now fails closed on a false or absent gate, proves the protected surface refuses anonymous requests, and names what remains unproven.
- Audited every API route and app page for company scoping. The authorization model is fail-closed by construction: a `can()` call with no company argument denies customer roles, and record-level checks bind to the fetched record's own `companyId`. No leak was found.
- Verification: readiness 16/16, owner bootstrap 7/7, full tests 181/181 (106 unit + 75 integration), TypeScript PASS, ESLint PASS, production build PASS, public gate 9+1, postcheck contract 29 routes.
- Deployment: source only. No Supabase identity, D1 row, R2 object, Production runtime, DNS record or public file changed.
- Rollback: revert `a4a304a` and `0f3205b`. Doing so restores an audit that overclaims and an unverified bootstrap, so prefer fixing forward.

## 2026-08-22 — Installable public website

- Implementation commit: `9e75d5c`
- Added a same-origin Web App Manifest, the 192/512/maskable-512/Apple-180 icon set derived from the Owner-supplied brand artwork, and install metadata on all eleven public routes plus `/login/`.
- Declared `application/manifest+json` in `.htaccess`; an unmapped `.webmanifest` is served as `text/plain` and silently ignored.
- Deliberately shipped no Service Worker, and made both verifiers fail if one appears, to avoid reintroducing stale-release serving.
- Verification: PNG `IHDR` headers parsed and matched to declared sizes, release gate 9 negative + 1 positive, postcheck contract 29 routes, full tests 174/174, TypeScript PASS, ESLint PASS, production build PASS.
- Deployment: source only. Ships with the pending public release; no Z.com file, D1 row, R2 object, DNS record or credential changed.
- Rollback: revert `9e75d5c`. Home-screen installs already made would keep the icon set until reinstalled; nothing else is affected.

## 2026-08-22 — Repaired the Z.com release gates

- Implementation commits: `3df9c43`, `f01f561`, `53ec689`
- Measured Production directly and found it running a stale release: the homepage served 0 real work photographs, `/gallery/` served 0 `<img>` elements plus a client-side loading placeholder, and only 32 of 54 gallery variants resolved. The previous checkpoint claimed this Gallery was live; that claim has been corrected.
- Root cause was that the deployment could not succeed. Both release gates still required the homepage to embed the brand artwork as an `<img>`, which the accepted homepage no longer does because the hero now leads with real work photography. `verify-public-site.sh` aborted the deploy before backup, and `postcheck-production.sh` would have rolled a correct release back after it was applied.
- Both gates now verify the real contract: brand artwork via structured data and Open Graph, real server-rendered work photography on the homepage, nine server-rendered photographs on `/gallery/`, no server-rendered loading placeholder, and no reference to an `/assets/` file the release does not ship. The postcheck additionally requires the JPEG, WebP and thumbnail variants to resolve over HTTP.
- Fixed a silent-failure defect: under `set -o pipefail` a zero-match `grep` made a count assignment return non-zero, so `set -e` killed the verifier with no output before `fail()` could report the reason.
- Added `scripts/test-public-site-gate.sh` (4 negative cases + 1 positive) and `scripts/test-production-postcheck-contract.sh` (24 fetched routes, content only), both wired into CI and the Z.com runbook, and both using the shared `nathee_make_temp_dir` helper verified with `NATHEE_DISABLE_MKTEMP=1` and a home-directory parent.
- Verification: gate negative tests 4/4 plus 1 positive, postcheck contract 24 routes PASS and FAIL when the stale assertion is restored, full tests 174/174 (106 unit + 68 integration), TypeScript PASS, ESLint PASS, Vinext Production build PASS, `verify-public-site.sh`, `test-public-seo-gates.sh` and `test-deploy-file-tools.sh` PASS, and `git diff --check` PASS.
- Deployment: source only. No Z.com file, backup, Sites version, Supabase value, D1 migration/row, R2 object, DNS or Production runtime changed. The public release is unblocked but not yet deployed; it needs one Z.com Terminal run, which this runtime cannot reach because SSH port 22 is refused.
- Rollback: revert `53ec689`, `f01f561` and `3df9c43` to restore the previous gates. Doing so re-blocks the public deployment, so prefer fixing forward. No schema or object rollback is involved.

## 2026-08-21 — Bounded multipart uploads before parsing

- Implementation commit: `c9f20f7`
- Added one fail-closed multipart contract to Gallery, private motorcycle evidence, signed POD, motorcycle imports and the public quotation endpoint. It validates media boundary and explicit request length against each endpoint's byte budget before any body parse.
- Missing/invalid/zero lengths can no longer become an accepted zero through JavaScript number conversion; unsupported, length-required and too-large responses remain distinct for JSON upload clients while HTML forms retain safe redirects.
- Verification: full tests 174/174 (106 unit + 68 integration), TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, scoped secret scan PASS and `git diff --check` PASS.
- Deployment: source only. No migration, Z.com file, Sites version, Auth setting, D1 row, R2 object, DNS or Production runtime changed.
- Rollback: revert `c9f20f7`; no schema or object rollback is required.

## 2026-08-21 — Server-verified image artifacts and R2 compensation

- Implementation commit: `5629c21`
- Replaced browser-trusted image dimensions with dimensions parsed from the stored JPEG, PNG, WebP, AVIF, HEIC or HEIF bytes. Display/Thumbnail claims must exactly match; originals receive authoritative dimensions even when the client omits them. Oversized decoded geometry fails before R2/D1 persistence.
- Registered each Gallery, motorcycle-evidence and quotation object key before its R2 write so a timeout after a server-side commit remains compensatable. Cleanup is all-settled; the image APIs distinguish cleanup uncertainty and retry reconciliation from a confirmed durable success.
- Verification: full tests 172/172 (105 unit + 67 integration), TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, real JPEG/WebP/AVIF artifact checks PASS, scoped secret scan PASS and `git diff --check` PASS.
- Deployment: source only. No migration, Z.com file, Sites version, Auth setting, D1 row, R2 object, DNS or Production runtime changed.
- Rollback: revert `5629c21`; no schema rollback is required. Do not delete existing Gallery, evidence or quotation objects while rolling back application code.

## 2026-08-21 — Fail-closed Gallery batch uploads

- Implementation commit: `ab3c868`
- Fixed an evidence-backed false-success path where XHR followed validation-error redirects and accepted the resulting HTML HTTP 200 as a completed upload. Success now requires a complete server JSON acknowledgement with the canonical Gallery item ID.
- Assigned one cryptographically secure idempotency identity per queued image and retained it across retries. The API validates the format, returns canonical duplicates and reconciles unique-key races after best-effort cleanup of only the losing attempt's R2 objects.
- Added multipart/aggregate-byte guards, decoded-pixel bounds, explicit Auth/validation/server status codes and centralized secure browser UUID generation. Existing non-XHR redirects remain compatible.
- Verification: full tests 168/168 (103 unit + 65 integration), TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, scoped secret scan PASS and `git diff --check` PASS.
- Deployment: source only. No migration, Z.com file, Sites version, Auth setting, D1 row, R2 object, DNS or Production runtime changed.
- Rollback: revert `ab3c868`; no database/object rollback is required. Do not remove successfully created Gallery Drafts when rolling back a client release.

## 2026-08-21 — Private signed Proof of Delivery

- Implementation commit: `7a5bf0d`
- Added touch/mouse recipient signature capture to the real POD form with explicit attestation, progress, cancel, error and idempotent retry behavior. It never stores the signature in browser storage or displays success before the server confirms D1 and R2.
- The server validates PNG signature bytes, actual IHDR dimensions, byte bounds and SHA-256, then stores the object privately. Reads repeat `documents:read` company authorization and return `private, no-store`.
- Migration `0021_zippy_impossible_man` preserves legacy unsigned PODs while requiring a signature flag for every new POD, a matching immutable signature row before `DELIVERED`, and no hard delete. Migration tests prove legacy preservation, cross-company rejection, malformed metadata rejection and indexed retrieval.
- Verification: full tests 166/166 (101 unit + 65 integration), TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, scoped secret scan PASS and `git diff --check` PASS.
- Deployment: source only. No Z.com file, Sites version, Supabase value, D1 migration/row, R2 object, DNS or Production runtime changed. Real signed-POD browser/R2 acceptance remains gated by Auth and the full application runtime.
- Rollback: before applying `0021`, revert `7a5bf0d`. After apply, retain POD/signature history and use a reviewed forward migration or restore the pre-migration D1 backup; never delete private evidence to roll back client code.

## 2026-08-21 — Private motorcycle evidence derivatives

- Implementation commit: `0f3f182`
- Added a client/server evidence-image pipeline that retains the private original while creating bounded WebP Display/Thumbnail derivatives and optional AVIF. The authenticated grid requests Thumbnail, evidence/POD links request Display and legacy rows fall back to the unchanged original.
- Added strict MIME signatures, SHA-256 metadata, mobile byte budgets, a decoded-pixel safety bound, real upload progress/cancel/error states and secure request-key idempotency. D1 and R2 failure compensation never reports success or deletes a pre-existing object.
- Migration `0020_awesome_quentin_quire` is additive: legacy image rows remain unchanged with a nullable request key; the new variant table is indexed and evidence metadata becomes immutable/non-deletable.
- Verification: full tests 160/160 (96 unit + 64 integration), TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, migration preservation/immutability/query-plan checks PASS, scoped secret scan PASS and `git diff --check` PASS.
- Deployment: source only. No Z.com file, Sites version, Supabase value, D1 migration/row, R2 object, DNS or Production runtime changed.
- Rollback: before apply, revert `0f3f182`. After `0020` is applied, keep the additive table/columns or use a reviewed forward migration; never hard-delete image/evidence metadata or R2 originals.

## 2026-08-21 — Truthful operational reports and Audit keyset pagination

- Implementation commit: `3232992`
- Added an authorization-scoped operational report backed only by current D1 Job, Motorcycle, Trip, Container and Yard rows. Customer output is tenant-scoped; internal-only sections require existing permissions, and absent statuses or unimplemented financial definitions are never synthesized.
- Made the report responsive and printable, with the actual render time and a warning to verify source records/Audit before decisions.
- Replaced the Audit latest-200 query with 50-row `(created_at, id)` keyset pages. Additive migration `0019_supreme_imperial_guard` adds only `idx_audit_logs_created_id`; preservation and query-plan tests require existing history to survive and the chronological query to use that index.
- Verification: full tests 153/153 (90 unit + 63 integration), TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, scoped secret scan PASS and `git diff --check` PASS.
- Deployment: source only. No Z.com file, Sites version, Supabase value, D1 migration/row, R2 object, DNS or Production runtime changed.
- Rollback: revert `3232992` before applying `0019`. After apply, retain the harmless index or remove it only through a reviewed forward migration; never delete Audit history.

## 2026-08-21 — Bounded real-data Print Center

- Implementation commit: `28b8c6c`
- Added an internal `documents:read` Print Center with real indexed lookup for Job number, registration, VIN, engine number, Yard code, Truck code, Trip number and Container number. Results open only the QR/document/load surfaces that already have authoritative data.
- All queries reject wildcard/control scans and cap results at 50 plus a sentinel. Query-plan regression coverage caught and repaired an initial VIN/engine table scan by matching the existing partial-index predicates.
- Destination routes repeat server-side authorization; write permissions remain mandatory for QR printing. Invoice and finance reports stay visibly unavailable because no authoritative numbering/money/approval contract exists yet.
- Verification: full tests 150/150 (88 unit + 62 integration), TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, scoped secret scan PASS and `git diff --check` PASS.
- Deployment: source only. No migration, Z.com file, Sites version, Supabase value, D1 row, R2 object, DNS or Production runtime changed.
- Rollback: revert `28b8c6c`; no database or Production rollback is required.

## 2026-08-21 — Opaque operational QR identities and labels

- Implementation commit: `55de6ab`
- Extended the secure QR system from Motorcycle to Job, Yard, Truck and Trip with distinct type prefixes and 128-bit opaque public IDs. Labels never expose sequential primary keys or rely on client-side authorization.
- Added authenticated SVG endpoints, responsive print labels and a unified scanner backed by real database lookups. Customer scope is limited to its own Job/Motorcycle while operational Yard/Truck/Trip records remain internal-only.
- Migration `0018_unknown_blonde_phantom` uses additive/backfill steps for populated Job/Yard tables, canonicalizes pre-Production Truck/Trip IDs and adds unique indexes plus validation/immutability triggers. Preservation, malformed-ID, mutation and index query-plan tests cover every entity type.
- Verification: full tests 147/147 (86 unit + 61 integration), TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, scoped secret scan PASS and `git diff --check` PASS.
- Deployment: source only. No Z.com file, Sites version, Supabase value, D1 migration/row, R2 object, DNS or Production runtime changed. Production activation requires the existing application routing/Auth gates plus reviewed D1 backup, dry-run and one-time migration `0018`.
- Rollback: revert `55de6ab` before applying `0018`. After apply, restore the reviewed D1 backup or use a forward migration; never replace public identities in-place after labels have been issued.

## 2026-08-21 — Atomic motorcycle CSV/XLSX import and reconciliation

- Implementation commit: `c314e6f`
- Added internal permission-gated upload, immutable staging, row-level validation, reconciliation UI and explicit confirmation for 1–500 motorcycles in an active Job. Upload/retry never creates a motorcycle and an exact file cannot be staged twice for one Job.
- Added a bounded UTF-8 CSV and native OOXML XLSX parser with Thai/English headers, ZIP path/entry/declared-size controls, formula rejection, field normalization, required VIN-or-engine identity and duplicate checks against both the file and registry.
- Migration `0017_parallel_spirit` adds append-only import batch/row ledgers and motorcycle variant/year/province/condition/notes using additive columns. It preserves existing records/triggers and advances per-Job sequence counters to at least the existing maximum.
- Confirmation uses the exact tested D1 batch plan. The 500-row test proves contiguous sequence allocation, initial status/Audit creation and successful reconciliation; a late uniqueness race proves full rollback without sequence consumption.
- Verification: full tests 143/143 (84 unit + 59 integration), TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, migration preservation/integrity/rollback checks PASS, scoped secret scan PASS and `git diff --check` PASS.
- Deployment: source only. No Z.com file, Sites version, Supabase value, D1 migration/row, R2 object, DNS or Production runtime changed. Production requires the existing runtime/Auth gates plus D1 backup, dry-run and one-time migration `0017` before any approved real import.
- Rollback: revert `c314e6f` before applying `0017`. After apply, restore the reviewed D1 backup or create a forward migration; never hard-delete import, motorcycle, status-event or Audit history.

## 2026-08-21 — Server-verified quotation anti-abuse

- Implementation commit: `a2873da`
- Added Cloudflare Turnstile to the real quotation form with mandatory Siteverify, exact hostname/action validation, five-second timeout and one UUID-idempotent retry. Missing, expired, replayed, mismatched or unavailable verification fails closed.
- The online form is absent when the public/server key pair is missing or malformed; verified phone contacts remain visible instead. `/api/health` now requires `antiAbuse=true`, and the server-only key is never rendered or stored in source.
- Verification: full tests 133/133 (78 unit + 55 integration), configured/unconfigured SSR PASS, TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, scoped secret scan PASS and `git diff --check` PASS.
- Deployment: source only. Production Turnstile keys, Sites, Supabase, D1, R2, Z.com and DNS were not changed. The Production credentials and untrusted-file policy remain Owner gates.
- Rollback: revert `a2873da`; no database or object-storage rollback is required.

## 2026-08-21 — Private quotation evidence and audited Owner retrieval

- Implementation commit: `af2b397`
- Added bounded PDF/CSV/XLSX/image attachments to the durable quotation flow. Files are signature-validated, SHA-256 checked and stored in private R2; immutable metadata lives in additive migration `0016_numerous_shatterstar`.
- Quotation, attachment metadata and redacted Audit commit in one D1 batch. Failed or concurrency-losing attempts compensating-delete only their own new R2 keys and never display false success.
- Added OWNER-only forced download with no-store/nosniff headers and fail-closed Audit-before-read. Other roles and mismatched IDs receive no attachment disclosure.
- Verification: full tests 130/130 (76 unit + 54 integration), TypeScript PASS, ESLint PASS, Vinext Production build PASS, public SEO/Gallery/mobile/responsive/deployment guards PASS, migration upgrade/index/immutability checks PASS, scoped secret scan PASS and `git diff --check` PASS.
- Deployment: source only. No Z.com file, Sites version, Supabase value, D1 row/migration, R2 object, DNS or Production runtime changed. Production enablement remains gated by application routing, Auth/Owner mapping, D1 backup+migrations through `0016`, R2 readiness and approved public-upload abuse/malware controls.
- Rollback: revert `af2b397` before applying `0016`. After apply, retain attachment/Audit history and use a reviewed forward migration or restore the pre-migration D1 backup; never hard-delete evidence rows.

## 2026-08-21 — Commercial proof and durable quotation intake

- Implementation commit: `c5fbaa5`
- Replaced public Gallery/loading placeholders with nine real Owner-approved company photographs rendered in initial HTML, and reused the same manifest as the Full App public-media fallback.
- Expanded every public service route with unique SEO content, workflow, related real Gallery, FAQ/structured data and conversion CTA. About now documents only photographed yard/fleet/loading capability; Contact provides verified phone/LINE and a fail-closed company-name Maps search without inventing an address.
- Added a real D1 quotation form/API, concurrent-safe request-key idempotency, consent/source invariants, redacted Audit, hard-delete protection and OWNER-only bounded quotation inbox/status workflow in additive migration `0015`.
- Verification: full tests 125/125, TypeScript PASS, ESLint PASS, Production build PASS, responsive/SEO/Gallery/deployment guards PASS, scoped secret scan PASS and `git diff --check` PASS.
- Deployment: no Production, DNS, Supabase, D1 or R2 change was made. Static Z.com release may proceed only after main integration and the existing backup/verify/postcheck flow. The Full App quotation backend remains gated by Cloudflare runtime/Auth/D1/R2/anti-abuse acceptance.
- Remaining Owner input: exact verified Google Maps share link or street address; current public navigation intentionally asks the visitor to confirm the point by phone/LINE.

## 2026-08-21 — Responsive layout and real-photo delivery hardening

- Preserved the current premium baseline while adding fluid max-width containers, responsive type/gutters, 44px mobile controls, overflow protection and accessible collapsible navigation to the public CMS and authenticated app shells.
- Hardened responsive behavior for Home Hero, Services, Gallery/lightbox, Quotation, Contact, Login, dashboards, search/filter forms, QR/Print, Media Library and five dense operational tables. Tables now use bounded, labelled keyboard-focusable scroll regions rather than causing page-wide horizontal overflow.
- Added intrinsic image dimensions and aspect ratios to prevent CLS, correct portrait/landscape crop behavior, lazy loading for non-critical media and responsive `srcset`/`sizes` for the public Gallery.
- Generated 54 JPEG/WebP/AVIF thumbnail/display variants from the nine real Owner-supplied company photographs. The optimizer is idempotent, bounds mobile bytes and keeps factual Alt/caption metadata in the canonical manifest.
- Verification: full tests 117/117 (68 unit + 49 integration), responsive contracts for 320/375/390/768/1024/1366/1440 PASS, public/SEO/deployment guards PASS, Production build PASS, ESLint PASS, optimizer idempotency PASS and `git diff --check` PASS.
- Visual browser evidence is explicitly pending: the bundled browser service failed before connecting because its trusted RPC dependency could not resolve within a configured trusted code path. No screenshot PASS is claimed.
- Remaining visual work: restore the approved browser runtime and capture the seven required viewports. The private evidence derivative gap was later closed in `0f3f182`.
- Deployment: source only. No Push, Z.com pull, Production deploy, Supabase/D1/R2 mutation or DNS change was performed.
- Rollback: revert implementation commit `22a5454`; no Production or data rollback is required.

## 2026-08-21 — Exact confirmed Auth identity mapping

- Removed the unused `pending:` email-based identity fallback and its unaudited `external_auth_id` rewrite from protected request resolution.
- Application access now requires an email-confirmed Supabase identity with a valid UUID that exactly matches the existing D1 user mapping; email matching alone never grants a role or company scope.
- Added pure identity validation tests covering normalization, unconfirmed accounts, legacy pending identifiers, malformed UUIDs and missing email.
- Verification: full tests 117/117 (68 unit + 49 integration), Vinext Production build PASS, ESLint PASS and `git diff --check` PASS.
- Deployment: source only. Supabase users, D1 data, R2, Sites, Z.com, DNS and Production were not changed.
- Rollback: revert this commit. No data migration or Production rollback is required.

## 2026-08-21 — Trusted Production Auth origin and truthful runtime readiness

- Centralized the allowed application-origin contract and removed request-Host trust from password recovery, invitations, callback redirects and mutation checks. Production now fails closed without the exact canonical origin.
- Added strict Supabase public/admin configuration validation without exposing values, including rejection of placeholders, malformed URLs and public/secret key confusion.
- Upgraded `/api/health` from presence checks to five real gates: public Auth, admin Auth, canonical origin, representative D1 tables/indexes/invariant triggers through `0014`, and a read-only R2 metadata probe.
- Added regression tests for Host spoofing, missing Production origin, callback origin selection, key validation and incomplete database objects.
- Verification: full tests 115/115 (66 unit + 49 integration), Vinext Production build PASS, ESLint PASS and no secret value added to source.
- Deployment: source only. Z.com public files, protected Sites runtime, Supabase, D1, R2, DNS and Production were not changed.
- Rollback: revert this commit. No database row, Storage object, Auth identity or Production file requires rollback.

## 2026-08-21 — Bounded Company, Job and Driver directories

- Replaced unbounded Company/Job reads and the 200-user Driver preload with 50-record pages and safe indexed prefix search over Company code/name and active Driver name/email.
- Added stable cursor pagination for Jobs and Companies, bounded option lists, explicit truncation states and server-side validation that rejects wildcard/control-character scans.
- Added migration `0014_past_sphinx` with seven query-backed indexes. The migration is additive and does not rewrite Company, Job or User records.
- Verification: full tests 110/110, migration-preservation and query-plan checks PASS, Vinext production build PASS, ESLint PASS, public SEO/deployment guards PASS.
- Deployment: source only. Migration `0014` and Dynamic App routes were not deployed; Z.com remains the public static component only.
- Rollback: revert this commit before applying `0014`. After apply, keep the indexes or remove them only in a reviewed forward migration; no business row rollback is required.

## 2026-08-21 — Revisioned global Site Settings

- Added a single authenticated settings surface for brand/legal name, abbreviation, tagline, optional published Gallery logo, verified phones, bounded public navigation, Login label and Footer.
- Added migration `0013_wakeful_moon_knight` with immutable SHA-256 settings revisions, append-only publication events, request-key uniqueness, foreign keys, bounded lookup indexes and no-hard-delete/no-rewrite triggers.
- Save and publish require same-origin authenticated `site:write`/`site:publish`, are idempotent under retry and commit a redacted Audit record in the same D1 batch.
- Public rendering fails safely to verified defaults, rejects unsafe/private navigation destinations and falls back to the brand abbreviation when the configured logo is unavailable or no longer public.
- Added responsive Header/Footer preview and reused one secure browser request-ID helper without weakening the cryptographic fallback.
- Verification: full tests 106/106, parser/JSON-LD security/migration/index/append-only checks PASS, Vinext production build PASS, ESLint PASS, public SEO/deployment guards PASS, secret scan PASS and diff check PASS.
- Deployment: source only. Migration `0013`, Auth, D1/R2 and dynamic settings were not deployed; the Z.com public website remains unaffected.
- Rollback: revert this commit before applying `0013`. After apply, restore the reviewed D1 backup or use a forward migration; never delete revision/publication/Audit history.

## 2026-08-21 — Full textual public-page CMS coverage

- Expanded the allowlisted Site Content CMS from four pages to all ten textual public pages: Home, Services, five service-detail pages, Quotation, About and Contact.
- Added real fail-safe public routes for motorcycle transport, international transport, storage, Container loading, Dealer/Fleet and Quotation. Defaults use only verified services and phone numbers; no price, capacity, location, timing or performance claim was invented.
- Centralized canonical metadata for managed pages, with INDEX/FOLLOW, canonical URL and Open Graph identity on every public textual route.
- Kept Gallery as a separate Media Library and linked it from the Site Content dashboard, preserving category, Alt text, ordering, featured, visibility, responsive media and audit behavior.
- Verification: CMS unit tests PASS, all ten defaults validate, all six new routes render without D1, canonical/robots checks PASS, Vinext production build PASS and ESLint PASS.
- Deployment: source only. The Z.com static website remains unchanged; dynamic CMS routes still require the approved Auth, D1 migrations `0012`–`0013`, R2 and application-routing gates.
- Rollback: revert this commit. No migration, Production data, public website file or media artifact is changed by this slice.

## 2026-08-21 — Responsive Owner media sizing

- Reduced the homepage brand artwork and LINE QR footprint so they support the content instead of dominating it on mobile or desktop.
- Added deterministic landscape/portrait/square Gallery orientation handling from real manifest dimensions. Portrait and square work photographs now remain fully visible in bounded cards instead of being aggressively cropped.
- Kept the original and responsive media files unchanged; this is a presentation-only repair with no CMS, Auth, database or Storage contract change.

## 2026-08-21 — Owner brand artwork, LINE QR and expanded real-work Gallery

- Added the Owner-supplied NATHEE GROUP 2025 artwork as the site-wide brand mark, homepage hero artwork and canonical social preview image.
- Added seven more real operational photographs to the public Gallery, bringing the factual public release manifest to nine items across storage, large-batch, Dealer/Fleet, 4-wheel, 6-wheel and Container work.
- Added the exact Owner-supplied LINE QR to the Contact page without inventing a LINE ID or external URL. Its SHA-256 is guarded in both local and Production postchecks.
- Generated separate responsive JPEG/WebP display and thumbnail variants; the original QR is preserved byte-for-byte.
- Deployment: source only until the guarded Z.com pull, verify, backup, deploy and live postcheck pass. The authenticated CMS/Media Library remains source-only pending Production Auth, D1 and R2 gates.
- Rollback: restore the timestamped public-site backup or revert this commit; no application database or private customer evidence is changed.

## 2026-08-21 — Structured Site Content CMS and bounded Gallery batch upload

- Added migration `0012` with stable page identities, immutable SHA-256 revisions, append-only publish/hide events, same-page publication enforcement, no-hard-delete triggers and explicit Site Content permissions.
- Added authenticated admin pages to edit, reorder, preview and publish structured Home, Services, About and Contact sections. Rollback republishes an older revision without rewriting history.
- Added public CMS rendering that accepts no raw HTML, limits links to safe local/tel destinations and displays only real `PUBLIC` + `PUBLISHED` Gallery media.
- Added sequential bounded Gallery batches of up to 20 images with per-image title/Alt text, WebP/optional AVIF variants, visible progress, cancellation and retry without fake success.
- Verification: TypeScript PASS, ESLint PASS, Vinext production build PASS, CMS unit tests PASS and complete D1 migration/invariant tests PASS.
- Deployment: source only; migration `0012`, dynamic CMS and managed Gallery were not deployed. The current Z.com static website remains available and unchanged by this slice.
- Rollback: before Production apply, revert the implementation commit. After apply, restore the D1 backup or use a reviewed forward migration; never delete revision, publication or Gallery history.

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
