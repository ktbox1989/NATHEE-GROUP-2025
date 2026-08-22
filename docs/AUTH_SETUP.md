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

## 5. Attempt budgets on the unauthenticated Auth routes

`/api/auth/login` and `/api/auth/forgot-password` are the only two endpoints an
anonymous caller can use to act on a real account. Supabase applies its own
provider-side limits, but they are global to the project, invisible to this
application, cannot lock a single targeted account, and cannot be proven to be
in force from a Production runtime. The application therefore keeps its own
budgets in D1 (`auth_attempt_counters`, migration `0022`).

Every attempt spends two budgets at once, because either one alone leaves a real
attack uncovered:

| Scope | Budget | Window | Lockout ladder | Covers |
| --- | --- | --- | --- | --- |
| `login:identity` | 5 failures | 15 min | 15 / 30 / 60 min | guessing one account, including OWNER, from many clients |
| `login:client` | 20 failures | 15 min | 15 / 30 / 60 min | spraying many accounts from one client |
| `recovery:identity` | 3 requests | 60 min | 60 min | bombing one mailbox, exhausting the send quota |
| `recovery:client` | 15 requests | 60 min | 60 min | bombing many mailboxes from one client |

Operating rules the runtime enforces:

- **The budget is spent before the provider is asked.** A request that times out
  or dies inside the provider call has still spent its attempt.
- **An unreachable counter refuses the request.** If D1 is unavailable the routes
  return `error=unavailable` and never contact the provider. A missing
  `auth_attempt_counters` table also makes `/api/health` report `degraded`, so a
  runtime behind migration `0022` cannot claim readiness.
- **A correct password clears only its own identity budget.** The shared client
  budget is only ever given back the single attempt it lent, so an attacker who
  controls one valid account cannot reset a client budget between guesses.
- **Recovery never reports success.** The reply is identical whether or not the
  address exists, so the counter is told the same thing and cannot become an
  existence oracle. Lockouts are keyed on a digest of whatever address was
  submitted, so an unknown address locks exactly like a known one.
- **The client scope reads only `CF-Connecting-IP`,** which the edge overwrites
  on every request. `X-Forwarded-For` is caller-controlled and would let one
  client mint unlimited buckets. A request with no trusted address shares one
  `unknown-client` bucket rather than escaping the scope.
- **Counters store no subject.** `scope_key` is a SHA-256 digest; the table
  compares subjects and never reads one back, so it cannot become a list of
  email addresses typed at the login form. Rows that are neither locked nor
  recently touched are reclaimed after 24 hours, at most 50 per attempt.
- **The counters are the record.** Lockouts are not written to `audit_logs`,
  because an anonymous caller would then control how many audit rows exist. The
  counter row itself carries the failure count, the lockout count and the
  current lock.

There is no environment value, header or query parameter that disables any of
this; `scripts/test-auth-security-gates.mjs` fails if one is introduced, and
`scripts/test-auth-security-gate-negative.mjs` proves that gate rejects twelve
specific ways the wiring can be broken.

## 6. Acceptance check

Before opening the system to users, verify:

1. Owner can create a company, job, and motorcycle.
2. Staff sees only menus granted by capabilities and can update only permitted records.
3. A customer account mapped to Company A cannot open Company B's motorcycle URL or private image URL.
4. Password recovery returns the same public message for existing and unknown emails.
5. Status changes and image uploads create audit entries.
6. No Supabase secret, password, sample credential, or fake KPI appears in the rendered HTML.
7. Six wrong passwords on one account are refused with a wait, and the same
   account is still refused after the 15-minute window has rolled but before the
   lockout expires.
8. A fourth recovery request for the same address inside an hour is refused, and
   the refusal is identical for an address that has no account.
