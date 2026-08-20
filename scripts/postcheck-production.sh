#!/usr/bin/env bash
set -Eeuo pipefail

DOMAIN="${NATHEE_DOMAIN:-natheegroup2025.com}"
BASE_URL="https://$DOMAIN"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TMP_DIR"' EXIT

fail() {
  printf 'PRODUCTION_POSTCHECK_FAIL: %s\n' "$1" >&2
  exit 1
}

fetch() {
  local path="$1"
  local output="$2"
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    "$BASE_URL$path" --output "$output"
}

fetch / "$TMP_DIR/index.html"
fetch /login-status.html "$TMP_DIR/login-status.html"
fetch /assets/site.css "$TMP_DIR/site.css"
fetch /assets/site.js "$TMP_DIR/site.js"
fetch /robots.txt "$TMP_DIR/robots.txt"
fetch /sitemap.xml "$TMP_DIR/sitemap.xml"

grep -Fq -- '<link rel="canonical" href="https://natheegroup2025.com/">' "$TMP_DIR/index.html" || fail "live canonical link is wrong"
grep -Fq -- 'href="tel:0631941191"' "$TMP_DIR/index.html" || fail "live primary telephone link is missing"
grep -Fq -- 'href="tel:0856802082"' "$TMP_DIR/index.html" || fail "live secondary telephone link is missing"
grep -Fq -- 'https://natheegroup2025.com/sitemap.xml' "$TMP_DIR/robots.txt" || fail "live robots sitemap URL is wrong"
grep -Fq -- '<loc>https://natheegroup2025.com/</loc>' "$TMP_DIR/sitemap.xml" || fail "live sitemap canonical URL is wrong"

forbidden_regex='https://nateegroup2025\.com|02-000-0000|@natheegroup|ABC MOTOR|abc123|owner123|staff123|nathee2025|1,000\+|10,000\+'
if grep -RInE -- "$forbidden_regex" "$TMP_DIR"; then
  fail "live site exposes demo, placeholder, or wrong-domain content"
fi

http_headers="$(curl --silent --show-error --dump-header - --output /dev/null --max-redirs 0 "http://$DOMAIN/")"
printf '%s' "$http_headers" | grep -Eiq '^HTTP/[^ ]+ (301|308)' || fail "HTTP does not redirect permanently"
printf '%s' "$http_headers" | grep -Eiq "^location: https://$DOMAIN/\r?$" || fail "HTTP redirect target is wrong"

www_headers="$(curl --silent --show-error --dump-header - --output /dev/null --max-redirs 0 "https://www.$DOMAIN/")"
printf '%s' "$www_headers" | grep -Eiq '^HTTP/[^ ]+ (301|308)' || fail "www does not redirect permanently"
printf '%s' "$www_headers" | grep -Eiq "^location: https://$DOMAIN/\r?$" || fail "www redirect target is wrong"

security_headers="$(curl --silent --show-error --dump-header - --output /dev/null "$BASE_URL/")"
printf '%s' "$security_headers" | grep -Eiq '^x-content-type-options: nosniff\r?$' || fail "X-Content-Type-Options is missing"
printf '%s' "$security_headers" | grep -Eiq '^x-frame-options: DENY\r?$' || fail "X-Frame-Options is missing"
printf '%s' "$security_headers" | grep -Eiq '^referrer-policy: strict-origin-when-cross-origin\r?$' || fail "Referrer-Policy is missing"
printf '%s' "$security_headers" | grep -Eiq '^content-security-policy:' || fail "Content-Security-Policy is missing"
printf '%s' "$security_headers" | grep -Eiq '^strict-transport-security: max-age=300\r?$' || fail "staged HSTS header is missing"

missing_status="$(curl --silent --show-error --output "$TMP_DIR/404-response.html" --write-out '%{http_code}' "$BASE_URL/this-page-must-not-exist-nathee")"
[[ "$missing_status" == "404" ]] || fail "missing page did not return HTTP 404"
grep -Fq -- 'ไม่พบหน้าที่ต้องการ' "$TMP_DIR/404-response.html" || fail "custom 404 page is not active"

printf 'PRODUCTION_POSTCHECK_PASS domain=%s\n' "$DOMAIN"
