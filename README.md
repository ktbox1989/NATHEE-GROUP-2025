# NATHEE GROUP 2025 Logistics Platform

Responsive public website and motorcycle-logistics operations platform for desktop, tablet, and mobile.

## Current milestone

- Public-site visual baseline migrated from the original prototype.
- Email/password login, logout, recovery, and password-update flows use managed Supabase Auth with server-managed cookies.
- OWNER plus ADMIN, STAFF, SALE, WAREHOUSE, CHECKER, DRIVER and ACCOUNTING roles use server-enforced capabilities; CUSTOMER_ADMIN and CUSTOMER_VIEWER are company-bound on every read.
- Customer companies, transport jobs, motorcycles, private images, status timeline, member invitations, and audit log are implemented as the first vertical slice.
- Opaque Vehicle, Job, Yard, Truck and Trip QR lookup, mobile camera scanning, and permission-gated label printing are implemented without placing VIN, registration, route or customer data in the QR payload. Customer access remains company-scoped; Yard/Truck/Trip identities are internal-only.
- Yard operations include real zones, capacity-aware placement, current-location lookup, append-only movement history, optimistic stale-write protection, and audit records.
- Public Website source now has 11 clean, SEO-specific routes. Its Gallery consumes a versioned, privacy-checked release manifest with nine Owner-supplied company-work photographs and never substitutes stock imagery for real work. Owner-supplied brand artwork and the exact LINE QR are checksum-guarded release assets.
- A permission-gated Gallery/Media Library vertical slice is implemented for the authenticated platform with Draft/Published/Hidden/Archived states, categories, ordering, Featured selection, responsive WebP/AVIF variants, R2 checksums, audit records and customer-job isolation. Batch uploads require an explicit JSON acknowledgement, retain one secure idempotency key per image across retry and never interpret followed error HTML as success. Image dimensions are derived from stored bytes and checked against responsive client claims; R2 keys are registered before ambiguous writes so failure cleanup remains possible. Its migrations remain gated until the Production Auth/D1 preflight is approved.
- A structured Site Content CMS is implemented for all ten textual public pages: Home, Services, five service-detail pages, Quotation, About and Contact. A separate audited global-settings editor controls the shared brand, optional public Gallery logo, phone numbers, bounded public navigation and Footer from one revisioned source. The Gallery admin keeps the media-specific category, Alt text, ordering, featured and bounded 20-image sequential batch workflow. Company, Job and Driver directories use bounded indexed search rather than loading every record. The real quotation flow accepts bounded PDF/CSV/XLSX/image evidence into private R2 with immutable D1 checksum metadata and Owner-only audited download. Private motorcycle evidence retains the original plus bounded Display/Thumbnail derivatives for authorized mobile delivery. New POD records require private recipient-signature evidence before `DELIVERED`. Every heavy multipart route rejects a missing/invalid request length, unsupported media boundary and payload beyond its endpoint budget before parsing. Cloudflare Turnstile is verified server-side against the exact action and hostname; the form stays visibly unavailable if either key is missing or invalid. These features are source/build complete but not Production-live until Auth, D1 migrations through `0024`, R2, Turnstile credentials/untrusted-file policy and application routing pass their gates.
- Internal staff with explicit motorcycle-write permission can stage, validate, reconcile and transactionally confirm 1–500 motorcycle records from UTF-8 CSV or bounded native XLSX. The importer rejects formulas and malformed/oversized ZIPs, marks duplicates without skipping rows, retains an immutable batch/row ledger and rolls back the complete D1 batch on a late uniqueness race. Migration `0017` and the dynamic application remain Production-gated.
- Dashboard values are calculated from D1. Empty states are shown instead of fake statistics.
- Authentication callbacks and sensitive redirects use a trusted `APP_ORIGIN`, never the request Host. Production readiness is fail-closed until public/admin Supabase configuration, the canonical origin, required D1 objects through migration `0016`, and a read-only R2 probe all pass.
- Protected access requires an email-confirmed Supabase UUID that exactly matches the stored application identity; the server never promotes or re-links a user merely because an email address matches.
- Structured data uses D1 (`DB`); private motorcycle images use R2 (`FILES`).
- The same responsive application shell supports desktop, tablet, and mobile field work.

See [the audit and migration plan](./docs/AUDIT_AND_MIGRATION_PLAN.md) for evidence from the source HTML and the implementation roadmap.
See [authentication activation](./docs/AUTH_SETUP.md) before creating the first real account.
See [Gallery and Media Library boundaries](./docs/GALLERY_MEDIA_LIBRARY.md) before adding real photographs or applying Gallery migrations.
Complete [the production go-live checklist](./docs/PRODUCTION_GO_LIVE.md) before opening the hosted system to staff or customers.
See [the Production deployment architecture](./docs/DEPLOYMENT_ARCHITECTURE.md) for the evidence-backed boundary between the live Z.com public site and the not-yet-deployed application runtime.
See [the Production quotation boundary](./docs/QUOTATION_BACKEND.md) before enabling the online form or applying migration `0015`.
See [the Motorcycle Bulk Import contract](./docs/MOTORCYCLE_BULK_IMPORT.md) before applying migration `0017` or importing real fleet data.
See [the signed Proof of Delivery contract](./docs/POD_SIGNATURES.md) before applying migration `0021` or accepting a real delivery.

See [the Operational QR contract](./docs/OPERATIONAL_QR.md) before applying migration `0018` or printing Job/Yard/Truck/Trip labels.

The authenticated [Print Center](./docs/PRINT_CENTER.md) provides bounded,
index-backed lookup for real Job, Motorcycle, Yard, Truck, Trip and Container
records. It links only to print/document surfaces whose Backend data already
exists and explicitly does not fabricate Invoice or finance reports.

