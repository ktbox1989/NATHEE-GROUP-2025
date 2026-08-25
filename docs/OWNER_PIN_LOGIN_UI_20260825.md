# Owner PIN login — the UI half — 2026-08-25

Built on `lane-a/owner-pin-ui-20260825` from
`e73ead32caea6fc3b9cc232e6e9a19469040d44c`, and merged with Lane B's backend on
`integration/owner-pin-auth-20260825`. Local only: nothing here is pushed,
merged to `main` or deployed, and the public `/login/` handoff on Z.com stays
**INACTIVE**.

This lane owned the screen and nothing behind it. At integration one server-side
defect was fixed — see §3 below — and nothing else on the backend was changed:
no session, actor resolution, schema or migration. No PIN or secret is in the
repository. The PIN is held server-side under `OWNER_PIN_CREDENTIAL`, and the
only thing this half ever does with one is post what was typed.

---

## What the screen is now

`/login` is an Owner PIN login. One identity, one field.

| | |
| --- | --- |
| Posts to | `POST /api/auth/owner-pin/login`, same-origin, `method="post"` |
| Sends | `pin`, `returnTo` — and provably nothing else |
| Owner identity | `kaikt143@gmail.com`, rendered as text, never an input, never submitted |
| PIN field | `type=password`, `inputMode=numeric`, `pattern=[0-9]{6}`, `maxlength=6`, `minlength=6`, `autocomplete=current-password`, `required`, never given a value |
| Default destination | `/app/website` |
| Preserved destination | any same-origin path arriving as `?returnTo=`, via `ownerLoginReturnTo` |
| Indexing | `robots: { index: false, follow: false }` |

`lib/owner-pin-login.ts` holds the whole client-side contract: the route path,
the two field names, the fixed address, the PIN shape, the default destination,
and one Thai sentence per error and status code. Everything in it is public by
construction.

Three things were deliberately removed:

- **The Supabase configuration gate.** The old page disabled its own fields when
  `isSupabaseConfigured()` was false. A PIN session is not a Supabase session, so
  that check would have locked the Owner out of their own CMS on the strength of
  an unrelated integration. There is now no `supabase` reference in the login UI
  at all, and a gate proves it.
- **The password-recovery link.** A PIN cannot be mailed and cannot be reset from
  this screen. The page says so in one sentence instead of linking somewhere that
  cannot help. `/forgot-password`, `/reset-password` and
  `POST /api/auth/login` are untouched and still reachable; only the Owner's
  primary path changed.
- **The email and password fields.** Not hidden, not disabled — absent. A gate
  asserts the page's complete set of submitted field names is exactly
  `["pin", "returnTo"]`.

`pattern="[0-9]{6}"` rather than `\d{6}` on purpose: `\d` in an HTML pattern is
Unicode-aware, so `๑๒๓๔๕๖` and `١٢٣٤٥٦` would pass the field and then be
recognised by no comparison on the server. The Owner would be told a correct PIN
was wrong. `tests/owner-pin-login.test.ts` asserts each of those is refused.

`returnTo` is sanitised on the way *in*, not only on the way back: it arrives in
a URL anyone can write and is rendered straight into a hidden field, so a page
that passed it through would be an open redirect wearing a login form. It is
decided by the existing `safeReturnTo`, not by a second copy of its rules.

---

## What Lane B answered — closed at integration, 2026-08-25

Every ask below was written against a baseline where the route did not exist.
The route landed on `integration/owner-pin-auth-20260825`; each ask is now
recorded with what the server actually does, and the UI was moved to match it
rather than the other way round. The server contract is Lane B's.

### 1. The route exists — `app/api/auth/owner-pin/login/route.ts`

Same-origin checked (`403` otherwise), reads `pin` and `returnTo` and nothing
else, and answers `303` to a path on this origin in every case.

### 2. The refusal codes are the server's, and the UI was renamed to them

This lane guessed `invalid_input` and `invalid_credentials` from the password
route. The PIN route uses its own two, and adds one this lane had no way to
predict:

| The route answers | Means |
| --- | --- |
| `pin_format` | the value was not exactly six ASCII digits; nothing was spent |
| `invalid_pin` | the PIN was compared and did not match |
| `owner_conflict` | the canonical address is held by another account; the bootstrap refuses rather than rebinds, and only a change in the database clears it |
| `config` | the Owner PIN is not configured on the server |
| `too_many_attempts` + `retryAfter` | the shared login budget is spent |
| `unavailable` | the counter or the database could not be reached |

