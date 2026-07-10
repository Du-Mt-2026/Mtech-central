#!/bin/bash
# Backup do banco OctupusZap (container local octupuszap-db na KVM8)
# Roda diariamente 02:00 UTC, retenção 7 dias

BACKUP_DIR="/opt/backups/postgres"
DATE=$(date +%Y-%m-%d)
BACKUP_FILE="$BACKUP_DIR/octupuszap_$DATE.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Iniciando backup OctupusZap..." >> /var/log/postgres-backup.log

# pg_dump do container LOCAL octupuszap-db (user: octupuszap, db: octupuszap)
docker exec octupuszap-db pg_dump -U octupuszap -d octupuszap 2>/dev/null | gzip > "$BACKUP_FILE"

if [ $? -eq 0 ] && [ -s "$BACKUP_FILE" ]; then
  SIZE=$(ls -lh "$BACKUP_FILE" | awk '{print $5}')
  echo "[$(date)] ✅ Backup OK — $SIZE: $BACKUP_FILE" >> /var/log/postgres-backup.log
else
  echo "[$(date)] ❌ Backup FALHOU: $BACKUP_FILE" >> /var/log/postgres-backup.log
  exit 1
fi

# Remover backups com mais de 7 dias
find "$BACKUP_DIR" -name "octupuszap_*.sql.gz" -mtime +7 -delete
echo "[$(date)] Limpeza: removidos backups com >7 dias" >> /var/log/postgres-backup.log
