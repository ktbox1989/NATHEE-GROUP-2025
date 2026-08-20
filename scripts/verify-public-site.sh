#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
SITE_DIR="${1:-$REPO_ROOT/public-site}"

fail() {
  printf 'PUBLIC_SITE_VERIFY_FAIL: %s\n' "$1" >&2
  exit 1
}

[[ -d "$SITE_DIR" ]] || fail "site directory does not exist: $SITE_DIR"
SITE_DIR="$(cd -- "$SITE_DIR" && pwd -P)"

required_files=(
  .htaccess
  index.html
  login-status.html
  404.html
  favicon.svg
  robots.txt
  sitemap.xml
  assets/site.css
  assets/site.js
)

for file in "${required_files[@]}"; do
  [[ -f "$SITE_DIR/$file" ]] || fail "missing required file: $file"
done

if find "$SITE_DIR" -type l -print -quit | grep -q .; then
  fail "symbolic links are not allowed"
fi

forbidden_regex='https://nateegroup2025\.com|02-000-0000|@natheegroup|ABC MOTOR|nathee-quotes|window\.storage|localStorage|abc123|owner123|staff123|nathee2025|1,000\+|10,000\+'
if grep -RInE -- "$forbidden_regex" "$SITE_DIR"; then
  fail "demo, placeholder, or wrong-domain content found"
fi

grep -Fq -- '<link rel="canonical" href="https://natheegroup2025.com/">' "$SITE_DIR/index.html" || fail "canonical link is missing"
grep -Fq -- 'href="tel:0631941191"' "$SITE_DIR/index.html" || fail "primary telephone link is missing"
grep -Fq -- 'href="tel:0856802082"' "$SITE_DIR/index.html" || fail "secondary telephone link is missing"
grep -Fq -- 'LINE Official' "$SITE_DIR/index.html" || fail "LINE status is missing"
grep -Fq -- 'อยู่ระหว่างอัปเดต' "$SITE_DIR/index.html" || fail "unverified LINE state is not explicit"
grep -Fq -- 'DirectoryIndex index.html' "$SITE_DIR/.htaccess" || fail "static directory index is missing"
grep -Fq -- 'ErrorDocument 404 /404.html' "$SITE_DIR/.htaccess" || fail "custom 404 is missing"
grep -Fq -- 'X-Content-Type-Options' "$SITE_DIR/.htaccess" || fail "security headers are missing"
grep -Fq -- 'https://natheegroup2025.com/sitemap.xml' "$SITE_DIR/robots.txt" || fail "robots sitemap URL is wrong"
grep -Fq -- '<loc>https://natheegroup2025.com/</loc>' "$SITE_DIR/sitemap.xml" || fail "sitemap canonical URL is wrong"

if grep -RInE -- 'RewriteRule[^[:cntrl:]]*index\.php' "$SITE_DIR/.htaccess"; then
  fail "stale WordPress index.php rewrite found"
fi

printf 'PUBLIC_SITE_VERIFY_PASS files=%s\n' "$(find "$SITE_DIR" -type f | wc -l | tr -d ' ')"
