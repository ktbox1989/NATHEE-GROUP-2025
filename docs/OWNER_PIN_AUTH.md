# Owner PIN authentication

The Owner reaches the website CMS with a six-digit PIN, and that path depends on
no identity provider. Supabase authentication is unchanged and stays available
for staff and customer accounts; it is simply no longer a prerequisite for the
Owner getting in.

Nothing in this document is activated by reading it. There is no migration, no
new table, and no Production change.

---

## The account

| | |
|---|---|
| Address | `kaikt143@gmail.com` — a **public identifier**, fixed in `lib/owner-pin.ts` |
| `users.external_auth_id` | `owner-pin:kaikt143@gmail.com` |
| Role | `OWNER`, written explicitly into `user_role_assignments` |

The address is never read from a request. The login form has no email field, so
a caller cannot aim an attempt at a different account, cannot spend another
account's lockout budget, and cannot turn a leaked PIN into a login to anything
but this seat.

The identity is deliberately **not** a UUID. `lib/auth-identity.ts` refuses any
external auth id that is not a UUID, so a Supabase session can never resolve to
this row and a PIN session can never be mistaken for a provider one. The two
paths cannot collide even with both configured.

## Runtime configuration

Two secrets, neither with a default:

| Name | What it is |
|---|---|
| `OWNER_PIN_CREDENTIAL` | `v1$pbkdf2-sha256$<iterations>$<salt>$<hash>` — a PBKDF2-SHA256 verifier. ≥200 000 iterations, ≥16-byte random salt, 32-byte hash. The PIN itself is never stored anywhere. |
| `OWNER_SESSION_SECRET` | ≥32 bytes of key material, base64url. Signs the session cookie. |

`APP_ORIGIN` is required as before: every Auth mutation is same-origin checked
against it.

Generate both without the PIN ever reaching a shell history, a process listing
or a file:

```
npm run owner:pin
```

The PIN is typed twice with the echo off; only the two derived values are
printed, on stdout, and nothing else. Paste them into the deployment's secret
store. Then check the shapes, with no network call and no provider contacted:

```
npm run verify:env
```

`verify:env` now reports an **auth mode**. One complete mode is enough:
`owner-pin`, `supabase`, or `owner-pin+supabase`. Whichever mode is not
configured is reported as a warning — never as ready — and `none` fails.

### Rotating the PIN

Replace `OWNER_PIN_CREDENTIAL`. That is the whole procedure.

Every session carries a fingerprint of the credential it was issued under, so
replacing the credential stops every existing cookie verifying on the very next
request. There is no session table to clear and nothing to revoke.

## Why six digits is enough here

It is enough only because three things hold together, and all three are enforced
in code rather than assumed:

1. **The verifier is slow and salted.** PBKDF2-SHA256, ≥200 000 iterations, a
   fresh random salt per credential. A credential below the floor is treated as
   malformed, not as a weaker credential.
2. **Every attempt spends budget before it is checked.** The login route
   reserves from the existing `auth_attempt_counters` — the same table, the same
   policies, the same lockout ladder as the password login — and it reserves
   *before* the PIN is verified, so a request that dies mid-flight has still
   spent its attempt. An unreachable counter refuses the login.
3. **The budget names one account.** The identity subject is the Owner's own
   address, so PIN guesses and password guesses at the same address share one
   budget: five failures, then a 15 / 30 / 60-minute ladder.

`scripts/test-auth-security-gates.mjs` fails the build if the reservation ever
stops preceding the verifier, or if the account ever starts coming from the form.

## The session

A signed cookie, and nothing else. There is no server-side session table.

