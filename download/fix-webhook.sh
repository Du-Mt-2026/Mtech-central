#!/bin/bash
# ============================================
# OctupusZap - Webhook Repair Script
# ============================================
# Diagnostica e repara a configuração de webhook
# para todas as instâncias do Evolution Go.
#
# Uso: ./fix-webhook.sh
# ============================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo "🔧 OctupusZap - Webhook Repair"
echo "================================"
echo ""

# === 1. Verificar NEXT_PUBLIC_APP_URL ===
echo -e "${CYAN}[1/5] Verificando NEXT_PUBLIC_APP_URL...${NC}"
APP_URL=$(docker exec app printenv NEXT_PUBLIC_APP_URL 2>/dev/null || echo "")

if [ -z "$APP_URL" ]; then
    echo -e "${RED}❌ NEXT_PUBLIC_APP_URL não está configurado!${NC}"
    echo ""
    echo "  Isso é obrigatório para o webhook funcionar."
    echo "  O Evolution Go precisa de uma URL pública para enviar eventos."
    echo ""
    echo "  Para configurar, adicione no .env do docker-compose:"
    echo -e "  ${CYAN}NEXT_PUBLIC_APP_URL=https://seu-dominio.com${NC}"
    echo ""
    echo "  Depois: docker compose up -d --build app"
    exit 1
fi

echo -e "${GREEN}✓${NC} NEXT_PUBLIC_APP_URL = $APP_URL"

# === 2. Verificar se o app está acessível ===
echo ""
echo -e "${CYAN}[2/5] Verificando se o app está acessível internamente...${NC}"

