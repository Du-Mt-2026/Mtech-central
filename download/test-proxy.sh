#!/bin/bash
# ============================================
# OctupusZap - Teste Completo de Proxy SOCKS5
# ============================================
# Rode este script no KVM8 como root.
# Ele verifica CADA etapa antes de aplicar proxy em produção.
#
# Uso: bash test-proxy.sh

set -e

echo "================================================"
echo "  TESTE COMPLETO DE PROXY SOCKS5 - OctupusZap"
echo "================================================"
echo ""

# ---- CONFIG ----
ARTUR_IP="10.0.0.100"
LOJINHA_IP="10.0.0.104"
SOCKS_PORT="8084"
EVOLUTION_CONTAINER="evolution-go"

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✅ PASSOU${NC} - $1"; }
fail() { echo -e "${RED}❌ FALHOU${NC} - $1"; }
warn() { echo -e "${YELLOW}⚠️  AVISO${NC} - $1"; }
info() { echo -e "   $1"; }

FAILED=0

# ============================================
# TESTE 1: WireGuard está rodando no KVM8?
# ============================================
echo ""
echo "── TESTE 1: WireGuard ──"

if wg show wg0 > /dev/null 2>&1; then
    pass "WireGuard wg0 está ativo"
    info "Peers conectados:"
    wg show wg0 | grep -A3 "^peer:" | grep "latest handshake" || info "  (nenhum peer com handshake recente)"
else
    fail "WireGuard wg0 NÃO está rodando"
    FAILED=1
fi

# ============================================
# TESTE 2: Ping nos chips via WireGuard
# ============================================
echo ""
echo "── TESTE 2: Ping nos chips ──"

for CHIP_NAME in "Artur" "Lojinha"; do
    if [ "$CHIP_NAME" = "Artur" ]; then CHIP_IP=$ARTUR_IP; else CHIP_IP=$LOJINHA_IP; fi
    
    if ping -c 2 -W 3 $CHIP_IP > /dev/null 2>&1; then
        pass "$CHIP_NAME ($CHIP_IP) responde ao ping"
    else
        fail "$CHIP_NAME ($CHIP_IP) NÃO responde ao ping"
        info "Verifique se o celular está com WireGuard conectado"
        FAILED=1
    fi
done

# ============================================
# TESTE 3: Porta SOCKS5 acessível do host KVM8
# ============================================
echo ""
echo "── TESTE 3: Porta SOCKS5 do host ──"

for CHIP_NAME in "Artur" "Lojinha"; do
    if [ "$CHIP_NAME" = "Artur" ]; then CHIP_IP=$ARTUR_IP; else CHIP_IP=$LOJINHA_IP; fi
    
    if timeout 3 bash -c "echo > /dev/tcp/$CHIP_IP/$SOCKS_PORT" 2>/dev/null; then
        pass "$CHIP_NAME ($CHIP_IP:$SOCKS_PORT) porta SOCKS5 aberta"
    else
        fail "$CHIP_NAME ($CHIP_IP:$SOCKS_PORT) porta SOCKS5 NÃO acessível"
        info "Verifique se Every Proxy está rodando no celular"
        FAILED=1
    fi
done

# ============================================
# TESTE 4: SOCKS5 proxy funciona do host (HTTPS)
# ============================================
echo ""
echo "── TESTE 4: SOCKS5 proxy do host (HTTPS test) ──"

for CHIP_NAME in "Artur" "Lojinha"; do
    if [ "$CHIP_NAME" = "Artur" ]; then CHIP_IP=$ARTUR_IP; else CHIP_IP=$LOJINHA_IP; fi
    
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --socks5-hostname $CHIP_IP:$SOCKS_PORT --connect-timeout 10 https://web.whatsapp.com 2>/dev/null || echo "000")
    
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "301" ] || [ "$HTTP_CODE" = "302" ]; then
        pass "$CHIP_NAME proxy SOCKS5 funciona (HTTP $HTTP_CODE de web.whatsapp.com)"
    else
        fail "$CHIP_NAME proxy SOCKS5 NÃO funciona (HTTP $HTTP_CODE de web.whatsapp.com)"
        info "O proxy está rodando mas não consegue acessar a internet"
        FAILED=1
    fi
done

# ============================================
# TESTE 5: iptables NAT/FORWARD para Docker
# ============================================
echo ""
echo "── TESTE 5: iptables para Docker → WireGuard ──"

NAT_RULE=$(iptables -t nat -L POSTROUTING -n 2>/dev/null | grep "172.18.0.0/16.*10.0.0.0/24.*MASQUERADE" || true)
if [ -n "$NAT_RULE" ]; then
    pass "Regra NAT MASQUERADE (172.18 → 10.0.0) existe"
else
    fail "Regra NAT MASQUERADE (172.18 → 10.0.0) NÃO existe"
    info "Execute: iptables -t nat -A POSTROUTING -s 172.18.0.0/16 -d 10.0.0.0/24 -j MASQUERADE"
    FAILED=1
fi

FWD_RULE=$(iptables -L FORWARD -n 2>/dev/null | grep "172.18.0.0/16.*10.0.0.0/24.*ACCEPT" || true)
if [ -n "$FWD_RULE" ]; then
    pass "Regra FORWARD (172.18 → 10.0.0) existe"
else
    fail "Regra FORWARD (172.18 → 10.0.0) NÃO existe"
    info "Execute: iptables -A FORWARD -s 172.18.0.0/16 -d 10.0.0.0/24 -j ACCEPT"
    FAILED=1
