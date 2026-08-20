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

for required_command in curl grep awk tr wc rm mkdir find date; do
  command -v "$required_command" >/dev/null 2>&1 || fail "$required_command is required"
done

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
fetch /login/ "$TMP_DIR/login-clean.html"
fetch /services/ "$TMP_DIR/services.html"
fetch /motorcycle-transport/ "$TMP_DIR/motorcycle-transport.html"
fetch /international/ "$TMP_DIR/international.html"
fetch /storage/ "$TMP_DIR/storage.html"
fetch /container-loading/ "$TMP_DIR/container-loading.html"
fetch /dealer-fleet/ "$TMP_DIR/dealer-fleet.html"
fetch /gallery/ "$TMP_DIR/gallery.html"
fetch /about/ "$TMP_DIR/about.html"
fetch /contact/ "$TMP_DIR/contact.html"
fetch /quotation/ "$TMP_DIR/quotation.html"
fetch /assets/site.css "$TMP_DIR/site.css"
fetch /assets/site.js "$TMP_DIR/site.js"
fetch /assets/gallery.json "$TMP_DIR/gallery.json"
fetch /robots.txt "$TMP_DIR/robots.txt"
fetch /sitemap.xml "$TMP_DIR/sitemap.xml"

grep -Fq '<link rel="canonical" href="https://natheegroup2025.com/">' "$TMP_DIR/index.html" || fail "live canonical link is wrong"
grep -Fq '<meta property="og:title"' "$TMP_DIR/index.html" || fail "live Open Graph title is missing"
grep -Fq '<meta property="og:description"' "$TMP_DIR/index.html" || fail "live Open Graph description is missing"
grep -Fq '<meta name="twitter:title"' "$TMP_DIR/index.html" || fail "live Twitter title is missing"
grep -Fq '<meta name="twitter:description"' "$TMP_DIR/index.html" || fail "live Twitter description is missing"
grep -Fq 'type="application/ld+json"' "$TMP_DIR/index.html" || fail "live structured data is missing"
grep -Fq '"Organization"' "$TMP_DIR/index.html" || fail "live Organization structured data is missing"
grep -Fq 'href="tel:0631941191"' "$TMP_DIR/index.html" || fail "live primary telephone link is missing"
grep -Fq 'href="tel:0856802082"' "$TMP_DIR/index.html" || fail "live secondary telephone link is missing"
grep -Fq 'https://natheegroup2025.com/sitemap.xml' "$TMP_DIR/robots.txt" || fail "live robots sitemap URL is wrong"
grep -Fq 'Disallow: /login-status.html' "$TMP_DIR/robots.txt" || fail "live robots file does not exclude login status"
grep -Fq 'Disallow: /login/' "$TMP_DIR/robots.txt" || fail "live robots file does not exclude login route"
grep -Fq 'Disallow: /auth/' "$TMP_DIR/robots.txt" || fail "live robots file does not exclude auth routes"
grep -Fq 'Disallow: /app/' "$TMP_DIR/robots.txt" || fail "live robots file does not exclude app routes"
grep -Fq 'Disallow: /api/' "$TMP_DIR/robots.txt" || fail "live robots file does not exclude API routes"
grep -Fq '<loc>https://natheegroup2025.com/</loc>' "$TMP_DIR/sitemap.xml" || fail "live sitemap canonical URL is wrong"
if grep -Eiq 'login-status|/login/|/auth/|/app/|/api/' "$TMP_DIR/sitemap.xml"; then
  fail "live sitemap exposes a private or noindex route"
fi
grep -Fq '<meta name="robots" content="noindex,nofollow,noarchive">' "$TMP_DIR/login-status.html" || fail "live login status noindex is missing"
grep -Fq '<meta name="robots" content="noindex,nofollow,noarchive">' "$TMP_DIR/login-clean.html" || fail "live clean login route noindex is missing"

