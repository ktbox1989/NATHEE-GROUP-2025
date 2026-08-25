#!/usr/bin/env bash
set -Eeuo pipefail

# Z.com runtime gate for the apex proxy of the application's public surfaces.
#
# Pure bash, for the same reason the login gate is: the web host has no node,
# so the Node suite runs locally and in CI and must never be a Production gate.
# This re-checks on the host that is about to deploy only what a portable shell
# can prove.
#
# Default expectation is INACTIVE. The apex must keep serving its own
# /assets/media/ (nothing) and /sitemap.xml (the static file) until the
# application is reachable and mod_proxy is proven present, because a [P] rule
# without mod_proxy does not proxy - it fails - and a proxy to a host that is
# not serving replaces working pages with errors.
#
# Usage:
#   bash scripts/verify-public-apex-mapping-state.sh
#   NATHEE_EXPECT_APEX_MAPPING=ACTIVE bash scripts/verify-public-apex-mapping-state.sh \
#       --evidence app-integration.txt --proxy-evidence zcom-probe.txt

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
HTACCESS="${NATHEE_HTACCESS:-$REPO_ROOT/public-site/.htaccess}"
EXPECTED="${NATHEE_EXPECT_APEX_MAPPING:-INACTIVE}"
EVIDENCE=""
PROXY_EVIDENCE=""

APP_ORIGIN="https://app.natheegroup2025.com"
REQUIRED_APP_TOKEN="APP_INTEGRATION_GATE_PASS"
REQUIRED_PROXY_TOKEN="ZCOM_MOD_PROXY=AVAILABLE"

fail() {
  printf 'APEX_MAPPING_STATE_FAIL: %s\n' "$1" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --evidence)
      EVIDENCE="${2:-}"; [[ -n "$EVIDENCE" ]] || fail "--evidence needs a file path"; shift 2 ;;
    --proxy-evidence)
      PROXY_EVIDENCE="${2:-}"; [[ -n "$PROXY_EVIDENCE" ]] || fail "--proxy-evidence needs a file path"; shift 2 ;;
    *) fail "unexpected argument: $1" ;;
  esac
done

case "$EXPECTED" in
  ACTIVE|INACTIVE) ;;
  *) fail "NATHEE_EXPECT_APEX_MAPPING must be ACTIVE or INACTIVE (got $EXPECTED)" ;;
esac

[[ -f "$HTACCESS" ]] || fail "release .htaccess not found: $HTACCESS"

grep -Fq '# BEGIN NATHEE PUBLIC APEX MAPPING' "$HTACCESS" || fail "the managed apex-mapping block is missing"
grep -Fq '# END NATHEE PUBLIC APEX MAPPING' "$HTACCESS" || fail "the managed apex-mapping block is unterminated"

actual="$(sed -n 's/^# NATHEE_PUBLIC_APEX_MAPPING_STATE=\([A-Z]*\).*/\1/p' "$HTACCESS" | head -n 1)"
target="$(sed -n 's/^# NATHEE_PUBLIC_APEX_MAPPING_TARGET=\(.*\)/\1/p' "$HTACCESS" | head -n 1)"
[[ -n "$actual" ]] || fail "the managed block declares no state"
printf 'APEX_MAPPING_RELEASE_STATE=%s\n' "$actual"
printf 'APEX_MAPPING_RELEASE_TARGET=%s\n' "${target:-NONE}"

[[ "$target" == "$APP_ORIGIN" ]] || fail "unexpected proxy target: ${target:-NONE}"

# The static cache rule must not overwrite what the application decided for a
# proxied variant, in either state - the exemption is not part of the managed
# block and must survive a deactivation.
grep -Fq 'expr=%{REQUEST_URI} !~ m#^/assets/media/#' "$HTACCESS" \
  || fail "the static Cache-Control rule does not exempt proxied /assets/media/"

# Nothing authenticated may ever be proxied onto the apex.
#
# Iterated with a newline IFS rather than a process substitution or a
# herestring: neither is available on the deployment host, and
# scripts/test-deploy-file-tools.sh refuses both in a Z.com gate.
proxy_rules="$(grep -E '^[[:space:]]*RewriteRule[^[:cntrl:]]*\[P[,\]]' "$HTACCESS" || true)"
if [[ -n "$proxy_rules" ]]; then
  saved_ifs="$IFS"
  IFS='
