#!/usr/bin/env bash
set -Eeuo pipefail

# Proves that the Z.com release gate actually rejects a bad public release.
# A gate that only ever passes is not evidence, so every guard below is
# verified against a deliberately broken copy of the real release.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
SOURCE_ROOT="$REPO_ROOT/public-site"
VERIFIER="$SCRIPT_DIR/verify-public-site.sh"

# shellcheck source=scripts/lib/deploy-file-tools.sh
source "$SCRIPT_DIR/lib/deploy-file-tools.sh"

fail() {
  printf 'PUBLIC_SITE_GATE_TEST_FAIL: %s\n' "$1" >&2
  exit 1
}

[[ -d "$SOURCE_ROOT" ]] || fail "public-site source is missing"
[[ -f "$VERIFIER" ]] || fail "verifier is missing"

WORK_ROOT=""
cleanup() {
  local exit_code=$?
  trap - EXIT
  if [[ -n "$WORK_ROOT" && -d "$WORK_ROOT" ]]; then
    case "$WORK_ROOT" in
      */nathee-gate-test.*) rm -rf "$WORK_ROOT" ;;
      *) printf 'GATE_TEST_CLEANUP_SKIPPED unsafe=%s\n' "$WORK_ROOT" >&2 ;;
    esac
  fi
  exit "$exit_code"
}
trap cleanup EXIT

WORK_ROOT="$(nathee_make_temp_dir nathee-gate-test)" || fail "could not create a temporary directory"

cases_run=0

# Runs the verifier against a mutated copy and requires a specific rejection.
expect_reject() {
  local case_name="$1"
  local expected_reason="$2"
  shift 2

  local case_dir="$WORK_ROOT/$case_name"
  rm -rf "$case_dir"
  mkdir -p "$case_dir"
  cp -R "$SOURCE_ROOT/." "$case_dir/"

  # The mutation runs with the copied release root as $1.
  "$@" "$case_dir"

  local output=""
  local status=0
  output="$(bash "$VERIFIER" "$case_dir" 2>&1)" || status=$?

  if [[ $status -eq 0 ]]; then
    printf '%s\n' "$output" >&2
    fail "$case_name: gate accepted a release it must reject"
  fi
  if ! printf '%s' "$output" | grep -Fq -- "$expected_reason"; then
    printf '%s\n' "$output" >&2
    fail "$case_name: rejected for the wrong reason (wanted: $expected_reason)"
  fi

  cases_run=$((cases_run + 1))
  printf 'GATE_REJECTS %s\n' "$case_name"
}

# A release whose referenced photograph is absent must never reach Production;
# this is the exact defect that served 404 images from the live site.
mutate_delete_referenced_asset() {
  local root="$1"
  local target=""
  target="$(grep -rhoE --include='*.html' -e 'src="/assets/gallery/[^"]+"' "$root" \
    | sed -E 's/^src="//; s/"$//' | sort -u | head -n 1)"
  [[ -n "$target" ]] || fail "fixture error: no gallery asset reference found"
  rm -f "$root$target"
}

# A release that ships the client-side loading placeholder is not real content.
mutate_inject_placeholder() {
  local root="$1"
  printf '<p>%s Gallery</p>\n' "$(printf '\xe0\xb8\x81\xe0\xb8\xb3\xe0\xb8\xa5\xe0\xb8\xb1\xe0\xb8\x87\xe0\xb9\x82\xe0\xb8\xab\xe0\xb8\xa5\xe0\xb8\x94')" \
    >> "$root/gallery/index.html"
}

# The Gallery must be server-rendered, not produced only by JavaScript.
mutate_strip_gallery_photos() {
  local root="$1"
  sed -i.bak 's/<img /<span /g' "$root/gallery/index.html"
  rm -f "$root/gallery/index.html.bak"
}

# The homepage hero must show real company work, not brand artwork alone.
mutate_strip_home_photos() {
  local root="$1"
  sed -i.bak 's|src="/assets/gallery/|src="/assets/brand/|g' "$root/index.html"
  rm -f "$root/index.html.bak"
}

expect_reject missing-referenced-asset 'referenced release asset(s) do not exist' mutate_delete_referenced_asset
expect_reject placeholder-loading-state 'server-rendered placeholder loading state found' mutate_inject_placeholder
expect_reject gallery-not-server-rendered 'gallery page does not server-render the nine approved photographs' mutate_strip_gallery_photos
expect_reject homepage-without-real-photos 'homepage does not server-render real company work photography' mutate_strip_home_photos

# The unmodified real release must still pass, so the guards are not blanket denials.
unmodified_dir="$WORK_ROOT/unmodified"
mkdir -p "$unmodified_dir"
cp -R "$SOURCE_ROOT/." "$unmodified_dir/"
bash "$VERIFIER" "$unmodified_dir" >/dev/null || fail "gate rejected the real unmodified release"

printf 'PUBLIC_SITE_GATE_TEST_PASS negativeCases=%s positiveCase=1\n' "$cases_run"
