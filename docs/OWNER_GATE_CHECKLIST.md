# Owner Gate checklist — Production activation

Every item here needs a value, a decision or an action that only the Owner can
supply. Nothing in this checklist has been performed. Migrations are unapplied,
R2 is untouched, and no Production secret has been read by this lane.

Two origins, and they are not interchangeable:

| | Origin | Serves |
| --- | --- | --- |
| Public website | `https://natheegroup2025.com` | static marketing site on Z.com |
| **Application** | `https://app.natheegroup2025.com` | login, `/app`, `/api`, private media |

The apex is **refused** as `APP_ORIGIN`. The application holds sessions and
customer data; the apex is a document root a deploy script overwrites by file
copy, and sharing an origin would put every Auth cookie in that scope.

## Gate 1 — Application hostname and routing

- [ ] `app.natheegroup2025.com` exists and resolves to the application runtime.
- [ ] Valid TLS for that hostname.
- [ ] The apex continues to serve the static public site, unchanged.

DNS is an Owner action. This lane changes no DNS record.

## Gate 2 — Supabase values

Set in the hosting environment, never in source control:

| Variable | Value |
| --- | --- |
| `APP_ORIGIN` | `https://app.natheegroup2025.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` (browser-visible) |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` (server-only, never `NEXT_PUBLIC_`) |

In the Supabase Auth dashboard:

```text
Site URL:     https://app.natheegroup2025.com
Redirect URL: https://app.natheegroup2025.com/auth/callback
```

- [ ] `npm run verify:env` reports `PRODUCTION_ENV_VERIFY_PASS`.

It applies the same validators the runtime applies, prints no value it was
given, and contacts no provider. It names the specific mistake — a swapped key,
a secret in the browser-visible slot, or the apex used as the application origin.

## Gate 3 — D1 backup and migrations

- [ ] Back up the Production D1 database **before** applying anything.
- [ ] Read the migration ledger; apply only what is missing.
- [ ] Apply `drizzle/0000` … `drizzle/0025`, once each, in order.
- [ ] Never rerun the chain blindly and never edit an applied migration.

`0022`–`0025` are additive: two tables, three indexes and two `audit_logs`
immutability triggers. None alters an existing table, row, trigger or
constraint.

## Gate 4 — R2

- [ ] Binding `FILES` exists and the bucket is **private**.
- [ ] No public bucket policy and no public custom domain on it.

## Gate 5 — OWNER identity

- [ ] Create and **email-confirm** the owner in the Supabase dashboard.
- [ ] `node scripts/generate-owner-bootstrap.mjs --auth-id <supabase-uuid> --email <email> --display-name <name>`
- [ ] Run the generated SQL against Production D1 and read its verify output.

The script takes no secret — a Supabase user UUID is an identifier, not a
credential. It emits guarded, idempotent SQL with preflight checks, the
canonical role assignment and an audit entry. Do not hand-write the INSERT and
do not create a demo owner.

## Gate 6 — Turnstile

- [ ] `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`, both or
      neither.

Without both, the public quotation form stays visibly unavailable and
`/api/health` reports `antiAbuse: false`. This blocks a healthy runtime.

## Gate 7 — Runtime readiness

- [ ] `GET https://app.natheegroup2025.com/api/health` returns **HTTP 200** with
      all six checks `true`: `authentication`, `adminAuthentication`,
      `canonicalOrigin`, `database`, `storage`, `antiAbuse`.

`database` requires **every** object the migrations create — 37 tables, 81
triggers, 128 indexes. A runtime missing any one reports `degraded`, and
`missingDatabaseObjects()` names which.

## Gate 8 — Authenticated acceptance

- [ ] `https://app.natheegroup2025.com/login` renders the real login form.
- [ ] `/auth/callback` completes a recovery link and lands on `/reset-password`.
- [ ] The real OWNER signs in and reaches `/app`.
- [ ] Two customer companies exist; a user of company A cannot open company B's
      job, motorcycle, evidence image or Proof of Delivery.
- [ ] A sign-in appears in `/app/audit` under การเข้าสู่ระบบ.

Only when Gates 1–8 all pass on Production may the runtime be described as
accepted. **APP_RUNTIME_PASS must not be claimed before then**, and a green
source build is not evidence for any of it.
