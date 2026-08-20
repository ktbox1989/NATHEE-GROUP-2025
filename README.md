# NATHEE GROUP 2025 Logistics Platform

Responsive public website and motorcycle-logistics operations platform for desktop, tablet, and mobile.

## Current milestone

- Public-site visual baseline migrated from the original prototype.
- Email/password login, logout, recovery, and password-update flows use managed Supabase Auth with server-managed cookies.
- OWNER, capability-based STAFF, and company-bound CUSTOMER permissions are enforced on the server.
- Customer companies, transport jobs, motorcycles, private images, status timeline, member invitations, and audit log are implemented as the first vertical slice.
- Dashboard values are calculated from D1. Empty states are shown instead of fake statistics.
- Structured data uses D1 (`DB`); private motorcycle images use R2 (`FILES`).
- The same responsive application shell supports desktop, tablet, and mobile field work.

See [the audit and migration plan](./docs/AUDIT_AND_MIGRATION_PLAN.md) for evidence from the source HTML and the implementation roadmap.
See [authentication activation](./docs/AUTH_SETUP.md) before creating the first real account.
Complete [the production go-live checklist](./docs/PRODUCTION_GO_LIVE.md) before opening the hosted system to staff or customers.

## Commands

```bash
npm run dev
npm run build
npm run lint
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
