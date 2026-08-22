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

```bash
# 1. Prove the application is ready. Read-only; changes nothing.
bash scripts/verify-app-integration.sh > app-integration-gate.txt

# 2. Switch the release. Refused unless step 1 wrote APP_INTEGRATION_GATE_PASS.
node scripts/set-login-redirect.mjs --state active --evidence app-integration-gate.txt

# 3. Verify, then deploy through the existing guarded flow.
bash scripts/test-login-redirect.sh
bash scripts/verify-public-site.sh
# then the normal Z.com deployment, which backs up and postchecks
```

The integration gate fails closed unless **all** of the following hold:

- `/api/health` returns 200 with all six checks true; an **absent** check fails
  too, so an older runtime cannot pass by omission;
- `https://app.natheegroup2025.com/login` returns 200 with a non-empty body;
- `/auth/callback` exists (any status except 404 or 5xx);
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
node scripts/set-login-redirect.mjs --state inactive
bash scripts/test-login-redirect.sh
# redeploy through the guarded Z.com flow
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

`audit-production-components.sh` reports
`full-application=RUNTIME_HEALTHY_ANONYMOUS_GATED`, never `LIVE`, and prints
`PRODUCTION_NOT_PROVEN` for real login, OWNER mapping, customer isolation and
QR scanning.

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
