# Manual Deploy — OctupusZap

**Status:** Este é o mecanismo oficial de deploy. Não há auto-deploy via webhook.

## Por que manual?

O projeto passou por várias tentativas de auto-deploy que não funcionaram:

1. **`webhook` tool na porta 9000** (root no host) — estava configurado errado (validava `X-Deploy-Secret` header que o GitHub não enviava). Quebrado há mais de 1 mês quando foi descoberto.
2. **`/api/deploy` no app** — nunca foi usado pelo GitHub. Exigia `docker.sock` montado no container da app, o que dava RCE = root do host. Removido em P0.6.
3. **`deploy-receiver` isolado** — criado em P0.6, mas era redundante com o webhook tool na porta 9000. Removido.

Para um projeto em modo manutenção com commits raros, **deploy manual via SSH é mais simples e mais seguro** do que manter mecanismos de auto-deploy que ninguém usa.

## Procedimento padrão

Sempre que um commit for pushed para `main`:

```bash
# 1. SSH no servidor
ssh root@76.13.230.13

# 2. Ir para o diretório do projeto
cd /opt/octupuszap

# 3. Backup do .env atual (segurança)
cp .env .env.backup-$(date +%Y%m%d-%H%M%S)

# 4. Puxar novas mudanças
git pull origin main

# 5. Rebuild do app (apenas o serviço app, mantém db e cron rodando)
docker compose build app

# 6. Restart do app (e cron containers, para pegar novos env vars se houver)
docker compose up -d app campaign-cron health-cron

# 7. Verificar que subiu
docker compose ps
docker compose logs --tail=30 app

# 8. Validações básicas
curl -s -o /dev/null -w "App: HTTP %{http_code}\n" https://octupuszap.nikki.com.br/
curl -s -o /dev/null -w "Cron sem secret (401): HTTP %{http_code}\n" -X POST https://octupuszap.nikki.com.br/api/campaigns/process-all
```

Tempo total: ~2-3 minutos (incluindo build).

## Quando o build falha

Se `docker compose build app` falhar (ex: erro de TypeScript):

```bash
# Ver log completo do build
docker compose build app 2>&1 | tail -50

# Reverter para o commit anterior
git log --oneline -5                    # ver commits
git checkout <commit-anterior>          # voltar
docker compose build app
docker compose up -d app
```

## Quando deploy quebra produção

Se após o deploy a aplicação não responder ou ficar instável:

```bash
# 1. Ver logs em tempo real
docker compose logs -f app

# 2. Se precisar voltar para commit anterior
git log --oneline -10
git checkout <commit-estavel>
docker compose build app
docker compose up -d app

# 3. Se precisar restaurar .env
cp .env.backup-XXXX .env
docker compose up -d app
```

## Verificações pós-deploy

Para cada commit que mexe em segurança ou infra:

```bash
# 1. App responde
curl -s -o /dev/null -w "App: HTTP %{http_code}\n" https://octupuszap.nikki.com.br/
# Esperado: HTTP 200

# 2. Cron fail-closed (P0.3)
curl -s -o /dev/null -w "Cron sem secret (401): HTTP %{http_code}\n" -X POST https://octupuszap.nikki.com.br/api/campaigns/process-all
# Esperado: HTTP 401

# 3. Cron com secret funciona
CRON_SECRET=$(grep "^CRON_SECRET=" .env | cut -d= -f2)
curl -s -o /dev/null -w "Cron com secret (200): HTTP %{http_code}\n" -X POST https://octupuszap.nikki.com.br/api/campaigns/process-all -H "x-cron-secret: $CRON_SECRET"
# Esperado: HTTP 200

# 4. Webhook fail-closed (P1.1)
curl -s -o /dev/null -w "Webhook sem apikey (401): HTTP %{http_code}\n" -X POST https://octupuszap.nikki.com.br/api/whatsapp/webhook -H "Content-Type: application/json" -d '{"event":"test"}'
# Esperado: HTTP 401

# 5. App container NÃO tem docker.sock (P0.6)
docker exec octupuszap-app ls /var/run/docker.sock 2>&1
# Esperado: ls: /var/run/docker.sock: No such file or directory

# 6. Logs limpos (sem erros repetidos)
docker compose logs --tail=100 app | grep -iE "error|fail" | tail -10
```

## Desativar o webhook tool antigo (porta 9000)

O processo `webhook` rodando como root na porta 9000 está quebrado e não é mais necessário. Recomenda-se desativá-lo:

```bash
# 1. Verificar se ainda está rodando
ps aux | grep webhook | grep -v grep
# Output esperado: /usr/bin/webhook -hooks /opt/webhook/hooks.json -port 9000 -verbose

# 2. Matar o processo
kill $(pgrep -f "/usr/bin/webhook")

# 3. Desabilitar service systemd (se existir)
systemctl disable webhook 2>/dev/null
systemctl stop webhook 2>/dev/null

# 4. Confirmar que parou
ss -tlnp | grep :9000
# Esperado: nenhum output

# 5. (Opcional) Remover config files legados
rm /opt/webhook/hooks.json
rm /etc/webhook/hooks.json
rm /opt/octupuszap/deploy-hook.sh   # script vestígio
# Não remover /opt/octupuszap/deploy.sh — é o script de bootstrap inicial

# 6. (Opcional) Remover webhook tool do sistema
apt remove webhook -y
```

## Histórico (para referência)

- **Jun 2026**: webhook tool na porta 9000 foi configurado mas nunca funcionou corretamente
- **Jul 2026 (commits 7279c95..dedc830)**: patches de segurança aplicados via deploy manual
- **Jul 2026 (commit 18c7fd6)**: P0.6 implementado com deploy-receiver isolado
- **Jul 2026 (commit posterior)**: descoberto que webhook tool estava quebrado, deploy-receiver removido, deploy manual oficializado como mecanismo único

## Quando considerar auto-deploy no futuro

Se o projeto voltar a ter desenvolvimento ativo (múltiplos commits por semana), considere:

1. **GitHub Actions** (recomendado) — build fora do host, deploy via SSH ou registry pull. Mais seguro que webhook tool. Custo: ~$0-5/mês.
2. **Watchtower** — se migrar para uso de registry (Docker Hub ou ghcr.io). Auto-update de imagens em produção.

Ambas as opções estão documentadas em `docs/design-docker-sock-removal.md` (Opções A e C do design doc original).
