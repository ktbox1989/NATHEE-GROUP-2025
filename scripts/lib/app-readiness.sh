#!/usr/bin/env bash

# Readiness decisions for the protected application runtime, kept separate from
# the network calls so they can be tested against fixtures without a live host.
# Pure bash: the audit runs from Z.com shared hosting, where Node is optional.

# Every check /api/health reports. Missing even one must fail closed, because a
# partially configured runtime is exactly the state that looks healthy and is
# not. Keep this list in sync with RuntimeChecks in lib/runtime-readiness.ts.
NATHEE_HEALTH_CHECKS="authentication adminAuthentication canonicalOrigin database storage antiAbuse"

# Echoes one line per failed check. Empty output means every check passed.
nathee_health_failures() {
  local health_file="$1"
  local check_name

  if [[ ! -s "$health_file" ]]; then
    printf 'health-response-empty\n'
    return 0
  fi

  for check_name in $NATHEE_HEALTH_CHECKS; do
    if grep -Eq "\"$check_name\"[[:space:]]*:[[:space:]]*true" "$health_file"; then
      continue
    fi
    if grep -Eq "\"$check_name\"[[:space:]]*:" "$health_file"; then
      printf '%s-false\n' "$check_name"
    else
      # An older runtime that predates a check would otherwise pass silently.
      printf '%s-absent\n' "$check_name"
    fi
  done
}

# A protected route must never serve content to an anonymous request. Only a
# redirect to authentication or an explicit denial is acceptable; 200 means the
# page rendered for someone who never signed in.
nathee_anonymous_gate_verdict() {
  local status="$1"
  case "$status" in
    301|302|303|307|308) printf 'redirected\n' ;;
    401|403) printf 'denied\n' ;;
    404) printf 'hidden\n' ;;
    200) printf 'LEAKED\n' ;;
    *) printf 'unexpected-%s\n' "$status" ;;
  esac
}

nathee_anonymous_gate_ok() {
  case "$(nathee_anonymous_gate_verdict "$1")" in
    redirected|denied|hidden) return 0 ;;
    *) return 1 ;;
  esac
}
