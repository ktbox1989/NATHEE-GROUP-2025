#!/usr/bin/env bash
set -Eeuo pipefail

# Integration gate for handing the public /login/ entry point to the
# application runtime.
#
# Fail-closed by design: unless every check below passes, the public site keeps
# serving its own login page. Redirecting to a runtime that is not live would
# take the login entry point off the air, and a 302 issued to real visitors is
# not something a rollback can un-send.
#
# Read-only. It changes no file, no DNS record and no Production setting.
# Activation is a separate, deliberate step:
#   bash scripts/verify-app-integration.sh > app-integration-gate.txt
#   node scripts/set-login-redirect.mjs --state active --evidence app-integration-gate.txt

PUBLIC_BASE_URL="${NATHEE_PUBLIC_BASE_URL:-https://natheegroup2025.com}"
APP_BASE_URL="${NATHEE_APP_BASE_URL:-https://app.natheegroup2025.com}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"

# shellcheck source=scripts/lib/app-readiness.sh
source "$SCRIPT_DIR/lib/app-readiness.sh"
# shellcheck source=scripts/lib/deploy-file-tools.sh
source "$SCRIPT_DIR/lib/deploy-file-tools.sh"

fail() {
  printf 'APP_INTEGRATION_GATE_FAIL: %s\n' "$1" >&2
  exit 1
}

for required_command in curl grep awk tr rm mkdir date sha256sum; do
  command -v "$required_command" >/dev/null 2>&1 || fail "$required_command is required"
done

case "$APP_BASE_URL" in
  https://*) ;;
  *) fail "the application base URL must use HTTPS (got $APP_BASE_URL)" ;;
esac
case "$PUBLIC_BASE_URL" in
  https://*) ;;
  *) fail "the public base URL must use HTTPS (got $PUBLIC_BASE_URL)" ;;
esac

TMP_DIR="$(nathee_make_temp_dir nathee-integration-gate)" || fail "could not create a temporary directory"
trap 'rm -rf "$TMP_DIR"' EXIT

printf 'APP_INTEGRATION_GATE_START public=%s app=%s at=%s\n' \
  "$PUBLIC_BASE_URL" "$APP_BASE_URL" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Captures status without following redirects, so a redirect is observable
# rather than silently resolved.
probe_status() {
  local status=""
  # curl already writes 000 through --write-out when it cannot connect, so the
  # exit code must not append a second value.
  status="$(curl --silent --show-error --max-redirs 0 --output "$2" --write-out '%{http_code}' "$1" 2>/dev/null)" || true
  [[ -n "$status" ]] || status="000"
  printf '%s' "$status"
}

reject_server_error() {
  local label="$1"
  local status="$2"
  case "$status" in
    5??) fail "$label returned a server error (status=$status)" ;;
    000) fail "$label was unreachable" ;;
  esac
}

# 1. Application readiness. Every gate /api/health reports must be true; an
#    absent gate fails closed too.
health_status="$(probe_status "$APP_BASE_URL/api/health" "$TMP_DIR/health.json")"
reject_server_error "/api/health" "$health_status"
[[ "$health_status" == "200" ]] || fail "/api/health is not 200 (status=$health_status)"

health_failures="$(nathee_health_failures "$TMP_DIR/health.json")"
if [[ -n "$health_failures" ]]; then
  printf 'APP_INTEGRATION_HEALTH_FAILURE %s\n' $health_failures >&2
  fail "application readiness is incomplete"
fi
printf 'APP_INTEGRATION_CHECK health=PASS checks=6\n'

# 2. The application login page must actually answer. This is the page the
#    public site is about to hand every visitor to.
login_status="$(probe_status "$APP_BASE_URL/login" "$TMP_DIR/login.html")"
reject_server_error "/login" "$login_status"
case "$login_status" in
  200) ;;
  *) fail "application /login is not 200 (status=$login_status)" ;;
esac
[[ -s "$TMP_DIR/login.html" ]] || fail "application /login returned an empty body"
printf 'APP_INTEGRATION_CHECK login=PASS status=200\n'

# 3. The authentication callback must exist. A missing callback breaks sign-in
#    only after a visitor has already left the public site.
callback_status="$(probe_status "$APP_BASE_URL/auth/callback" "$TMP_DIR/callback.html")"
reject_server_error "/auth/callback" "$callback_status"
case "$callback_status" in
  404) fail "/auth/callback does not exist on the application host" ;;
esac
printf 'APP_INTEGRATION_CHECK authCallback=PRESENT status=%s\n' "$callback_status"

# 4. Loop guard. If the application host resolves to this same static document
#    root, the redirect would send visitors straight back to itself. Comparing
#    the served bytes detects that without needing a marker in the public
#    release, which is closed and must not be modified for this.
app_root_status="$(probe_status "$APP_BASE_URL/" "$TMP_DIR/app-root.html")"
reject_server_error "application root" "$app_root_status"
public_root_status="$(probe_status "$PUBLIC_BASE_URL/" "$TMP_DIR/public-root.html")"
reject_server_error "public root" "$public_root_status"

content_sha() {
  sha256sum "$1" | awk '{ print $1 }'
}
if [[ "$(content_sha "$TMP_DIR/app-root.html")" == "$(content_sha "$TMP_DIR/public-root.html")" ]]; then
  fail "the application host serves the public static site byte-for-byte; activating the redirect would loop"
fi

# The same misconfiguration, checked on the exact path being handed over.
public_login_status="$(probe_status "$PUBLIC_BASE_URL/login/" "$TMP_DIR/public-login.html")"
reject_server_error "public /login/" "$public_login_status"
if [[ "$(content_sha "$TMP_DIR/login.html")" == "$(content_sha "$TMP_DIR/public-login.html")" ]]; then
  fail "the application /login is the public placeholder page; activating the redirect would loop"
fi
printf 'APP_INTEGRATION_CHECK loopGuard=PASS appRootStatus=%s distinctFromPublic=yes\n' "$app_root_status"

# 5. The application must not be indexable, and must not claim the public
#    canonical URL as its own.
if grep -Fq '<link rel="canonical" href="https://natheegroup2025.com/">' "$TMP_DIR/login.html" 2>/dev/null; then
  fail "application /login declares the public homepage as its canonical URL"
fi
if ! grep -Eiq 'name="robots"[^>]*noindex' "$TMP_DIR/login.html" 2>/dev/null; then
  fail "application /login is missing a noindex robots directive"
fi
printf 'APP_INTEGRATION_CHECK appLoginNoindex=PASS\n'

# 6. The public site must still be healthy. Handing over the login entry point
#    is only safe while everything else about the public release still works.
for public_route in / /services/ /gallery/ /about/ /contact/ /quotation/ /robots.txt /sitemap.xml; do
  public_status="$(probe_status "$PUBLIC_BASE_URL$public_route" "$TMP_DIR/public.html")"
  reject_server_error "public $public_route" "$public_status"
  [[ "$public_status" == "200" ]] || fail "public $public_route is not 200 (status=$public_status)"
done
printf 'APP_INTEGRATION_CHECK publicRoutes=PASS count=8\n'

bash "$SCRIPT_DIR/verify-public-site.sh" "$REPO_ROOT/public-site" >/dev/null \
  || fail "the public release no longer passes its own verification"
printf 'APP_INTEGRATION_CHECK publicRelease=PASS\n'

printf 'APP_INTEGRATION_GATE_PASS app=%s login=200 authCallback=%s health=6 publicRoutes=8 loop=none\n' \
  "$APP_BASE_URL" "$callback_status"
printf 'Activation is still a separate deliberate step; this gate changed nothing.\n'
