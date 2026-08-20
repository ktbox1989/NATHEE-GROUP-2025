#!/usr/bin/env bash
set -Eeuo pipefail

PUBLIC_BASE_URL="${NATHEE_PUBLIC_BASE_URL:-https://natheegroup2025.com}"
APP_BASE_URL="${NATHEE_APP_BASE_URL:-}"

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
grep -Eq '"authentication"[[:space:]]*:[[:space:]]*true' "$health_file" || fail "authentication readiness is false"
grep -Eq '"database"[[:space:]]*:[[:space:]]*true' "$health_file" || fail "database readiness is false"
grep -Eq '"storage"[[:space:]]*:[[:space:]]*true' "$health_file" || fail "storage readiness is false"

printf 'PRODUCTION_COMPONENT full-application=LIVE url=%s/app\n' "$APP_BASE_URL"
printf 'PRODUCTION_COMPONENT backend-api=LIVE url=%s/api/health\n' "$APP_BASE_URL"
printf 'PRODUCTION_COMPONENT database-migrations=RUNTIME_HEALTHY\n'
printf 'PRODUCTION_COMPONENT_AUDIT_PASS public=LIVE fullApplication=HEALTHY\n'
