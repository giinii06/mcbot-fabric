#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-1}" == 0 ]] || { echo 'ERROR: backup failed' >&2; exit 1; }
latest=''
for archive in "${DEST_DIR:-/backups}"/*.tar.zst; do
  if [[ -f "$archive" && ( -z "$latest" || "$archive" -nt "$latest" ) ]]; then latest="$archive"; fi
done
[[ -n "$latest" ]] || { echo 'ERROR: backup archive missing' >&2; exit 1; }
tar --zstd -tf "$latest" >/dev/null
echo "Backup archive verified: $latest"
