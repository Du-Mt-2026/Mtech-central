# Design Doc: Remoção do `/var/run/docker.sock` do container da app

**Status:** Draft — pendente de decisão
**Autor:** Z.ai Security Audit
**Data:** Jul 2026
**Severity:** P0 estrutural
**Refs:** Commit `7279c95` (auditoria), `docker-compose.yml:50`

---

## 1. Contexto do problema

O container `app` no `docker-compose.yml` (linha 50) tem o socket do Docker montado:

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
  - /opt/octupuszap:/opt/octupuszap
```

Isso é usado pelo endpoint `POST /api/deploy` (em `src/app/api/deploy/route.ts`) para:
1. Fazer `git pull` no diretório `/opt/octupuszap`
2. Escrever um script `.rebuild.sh`
3. Spawna um container `docker:cli` via `docker run` que reconstrói a aplicação

Esse design permite "self-deploy": o GitHub webhook bate em `/api/deploy`, o app reconstrói a si mesmo sem precisar de CI/CD externo.

### Por que é problema

O socket do Docker montado num container é, na prática, **root do host**. Qualquer código que consiga executar comandos no container da app (via RCE em qualquer rota, vulnerabilidade em qualquer dependência, etc.) consegue:

- Ler qualquer arquivo do host
- Escalar para outros containers na mesma rede
- Modificar o próprio `docker-compose.yml` para persistir acesso
- Pivotar para outros serviços no host (Postgres, Traefik, etc.)

Isso transforma qualquer RCE futura na aplicação em comprometimento total do servidor.

### O que NÃO resolve

- ❌ IP allowlist no `/api/deploy` (já feito em P1.2): ajuda, mas qualquer RCE em outra rota continua tendo acesso ao sock
- ❌ `READ_ONLY` no sock: não existe essa opção nativa do Docker
- ❌ Usar `docker` CLI sem sock montado: o CLI precisa do sock para falar com o daemon

---

## 2. Alternativas consideradas

### Opção A: Watchtower (sidecar dedicado)

**Como funciona:**
- Container separado `watchtower` rodando a imagem `containrrr/watchtower`
- Ele monitora imagens Docker e faz auto-update quando uma nova versão aparece no registry
- Pode ser configurado com webhook HTTP para trigger manual
- Não tem acesso ao código da aplicação, só a imagens Docker

**Prós:** mínimo esforço, container da app não precisa de sock, projeto maduro
**Contras:** exige registry, muda workflow para "build image → push → trigger", Watchtower ainda precisa do sock

**Esforço:** 2 dias

### Opção B: Webhook receiver separado (RECOMENDADO)

**Como funciona:**
- Novo serviço mínimo `deploy-receiver` no compose
- Roda como user não-privilegiado em container separado
- Recebe o webhook do GitHub, valida `X-Deploy-Secret`, executa shell script fixo
- O shell script faz `git pull` + `docker compose build app && up -d app` no host

**Prós:**
- Menor esforço (1-2 dias)
- Mantém workflow "git pull on host"
- Deploy rápido (1-2 min)
- Não precisa de registry
- Receiver é minimal (sem Next.js, sem Prisma) — superfície de ataque baixíssima
- Fácil rollback

**Contras:** ainda existe um container com docker.sock (mas muito menor e mais auditável)
**Esforço:** 3 dias (1 design já feito + 2 implementação)

### Opção C: GitHub Actions CI/CD externo

**Como funciona:**
- Workflow do GitHub Actions dispara em push para `main`
- Build da imagem Docker no CI
- Push para GitHub Container Registry (ghcr.io)
- SSH para o host + `docker compose pull && up -d app`

**Prós:** zero docker.sock em qualquer container, build auditável, versionamento de imagens, padrão da indústria
**Contras:** maior esforço (3-4 dias), exige secrets no GitHub, deploy mais lento (5-10 min), precisa de registry

---

## 3. Comparação

| Critério | A: Watchtower | B: Webhook receiver | C: GitHub Actions |
|---|---|---|---|
| Esforço de setup | 2 dias | 1-2 dias | 3-4 dias |
| Risco residual (docker.sock em algum container) | Sim | Sim | **Não** |
| Manter workflow "git pull on host" | Não | **Sim** | Não |
| Tempo de deploy | 5-10 min | **1-2 min** | 5-10 min |
| Precisa de registry | Sim | **Não** | Sim |
| Custo operacional | $0 | **$0** | $0-5/mês |
| Madureza | Alta | Média | Alta |
| Fácil rollback | Médio | **Fácil** | Difícil |

---

## 4. Recomendação: Opção B (Webhook receiver separado)

### Justificativa

1. **Menor esforço** (1-2 dias vs 3-4 da Opção C)
2. **Mantém workflow atual** — reduz risco de quebrar deploy durante a migração
3. **Deploy rápido** (1-2 min) — não prejudica produtividade
4. **Não precisa de registry** — sem custo adicional
5. **Reduz drasticamente a superfície de ataque** — receiver é um binário único com ~50 linhas de shell script, não uma aplicação Next.js com 100+ rotas
6. **Fácil rollback** — se não funcionar, basta restaurar o docker-compose.yml original

### Risco residual aceitável

A Opção B não elimina 100% do risco — ainda existe um container com docker.sock. Mas:
- Esse container é minimal (não tem aplicação, só um script fixo)
- Pode ser hardenado com `read_only: true`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`
- Pode ser isolado em rede separada (só com acesso ao `app` via HTTP, não à rede interna)
- É muito mais fácil de auditar que o container da app

