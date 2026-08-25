#!/usr/bin/env bash
set -Eeuo pipefail

# Exercises both states of the apex mapping against a disposable copy of the
# release .htaccess, using the real writer and the real Z.com verifier.
#
# Node-driven, so it runs locally and in CI and never on the web host - the
# split scripts/test-deploy-file-tools.sh enforces.
#
# The real public-site/.htaccess is never written by this script. Every case
# operates on a copy in a temporary directory.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
SOURCE_HTACCESS="$REPO_ROOT/public-site/.htaccess"

fail() {
  printf 'APEX_MAPPING_TEST_FAIL: %s\n' "$1" >&2
  exit 1
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
copy="$work/.htaccess"
cp "$SOURCE_HTACCESS" "$copy"
original_checksum="$(sha256sum "$SOURCE_HTACCESS" | cut -d ' ' -f 1)"

printf '%s\n' "APP_INTEGRATION_GATE_PASS" > "$work/app-evidence.txt"
printf '%s\n' "ZCOM_MOD_PROXY=AVAILABLE reason=apachectl -M lists proxy_module and proxy_http_module" > "$work/proxy-evidence.txt"
printf '%s\n' "nothing useful here" > "$work/empty-evidence.txt"

case_pass() { printf 'APEX_MAPPING_CASE %s\n' "$1"; }

# 1. The shipped release is INACTIVE and the verifier accepts it.
NATHEE_HTACCESS="$copy" bash "$SCRIPT_DIR/verify-public-apex-mapping-state.sh" >/dev/null \
  || fail "the shipped INACTIVE release was rejected"
case_pass "shipped-release-inactive"

# 2. Activation without evidence is refused. Proxying to a host that is not
#    serving replaces a working static site with errors.
if node "$SCRIPT_DIR/set-public-apex-mapping.mjs" --state active --file "$copy" >/dev/null 2>&1; then
  fail "activation without evidence was accepted"
fi
case_pass "activation-requires-evidence"

# 3. Activation with the application gate but no mod_proxy proof is refused: a
#    [P] rule without mod_proxy does not proxy, it fails.
if node "$SCRIPT_DIR/set-public-apex-mapping.mjs" --state active --file "$copy" \
  --evidence "$work/app-evidence.txt" --proxy-evidence "$work/empty-evidence.txt" >/dev/null 2>&1; then
  fail "activation without proven mod_proxy was accepted"
fi
case_pass "activation-requires-mod-proxy"

# 4. With both proofs it activates, and the verifier accepts ACTIVE.
node "$SCRIPT_DIR/set-public-apex-mapping.mjs" --state active --file "$copy" \
  --evidence "$work/app-evidence.txt" --proxy-evidence "$work/proxy-evidence.txt" >/dev/null \
  || fail "activation with full evidence failed"
NATHEE_EXPECT_APEX_MAPPING=ACTIVE NATHEE_HTACCESS="$copy" \
  bash "$SCRIPT_DIR/verify-public-apex-mapping-state.sh" \
  --evidence "$work/app-evidence.txt" --proxy-evidence "$work/proxy-evidence.txt" >/dev/null \
  || fail "an activated release was rejected by the verifier"
case_pass "activation-writes-a-valid-proxy"

# 5. The rules are proxies, carry the query string, and target the application.
grep -Eq '^[[:space:]]*RewriteRule \^assets/media/\(\.\*\)\$ https://app\.natheegroup2025\.com/assets/media/\$1 \[P,QSA,L\]' "$copy" \
  || fail "the media rule is not the expected proxy"
grep -Eq '^[[:space:]]*RewriteRule \^sitemap\\\.xml\$ https://app\.natheegroup2025\.com/sitemap\.xml \[P,QSA,L\]' "$copy" \
  || fail "the sitemap rule is not the expected proxy"
# Scoped to rules that target the application: the release already contains a
# legitimate www -> apex canonical 301 that has nothing to do with this mapping.
if grep -E 'RewriteRule[^[:cntrl:]]*app\.natheegroup2025\.com' "$copy" | grep -Eq 'R=30[12]'; then
  fail "the mapping hands off with a redirect; CORP: same-origin means the browser would block the image"
fi
case_pass "rules-are-proxies-with-query-preserved"

# 6. Nothing authenticated is proxied, at any point.
while IFS= read -r rule; do
  case "$rule" in
    *"/api"*|*"/app/"*|*"/auth"*|*"/login"*) fail "an authenticated path is proxied: $rule" ;;
  esac
done < <(grep -E '^[[:space:]]*RewriteRule[^[:cntrl:]]*\[P' "$copy" || true)
case_pass "no-authenticated-path-proxied"

# 7. An ACTIVE release is rejected when the deployment expects INACTIVE, so the
#    state cannot change by accident during a deploy.
if NATHEE_HTACCESS="$copy" bash "$SCRIPT_DIR/verify-public-apex-mapping-state.sh" >/dev/null 2>&1; then
  fail "an ACTIVE release passed a deployment expecting INACTIVE"
fi
case_pass "state-mismatch-is-rejected"

# 8. Rollback is one command and restores the shipped behaviour exactly.
node "$SCRIPT_DIR/set-public-apex-mapping.mjs" --state inactive --file "$copy" >/dev/null \
  || fail "deactivation failed"
NATHEE_HTACCESS="$copy" bash "$SCRIPT_DIR/verify-public-apex-mapping-state.sh" >/dev/null \
  || fail "the rolled-back release was rejected"
if grep -Eq '^[[:space:]]*RewriteRule[^[:cntrl:]]*\[P' "$copy"; then
  fail "a proxy rule survived rollback"
fi
diff -q "$copy" "$SOURCE_HTACCESS" >/dev/null || fail "rollback did not restore the shipped file byte for byte"
case_pass "rollback-restores-shipped-release"

# 9. The real release file was never touched.
[[ "$(sha256sum "$SOURCE_HTACCESS" | cut -d ' ' -f 1)" == "$original_checksum" ]] \
  || fail "the real public-site/.htaccess was modified"
case_pass "real-release-untouched"

printf 'APEX_MAPPING_TEST_PASS cases=9 proxy=verified redirect=refused rollback=byte-identical\n'
