# NATHEE GROUP 2025 — Prototype Audit and Migration Plan

Date: 2026-08-20

## Scope and source integrity

The audit used the two original HTML files found on the workstation:

- `C:\Users\gmkai\Downloads\nathee-system-step1-login.html`
- `C:\Users\gmkai\Downloads\nathee-group-premium.html`

Matching copies under `C:\Users\gmkai\Desktop\wng` have identical SHA-256 hashes, so either location represents the same baseline. The originals are not modified by this project.

| File | Lines | Size | SHA-256 |
| --- | ---: | ---: | --- |
| `nathee-system-step1-login.html` | 323 | 21,694 bytes | `536A0C1539602C3200EB69E0076327E6706863C4379409583AE916BF63EEAA10` |
| `nathee-group-premium.html` | 864 | 58,094 bytes | `BDC38033EA819D5DBCC1BCA9266AB8376B6A757E9CE10863B87D9BF869FBCB86` |

## What exists today

### Shared visual baseline

- A consistent dark navy/violet visual system with glass panels, gradient accents, rounded cards, and Thai typography.
- Google Fonts: Prompt, Anuphan, and IBM Plex Mono.
- Responsive CSS already exists. The system prototype adapts at 900 px and 760 px; the public site contains breakpoints from 980 px down to 520 px.
- Reduced-motion support is present.
- The present UI direction is suitable for reuse. The migration should preserve its colors, spacing character, card treatment, and role-specific navigation unless a usability defect requires a focused change.

### `nathee-system-step1-login.html`

- Login view and responsive application shell.
- OWNER, internal operational roles, and company-bound customer-role navigation definitions.
- Role-specific dashboard layouts.
- Menu placeholders for customers, quotations, transport jobs, motorcycles, yard, users, reports, and audit log.

### `nathee-group-premium.html`

- Public company site with hero, services, statistics, gallery, about, quotation request, and contact areas.
- Browser-side admin edit mode for copy, services, statistics, contact details, and gallery images.
- Browser-side quotation request list.
- Responsive layout and modal/toast interactions.

## Evidence that it is still a prototype

### Authentication and authorization

- Demo accounts and plain-text passwords are embedded in the system HTML at lines 169–173.
- Login is a client-side array lookup at lines 229–249. There is no server session, password hashing, rate limiting, lockout, recovery flow, or MFA.
- Role menus are selected in the browser. There is no server authorization and no trustworthy company boundary.
- The public site admin password defaults to `nathee2025` at line 651 and is compared in browser JavaScript at lines 653–662.

### Persistence and APIs

- Both files contain one inline `<style>` block and one inline `<script>` block; neither file calls a backend API (`fetch` call count is zero).
- The public-site store at lines 470–483 uses `window.storage` when available and otherwise falls back to an in-memory object. It is not durable production storage.
- Uploaded gallery images are converted to base64 in a canvas at lines 759–770 and stored with page data. There is no object storage, malware/content validation, ownership metadata, or backup.
- Quotation numbers are generated from the browser array length and a hardcoded year (`QT-2026-...`) at line 806. Concurrent users can create duplicates and different browsers will not share the same records.

### Demo and placeholder information

- Role dashboards are explicitly marked as sample data at line 281 and render fixed KPI values.
- Public statistics include `10+`, `1,000+`, and `10,000+` at lines 509–511 without verified source data.
- Contact details include `02-000-0000` and `@natheegroup` at lines 525–527 and in the rendered page.
- The default activity ticker contains fictional job, vehicle, trip, container, and quotation identifiers.
- Customer `ABC MOTOR`, company code `CUS-000123`, and all dashboard counts are demo records.

### Functional gaps

- No database, backend routes, audit trail, real-time update path, or backup strategy.
- No company CRUD, transport-job records, motorcycle records, durable images, or status-event timeline.
- No server-side tenant isolation for customer companies.
- No customer portal backed by real records.
- No validated HTML form submission; the current controls rely on inline click handlers.
- No QR generation/scanning, batch printing, notification delivery, yard, trip, POD, or container workflows.

## Target product structure

The public website and operations system stay visually related but are separated by responsibility:

| Surface | Purpose | Access |
| --- | --- | --- |
| `/` | Public company website and quotation request | Public |
| `/login` | Production sign-in entry | Public |
| `/app` | NATHEE owner/staff operations dashboard | OWNER / STAFF |
| `/app/companies` | Customer-company management | OWNER; limited STAFF if granted |
| `/app/jobs` | Transport job management | OWNER / permitted STAFF |
| `/app/motorcycles` | Motorcycle registry, search, images, status | OWNER / permitted STAFF |
| `/portal` | Customer dashboard and tracking | CUSTOMER, restricted to own company |

The frontend must never be the authority for permissions. Every protected page, query, mutation, download, and image request must be checked on the server.

## Phase 1 data model

### Core tables

1. `companies`
   - customer code, legal/display name, tax ID, contact details, status, timestamps
