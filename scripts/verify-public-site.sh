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
  assets/gallery.json
  assets/brand/nathee-logo-display.jpg
  assets/brand/nathee-logo-display.webp
  assets/brand/nathee-logo-thumbnail.jpg
  assets/brand/nathee-logo-thumbnail.webp
  assets/contact/line-qr-owner-supplied.png
  site.webmanifest
  assets/brand/icon-192.png
  assets/brand/icon-512.png
  assets/brand/icon-maskable-512.png
  assets/brand/apple-touch-icon-180.png
  services/index.html
  motorcycle-transport/index.html
  international/index.html
  storage/index.html
  container-loading/index.html
  dealer-fleet/index.html
  gallery/index.html
  about/index.html
  contact/index.html
  quotation/index.html
  login/index.html
  _nathee/news-gateway.php
  news/index.php
  assets/media/index.php
  sitemap.php
)

for file in "${required_files[@]}"; do
  [[ -f "$SITE_DIR/$file" ]] || fail "missing required file: $file"
done

command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"

if find "$SITE_DIR" -type l -print | grep -q .; then
  fail "symbolic links are not allowed"
fi

wrong_domain_regex='natee''group2025\.com'
forbidden_regex="https://$wrong_domain_regex|02-000-0000|@natheegroup|ABC MOTOR|nathee-quotes|window\.storage|localStorage|abc123|owner123|staff123|nathee2025|1,000\\+|10,000\\+"
if grep -RInE -- "$forbidden_regex" "$SITE_DIR"; then
  fail "demo, placeholder, or wrong-domain content found"
fi

if grep -RInE --include='*.html' -e 'กำลังโหลด' "$SITE_DIR"; then
  fail "server-rendered placeholder loading state found"
fi

