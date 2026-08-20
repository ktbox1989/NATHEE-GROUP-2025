# Z.com static public-site deployment

## Architecture boundary

- `public-site/` is the static company website deployed to Z.com cPanel.
- `app/`, `lib/`, `db/`, `worker/`, and `drizzle/` are the real logistics
  application and are not copied into the static web root.
- Production business data must never be stored in the static site or browser
  storage.

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

## Verify and deploy

```bash
cd /home/zptqqwps/nathee-deploy
bash scripts/verify-public-site.sh
bash scripts/test-deploy-file-tools.sh
bash scripts/test-public-seo-gates.sh
bash scripts/deploy-zcom.sh
bash scripts/postcheck-production.sh
```

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
critical bytes. The current static package contains no content images; if an
`img` is added later, verification fails unless it has an explicit `alt`
attribute. Authenticated application routes are never listed in the sitemap.

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
