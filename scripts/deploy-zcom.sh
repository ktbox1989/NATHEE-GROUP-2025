#!/usr/bin/env bash
set -Eeuo pipefail

EXPECTED_USER="zptqqwps"
PRODUCTION_ROOT="/home/zptqqwps/public_html/natheegroup2025.com"
BACKUP_ROOT="/home/zptqqwps/backups/nathee"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
SOURCE_ROOT="$REPO_ROOT/public-site"
LOCK_FILE="/home/zptqqwps/.nathee-deploy.lock"

fail() {
  printf 'DEPLOY_FAIL: %s\n' "$1" >&2
  exit 1
}

[[ "$(id -un)" == "$EXPECTED_USER" ]] || fail "must run as $EXPECTED_USER"
[[ "$REPO_ROOT" == "/home/zptqqwps/nathee-deploy" ]] || fail "repository path is not the approved staging path"
[[ "$PRODUCTION_ROOT" == "/home/zptqqwps/public_html/natheegroup2025.com" ]] || fail "production path guard failed"
[[ -d "$SOURCE_ROOT" ]] || fail "public-site source is missing"
[[ -d "$PRODUCTION_ROOT" ]] || fail "production root is missing"

command -v flock >/dev/null || fail "flock is required"
command -v rsync >/dev/null || fail "rsync is required"
command -v sha256sum >/dev/null || fail "sha256sum is required"
command -v curl >/dev/null || fail "curl is required"

exec 9>"$LOCK_FILE"
flock -n 9 || fail "another NATHEE deployment is already running"

"$SCRIPT_DIR/verify-public-site.sh" "$SOURCE_ROOT"

timestamp="$(date -u +%Y%m%d-%H%M%S)"
backup_dir="$BACKUP_ROOT/$timestamp"
stage_dir="$(mktemp -d "/home/zptqqwps/nathee-release-${timestamp}.XXXXXX")"
deployment_started=0
deployment_succeeded=0

cleanup() {
  local exit_code=$?
  rm -rf -- "$stage_dir"
  if [[ $exit_code -ne 0 && $deployment_started -eq 1 && $deployment_succeeded -eq 0 ]]; then
    printf 'DEPLOY_ROLLBACK_START backup=%s\n' "$backup_dir" >&2
    "$SCRIPT_DIR/rollback-zcom.sh" "$backup_dir" || printf 'DEPLOY_ROLLBACK_FAILED backup=%s\n' "$backup_dir" >&2
  fi
  exit "$exit_code"
}
trap cleanup EXIT

mkdir -p -- "$backup_dir/snapshot"
cp -a -- "$PRODUCTION_ROOT/." "$backup_dir/snapshot/"
(
  cd -- "$backup_dir/snapshot"
  find . -type f -print0 | sort -z | xargs -0 -r sha256sum > "$backup_dir/SHA256SUMS.txt"
)
[[ -s "$backup_dir/SHA256SUMS.txt" ]] || fail "production backup manifest is empty"
(
  cd -- "$backup_dir/snapshot"
  sha256sum --check --strict ../SHA256SUMS.txt
)

rsync -a --checksum -- "$SOURCE_ROOT/" "$stage_dir/"
"$SCRIPT_DIR/verify-public-site.sh" "$stage_dir"

deployment_started=1
# No --delete: unknown Production files remain untouched. Intended release
# files, including the reviewed static .htaccess, are replaced after backup.
rsync -a --checksum -- "$stage_dir/" "$PRODUCTION_ROOT/"

"$SCRIPT_DIR/postcheck-production.sh"
deployment_succeeded=1

git -C "$REPO_ROOT" rev-parse HEAD > "$backup_dir/DEPLOYED_COMMIT"
printf 'DEPLOY_PASS commit=%s backup=%s\n' "$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)" "$backup_dir"
