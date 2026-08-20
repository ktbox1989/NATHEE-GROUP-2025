#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=scripts/lib/deploy-file-tools.sh
source "$SCRIPT_DIR/lib/deploy-file-tools.sh"

fail() {
  printf 'DEPLOY_FILE_TOOLS_TEST_FAIL: %s\n' "$1" >&2
  exit 1
}

test_root="$(nathee_make_temp_dir nathee-deploy-test)" || fail "test temp directory"
trap 'rm -rf "$test_root"' EXIT
NATHEE_TEMP_PARENT="$test_root"

source_root="$test_root/source"
production_root="$test_root/production"
stage_root="$test_root/stage"
backup_dir="$test_root/backup"
mkdir -p "$source_root/assets" "$source_root/services" "$production_root/legacy" "$stage_root"

printf 'new homepage\n' > "$source_root/index.html"
printf 'new stylesheet\n' > "$source_root/assets/site.css"
printf 'services page\n' > "$source_root/services/index.html"
printf 'old homepage\n' > "$production_root/index.html"
printf 'preserve legacy\n' > "$production_root/legacy/unknown.txt"

nathee_create_backup "$production_root" "$backup_dir" || fail "backup creation"
nathee_write_file_manifest "$source_root" "$backup_dir/RELEASE_SHA256SUMS.txt" || fail "release manifest"
nathee_write_created_manifest "$source_root" "$production_root" "$backup_dir/CREATED_FILES.txt" || fail "created-file manifest"
nathee_finalize_backup_metadata "$backup_dir" || fail "backup metadata"
nathee_stage_tree "$source_root" "$stage_root" || fail "staging"
nathee_verify_file_manifest "$stage_root" "$backup_dir/RELEASE_SHA256SUMS.txt" || fail "stage verification"
nathee_apply_tree "$stage_root" "$production_root" test || fail "atomic deployment"
nathee_verify_file_manifest "$production_root" "$backup_dir/RELEASE_SHA256SUMS.txt" || fail "deployment verification"

grep -Fqx 'new homepage' "$production_root/index.html" || fail "intended file was not replaced"
grep -Fqx 'services page' "$production_root/services/index.html" || fail "nested clean route was not deployed"
grep -Fqx 'preserve legacy' "$production_root/legacy/unknown.txt" || fail "unknown file was changed"
grep -Fqx 'assets/site.css' "$backup_dir/CREATED_FILES.txt" || fail "created file was not recorded"

# Files created by another process after deployment must survive rollback.
printf 'created externally\n' > "$production_root/external-after-deploy.txt"
nathee_restore_backup "$backup_dir" "$production_root" || fail "rollback"

grep -Fqx 'old homepage' "$production_root/index.html" || fail "original file was not restored"
[[ ! -e "$production_root/assets/site.css" ]] || fail "release-created file was not removed"
[[ ! -e "$production_root/services/index.html" ]] || fail "nested release-created file was not removed"
grep -Fqx 'preserve legacy' "$production_root/legacy/unknown.txt" || fail "unknown backup file was not restored"
grep -Fqx 'created externally' "$production_root/external-after-deploy.txt" || fail "post-deploy unknown file was deleted"

tampered_backup="$test_root/tampered-backup"
mkdir -p "$tampered_backup"
tar -C "$backup_dir" -cpf - . | tar -C "$tampered_backup" -xpf -
printf 'tamper\n' >> "$tampered_backup/production.tar"
if nathee_restore_backup "$tampered_backup" "$production_root" >/dev/null 2>&1; then
  fail "tampered backup was accepted"
fi

tampered_metadata="$test_root/tampered-metadata"
mkdir -p "$tampered_metadata"
tar -C "$backup_dir" -cpf - . | tar -C "$tampered_metadata" -xpf -
printf 'external-after-deploy.txt\n' >> "$tampered_metadata/CREATED_FILES.txt"
if nathee_restore_backup "$tampered_metadata" "$production_root" >/dev/null 2>&1; then
  fail "tampered deletion manifest was accepted"
fi
grep -Fqx 'created externally' "$production_root/external-after-deploy.txt" || fail "metadata tamper deleted an unrelated file"

if grep -Eq '(^|[^[:alpha:]])rsync([^[:alpha:]]|$)' \
  "$SCRIPT_DIR/deploy-zcom.sh" "$SCRIPT_DIR/rollback-zcom.sh"; then
  fail "deployment still depends on rsync"
fi

if grep -Eq '(^|[^[:alpha:]])flock([^[:alpha:]]|$)' \
  "$SCRIPT_DIR/deploy-zcom.sh" "$SCRIPT_DIR/rollback-zcom.sh"; then
  fail "deployment still depends on flock"
fi

process_substitution_token='<''('
if grep -Fq "$process_substitution_token" \
  "$SCRIPT_DIR/lib/deploy-file-tools.sh" \
  "$SCRIPT_DIR/deploy-zcom.sh" \
  "$SCRIPT_DIR/rollback-zcom.sh" \
  "$SCRIPT_DIR/postcheck-production.sh" \
  "$SCRIPT_DIR/verify-public-site.sh"; then
  fail "process substitution is still present"
fi

NATHEE_DISABLE_MKTEMP=1
fallback_directory="$(nathee_make_temp_dir nathee-fallback-test)" || fail "mktemp fallback"
[[ -d "$fallback_directory" ]] || fail "mktemp fallback did not create a directory"
rm -rf "$fallback_directory"
unset NATHEE_DISABLE_MKTEMP

lock_dir="$test_root/deploy.lock.d"
nathee_acquire_lock_dir "$lock_dir" || fail "portable lock acquisition"
if nathee_acquire_lock_dir "$lock_dir" >/dev/null 2>&1; then
  fail "concurrent portable lock was accepted"
fi
printf 'not-the-owner\n' > "$lock_dir/owner.pid"
if nathee_release_lock_dir "$lock_dir" >/dev/null 2>&1; then
  fail "portable lock released by the wrong owner"
fi
printf '%s\n' "$$" > "$lock_dir/owner.pid"
nathee_release_lock_dir "$lock_dir" || fail "portable lock release"
[[ ! -e "$lock_dir" ]] || fail "portable lock directory remains"

printf 'DEPLOY_FILE_TOOLS_TEST_PASS backup=verified nested_routes=verified unknown=preserved rollback=verified tar_tamper=rejected metadata_tamper=rejected rsync=absent flock=absent dev_fd=absent mktemp_fallback=verified lock=atomic_mkdir\n'
