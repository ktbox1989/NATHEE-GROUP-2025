# Public → Application handoff

How the public website hands its login entry point to the application, and what
must be true before that switch is thrown.

Two deployments exist and they are independent. Neither may be redeployed to
fix the other.

| | Public website | Application |
| --- | --- | --- |
| Domain | `https://natheegroup2025.com` | `https://app.natheegroup2025.com` |
| Hosting | Z.com shared hosting, static files | Vinext Cloudflare Worker runtime |
| Source | `public-site/` | `app/`, `lib/`, `db/`, `worker/` |
| Deploy | `scripts/deploy-zcom.sh` | Sites integration, see `PRODUCTION_GO_LIVE.md` |
| Status | **CLOSED / PASS** at `7d24518` | **NOT DEPLOYED** |

`scripts/deploy-zcom.sh` deploys the public static site only. It must never be
pointed at the application, and the application repository must never be copied
into `public_html`.

## The login redirect contract

Today `https://natheegroup2025.com/login/` serves a static, `noindex` status
page explaining that sign-in is not yet open. That is the safe default and it
stays until the application proves itself.

When activated, the apex hands off:

```text
https://natheegroup2025.com/login   →  302  →  https://app.natheegroup2025.com/login
https://natheegroup2025.com/login/  →  302  →  https://app.natheegroup2025.com/login
```

Contract details, each enforced by `scripts/test-login-redirect.sh`:

- **302, never 301.** A permanent redirect is cached by browsers and cannot be
  withdrawn if the application has to be rolled back.
- **Query parameters preserved** (`QSA`). The application login page reads
  `returnTo` and `error`; dropping them breaks the post-login destination.
  `returnTo` is validated by the application's own `safeReturnTo`, so passing
  it through does not create an open redirect.
- **HTTPS only.** The target is an absolute `https://` URL.
- **No loop.** A `RewriteCond` pins the rule to the canonical apex host, so the
  rule cannot fire if `app.natheegroup2025.com` is ever pointed at this same
  document root.
- **Still `noindex`.** `robots.txt` keeps `Disallow: /login/` and the local
  login page stays shipped in the release, so rollback needs no rebuild.

## The auth callback contract

The application owns `/auth/callback` on its own domain:

```text
https://app.natheegroup2025.com/auth/callback
```

The Supabase Auth configuration must name that exact URL. The public website
never proxies, mirrors or links the callback, and the callback destination is
derived from the application's trusted `APP_ORIGIN`, never from a request
`Host` header.

If the routing decision changes to edge-routing `/login`, `/auth`, `/app` and
`/api` from the apex instead of using a subdomain, this redirect is not used at
all and the Supabase callback stays on the apex. That choice is an Owner gate
recorded in `DEPLOYMENT_ARCHITECTURE.md`; it must be settled before activation.

## Activation procedure

Activation is deliberately two steps, and the first cannot be skipped.

Steps 1 to 3 run **locally or in CI**, where Node exists. Step 4 runs on
Z.com, which has no Node.

```bash
# 1. Prove the application is ready. Read-only; changes nothing.
bash scripts/verify-app-integration.sh > app-integration-gate.txt

# 2. Switch the release. Refused unless step 1 wrote APP_INTEGRATION_GATE_PASS.
node scripts/set-login-redirect.mjs --state active --evidence app-integration-gate.txt

# 3. Full regression, then commit and push.
bash scripts/test-login-redirect.sh
bash scripts/verify-public-site.sh
npm test

# 4. On Z.com, pull and deploy. The state gate must be told to expect ACTIVE,
#    and the same live integration evidence permits that.
NATHEE_EXPECT_LOGIN_REDIRECT=ACTIVE \
  bash scripts/verify-login-redirect-state.sh --evidence app-integration-gate.txt
bash scripts/deploy-zcom.sh
```

The integration gate fails closed unless **all** of the following hold:

- `/api/health` explicitly reports Owner PIN authentication, canonical origin,
  complete D1 and storage ready. A whole-platform `503 degraded` is accepted
  only in that narrow case: Supabase Admin for staff/customer administration
  and Turnstile for quotation submission are not Owner-login dependencies;
- `https://app.natheegroup2025.com/login` returns 200, posts to the Owner PIN
  endpoint, displays the fixed Owner account and has no editable email field;
