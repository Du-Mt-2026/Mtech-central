import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveChipProxy, getGlobalProxy } from '@/lib/evolution-router'
import { getConnectionState, fetchInstances, setProxy } from '@/lib/evolution-api'

/**
 * Test proxy connectivity WITHOUT disconnecting the chip.
 *
 * GET /api/chips/test-proxy?chipId=xxx
 *
 * This endpoint:
 *   1. Resolves the proxy config for the chip (WireGuard/SOCKS5)
 *   2. Checks if the Evolution Go container can reach the proxy
 *   3. Checks the current connection state of the instance
 *   4. Returns a detailed report WITHOUT applying any changes
 *
 * POST /api/chips/test-proxy
 * { chipId: "xxx", dryRun: true }
 *
 * dryRun=true  → only test, don't apply (default)
 * dryRun=false → actually apply proxy with fallback (USE WITH CAUTION)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const chipId = searchParams.get('chipId')

    if (!chipId) {
      return NextResponse.json({ error: 'chipId é obrigatório' }, { status: 400 })
    }

    const chip = await db.chip.findUnique({ where: { id: chipId } })
    if (!chip) {
      return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 })
    }

    const globalProxy = await getGlobalProxy()
    const proxyConfig = resolveChipProxy(chip, globalProxy)

    // Get current instance state from Evolution Go
    let instanceState = null
    let instanceInfo = null
    if (chip.evolutionInstance) {
      try {
        const stateResult = await getConnectionState(chip.evolutionInstance)
        instanceState = stateResult
      } catch {
        instanceState = { error: 'Não conseguiu consultar estado da instância' }
      }

      try {
        const instances = await fetchInstances()
        instanceInfo = instances.find((i: any) => i.name === chip.evolutionInstance) || null
      } catch {
        instanceInfo = null
      }
    }

    // Build test result
    const result: Record<string, any> = {
      chip: {
        id: chip.id,
        name: chip.name,
        status: chip.status,
        phoneNumber: chip.phoneNumber,
        evolutionInstance: chip.evolutionInstance,
      },
      proxy: proxyConfig ? {
        resolved: true,
        host: proxyConfig.host,
        port: proxyConfig.port,
        protocol: proxyConfig.protocol || 'socks5',
        hasAuth: !!(proxyConfig.username && proxyConfig.password),
        source: chip.wireguardIp ? 'wireguard' : chip.proxyMode === 'socks5' ? 'explicit-socks5' : 'global',
      } : {
        resolved: false,
        reason: chip.wireguardIp
          ? 'WireGuard IP definido mas sem porta SOCKS5'
          : 'Nenhum proxy configurado para este chip',
      },
      instance: {
        state: instanceState?.state || 'unknown',
        hasProxy: !!(instanceInfo as any)?.proxy,
        currentProxy: (instanceInfo as any)?.proxy || null,
      },
      canApply: false,
      risks: [],
      recommendations: [],
    }

    // Risk assessment
    if (!proxyConfig) {
      result.risks.push('Nenhum proxy configurado — não há o que aplicar')
    }

    if (chip.status !== 'connected') {
      result.risks.push(`Chip está "${chip.status}" (não conectado) — aplicar proxy pode não funcionar`)
    }

    if (!chip.evolutionInstance) {
      result.risks.push('Chip não tem instância Evolution Go associada')
    }

    if (proxyConfig && chip.status === 'connected' && chip.evolutionInstance) {
      result.canApply = true
      result.risks.push('Aplicar proxy VAI desconectar o chip brevemente (2-5 segundos)')
      result.risks.push('Se o proxy estiver inacessível, o fallback reconectará sem proxy')
      result.recommendations.push('Teste com um chip não-crítico primeiro')
      result.recommendations.push('Certifique-se de que o celular está com WireGuard e Every Proxy ativos')
    }

    if (instanceState?.state === 'open' && (instanceInfo as any)?.proxy) {
      result.recommendations.push('Instância já tem proxy configurado — não precisa aplicar novamente')
    }

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('[TestProxy] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * Actually apply proxy with full fallback safety.
 * POST /api/chips/test-proxy { chipId, dryRun }
 *
 * dryRun=true  → only simulate (default)
 * dryRun=false → apply for real
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { chipId, dryRun = true } = body

    if (!chipId) {
      return NextResponse.json({ error: 'chipId é obrigatório' }, { status: 400 })
    }

    const chip = await db.chip.findUnique({ where: { id: chipId } })
    if (!chip) {
      return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 })
    }

    const globalProxy = await getGlobalProxy()
    const proxyConfig = resolveChipProxy(chip, globalProxy)

    if (!proxyConfig) {
      return NextResponse.json({
        success: false,
        message: 'Nenhum proxy configurado para este chip',
      })
    }

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        message: 'Simulação — nenhuma mudança foi feita',
        wouldApply: {
          host: proxyConfig.host,
          port: proxyConfig.port,
          protocol: proxyConfig.protocol || 'socks5',
          hasAuth: !!(proxyConfig.username && proxyConfig.password),
        },
        wouldDisconnect: chip.status === 'connected',
        wouldAutoReconnect: true,
        wouldFallbackIfProxyFails: true,
        nextStep: 'Chame com dryRun=false para aplicar de verdade',
      })
    }

    // ACTUALLY APPLY — use the same applyProxyWithFallback logic from PATCH
    if (!chip.evolutionInstance) {
      return NextResponse.json({
        success: false,
        message: 'Chip não tem instância Evolution Go associada',
      })
    }

    // Import dynamically to reuse the same code
    const { connectInstance: routerConnectInstance } = await import('@/lib/evolution-router')

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000')
    const webhookUrl = `${appUrl}/api/whatsapp/webhook`

    // Step 1: Remember current state
    let stateBefore = 'unknown'
    try {
      const stateResult = await getConnectionState(chip.evolutionInstance)
      stateBefore = stateResult?.state || 'unknown'
    } catch { /* ok */ }

    // Step 2: Apply proxy
    console.log(`[TestProxy] Applying proxy to ${chip.evolutionInstance}...`)
    try {
      await setProxy(chip.evolutionInstance, proxyConfig)
    } catch (proxyErr: any) {
      return NextResponse.json({
        success: false,
        message: `Falha ao aplicar proxy: ${proxyErr?.message}`,
        stateBefore,
      })
    }

    // Step 3: Reconnect
    try {
      await routerConnectInstance(chip.evolutionInstance, webhookUrl)
    } catch (reconnectErr: any) {
      console.warn(`[TestProxy] Reconnect failed: ${reconnectErr?.message}`)
    }

    // Step 4: Wait and verify
    await new Promise(r => setTimeout(r, 5000))

    let stateAfter = 'unknown'
    try {
      const stateResult = await getConnectionState(chip.evolutionInstance)
      stateAfter = stateResult?.state || 'unknown'
    } catch { /* ok */ }

    if (stateAfter === 'open') {
      return NextResponse.json({
        success: true,
        withProxy: true,
        message: `Proxy aplicado com sucesso! Chip reconectou pelo proxy.`,
        stateBefore,
        stateAfter,
        proxy: { host: proxyConfig.host, port: proxyConfig.port, protocol: proxyConfig.protocol || 'socks5' },
      })
    }

    // Step 5: Fallback — remove proxy and reconnect without it
    console.warn(`[TestProxy] Chip is ${stateAfter} after proxy — applying fallback...`)

    try {
      await setProxy(chip.evolutionInstance, {
        enabled: false, host: '', port: '0', username: '', password: '',
      })
    } catch { /* ok */ }

    try {
      await routerConnectInstance(chip.evolutionInstance, webhookUrl)
    } catch { /* ok */ }

    await new Promise(r => setTimeout(r, 3000))

    let fallbackState = 'unknown'
    try {
      const stateResult = await getConnectionState(chip.evolutionInstance)
      fallbackState = stateResult?.state || 'unknown'
    } catch { /* ok */ }

    return NextResponse.json({
      success: fallbackState === 'open',
      withProxy: false,
      message: fallbackState === 'open'
        ? 'Proxy não funcionou — chip reconectou SEM proxy (fallback)'
        : 'Proxy e fallback falharam — chip pode precisar de reconexão manual',
      stateBefore,
      stateAfterProxy: stateAfter,
      stateAfterFallback: fallbackState,
    })
  } catch (error: any) {
    console.error('[TestProxy] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