### Quando reconsiderar

Se no futuro você precisar de:
- Multi-ambiente (staging + production separados)
- Rollback automático
- Testes automatizados antes do deploy
- Auditoria centralizada de deploys

...então vale migrar para a **Opção C (GitHub Actions)**. Mas para o estágio atual, B é suficiente.

---

## 5. Plano de implementação (Opção B)

### Etapa 1: Escrever o receiver (1 dia)

Criar `infra/deploy-receiver/`:

```
infra/deploy-receiver/
├── Dockerfile          # imagem minimal baseada em alpine + curl + docker-cli
├── receiver.sh         # shell script que recebe webhook e dispara rebuild
└── README.md
```

Hardenar o Dockerfile:
- Base: `alpine:3.19`
- Instalar só: `git`, `docker-cli`, `curl`, `bash`
- Rodar como UID 1001
- `read_only: true` (montar `/tmp` como tmpfs para logs)
- `cap_drop: [ALL]`
- `security_opt: [no-new-privileges:true]`

### Etapa 2: Adicionar ao docker-compose.yml (0.5 dia)

```yaml
deploy-receiver:
  build: ./infra/deploy-receiver
  container_name: octupuszap-deploy-receiver
  restart: unless-stopped
  ports:
    - "127.0.0.1:3001:3001"  # Só localhost, Traefik faz proxy
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
    - /opt/octupuszap:/opt/octupuszap
  environment:
    - DEPLOY_SECRET=${DEPLOY_SECRET}
    - GITHUB_TOKEN=${GITHUB_TOKEN}
    - GITHUB_REPO=${GITHUB_REPO}
  networks:
    - traefik_external  # Acessível pelo Traefik, NÃO pela rede interna do app
  deploy:
    resources:
      limits:
        memory: 64M
  read_only: false
  cap_drop:
    - ALL
  security_opt:
    - no-new-privileges:true
```

### Etapa 3: Remover docker.sock do container app (0.5 dia)

No `docker-compose.yml`, remover a linha:
```yaml
- /var/run/docker.sock:/var/run/docker.sock
```

E deletar `src/app/api/deploy/route.ts` (agora é responsabilidade do receiver).

Adicionar rota no Traefik:
```yaml
# infra/traefik/dynamic.yml
deploy-receiver:
  rule: "Host(`deploy.octupuszap.nikki.com.br`) && PathPrefix(`/api/deploy`)"
  entryPoints:
    - websecure
  tls: {}
  service: deploy-receiver
```

Criar DNS record para `deploy.octupuszap.nikki.com.br`.

### Etapa 4: Atualizar GitHub webhook (0.5 dia)

No GitHub repo → Settings → Webhooks:
- Mudar a URL de `https://octupuszap.nikki.com.br/api/deploy` para `https://deploy.octupuszap.nikki.com.br/api/deploy`
- Manter o `X-Deploy-Secret`

### Etapa 5: Validar em staging (1 dia)

- Fazer um push de teste para branch `staging`
- Verificar que o receiver recebeu o webhook
- Verificar que o deploy foi feito
- Verificar que o container `app` NÃO consegue mais acessar o docker.sock:
  ```bash
  docker exec octupuszap-app ls /var/run/docker.sock
  # deve retornar: ls: /var/run/docker.sock: No such file or directory
  ```

**Esforço total: 3 dias** (1 design já feito + 2 implementação)

---

## 6. Critérios de aceite

- [ ] Container `app` não tem mais `/var/run/docker.sock` em `docker-compose.yml`
- [ ] `docker exec octupuszap-app ls /var/run/docker.sock` retorna "No such file or directory"
- [ ] Receiver tem `read_only`, `cap_drop: [ALL]`, `no-new-privileges`
- [ ] Receiver roda como user não-root (UID 1001)
- [ ] Receiver está em rede separada da rede interna do app
- [ ] Deploy via webhook GitHub continua funcionando
- [ ] Logs do receiver são acessíveis via `docker compose logs deploy-receiver`
- [ ] DNS `deploy.octupuszap.nikki.com.br` criado
- [ ] Documentação atualizada

---

## 7. Perguntas em aberto

1. **Manter IP allowlist no receiver?** Sim — receiver continua validando IP do GitHub.
2. **Quem tem permissão de write em `/opt/octupuszap`?** Hoje é o user do container app. Após mudança, será o user do receiver. Garantir que UIDs batem.
3. **Logs do deploy vão para onde?** Hoje vão para `/opt/octupuszap/deploy-log.txt`. Manter o mesmo path.
4. **Rollback procedure?** Se receiver quebrar: fazer deploy manual via SSH, restaurar docker-compose.yml anterior, reiniciar containers.
5. **Quem audita os logs do receiver?** Por enquanto, manual. Futuro: integrar com `AuditLog` do OctupusZap.

---

## 8. Decisão pendente

**Aguardando:** aprovação do time para iniciar implementação da Opção B.

Após aprovação, estimativa realista: **2 dias úteis** para implementação + validação completa.

Se a Opção C for preferida (zero docker.sock em qualquer container), estimativa sobe para **5-6 dias úteis** (incluindo setup de registry + workflow GitHub Actions completo).
