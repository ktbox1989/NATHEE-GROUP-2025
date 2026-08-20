#!/usr/bin/env bash
set -Eeuo pipefail

EXPECTED_USER="zptqqwps"
PRODUCTION_ROOT="/home/zptqqwps/public_html/natheegroup2025.com"
BACKUP_ROOT="/home/zptqqwps/backups/nathee"
BACKUP_DIR="${1:-}"

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

[[ -d "$BACKUP_DIR/snapshot" ]] || fail "backup snapshot does not exist"
[[ -f "$BACKUP_DIR/SHA256SUMS.txt" ]] || fail "backup checksum manifest does not exist"
[[ -d "$PRODUCTION_ROOT" ]] || fail "production root does not exist"

(
  cd -- "$BACKUP_DIR/snapshot"
  sha256sum --check --strict ../SHA256SUMS.txt
)

rsync -a --delete -- "$BACKUP_DIR/snapshot/" "$PRODUCTION_ROOT/"

(
  cd -- "$PRODUCTION_ROOT"
  sha256sum --check --strict "$BACKUP_DIR/SHA256SUMS.txt"
)

curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  https://natheegroup2025.com/ --output /dev/null

printf 'ROLLBACK_PASS backup=%s\n' "$BACKUP_DIR"
