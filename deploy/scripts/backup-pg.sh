#!/usr/bin/env bash
#
# PostgreSQL backup script for Prismix (production deployment).
#
# Uses pg_dump with custom format for efficient compression and selective restore.
#
# Usage:
#   ./backup-pg.sh                              # uses DATABASE_URL from env
#   DATABASE_URL=postgresql://... ./backup-pg.sh # explicit connection string
#   ./backup-pg.sh /mnt/backups                  # custom backup directory
#   RETAIN_DAYS=30 ./backup-pg.sh                # keep 30 days of backups
#
# Cron example (daily at 3 AM):
#   0 3 * * * /opt/prismix/deploy/scripts/backup-pg.sh /mnt/backups >> /var/log/prismix-backup.log 2>&1
#
# Restore:
#   pg_restore -d <database> <backup_file>.dump

set -euo pipefail

DATABASE_URL="${DATABASE_URL:?DATABASE_URL must be set}"
BACKUP_DIR="${1:-./backups}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/prismix_${TIMESTAMP}.dump"

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

echo "[$(date -Iseconds)] Starting PostgreSQL backup → $BACKUP_FILE"

# pg_dump with custom format (compressed, supports selective restore)
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$BACKUP_FILE"

# Verify backup is not empty
BACKUP_SIZE=$(stat -f%z "$BACKUP_FILE" 2>/dev/null || stat -c%s "$BACKUP_FILE" 2>/dev/null)
if [ "$BACKUP_SIZE" -lt 1024 ]; then
  echo "[ERROR] Backup file suspiciously small (${BACKUP_SIZE} bytes), aborting"
  rm -f "$BACKUP_FILE"
  exit 1
fi

echo "[$(date -Iseconds)] Backup complete: $BACKUP_FILE (${BACKUP_SIZE} bytes)"

# Rotate old backups
DELETED=$(find "$BACKUP_DIR" -name "prismix_*.dump" -mtime "+$RETAIN_DAYS" -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
  echo "[$(date -Iseconds)] Rotated $DELETED backup(s) older than $RETAIN_DAYS days"
fi
