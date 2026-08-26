#!/usr/bin/env bash
set -Eeuo pipefail

# Deterministic regression coverage for verify-app-integration.sh. A fake curl
# serves controlled HTTPS responses, so this suite cannot change meaning when
# the real hostname or Production configuration changes.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

# shellcheck source=scripts/lib/deploy-file-tools.sh
source "$SCRIPT_DIR/lib/deploy-file-tools.sh"

fail() {
  printf 'APP_INTEGRATION_TEST_FAIL: %s\n' "$1" >&2
  exit 1
}

WORK_ROOT=""
cleanup() {
  local exit_code=$?
  trap - EXIT
  if [[ -n "$WORK_ROOT" && -d "$WORK_ROOT" ]]; then
    case "$WORK_ROOT" in
      */nathee-app-integration-test.*) rm -rf "$WORK_ROOT" ;;
      *) printf 'APP_INTEGRATION_TEST_CLEANUP_SKIPPED unsafe=%s\n' "$WORK_ROOT" >&2 ;;
    esac
  fi
  exit "$exit_code"
}
trap cleanup EXIT

WORK_ROOT="$(nathee_make_temp_dir nathee-app-integration-test)" || fail "could not create a temporary directory"
mkdir -p "$WORK_ROOT/bin"

cat > "$WORK_ROOT/bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -Eeuo pipefail

output="/dev/null"
url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    --write-out) shift 2 ;;
    --silent|--show-error) shift ;;
    --max-redirs) shift 2 ;;
    *) url="$1"; shift ;;
  esac
done

test_case="${FAKE_GATE_CASE:-pass}"
status=200
body='PUBLIC'

case "$url" in
  https://app.example/api/health)
    status=503
    body='{"status":"degraded","checks":{"authentication":true,"adminAuthentication":false,"canonicalOrigin":true,"database":true,"storage":true,"antiAbuse":false},"auth":{"mode":"owner-pin","ownerPin":true,"supabase":false,"supabaseAdmin":false}}'
    case "$test_case" in
      owner-pin-missing) body='{"status":"degraded","checks":{"authentication":false,"canonicalOrigin":true,"database":true,"storage":true},"auth":{"mode":"none","ownerPin":false}}' ;;
      database-down) body='{"status":"degraded","checks":{"authentication":true,"canonicalOrigin":true,"database":false,"storage":true},"auth":{"mode":"owner-pin","ownerPin":true}}' ;;
      canonical-origin-down) body='{"status":"degraded","checks":{"authentication":true,"canonicalOrigin":false,"database":true,"storage":true},"auth":{"mode":"owner-pin","ownerPin":true}}' ;;
      storage-down) body='{"status":"degraded","checks":{"authentication":true,"canonicalOrigin":true,"database":true,"storage":false},"auth":{"mode":"owner-pin","ownerPin":true}}' ;;
      fake-booleans) body='{"status":"healthy","checks":{"authentication":"true","canonicalOrigin":"true","database":"true","storage":"true"},"auth":{"mode":"owner-pin","ownerPin":"true"}}' ;;
      health-error) status=500 ;;
    esac
    ;;
  https://app.example/login)
    body='<html><head><meta name="robots" content="noindex"></head><body><strong>kaikt143@gmail.com</strong><form action="/api/auth/owner-pin/login" method="post"><input name="pin"></form></body></html>'
    case "$test_case" in
      login-unreachable) status=401 ;;
      wrong-login-form) body='<html><meta name="robots" content="noindex"><form action="/api/auth/login"><input name="email"></form></html>' ;;
    esac
    ;;
  https://app.example/app/website)
    status=307
    [[ "$test_case" == "workspace-leak" ]] && status=200
    body='OWNER WORKSPACE'
    ;;
  https://app.example/api/images/00000000-0000-4000-8000-000000000000)
    status=401
    [[ "$test_case" == "private-media-leak" ]] && status=200
    body='PRIVATE MEDIA'
    ;;
  https://app.example/api/public/v1/news)
    status=200
    [[ "$test_case" == "public-news-down" ]] && status=500
    body='{"items":[]}'
    ;;
  https://app.example/)
    body='APPLICATION ROOT'
    ;;
  https://public.example/login/)
    body='PUBLIC LOGIN PLACEHOLDER'
    ;;
  https://public.example/*)
    body='PUBLIC ROUTE'
    ;;
  *)
    status=404
    body='NOT FOUND'
    ;;
esac

printf '%s' "$body" > "$output"
printf '%s' "$status"
FAKE_CURL
chmod +x "$WORK_ROOT/bin/curl"

cases=0
run_case() {
  local test_case="$1"
  local expected="$2"
  local output="$WORK_ROOT/$test_case.log"
  local result=0
  PATH="$WORK_ROOT/bin:$PATH" \
    FAKE_GATE_CASE="$test_case" \
    NATHEE_PUBLIC_BASE_URL="https://public.example" \
    NATHEE_APP_BASE_URL="https://app.example" \
    bash "$SCRIPT_DIR/verify-app-integration.sh" > "$output" 2>&1 || result=$?

  if [[ "$expected" == "PASS" ]]; then
    [[ "$result" -eq 0 ]] || fail "$test_case should pass"
    grep -Fq 'APP_INTEGRATION_GATE_PASS' "$output" || fail "$test_case emitted no pass token"
  else
    [[ "$result" -ne 0 ]] || fail "$test_case should fail"
    if grep -Fq 'APP_INTEGRATION_GATE_PASS' "$output"; then
      fail "$test_case emitted a pass token on failure"
    fi
  fi
  cases=$((cases + 1))
  printf 'APP_INTEGRATION_CASE name=%s expected=%s\n' "$test_case" "$expected"
}

run_case pass PASS
run_case owner-pin-missing FAIL
run_case database-down FAIL
run_case canonical-origin-down FAIL
run_case storage-down FAIL
run_case fake-booleans FAIL
run_case health-error FAIL
run_case login-unreachable FAIL
run_case wrong-login-form FAIL
run_case workspace-leak FAIL
run_case private-media-leak FAIL
run_case public-news-down FAIL

printf 'APP_INTEGRATION_TEST_PASS cases=%s optionalSupabaseAdmin=not-required optionalTurnstile=not-required protectedRoutes=required fakeSuccess=0\n' "$cases"
