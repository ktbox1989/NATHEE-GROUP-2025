# Authentication activation

The application code is ready for managed email/password authentication. Real login remains intentionally disabled until a NATHEE-owned Supabase project is connected; no demo account or password is embedded in the source.

## 1. Create the authentication project

Create a Supabase project owned by NATHEE GROUP. In Authentication URL configuration, set the production Site URL to `https://natheegroup2025.com` and allow these redirect paths:

- `https://natheegroup2025.com/auth/callback`
- `http://localhost:3000/auth/callback` for local verification only

Email/password must be enabled. Configure the sender name and email template before inviting customers.

## 2. Set server environment values

Copy `.env.example` to `.env.local` for local work and replace the examples with the project values:

- `NEXT_PUBLIC_SUPABASE_URL`: Project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: publishable key used by server-side auth clients
- `SUPABASE_SECRET_KEY`: secret server key used only for owner-controlled invitations

The secret key must be stored as a hosting secret. It must never be prefixed with `NEXT_PUBLIC_`, committed to Git, shown in HTML, or sent to a browser.

## 3. Apply the database migration and storage bindings

The fresh D1 schema is in `drizzle/0000_harsh_speed_demon.sql`. Hosting bindings are declared in `.openai/hosting.json`:

- D1 database: `DB`
- R2 bucket: `FILES`

Apply the migration before the first login. The migration contains company boundaries, uniqueness rules, status checks, image metadata, and audit records.

## 4. Create the first owner

Only the initial owner requires a one-time bootstrap:

1. Create the owner's email/password account in the Supabase dashboard and copy its user UUID.
2. Insert one mapped OWNER record into D1, replacing all values below with the real UUID, email, and name.

```sql
INSERT INTO users
  (id, external_auth_id, email, display_name, role, status)
VALUES
  ('GENERATE-A-NEW-UUID', 'SUPABASE-USER-UUID', 'owner@example.com', 'Owner name', 'OWNER', 'ACTIVE');
```

After that owner signs in, all STAFF and CUSTOMER accounts should be created from **สมาชิก / สิทธิ์**. The system sends an invitation, records the server-side role, requires a company for CUSTOMER, and assigns explicit capabilities to STAFF.

## 5. Acceptance check

Before opening the system to users, verify:

1. Owner can create a company, job, and motorcycle.
2. Staff sees only menus granted by capabilities and can update only permitted records.
3. A customer account mapped to Company A cannot open Company B's motorcycle URL or private image URL.
4. Password recovery returns the same public message for existing and unknown emails.
5. Status changes and image uploads create audit entries.
6. No Supabase secret, password, sample credential, or fake KPI appears in the rendered HTML.