'
  for rule in $proxy_rules; do
    case "$rule" in
      *"/api"*|*"/app/"*|*"/auth"*|*"/login"*)
        IFS="$saved_ifs"
        fail "an authenticated path is proxied onto the apex: $rule" ;;
    esac
  done
  IFS="$saved_ifs"
fi

if [[ "$EXPECTED" == "ACTIVE" ]]; then
  [[ -n "$EVIDENCE" ]] || fail "expecting ACTIVE requires --evidence containing $REQUIRED_APP_TOKEN"
  [[ -f "$EVIDENCE" ]] || fail "could not read the evidence file: $EVIDENCE"
  grep -Fq -- "$REQUIRED_APP_TOKEN" "$EVIDENCE" || fail "the evidence file does not contain $REQUIRED_APP_TOKEN"
  [[ -n "$PROXY_EVIDENCE" ]] || fail "expecting ACTIVE requires --proxy-evidence containing $REQUIRED_PROXY_TOKEN"
  [[ -f "$PROXY_EVIDENCE" ]] || fail "could not read the proxy evidence file: $PROXY_EVIDENCE"
  grep -Fq -- "$REQUIRED_PROXY_TOKEN" "$PROXY_EVIDENCE" \
    || fail "the proxy evidence does not contain $REQUIRED_PROXY_TOKEN; mod_proxy is not proven present"
fi

[[ "$actual" == "$EXPECTED" ]] || fail "release declares $actual but this deployment expects $EXPECTED"

if [[ "$actual" == "INACTIVE" ]]; then
  if grep -Eq '^[[:space:]]*RewriteRule[^[:cntrl:]]*\[P[,\]]' "$HTACCESS"; then
    fail "an INACTIVE release still contains a proxy rule"
  fi
  # The static sitemap must still be shipped, because it is what the apex is
  # still serving.
  [[ -f "$REPO_ROOT/public-site/sitemap.xml" ]] || fail "the static sitemap is missing from the release"
  printf 'APEX_MAPPING_STATE_PASS state=INACTIVE proxyRules=absent staticSitemap=shipped cacheExemption=present\n'
  exit 0
fi

# ACTIVE: re-check the proxy contract with portable tools.
media_rule="$(grep -E '^[[:space:]]*RewriteRule \^assets/media' "$HTACCESS" || true)"
sitemap_rule="$(grep -E '^[[:space:]]*RewriteRule \^sitemap' "$HTACCESS" || true)"
[[ -n "$media_rule" ]] || fail "an ACTIVE release contains no /assets/media/ proxy rule"
[[ -n "$sitemap_rule" ]] || fail "an ACTIVE release contains no /sitemap.xml proxy rule"

for rule in "$media_rule" "$sitemap_rule"; do
  printf '%s\n' "$rule" | grep -Fq '[P' || fail "the rule is not a proxy: $rule"
  printf '%s\n' "$rule" | grep -Fq 'QSA' || fail "query parameters must be preserved: $rule"
  printf '%s\n' "$rule" | grep -Fq "$APP_ORIGIN" || fail "the rule does not target the application origin: $rule"
  if printf '%s\n' "$rule" | grep -Eq 'R=30[12]'; then
    fail "a redirect cannot deliver these bytes: the application sets Cross-Origin-Resource-Policy: same-origin"
  fi
done

grep -Eq 'RewriteCond %\{HTTP_HOST\} \^natheegroup2025' "$HTACCESS" \
  || fail "the apex host condition is missing; the rule could loop"
grep -Fq '<IfModule mod_proxy.c>' "$HTACCESS" \
  || fail "the proxy rules are not guarded by mod_proxy; without it Apache would error rather than fall through"

printf 'APEX_MAPPING_STATE_PASS state=ACTIVE proxy=media+sitemap qsa=yes https=yes loopGuard=yes modProxyGuard=yes\n'