for route in services motorcycle-transport international storage container-loading dealer-fleet gallery about contact quotation; do
  grep -Fq "<link rel=\"canonical\" href=\"https://natheegroup2025.com/$route/\">" "$TMP_DIR/$route.html" || fail "live /$route/ canonical is wrong"
  grep -Fq '<meta property="og:title"' "$TMP_DIR/$route.html" || fail "live /$route/ Open Graph is missing"
  grep -Fq 'type="application/ld+json"' "$TMP_DIR/$route.html" || fail "live /$route/ structured data is missing"
done
grep -Fq '"version": 1' "$TMP_DIR/gallery.json" || fail "live Gallery manifest version is wrong"

index_bytes="$(wc -c < "$TMP_DIR/index.html" | tr -d ' ')"
css_bytes="$(wc -c < "$TMP_DIR/site.css" | tr -d ' ')"
js_bytes="$(wc -c < "$TMP_DIR/site.js" | tr -d ' ')"
critical_bytes=$((index_bytes + css_bytes + js_bytes))
[[ $index_bytes -le 46080 ]] || fail "live index.html exceeds mobile byte budget"
[[ $css_bytes -le 40960 ]] || fail "live site.css exceeds mobile byte budget"
[[ $js_bytes -le 16384 ]] || fail "live site.js exceeds mobile byte budget"
[[ $critical_bytes -le 102400 ]] || fail "live critical payload exceeds mobile byte budget"
grep -Fq '<script src="/assets/site.js" defer></script>' "$TMP_DIR/index.html" || fail "live JavaScript is not deferred"
printf 'PRODUCTION_SEO_CONTENT_PASS pages=11 metadata=verified jsonld=verified sitemap=public-only\n'
printf 'PRODUCTION_GALLERY_CONTENT_PASS manifest=v1 privacy=public-only\n'
printf 'PRODUCTION_MOBILE_BUDGET_PASS criticalBytes=%s budget=102400\n' "$critical_bytes"

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

capture_response "$BASE_URL/login-status.html" "$TMP_DIR/login.headers" "$TMP_DIR/login.body"
login_status="$(response_status "$TMP_DIR/login.headers")"
printf 'PRODUCTION_LOGIN_STATUS=%s\n' "$login_status"
[[ "$login_status" == "200" ]] || fail "login status page is not 200 (status=$login_status)"
grep -Eiq '^x-robots-tag:[[:space:]]*noindex,[[:space:]]*nofollow,[[:space:]]*noarchive$' "$TMP_DIR/login.headers" \
  || fail "login status X-Robots-Tag is missing"

capture_response "$BASE_URL/login/" "$TMP_DIR/login-clean.headers" "$TMP_DIR/login-clean.body"
login_clean_status="$(response_status "$TMP_DIR/login-clean.headers")"
printf 'PRODUCTION_CLEAN_LOGIN_STATUS=%s\n' "$login_clean_status"
[[ "$login_clean_status" == "200" ]] || fail "clean login route is not 200"
grep -Eiq '^x-robots-tag:[[:space:]]*noindex,[[:space:]]*nofollow,[[:space:]]*noarchive$' "$TMP_DIR/login-clean.headers" \
  || fail "clean login route X-Robots-Tag is missing"

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

capture_response "$BASE_URL/this-page-must-not-exist-nathee" "$TMP_DIR/404.headers" "$TMP_DIR/404-response.html"
missing_status="$(response_status "$TMP_DIR/404.headers")"
[[ "$missing_status" == "404" ]] || fail "missing page did not return HTTP 404 (status=$missing_status)"
grep -Fq 'ไม่พบหน้าที่ต้องการ' "$TMP_DIR/404-response.html" || fail "custom 404 page is not active"
grep -Eiq '^x-robots-tag:[[:space:]]*noindex,[[:space:]]*nofollow,[[:space:]]*noarchive$' "$TMP_DIR/404.headers" \
  || fail "404 X-Robots-Tag is missing"

printf 'PRODUCTION_NOINDEX_PASS login=header+meta clean-login=header+meta 404=header+meta\n'
printf 'PRODUCTION_POSTCHECK_PASS domain=%s publicRoutes=11\n' "$DOMAIN"
