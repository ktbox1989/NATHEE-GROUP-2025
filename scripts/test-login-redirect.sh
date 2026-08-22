#!/usr/bin/env bash
set -Eeuo pipefail

# Regression coverage for the public /login/ handoff.
#
# The redirect is a release action that changes what real visitors see, so both
# states are proven here before either can be deployed. Every check runs against
# a copy of the release; the real public-site/.htaccess is never written.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
SOURCE_ROOT="$REPO_ROOT/public-site"
TOGGLE="$SCRIPT_DIR/set-login-redirect.mjs"
VERIFIER="$SCRIPT_DIR/verify-public-site.sh"

# shellcheck source=scripts/lib/login-redirect.sh
source "$SCRIPT_DIR/lib/login-redirect.sh"
# shellcheck source=scripts/lib/deploy-file-tools.sh
source "$SCRIPT_DIR/lib/deploy-file-tools.sh"

fail() {
  printf 'LOGIN_REDIRECT_TEST_FAIL: %s\n' "$1" >&2
  exit 1
}

WORK_ROOT=""
cleanup() {
  local exit_code=$?
  trap - EXIT
  if [[ -n "$WORK_ROOT" && -d "$WORK_ROOT" ]]; then
    case "$WORK_ROOT" in
      */nathee-login-redirect.*) rm -rf "$WORK_ROOT" ;;
      *) printf 'LOGIN_REDIRECT_TEST_CLEANUP_SKIPPED unsafe=%s\n' "$WORK_ROOT" >&2 ;;
    esac
  fi
  exit "$exit_code"
}
trap cleanup EXIT

WORK_ROOT="$(nathee_make_temp_dir nathee-login-redirect)" || fail "could not create a temporary directory"
RELEASE="$WORK_ROOT/public-site"
mkdir -p "$RELEASE"
cp -R "$SOURCE_ROOT/." "$RELEASE/"
HTACCESS="$RELEASE/.htaccess"

original_state="$(nathee_login_redirect_state "$SOURCE_ROOT/.htaccess")"
checks=0
pass() { checks=$((checks + 1)); printf 'LOGIN_REDIRECT_CASE %s\n' "$1"; }

# The committed release must never ship an active handoff by accident: it takes
# the login entry point off the air the moment it is deployed.
[[ "$original_state" == "INACTIVE" ]] || fail "the committed release must be INACTIVE, found $original_state"
pass committed-release-inactive

# --- INACTIVE ---------------------------------------------------------------
node "$TOGGLE" --state inactive --file "$HTACCESS" >/dev/null
[[ "$(nathee_login_redirect_state "$HTACCESS")" == "INACTIVE" ]] || fail "state should be INACTIVE"
if grep -Eq 'RewriteRule[^[:cntrl:]]*app\.natheegroup2025\.com' "$HTACCESS"; then
  fail "an inactive release must contain no redirect rule"
fi
bash "$VERIFIER" "$RELEASE" >/dev/null || fail "the inactive release must pass the deploy gate"
pass inactive-serves-local-page

# --- ACTIVE -----------------------------------------------------------------
printf 'APP_INTEGRATION_GATE_PASS app=https://app.natheegroup2025.com\n' > "$WORK_ROOT/evidence.txt"
node "$TOGGLE" --state active --evidence "$WORK_ROOT/evidence.txt" --file "$HTACCESS" >/dev/null
[[ "$(nathee_login_redirect_state "$HTACCESS")" == "ACTIVE" ]] || fail "state should be ACTIVE"

rule="$(grep -E '^\s*RewriteRule \^login' "$HTACCESS" || true)"
[[ -n "$rule" ]] || fail "the active release must contain the login rewrite rule"

# 302, never 301: a permanent redirect is cached by browsers and cannot be
# withdrawn if the application has to be rolled back.
printf '%s\n' "$rule" | grep -Fq 'R=302' || fail "the handoff must use 302"
if printf '%s\n' "$rule" | grep -Fq 'R=301'; then fail "the handoff must never use 301"; fi
# QSA keeps returnTo and error, which the application login page needs.
printf '%s\n' "$rule" | grep -Fq 'QSA' || fail "query parameters must be preserved"
printf '%s\n' "$rule" | grep -Fq 'https://app.natheegroup2025.com/login' || fail "the target must be the application login URL"
printf '%s\n' "$rule" | grep -Eq 'https://' || fail "the target must be HTTPS"
# Both /login and /login/ must be handed over.
printf '%s\n' "$rule" | grep -Eq '\^login/\?\$' || fail "the rule must match /login and /login/"
pass active-rule-contract