fi

# ============================================
# TESTE 6: Container Evolution Go consegue acessar WireGuard
# ============================================
echo ""
echo "── TESTE 6: Container Evolution Go → WireGuard ──"

if docker ps --format '{{.Names}}' | grep -q "$EVOLUTION_CONTAINER"; then
    pass "Container $EVOLUTION_CONTAINER está rodando"
    
    # Teste de conectividade TCP
    for CHIP_NAME in "Artur" "Lojinha"; do
        if [ "$CHIP_NAME" = "Artur" ]; then CHIP_IP=$ARTUR_IP; else CHIP_IP=$LOJINHA_IP; fi
        
        NC_RESULT=$(docker exec $EVOLUTION_CONTAINER sh -c "timeout 3 nc -z $CHIP_IP $SOCKS_PORT && echo OK || echo FAIL" 2>/dev/null || echo "FAIL")
        if echo "$NC_RESULT" | grep -q "OK"; then
            pass "Container pode alcançar $CHIP_NAME ($CHIP_IP:$SOCKS_PORT)"
        else
            # Tentar com wget ou curl do container
            CURL_RESULT=$(docker exec $EVOLUTION_CONTAINER sh -c "curl -s -o /dev/null -w '%{http_code}' --socks5-hostname $CHIP_IP:$SOCKS_PORT --connect-timeout 10 https://web.whatsapp.com 2>/dev/null || echo 000" 2>/dev/null || echo "000")
            if [ "$CURL_RESULT" = "200" ] || [ "$CURL_RESULT" = "301" ] || [ "$CURL_RESULT" = "302" ]; then
                pass "Container pode usar proxy $CHIP_NAME (HTTP $CURL_RESULT)"
            else
                fail "Container NÃO consegue usar proxy $CHIP_NAME (nc=$NC_RESULT, curl=$CURL_RESULT)"
                info "Verifique as regras iptables e o routing do Docker"
                FAILED=1
            fi
        fi
    done
else
    fail "Container $EVOLUTION_CONTAINER NÃO está rodando"
    FAILED=1
fi

# ============================================
# TESTE 7: Evolution Go API responde
# ============================================
echo ""
echo "── TESTE 7: Evolution Go API ──"

# Descobrir API key
API_KEY=$(docker exec $EVOLUTION_CONTAINER sh -c 'echo $AUTHENTICATION_API_KEY' 2>/dev/null || \
          docker exec $EVOLUTION_CONTAINER sh -c 'echo $API_KEY' 2>/dev/null || \
          docker exec $EVOLUTION_CONTAINER sh -c 'env | grep -i key | head -1 | cut -d= -f2' 2>/dev/null || echo "")

if [ -z "$API_KEY" ]; then
    # Tentar via docker inspect
    API_KEY=$(docker inspect $EVOLUTION_CONTAINER --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep -i "API_KEY\|AUTHENTICATION" | head -1 | cut -d= -f2 || echo "")
fi

if [ -n "$API_KEY" ]; then
    info "API Key encontrada: ${API_KEY:0:8}..."
    
    # Listar instâncias
    INSTANCES=$(docker exec $EVOLUTION_CONTAINER sh -c "curl -s -H 'apikey: $API_KEY' http://localhost:8080/instance/all" 2>/dev/null || echo "[]")
    INSTANCE_COUNT=$(echo "$INSTANCES" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
    
    if [ "$INSTANCE_COUNT" -gt 0 ]; then
        pass "Evolution Go API responde ($INSTANCE_COUNT instâncias encontradas)"
        
        # Verificar status das instâncias
        echo "$INSTANCES" | python3 -c "
import sys, json
instances = json.load(sys.stdin)
for inst in instances:
    name = inst.get('name', '?')
    state = inst.get('connectionStatus', inst.get('status', '?'))
    proxy = inst.get('proxy', None)
    proxy_info = 'proxy: sim' if proxy else 'proxy: não'
    print(f'   {name}: {state} ({proxy_info})')
" 2>/dev/null || info "Não foi possível parsear instâncias"
    else
        warn "Evolution Go API responde mas não há instâncias"
    fi
else
    warn "Não consegui descobrir a API Key automaticamente"
    info "Teste manual: docker exec $EVOLUTION_CONTAINER curl -s -H 'apikey: SUA_KEY' http://localhost:8080/instance/all"
fi

# ============================================
# TESTE 8: iptables persistente (sobrevive reboot)?
# ============================================
echo ""
echo "── TESTE 8: iptables persistente? ──"

if dpkg -l iptables-persistent > /dev/null 2>&1; then
    pass "iptables-persistent instalado (regras sobrevivem reboot)"
else
    warn "iptables-persistent NÃO instalado — regras PERDEM no reboot"
    info "Execute: apt-get install -y iptables-persistent && netfilter-persistent save"
fi

# ============================================
# RESULTADO FINAL
# ============================================
echo ""
echo "================================================"
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}  TODOS OS TESTES PASSARAM!${NC}"
    echo ""
    echo "  O proxy está 100% funcional. Você pode aplicar"
    echo "  proxy nos chips com segurança. O fallback garante"
    echo "  que nenhum chip fica permanentemente desconectado."
else
    echo -e "${RED}  ALGUNS TESTES FALHARAM${NC}"
    echo ""
    echo "  Corrija os problemas acima antes de aplicar proxy"
    echo "  em chips de produção."
fi
echo "================================================"
