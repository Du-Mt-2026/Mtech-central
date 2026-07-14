import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'
import { dispatchWebhookEvent } from './handlers'

/**
 * Webhook endpoint for Evolution Go (v3) API status updates.
 *
 * v3 webhook format:
 *   { event: "Message"|"Connected"|"Disconnected"|"QRCode"|"SEND_MESSAGE"|"READ_RECEIPT"|..., data: {...}, instanceId: "uuid" }
 *
 * SECURITY (P1.1): Fail-closed apikey verification.
 * The endpoint REQUIRES the `apikey` header (or `x-api-key`, `?token=`, `?apikey=`,
 * `Authorization: Bearer <key>`) to match EVOLUTION_API_KEY. If the env var is
 * not set in production, the endpoint refuses all requests.
 * In development, allows requests without auth (with a warning) for local testing.
 *
 * To configure Evolution Go to send the apikey header on webhooks:
 *   - In Evolution Go dashboard, edit the webhook configuration
 *   - Add a custom header: apikey = <your EVOLUTION_API_KEY>
 *   - Or use the /api/whatsapp/setup-webhook endpoint which sets it automatically
 *
 * SECURITY (P1.6): Uses crypto.timingSafeEqual to prevent timing attacks.
 *
 * ARCHITECTURE (P2.1): This file contains ONLY auth + context resolution.
 * All event handlers live in ./handlers.ts (dispatchWebhookEvent).
 */