- `/app/website` and private media both refuse an anonymous request;
- the anonymous public News API returns 200 with a non-empty response;
- nothing probed returns 5xx or is unreachable;
- the application is `noindex` and does not claim the public canonical URL;
- the application host does not serve the public site byte-for-byte, which
  would mean the redirect loops;
- the eight public routes still return 200 and the public release still passes
  `verify-public-site.sh`.

## Rollback procedure

Rollback is the same mechanism in reverse and needs no rebuild, because the
local login page ships in every release:

```bash
# locally or in CI
node scripts/set-login-redirect.mjs --state inactive
bash scripts/test-login-redirect.sh
# then on Z.com, where INACTIVE is the default expectation
bash scripts/verify-login-redirect-state.sh
bash scripts/deploy-zcom.sh
```

`scripts/test-login-redirect.sh` asserts that this restores the committed
release byte-for-byte.

If a deployment itself fails or its postcheck fails, `deploy-zcom.sh` restores
its own timestamped backup automatically. To roll back a completed deployment,
use the exact `BACKUP_PATH` it printed:

```bash
bash scripts/rollback-zcom.sh /home/zptqqwps/backups/nathee/<timestamp>
```

Because the handoff is a 302 and not a 301, browsers stop following it as soon
as the inactive release is live. A 301 would have to expire from every visitor's
cache first, which is why it is not used.

## Where each gate can run

Z.com shared hosting has no `node`, `npm` or `npx`, and none will be
installed. Gates are split by interpreter:

- **Portable bash — runs on Z.com and in CI:** `verify-public-site.sh`,
  `verify-login-redirect-state.sh`, `test-public-site-gate.sh`,
  `test-production-postcheck-contract.sh`, `test-public-seo-gates.sh`,
  `test-app-readiness.sh`, `test-deploy-file-tools.sh`,
  `postcheck-production.sh`, `verify-app-integration.sh`.
- **Node — local and CI only, before push or after deploy:**
  `test-login-redirect.sh`, `audit-live-public-site.mjs`,
  `build-public-site.mjs`, `set-login-redirect.mjs`.

Moving the Node suites off the web host does not weaken them; they run
earlier, where an interpreter exists. `test-deploy-file-tools.sh` fails if any
Z.com-set script invokes `node`, `npm` or `npx`, so a Node dependency cannot
become a Production gate again.

On Z.com the redirect state is proven by `verify-login-redirect-state.sh`,
which defaults to requiring `INACTIVE`. When told to expect `ACTIVE` it also
re-checks the rewrite contract in portable bash: 302 and never 301, `QSA`, an
HTTPS target, the apex host condition that prevents a loop, and the local login
page still shipped for rollback.

## Production verification procedure

Three tools, three different jobs. None of them proves the application is
accepted — that requires the signed-in acceptance flow in
`PRODUCTION_GO_LIVE.md`.

```bash
# Deep regression audit of the live public site. Run any time, from anywhere.
node scripts/audit-live-public-site.mjs

# Deployment gate. Runs on Z.com during a release; rolls back on failure.
bash scripts/postcheck-production.sh

# Component inventory across both deployments.
NATHEE_APP_BASE_URL='https://app.natheegroup2025.com' \
  bash scripts/audit-production-components.sh
```

`postcheck-production.sh` reads the login-redirect state from the release it is
deploying, so it expects 200 for an inactive release and a 302 to the declared
target for an active one. This matters: a postcheck that always expected 200
would fail a correct activation and roll it back.

`audit-production-components.sh` still reports whole-platform health. It is not
the release-specific Owner-login handoff gate and a supported Owner-PIN-only
runtime may remain `503 degraded` there while the narrower integration gate
passes. Authenticated acceptance remains separate evidence.

## What is proven today

Measured against the live site with `scripts/audit-live-public-site.mjs`:

- 11 public routes, 11 unique titles, 11 unique descriptions, correct canonical
  on each, exactly one `<h1>` per page, valid JSON-LD;
- every image carries `alt` and intrinsic `width`/`height`, and every gallery
  image carries `srcset` and `sizes`;
- 36 internal references resolve, sitemap lists exactly the 11 public routes,
  robots excludes `/login/`, `/login-status.html`, `/auth/`, `/app/`, `/api/`;
- `/login/` and unknown paths return a `noindex` `X-Robots-Tag`;
- the manifest is valid, served as `application/manifest+json`, with every icon
  resolving;
- `www` redirects permanently to the apex.

Not proven, and not claimable until Lane B supplies evidence: anything about
the application runtime, sign-in, or customer isolation.
