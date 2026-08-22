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

for required_command in curl grep awk tr wc rm mkdir find date sha256sum; do
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
fetch /assets/brand/nathee-logo-display.webp "$TMP_DIR/nathee-logo-display.webp"
fetch /assets/contact/line-qr-owner-supplied.png "$TMP_DIR/line-qr-owner-supplied.png"
fetch /assets/gallery/motorcycle-container-loading-01-display.webp "$TMP_DIR/motorcycle-container-loading-01-display.webp"
fetch /assets/gallery/motorcycle-container-loading-01-display.jpg "$TMP_DIR/motorcycle-container-loading-01-display.jpg"
fetch /assets/gallery/motorcycle-truck-loading-01-thumbnail.webp "$TMP_DIR/motorcycle-truck-loading-01-thumbnail.webp"
fetch /assets/brand/nathee-logo-display.jpg "$TMP_DIR/nathee-logo-display.jpg"
fetch /site.webmanifest "$TMP_DIR/site.webmanifest"
fetch /assets/brand/icon-192.png "$TMP_DIR/icon-192.png"
fetch /assets/brand/icon-512.png "$TMP_DIR/icon-512.png"
fetch /assets/brand/icon-maskable-512.png "$TMP_DIR/icon-maskable-512.png"
fetch /assets/brand/apple-touch-icon-180.png "$TMP_DIR/apple-touch-icon-180.png"
fetch /robots.txt "$TMP_DIR/robots.txt"
fetch /sitemap.xml "$TMP_DIR/sitemap.xml"