# Only the canonical apex redirects, so the rule cannot loop if the application
# host is ever pointed at this same document root.
grep -Eq 'RewriteCond %\{HTTP_HOST\} \^natheegroup2025' "$HTACCESS" || fail "the loop guard host condition is missing"
if grep -Eq 'RewriteRule[^[:cntrl:]]*https://natheegroup2025\.com/login' "$HTACCESS"; then
  fail "the target must not be the public host"
fi
pass active-loop-guard

# The local login page must remain in the release so rollback needs no rebuild.
[[ -f "$RELEASE/login/index.html" ]] || fail "the local login page must remain shipped"
grep -Fq '<meta name="robots" content="noindex,nofollow,noarchive">' "$RELEASE/login/index.html" \
  || fail "the login page must stay noindex"
grep -Fq 'Disallow: /login/' "$RELEASE/robots.txt" || fail "robots must still exclude /login/"
bash "$VERIFIER" "$RELEASE" >/dev/null || fail "the active release must also pass the deploy gate"
pass active-release-still-deployable

# --- Idempotency and rollback ----------------------------------------------
active_copy="$WORK_ROOT/active.htaccess"
cp "$HTACCESS" "$active_copy"
node "$TOGGLE" --state active --evidence "$WORK_ROOT/evidence.txt" --file "$HTACCESS" >/dev/null
cmp -s "$active_copy" "$HTACCESS" || fail "re-activating must change nothing"
pass activation-idempotent

node "$TOGGLE" --state inactive --file "$HTACCESS" >/dev/null
[[ "$(nathee_login_redirect_state "$HTACCESS")" == "INACTIVE" ]] || fail "rollback should restore INACTIVE"
if grep -Eq 'RewriteRule[^[:cntrl:]]*app\.natheegroup2025\.com' "$HTACCESS"; then
  fail "rollback must remove the redirect rule"
fi
cmp -s "$SOURCE_ROOT/.htaccess" "$HTACCESS" || fail "rollback must restore the committed release byte-for-byte"
pass rollback-restores-committed-release

# --- Activation refuses without proof ---------------------------------------
if node "$TOGGLE" --state active --file "$HTACCESS" >/dev/null 2>&1; then
  fail "activation without evidence must be refused"
fi
printf 'the application looks fine to me\n' > "$WORK_ROOT/bogus.txt"
if node "$TOGGLE" --state active --evidence "$WORK_ROOT/bogus.txt" --file "$HTACCESS" >/dev/null 2>&1; then
  fail "activation must require the integration gate token"
fi
[[ "$(nathee_login_redirect_state "$HTACCESS")" == "INACTIVE" ]] || fail "a refused activation must not change state"
pass activation-requires-gate-evidence

# The gate itself must fail closed while the application host does not exist.
if bash "$SCRIPT_DIR/verify-app-integration.sh" >/dev/null 2>&1; then
  fail "the integration gate must not pass while the application host is absent"
fi
pass integration-gate-fails-closed

# --- The postcheck must follow the release ----------------------------------
# A postcheck that always expects 200 would roll back a correct activation.
postcheck="$SCRIPT_DIR/postcheck-production.sh"
grep -Fq 'nathee_login_redirect_state' "$postcheck" || fail "the postcheck must read the release state"
grep -Fq 'LOGIN_REDIRECT_STATE' "$postcheck" || fail "the postcheck must report the release state"
grep -Fq 'must hand off with 302' "$postcheck" || fail "the postcheck must assert the 302 handoff"
grep -Fq 'would loop' "$postcheck" || fail "the postcheck must reject a self-referential redirect"
pass postcheck-follows-release-state

printf 'LOGIN_REDIRECT_TEST_PASS cases=%s committedState=%s\n' "$checks" "$original_state"
