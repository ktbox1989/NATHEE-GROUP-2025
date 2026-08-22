#!/usr/bin/env bash

# Single source of truth for whether the public /login/ entry point is served
# locally or handed to the application runtime.
#
# The release scripts must agree with the release they are deploying. If the
# live postcheck assumed /login/ is always 200, activating the redirect would
# make a correct deployment fail its own postcheck and roll itself back.

NATHEE_LOGIN_REDIRECT_BEGIN="# BEGIN NATHEE LOGIN REDIRECT"
NATHEE_LOGIN_REDIRECT_END="# END NATHEE LOGIN REDIRECT"

# Echoes ACTIVE, INACTIVE, or MISSING when the managed block is absent.
nathee_login_redirect_state() {
  local htaccess="$1"
  [[ -f "$htaccess" ]] || { printf 'MISSING\n'; return 0; }
  grep -Fq -- "$NATHEE_LOGIN_REDIRECT_BEGIN" "$htaccess" || { printf 'MISSING\n'; return 0; }

  local declared
  declared="$(grep -oE '^# NATHEE_LOGIN_REDIRECT_STATE=[A-Z]+' "$htaccess" | head -n 1 | cut -d '=' -f 2)"
  case "$declared" in
    ACTIVE|INACTIVE) printf '%s\n' "$declared" ;;
    *) printf 'MISSING\n' ;;
  esac
}

# Echoes the configured application login URL, empty when unset.
nathee_login_redirect_target() {
  local htaccess="$1"
  [[ -f "$htaccess" ]] || return 0
  grep -oE '^# NATHEE_LOGIN_REDIRECT_TARGET=\S+' "$htaccess" | head -n 1 | cut -d '=' -f 2-
}

# True when the release expects the live /login/ to hand off to the application.
nathee_login_redirect_is_active() {
  [[ "$(nathee_login_redirect_state "$1")" == "ACTIVE" ]]
}
