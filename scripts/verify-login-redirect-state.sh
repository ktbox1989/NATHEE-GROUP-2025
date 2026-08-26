#!/usr/bin/env bash
set -Eeuo pipefail

# Z.com runtime gate for the public /login/ handoff state.
#
# Pure bash. Z.com shared hosting has no node, npm or npx, so the Node-driven
# regression suite (scripts/test-login-redirect.sh) runs locally and in CI
# before push and must never be a Production gate. This script re-checks, on
# the host that is about to deploy, only what a portable shell can prove:
# which state the release declares, and that the rewrite contract is intact.
#
# Default expectation is INACTIVE. The redirect stays off until Lane B reports
# APP_INTEGRATION_GATE_PASS, so a release that would switch it on is rejected here
# rather than discovered by visitors.
#
# Usage:
#   bash scripts/verify-login-redirect-state.sh
#   NATHEE_EXPECT_LOGIN_REDIRECT=ACTIVE bash scripts/verify-login-redirect-state.sh --evidence app-integration-gate.txt

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
HTACCESS="${NATHEE_HTACCESS:-$REPO_ROOT/public-site/.htaccess}"
EXPECTED="${NATHEE_EXPECT_LOGIN_REDIRECT:-INACTIVE}"
EVIDENCE=""

# The live, release-specific integration token required before the handoff may
# be expected. Whole-platform health intentionally stays degraded in the
# supported Owner-PIN-only mode, so APP_RUNTIME_PASS is the wrong contract here.
REQUIRED_EVIDENCE_TOKEN="APP_INTEGRATION_GATE_PASS"
APP_LOGIN_URL="https://app.natheegroup2025.com/login"

# shellcheck source=scripts/lib/login-redirect.sh
source "$SCRIPT_DIR/lib/login-redirect.sh"

fail() {
  printf 'LOGIN_REDIRECT_STATE_FAIL: %s\n' "$1" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --evidence)
      EVIDENCE="${2:-}"
      [[ -n "$EVIDENCE" ]] || fail "--evidence needs a file path"
      shift 2
      ;;
    *) fail "unexpected argument: $1" ;;
  esac
done

case "$EXPECTED" in
  ACTIVE|INACTIVE) ;;
  *) fail "NATHEE_EXPECT_LOGIN_REDIRECT must be ACTIVE or INACTIVE (got $EXPECTED)" ;;
esac

[[ -f "$HTACCESS" ]] || fail "release .htaccess not found: $HTACCESS"

actual="$(nathee_login_redirect_state "$HTACCESS")"
target="$(nathee_login_redirect_target "$HTACCESS")"
printf 'LOGIN_REDIRECT_RELEASE_STATE=%s\n' "$actual"
printf 'LOGIN_REDIRECT_RELEASE_TARGET=%s\n' "${target:-NONE}"

[[ "$actual" != "MISSING" ]] || fail "the managed login-redirect block is missing or malformed"
[[ "$target" == "$APP_LOGIN_URL" ]] || fail "unexpected redirect target: ${target:-NONE}"

# Expecting ACTIVE requires proof from Lane B, so the handoff cannot be turned
# on by editing an environment variable.
if [[ "$EXPECTED" == "ACTIVE" ]]; then
  [[ -n "$EVIDENCE" ]] || fail "expecting ACTIVE requires --evidence containing $REQUIRED_EVIDENCE_TOKEN"
  [[ -f "$EVIDENCE" ]] || fail "could not read the evidence file: $EVIDENCE"
  grep -Fq -- "$REQUIRED_EVIDENCE_TOKEN" "$EVIDENCE" \
    || fail "the evidence file does not contain $REQUIRED_EVIDENCE_TOKEN"
fi

[[ "$actual" == "$EXPECTED" ]] \
  || fail "release declares $actual but this deployment expects $EXPECTED"

if [[ "$actual" == "INACTIVE" ]]; then
  # An inactive release must carry no rewrite at all, and must still ship the
  # local login page so the public entry point keeps working.
  if grep -Eq 'RewriteRule[^[:cntrl:]]*app\.natheegroup2025\.com' "$HTACCESS"; then
    fail "an INACTIVE release still contains a redirect rule"
  fi
  [[ -f "$REPO_ROOT/public-site/login/index.html" ]] || fail "the local login page is missing from the release"
  grep -Fq '<meta name="robots" content="noindex,nofollow,noarchive">' "$REPO_ROOT/public-site/login/index.html" \
    || fail "the local login page is not noindex"
  printf 'LOGIN_REDIRECT_STATE_PASS state=INACTIVE localLoginPage=shipped noindex=verified rule=absent\n'
  exit 0
fi

# ACTIVE: re-check the rewrite contract with portable tools. The Node suite
# proves far more, but it cannot run here, and this is the release that is
# about to reach real visitors.
rule="$(grep -E '^[[:space:]]*RewriteRule \^login' "$HTACCESS" || true)"
[[ -n "$rule" ]] || fail "an ACTIVE release contains no login rewrite rule"

printf '%s\n' "$rule" | grep -Fq 'R=302' || fail "the handoff must use 302"
if printf '%s\n' "$rule" | grep -Fq 'R=301'; then
  fail "the handoff must never use 301; a cached permanent redirect cannot be withdrawn"
fi
printf '%s\n' "$rule" | grep -Fq 'QSA' || fail "query parameters must be preserved"
printf '%s\n' "$rule" | grep -Fq "$APP_LOGIN_URL" || fail "the rule does not target the application login URL"
printf '%s\n' "$rule" | grep -Eq 'https://' || fail "the redirect target must be HTTPS"
printf '%s\n' "$rule" | grep -Eq '\^login/\?\$' || fail "the rule must match both /login and /login/"

grep -Eq 'RewriteCond %\{HTTP_HOST\} \^natheegroup2025' "$HTACCESS" \
  || fail "the apex host condition is missing; the rule could loop"
if grep -Eq 'RewriteRule[^[:cntrl:]]*https://natheegroup2025\.com/login' "$HTACCESS"; then
  fail "the redirect target points back at the public host and would loop"
fi

# Rollback must not require a rebuild.
[[ -f "$REPO_ROOT/public-site/login/index.html" ]] || fail "the local login page must stay shipped for rollback"
grep -Fq 'Disallow: /login/' "$REPO_ROOT/public-site/robots.txt" || fail "robots.txt must still exclude /login/"

printf 'LOGIN_REDIRECT_STATE_PASS state=ACTIVE code=302 qsa=yes https=yes loopGuard=yes rollback=shipped\n'
