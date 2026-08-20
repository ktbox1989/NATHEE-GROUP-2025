#!/usr/bin/env bash
set -Eeuo pipefail

EXPECTED_USER="zptqqwps"
PRODUCTION_ROOT="/home/zptqqwps/public_html/natheegroup2025.com"
BACKUP_ROOT="/home/zptqqwps/backups/nathee"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
BACKUP_DIR="${1:-}"

# shellcheck source=scripts/lib/deploy-file-tools.sh
source "$SCRIPT_DIR/lib/deploy-file-tools.sh"

fail() {
  printf 'ROLLBACK_FAIL: %s\n' "$1" >&2
  exit 1
}

[[ "$(id -un)" == "$EXPECTED_USER" ]] || fail "must run as $EXPECTED_USER"
[[ -n "$BACKUP_DIR" ]] || fail "usage: scripts/rollback-zcom.sh /home/zptqqwps/backups/nathee/<timestamp>"

case "$BACKUP_DIR" in
  "$BACKUP_ROOT"/*) ;;
  *) fail "backup path is outside the approved backup root" ;;
esac

for required_command in tar cp mv mkdir mktemp find sha256sum cut curl rm dirname; do
  command -v "$required_command" >/dev/null || fail "$required_command is required"
done

nathee_restore_backup "$BACKUP_DIR" "$PRODUCTION_ROOT" || fail "backup verification or restore failed"

curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  https://natheegroup2025.com/ --output /dev/null

printf 'ROLLBACK_PASS backup=%s\n' "$BACKUP_DIR"