export async function POST(request: Request) {
  try {
    // SECURITY (P1.1): Fail-closed webhook authentication.
    const WEBHOOK_SECRET = process.env.EVOLUTION_API_KEY
    const isProduction = process.env.NODE_ENV === 'production'

    if (!WEBHOOK_SECRET) {
      if (isProduction) {
        console.error('[Webhook] EVOLUTION_API_KEY not configured in production — webhook disabled (fail-closed)')
        return NextResponse.json(
          { error: 'Webhook disabled — EVOLUTION_API_KEY not configured' },
          { status: 503 }
        )
      }
      console.warn('[Webhook] EVOLUTION_API_KEY not set in development — allowing (fail-open in dev only)')
    } else {
      const url = new URL(request.url)
      const providedKey =
        url.searchParams.get('token') ||
        url.searchParams.get('apikey') ||
        request.headers.get('apikey') ||
        request.headers.get('x-api-key') ||
        request.headers.get('authorization')?.replace('Bearer ', '')
        || null

      if (!providedKey) {
        console.warn('[Webhook] Rejected — no apikey provided')
        return NextResponse.json(
          { error: 'Unauthorized — webhook apikey required' },
          { status: 401 }
        )
      }

      const secretBuffer = Buffer.from(WEBHOOK_SECRET, 'utf8')
      const providedBuffer = Buffer.from(providedKey, 'utf8')

      if (secretBuffer.length !== providedBuffer.length) {
        console.warn('[Webhook] Rejected — apikey wrong length')
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      if (!timingSafeEqual(secretBuffer, providedBuffer)) {
        console.warn('[Webhook] Rejected — invalid apikey')
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    // Load anti-ban settings for ban detection configuration
    const settings = await db.antiBanSettings.findFirst()
    const banCodes = (() => { try { return settings?.banCodes ? JSON.parse(settings.banCodes) : [401,403,428,440] } catch { return [401,403,428,440] } })()
    const restrictionKeywords = (() => { try { return settings?.restrictionKeywords ? JSON.parse(settings.restrictionKeywords) : ['conta está restringida','conta esta restringida','envio de spam','mensagens automáticas','mensagens automaticas','mensagens em massa','atividade recente','account is restricted','sending spam','automated messages','bulk messages','não será possível','nao sera possivel','iniciar novas conversas'] } catch { return ['conta está restringida','conta esta restringida','envio de spam','mensagens automáticas','mensagens automaticas','mensagens em massa','atividade recente','account is restricted','sending spam','automated messages','bulk messages','não será possível','nao sera possivel','iniciar novas conversas'] } })()
    const banLookbackMs = (settings?.banLookbackHours ?? 24) * 3600000
    const banMaxMessagesCheck = settings?.banMaxMessagesCheck ?? 30
    const banKeywordThreshold = settings?.banKeywordThreshold ?? 2

    const body = await request.json()

    const event = body.event
    const data = body.data
    const instanceId = body.instanceId || ''
    const instanceName = body.instanceName || ''

    // === Resolve instance name from Evolution Go webhook format ===
    // Evolution Go sends webhooks with these fields:
    //   - instanceId: UUID of the instance
    //   - instanceName: name of the instance (e.g., "OctupusZap_xxx")
    //   - instanceToken: token of the instance
    //
    // We prefer instanceName (direct name match) over instanceId (requires API lookup)
    // because it's faster and doesn't require an extra API call.
    let chipInstanceName = ''

    // First try: use instanceName directly (Evolution Go provides this)
    if (instanceName) {
      chipInstanceName = instanceName
    }

    // Second try: look up instanceId via Evolution API (slower, requires API call)
    if (!chipInstanceName && instanceId) {
      try {
        const { fetchInstances } = await import('@/lib/evolution-api')
        const instances = await fetchInstances()
        const matched = instances.find((i: any) => i.id === instanceId)
        if (matched) {
          chipInstanceName = matched.name
        }
      } catch {
        chipInstanceName = instanceId
      }
    }

    if (!chipInstanceName) {
      return NextResponse.json({ ok: true })
    }

    // Find the chip linked to this instance
    let linkedChip = await db.chip.findFirst({
      where: { evolutionInstance: chipInstanceName },
    })

    // ============================================
    // FIX: Auto-link chips by phone number
    // ============================================
    // When a chip is created manually (POST /api/chips) with a pretty name
    // like "Mari Mtech Promo 2", it starts WITHOUT an evolutionInstance.
    // When it connects via QR code, the Evolution API creates an instance
    // like "OctupusZap_Mari_Mtech_Promo_2_xxxxx" and sends a webhook.
    // Without this fix, the webhook silently drops the event because
    // no chip has that evolutionInstance set. This causes:
    //   1. Chip stays "disconnected" even though it's connected in Evolution
    //   2. The GET /api/chips auto-import creates a DUPLICATE chip
    //
    // Fix: If no chip is found by evolutionInstance, try to find a chip
    // by phone number (from the webhook data) and link it automatically.
    if (!linkedChip) {
      // Extract phone number from various webhook data fields
      const jid = data?.JID || data?.jid || data?.id || data?.Info?.Chat || ''
      const phoneFromJid = jid.split('@')[0].split(':')[0] || ''

      if (phoneFromJid && phoneFromJid.length >= 10) {
        // Try to find a chip with this phone number that has NO evolutionInstance yet
        const unlinkedChip = await db.chip.findFirst({
          where: {
            phoneNumber: phoneFromJid,
            evolutionInstance: null,
          },
          select: { id: true, name: true, phoneNumber: true },
        })

        // Also try with different phone formats (with/without country code, 9th digit)
        const chipCandidates: Array<{ id: string; name: string; phoneNumber: string } | null> = [unlinkedChip]
        if (!unlinkedChip) {
          // Try without the leading "55" country code
          const phoneWithoutCountry = phoneFromJid.replace(/^55/, '')
          const chipByShortPhone = await db.chip.findFirst({
            where: {
              phoneNumber: { contains: phoneWithoutCountry.slice(-8) },
              evolutionInstance: null,
            },
            select: { id: true, name: true, phoneNumber: true },
          })
          chipCandidates.push(chipByShortPhone)
        }

        for (const candidate of chipCandidates) {
          if (candidate) {
            // Found an unlinked chip with matching phone — link it!
            try {
              await db.chip.update({
                where: { id: candidate.id },
                data: { evolutionInstance: chipInstanceName },
              })
              console.log(`[Webhook] Auto-linked chip "${candidate.name}" (phone: ${candidate.phoneNumber}) to instance ${chipInstanceName}`)

              // Re-fetch the chip with the updated evolutionInstance
              linkedChip = await db.chip.findUnique({
                where: { id: candidate.id },
              })
              break
            } catch (linkErr) {
              console.error(`[Webhook] Failed to auto-link chip ${candidate.id}:`, linkErr)
            }
          }
        }
      }

      // If still not linked after phone search, skip this event
      if (!linkedChip) {
        return NextResponse.json({ ok: true })
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Dispatch to event handlers (in ./handlers.ts)
    // ─────────────────────────────────────────────────────────────────────
    await dispatchWebhookEvent({
      event,
      data,
      instanceId,
      chipInstanceName,
      linkedChip,
      banSettings: {
        banCodes,
        restrictionKeywords,
        banLookbackMs,
        banMaxMessagesCheck,
        banKeywordThreshold,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('Webhook error:', error)
    // Always return 200 to avoid retry storms
    return NextResponse.json({ ok: true })
  }
}
