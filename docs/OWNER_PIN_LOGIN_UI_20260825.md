# Owner PIN login — the UI half — 2026-08-25

Built on `lane-a/owner-pin-ui-20260825` from
`e73ead32caea6fc3b9cc232e6e9a19469040d44c`. Local only: nothing here is pushed,
merged or deployed, and the public `/login/` handoff on Z.com stays **INACTIVE**.

This lane owns the screen and nothing behind it. No route, session, actor
resolution, schema or migration was touched, and no PIN or secret is in the
repository — the PIN is Lane B's, held server-side, and the only thing this half
ever does with one is post what was typed.

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

## What Lane B must confirm or close

Stated as behaviour rather than intention, so each one can be answered or
refused. Where this lane could have guessed, it did not.

### 1. The route does not exist yet

At this baseline there is no `app/api/auth/owner-pin/login/route.ts`. The form
posts to it and will 404 until Lane B lands it. No fallback, second route or
client-side shim was invented to paper over that, because a login that appears
to work and did not is the worst failure this screen can have.

### 2. The redirect-back shape

The page reads exactly four query parameters on `/login`: `error`, `retryAfter`,
`returnTo`, `status`. Please confirm:

- a refusal redirects **303** to `/login?error=<code>`, and **carries
  `returnTo` back** when the attempt had one. The existing password route drops
  `returnTo` on every error, so one typo sends the Owner to the default
  destination and the page they were trying to reach is lost. A six-digit PIN
  will be mistyped, so this matters more here than it did there.
- `too_many_attempts` carries `retryAfter` **in seconds**. The page renders it
  through the existing `retryAfterMinutes`, which accepts `^[0-9]{1,6}$` and
  clamps at 86400; anything else renders "รอสักครู่" and no number rather than a
  wrong one.
- success redirects **303** to `returnTo`, defaulting to `/app/website`.

### 3. `not_authorized` has two senders, and one sentence

`lib/current-actor.ts` already redirects `/login?error=not_authorized&returnTo=…`
when a protected route is reached without an actor, and the PIN route lists the
same code. The page can only write one sentence for it, and it currently says
"ต้องเข้าสู่ระบบด้วย PIN ของเจ้าของก่อน จึงจะเปิดหน้าที่ขอไว้ได้".

Please keep `not_authorized` for *no Owner session, or this identity may not
enter*, and use `invalid_credentials` for *the PIN was wrong*. If the route uses
`not_authorized` for a wrong PIN the sentence becomes untrue for one of its two
senders.

### 4. `requireActor` still refuses with `config`

`lib/current-actor.ts` redirects to `/login?error=config` — with **no
`returnTo`** — whenever Supabase is unconfigured, before it ever looks for an
actor. After PIN integration that path is reached by an Owner whose PIN works
perfectly, who is then told the system is misconfigured and loses their
destination.

A protected route reached without a PIN session should redirect with
`error=not_authorized&returnTo=<path>`. This lane did not touch that file.

### 5. Logout must confirm itself

`POST /api/auth/logout` returns early to `/login` **with no status** when
Supabase is unconfigured, and to `/login?status=logged_out` otherwise. The page
confirms a logout only on `status=logged_out`.

After PIN integration, please clear the PIN session and always redirect to
`/login?status=logged_out`, including on the unconfigured path — otherwise the
Owner presses "ออกจากระบบ", the session ends, and the screen says nothing.

### 6. The email must be ignored, not merely unrequired

The page sends no email and a gate proves it, but a hand-crafted POST can send
anything. Please have the route *ignore* an `email` field rather than read it and
find it absent, so no request can nominate whose account is being opened.

### 7. The existing guards apply here too

`isSameOrigin(request)` → 403, and the login attempt budgets spent **before** any
comparison, in the shape `app/api/auth/login/route.ts` already uses. One
consequence worth stating out loud: with a fixed Owner the `login:identity`
subject is constant, so that budget is a lock on the only account there is —
5 failures, then the 15/30/60-minute ladder. That is the correct protection for a
six-digit secret, and it is also the only way the Owner can lock themselves out,
so `retryAfter` has to be the real remaining wait. The page promises a number.

### 8. The PIN must not survive the request

Not in a redirect query parameter, not in a log line, not in an audit row. The
page never puts it back on screen; the route should not put it anywhere either.

---

## Gates added

| Gate | Proves |
| --- | --- |
| `scripts/test-owner-pin-login-ui-contract.mjs` | route, exactly two submitted fields, every PIN attribute, no client-trusted email, no Supabase, sanitised `returnTo`, every error code has copy, noindex, no PIN-shaped literal or env read, label/`aria-describedby`/`aria-invalid`, mobile CSS |
| `scripts/test-owner-pin-login-ui-contract-negative.mjs` | 34 specific regressions, each applied to a copy of the tree, each of which the gate must reject |
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
