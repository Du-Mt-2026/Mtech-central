#!/bin/bash
# ============================================
# OctupusZap - Deploy na VPS
# ============================================
# Script para fazer deploy do OctupusZap na VPS.
# Completamente isolado dos outros serviços.
#
# Uso: ./deploy.sh [subdominio] [senha-db]
# Ex:  ./deploy.sh octupuszap.nikki.com.br minhasenha123

set -e

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo "🚀 OctupusZap - Deploy na VPS"
echo "================================"
echo ""

# === Configurações ===
APP_DOMAIN=${1:-""}
DB_PASSWORD=${2:-"octupuszap$(openssl rand -hex 4)"}
AUTH_SECRET=$(openssl rand -base64 32)
CRON_SECRET=$(openssl rand -hex 16)

# === Descobrir rede Traefik ===
# Primeiro tenta pelo nome "traefik", depois pela rede do container traefik
TRAEFIK_NETWORK=$(docker network ls --filter name=traefik --format '{{.Name}}' | head -1)

if [ -z "$TRAEFIK_NETWORK" ]; then
    # Tenta descobrir pela rede do container traefik
    TRAEFIK_CONTAINER=$(docker ps --filter name=traefik --format '{{.Names}}' | head -1)
    if [ -n "$TRAEFIK_CONTAINER" ]; then
        TRAEFIK_NETWORK=$(docker inspect $TRAEFIK_CONTAINER --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' | awk '{print $1}' | head -1)
    fi
fi

if [ -z "$TRAEFIK_NETWORK" ]; then
    echo -e "${RED}❌ Rede Traefik não encontrada!${NC}"
    echo "   Verifique se o Traefik está rodando: docker ps | grep traefik"
    echo "   E liste as redes: docker network ls"
    exit 1
fi

echo -e "${GREEN}✓${NC} Rede Traefik encontrada: $TRAEFIK_NETWORK"

# === Verificar se evolution-go está na rede Traefik ===
EVO_IN_TRAEFIK=$(docker network inspect $TRAEFIK_NETWORK --format '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null | grep -o 'evolution-go' || echo "")
if [ -z "$EVO_IN_TRAEFIK" ]; then
    echo ""
    echo -e "${YELLOW}⚠ O container evolution-go NÃO está na rede Traefik!${NC}"
    echo "  O OctupusZap precisa acessar o Evolution Go via rede Docker."
    echo ""
    echo "  Para conectar o evolution-go à rede Traefik, execute:"
    echo -e "  ${CYAN}docker network connect $TRAEFIK_NETWORK evolution-go${NC}"
    echo ""
    read -p "  Deseja conectar agora? (s/n): " CONNECT_EVO
    if [ "$CONNECT_EVO" = "s" ] || [ "$CONNECT_EVO" = "S" ]; then
        docker network connect $TRAEFIK_NETWORK evolution-go 2>/dev/null && \
          echo -e "${GREEN}✓${NC} evolution-go conectado à rede $TRAEFIK_NETWORK" || \
          echo -e "${YELLOW}⚠ Não foi possível conectar (talvez já esteja conectado)${NC}"
    fi
fi

# === Perguntar domínio se não fornecido ===
if [ -z "$APP_DOMAIN" ]; then
    echo ""
    echo -e "${YELLOW}Qual subdomínio deseja usar?${NC} (ex: octupuszap.nikki.com.br)"
    echo "  → O DNS deve apontar para o IP desta VPS (ou usar Cloudflare Tunnel)"
    read -p "  Subdomínio: " APP_DOMAIN
fi

if [ -z "$APP_DOMAIN" ]; then
    echo -e "${RED}❌ Subdomínio é obrigatório!${NC}"
    exit 1
fi

echo ""
echo "Configuração:"
echo "  Domínio:      $APP_DOMAIN"
echo "  Rede Traefik: $TRAEFIK_NETWORK"
echo "  Senha DB:     $DB_PASSWORD"
echo ""

# === Descobrir Evolution API Key ===
EVO_KEY=""
# Try to read from existing Evolution Go container env
EVO_CONTAINER=$(docker ps --filter name=evolution-go --format '{{.Names}}' | head -1)
if [ -n "$EVO_CONTAINER" ]; then
    echo -e "${GREEN}✓${NC} Evolution Go encontrado: $EVO_CONTAINER"
    EVO_KEY=$(docker exec $EVO_CONTAINER printenv GLOBAL_API_KEY 2>/dev/null || docker exec $EVO_CONTAINER printenv AUTHENTICATION_API_KEY 2>/dev/null || echo "")
    if [ -n "$EVO_KEY" ]; then
        echo -e "${GREEN}✓${NC} API Key do Evolution Go obtida automaticamente"
    fi
fi

if [ -z "$EVO_KEY" ]; then
    echo -e "${YELLOW}⚠ Não foi possível obter a API Key do Evolution Go automaticamente.${NC}"
    read -p "  Cole a API Key do Evolution Go: " EVO_KEY
fi

# === Verificar se já existe .env (redeploy) ===
EXISTING_ENV=""
if [ -f .env ]; then
    echo ""
    echo -e "${CYAN}📁 Arquivo .env já existe.${NC}"
    read -p "  Deseja usar as configurações existentes? (s/n): " USE_EXISTING
    if [ "$USE_EXISTING" = "s" ] || [ "$USE_EXISTING" = "S" ]; then
        EXISTING_ENV="yes"
    fi
fi

# === Criar .env ===
if [ "$EXISTING_ENV" != "yes" ]; then
    cat > .env << EOF
# ============================================
# OctupusZap - Configuração de Produção
# Auto-gerado pelo deploy.sh em $(date)
# ============================================

# === Domínio ===
APP_DOMAIN=$APP_DOMAIN
APP_PUBLIC_URL=https://$APP_DOMAIN

# === Banco de Dados ===
DB_PASSWORD=$DB_PASSWORD

# === Evolution API Go ===
EVOLUTION_API_URL=http://evolution-go:8080
EVOLUTION_API_KEY=$EVO_KEY

# === Autenticação ===
AUTH_SECRET=$AUTH_SECRET

# === Cron Secret (para autenticar chamadas dos cron containers) ===
CRON_SECRET=$CRON_SECRET

# === Traefik ===
TRAEFIK_NETWORK=$TRAEFIK_NETWORK

# === Admin Padrão (usado no primeiro login) ===
ADMIN_EMAIL=admin@mtech.com
ADMIN_PASSWORD=admin123
ADMIN_NAME=Master
EOF

    echo -e "${GREEN}✓${NC} Arquivo .env criado"
fi

# === Build e deploy ===
echo ""
echo "📦 Buildando imagem Docker..."
docker compose build --no-cache

echo ""
echo "🚀 Iniciando containers..."
docker compose up -d

# === Aguardar migrations ===
echo ""
echo "⏳ Aguardando migrations..."
for i in $(seq 1 60); do
    MIGRATE_STATUS=$(docker compose ps migrate --format json 2>/dev/null | grep -o '"Status":"[^"]*"' | head -1 || echo "")
    if echo "$MIGRATE_STATUS" | grep -q "exited"; then
        MIGRATE_EXIT=$(docker inspect octupuszap-migrate --format='{{.State.ExitCode}}' 2>/dev/null || echo "1")
        if [ "$MIGRATE_EXIT" = "0" ]; then
            echo -e "${GREEN}✓${NC} Migrations concluídas com sucesso!"
            break
        else
            echo -e "${YELLOW}⚠ Migrations falharam (exit code: $MIGRATE_EXIT)${NC}"
            echo "  Tente rodar manualmente: docker compose run migrate"
            break
        fi
    fi
    sleep 2
done

# === Aguardar app ===
echo ""
echo "⏳ Aguardando app ficar disponível..."
for i in $(seq 1 60); do
    if curl -sf http://localhost:3000/api/auth/session > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} App está respondendo!"
        break
    fi
    sleep 2
done

# === Rodar setup de schema (para garantir colunas novas) ===
echo ""
echo "📋 Verificando schema do banco..."
curl -sf -X POST http://localhost:3000/api/setup/sync-schema \
  -H "Content-Type: application/json" \
  -d "{\"secret\":\"$(grep AUTH_SECRET .env | cut -d= -f2-)\"}" 2>/dev/null || {
    echo -e "${YELLOW}⚠ Setup automático de schema falhou (não é crítico).${NC}"
  }

# === Seed admin users ===
echo ""
echo "👤 Criando usuários admin..."
AUTH_SECRET_VAL=$(grep AUTH_SECRET .env | cut -d= -f2-)
curl -sf -X POST "http://localhost:3000/api/auth/seed-users" \
  -H "Content-Type: application/json" \
  -d "{\"secret\":\"$AUTH_SECRET_VAL\"}" 2>/dev/null || {
    echo -e "${YELLOW}⚠ Seed automático falhou. Rode manualmente:${NC}"
    echo "  curl -X POST http://localhost:3000/api/auth/seed-users -H 'Content-Type: application/json' -d '{\"secret\":\"$AUTH_SECRET_VAL\"}'"
  }

# === Verificar status de todos os containers ===
echo ""
echo "📊 Status dos containers:"
docker compose ps

echo ""
echo "================================"
echo -e "${GREEN}✅ Deploy concluído!${NC}"
echo ""
echo "  🌐 URL: https://$APP_DOMAIN"
echo "  📧 Login: admin@mtech.com"
echo "  🔑 Senha: admin123 (mude no primeiro acesso!)"
echo ""
echo "Containers rodando:"
echo "  octupuszap-app       → Aplicação Next.js"
echo "  octupuszap-db        → PostgreSQL"
echo "  octupuszap-campaigns → Cron de campanhas (a cada 1 min)"
echo "  octupuszap-health    → Health check (a cada 5 min)"
echo ""
echo "Comandos úteis:"
echo "  Logs app:       docker compose logs -f app"
echo "  Logs campanhas:  docker compose logs -f campaign-cron"
echo "  Logs health:    docker compose logs -f health-cron"
echo "  Parar:          docker compose down"
echo "  Reiniciar app:  docker compose restart app"
echo "  Rebuild:        docker compose up -d --build"
echo "  Rodar migration: docker compose run migrate"
echo "  Status:         docker compose ps"
echo ""
