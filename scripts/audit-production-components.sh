#!/usr/bin/env bash
set -Eeuo pipefail

PUBLIC_BASE_URL="${NATHEE_PUBLIC_BASE_URL:-https://natheegroup2025.com}"
APP_BASE_URL="${NATHEE_APP_BASE_URL:-}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

# shellcheck source=scripts/lib/app-readiness.sh
source "$SCRIPT_DIR/lib/app-readiness.sh"

fail() {
  printf 'PRODUCTION_COMPONENT_AUDIT_FAIL: %s\n' "$1" >&2
  exit 1
}

for command_name in curl grep rm; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required"
done

case "$PUBLIC_BASE_URL" in
  https://*) ;;
  *) fail "public Production base URL must use HTTPS" ;;
esac

status_for() {
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$1"
}

public_status="$(status_for "$PUBLIC_BASE_URL/")"
gallery_status="$(status_for "$PUBLIC_BASE_URL/gallery/")"
login_status="$(status_for "$PUBLIC_BASE_URL/login/")"
[[ "$public_status" == "200" ]] || fail "public homepage is not live (status=$public_status)"
[[ "$gallery_status" == "200" ]] || fail "public Gallery route is not live (status=$gallery_status)"
[[ "$login_status" == "200" ]] || fail "static login-status route is not live (status=$login_status)"

printf 'PRODUCTION_COMPONENT public-static-site=LIVE path=/home/zptqqwps/public_html/natheegroup2025.com url=%s/\n' "$PUBLIC_BASE_URL"
printf 'PRODUCTION_COMPONENT public-gallery=LIVE_STATIC_MANIFEST url=%s/gallery/\n' "$PUBLIC_BASE_URL"
printf 'PRODUCTION_COMPONENT login-auth=STATIC_PLACEHOLDER_ONLY url=%s/login/\n' "$PUBLIC_BASE_URL"

if [[ -z "$APP_BASE_URL" ]]; then
  printf 'PRODUCTION_COMPONENT full-application=NOT_CONFIGURED url=NONE\n'
  printf 'PRODUCTION_COMPONENT backend-api=NOT_CONFIGURED url=NONE\n'
  printf 'PRODUCTION_COMPONENT database-migrations=NOT_VERIFIED\n'
  printf 'PRODUCTION_COMPONENT qr-print-notification=NOT_DEPLOYED\n'
  printf 'PRODUCTION_COMPONENT gallery-management=NOT_DEPLOYED\n'
  printf 'PRODUCTION_COMPONENT_AUDIT_PASS public=LIVE fullApplication=NOT_CLAIMED\n'
  exit 0
fi

case "$APP_BASE_URL" in
  https://*) ;;
  *) fail "application Production base URL must use HTTPS" ;;
esac

health_file="${TMPDIR:-/tmp}/nathee-health-$$.json"
trap 'rm -f "$health_file"' EXIT
health_status="$(curl --silent --show-error --output "$health_file" --write-out '%{http_code}' "$APP_BASE_URL/api/health")"
[[ "$health_status" == "200" ]] || fail "application health is not ready (status=$health_status)"

health_failures="$(nathee_health_failures "$health_file")"
if [[ -n "$health_failures" ]]; then
  printf 'PRODUCTION_HEALTH_FAILURE %s\n' $health_failures >&2
  fail "application readiness is incomplete"
fi

# Health only proves configuration and schema. Prove separately that the
# protected surface refuses an anonymous request, because a runtime that serves
# /app to a signed-out visitor is a data breach, not a deployment.
app_status="$(status_for "$APP_BASE_URL/app")"
app_verdict="$(nathee_anonymous_gate_verdict "$app_status")"
printf 'PRODUCTION_ANONYMOUS_GATE route=/app status=%s verdict=%s\n' "$app_status" "$app_verdict"
nathee_anonymous_gate_ok "$app_status" || fail "/app is reachable without authentication (status=$app_status)"

for protected_api in /api/companies /api/motorcycles /api/jobs; do
  api_status="$(status_for "$APP_BASE_URL$protected_api")"
  api_verdict="$(nathee_anonymous_gate_verdict "$api_status")"
  printf 'PRODUCTION_ANONYMOUS_GATE route=%s status=%s verdict=%s\n' "$protected_api" "$api_status" "$api_verdict"
  nathee_anonymous_gate_ok "$api_status" || fail "$protected_api is reachable without authentication (status=$api_status)"
done

printf 'PRODUCTION_COMPONENT backend-api=RUNTIME_HEALTHY url=%s/api/health checks=6\n' "$APP_BASE_URL"
printf 'PRODUCTION_COMPONENT database-migrations=RUNTIME_HEALTHY scope=required-objects-through-0021\n'
printf 'PRODUCTION_COMPONENT full-application=RUNTIME_HEALTHY_ANONYMOUS_GATED url=%s/app\n' "$APP_BASE_URL"

# These require a real signed-in session and cannot be proven by an anonymous
# probe. Naming them keeps a healthy runtime from being reported as a complete
# Production acceptance.
printf 'PRODUCTION_NOT_PROVEN real-login=REQUIRES_SIGNED_IN_ACCEPTANCE\n'
printf 'PRODUCTION_NOT_PROVEN owner-mapping=REQUIRES_SIGNED_IN_ACCEPTANCE\n'
printf 'PRODUCTION_NOT_PROVEN customer-isolation=REQUIRES_TWO_COMPANY_ACCEPTANCE\n'
printf 'PRODUCTION_NOT_PROVEN qr-scan=REQUIRES_SIGNED_IN_ACCEPTANCE\n'
printf 'PRODUCTION_COMPONENT_AUDIT_PASS public=LIVE fullApplication=RUNTIME_HEALTHY acceptance=NOT_CLAIMED\n'
