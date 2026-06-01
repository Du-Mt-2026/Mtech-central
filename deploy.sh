#!/bin/bash
# ============================================
# OctupusZap - Deploy na VPS
# ============================================
# Script para fazer deploy do OctupusZap na VPS.
# Completamente isolado dos outros serviços.
#
# Uso: ./deploy.sh [subdominio] [senha-db]
# Ex:  ./deploy.sh octupuszap.seudominio.com minhasenha123

set -e

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo "🚀 OctupusZap - Deploy na VPS"
echo "================================"
echo ""

# === Configurações ===
APP_DOMAIN=${1:-""}
DB_PASSWORD=${2:-"octupuszap$(openssl rand -hex 4)"}
AUTH_SECRET=$(openssl rand -base64 32)

# === Descobrir rede Traefik ===
TRAEFIK_NETWORK=$(docker network ls --filter name=traefik --format '{{.Name}}' | head -1)

if [ -z "$TRAEFIK_NETWORK" ]; then
    echo -e "${RED}❌ Rede Traefik não encontrada!${NC}"
    echo "   Verifique se o Traefik está rodando: docker ps | grep traefik"
    echo "   E liste as redes: docker network ls"
    exit 1
fi

echo -e "${GREEN}✓${NC} Rede Traefik encontrada: $TRAEFIK_NETWORK"

# === Perguntar domínio se não fornecido ===
if [ -z "$APP_DOMAIN" ]; then
    echo ""
    echo -e "${YELLOW}Qual subdomínio deseja usar?${NC} (ex: octupuszap.seudominio.com)"
    echo "  → O DNS deve apontar para o IP desta VPS"
    read -p "  Subdomínio: " APP_DOMAIN
fi

if [ -z "$APP_DOMAIN" ]; then
    echo -e "${RED}❌ Subdomínio é obrigatório!${NC}"
    exit 1
fi

echo ""
echo "Configuração:"
echo "  Domínio:     $APP_DOMAIN"
echo "  Rede Traefik: $TRAEFIK_NETWORK"
echo "  Senha DB:    $DB_PASSWORD"
echo ""

# === Descobrir Evolution API Key ===
EVO_KEY=""
# Try to read from existing Evolution Go container env
EVO_CONTAINER=$(docker ps --filter name=evolution-go --format '{{.Names}}' | head -1)
if [ -n "$EVO_CONTAINER" ]; then
    echo -e "${GREEN}✓${NC} Evolution Go encontrado: $EVO_CONTAINER"
    EVO_KEY=$(docker exec $EVO_CONTAINER printenv AUTHENTICATION_API_KEY 2>/dev/null || echo "")
    if [ -n "$EVO_KEY" ]; then
        echo -e "${GREEN}✓${NC} API Key do Evolution Go obtida automaticamente"
    fi
fi

if [ -z "$EVO_KEY" ]; then
    echo -e "${YELLOW}⚠ Não foi possível obter a API Key do Evolution Go automaticamente.${NC}"
    read -p "  Cole a API Key do Evolution Go: " EVO_KEY
fi

# === Criar .env ===
cat > .env << EOF
# Auto-gerado pelo deploy.sh em $(date)
APP_DOMAIN=$APP_DOMAIN
APP_PUBLIC_URL=https://$APP_DOMAIN
DB_PASSWORD=$DB_PASSWORD
EVOLUTION_API_KEY=$EVO_KEY
AUTH_SECRET=$AUTH_SECRET
TRAEFIK_NETWORK=$TRAEFIK_NETWORK
EOF

echo -e "${GREEN}✓${NC} Arquivo .env criado"

# === Criar rede interna se não existir ===
docker network create octupuszap-internal 2>/dev/null || true

# === Build e deploy ===
echo ""
echo "📦 Buildando imagem Docker..."
docker compose build --no-cache app

echo ""
echo "🚀 Iniciando containers..."
docker compose up -d

# === Aguardar banco ===
echo ""
echo "⏳ Aguardando banco de dados..."
sleep 5

# === Rodar migrations ===
echo ""
echo "📋 Rodando migrations do Prisma..."
docker compose exec app npx prisma migrate deploy 2>/dev/null || {
    echo -e "${YELLOW}⚠ Migrations podem precisar ser rodadas manualmente:${NC}"
    echo "  docker compose exec app npx prisma migrate deploy"
}

# === Seed admin user ===
echo ""
echo "👤 Criando usuário admin padrão..."
curl -s -X POST "http://localhost:3000/api/auth/seed-users" 2>/dev/null || true

echo ""
echo "================================"
echo -e "${GREEN}✅ Deploy concluído!${NC}"
echo ""
echo "  🌐 URL: https://$APP_DOMAIN"
echo "  📧 Login: admin@mtech.com"
echo "  🔑 Senha: admin123 (mude no primeiro acesso!)"
echo ""
echo "Comandos úteis:"
echo "  Logs:     docker compose logs -f app"
echo "  Parar:    docker compose down"
echo "  Reiniciar: docker compose restart app"
echo "  Rebuild:  docker compose up -d --build app"
echo ""
