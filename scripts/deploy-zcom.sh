#!/usr/bin/env bash
set -Eeuo pipefail

EXPECTED_USER="zptqqwps"
PRODUCTION_ROOT="/home/zptqqwps/public_html/natheegroup2025.com"
BACKUP_ROOT="/home/zptqqwps/backups/nathee"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
SOURCE_ROOT="$REPO_ROOT/public-site"
LOCK_DIR="/home/zptqqwps/.nathee-deploy.lock.d"
NATHEE_TEMP_PARENT="/home/zptqqwps"

# shellcheck source=scripts/lib/deploy-file-tools.sh
source "$SCRIPT_DIR/lib/deploy-file-tools.sh"

fail() {
  printf 'DEPLOY_FAIL: %s\n' "$1" >&2
  exit 1
}

[[ "$(id -un)" == "$EXPECTED_USER" ]] || fail "must run as $EXPECTED_USER"
[[ "$REPO_ROOT" == "/home/zptqqwps/nathee-deploy" ]] || fail "repository path is not the approved staging path"
[[ "$PRODUCTION_ROOT" == "/home/zptqqwps/public_html/natheegroup2025.com" ]] || fail "production path guard failed"
[[ -d "$SOURCE_ROOT" ]] || fail "public-site source is missing"
[[ -d "$PRODUCTION_ROOT" ]] || fail "production root is missing"

for required_command in bash tar cp mv mkdir rmdir find sha256sum cut curl grep awk tr wc dirname rm date git; do
  if command -v "$required_command" >/dev/null 2>&1; then
    printf 'DEPLOY_CAPABILITY %s=PRESENT\n' "$required_command"
  else
    fail "$required_command is required"
  fi
done
if command -v mktemp >/dev/null 2>&1; then
  printf 'DEPLOY_CAPABILITY mktemp=PRESENT\n'
else
  printf 'DEPLOY_CAPABILITY mktemp=FALLBACK_SAFE_MKDIR\n'
fi

timestamp="$(date -u +%Y%m%d-%H%M%S)"
backup_dir="$BACKUP_ROOT/$timestamp"
stage_dir=""
lock_acquired=0
deployment_started=0
deployment_succeeded=0

cleanup() {
  local exit_code=$?
  trap - EXIT
  if [[ -n "$stage_dir" ]]; then
    case "$stage_dir" in
      "$NATHEE_TEMP_PARENT"/nathee-release-*) rm -rf "$stage_dir" ;;
      *)
        printf 'DEPLOY_CLEANUP_FAIL unsafe_stage=%s\n' "$stage_dir" >&2
        [[ $exit_code -ne 0 ]] || exit_code=1
        ;;
    esac
  fi
  if [[ $exit_code -ne 0 && $deployment_started -eq 1 && $deployment_succeeded -eq 0 ]]; then
    printf 'DEPLOY_ROLLBACK_START backup=%s\n' "$backup_dir" >&2
    if bash "$SCRIPT_DIR/rollback-zcom.sh" "$backup_dir"; then
      printf 'DEPLOY_ROLLBACK_PASS backup=%s\n' "$backup_dir" >&2
    else
      printf 'DEPLOY_ROLLBACK_FAILED backup=%s\n' "$backup_dir" >&2
    fi
  fi
  if [[ $lock_acquired -eq 1 ]]; then
    if nathee_release_lock_dir "$LOCK_DIR"; then
      printf 'DEPLOY_LOCK_RELEASED=%s\n' "$LOCK_DIR"
    else
      printf 'DEPLOY_LOCK_RELEASE_FAIL=%s\n' "$LOCK_DIR" >&2
      [[ $exit_code -ne 0 ]] || exit_code=1
    fi
  fi
  exit "$exit_code"
}
trap cleanup EXIT

nathee_acquire_lock_dir "$LOCK_DIR" || fail "another deployment may be running; inspect $LOCK_DIR before removing a stale lock"
lock_acquired=1
printf 'DEPLOY_LOCK_ACQUIRED=%s\n' "$LOCK_DIR"

bash "$SCRIPT_DIR/verify-public-site.sh" "$SOURCE_ROOT"
nathee_assert_safe_tree "$SOURCE_ROOT" || fail "release contains an unsafe or empty file tree"

stage_dir="$(nathee_make_temp_dir "nathee-release-${timestamp}")" || fail "could not create a safe staging directory"

nathee_create_backup "$PRODUCTION_ROOT" "$backup_dir" || fail "could not create and verify Production backup"
nathee_write_file_manifest "$SOURCE_ROOT" "$backup_dir/RELEASE_SHA256SUMS.txt" || fail "could not create release manifest"
[[ -s "$backup_dir/RELEASE_SHA256SUMS.txt" ]] || fail "release manifest is empty"
nathee_write_created_manifest "$SOURCE_ROOT" "$PRODUCTION_ROOT" "$backup_dir/CREATED_FILES.txt" || fail "could not record release-created files"
nathee_finalize_backup_metadata "$backup_dir" || fail "could not seal deployment metadata checksums"
printf 'BACKUP_PATH=%s\n' "$backup_dir"

nathee_stage_tree "$SOURCE_ROOT" "$stage_dir" || fail "could not stage release"
bash "$SCRIPT_DIR/verify-public-site.sh" "$stage_dir"
nathee_verify_file_manifest "$stage_dir" "$backup_dir/RELEASE_SHA256SUMS.txt" || fail "staged release checksum mismatch"

deployment_started=1
# Only files listed by the verified release are atomically replaced. Unknown
# Production files are neither traversed for deletion nor removed.
nathee_apply_tree "$stage_dir" "$PRODUCTION_ROOT" "$timestamp" || fail "atomic release copy failed"
nathee_verify_file_manifest "$PRODUCTION_ROOT" "$backup_dir/RELEASE_SHA256SUMS.txt" || fail "deployed release checksum mismatch"

bash "$SCRIPT_DIR/postcheck-production.sh"
git -C "$REPO_ROOT" rev-parse HEAD > "$backup_dir/DEPLOYED_COMMIT"
deployment_succeeded=1
printf 'DEPLOY_PASS commit=%s backup=%s\n' "$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)" "$backup_dir"