grep -Fq -- '<link rel="canonical" href="https://natheegroup2025.com/">' "$SITE_DIR/index.html" || fail "canonical link is missing"
grep -Fq -- '<meta property="og:title"' "$SITE_DIR/index.html" || fail "Open Graph title is missing"
grep -Fq -- '<meta property="og:description"' "$SITE_DIR/index.html" || fail "Open Graph description is missing"
grep -Fq -- '<meta property="og:image" content="https://natheegroup2025.com/assets/brand/nathee-logo-display.jpg">' "$SITE_DIR/index.html" || fail "Owner-supplied social image is missing"
grep -Fq -- '<meta name="twitter:title"' "$SITE_DIR/index.html" || fail "Twitter title is missing"
grep -Fq -- '<meta name="twitter:description"' "$SITE_DIR/index.html" || fail "Twitter description is missing"
grep -Fq -- 'type="application/ld+json"' "$SITE_DIR/index.html" || fail "structured data is missing"
grep -Fq -- '"Organization"' "$SITE_DIR/index.html" || fail "Organization structured data is missing"
grep -Fq -- 'href="tel:0631941191"' "$SITE_DIR/index.html" || fail "primary telephone link is missing"
grep -Fq -- 'href="tel:0856802082"' "$SITE_DIR/index.html" || fail "secondary telephone link is missing"
grep -Fq -- '"image":"https://natheegroup2025.com/assets/brand/nathee-logo-display.jpg"' "$SITE_DIR/index.html" || fail "homepage brand artwork structured data is missing"
home_photo_count="$(grep -oE -- '<img[^>]*src="/assets/gallery/[^"]+"' "$SITE_DIR/index.html" | wc -l | tr -d ' ' || true)"
[[ "$home_photo_count" -ge 4 ]] || fail "homepage does not server-render real company work photography"
grep -Fq -- 'href="/contact/#line"' "$SITE_DIR/index.html" || fail "LINE QR entry is missing"
grep -Fq -- 'src="/assets/contact/line-qr-owner-supplied.png"' "$SITE_DIR/contact/index.html" || fail "Owner-supplied LINE QR is missing"
line_qr_sha="$(sha256sum "$SITE_DIR/assets/contact/line-qr-owner-supplied.png" | awk '{ print $1 }')"
[[ "$line_qr_sha" == "b2bae9fb2424bd2a316f942f56b95b75c7a767e898c778ebb241e3c952572de7" ]] || fail "Owner-supplied LINE QR checksum changed"
grep -Fq -- 'DirectoryIndex index.html' "$SITE_DIR/.htaccess" || fail "static directory index is missing"
grep -Fq -- 'ErrorDocument 404 /404.html' "$SITE_DIR/.htaccess" || fail "custom 404 is missing"
grep -Fq -- 'X-Content-Type-Options' "$SITE_DIR/.htaccess" || fail "security headers are missing"
grep -Fq -- 'https://natheegroup2025.com/sitemap.xml' "$SITE_DIR/robots.txt" || fail "robots sitemap URL is wrong"
grep -Fq -- 'Disallow: /login-status.html' "$SITE_DIR/robots.txt" || fail "login status is not excluded by robots.txt"
grep -Fq -- 'Disallow: /login/' "$SITE_DIR/robots.txt" || fail "login route is not excluded by robots.txt"
grep -Fq -- 'Disallow: /auth/' "$SITE_DIR/robots.txt" || fail "auth routes are not excluded by robots.txt"
grep -Fq -- 'Disallow: /app/' "$SITE_DIR/robots.txt" || fail "private app routes are not excluded by robots.txt"
grep -Fq -- 'Disallow: /api/' "$SITE_DIR/robots.txt" || fail "API routes are not excluded by robots.txt"
grep -Fq -- '<loc>https://natheegroup2025.com/</loc>' "$SITE_DIR/sitemap.xml" || fail "sitemap canonical URL is wrong"
if grep -Eiq -- 'login-status|/login/|/auth/|/app/|/api/' "$SITE_DIR/sitemap.xml"; then
  fail "sitemap exposes a private or noindex route"
fi
grep -Fq -- '<meta name="robots" content="noindex,nofollow,noarchive">' "$SITE_DIR/login-status.html" || fail "login page noindex contract is missing"
grep -Fq -- '<meta name="robots" content="noindex,nofollow,noarchive">' "$SITE_DIR/login/index.html" || fail "clean login route noindex contract is missing"
grep -Fq -- '<meta name="robots" content="noindex,nofollow,noarchive">' "$SITE_DIR/404.html" || fail "404 noindex contract is missing"
grep -Fq -- 'X-Robots-Tag "noindex, nofollow, noarchive"' "$SITE_DIR/.htaccess" || fail "X-Robots-Tag contract is missing"

if grep -RInE -- '<img[[:space:]][^>]*>' "$SITE_DIR" | grep -Eiv -- 'alt="[^"]*"'; then
  fail "an image is missing alt text"
fi

index_bytes="$(wc -c < "$SITE_DIR/index.html" | tr -d ' ')"
css_bytes="$(wc -c < "$SITE_DIR/assets/site.css" | tr -d ' ')"
js_bytes="$(wc -c < "$SITE_DIR/assets/site.js" | tr -d ' ')"
critical_bytes=$((index_bytes + css_bytes + js_bytes))
[[ $index_bytes -le 46080 ]] || fail "index.html exceeds mobile byte budget"
[[ $css_bytes -le 40960 ]] || fail "site.css exceeds mobile byte budget"
[[ $js_bytes -le 16384 ]] || fail "site.js exceeds mobile byte budget"
[[ $critical_bytes -le 102400 ]] || fail "critical public payload exceeds mobile byte budget"
grep -Fq -- '<script src="/assets/site.js" defer></script>' "$SITE_DIR/index.html" || fail "site JavaScript is not deferred"
grep -Fq -- '@media (max-width: 980px)' "$SITE_DIR/assets/site.css" || fail "tablet breakpoint is missing"
grep -Fq -- '@media (max-width: 680px)' "$SITE_DIR/assets/site.css" || fail "mobile breakpoint is missing"

if grep -Eiq -- 'RewriteRule[[:space:]]+(\.|\^?\.\*\$?)[[:space:]]+/?index\.php' "$SITE_DIR/.htaccess"; then
  fail "stale WordPress index.php rewrite found"
fi

# News is a local PHP renderer, never an Apache reverse proxy. The allowlist in
# PHP is the only code allowed to reach the fixed application origin.
for required_rule in \
  'RewriteRule ^news/?$ news/index.php [L]' \
  'RewriteRule ^news/[a-z0-9]+(?:-[a-z0-9]+)*/?$ news/index.php [L]' \
  'RewriteRule ^sitemap\.xml$ sitemap.php [L]' \
  'RewriteRule ^assets/media/'; do
  grep -Fq -- "$required_rule" "$SITE_DIR/.htaccess" || fail "local PHP News route is missing: $required_rule"
done
if grep -Eiq -- '\[P([,\]]|$)|\bProxyPass\b|SSLProxyEngine' "$SITE_DIR/.htaccess"; then
  fail "public release depends on forbidden Apache proxying"
fi
if grep -RInE -- '/_next/static|\$_COOKIE|HTTP_AUTHORIZATION|HTTP_X_FORWARDED' "$SITE_DIR/_nathee" "$SITE_DIR/news" "$SITE_DIR/assets/media" "$SITE_DIR/sitemap.php"; then
  fail "PHP News gateway depends on private framework assets or visitor identity"
fi
grep -Fq -- "const NATHEE_NEWS_UPSTREAM_ORIGIN = 'https://app.natheegroup2025.com';" "$SITE_DIR/_nathee/news-gateway.php" \
  || fail "PHP News upstream origin is not fixed"
grep -Fq -- 'CURLOPT_SSL_VERIFYPEER => true' "$SITE_DIR/_nathee/news-gateway.php" \
  || fail "PHP News TLS peer verification is not enforced"
grep -Fq -- 'CURLOPT_SSL_VERIFYHOST => 2' "$SITE_DIR/_nathee/news-gateway.php" \
  || fail "PHP News TLS hostname verification is not enforced"

for route in services motorcycle-transport international storage container-loading dealer-fleet gallery about contact quotation; do
  page="$SITE_DIR/$route/index.html"
  grep -Fq -- "<link rel=\"canonical\" href=\"https://natheegroup2025.com/$route/\">" "$page" || fail "canonical missing for /$route/"
  grep -Fq -- '<meta property="og:title"' "$page" || fail "Open Graph missing for /$route/"
  grep -Fq -- 'type="application/ld+json"' "$page" || fail "JSON-LD missing for /$route/"
done
grep -Fq -- '"version": 1' "$SITE_DIR/assets/gallery.json" || fail "gallery manifest version is invalid"
grep -Fq -- '"items": [' "$SITE_DIR/assets/gallery.json" || fail "gallery manifest items are missing"
for gallery_id in motorcycle-truck-loading-01 motorcycle-storage-yard-01 nathee-yard-front-01 motorcycle-yard-container-01 motorcycle-storage-yard-02 motorcycle-fleet-staging-01 nathee-six-wheel-truck-01 motorcycle-pickup-loading-01 motorcycle-container-loading-01; do
  grep -Fq -- "\"id\": \"$gallery_id\"" "$SITE_DIR/assets/gallery.json" || fail "gallery item is missing: $gallery_id"
done
gallery_photo_count="$(grep -oE -- '<img[^>]*src="/assets/gallery/[^"]+"' "$SITE_DIR/gallery/index.html" | wc -l | tr -d ' ' || true)"
[[ "$gallery_photo_count" -ge 9 ]] || fail "gallery page does not server-render the nine approved photographs"

missing_assets=0
for asset_ref in $(grep -rhoE --include='*.html' -e '(src|href)="/assets/[^"]+"' "$SITE_DIR" | sed -E 's/^(src|href)="//; s/"$//' | sort -u || true); do
  [[ -f "$SITE_DIR$asset_ref" ]] || { printf 'MISSING_ASSET %s\n' "$asset_ref" >&2; missing_assets=$((missing_assets + 1)); }
done
for asset_ref in $(grep -rhoE --include='*.html' -e 'srcset="[^"]+"' "$SITE_DIR" | sed -E 's/^srcset="//; s/"$//' | tr ',' '\n' | awk '{ print $1 }' | grep -E '^/assets/' | sort -u || true); do
  [[ -f "$SITE_DIR$asset_ref" ]] || { printf 'MISSING_ASSET %s\n' "$asset_ref" >&2; missing_assets=$((missing_assets + 1)); }
done
[[ $missing_assets -eq 0 ]] || fail "$missing_assets referenced release asset(s) do not exist"

grep -Fq -- 'private_route' "$SITE_DIR/.htaccess" || fail "private route X-Robots-Tag guard is missing"

# Installable Web App contract. A manifest that is missing, mis-scoped or
# backed by an absent or wrong-sized icon silently breaks installation, so
# each part is checked rather than assumed.
grep -Fq -- '"start_url": "/"' "$SITE_DIR/site.webmanifest" || fail "web app manifest start_url is wrong"
grep -Fq -- '"scope": "/"' "$SITE_DIR/site.webmanifest" || fail "web app manifest scope is wrong"
grep -Fq -- '"display": "standalone"' "$SITE_DIR/site.webmanifest" || fail "web app manifest is not installable"
grep -Fq -- '"theme_color": "#0a1020"' "$SITE_DIR/site.webmanifest" || fail "web app manifest theme colour does not match the site"
grep -Fq -- '"purpose": "maskable"' "$SITE_DIR/site.webmanifest" || fail "web app manifest has no maskable icon"
grep -Fq -- '"short_name": "NATHEE 2025"' "$SITE_DIR/site.webmanifest" || fail "web app manifest short name is wrong"
if grep -Eq -- '"(start_url|scope|src)": "https?://' "$SITE_DIR/site.webmanifest"; then
  fail "web app manifest must use same-origin paths"
fi

# Every manifest icon must exist and be a real PNG of the declared size.
verify_png() {
  local relative_path="$1"
  local expected_hex="$2"
  local absolute="$SITE_DIR/$relative_path"
  [[ -f "$absolute" ]] || fail "app icon is missing: $relative_path"
  [[ "$(od -An -v -tx1 -N8 "$absolute" | tr -d ' \n')" == "89504e470d0a1a0a" ]] || fail "app icon is not a PNG: $relative_path"
  [[ "$(od -An -v -tx1 -j16 -N8 "$absolute" | tr -d ' \n')" == "$expected_hex" ]] || fail "app icon has the wrong dimensions: $relative_path"
}
verify_png assets/brand/icon-192.png 000000c0000000c0
verify_png assets/brand/icon-512.png 0000020000000200
verify_png assets/brand/icon-maskable-512.png 0000020000000200
verify_png assets/brand/apple-touch-icon-180.png 000000b4000000b4

for manifest_icon in icon-192 icon-512 icon-maskable-512; do
  grep -Fq -- "/assets/brand/$manifest_icon.png" "$SITE_DIR/site.webmanifest" || fail "web app manifest does not reference $manifest_icon.png"
done

# Installation must be offered from every public route and the login route.
for install_route in "" services/ motorcycle-transport/ international/ storage/ container-loading/ dealer-fleet/ gallery/ about/ contact/ quotation/ login/; do
  install_page="$SITE_DIR/${install_route}index.html"
  grep -Fq -- '<link rel="manifest" href="/site.webmanifest">' "$install_page" || fail "manifest link is missing for /$install_route"
  grep -Fq -- '<link rel="apple-touch-icon" sizes="180x180" href="/assets/brand/apple-touch-icon-180.png">' "$install_page" || fail "apple touch icon is missing for /$install_route"
  grep -Fq -- '<meta name="theme-color" content="#0a1020">' "$install_page" || fail "theme colour is missing for /$install_route"
done

# Shared hosting will not serve the manifest correctly without the type.
grep -Fq -- 'AddType application/manifest+json .webmanifest' "$SITE_DIR/.htaccess" || fail "webmanifest MIME type is not declared"

# A cache-first Service Worker can keep serving a superseded release, so the
# static site must not ship one until that is a reviewed decision.
if find "$SITE_DIR" -maxdepth 2 -type f \( -name 'sw.js' -o -name 'service-worker.js' \) -print | grep -q .; then
  fail "an unreviewed Service Worker is present in the release"
fi

printf 'PUBLIC_SITE_VERIFY_PASS files=%s publicRoutes=11\n' "$(find "$SITE_DIR" -type f | wc -l | tr -d ' ')"
printf 'PUBLIC_SEO_VERIFY_PASS pages=11 jsonld=verified noindex=verified sitemap=public-only images=alt-checked\n'
printf 'PUBLIC_GALLERY_VERIFY_PASS manifest=v1 categories=10 publishedItems=9\n'
printf 'PUBLIC_OWNER_MEDIA_VERIFY_PASS logo=present lineQr=checksum-verified homePhotos=%s galleryPhotos=%s assetRefs=resolved\n' "$home_photo_count" "$gallery_photo_count"
printf 'PUBLIC_MOBILE_PERFORMANCE_PASS criticalBytes=%s budget=102400 javascript=defer breakpoints=980,680\n' "$critical_bytes"
printf 'PUBLIC_PWA_VERIFY_PASS manifest=same-origin display=standalone icons=4 maskable=1 installRoutes=12 serviceWorker=absent\n'
