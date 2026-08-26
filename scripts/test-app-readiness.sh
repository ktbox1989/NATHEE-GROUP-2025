#!/usr/bin/env bash
set -Eeuo pipefail

# Proves the application readiness decisions used by
# scripts/audit-production-components.sh. These decide whether a runtime may be
# reported as healthy, so they are tested against fixtures rather than trusted.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

# shellcheck source=scripts/lib/app-readiness.sh
source "$SCRIPT_DIR/lib/app-readiness.sh"
# shellcheck source=scripts/lib/deploy-file-tools.sh
source "$SCRIPT_DIR/lib/deploy-file-tools.sh"

fail() {
  printf 'APP_READINESS_TEST_FAIL: %s\n' "$1" >&2
  exit 1
}

WORK_ROOT=""
cleanup() {
  local exit_code=$?
  trap - EXIT
  if [[ -n "$WORK_ROOT" && -d "$WORK_ROOT" ]]; then
    case "$WORK_ROOT" in
      */nathee-app-readiness.*) rm -rf "$WORK_ROOT" ;;
      *) printf 'APP_READINESS_CLEANUP_SKIPPED unsafe=%s\n' "$WORK_ROOT" >&2 ;;
    esac
  fi
  exit "$exit_code"
}
trap cleanup EXIT

WORK_ROOT="$(nathee_make_temp_dir nathee-app-readiness)" || fail "could not create a temporary directory"

cases_run=0

write_health() {
  printf '%s' "$1" > "$WORK_ROOT/health.json"
}

expect_failures() {
  local label="$1"
  local expected="$2"
  local actual=""
  actual="$(nathee_health_failures "$WORK_ROOT/health.json" | tr '\n' ' ' | sed 's/ *$//')"
  [[ "$actual" == "$expected" ]] || fail "$label: expected failures [$expected], got [$actual]"
  cases_run=$((cases_run + 1))
  printf 'READINESS_CASE %s\n' "$label"
}

all_true='{"checks":{"authentication":true,"adminAuthentication":true,"canonicalOrigin":true,"database":true,"storage":true,"antiAbuse":true}}'

write_health "$all_true"
expect_failures complete-runtime ""

# The previous audit checked only five gates, so a runtime with anti-abuse
# unconfigured could be reported as healthy. It must now fail closed.
write_health '{"checks":{"authentication":true,"adminAuthentication":true,"canonicalOrigin":true,"database":true,"storage":true,"antiAbuse":false}}'
expect_failures anti-abuse-false "antiAbuse-false"

# An older runtime that predates a check must not pass by omission.
write_health '{"checks":{"authentication":true,"adminAuthentication":true,"canonicalOrigin":true,"database":true,"storage":true}}'
expect_failures anti-abuse-absent "antiAbuse-absent"

write_health '{"checks":{"authentication":false,"adminAuthentication":true,"canonicalOrigin":true,"database":true,"storage":false,"antiAbuse":true}}'
expect_failures auth-and-storage-false "authentication-false storage-false"

write_health '{"checks":{}}'
expect_failures empty-checks "authentication-absent adminAuthentication-absent canonicalOrigin-absent database-absent storage-absent antiAbuse-absent"

: > "$WORK_ROOT/health.json"
expect_failures empty-body "health-response-empty"

# A truthy-looking string must not satisfy a boolean gate.
write_health '{"checks":{"authentication":"true","adminAuthentication":true,"canonicalOrigin":true,"database":true,"storage":true,"antiAbuse":true}}'
expect_failures string-not-boolean "authentication-false"

expect_owner_failures() {
  local label="$1"
  local expected="$2"
  local actual=""
  actual="$(nathee_owner_login_health_failures "$WORK_ROOT/health.json" | tr '\n' ' ' | sed 's/ *$//')"
  [[ "$actual" == "$expected" ]] || fail "$label: expected Owner-login failures [$expected], got [$actual]"
  cases_run=$((cases_run + 1))
  printf 'OWNER_LOGIN_READINESS_CASE %s\n' "$label"
}

# Owner-PIN-only is a supported partial runtime: Supabase Admin and Turnstile
# are unrelated to the Owner CMS path and may be false without weakening it.
write_health '{"status":"degraded","checks":{"authentication":true,"adminAuthentication":false,"canonicalOrigin":true,"database":true,"storage":true,"antiAbuse":false},"auth":{"mode":"owner-pin","ownerPin":true,"supabase":false,"supabaseAdmin":false}}'
expect_owner_failures owner-pin-with-optional-services-absent ""

write_health '{"status":"degraded","checks":{"authentication":true,"adminAuthentication":false,"canonicalOrigin":true,"database":true,"storage":true,"antiAbuse":false},"auth":{"mode":"owner-pin+supabase","ownerPin":true,"supabase":true,"supabaseAdmin":false}}'
expect_owner_failures owner-pin-plus-supabase-with-admin-absent ""

write_health '{"checks":{"authentication":false,"canonicalOrigin":true,"database":true,"storage":true},"auth":{"mode":"none","ownerPin":false}}'
expect_owner_failures owner-pin-unconfigured "authentication-false ownerPin-false ownerPinMode-wrong"

write_health '{"checks":{"authentication":true,"canonicalOrigin":false,"database":true,"storage":true},"auth":{"mode":"owner-pin","ownerPin":true}}'
expect_owner_failures canonical-origin-required "canonicalOrigin-false"

write_health '{"checks":{"authentication":true,"canonicalOrigin":true,"database":false,"storage":true},"auth":{"mode":"owner-pin","ownerPin":true}}'
expect_owner_failures database-required "database-false"

write_health '{"checks":{"authentication":true,"canonicalOrigin":true,"database":true,"storage":false},"auth":{"mode":"owner-pin","ownerPin":true}}'
expect_owner_failures storage-required "storage-false"

write_health '{"checks":{"authentication":"true","canonicalOrigin":"true","database":"true","storage":"true"},"auth":{"mode":"owner-pin","ownerPin":"true"}}'
expect_owner_failures truthy-strings-rejected "authentication-false canonicalOrigin-false database-false storage-false ownerPin-false"

write_health '{"checks":{"authentication":true,"canonicalOrigin":true,"database":true,"storage":true}}'
expect_owner_failures auth-detail-cannot-be-omitted "ownerPin-absent ownerPinMode-absent"

expect_gate() {
  local status="$1"
  local expected_verdict="$2"
  local expected_ok="$3"
  local verdict=""
  verdict="$(nathee_anonymous_gate_verdict "$status")"
  [[ "$verdict" == "$expected_verdict" ]] || fail "status $status: expected verdict $expected_verdict, got $verdict"
  if nathee_anonymous_gate_ok "$status"; then
    [[ "$expected_ok" == "ok" ]] || fail "status $status was accepted but must be rejected"
  else
    [[ "$expected_ok" == "reject" ]] || fail "status $status was rejected but must be accepted"
  fi
  cases_run=$((cases_run + 1))
  printf 'GATE_CASE status=%s verdict=%s\n' "$status" "$verdict"
}

# Serving a protected page to a signed-out visitor is the failure that matters.
expect_gate 200 LEAKED reject
expect_gate 302 redirected ok
expect_gate 303 redirected ok
expect_gate 307 redirected ok
expect_gate 401 denied ok
expect_gate 403 denied ok
expect_gate 404 hidden ok
expect_gate 500 unexpected-500 reject
expect_gate 000 unexpected-000 reject

printf 'APP_READINESS_TEST_PASS cases=%s wholePlatformChecks=6 ownerLoginChecks=6\n' "$cases_run"
