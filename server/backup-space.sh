#!/usr/bin/env bash
# Check before save-off; reserve an uncompressed snapshot plus 1 GiB.
set -euo pipefail
required=$(du -sk "${SRC_DIR:-/data}" | awk '{print $1 + 1048576}')
available=$(df -Pk "${DEST_DIR:-/backups}" | awk 'NR==2 {print $4}')
if (( available < required )); then
  echo "ERROR: backup space insufficient: ${available} KiB available, ${required} KiB required" >&2
  exit 1
fi
