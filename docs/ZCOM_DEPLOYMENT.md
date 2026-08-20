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
GIT_SSH_COMMAND='ssh -i ~/.ssh/nathee_deploy -p 443' git pull origin main
```

## Verify and deploy

```bash
cd /home/zptqqwps/nathee-deploy
bash scripts/verify-public-site.sh
bash scripts/deploy-zcom.sh
```

The deploy script:

1. refuses to run outside the approved account and staging path;
2. prevents concurrent deployments;
3. verifies the static source and rejects demo/placeholder content;
4. creates a complete timestamped `tar` backup, extracted snapshot, and SHA-256 manifests;
5. stages and verifies release files without requiring `rsync`, package installation, or root access;
6. atomically replaces only files named by the verified release manifest;
7. never deletes unknown Production files during deployment;
8. tests the live domain, canonical URLs, redirects, headers, assets, and 404;
9. automatically restores the backup if deployment or postcheck fails.

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
`snapshot/` and `SHA256SUMS.txt`.

## HSTS rollout

The first static release uses `Strict-Transport-Security: max-age=300` without
`includeSubDomains`. Increase it only after HTTPS, redirects, and all required
subdomains have been accepted. HSTS cannot be instantly reversed in browsers
that have cached it.
