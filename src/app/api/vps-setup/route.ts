import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/vps-setup
 * Generates VPS setup scripts for WireGuard proxy infrastructure.
 * Returns scripts for both the WireGuard Server VPS and the Evolution API VPS.
 */
export async function GET() {
  try {
    const chips = await db.chip.findMany({ orderBy: { createdAt: 'asc' } })
    const serverPrivKey = process.env.WIREGUARD_SERVER_PRIV_KEY || ''
    const serverPubKey = process.env.WIREGUARD_SERVER_PUB_KEY || ''
    const subnet = process.env.WIREGUARD_SUBNET || '10.0.0'
    const serverPort = process.env.WIREGUARD_SERVER_PORT || '51820'
    const serverEndpoint = process.env.WIREGUARD_SERVER_ENDPOINT || `187.77.48.22:${serverPort}`

    // ===== 1. WireGuard Server Config (for 187.77.48.22) =====
    let serverPeers = ''
    for (const chip of chips) {
      if (chip.wireguardPubKey && chip.wireguardIp) {
        serverPeers += `
# ${chip.name} (${chip.phoneNumber})
[Peer]
PublicKey = ${chip.wireguardPubKey}
AllowedIPs = ${chip.wireguardIp}/32
`
      }
    }

    const wgServerConfig = `[Interface]
PrivateKey = ${serverPrivKey}
Address = ${subnet}.1/24
ListenPort = ${serverPort}

# Enable forwarding and NAT
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -A FORWARD -o wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -D FORWARD -o wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE
${serverPeers}`

    const serverSetupScript = `#!/bin/bash
# ==========================================
# OctupusZap — WireGuard Server Setup
# Execute este script no VPS do WireGuard Server
# IP: ${serverEndpoint.split(':')[0]}
# ==========================================

set -e

echo "🔧 Instalando WireGuard..."
apt update && apt install -y wireguard

echo "📝 Criando configuração do servidor..."
cat > /etc/wireguard/wg0.conf << 'WGEOF'
${wgServerConfig}
WGEOF

echo "🔓 Ajustando permissões..."
chmod 600 /etc/wireguard/wg0.conf

echo "📡 Habilitando IP forwarding..."
sysctl -w net.ipv4.ip_forward=1
echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.d/99-wireguard.conf

echo "🚀 Ativando interface wg0..."
wg-quick up wg0
systemctl enable wg0

echo ""
echo "✅ WireGuard Server configurado com sucesso!"
echo "   Interface: wg0"
echo "   Endereço: ${subnet}.1/24"
echo "   Porta: ${serverPort}"
echo "   Peers configurados: ${chips.filter(c => c.wireguardPubKey).length}"
echo ""
echo "📋 Para verificar: wg show wg0"
echo "📋 Para reiniciar: wg-quick down wg0 && wg-quick up wg0"
`

    // ===== 2. Evolution API VPS Script (network namespaces + WireGuard + SOCKS5) =====
    let namespaceSetup = ''
    let namespaceCleanup = ''
    let socksProxies = ''

    for (const chip of chips) {
      if (!chip.wireguardPrivKey || !chip.wireguardIp) continue

      const nsName = `oz_${chip.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`
      const wgInterface = `wg_${chip.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`

      // Per-chip WireGuard client config
      const clientConfig = `[Interface]
PrivateKey = ${chip.wireguardPrivKey}
Address = ${chip.wireguardIp}/24
DNS = 1.1.1.1, 8.8.8.8

[Peer]
PublicKey = ${serverPubKey}
Endpoint = ${serverEndpoint}
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25`

      namespaceSetup += `
# --- ${chip.name} (${chip.phoneNumber}) ---
echo "🔧 Configurando namespace para ${chip.name}..."

# Criar namespace de rede
ip netns add ${nsName}

# Criar par veth (virtual ethernet)
ip link add veth_${nsName} type veth peer name veth_${nsName}_ns

# Mover uma ponta para dentro do namespace
ip link set veth_${nsName}_ns netns ${nsName}

# Configurar IP no host (ponte entre namespace e host)
ip addr add ${subnet}$((200 + ${chips.indexOf(chip)}))/30 dev veth_${nsName}
ip link set veth_${nsName} up

# Configurar IP dentro do namespace
ip netns exec ${nsName} ip addr add ${subnet}$((201 + ${chips.indexOf(chip)}))/30 dev veth_${nsName}_ns
ip netns exec ${nsName} ip link set veth_${nsName}_ns up
ip netns exec ${nsName} ip link set lo up

# Rota default dentro do namespace (via host)
ip netns exec ${nsName} ip route add default via ${subnet}$((200 + ${chips.indexOf(chip)}))

# Criar config WireGuard dentro do namespace
mkdir -p /etc/wireguard/${nsName}
cat > /etc/wireguard/${nsName}/wg0.conf << 'WGCLIENTEOF'
${clientConfig}
WGCLIENTEOF

# Criar interface WireGuard dentro do namespace
ip netns exec ${nsName} wg-quick up wg0 -c /etc/wireguard/${nsName}/wg0.conf 2>/dev/null || \\
  ip netns exec ${nsName} bash -c 'WG_QUICK_USERSPACE_IMPLEMENTATION=wg-quick ip link add wg0 type wireguard && wg setconf wg0 /etc/wireguard/${nsName}/wg0.conf && ip addr add ${chip.wireguardIp}/24 dev wg0 && ip link set wg0 up && ip route add 0.0.0.0/0 dev wg0'

# Iniciar SOCKS5 proxy dentro do namespace (porta ${chip.socksPort})
# Usando microsocks (ultra-leve, ~30KB)
if command -v microsocks &> /dev/null; then
  ip netns exec ${nsName} microsocks -p ${chip.socksPort} -i 0.0.0.0 &
  echo "  ✅ SOCKS5 proxy ativo na porta ${chip.socksPort}"
else
  echo "  ⚠️  microsocks não encontrado. Instale com: apt install -y microsocks"
  echo "  Depois execute: ip netns exec ${nsName} microsocks -p ${chip.socksPort} -i 0.0.0.0 &"
fi

echo "  📡 ${chip.name}: WireGuard ${chip.wireguardIp} → SOCKS5 :${chip.socksPort}"
`

      namespaceCleanup += `
# Remover namespace ${chip.name}
ip netns pids ${nsName} 2>/dev/null | xargs kill 2>/dev/null || true
ip netns exec ${nsName} wg-quick down wg0 2>/dev/null || true
ip link del veth_${nsName} 2>/dev/null || true
ip netns del ${nsName} 2>/dev/null || true
`

      socksProxies += `# ${chip.name}: localhost:${chip.socksPort}\n`
    }

    const evolutionVpsScript = `#!/bin/bash
# ==========================================
# OctupusZap — Evolution API VPS Setup
# Execute este script no VPS da Evolution API
# (evolution.nikki.com.br)
#
# Este script configura:
# 1. WireGuard (túneis VPN para cada chip)
# 2. Network Namespaces (isolamento de rede por chip)
# 3. SOCKS5 Proxy (para a Evolution API usar por instância)
# ==========================================

set -e

echo "═══════════════════════════════════════════"
echo "  OctupusZap — VPS Setup"
echo "═══════════════════════════════════════════"
echo ""

# ---- Passo 1: Instalar dependências ----
echo "📦 Instalando dependências..."
apt update
apt install -y wireguard-tools iproute2 microsocks

# Verificar módulo WireGuard
modprobe wireguard 2>/dev/null || echo "⚠️  Módulo wireguard não carregado (pode precisar de reboot)"

echo "🔓 Habilitando IP forwarding..."
sysctl -w net.ipv4.ip_forward=1
echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.d/99-wireguard.conf

# ---- Passo 2: Limpar namespaces antigos (se existirem) ----
echo "🧹 Limpando configuração anterior..."
${namespaceCleanup || '# Nenhum namespace para limpar'}

# ---- Passo 3: Criar namespaces + WireGuard + SOCKS5 para cada chip ----
echo ""
echo "📡 Configurando ${chips.filter(c => c.wireguardPrivKey).length} chip(s)..."
${namespaceSetup || '# Nenhum chip com WireGuard configurado'}

# ---- Passo 4: Habilitar acesso aos SOCKS5 proxies ----
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Configuração concluída!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 SOCKS5 Proxies disponíveis:"
echo "────────────────────────────────"
echo -e "${socksProxies || '# Nenhum proxy configurado'}"
echo "────────────────────────────────"
echo ""
echo "🔌 Para configurar na Evolution API:"
echo "   No OctupusZap → Chips → Proxy → SOCKS5"
echo "   Host: localhost"
echo "   Porta: (conforme lista acima)"
echo ""
echo "🔄 Para reiniciar tudo:"
echo "   bash /root/octupuszap-vps-cleanup.sh"
echo "   bash /root/octupuszap-vps-setup.sh"
echo ""
echo "📋 Verificar namespaces: ip netns list"
echo "📋 Verificar WireGuard: ip netns exec oz_* wg show"
echo "📋 Verificar SOCKS5: ss -tlnp | grep microsocks"
`

    // ===== 3. Docker Compose override for Evolution API (optional) =====
    const dockerComposeNote = `# Opcional: Se a Evolution API roda em Docker,
# os SOCKS5 proxies em localhost ESTÃO acessíveis de dentro do container
# apenas se o container usar network_mode: "host"
#
# Se usar docker-compose, adicione:
#
# services:
#   evolution-api:
#     network_mode: "host"
#
# Ou, se não puder usar host network, use o IP do host:
# Host: $(hostname -I | awk '{print $1}')
# Porta: (conforme lista acima)`

    // ===== 4. Proxy config for all chips (for the dashboard) =====
    const proxyConfigs = chips
      .filter(c => c.wireguardPrivKey && c.wireguardIp)
      .map(c => ({
        chipId: c.id,
        chipName: c.name,
        wireguardIp: c.wireguardIp,
        socksPort: c.socksPort,
        proxyHost: 'localhost',
        proxyPort: c.socksPort,
      }))

    return NextResponse.json({
      serverEndpoint,
      serverPort,
      subnet,
      chipCount: chips.length,
      configuredChips: chips.filter(c => c.wireguardPrivKey && c.wireguardIp).length,
      wgServerConfig,
      serverSetupScript,
      evolutionVpsScript,
      dockerComposeNote,
      proxyConfigs,
    })
  } catch (error: any) {
    console.error('VPS setup error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * POST /api/vps-setup
 * Auto-configure all chips to use WireGuard-based SOCKS5 proxy.
 * Updates proxyMode='socks5', socks5Host='localhost', socks5Port=assigned port
 */
export async function POST() {
  try {
    const chips = await db.chip.findMany({
      where: {
        wireguardPrivKey: { not: '' },
        wireguardIp: { not: '' },
      },
    })

    let updated = 0
    for (const chip of chips) {
      await db.chip.update({
        where: { id: chip.id },
        data: {
          proxyMode: 'socks5',
          socks5Host: 'localhost',
          socks5Port: chip.socksPort,
          socks5User: '',
          socks5Pass: '',
        },
      })
      updated++

      // Apply proxy to Evolution API instance if exists
      if (chip.evolutionInstance) {
        try {
          const { setProxy } = await import('@/lib/evolution-api')
          await setProxy(chip.evolutionInstance, {
            enabled: true,
            host: 'localhost',
            port: String(chip.socksPort),
            username: '',
            password: '',
          })
        } catch (proxyErr) {
          console.error(`Failed to set proxy for ${chip.evolutionInstance}:`, proxyErr)
        }
      }
    }

    return NextResponse.json({
      success: true,
      updated,
      message: `${updated} chip(s) configurados com proxy SOCKS5 via WireGuard`,
    })
  } catch (error: any) {
    console.error('VPS setup POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