# Testar de dentro do container app
APP_STATUS=$(docker exec app wget -qO- --timeout=5 http://localhost:3000/api/auth/session 2>/dev/null | head -c 100 || echo "FAILED")

if [ "$APP_STATUS" = "FAILED" ]; then
    echo -e "${RED}❌ App não está respondendo em localhost:3000!${NC}"
    echo "  Verifique: docker compose logs app --tail=50"
    exit 1
fi

echo -e "${GREEN}✓${NC} App está respondendo internamente"

# === 3. Verificar se o Evolution Go consegue acessar o webhook ===
echo ""
echo -e "${CYAN}[3/5] Verificando se o Evolution Go consegue acessar o webhook URL...${NC}"

WEBHOOK_URL="${APP_URL}/api/whatsapp/webhook"
echo "  Webhook URL: $WEBHOOK_URL"

# Testar a partir do container evolution-go
# (O Evolution Go precisa conseguir POSTar para essa URL)
EVO_CONTAINER=$(docker ps --filter name=evolution-go --format '{{.Names}}' | head -1)

if [ -n "$EVO_CONTAINER" ]; then
    # Tenta wget/curl de dentro do container evolution-go
    EVO_TEST=$(docker exec $EVO_CONTAINER sh -c "wget -qO- --timeout=10 --post-data='{\"event\":\"test\"}' --header='Content-Type: application/json' '$WEBHOOK_URL' 2>/dev/null || echo 'FAILED'")

    if echo "$EVO_TEST" | grep -q "ok"; then
        echo -e "${GREEN}✓${NC} Evolution Go consegue acessar o webhook URL!"
    else
        echo -e "${YELLOW}⚠${NC} Evolution Go NÃO consegue acessar $WEBHOOK_URL"
        echo ""
        echo "  Isso pode acontecer se:"
        echo "    - O domínio não resolve dentro do Docker"
        echo "    - O Traefik não está configurado para rotear o domínio"
        echo "    - Firewall bloqueando a conexão"
        echo ""

        # Verificar se o Traefik pode resolver
        TRAEFIK_CONTAINER=$(docker ps --filter name=traefik --format '{{.Names}}' | head -1)
        if [ -n "$TRAEFIK_CONTAINER" ]; then
            echo "  Tentando via rede interna do Traefik..."
            # Tenta acessar via nome do serviço Docker
            INTERNAL_TEST=$(docker exec $EVO_CONTAINER sh -c "wget -qO- --timeout=5 http://octupuszap-app:3000/api/whatsapp/webhook --post-data='{\"event\":\"test\"}' --header='Content-Type: application/json' 2>/dev/null || echo 'FAILED'" 2>/dev/null || echo "FAILED")

            if echo "$INTERNAL_TEST" | grep -q "ok"; then
                echo -e "${GREEN}✓${NC} Acesso interno funciona (octupuszap-app:3000)!"
                echo ""
                echo "  ⚠ Mas o Evolution Go precisa acessar via URL pública."
                echo "  Verifique se o Traefik tem uma rota para o domínio $APP_URL"
            else
                echo -e "${RED}❌ Acesso interno também falhou${NC}"
            fi
        fi

        echo ""
        echo "  SOLUÇÃO: Certifique-se que o domínio $APP_URL aponta para"
        echo "  esta VPS e o Traefik tem o router configurado."
    fi
else
    echo -e "${YELLOW}⚠${NC} Container evolution-go não encontrado"
fi

# === 4. Listar instâncias e seus webhooks atuais ===
echo ""
echo -e "${CYAN}[4/5] Listando instâncias e webhooks atuais...${NC}"

EVO_URL=$(docker exec app printenv EVOLUTION_API_URL 2>/dev/null || echo "")
EVO_KEY=$(docker exec app printenv EVOLUTION_API_KEY 2>/dev/null || echo "")

# Se não está no env, tenta pegar do banco
if [ -z "$EVO_URL" ]; then
    EVO_URL=$(docker exec octupuszap-db psql -U octupuszap -d octupuszap -t -c "SELECT value FROM \"Settings\" WHERE key='evolution_api_url'" 2>/dev/null | xargs || echo "")
fi
if [ -z "$EVO_KEY" ]; then
    EVO_KEY=$(docker exec octupuszap-db psql -U octupuszap -d octupuszap -t -c "SELECT value FROM \"Settings\" WHERE key='evolution_api_key'" 2>/dev/null | xargs || echo "")
fi

if [ -z "$EVO_URL" ] || [ -z "$EVO_KEY" ]; then
    echo -e "${RED}❌ Não foi possível obter credenciais do Evolution API${NC}"
    echo "  EVOLUTION_API_URL=$EVO_URL"
    echo "  EVOLUTION_API_KEY=${EVO_KEY:0:10}..."
    exit 1
fi

echo -e "  ${GREEN}✓${NC} Evolution API URL: $EVO_URL"
echo -e "  ${GREEN}✓${NC} Evolution API Key: ${EVO_KEY:0:10}..."

# Buscar instâncias
INSTANCES=$(docker exec app wget -qO- --timeout=10 \
    --header="apikey: $EVO_KEY" \
    "${EVO_URL}/instance/fetchInstances" 2>/dev/null || echo "[]")

echo ""
echo "  Instâncias encontradas:"
echo "$INSTANCES" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if isinstance(data, list):
        for inst in data:
            name = inst.get('name', 'N/A')
            connected = inst.get('connected', False)
            webhook = inst.get('webhook', '') or 'NENHUM'
            status = '🟢 Conectado' if connected else '🔴 Desconectado'
            wh_status = '✓ Webhook OK' if webhook else '❌ Sem webhook'
            print(f'  {name}: {status} | Webhook: {webhook} ({wh_status})')
    else:
        print('  Erro ao parsear resposta')
except:
    print('  Erro ao parsear resposta')
" 2>/dev/null || echo "  (não foi possível listar)"

# === 5. Reconfigurar webhooks ===
echo ""
echo -e "${CYAN}[5/5] Reconfigurando webhooks...${NC}"
echo ""
echo "  Eventos que serão inscritos:"
echo "    MESSAGE, SEND_MESSAGE, SEND_MESSAGE_ACK, READ_RECEIPT,"
echo "    PRESENCE, CHAT_PRESENCE, CALL, CONNECTION, QRCODE,"
echo "    LABEL, CONTACT, GROUP, MESSAGES_UPDATE, INSTANCE_DELETED"
echo ""

# Buscar chips conectados no banco
CONNECTED_CHIPS=$(docker exec octupuszap-db psql -U octupuszap -d octupuszap -t -c \
    "SELECT name, \"evolutionInstance\", status FROM \"Chip\" WHERE \"evolutionInstance\" IS NOT NULL AND status != 'banned'" 2>/dev/null || echo "")

if [ -z "$CONNECTED_CHIPS" ]; then
    echo -e "${YELLOW}⚠ Nenhum chip com instância Evolution encontrado${NC}"
    exit 0
fi

FIXED=0
FAILED=0

while IFS='|' read -r chip_name evo_instance status; do
    chip_name=$(echo "$chip_name" | xargs)
    evo_instance=$(echo "$evo_instance" | xargs)
    status=$(echo "$status" | xargs)

    if [ -z "$evo_instance" ]; then
        continue
    fi

    echo -n "  Configurando webhook para $chip_name ($evo_instance)... "

    # Chamar a API de setup-webhook do próprio app
    RESULT=$(docker exec app wget -qO- --timeout=15 \
        --post-data="{\"chipId\":$(docker exec octupuszap-db psql -U octupuszap -d octupuszap -t -c "SELECT id FROM \"Chip\" WHERE \"evolutionInstance\"='$evo_instance'" 2>/dev/null | xargs | sed 's/^/"/;s/$/"/')}" \
        --header='Content-Type: application/json' \
        'http://localhost:3000/api/whatsapp/setup-webhook' 2>/dev/null || echo "FAILED")

    if echo "$RESULT" | grep -q "success"; then
        echo -e "${GREEN}✓${NC}"
        FIXED=$((FIXED + 1))
    else
        echo -e "${RED}✗${NC} ($RESULT)"
        FAILED=$((FAILED + 1))
    fi

done <<< "$CONNECTED_CHIPS"

echo ""
echo "================================"
echo -e "Resultado: ${GREEN}${FIXED} configurados${NC} | ${RED}${FAILED} falharam${NC}"
echo ""

# === Verificação final ===
echo -e "${CYAN}Verificação final — testando webhook com evento real...${NC}"
echo ""

# Pegar uma instância conectada para testar
TEST_INSTANCE=$(echo "$CONNECTED_CHIPS" | head -1 | awk -F'|' '{print $2}' | xargs)

if [ -n "$TEST_INSTANCE" ]; then
    echo "  Para testar manualmente, rode:"
    echo ""
    echo -e "  ${CYAN}# Verificar se o webhook está configurado na instância:${NC}"
    echo "  docker exec app wget -qO- --header='apikey: $EVO_KEY' '${EVO_URL}/instance/fetchInstances?instanceName=$TEST_INSTANCE' | python3 -m json.tool"
    echo ""
    echo -e "  ${CYAN}# Verificar se o webhook endpoint está acessível:${NC}"
    echo "  curl -s -X POST '$WEBHOOK_URL' -H 'Content-Type: application/json' -d '{\"event\":\"test\"}'"
    echo ""
    echo -e "  ${CYAN}# Monitorar logs do webhook:${NC}"
    echo "  docker compose logs -f app 2>&1 | grep -i webhook"
fi

echo ""
echo -e "${GREEN}✅ Script concluído!${NC}"
