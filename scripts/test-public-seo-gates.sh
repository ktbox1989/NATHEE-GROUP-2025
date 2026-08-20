#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
SOURCE_ROOT="$REPO_ROOT/public-site"

# shellcheck source=scripts/lib/deploy-file-tools.sh
source "$SCRIPT_DIR/lib/deploy-file-tools.sh"

fail() {
  printf 'PUBLIC_SEO_GATES_TEST_FAIL: %s\n' "$1" >&2
  exit 1
}

for required_command in bash tar grep awk mv rm mkdir dd tr; do
  command -v "$required_command" >/dev/null 2>&1 || fail "$required_command is required"
done

test_root="$(nathee_make_temp_dir nathee-seo-gates-test)" || fail "test temp directory"
fixture="$test_root/site"
trap 'rm -rf "$test_root"' EXIT

reset_fixture() {
  rm -rf "$fixture"
  mkdir -p "$fixture"
  tar -C "$SOURCE_ROOT" -cpf - . | tar -C "$fixture" -xpf -
}

expect_rejected() {
  local label="$1"
  if bash "$SCRIPT_DIR/verify-public-site.sh" "$fixture" >/dev/null 2>&1; then
    fail "$label mutation was accepted"
  fi
  printf 'PUBLIC_SEO_NEGATIVE_PASS=%s\n' "$label"
}

reset_fixture
grep -v '<link rel="canonical"' "$fixture/index.html" > "$fixture/index.next"
mv "$fixture/index.next" "$fixture/index.html"
expect_rejected canonical_missing

reset_fixture
grep -v '"@type": "Organization"' "$fixture/index.html" > "$fixture/index.next"
mv "$fixture/index.next" "$fixture/index.html"
expect_rejected structured_data_missing

reset_fixture
grep -v 'noindex,nofollow,noarchive' "$fixture/login-status.html" > "$fixture/login.next"
mv "$fixture/login.next" "$fixture/login-status.html"
expect_rejected noindex_missing

reset_fixture
awk '/<\/urlset>/{print "  <url><loc>https://natheegroup2025.com/app/private</loc></url>"} {print}' \
  "$fixture/sitemap.xml" > "$fixture/sitemap.next"
mv "$fixture/sitemap.next" "$fixture/sitemap.xml"
expect_rejected private_sitemap_route

reset_fixture
awk '/<\/body>/{print "  <img src=\"favicon.svg\">"} {print}' \
  "$fixture/index.html" > "$fixture/index.next"
mv "$fixture/index.next" "$fixture/index.html"
expect_rejected image_alt_missing

reset_fixture
dd if=/dev/zero bs=1024 count=50 2>/dev/null | tr '\000' x >> "$fixture/index.html"
expect_rejected mobile_budget_exceeded

printf 'PUBLIC_SEO_GATES_TEST_PASS mutations=6 canonical=fail_closed jsonld=fail_closed noindex=fail_closed sitemap=fail_closed alt=fail_closed mobile_budget=fail_closed\n'
