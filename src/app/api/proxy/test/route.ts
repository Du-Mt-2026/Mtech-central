import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveChipProxy, getGlobalProxy } from '@/lib/evolution-api'

const WG_API_URL = process.env.WIREGUARD_API_URL || ''
const WG_API_TOKEN = process.env.WIREGUARD_API_TOKEN || ''

/**
 * POST /api/proxy/test
 * Test SOCKS5 proxy connectivity for a chip.
 * Routes the test through the KVM4 WireGuard API since Vercel can't reach
 * WireGuard IPs (10.0.0.x) directly and the 'net' module doesn't work on Vercel.
 */
export async function POST(request: Request) {
  try {
    const { chipId, host, port } = await request.json()

    let proxyHost = host
    let proxyPort = port

    // If chipId is provided, resolve proxy from chip config
    if (chipId && !proxyHost) {
      const chip = await db.chip.findUnique({ where: { id: chipId } })
      if (!chip) {
        return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 })
      }

      const globalProxy = await getGlobalProxy()
      const proxyConfig = resolveChipProxy(chip, globalProxy)

      if (!proxyConfig || !proxyConfig.enabled) {
        return NextResponse.json({
          success: false,
          reachable: false,
          socks5Valid: false,
          message: 'Nenhum proxy configurado para este chip. Configure o WireGuard ou o proxy SOCKS5 primeiro.',
        })
      }

      proxyHost = proxyConfig.host
      proxyPort = parseInt(proxyConfig.port) || 0
    }

    if (!proxyHost || !proxyPort) {
      return NextResponse.json({
        success: false,
        reachable: false,
        socks5Valid: false,
        message: 'Host e porta do proxy são obrigatórios',
      })
    }

    // Test via KVM4 WireGuard API (can reach WireGuard IPs)
    if (WG_API_URL && WG_API_TOKEN) {
      try {
        const apiRes = await fetch(`${WG_API_URL}/api/wireguard/test-proxy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: proxyHost,
            port: proxyPort,
            token: WG_API_TOKEN,
          }),
          signal: AbortSignal.timeout(15000),
        })

        if (apiRes.ok) {
          const apiData = await apiRes.json()
          const reachable = apiData.reachable || false

          return NextResponse.json({
            success: true,
            reachable,
            socks5Valid: false,
            proxyInfo: { host: proxyHost, port: proxyPort },
            message: reachable
              ? `Proxy ${proxyHost}:${proxyPort} está acessível! O Every Proxy está rodando.`
              : `Proxy ${proxyHost}:${proxyPort} não está acessível. Verifique se o WireGuard e o Every Proxy estão rodando no celular.`,
          })
        }
      } catch (apiErr: any) {
        console.error('[Proxy Test] WG API failed:', apiErr.message)
        return NextResponse.json({
          success: false,
          reachable: false,
          socks5Valid: false,
          message: `Não foi possível testar o proxy: erro ao contatar o servidor WireGuard (${apiErr.message}). Verifique a configuração da API.`,
        })
      }
    }

    // No WG API configured — can't test from Vercel
    return NextResponse.json({
      success: false,
      reachable: false,
      socks5Valid: false,
      message: 'API do WireGuard não configurada (WIREGUARD_API_URL). Não é possível testar o proxy a partir da Vercel.',
    })
  } catch (error: any) {
    console.error('Proxy test error:', error)
    return NextResponse.json({
      success: false,
      reachable: false,
      socks5Valid: false,
      message: error.message || 'Erro ao testar proxy',
    }, { status: 500 })
  }
}
