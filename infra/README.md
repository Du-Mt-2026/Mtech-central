# Infraestrutura OctupusZap

## evolution-go/
Configuração da Evolution Go API (WhatsApp).
- `evolution-go.env.example` — template (copiar para evolution-go.env com valores reais)
- Deploy: KVM8 em `/opt/duda-bot/evolution-go.env`

## pgbouncer/
Configuração do PgBouncer (connection pooler).
- `docker-compose.yml` — config do PgBouncer
- Deploy: KVM4-1 em `/opt/infra/docker-compose.yml`
- **CRÍTICO:** `POOL_MODE` deve ser `session` (não `transaction`) — Evolution Go usa prepared statements

## monitoring/
Scripts de monitoramento.
- `monitor-connections.sh` — monitora conexões do Postgres, alerta se > 200
  - Deploy: KVM8 em `/opt/octupuszap/monitor-connections.sh`
  - Roda em background: `nohup bash monitor-connections.sh > /dev/null 2>&1 &`

## Histórico de problemas resolvidos

### 2026-07-10: Postgres "too many clients"
- **Causa:** Evolution Go vazava conexões, saturava max_connections (500)
- **Fix 1:** PgBouncer na frente (porta 6432) — pool de conexões
- **Fix 2:** pool_mode=session (transaction quebra prepared statements)
- **Fix 3:** QRCODE_MAX_COUNT=999 (evita forced logout que destrói sessões)

### 2026-07-10: Chips caindo em cascata
- **Causa:** Postgres saturava → Evolution Go perdia acesso → chips desconectavam
- **Fix:** PgBouncer + monitor de conexões + restart do Postgres quando necessário