2. `users`
   - external authentication ID, email/username, display name, role, optional company ID, status, timestamps
3. `transport_jobs`
   - job number, company ID, origin, destination, dates, status, counts, notes, timestamps
4. `motorcycles`
   - public opaque ID, job ID, company ID, sequence, make, model, color, registration, VIN, engine number, current status, timestamps
5. `motorcycle_images`
   - motorcycle ID, object-storage key, category/angle, content type, size, uploader, timestamps
6. `status_events`
   - motorcycle ID, previous/new status, actor, note, timestamp; append-only history
7. `audit_logs`
   - actor, action, entity type/ID, before/after summary, timestamp
8. `quote_requests`
   - server-generated request number, customer/contact details, route, quantity, state, timestamps

Images and future documents belong in object storage; the database stores only searchable ownership and file metadata.

### Tenant isolation rules

- OWNER can access all companies and records.
- ADMIN, STAFF, SALE, WAREHOUSE, CHECKER, DRIVER and ACCOUNTING receive explicit capabilities; role alone must not silently grant destructive actions.
- CUSTOMER must have a `company_id` and may read only records whose `company_id` matches the server-side user mapping.
- Client-provided `company_id`, role, record owner, and status transition are never trusted.
- Accepted operational records are archived/cancelled instead of physically deleted; material changes create audit entries.

### Initial status flow

`PENDING_RECEIPT → RECEIVED → INSPECTED → IN_YARD → SCHEDULED → LOADED → IN_TRANSIT → ARRIVED → DELIVERED → CLOSED`

Exception states such as `ISSUE`, `DAMAGED`, `WAITING_DOCUMENTS`, and `CANCELLED` require explicit permissions and an audit reason.

## Delivery plan

### Milestone 0 — Baseline migration

- Move the visual tokens and reusable layout into maintainable components.
- Keep the public website and application shell recognizable as the current design.
- Remove demo credentials, sample account chips, fictional activity ticker, fake KPI values, and unverified public statistics from production rendering.
- Replace browser-side CMS/admin editing with a protected server-backed path or omit editing until it is secured.

### Milestone 1 — Authentication, roles, and company boundary

- Connect a production identity provider.
- Map authenticated identities to canonical `user_role_assignments`; legacy CUSTOMER maps to CUSTOMER_VIEWER until Owner explicitly promotes it.
- Add server-side route and action guards.
- Implement company creation/editing and customer-user assignment.
- Test the full role/company authorization matrix.

### Milestone 2 — Jobs and motorcycles

- Create transport jobs and server-generated job numbers.
- Add motorcycles individually and in a bounded bulk workflow.
- Validate VIN/engine/registration data and prevent duplicates according to agreed business rules.
- Add indexed search and job progress counts derived from data.

### Milestone 3 — Images and status timeline

- Upload motorcycle images directly to object storage through authorized endpoints.
- Store file metadata and ownership in the database.
- Enforce allowed status transitions and append status events.
- Show the latest status and immutable timeline on desktop and mobile.

### Milestone 4 — Customer portal

- Show only the signed-in customer's company jobs, motorcycles, images, progress, and timeline.
- Add secure file/image delivery and empty/error states.
- Validate cross-company access attempts at the API and page levels.

### Phase 2 — Required operational expansion

- Opaque motorcycle, job, yard-zone, truck, and trip QR codes.
- Mobile camera scanning and one-handed field workflows.
- Single and batch label/PDF printing.
- Yard location, trip, container, inspection, POD, and document management.
- In-app notifications first, then LINE/email through dedicated delivery providers.

## Test and acceptance strategy

- Unit tests: permission matrix, status-transition rules, ID/number generation, validation.
- Integration tests: company filtering, unauthorized mutation rejection, image ownership, audit creation.
- End-to-end tests: owner creates company/job/motorcycles; staff updates status and uploads images; customer sees only its own data.
- Responsive checks: desktop operations view; mobile login, search, status update, camera/upload preparation; tablet layout.
- Security checks: no credential or secret in browser bundles; no cross-company reads; server-side validation on every write; protected object access.
- Production data check: no fake KPI/stat/contact values are displayed. Empty states are preferable until verified data exists.

## Current implementation status

The agreed identity route is managed email/password through Supabase Auth. Login, logout, recovery, password update, secure cookie refresh, owner invitations, and mapping authenticated identities to server-side roles are implemented. Activation now requires the NATHEE-owned Project URL, publishable key, secret server key, and first-owner bootstrap described in `AUTH_SETUP.md`.

Milestones 1–4 now have a working vertical slice: company records, transport jobs, motorcycle records, private R2 images, guarded status transitions, immutable timeline, role-specific responsive navigation, customer company isolation, and audit entries.

