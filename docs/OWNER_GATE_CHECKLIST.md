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

It also checks that the artifact declares the D1 `DB` and private R2 `FILES`
bindings, and refuses any `NEXT_PUBLIC_` value that carries a secret shape (a
Supabase secret, a JWT, a provider key, a private key). That last one is the
mistake that cannot be walked back: a `NEXT_PUBLIC_` value is compiled into
pages customers download, so once shipped it is public and must be rotated
rather than removed.

A value pasted with a trailing carriage return — which is what copying from a
Windows file gives you — is accepted, because the runtime accepts it too.

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

## Running Gates 7 and 8

Both are one command, so acceptance is measured rather than asserted:

```bash
npm run verify:acceptance
```

It reads the application origin from `NATHEE_APP_BASE_URL` and defaults to
`https://app.natheegroup2025.com`. With no credentials it runs everything that
can be proven anonymously — readiness, security headers, the real login form,
the protected tree refusing anonymous requests, private media and QR refusing
anonymous callers — and stops there.

The authenticated half needs accounts, supplied at run time and never stored:

```bash
NATHEE_OWNER_EMAIL=... NATHEE_OWNER_PASSWORD=... \
NATHEE_CUSTOMER_A_EMAIL=... NATHEE_CUSTOMER_A_PASSWORD=... \
NATHEE_CUSTOMER_B_EMAIL=... NATHEE_CUSTOMER_B_PASSWORD=... \
  npm run verify:acceptance
```

The two customers must belong to **different companies**; one account cannot
demonstrate isolation, and the run says so rather than passing.

It ends in exactly one of three verdicts:

| Verdict | Exit | Meaning |
| --- | --- | --- |
| `APP_RUNTIME_PASS` | 0 | every check ran and passed |
| `APP_RUNTIME_FAIL` | 1 | a check ran and failed |
| `APP_RUNTIME_INCOMPLETE` | 2 | a check could not run — **not** a pass |

Only the first authorises the claim. The word `APP_RUNTIME_PASS` is never
printed by the other two, so a log may be searched for it safely.

### Publishing is opted into separately

The Owner asked that content changes reach the public site from the CMS, with no
SSH, no hand-edited HTML and no Git deploy. Proving that means actually
publishing, which changes what visitors see — so it runs only when asked:

```bash
NATHEE_ACCEPTANCE_ALLOW_WRITES=1 NATHEE_ACCEPTANCE_CMS_SLUG=contact \
  npm run verify:acceptance
```

Given both, the run saves a draft, confirms the preview shows it, confirms the
public page does **not** yet, publishes, confirms the public page now serves it
with no redeploy, and then republishes whichever revision was live before.
Revisions are append-only and none is ever edited, so no content can be lost;
the page ends on exactly the revision it started on, and the run fails loudly
with the revision id to restore by hand if that last step does not take.

It refuses to publish a page that has no published revision to return to, since
that change could not be undone exactly. Publish real content first, then run
this against it.

Without both variables the CMS checks are SKIP, and the verdict is INCOMPLETE.

### The runner is itself tested

`scripts/test-production-acceptance-rejections.mjs` stands up an HTTPS server
impersonating the application and breaks it 29 different ways — a false
readiness check, a missing security header, the placeholder login page, the
application shell rendering anonymously, private evidence served to a stranger,
a refused OWNER, a sign-in absent from the Audit trail, a draft that goes public
the moment it is saved, a publish that never reaches the page, a run that leaves
the site unrestored, and one customer reading a record belonging to another —
and requires the run to catch every one.

It also proves the five ways the runner could lie by omission. Missing
credentials, an OWNER with no customers, two customers whose records cannot be
told apart, publishing not opted into, and a page with no published revision to
return to all report INCOMPLETE rather than PASS.

It runs in `npm run test:security` as `ACCEPTANCE_NEGATIVE_PASS`, so the
acceptance runner cannot quietly stop working.
