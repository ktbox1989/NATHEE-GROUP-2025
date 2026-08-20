#!/usr/bin/env bash
set -Eeuo pipefail

DOMAIN="${NATHEE_DOMAIN:-natheegroup2025.com}"
BASE_URL="https://$DOMAIN"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# shellcheck source=scripts/lib/deploy-file-tools.sh
source "$SCRIPT_DIR/lib/deploy-file-tools.sh"

fail() {
  printf 'PRODUCTION_POSTCHECK_FAIL: %s\n' "$1" >&2
  exit 1
}

TMP_DIR="$(nathee_make_temp_dir nathee-postcheck)" || fail "could not create temporary directory"
trap 'rm -rf "$TMP_DIR"' EXIT

fetch() {
  local path="$1"
  local output="$2"
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    "$BASE_URL$path" --output "$output"
}

capture_response() {
  local url="$1"
  local header_file="$2"
  local body_file="$3"
  curl --silent --show-error --max-redirs 0 \
    --dump-header "$header_file.raw" --output "$body_file" "$url"
  tr -d '\r' < "$header_file.raw" > "$header_file"
}

response_status() {
  awk '/^HTTP\// { status=$2 } END { print status }' "$1"
}

response_location() {
  awk '
    tolower($1) == "location:" {
      sub(/^[^:]*:[[:space:]]*/, "")
      print
      exit
    }
  ' "$1"
}

assert_canonical_location() {
  local actual_location="$1"
  case "$actual_location" in
    "https://$DOMAIN"|"https://$DOMAIN/") return 0 ;;
    *) return 1 ;;
  esac
}

fetch / "$TMP_DIR/index.html"
fetch /login-status.html "$TMP_DIR/login-status.html"
fetch /assets/site.css "$TMP_DIR/site.css"
fetch /assets/site.js "$TMP_DIR/site.js"
fetch /robots.txt "$TMP_DIR/robots.txt"
fetch /sitemap.xml "$TMP_DIR/sitemap.xml"

grep -Fq '<link rel="canonical" href="https://natheegroup2025.com/">' "$TMP_DIR/index.html" || fail "live canonical link is wrong"
grep -Fq 'href="tel:0631941191"' "$TMP_DIR/index.html" || fail "live primary telephone link is missing"
grep -Fq 'href="tel:0856802082"' "$TMP_DIR/index.html" || fail "live secondary telephone link is missing"
grep -Fq 'https://natheegroup2025.com/sitemap.xml' "$TMP_DIR/robots.txt" || fail "live robots sitemap URL is wrong"
grep -Fq '<loc>https://natheegroup2025.com/</loc>' "$TMP_DIR/sitemap.xml" || fail "live sitemap canonical URL is wrong"

forbidden_regex='https://nateegroup2025\.com|02-000-0000|@natheegroup|ABC MOTOR|abc123|owner123|staff123|nathee2025|1,000\+|10,000\+'
if grep -RInE "$forbidden_regex" "$TMP_DIR"; then
  fail "live site exposes demo, placeholder, or wrong-domain content"
fi

capture_response "http://$DOMAIN/" "$TMP_DIR/http.headers" "$TMP_DIR/http.body"
http_status="$(response_status "$TMP_DIR/http.headers")"
http_location="$(response_location "$TMP_DIR/http.headers")"
printf 'PRODUCTION_HTTP_STATUS=%s\n' "$http_status"
printf 'PRODUCTION_HTTP_LOCATION=%s\n' "${http_location:-NONE}"
case "$http_status" in
  301|308) ;;
  *) fail "HTTP does not redirect permanently (status=$http_status)" ;;
esac
assert_canonical_location "$http_location" || fail "HTTP redirect target is wrong (location=${http_location:-NONE})"

capture_response "$BASE_URL/" "$TMP_DIR/https.headers" "$TMP_DIR/https.body"
https_status="$(response_status "$TMP_DIR/https.headers")"
printf 'PRODUCTION_HTTPS_STATUS=%s\n' "$https_status"
[[ "$https_status" == "200" ]] || fail "canonical HTTPS root is not 200 (status=$https_status)"

capture_response "https://www.$DOMAIN/" "$TMP_DIR/www.headers" "$TMP_DIR/www.body"
www_status="$(response_status "$TMP_DIR/www.headers")"
www_location="$(response_location "$TMP_DIR/www.headers")"
printf 'PRODUCTION_WWW_STATUS=%s\n' "$www_status"
printf 'PRODUCTION_WWW_LOCATION=%s\n' "${www_location:-NONE}"
case "$www_status" in
  301|308)
    assert_canonical_location "$www_location" || fail "www redirect target is wrong (location=${www_location:-NONE})"
    ;;
  200)
    grep -Fq '<link rel="canonical" href="https://natheegroup2025.com/">' "$TMP_DIR/www.body" \
      || fail "www 200 response does not declare the canonical apex URL"
    ;;
  *)
    fail "www contract is unsupported (status=$www_status)"
    ;;
esac

grep -Eiq '^x-content-type-options:[[:space:]]*nosniff$' "$TMP_DIR/https.headers" || fail "X-Content-Type-Options is missing"
grep -Eiq '^x-frame-options:[[:space:]]*DENY$' "$TMP_DIR/https.headers" || fail "X-Frame-Options is missing"
grep -Eiq '^referrer-policy:[[:space:]]*strict-origin-when-cross-origin$' "$TMP_DIR/https.headers" || fail "Referrer-Policy is missing"
grep -Eiq '^content-security-policy:' "$TMP_DIR/https.headers" || fail "Content-Security-Policy is missing"
grep -Eiq '^strict-transport-security:[[:space:]]*max-age=300$' "$TMP_DIR/https.headers" || fail "staged HSTS header is missing"

missing_status="$(curl --silent --show-error --output "$TMP_DIR/404-response.html" --write-out '%{http_code}' "$BASE_URL/this-page-must-not-exist-nathee")"
[[ "$missing_status" == "404" ]] || fail "missing page did not return HTTP 404 (status=$missing_status)"
grep -Fq 'ไม่พบหน้าที่ต้องการ' "$TMP_DIR/404-response.html" || fail "custom 404 page is not active"

printf 'PRODUCTION_POSTCHECK_PASS domain=%s\n' "$DOMAIN"