The Phase 2 QR slice is implemented through migration `0018`. Motorcycle, Job, Yard, Truck and Trip each use a unique namespaced opaque `public_id`; the camera scanner and manual lookup resolve tokens only after server-side company/role authorization. OWNER/permitted STAFF can print entity labels plus a keyset-paginated vehicle batch of at most 48 labels. QR image delivery is authenticated and fails closed without exposing tenant existence. The scanner is read-only; operational status/location changes continue through the existing event and Audit transactions.

Yard management adds real zones and capacity, one active placement per motorcycle, append-only placement history, explicit yard read/write capabilities, idempotency keys, stale-write protection, and audit events for entry, movement, and exit. The current-yard list uses bounded keyset pagination.

The first notification slice is implemented locally. A real motorcycle status event creates recipient-scoped, idempotent in-app notifications in the same atomic mutation. Customer recipients are limited to their company; internal recipients require OWNER or explicit `status:read`; and the event actor is excluded. Inbox/read APIs are bounded and recipient-filtered. External LINE/email delivery, provider retries and consent policy remain pending, as does bulk import.

Truck and trip foundation is now implemented locally. Trucks have unique operational identity, optional confirmed motorcycle capacity and non-destructive status. Trips use unique request keys and TRIP numbers, optional active DRIVER assignment, timezone-aware schedules, guarded status transitions, immutable status events and Audit. Database triggers reject inactive truck/invalid-driver assignment even outside the API.

The trip/motorcycle load slice is implemented locally through additive migration `0008`. It records immutable assignment identity, prevents a motorcycle from being active on two trips, enforces company/capacity boundaries, and coordinates assignment state with both trip state and the existing audited motorcycle status. The trip flow never fabricates or silently advances motorcycle status. Cancellation and completion release the active assignment in the same D1 batch while retaining history.

Container Load Manifest is implemented locally through migrations `0009`–`0010`. It validates ISO 6346 identity, enforces trip/container exclusivity, capacity, Seal and load/unload readiness, and retains Container/assignment/status history without hard delete.

Inspection, damage, POD and per-motorcycle print/PDF records are implemented locally through migration `0011`. Database triggers require a passed receipt inspection before `INSPECTED` and an active same-motorcycle DELIVERY-evidence POD before `DELIVERED`. Bounded CSV/XLSX motorcycle staging, zero-error reconciliation and atomic confirmation are implemented locally through migration `0017`; operational QR identity backfill/guards are implemented in `0018`; real operational summaries plus bounded Audit keyset pagination are implemented through `0019`; immutable private evidence Display/Thumbnail metadata and upload idempotency are implemented through `0020`; private immutable recipient signatures for every new POD are implemented through `0021`; external provider notifications remain pending. These migrations remain unapplied in Production.

## The seed artefact

`node scripts/build-cms-seed.mjs` turns the live static release into a CMS seed
in Lane B's canonical schema, and writes it to `docs/cms-seed.json` with
`--write`.

It reads `public-site/` and writes one file. It touches no database, contacts no
network, and does not claim a migration happened. Importing the artefact is a
separate, reviewed act on Lane B's side.

### What it produces

| | Count |
| --- | --- |
| Pages, as `CmsPageContent` | 10 |
| Gallery items | 9 |
| Gallery categories in use | 7 |
| Site settings | 1 |
| Posts | 0 |

Ten pages rather than eleven: `/gallery/` is a media collection, not authored
copy, and it seeds as the gallery rather than as a page. Seven categories rather
than the manifest's ten, because only seven have a published photograph and a
filter leading to an empty grid is worse than no filter.

Posts is an empty list. Editorial content does not exist yet, and inventing a
launch announcement would put words on the public site that nobody wrote.

### Two gates, not one

Every page is checked by **Lane B's own parser** — `parseCmsPageContent` is the
authority on what the CMS would accept, so it is what the generator calls rather
than a reimplementation of its rules here. Site settings go through
`parseSiteSettings` for the same reason.

Then the stronger claim: each seeded page is mapped **back** through
`mapCmsPageToPublicPage` and re-validated against the consumer contract. Without
that round trip the seed could be perfectly valid input that renders nothing.
All ten pages round-trip today.

### Determinism is a requirement

The same tree produces byte-identical output. No timestamp, no randomness, no
iteration over unordered structures, and the page keys are sorted.

This is what makes the artefact reviewable. A seed that differed between runs
could not be read as a diff — nobody could tell an intended content change from
a generator artefact, and the review before an import would prove nothing.
`scripts/test-cms-seed-negative.mjs` asserts it directly by generating twice and
comparing bytes.

### What it refuses

`--check` runs in the suite and fails if the committed artefact no longer
matches the static release, so the seed cannot quietly go stale while the site
moves on. The negative gate breaks the release ten ways — a missing h1, a title
or description too short for the CMS, a photograph with no alt text or no real
dimensions, a photograph served from an authenticated path, an unknown manifest
version, a stale artefact, a deleted one — and requires the generator to refuse
each before anything is written.

A photograph reference that does not correspond to a gallery item produces **no**
reference rather than a made-up one: an import pointing at nothing would render
a section with a missing image and no explanation of why.
