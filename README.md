# NATHEE GROUP 2025 Logistics Platform

Responsive public website and motorcycle-logistics operations platform for desktop, tablet, and mobile.

## Current milestone

- Public-site visual baseline migrated from the original prototype.
- Email/password login, logout, recovery, and password-update flows use managed Supabase Auth with server-managed cookies.
- OWNER, capability-based STAFF, and company-bound CUSTOMER permissions are enforced on the server.
- Customer companies, transport jobs, motorcycles, private images, status timeline, member invitations, and audit log are implemented as the first vertical slice.
- Opaque motorcycle QR lookup, mobile camera scanning, and permission-gated single/bounded-batch label printing are implemented without placing VIN, registration, or customer data in the QR payload.
- Yard operations include real zones, capacity-aware placement, current-location lookup, append-only movement history, optimistic stale-write protection, and audit records.
- Public Website source now has 11 clean, SEO-specific routes. Its Gallery consumes a versioned, privacy-checked release manifest and never substitutes stock imagery for real company work.
- A permission-gated Gallery/Media Library vertical slice is implemented for the authenticated platform with Draft/Published/Hidden/Archived states, categories, ordering, Featured selection, responsive WebP/AVIF variants, R2 checksums, audit records and customer-job isolation. Its migrations remain gated until the Production Auth/D1 preflight is approved.
- Dashboard values are calculated from D1. Empty states are shown instead of fake statistics.
- Structured data uses D1 (`DB`); private motorcycle images use R2 (`FILES`).
- The same responsive application shell supports desktop, tablet, and mobile field work.

See [the audit and migration plan](./docs/AUDIT_AND_MIGRATION_PLAN.md) for evidence from the source HTML and the implementation roadmap.
See [authentication activation](./docs/AUTH_SETUP.md) before creating the first real account.
See [Gallery and Media Library boundaries](./docs/GALLERY_MEDIA_LIBRARY.md) before adding real photographs or applying Gallery migrations.
Complete [the production go-live checklist](./docs/PRODUCTION_GO_LIVE.md) before opening the hosted system to staff or customers.
See [the Production deployment architecture](./docs/DEPLOYMENT_ARCHITECTURE.md) for the evidence-backed boundary between the live Z.com public site and the not-yet-deployed application runtime.

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
- STAFF receives explicit capabilities; the role does not grant every action automatically.
- CUSTOMER access requires a mapped company and is restricted to read-only records belonging to that company.
- Permissions are enforced in server code. Client-side menus are presentation only.
- Operational records are cancelled or archived rather than silently deleted, and material changes must produce audit entries.
- Business writes and their audit entries are committed together. Status changes also use an optimistic current-status check to prevent concurrent devices from skipping the workflow.

## Storage

- Structured records: D1 (`DB`).
- Images and documents: R2 (`FILES`).
- Browser storage is limited to non-authoritative UI preferences and must not be used as the source of truth for business records.

## Z.com public website

The cPanel-hosted public website is intentionally separate from the authenticated logistics application. Deploy it only from the reviewed staging clone at `/home/zptqqwps/nathee-deploy`; the deploy script creates a complete backup, verifies checksums, preserves unknown Production files, runs live checks, and restores the backup automatically on failure.

`DEPLOY_PASS` from the Z.com script means only that the public static website was deployed. It is not evidence that Login, `/app`, `/api`, D1, R2, QR, Gallery management or notifications are running.

See [the Z.com deployment runbook](./docs/ZCOM_DEPLOYMENT.md). Do not copy application source, credentials, databases, or private uploads into `public_html`.
