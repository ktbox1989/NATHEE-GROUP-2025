#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=scripts/lib/deploy-file-tools.sh
source "$SCRIPT_DIR/lib/deploy-file-tools.sh"

fail() {
  printf 'PRODUCTION_COMPONENT_AUDIT_LOGIN_TEST_FAIL: %s\n' "$1" >&2
  exit 1
}

WORK_ROOT="$(nathee_make_temp_dir nathee-audit-login-test)" || fail "temp directory"
cleanup() {
  local exit_code=$?
  trap - EXIT
  rm -rf "$WORK_ROOT"
  exit "$exit_code"
}
trap cleanup EXIT

mkdir -p "$WORK_ROOT/bin"
cat > "$WORK_ROOT/bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -Eeuo pipefail
write_out=""
url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --write-out) write_out="$2"; shift 2 ;;
    --output) shift 2 ;;
    --max-redirs) shift 2 ;;
    --silent|--show-error) shift ;;
    *) url="$1"; shift ;;
  esac
done

status=404
location=""
case "$url" in
  https://public.example/) status=200 ;;
  https://public.example/gallery/) status=200 ;;
  https://public.example/login/)
    case "${FAKE_AUDIT_CASE:-}" in
      active-good|active-wrong-target|active-loop) status=302 ;;
      inactive-good) status=200 ;;
      active-wrong-status) status=200 ;;
      inactive-redirect) status=302 ;;
    esac
    case "${FAKE_AUDIT_CASE:-}" in
      active-good|inactive-redirect) location="https://app.example/login" ;;
      active-wrong-target) location="https://evil.example/login" ;;
      active-loop) location="https://public.example/login" ;;
    esac
    ;;
esac
case "$write_out" in
  '%{http_code}') printf '%s' "$status" ;;
  '%{redirect_url}') printf '%s' "$location" ;;
  *) printf '%s' "$status" ;;
esac
FAKE_CURL
chmod +x "$WORK_ROOT/bin/curl"

write_state() {
  local state="$1"
  local target="$2"
  local file="$3"
  if [[ "$state" == "MISSING" ]]; then
    : > "$file"
    return 0
  fi
  cat > "$file" <<EOF
# BEGIN NATHEE LOGIN REDIRECT
# NATHEE_LOGIN_REDIRECT_STATE=$state
# NATHEE_LOGIN_REDIRECT_TARGET=$target
# END NATHEE LOGIN REDIRECT
EOF
}

cases=0
run_case() {
  local test_case="$1"
  local state="$2"
  local target="$3"
  local expected="$4"
  local state_file="$WORK_ROOT/$test_case.htaccess"
  local output="$WORK_ROOT/$test_case.log"
  local result=0
  write_state "$state" "$target" "$state_file"

  PATH="$WORK_ROOT/bin:$PATH" \
    FAKE_AUDIT_CASE="$test_case" \
    NATHEE_PUBLIC_BASE_URL="https://public.example" \
    NATHEE_APP_BASE_URL="" \
    NATHEE_LOGIN_REDIRECT_FILE="$state_file" \
    bash "$SCRIPT_DIR/audit-production-components.sh" > "$output" 2>&1 || result=$?

  if [[ "$expected" == "PASS" ]]; then
    [[ "$result" -eq 0 ]] || { cat "$output" >&2; fail "$test_case should pass"; }
    grep -Fq 'PRODUCTION_COMPONENT_AUDIT_PASS public=LIVE fullApplication=NOT_CLAIMED' "$output" \
      || fail "$test_case emitted no pass token"
  else
    [[ "$result" -ne 0 ]] || fail "$test_case should fail"
    if grep -Fq 'PRODUCTION_COMPONENT_AUDIT_PASS' "$output"; then
      fail "$test_case emitted a pass token on failure"
    fi
  fi
  cases=$((cases + 1))
  printf 'PRODUCTION_COMPONENT_AUDIT_LOGIN_CASE name=%s expected=%s\n' "$test_case" "$expected"
}

run_case active-good ACTIVE https://app.example/login PASS
run_case inactive-good INACTIVE https://app.example/login PASS
run_case active-wrong-status ACTIVE https://app.example/login FAIL
run_case active-wrong-target ACTIVE https://app.example/login FAIL
run_case active-loop ACTIVE https://public.example/login FAIL
run_case inactive-redirect INACTIVE https://app.example/login FAIL
run_case missing-state MISSING https://app.example/login FAIL

printf 'PRODUCTION_COMPONENT_AUDIT_LOGIN_TEST_PASS cases=%s active=302-targeted inactive=200 failClosed=yes\n' "$cases"