The [operational report and Audit contract](./docs/OPERATIONAL_REPORTS.md)
aggregates only authorized real records and uses keyset pagination for the
append-only Audit ledger. Migration `0019` adds its chronological index.

## Repository layout

- `public-site/` — verified static company website for the current Z.com hosting.
- `app/`, `components/`, `lib/` — authenticated logistics application UI and server logic.
- `db/`, `drizzle/` — D1 schema and forward-only migrations.
- `worker/` — Cloudflare runtime entry points.
- `scripts/` — public-site verification, guarded Z.com deployment, postcheck, and rollback.
- `docs/` — architecture, activation, deployment, and operational runbooks.

## Commands

```bash
npm run dev
npm run build
npm run lint
npm run test:public
npm run test:unit
npm run test:db
npm test
npm run db:generate
```

Node.js 22.13 or newer is required.

## Data boundaries

- OWNER can access all company records.
- Every non-owner internal role receives explicit capabilities; its role name alone does not grant an action.
- CUSTOMER_ADMIN and CUSTOMER_VIEWER require a mapped company and are currently restricted to read-only records belonging to that company.
- Permissions are enforced in server code. Client-side menus are presentation only.
- Operational records are cancelled or archived rather than silently deleted, and material changes must produce audit entries.
- Business writes and their audit entries are committed together. Status changes also use an optimistic current-status check to prevent concurrent devices from skipping the workflow.

## Storage

- Structured records: D1 (`DB`).
- Images and documents: R2 (`FILES`).
- Browser storage is limited to non-authoritative UI preferences and must not be used as the source of truth for business records.

## In-app notifications

- Notifications are derived from committed motorcycle status events; the UI does not create fake alerts.
- Customers receive only same-company events. Internal recipients require OWNER or explicit `status:read` and the event actor is not notified about their own change.
- Inbox and unread counts are server-side, recipient-scoped and indexed; read operations cannot target another user's notification.
- LINE and email delivery are not enabled until provider credentials, consent, retry and escalation policy are approved.

## Truck and trip operations

- Truck and trip creation uses unique request keys so a repeated browser submission cannot create duplicates.
- Trip numbers use the transaction-safe sequence counter; unused numbers are not recycled after a failed transaction.
- Planning input is interpreted in Asia/Bangkok and stored as UTC ISO timestamps.
- Only active DRIVER identities can be assigned, and only active trucks can start a trip assignment; API and database triggers both enforce this boundary.
- A motorcycle can have only one active trip assignment. Assignment requires the real motorcycle to be SCHEDULED and never changes its operational status implicitly.
- The Load Board coordinates assignment with the audited motorcycle timeline: LOADING/LOADED, IN_TRANSIT, ARRIVED/UNLOADED and DELIVERED/CLOSED readiness must agree before the trip can advance.
- Confirmed truck capacity is enforced in D1; an unconfirmed capacity remains visibly marked and uses a 1,000-record hard safety ceiling rather than an unbounded list.
- Load history is retained after cancellation or completion, rendered in bounded pages and cannot be hard-deleted.
- Fleet/eligible-motorcycle discovery uses validated prefix input, field-specific indexed queries and bounded server merging; trip status filtering preserves keyset pagination.
- Authorized internal users see the active trip context on motorcycle detail, while customer roles never receive the internal trip link/query.

## Container operations

- The local Container Registry accepts only ISO 6346 numbers whose owner/category format and check digit are valid.
- It stores Seal, 20FT/40FT/40HC type, optional confirmed capacity, port and country through an idempotent audited D1 write.
- The Container Load Manifest prevents a motorcycle from being active in a trip and container simultaneously, enforces company/capacity limits and coordinates load/unload confirmation with the audited motorcycle status.
- DRAFT→PLANNED→LOADING→SEALED→IN_TRANSIT→ARRIVED→UNLOADING→COMPLETED is guarded in D1. A real Seal and every assigned motorcycle must be ready before a transition can commit.
- Container records, assignments and events are retained; database triggers reject hard deletion and unguarded lifecycle changes.

## Inspection, damage and Proof of Delivery

- Receipt, pre-load and delivery inspections are append-only and allowed only in compatible motorcycle states.
- ISSUE/DAMAGE inspections retain notes and normalized findings; evidence can reference only same-motorcycle private images categorized as `DAMAGE`.
- `INSPECTED` requires a passed receipt inspection. `DELIVERED` requires an active POD with same-motorcycle `DELIVERY` evidence; every POD created after migration `0021` also requires its private recipient signature.
- Incorrect POD can be voided with reason before delivery and replaced without deleting the old record. Recipient phone output is masked; legacy unsigned PODs remain labelled as legacy rather than being rewritten.
- The authorized motorcycle Document & Print Center renders the operational record for printing or browser PDF without inventing data.

## Z.com public website

The cPanel-hosted public website is intentionally separate from the authenticated logistics application. Deploy it only from the reviewed staging clone at `/home/zptqqwps/nathee-deploy`; the deploy script creates a complete backup, verifies checksums, preserves unknown Production files, runs live checks, and restores the backup automatically on failure.

`DEPLOY_PASS` from the Z.com script means only that the public static website was deployed. It is not evidence that Login, `/app`, `/api`, D1, R2, QR, Gallery management or notifications are running.

A protected owner-only Sites Version 4 artifact exists, but it has no Supabase
runtime environment and only the base D1 tables. It is not the accepted NATHEE
Production application; see the deployment architecture for the evidence and
remaining gates.

See [the Z.com deployment runbook](./docs/ZCOM_DEPLOYMENT.md). Do not copy application source, credentials, databases, or private uploads into `public_html`.
