# Z.com static public-site deployment

## Architecture boundary

- `public-site/` is the static company website deployed to Z.com cPanel.
- `app/`, `lib/`, `db/`, `worker/`, and `drizzle/` are the real logistics
  application and are not copied into the static web root.
- Production business data must never be stored in the static site or browser
  storage.
- `DEPLOY_PASS` and `PRODUCTION_POSTCHECK_PASS` in this runbook cover only the
  public static component. They must never be reported as full-system success.
- See `DEPLOYMENT_ARCHITECTURE.md` for the application runtime and activation
  gates.

## Verified paths

```text
Repository:      /home/zptqqwps/nathee-deploy
Production root: /home/zptqqwps/public_html/natheegroup2025.com
Backups:         /home/zptqqwps/backups/nathee/<UTC timestamp>/
```

## Pull

```bash
cd /home/zptqqwps/nathee-deploy
GIT_SSH_COMMAND='ssh -i ~/.ssh/nathee_deploy -p 443' git pull --ff-only origin main
```

## Where each gate runs

Z.com shared hosting has **no node, npm or npx**. `probe-zcom-runtime.sh`
reports them as `MISSING`, and that is expected and permanent: do not install
a runtime on the web host.

Gates are therefore split by interpreter, not by importance.

| Gate | Runs where | Why |
| --- | --- | --- |
| `verify-public-site.sh` | Z.com + CI | portable bash |
| `verify-login-redirect-state.sh` | Z.com + CI | portable bash |
| `test-public-site-gate.sh` | Z.com + CI | portable bash |
| `test-production-postcheck-contract.sh` | Z.com + CI | portable bash |
| `test-public-seo-gates.sh` | Z.com + CI | portable bash |
| `test-app-readiness.sh` | Z.com + CI | portable bash |
| `test-deploy-file-tools.sh` | Z.com + CI | portable bash |
| `postcheck-production.sh` | Z.com | portable bash, run by the deploy |
| `test-login-redirect.sh` | **local/CI only** | drives Node |
| `audit-live-public-site.mjs` | **local/CI only** | Node, run after deploy |
| `build-public-site.mjs`, `set-login-redirect.mjs` | **local/CI only** | Node |

`test-deploy-file-tools.sh` enforces this split: it fails if any script in the
Z.com set invokes `node`, `npm` or `npx`, so a Node dependency cannot reach a
Production gate again. It matches command position only, so the optional
capability list inside `probe-zcom-runtime.sh` is not mistaken for a
dependency.

## Before pushing (local or CI)

The Node-driven regression suites are not weakened by being moved off the web
host; they simply run earlier, where a Node runtime exists.

```bash
npm ci
npm run lint
npm test
bash scripts/test-login-redirect.sh
```

## Verify and deploy (Z.com)

Portable bash only.

```bash
cd /home/zptqqwps/nathee-deploy
bash scripts/probe-zcom-runtime.sh
bash scripts/verify-public-site.sh
bash scripts/verify-login-redirect-state.sh
bash scripts/test-public-site-gate.sh
bash scripts/test-production-postcheck-contract.sh
bash scripts/test-public-seo-gates.sh
bash scripts/test-app-readiness.sh
bash scripts/test-deploy-file-tools.sh
bash scripts/deploy-zcom.sh
bash scripts/audit-production-components.sh
```

`verify-login-redirect-state.sh` defaults to requiring the release to declare
`INACTIVE`, so a release that would hand `/login/` to the application is
rejected on the deploying host. Expecting `ACTIVE` requires evidence:

```bash
NATHEE_EXPECT_LOGIN_REDIRECT=ACTIVE \
  bash scripts/verify-login-redirect-state.sh --evidence app-runtime-pass.txt
```

The evidence file must contain `APP_RUNTIME_PASS` from Lane B. When the state
is `ACTIVE` the gate also re-checks the rewrite contract with portable tools:
302 and never 301, `QSA`, an HTTPS target, the apex host condition that
prevents a loop, and the local login page still shipped for rollback.

## After deploying (local or CI)

`deploy-zcom.sh` already runs `postcheck-production.sh` and rolls back on
failure. Run the deeper Node audit from a machine that has Node, pointed at the
Production URL:

```bash
node scripts/audit-live-public-site.mjs https://natheegroup2025.com
```

It must report `LIVE_AUDIT_PASS ... problems=0`.

The deploy script:

1. refuses to run outside the approved account and staging path;
2. refuses a dirty staging worktree and prints the exact source commit;
3. prevents concurrent deployments with an atomic directory lock, without requiring `flock`;
4. verifies the static source and rejects demo/placeholder content;
5. creates a complete timestamped `tar` backup, extracted snapshot, and SHA-256 manifests;
6. prints the exact verified directory as `BACKUP_PATH=/home/zptqqwps/backups/nathee/<timestamp>`;
7. stages and verifies release files without requiring `rsync`, `/dev/fd`, package installation, executable script bits, or root access;
8. atomically replaces only files named by the verified release manifest;
9. never deletes unknown Production files during deployment;
10. tests the live domain, canonical URLs, redirects, headers, assets, and 404;
11. automatically restores the exact backup if deployment or postcheck fails.

SEO is a mandatory fail-closed deployment gate. The source verifier and live
postcheck require one canonical homepage URL, complete title/description/Open
Graph/Twitter metadata, valid Organization JSON-LD, a public-only sitemap,
robots exclusions plus HTTP `X-Robots-Tag` protection for noindex pages, image
alt attributes, deferred JavaScript, responsive breakpoints, and bounded mobile
critical bytes. Every `img` must carry an explicit `alt` attribute. The release also fails
closed when any referenced `/assets/` file is absent, when server-rendered HTML
still shows the client-side loading placeholder, when the homepage does not
render real company work photography, or when `/gallery/` does not
server-render the nine approved photographs. `scripts/test-public-site-gate.sh`
proves each of those guards by rejecting deliberately broken copies of the real
release. Authenticated application routes are never listed in the sitemap.

Each backup also records `CREATED_FILES.txt`. Rollback removes only files that
the exact release created and then atomically restores the verified snapshot;
the checksum-verified `production.tar` remains immutable backup evidence.
Unrelated files created after deployment are preserved.

## Manual rollback

```bash
cd /home/zptqqwps/nathee-deploy
bash scripts/rollback-zcom.sh /home/zptqqwps/backups/nathee/YYYYMMDD-HHMMSS
```

Do not guess a backup path. Use an existing timestamp directory containing
`snapshot/`, `production.tar`, `SHA256SUMS.txt`, and
`DEPLOY_METADATA_SHA256SUMS.txt`. Copy the exact `BACKUP_PATH` printed by the
deployment; the `YYYYMMDD-HHMMSS` text above is only the documented format.

## Shared-hosting compatibility

All helper scripts are invoked through `bash`. File enumeration uses ordinary
temporary files rather than process substitution, so the runtime does not
depend on `/dev/fd`. If `mktemp` is unavailable, atomic `mkdir`/noclobber
fallbacks create private timestamped temporary paths. Deployment locking also
uses atomic `mkdir`, so `flock` is not required. The deploy preflight
prints each required capability before backup or mutation begins.

## HSTS rollout

The first static release uses `Strict-Transport-Security: max-age=300` without
`includeSubDomains`. Increase it only after HTTPS, redirects, and all required
subdomains have been accepted. HSTS cannot be instantly reversed in browsers
that have cached it.
