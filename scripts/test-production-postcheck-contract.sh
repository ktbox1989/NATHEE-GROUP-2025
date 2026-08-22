#!/usr/bin/env bash
set -Eeuo pipefail

# The Production postcheck runs AFTER the release is applied, and the deploy
# script rolls Production back when it fails. A postcheck assertion that no
# longer matches the accepted release therefore destroys a good deployment.
#
# This test resolves every file the postcheck fetches from the real release,
# then executes the postcheck's own content assertions against those bytes.
# It cannot verify redirects, headers or TLS, which require the live host.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
SOURCE_ROOT="$REPO_ROOT/public-site"
POSTCHECK="$SCRIPT_DIR/postcheck-production.sh"

# shellcheck source=scripts/lib/deploy-file-tools.sh
source "$SCRIPT_DIR/lib/deploy-file-tools.sh"

fail() {
  printf 'POSTCHECK_CONTRACT_TEST_FAIL: %s\n' "$1" >&2
  exit 1
}

[[ -d "$SOURCE_ROOT" ]] || fail "public-site source is missing"
[[ -f "$POSTCHECK" ]] || fail "postcheck script is missing"

WORK_ROOT=""
cleanup() {
  local exit_code=$?
  trap - EXIT
  if [[ -n "$WORK_ROOT" && -d "$WORK_ROOT" ]]; then
    case "$WORK_ROOT" in
      */nathee-postcheck-contract.*) rm -rf "$WORK_ROOT" ;;
      *) printf 'CONTRACT_TEST_CLEANUP_SKIPPED unsafe=%s\n' "$WORK_ROOT" >&2 ;;
    esac
  fi
  exit "$exit_code"
}
trap cleanup EXIT

WORK_ROOT="$(nathee_make_temp_dir nathee-postcheck-contract)" || fail "could not create a temporary directory"

TMP_DIR="$WORK_ROOT/fetched"
mkdir -p "$TMP_DIR"

# Resolve each `fetch <path> "$TMP_DIR/<name>"` against the real release so the
# fetch list can never drift away from what this test actually checks.
fetch_map="$WORK_ROOT/fetch-map.txt"
grep -E '^fetch ' "$POSTCHECK" \
  | sed -E 's/^fetch[[:space:]]+([^[:space:]]+)[[:space:]]+"\$TMP_DIR\/([^"]+)".*$/\1 \2/' \
  > "$fetch_map"

[[ -s "$fetch_map" ]] || fail "could not resolve the postcheck fetch list"

fetched=0
while read -r route target_name; do
  [[ -n "$route" ]] || continue
  case "$route" in
    */) source_file="$SOURCE_ROOT${route}index.html" ;;
    *) source_file="$SOURCE_ROOT$route" ;;
  esac
  [[ -f "$source_file" ]] || fail "postcheck fetches $route but the release does not ship it"
  cp "$source_file" "$TMP_DIR/$target_name"
  fetched=$((fetched + 1))
done < "$fetch_map"

# Execute the postcheck's own content assertions, so this test cannot drift
# from the script it is protecting.
assertions="$WORK_ROOT/content-assertions.sh"
awk '
  /^grep -Fq .<link rel="canonical"/ { active = 1 }
  active { print }
  /^printf .PRODUCTION_MOBILE_BUDGET_PASS/ { active = 0 }
' "$POSTCHECK" > "$assertions"

[[ -s "$assertions" ]] || fail "could not extract the postcheck content assertions"
grep -Fq 'live_gallery_photos' "$assertions" || fail "extracted assertions are missing the Gallery contract"

runner="$WORK_ROOT/run-assertions.sh"
{
  printf 'set -Eeuo pipefail\n'
  printf 'TMP_DIR=%s\n' "$TMP_DIR"
  printf 'fail() { printf %s "$1" >&2; exit 1; }\n' "'POSTCHECK_ASSERTION_FAIL: %s\\n'"
  cat "$assertions"
} > "$runner"

output=""
status=0
output="$(bash "$runner" 2>&1)" || status=$?
if [[ $status -ne 0 ]]; then
  printf '%s\n' "$output" >&2
  fail "the Production postcheck would reject the accepted release and roll it back"
fi

printf '%s\n' "$output"
printf 'POSTCHECK_CONTRACT_TEST_PASS fetchedRoutes=%s scope=content-only httpChecks=requires-live-host\n' "$fetched"