| Property | Value |
|---|---|
| Name | `nathee_owner_session` |
| Attributes | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` |
| Lifetime | 7 days, clamped at issue **and** at verification |
| Signature | HMAC-SHA256 over the payload, compared in constant time |
| Payload | application user id, the canonical address, the credential fingerprint, issued-at and expiry |

A cookie is accepted only when the signature, the format, the fixed address, the
credential fingerprint and both time bounds all hold. A cookie signed by hand
with a longer life than the policy is refused even though its signature is good.

Possession of a valid cookie is still not enough to act. `lib/current-actor.ts`
queries D1 on **every request** and requires the account to be `ACTIVE` with an
effective role of `OWNER`. Deactivating or demoting the account ends the session
immediately, without touching the cookie.

Signing out (`POST /api/auth/logout`) clears this cookie whether or not Supabase
is configured, and clears the Supabase cookies as well when it is.

## First sign-in

The first correct PIN creates the canonical Owner, idempotently, inside the
existing schema:

1. `users` — the row, `OWNER`, `ACTIVE`, no company.
2. `user_role_assignments` — the explicit `OWNER` assignment, because the
   assignment is authoritative and the legacy `users.role` column is a fallback.
3. `audit_logs` — one `BOOTSTRAP_OWNER_PIN_IDENTITY` entry.

Every statement is `INSERT ... SELECT ... WHERE NOT EXISTS`, so the whole
sequence runs safely on every login and the tenth sign-in writes nothing.

**It refuses rather than rebinds.** If the canonical address is already held by
another identity, or the PIN identity is bound to another address, or the two
have drifted onto separate accounts, nothing is written and the login is refused
with `?error=owner_conflict`. If the row exists but is not an `ACTIVE` account
with the `OWNER` role, the login is refused as well: the bootstrap may create
the Owner and may do nothing, but it must never promote an account it did not
create. Recovering from a conflict is a deliberate act by the Owner against the
database.

## Readiness

`/api/health` reports the mode it is actually in:

```json
{
  "status": "degraded",
  "checks": { "authentication": true, "adminAuthentication": false, "…": "…" },
  "auth": { "mode": "owner-pin", "ownerPin": true, "supabase": false, "supabaseAdmin": false }
}
```

`authentication` is now "this runtime can authenticate somebody", true under
either mode. `auth` says which. Nothing derived from the credential or the
signing key appears in the payload. Supabase is never reported as ready while it
is absent, and the overall verdict stays all-or-nothing.

---

## The UI contract (Lane A)

This is the exact contract. Anything that differs is dropped or refused by the
server.

**Endpoint** — `POST /api/auth/owner-pin/login`, `Content-Type:
application/x-www-form-urlencoded` or `multipart/form-data`. Must be a same-origin
form post; a cross-site post is answered `403`.

**Fields — exactly two, and no others:**

| Field | Value |
|---|---|
| `pin` | exactly six ASCII digits `0-9` |
| `returnTo` | an application path beginning with a single `/`; anything else becomes `/app` |

There is **no** `email` field, and an `email` field would be ignored if sent.
Sending one is a review failure, not a runtime one.

**Rendering the form.** The input is `type="password"`, `inputMode="numeric"`,
`pattern="[0-9]{6}"`, `minLength=6`, `maxLength=6`,
`autoComplete="current-password"`, and carries a visible label and a hint.
Client-side validation is a convenience only; the server is the authority.

`autoComplete="current-password"` and not `one-time-code`: this is a standing
credential the Owner reuses at every sign-in, and `one-time-code` tells a
password manager and a mobile keyboard to look for a code arriving by SMS or
mail and never to offer the stored one. `pattern="[0-9]{6}"` rather than
`\d{6}` for the same class of reason — `\d` in an HTML pattern is Unicode-aware,
so a Thai or Arabic-Indic six would pass the field and then match nothing the
server compares.

The form is rendered unconditionally, and nothing on the screen is disabled on a
configuration check. When `isOwnerPinConfigured()` is false the page says so in a
notice above the field — an unconfigured server is a fact the operator should be
told before spending a PIN entry — but the post still happens and the server
still answers `?error=config`, because the server is the authority on its own
configuration. `auth.ownerPin` from `/api/health` reports the same fact.

**Responses.** Always `303`, always to a path on this origin. Never JSON.

Every refusal also carries the sanitised `returnTo` back when the form sent one,
so a mistyped digit does not silently relocate the Owner to the default
destination. What is echoed is the sanitised path, never the raw form value; a
value `safeReturnTo` had to fall back on is not carried at all, so a caller
cannot use a refused value to overwrite the login page's own default.

| Outcome | Redirect |
|---|---|
| Success | the validated `returnTo`, with the session cookie set. `safeReturnTo` falls back to `/app`; the login page always sends a value and defaults it to `/app/website`, so a direct sign-in lands in the website workspace |
| PIN not six digits | `/login?error=pin_format` |
| Wrong PIN | `/login?error=invalid_pin` |
| Rate limited | `/login?error=too_many_attempts&retryAfter=<seconds>` |
| Counter or database unreachable | `/login?error=unavailable` |
| Owner PIN not configured | `/login?error=config` |
| Canonical Owner conflicts with an existing account | `/login?error=owner_conflict` |
| Not same-origin | `403 Forbidden` (plain text, no redirect) |

`retryAfter` is a second count; render it with `retryAfterMinutes()` from
`lib/auth-throttle.ts`, which refuses any value that is not a plausible count
rather than showing an attacker-chosen number.

Wrong-PIN and rate-limited are the only two outcomes a guesser can reach, and
neither discloses whether the Owner account exists.

**Sign out** — `POST /api/auth/logout`, no fields, same-origin. Redirects to
`/login?status=logged_out`.

A working reference implementation of all of the above is `app/login/page.tsx`,
and `lib/owner-pin-login.ts` holds the browser half of the contract: the route
path, the two field names, the fixed address, the PIN shape, the default
destination, and one Thai sentence per code. `/login` renders the PIN door only.
`POST /api/auth/login`, `/forgot-password` and `/reset-password` are untouched
and still mounted for staff and customer accounts, and their redirect codes
(`invalid_input`, `invalid_credentials`) still have sentences on `/login`; what
changed is that the Owner's screen no longer shows a password form.
