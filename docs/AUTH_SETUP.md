# Authentication activation

The application code is ready for managed email/password authentication. Real login remains intentionally disabled until a NATHEE-owned Supabase project is connected; no demo account or password is embedded in the source.

## 1. Create the authentication project

Create a Supabase project owned by NATHEE GROUP. In Authentication URL configuration, set the production Site URL to `https://natheegroup2025.com` and allow these redirect paths:

- `https://natheegroup2025.com/auth/callback`
- `http://localhost:3000/auth/callback` for local verification only

Email/password must be enabled. Configure the sender name and email template before inviting customers.

## 2. Set server environment values

Copy `.env.example` to `.env.local` for local work and replace the examples with the project values:

- `APP_ORIGIN`: trusted application origin. Production must be exactly `https://natheegroup2025.com`; an exact HTTPS `*.chatgpt.site` origin may be used only for a private preview, and localhost is allowed only outside Production
- `NEXT_PUBLIC_SUPABASE_URL`: Project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: publishable key used by server-side auth clients
- `SUPABASE_SECRET_KEY`: secret server key used only for owner-controlled invitations

The runtime accepts the current Supabase `sb_publishable_...` and
`sb_secret_...` key formats and rejects placeholders, malformed values and a
secret key in the public-key slot. The secret key must be stored as a hosting
secret. It must never be prefixed with `NEXT_PUBLIC_`, committed to Git, shown
in HTML, or sent to a browser.

Password-reset and invitation callbacks are constructed only from the trusted
`APP_ORIGIN`. They never inherit the request `Host` header. A Production runtime
without a valid trusted origin fails closed instead of sending an authentication
link to an untrusted origin.

## 3. Apply the database migration and storage bindings

The fresh D1 schema is in `drizzle/0000_harsh_speed_demon.sql`. Hosting bindings are declared in `.openai/hosting.json`:

- D1 database: `DB`
- R2 bucket: `FILES`

Apply the migration before the first login. The migration contains company boundaries, uniqueness rules, status checks, image metadata, and audit records.

## 4. Create the canonical OWNER

Only the first owner needs a one-time bootstrap. Do not hand-write this SQL:
a mistyped UUID creates an identity the runtime silently refuses to resolve,
and a hand-written `INSERT` skips both the canonical role assignment and the
audit record.

1. Create and **email-confirm** the owner account in the Supabase dashboard,
   then copy its user UUID. The runtime resolves an application user only from
   a confirmed identity whose UUID exactly matches `users.external_auth_id`.
2. Generate the bootstrap SQL:

```bash
npm run owner:bootstrap -- \
  --auth-id '<SUPABASE-USER-UUID>' \
  --email '<CONFIRMED-EMAIL>' \
  --display-name '<OWNER NAME>' \
  > owner-bootstrap.sql
```

The generator takes **no secret** — a Supabase user UUID is an identifier, not
a credential — so the generated file is safe to review, but it maps a
privileged identity and must not be committed to Git.

3. Review the two `PREFLIGHT` queries at the top of the file. Before the very
   first bootstrap both must return zero.
4. Apply the file to the Production D1 database, then read the `VERIFY` query
   output. It must return exactly one row with `effective_role = OWNER`,
   `status = ACTIVE` and `audit_entries = 1`. Any other result means the
   bootstrap did not apply and must be investigated before anyone signs in.

What the generated SQL guarantees:

- **Idempotent.** Running it twice changes nothing, so a partially applied run
  can simply be repeated.
- **No silent rebinding.** If the email already belongs to another account, or
  the Supabase identity is already mapped, every statement is skipped rather
  than overwriting an existing mapping.
- **Canonical role.** It writes `user_role_assignments`, which the role system
  treats as authoritative, instead of relying on the legacy `users.role`
  fallback.
- **Audited.** Creating the first privileged identity leaves the same evidence
  as any other privileged change.

`tests/owner-bootstrap.test.mjs` proves all of the above against the real
migrated schema, including that a hostile display name is stored literally
rather than executed.

After this owner signs in, create every other internal and customer account
from **สมาชิก / สิทธิ์**. The system sends an invitation, records the canonical
role in `user_role_assignments`, requires a company for `CUSTOMER_ADMIN` and
`CUSTOMER_VIEWER`, and assigns explicit capabilities to every non-owner
internal role. Migration `0004_role_system_foundation` maps legacy CUSTOMER
identities to least-privilege `CUSTOMER_VIEWER` without locking out existing
OWNER or STAFF accounts.

Runtime authorization uses only the exact confirmed Supabase user UUID stored
in `users.external_auth_id`. It does not auto-link an account by matching
email and does not rewrite identity mappings during a page read. A mistaken or
replaced identity must be repaired by a reviewed, audited administrative
procedure.

## 5. Acceptance check

Before opening the system to users, verify:

1. Owner can create a company, job, and motorcycle.
2. Staff sees only menus granted by capabilities and can update only permitted records.
3. A customer account mapped to Company A cannot open Company B's motorcycle URL or private image URL.
4. Password recovery returns the same public message for existing and unknown emails.
5. Status changes and image uploads create audit entries.
6. No Supabase secret, password, sample credential, or fake KPI appears in the rendered HTML.
