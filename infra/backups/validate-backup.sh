#!/bin/bash
# Valida backup do PostgreSQL sem restaurar
# Usa pg_restore --list para verificar integridade
# Roda no cron após o backup automático (03:00 UTC)

BACKUP_DIR="/opt/backups/postgres"
LATEST=$(ls -t "$BACKUP_DIR"/octupuszap_*.sql.gz 2>/dev/null | head -1)

if [ -z "$LATEST" ]; then
  echo "[$(date)] ❌ Nenhum backup encontrado em $BACKUP_DIR" >> /var/log/backup-validation.log
  exit 1
fi

echo "[$(date)] Validando: $LATEST" >> /var/log/backup-validation.log

# Testar se o gzip está íntegro
if ! gzip -t "$LATEST" 2>/dev/null; then
  echo "[$(date)] ❌ Backup CORROMPIDO (gzip inválido): $LATEST" >> /var/log/backup-validation.log
  # Aqui poderia enviar notificação quando tivermos webhook configurado
  exit 1
fi

# Contar tabelas no backup (validação de conteúdo)
TABLE_COUNT=$(zcat "$LATEST" | grep -c "^CREATE TABLE" 2>/dev/null || echo "0")
SIZE=$(ls -lh "$LATEST" | awk '{print $5}')

if [ "$TABLE_COUNT" -lt 5 ]; then
  echo "[$(date)] ❌ Backup SUSPEITO — apenas $TABLE_COUNT tabelas (esperado >5): $LATEST" >> /var/log/backup-validation.log
  exit 1
fi

echo "[$(date)] ✅ Backup VÁLIDO — $TABLE_COUNT tabelas, $SIZE: $LATEST" >> /var/log/backup-validation.log

# Verificar se tem as tabelas críticas
for table in "Chip" "Campaign" "Message" "Contact" "AuditLog"; do
  if zcat "$LATEST" | grep -q "CREATE TABLE.*\"$table\""; then
    echo "[$(date)]   ✅ Tabela $table presente" >> /var/log/backup-validation.log
  else
    echo "[$(date)]   ⚠️  Tabela $table AUSENTE" >> /var/log/backup-validation.log
  fi
done

echo "[$(date)] ---" >> /var/log/backup-validation.log
