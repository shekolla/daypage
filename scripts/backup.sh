#!/usr/bin/env bash
# Online backup of the SQLite DB inside the running container.
# Usage:   scripts/backup.sh [output-dir]
# Default output dir: ./backups
set -euo pipefail

SERVICE="${TRACKER_SERVICE:-tracker}"
OUTDIR="${1:-./backups}"
mkdir -p "$OUTDIR"

TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$OUTDIR/tracker-$TS.db"

# 1. trigger an online .backup inside the container (writes to /tmp tmpfs)
docker compose exec -T "$SERVICE" node scripts/backup.js /tmp/snapshot.db

# 2. stream it to the host (docker cp does not work with tmpfs mounts)
docker compose exec -T "$SERVICE" cat /tmp/snapshot.db > "$OUT"

# 3. remove the in-container copy
docker compose exec -T "$SERVICE" rm -f /tmp/snapshot.db

SIZE=$(wc -c < "$OUT")
echo "backup: $OUT ($SIZE bytes)"
