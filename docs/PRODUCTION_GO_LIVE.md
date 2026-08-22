# NATHEE production go-live checklist

This checklist is intentionally fail-closed. A successful source build does not
mean that authentication and protected operations are ready in the hosted
runtime.

## 1. Platform resources

- D1 binding `DB` exists and migrations `drizzle/0000` through `0021` have
  each been applied exactly once in order. Verify the migration ledger before
  applying any missing file; never rerun the full chain blindly.
- R2 binding `FILES` exists and is private.
- The deployed database contains the Phase 1 tables listed in
  `AUDIT_AND_MIGRATION_PLAN.md`.
- No production record is inserted as sample or demonstration data.

## 2. Authentication runtime values

Configure these values in the hosting environment, never in source control:

- `APP_ORIGIN=https://natheegroup2025.com`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` as a server-only secret
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` as the public widget key
- `TURNSTILE_SECRET_KEY` as a server-only secret

The publishable key is safe for the authentication client. A service-role key,
database password, JWT signing secret, or private key must never be exposed as a
`NEXT_PUBLIC_` value.

Configure the final production domain in Supabase Auth and allow:

```text
Site URL: https://natheegroup2025.com
Callback: https://natheegroup2025.com/auth/callback
```

## 3. Canonical OWNER

Create and email-confirm the first Supabase user, then generate the bootstrap
SQL rather than hand-writing an `INSERT`:

```bash
npm run owner:bootstrap -- \
  --auth-id '<SUPABASE-USER-UUID>' \
  --email '<CONFIRMED-EMAIL>' \
  --display-name '<OWNER NAME>' \
  > owner-bootstrap.sql
```

Review the two `PREFLIGHT` queries, apply the file to Production D1, then
confirm the `VERIFY` query returns exactly one row with
`effective_role = OWNER`, `status = ACTIVE` and `audit_entries = 1`. The
generated SQL is idempotent, refuses to rebind an email or identity that
already exists, writes the canonical `user_role_assignments` row and leaves an
audit record. See `AUTH_SETUP.md`.

Do not create a demo owner and do not store an owner password in a script or
document. A generated `owner-bootstrap.sql` maps a privileged identity and is
gitignored; delete it once applied.

## 4. Readiness check

After deployment, request:

```text
GET /api/health
```

Production is ready only when it returns HTTP 200 and all six checks are
`true`:

- `authentication`
- `adminAuthentication`
- `canonicalOrigin`
- `database`
- `storage`
- `antiAbuse`

`authentication` validates the Supabase HTTPS URL and current publishable-key
format. `adminAuthentication` independently validates that a server-only
secret is configured. `canonicalOrigin` requires the exact canonical
Production origin. `database` verifies representative tables, indexes and
invariant triggers through migration `0021`, not merely that D1 answers a
query. `storage` performs a read-only R2 metadata probe. `antiAbuse` requires both validated Turnstile runtime keys. The endpoint never
returns credentials or connection strings.

Health proves configuration and schema only. Run the component audit, which
additionally proves that the protected surface refuses an anonymous request:

```bash
NATHEE_APP_BASE_URL='https://OWNER_APPROVED_APP_HOST' bash scripts/audit-production-components.sh
```

It fails closed when any of the six checks is false **or absent**, and when
`/app`, `/api/companies`, `/api/motorcycles` or `/api/jobs` answers an
anonymous request with HTTP 200. A runtime that serves a protected page to a
signed-out visitor is a data breach, not a deployment.

The audit reports `full-application=RUNTIME_HEALTHY_ANONYMOUS_GATED`, never
`LIVE`, and prints an explicit `PRODUCTION_NOT_PROVEN` line for real login,
OWNER mapping, customer isolation and QR scanning. Those require the signed-in
acceptance flow below and cannot be proven by an anonymous probe.

`scripts/test-app-readiness.sh` proves these decisions against fixtures.

## 5. Acceptance flow

1. Owner signs in with the real account.
2. Owner creates one real customer company.
3. Owner creates one transport job and one motorcycle.
4. An authorized staff account updates one valid status step.
5. Staff uploads a real image. The stored metadata must contain its SHA-256,
   one original plus required Display/Thumbnail derivatives and one Audit row;
   every R2 object must remain private. A repeated request key must not duplicate
   metadata or objects.
6. The customer account can see only its own company records and image.
7. A second customer cannot open the first customer's motorcycle or image URL.
8. Password recovery shows the same response for registered and unknown email
   addresses.
9. Audit entries exist for company, job, motorcycle, image, status, and member
   operations.
10. OWNER or permitted STAFF prints a motorcycle QR label and scans it on a
    mobile browser. The QR opens the correct real motorcycle only after login.
11. A customer can scan a label belonging to its company but receives the same
    generic not-found response for another company's QR. A customer cannot open
    single or batch label-printing pages.
12. Batch printing renders at most 48 labels per page and the next-page link
    continues by motorcycle sequence without duplicates.
13. OWNER or permitted STAFF prints and scans one real Job, Yard, Truck and Trip
    label. Each token resolves to the correct entity, while malformed, unknown
    and cross-role tokens fail closed without revealing whether the entity exists.
14. OWNER creates a real yard zone, assigns a motorcycle, moves it once, and
    records exit. Only one active placement exists at each step and every
    operation has a matching audit entry.
15. A full zone rejects a new placement without closing or changing the
    motorcycle's existing placement. Repeating the same form submission does
    not create duplicate active placements.
16. CUSTOMER accounts cannot open yard operations or mutate yard placement.
17. OWNER saves, previews and publishes one Site Content revision; the public page reflects exactly that revision and the Audit Log exists.
18. OWNER republishes the preceding revision; history remains append-only and the public page rolls back without deleting content.
19. An approved staff account can batch-upload Gallery Drafts only with explicit Gallery permissions and cannot publish without `gallery:publish`.
20. Anonymous access receives only `PUBLIC` + `PUBLISHED` Gallery media; Draft, internal and customer-job images remain inaccessible.
21. OWNER saves and publishes global Site Settings, verifies shared brand/menu/phones/Footer and then republishes the preceding settings revision without deleting history.
22. A configured logo is shown only while its Gallery item remains `PUBLIC` + `PUBLISHED`; hiding that item must fall back to the safe brand abbreviation.
23. Submit one quotation with verified PDF/CSV evidence. The request and attachment metadata must commit once, private R2 checksums must match, non-OWNER access must return not-found, and every successful Owner download must add an Audit record.
24. Repeat the same quotation request key and verify no second request, metadata row or orphaned R2 object is created. Test an invalid signature and oversized payload and verify neither a request nor object is retained.
25. At `ARRIVED`, authorized staff selects a real `DELIVERY` image and captures the recipient signature on mobile. Verify one private R2 PNG, matching SHA-256 metadata, one active POD and Audit; only then may `DELIVERED` commit. Retry the same request key and verify no duplicate POD/object. Confirm a different company cannot read the signature and the print view labels an old unsigned POD honestly.

## 6. Rollback

- Keep the preceding hosted version available for an application rollback.
- Do not delete D1 tables or R2 objects during a client rollback.
- Database changes require a reviewed forward migration; do not edit an applied
  migration in place.
- If authentication setup fails, remove only the incomplete identity mapping
  created during that attempt. Never bulk-delete operational records.
