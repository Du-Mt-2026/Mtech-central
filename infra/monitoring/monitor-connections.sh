#!/bin/bash
# Monitor de conexões do Postgres — alerta se passar de 200
export PGPASSWORD="HOVoWCMi7Hnx029y3OUIcMpfe7ELlFbST4YcAZ8k"

while true; do
  COUNT=$(docker exec -e PGPASSWORD="$PGPASSWORD" octupuszap-db psql -h 10.0.0.1 -p 5432 -U postgres -t -c "SELECT count(*) FROM pg_stat_activity;" 2>/dev/null | tr -d ' \n')
  
  if [ -n "$COUNT" ] && [ "$COUNT" -gt 200 ]; then
    echo "[$(date)] 🚨 CRÍTICO: $COUNT conexões (limite 200)" >> /var/log/pg-monitor.log
    # Aqui poderia enviar notificação quando configurarmos webhook
  else
    echo "[$(date)] ✅ OK: $COUNT conexões" >> /var/log/pg-monitor.log
  fi
  
  sleep 300  # 5 minutos
done
