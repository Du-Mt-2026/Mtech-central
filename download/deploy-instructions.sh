# Deploy Instructions - KVM8
# =========================
# Data: 04/06/2026
# Mudanças: Chips paralelos, fix duplicados, reconexão melhorada

# ============================================
# 1. FAZER O DEPLOY DO OCTUPUSZAP
# ============================================
cd /home/z/octupuszap  # ou onde estiver o projeto

# Puxar as mudanças (se estiver em git) OU copiar os arquivos alterados
# Os arquivos alterados são:
#   src/app/api/campaigns/process/route.ts
#   src/app/api/whatsapp/webhook/route.ts
#   src/app/api/chips/route.ts
#   src/app/api/campaigns/process-all/route.ts

# Rebuild e deploy
docker compose up -d --build app

# Verificar se subiu corretamente
docker compose logs -f app --tail=50

# ============================================
# 2. ENCONTRAR O DOCKER-COMPOSE DO EVOLUTION-GO
# ============================================
# O docker update já foi feito (1g RAM), mas precisamos tornar persistente
find / -name "docker-compose*" -type f 2>/dev/null | xargs grep -l "evolution" 2>/dev/null

# Quando encontrar o arquivo, adicione/adapte:
#   deploy:
#     resources:
#       limits:
#         memory: 1G
#
# Ou se usar mem_limit direto:
#   mem_limit: 1g

# Depois de editar, reinicie:
# docker compose up -d evolution-go

# ============================================
# 3. HABILITAR WIREGUARD NO BOOT
# ============================================
systemctl enable wg-quick@wg0

# ============================================
# 4. VERIFICAR SE TUDO ESTÁ FUNCIONANDO
# ============================================
# Verificar containers
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Verificar se os chips estão conectados
# (via interface web do OctupusZap)

# Verificar logs de reconexão
docker logs octupuszap-app --tail=100 | grep -i "reconnect\|auto-link\|parallel"
