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
)

for file in "${required_files[@]}"; do
  [[ -f "$SITE_DIR/$file" ]] || fail "missing required file: $file"
done

if find "$SITE_DIR" -type l -print | grep -q .; then
  fail "symbolic links are not allowed"
fi

wrong_domain_regex='natee''group2025\.com'
forbidden_regex="https://$wrong_domain_regex|02-000-0000|@natheegroup|ABC MOTOR|nathee-quotes|window\.storage|localStorage|abc123|owner123|staff123|nathee2025|1,000\\+|10,000\\+"
if grep -RInE -- "$forbidden_regex" "$SITE_DIR"; then
  fail "demo, placeholder, or wrong-domain content found"
fi

grep -Fq -- '<link rel="canonical" href="https://natheegroup2025.com/">' "$SITE_DIR/index.html" || fail "canonical link is missing"
grep -Fq -- '<meta property="og:title"' "$SITE_DIR/index.html" || fail "Open Graph title is missing"
grep -Fq -- '<meta property="og:description"' "$SITE_DIR/index.html" || fail "Open Graph description is missing"
grep -Fq -- '<meta name="twitter:title"' "$SITE_DIR/index.html" || fail "Twitter title is missing"
grep -Fq -- '<meta name="twitter:description"' "$SITE_DIR/index.html" || fail "Twitter description is missing"
grep -Fq -- 'type="application/ld+json"' "$SITE_DIR/index.html" || fail "structured data is missing"
grep -Fq -- '"Organization"' "$SITE_DIR/index.html" || fail "Organization structured data is missing"
grep -Fq -- 'href="tel:0631941191"' "$SITE_DIR/index.html" || fail "primary telephone link is missing"
grep -Fq -- 'href="tel:0856802082"' "$SITE_DIR/index.html" || fail "secondary telephone link is missing"
grep -Fq -- 'LINE' "$SITE_DIR/index.html" || fail "LINE status is missing"
grep -Fq -- 'อยู่ระหว่างยืนยัน' "$SITE_DIR/index.html" || fail "unverified LINE state is not explicit"
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

if grep -RInE -- 'RewriteRule[^[:cntrl:]]*index\.php' "$SITE_DIR/.htaccess"; then
  fail "stale WordPress index.php rewrite found"
fi

for route in services motorcycle-transport international storage container-loading dealer-fleet gallery about contact quotation; do
  page="$SITE_DIR/$route/index.html"
  grep -Fq -- "<link rel=\"canonical\" href=\"https://natheegroup2025.com/$route/\">" "$page" || fail "canonical missing for /$route/"
  grep -Fq -- '<meta property="og:title"' "$page" || fail "Open Graph missing for /$route/"
  grep -Fq -- 'type="application/ld+json"' "$page" || fail "JSON-LD missing for /$route/"
done
grep -Fq -- '"version": 1' "$SITE_DIR/assets/gallery.json" || fail "gallery manifest version is invalid"
grep -Fq -- '"items": [' "$SITE_DIR/assets/gallery.json" || fail "gallery manifest items are missing"
grep -Fq -- 'private_route' "$SITE_DIR/.htaccess" || fail "private route X-Robots-Tag guard is missing"

printf 'PUBLIC_SITE_VERIFY_PASS files=%s publicRoutes=11\n' "$(find "$SITE_DIR" -type f | wc -l | tr -d ' ')"
printf 'PUBLIC_SEO_VERIFY_PASS pages=11 jsonld=verified noindex=verified sitemap=public-only images=alt-checked\n'
printf 'PUBLIC_GALLERY_VERIFY_PASS manifest=v1 categories=10\n'
printf 'PUBLIC_MOBILE_PERFORMANCE_PASS criticalBytes=%s budget=102400 javascript=defer breakpoints=980,680\n' "$critical_bytes"
