import { recoverStuckMessages } from '@/lib/sending-engine'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  fetchInstances,
  getConnectionState,
  connectInstance,
  setWebhook,
  isOctupusZapInstance,
  clearInstanceIdCache,
} from '@/lib/evolution-api'
import { checkQuarantineCooldown } from '@/lib/reconnection-queue'

/**
 * Cron Health Check — detecta e recupera instâncias presas.
 *
 * Esta rota é chamada pelo container health-cron a cada 5 minutos.
 * Detecta instâncias que:
 *   1. Estão "Reconnecting" há mais de 5 minutos (presas no loop)
 *   2. Estão com status inconsistente (DB diz conectado, Evolution diz desconectado)
 *   3. Perderam a configuração de webhook
 *
 * Para cada problema encontrado, tenta recuperação automática.
 */
export async function POST(request: Request) {
  const startTime = Date.now()
  const results: string[] = []
  const errors: string[] = []

  try {
    // Optional: protect with a secret to prevent external abuse
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 0. Verificar chips em quarentena com cooldown expirado (auto-reativar)
  await checkQuarantineCooldown().catch(err => console.log('[HealthCheck] Quarantine check failed:', err))

  // 1. Fetch all instances from Evolution API
    let allInstances: any[] = []
    try {
      allInstances = await fetchInstances()
      results.push(`Fetched ${allInstances.length} instances from Evolution API`)
    } catch (err: any) {
      errors.push(`Failed to fetch instances: ${err.message}`)
      return NextResponse.json({ ok: false, errors, results }, { status: 500 })
    }

    // 2. Get all OctupusZap chips from DB
    const chips = await db.chip.findMany({
      where: { evolutionInstance: { not: null } },
    })

    const chipMap = new Map(chips.map(c => [c.evolutionInstance, c]))

    let recovered = 0
    let fixed = 0
    let stuck = 0

    // 3. Check each OctupusZap instance
    for (const instance of allInstances) {
      if (!isOctupusZapInstance(instance.name)) continue

      const chip = chipMap.get(instance.name)
      if (!chip) continue

      const disconnectReason = instance.disconnect_reason || ''

      // === CHECK 1: Instance stuck in "Reconnecting" ===
      if (disconnectReason.toLowerCase().includes('reconnecting')) {
        stuck++
        results.push(`Instance ${instance.name} is STUCK in "Reconnecting" — attempting recovery`)

        try {
          // Try to get real connection state
          const connState = await getConnectionState(instance.name)
          const realState = connState.state || 'close'

          if (realState === 'open') {
            // Actually connected! Just update DB
            await db.chip.update({
              where: { id: chip.id },
              data: { status: 'connected', isQrPaired: true, lastSeen: new Date() },
            })
            fixed++
            results.push(`  → Actually connected! Updated DB status`)
            continue
          }

          // Stuck — force reconnect
          // Step 1: Try disconnect first to clear the stuck state
          try {
            const { disconnectInstance } = await import('@/lib/evolution-router')
            await disconnectInstance(instance.name)
            await new Promise(r => setTimeout(r, 2000))
          } catch {
            // Disconnect may fail for stuck instances
          }

          // Step 2: Reconnect with webhook
          const appUrl = process.env.NEXT_PUBLIC_APP_URL ||
            (process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000')
          const webhookUrl = `${appUrl}/api/whatsapp/webhook`

          try {
            const connectResult = await connectInstance(instance.name, webhookUrl)
            if (connectResult.state === 'open') {
              await db.chip.update({
                where: { id: chip.id },
                data: {
                  status: 'connected',
                  isQrPaired: true,
                  lastSeen: new Date(),
                  qrPairingCode: null,
                },
              })
              recovered++
              results.push(`  → Recovered! Reconnected successfully`)
            } else {
              // Needs QR code scan
              await db.chip.update({
                where: { id: chip.id },
                data: { status: 'connecting' },
              })
              results.push(`  → Needs QR code scan (state=${connectResult.state})`)
            }
          } catch (err: any) {
            errors.push(`  → Recovery failed for ${instance.name}: ${err.message}`)
          }

          // Clear instance cache after recovery attempt
          clearInstanceIdCache()
        } catch (err: any) {
          errors.push(`  → Error checking ${instance.name}: ${err.message}`)
        }
        continue
      }

      // === CHECK 2: Webhook missing ===
      if (!instance.webhook && chip.status === 'connected') {
        results.push(`Instance ${instance.name} is connected but missing webhook — fixing`)

        try {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL ||
            (process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000')
          const webhookUrl = `${appUrl}/api/whatsapp/webhook`
          await setWebhook(instance.name, webhookUrl)
          fixed++
          results.push(`  → Webhook configured`)
        } catch (err: any) {
          errors.push(`  → Failed to set webhook: ${err.message}`)
        }
        continue
      }

      // === CHECK 3: DB status inconsistent with Evolution API ===
      if (chip.status === 'connected' && !instance.connected) {
        results.push(`Instance ${instance.name}: DB=connected but Evolution=disconnected — fixing`)

        try {
          const connState = await getConnectionState(instance.name)
          if (connState.state !== 'open') {
            await db.chip.update({
              where: { id: chip.id },
              data: { status: 'disconnected', isQrPaired: false },
            })
            fixed++
            results.push(`  → Updated DB to disconnected`)
          }
        } catch (err: any) {
          errors.push(`  → Status check failed: ${err.message}`)
        }
        continue
      }

      // === CHECK 4: DB says disconnected but Evolution says connected ===
      if (chip.status !== 'connected' && instance.connected) {
        results.push(`Instance ${instance.name}: DB=disconnected but Evolution=connected — fixing`)

        try {
          const connState = await getConnectionState(instance.name)
          if (connState.state === 'open') {
            await db.chip.update({
              where: { id: chip.id },
              data: { status: 'connected', isQrPaired: true, lastSeen: new Date() },
            })
            fixed++
            results.push(`  → Updated DB to connected`)
          }
        } catch (err: any) {
          errors.push(`  → Status check failed: ${err.message}`)
        }
      }
    }

    // 4. Check for chips in DB with stale "connecting" status (>10 min)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)
    const staleConnecting = await db.chip.findMany({
      where: {
        status: 'connecting',
        updatedAt: { lt: tenMinutesAgo },
        evolutionInstance: { not: null },
      },
    })

    for (const chip of staleConnecting) {
      const instanceName = chip.evolutionInstance!
      try {
        const connState = await getConnectionState(instanceName)
        if (connState.state === 'open') {
          await db.chip.update({
            where: { id: chip.id },
            data: { status: 'connected', isQrPaired: true, lastSeen: new Date() },
          })
          fixed++
          results.push(`Chip ${chip.name}: was "connecting" for >10min, now connected`)
        } else if (connState.state === 'close') {
          await db.chip.update({
            where: { id: chip.id },
            data: { status: 'disconnected' },
          })
          fixed++
          results.push(`Chip ${chip.name}: was "connecting" for >10min, now marked disconnected`)
        }
      } catch {
        // Skip
      }
    }

    const duration = Date.now() - startTime

    console.log(`[HealthCheck] Done in ${duration}ms | Stuck: ${stuck} | Recovered: ${recovered} | Fixed: ${fixed} | Errors: ${errors.length}`)

    return NextResponse.json({
      ok: true,
      duration: `${duration}ms`,
      stats: { stuck, recovered, fixed, staleConnecting: staleConnecting.length },
      results,
      errors: errors.length > 0 ? errors : undefined,
    })

  } catch (error: any) {
    console.error('[HealthCheck] Fatal error:', error)
    return NextResponse.json({
      ok: false,
      error: error.message,
      results,
      errors,
    }, { status: 500 })
  }
}

// Also support GET for easy testing
export async function GET(request: Request) {
  return POST(request)
}