grep -Fq '<link rel="canonical" href="https://natheegroup2025.com/">' "$TMP_DIR/index.html" || fail "live canonical link is wrong"
grep -Fq '<meta property="og:title"' "$TMP_DIR/index.html" || fail "live Open Graph title is missing"
grep -Fq '<meta property="og:description"' "$TMP_DIR/index.html" || fail "live Open Graph description is missing"
grep -Fq '<meta property="og:image" content="https://natheegroup2025.com/assets/brand/nathee-logo-display.jpg">' "$TMP_DIR/index.html" || fail "live Owner-supplied social image is missing"
grep -Fq '<meta name="twitter:title"' "$TMP_DIR/index.html" || fail "live Twitter title is missing"
grep -Fq '<meta name="twitter:description"' "$TMP_DIR/index.html" || fail "live Twitter description is missing"
grep -Fq 'type="application/ld+json"' "$TMP_DIR/index.html" || fail "live structured data is missing"
grep -Fq '"Organization"' "$TMP_DIR/index.html" || fail "live Organization structured data is missing"
grep -Fq 'href="tel:0631941191"' "$TMP_DIR/index.html" || fail "live primary telephone link is missing"
grep -Fq 'href="tel:0856802082"' "$TMP_DIR/index.html" || fail "live secondary telephone link is missing"
grep -Fq '"image":"https://natheegroup2025.com/assets/brand/nathee-logo-display.jpg"' "$TMP_DIR/index.html" || fail "live homepage brand artwork structured data is missing"
live_home_photos="$(grep -oE '<img[^>]*src="/assets/gallery/[^"]+"' "$TMP_DIR/index.html" | wc -l | tr -d ' ' || true)"
[[ "$live_home_photos" -ge 4 ]] || fail "live homepage does not show real company work photography"
grep -Fq 'href="/contact/#line"' "$TMP_DIR/index.html" || fail "live LINE QR entry is missing"
grep -Fq 'src="/assets/contact/line-qr-owner-supplied.png"' "$TMP_DIR/contact.html" || fail "live LINE QR image is missing"
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
live_gallery_photos="$(grep -oE '<img[^>]*src="/assets/gallery/[^"]+"' "$TMP_DIR/gallery.html" | wc -l | tr -d ' ' || true)"
[[ "$live_gallery_photos" -ge 9 ]] || fail "live Gallery does not server-render the nine approved photographs"
if grep -RInE --include='*.html' -e 'กำลังโหลด' "$TMP_DIR"; then
  fail "live site still shows a placeholder loading state"
fi
for gallery_id in motorcycle-truck-loading-01 motorcycle-storage-yard-01 nathee-yard-front-01 motorcycle-yard-container-01 motorcycle-storage-yard-02 motorcycle-fleet-staging-01 nathee-six-wheel-truck-01 motorcycle-pickup-loading-01 motorcycle-container-loading-01; do
  grep -Fq "\"id\": \"$gallery_id\"" "$TMP_DIR/gallery.json" || fail "live Gallery item is missing ($gallery_id)"
done
line_qr_sha="$(sha256sum "$TMP_DIR/line-qr-owner-supplied.png" | awk '{ print $1 }')"
[[ "$line_qr_sha" == "b2bae9fb2424bd2a316f942f56b95b75c7a767e898c778ebb241e3c952572de7" ]] || fail "live Owner-supplied LINE QR checksum is wrong"

index_bytes="$(wc -c < "$TMP_DIR/index.html" | tr -d ' ')"
css_bytes="$(wc -c < "$TMP_DIR/site.css" | tr -d ' ')"
js_bytes="$(wc -c < "$TMP_DIR/site.js" | tr -d ' ')"
critical_bytes=$((index_bytes + css_bytes + js_bytes))
[[ $index_bytes -le 46080 ]] || fail "live index.html exceeds mobile byte budget"
[[ $css_bytes -le 40960 ]] || fail "live site.css exceeds mobile byte budget"
[[ $js_bytes -le 16384 ]] || fail "live site.js exceeds mobile byte budget"
[[ $critical_bytes -le 102400 ]] || fail "live critical payload exceeds mobile byte budget"
grep -Fq '<script src="/assets/site.js" defer></script>' "$TMP_DIR/index.html" || fail "live JavaScript is not deferred"
grep -Fq '"start_url": "/"' "$TMP_DIR/site.webmanifest" || fail "live web app manifest start_url is wrong"
grep -Fq '"display": "standalone"' "$TMP_DIR/site.webmanifest" || fail "live web app manifest is not installable"
grep -Fq '"purpose": "maskable"' "$TMP_DIR/site.webmanifest" || fail "live web app manifest has no maskable icon"
if grep -Eq '"(start_url|scope|src)": "https?://' "$TMP_DIR/site.webmanifest"; then
  fail "live web app manifest is not same-origin"
fi
grep -Fq '<link rel="manifest" href="/site.webmanifest">' "$TMP_DIR/index.html" || fail "live homepage does not link the web app manifest"
grep -Fq '<link rel="apple-touch-icon" sizes="180x180" href="/assets/brand/apple-touch-icon-180.png">' "$TMP_DIR/index.html" || fail "live homepage apple touch icon is missing"
for live_icon in icon-192:000000c0000000c0 icon-512:0000020000000200 icon-maskable-512:0000020000000200 apple-touch-icon-180:000000b4000000b4; do
  icon_file="$TMP_DIR/${live_icon%%:*}.png"
  icon_dimensions="${live_icon##*:}"
  [[ "$(od -An -v -tx1 -N8 "$icon_file" | tr -d ' \n')" == "89504e470d0a1a0a" ]] || fail "live app icon is not a PNG (${live_icon%%:*})"
  [[ "$(od -An -v -tx1 -j16 -N8 "$icon_file" | tr -d ' \n')" == "$icon_dimensions" ]] || fail "live app icon has the wrong dimensions (${live_icon%%:*})"
done
printf 'PRODUCTION_PWA_CONTENT_PASS manifest=same-origin display=standalone icons=4 maskable=1\n'

printf 'PRODUCTION_SEO_CONTENT_PASS pages=11 metadata=verified jsonld=verified sitemap=public-only\n'
printf 'PRODUCTION_GALLERY_CONTENT_PASS manifest=v1 publishedItems=9 privacy=public-only\n'
printf 'PRODUCTION_OWNER_MEDIA_PASS logo=live lineQr=checksum-verified galleryItems=9 homePhotos=%s galleryPhotos=%s variants=jpg+webp\n' "$live_home_photos" "$live_gallery_photos"
printf 'PRODUCTION_MOBILE_BUDGET_PASS criticalBytes=%s budget=102400\n' "$critical_bytes"

wrong_domain_regex='natee''group2025\.com'
forbidden_regex="https://$wrong_domain_regex|02-000-0000|@natheegroup|ABC MOTOR|abc123|owner123|staff123|nathee2025|1,000\\+|10,000\\+"
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

capture_response "$BASE_URL/site.webmanifest" "$TMP_DIR/manifest.headers" "$TMP_DIR/manifest.body"
manifest_status="$(response_status "$TMP_DIR/manifest.headers")"
[[ "$manifest_status" == "200" ]] || fail "web app manifest is not 200 (status=$manifest_status)"
grep -Eiq '^content-type:[[:space:]]*application/manifest\+json' "$TMP_DIR/manifest.headers" \
  || fail "web app manifest is not served as application/manifest+json"
printf 'PRODUCTION_PWA_HEADER_PASS contentType=application/manifest+json\n'

capture_response "$BASE_URL/this-page-must-not-exist-nathee" "$TMP_DIR/404.headers" "$TMP_DIR/404-response.html"
missing_status="$(response_status "$TMP_DIR/404.headers")"
[[ "$missing_status" == "404" ]] || fail "missing page did not return HTTP 404 (status=$missing_status)"
grep -Fq 'ไม่พบหน้าที่ต้องการ' "$TMP_DIR/404-response.html" || fail "custom 404 page is not active"
grep -Eiq '^x-robots-tag:[[:space:]]*noindex,[[:space:]]*nofollow,[[:space:]]*noarchive$' "$TMP_DIR/404.headers" \
  || fail "404 X-Robots-Tag is missing"

printf 'PRODUCTION_NOINDEX_PASS login=header+meta clean-login=header+meta 404=header+meta\n'
printf 'PRODUCTION_COMPONENT public-static-site=LIVE root=%s routes=11\n' "$BASE_URL"
printf 'PRODUCTION_COMPONENT login-auth=STATIC_PLACEHOLDER_ONLY url=%s/login/\n' "$BASE_URL"
printf 'PRODUCTION_COMPONENT full-application=NOT_CHECKED_BY_PUBLIC_POSTCHECK\n'
printf 'PRODUCTION_POSTCHECK_PASS component=public-static-site domain=%s publicRoutes=11 fullApplication=NOT_CLAIMED\n' "$DOMAIN"