`lib/owner-pin-login.ts` now names all six, plus `not_authorized` from
`lib/current-actor.ts`, `origin` from `app/auth/callback/route.ts`, and
`invalid_input` / `invalid_credentials` from the still-mounted password route —
ten codes, each with a sentence, none of them a guess. `aria-invalid` is set for
`pin_format` and `invalid_pin` only: the other eight never compared a PIN, and
marking the field for them would announce something untrue.

### 3. `returnTo` now survives a refusal — this was a real defect, and it was fixed

As landed, the route dropped `returnTo` on every error, so one mistyped digit
sent the Owner to `/app/website` and lost the page a protected route had asked
for. The route now appends the **sanitised** path to every refusal redirect,
and only when the form actually sent one that survived sanitising — echoing the
fallback of a refused value would let a caller overwrite this page's own
default. `scripts/test-auth-security-gates.mjs` asserts both halves and
`scripts/test-auth-security-gate-negative.mjs` proves each can fail.

### 4. `requireActor` no longer refuses with `config` while the PIN works

`lib/current-actor.ts` redirects to `?error=config` only when *no* door is
configured, and to `?error=not_authorized&returnTo=<path>` otherwise. Answered
as asked.

### 5. Logout confirms itself on every path

`POST /api/auth/logout` clears the Owner PIN cookie whether or not Supabase is
configured, clears the Supabase cookies as well when it is, and always redirects
to `/login?status=logged_out`. Answered as asked.

### 6. The email is ignored, not merely unrequired

The route never reads an `email` field. `scripts/test-auth-security-gates.mjs`
fails the build if it starts to, and if the throttle subject stops being the
server constant.

### 7. The existing guards apply

Same-origin `403`, and the login budget reserved **before** the verifier, on the
Owner's own identity subject — so PIN guesses and password guesses at the same
address share one budget: five failures, then 15 / 30 / 60 minutes.

### 8. The PIN does not survive the request

It is not in a redirect, a log line or an audit row. The sign-in event records
the method (`owner_pin`), never the value.

---

## What changed at integration

- **`autocomplete`.** `current-password`, deliberately, and now stated the same
  way in the UI, the gate, the unit test and `docs/OWNER_PIN_AUTH.md`. This is a
  standing credential the Owner reuses; `one-time-code` would tell a password
  manager and a mobile keyboard to wait for a code arriving by SMS and never to
  offer the stored one.
- **The configuration notice.** The page renders the PIN form unconditionally
  and disables nothing, but when `isOwnerPinConfigured()` is false it says so
  above the field rather than making the Owner spend an entry to be told. The
  post still happens; the server is still the authority.
- **The password form is gone from this screen**, as this lane built it.
  `POST /api/auth/login`, `/forgot-password` and `/reset-password` are untouched
  and still mounted, and their codes still have sentences here — Supabase
  remains an optional fallback at the route and session level. A sign-in screen
  for staff and customer accounts is a separate decision with its own scope.

## Gates added

| Gate | Proves |
| --- | --- |
| `scripts/test-owner-pin-login-ui-contract.mjs` | route, exactly two submitted fields, every PIN attribute, no client-trusted email, no Supabase, sanitised `returnTo`, every error code has copy, noindex, no PIN-shaped literal or env read, label/`aria-describedby`/`aria-invalid`, mobile CSS |
| `scripts/test-owner-pin-login-ui-contract-negative.mjs` | 40 specific regressions, each applied to a copy of the tree, each of which the gate must reject |
| `tests/owner-pin-login.test.ts` | the fixed address, the PIN shape against Thai/Arabic-Indic/fullwidth digits, `returnTo` against nine hostile values, one sentence per code, no invented lockout figure, no refusal resolving as a success |

`scripts/test-response-security-headers-negative.mjs` had two cases anchored on
the old form target; they now mutate the new one and still prove the header gate
catches an off-site or protocol-relative form action.

---

## Not done, on purpose

- No backend route, session, cookie, actor resolution, schema or migration.
- No PIN, no secret, no environment read anywhere in the login UI.
- `POST /api/auth/login`, `/forgot-password`, `/reset-password`,
  `/api/auth/forgot-password`, `/api/auth/update-password` and the Supabase
  helpers are untouched. They are no longer the Owner's path; they are not
  removed, because removing them is a separate decision with its own blast
  radius.
- The public Z.com `/login/` redirect stays INACTIVE, and
  `public-site/login/index.html` — noindex, no credentials, no demo account — is
  byte-for-byte unchanged.
