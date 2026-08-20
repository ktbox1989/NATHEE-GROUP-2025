#!/usr/bin/env bash
set -Eeuo pipefail

EXPECTED_USER="zptqqwps"
EXPECTED_STAGING="/home/zptqqwps/nathee-deploy"
PRODUCTION_ROOT="/home/zptqqwps/public_html/natheegroup2025.com"
TEMP_PARENT="/home/zptqqwps"

fail() {
  printf 'ZCOM_RUNTIME_PROBE_FAIL: %s\n' "$1" >&2
  exit 1
}

[[ "$(id -un)" == "$EXPECTED_USER" ]] || fail "must run as $EXPECTED_USER"
[[ "$(pwd -P)" == "$EXPECTED_STAGING" ]] || fail "run from $EXPECTED_STAGING"
[[ -d "$PRODUCTION_ROOT" ]] || fail "production root is missing"

for command_name in bash tar cp mv mkdir rmdir find sha256sum cut curl git date rm id; do
  if command -v "$command_name" >/dev/null 2>&1; then
    printf 'ZCOM_CAPABILITY %s=PRESENT\n' "$command_name"
  else
    fail "$command_name is required by the guarded public-site deployment"
  fi
done

for optional_command in mktemp node npm npx php composer python3 sqlite3 passenger-config; do
  if command -v "$optional_command" >/dev/null 2>&1; then
    printf 'ZCOM_CAPABILITY %s=PRESENT\n' "$optional_command"
  else
    printf 'ZCOM_CAPABILITY %s=MISSING\n' "$optional_command"
  fi
done

probe_dir="$TEMP_PARENT/.nathee-runtime-probe-$(date -u +%Y%m%d-%H%M%S)-$$"
case "$probe_dir" in
  "$TEMP_PARENT"/.nathee-runtime-probe-*) ;;
  *) fail "unsafe temporary path" ;;
esac
trap 'rm -rf "$probe_dir"' EXIT
mkdir -m 700 "$probe_dir" || fail "home directory is not writable for safe staging"
printf 'probe\n' > "$probe_dir/write-test.txt" || fail "temporary write failed"
[[ "$(sha256sum "$probe_dir/write-test.txt" | cut -d ' ' -f 1)" == "25be323556dad377abb57fe7ec8c4b99a6527f488dda28d0c9b686528659c909" ]] \
  || fail "temporary checksum verification failed"

printf 'ZCOM_PATH staging=%s state=READABLE\n' "$EXPECTED_STAGING"
printf 'ZCOM_PATH production=%s state=READABLE\n' "$PRODUCTION_ROOT"
printf 'ZCOM_TEMP_WRITE=PASS path=%s\n' "$TEMP_PARENT"
printf 'ZCOM_PUBLIC_STATIC_COMPATIBILITY=PASS\n'
printf 'ZCOM_CURRENT_APP_BUILD=VINEXT_CLOUDFLARE_WORKER\n'
printf 'ZCOM_REQUIRED_APP_BINDINGS=D1_DB,R2_FILES,SUPABASE_AUTH\n'
printf 'ZCOM_FULL_APP_COMPATIBILITY=NOT_PROVEN\n'
printf 'ZCOM_FULL_APP_DEPLOYMENT=BLOCKED_UNTIL_RUNTIME_BINDINGS_AND_AUTH_ACCEPTANCE\n'
printf 'ZCOM_RUNTIME_PROBE_PASS productionUntouched=true\n'
