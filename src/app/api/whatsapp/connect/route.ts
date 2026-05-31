import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  createInstance,
  connectInstance as routerConnectInstance,
  disconnectInstance as routerDisconnectInstance,
  deleteInstance as routerDeleteInstance,
  getGlobalProxy,
  findInstanceByName,
} from '@/lib/evolution-router'
import { getInstanceName as v3GetInstanceName, findInstanceByName as v3FindInstanceByName, resolveChipProxy, getInstanceQRCode, getConnectionState as v3GetConnectionState, clearInstanceIdCache, setProxy } from '@/lib/evolution-api'

export async function POST(request: Request) {
  try {
    const { chipId } = await request.json()

    if (!chipId) {
      return NextResponse.json({ error: 'chipId é obrigatório' }, { status: 400 })
    }

    const chip = await db.chip.findUnique({ where: { id: chipId } })
    if (!chip) {
      return NextResponse.json({ error: 'Chip não encontrado' }, { status: 404 })
    }

    // Build instance name
    const instanceName = chip.evolutionInstance || v3GetInstanceName(chip.id, chip.name)

    // Build webhook URL for this instance
    // IMPORTANT: Use NEXT_PUBLIC_APP_URL (stable production URL) over VERCEL_URL (deployment-specific)
    // VERCEL_URL changes on every deploy, which breaks existing webhooks in Evolution Go
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000')
    const webhookUrl = `${appUrl}/api/whatsapp/webhook`

    // ===== Evolution Go Connection Flow =====
    // Resolve proxy config for this chip
    const globalProxy = await getGlobalProxy()
    const proxyConfig = resolveChipProxy(chip, globalProxy)

    // Check if instance already exists
    let existing = await v3FindInstanceByName(instanceName)

    // ===== Stale session detection =====
    // If the chip is marked as disconnected in our DB but the Evolution API
    // instance still has a stored WhatsApp session (jid), calling /instance/connect
    // may auto-restore the session without showing a QR code.
    //
    // HOWEVER, we must NOT blindly delete instances with a valid jid!
    // After a QR code scan, the jid represents a VALID session. If Evolution Go
    // sends a temporary "Reconnecting" disconnect, the chip might still be
    // reconnecting. Deleting the instance would kill the active session.
    //
    // NEW STRATEGY:
    //   - If state === 'open' (fully active) → session is working, just reconnect
    //   - If state === 'connecting' AND has jid → session exists, try /instance/connect
    //     to auto-restore it. Only delete if that fails.
    //   - If state === 'open' AND user explicitly wants QR → delete only if chip
    //     has been disconnected for a while (not a fresh scan)
    //
    // We NO LONGER delete instances with jids automatically. Instead, we try
    // to reconnect first and only fall back to delete+recreate if the reconnect
    // fails to produce a QR code.
    if (existing && chip.status !== 'connected') {
      const storedJid = existing.jid || existing.ownerJid || ''
      const hasStoredSession = storedJid.length > 0

      try {
        const realState = await v3GetConnectionState(existing.name || instanceName)
        const realStateValue = realState.state || 'close'

        if (realStateValue === 'open') {
          // Instance is actually connected! Just update DB and return connected.
          // This can happen if the webhook was slow to update the DB.
          console.log(`[Connect] Chip "${chip.name}" is "${chip.status}" in DB but Evolution shows state=open. Restoring connection status.`)
          await db.chip.update({
            where: { id: chipId },
            data: {
              status: 'connected',
              isQrPaired: true,
              lastSeen: new Date(),
            },
          })
          return NextResponse.json({
            instanceName: existing.name || instanceName,
            qrcode: null,
            code: null,
            state: 'open',
          })
        }

        if (hasStoredSession && realStateValue === 'connecting') {
          // Instance has a stored session and is in "connecting" state.
          // This likely means Evolution Go is trying to auto-restore the session.
          // Try calling /instance/connect — it may auto-restore without QR code.
          console.log(`[Connect] Chip "${chip.name}" has stored session (jid=${storedJid}) and state=connecting. Trying auto-restore via /instance/connect...`)

          // Fall through to the normal connect flow below — DON'T delete the instance.
          // The connect flow will call /instance/connect which may auto-restore the session.
          // If auto-restore works (returns state=open), great!
          // If not, it will return a QR code for the user to scan.
        }

        // Only delete+recreate if there's NO stored session AND the instance
        // is not in a usable state (stuck at 'close' with no jid).
        // This handles the case where the instance was created but never connected
        // and is now in a zombie state.
        if (!hasStoredSession && realStateValue === 'close') {
          console.log(`[Connect] Chip "${chip.name}" has no stored session and state=close. Will try normal connect (no deletion needed).`)
          // Fall through to normal connect — no deletion needed
        }
      } catch {
        // Status check failed — proceed with normal connect flow
      }
    }

    if (!existing) {
      // Create new instance in Evolution Go — WITHOUT proxy!
      //
      // CRITICAL BUG FIX: Proxy must NOT be set at instance creation time.
      // The proxy (WireGuard/SOCKS5 at 10.0.0.x:8084) is on a private VPN network
      // that the Evolution Go server cannot reach. Adding proxy at creation prevents
      // the instance from connecting to WhatsApp, which blocks QR code generation.
      //
      // Fix: Create the instance WITHOUT proxy → get QR code → connect → then
      // add proxy via POST /instance/proxy/{instanceId} after connection.
      const newInstance = await createInstance(instanceName, undefined)
      const effectiveInstanceName = newInstance.name || instanceName

      // Connect via router
      const connectResult = await routerConnectInstance(effectiveInstanceName, webhookUrl)

      // Evolution Go: QR code comes via webhook, not in connect response.
      // Try to fetch QR code immediately as fallback.
      let qrcode: string | null = connectResult.qrcode
      let code: string | null = connectResult.code || connectResult.pairingCode || null
      let effectiveState: string = connectResult.state || 'close'
      if (!qrcode && effectiveState !== 'open') {
        try {
          // Wait a moment for Evolution Go to generate the QR code
          await new Promise(r => setTimeout(r, 1500))
          const qrResult = await getInstanceQRCode(effectiveInstanceName)
          qrcode = qrResult.qrcode ?? null
          code = code ?? qrResult.code ?? null
          // If QR fetch returns 'open' (session already logged in), update state
          if (qrResult.state === 'open') {
            effectiveState = 'open'
          }
        } catch {
          // QR code not available yet — will be delivered via webhook
        }
      }

      // CRITICAL FIX: Verify effectiveState against /instance/status before trusting it.
      // The connect result or QR code fetch may report 'open' based on stale data
      // (e.g., a stored jid from a previous session). We must verify the ACTUAL
      // connection state before marking the chip as connected in our DB.
      if (effectiveState === 'open') {
        try {
          const verifiedState = await v3GetConnectionState(effectiveInstanceName)
          const verifiedRealState = verifiedState.state || 'close'
          if (verifiedRealState !== 'open') {
            console.log(`[Connect] effectiveState was 'open' but /instance/status returned '${verifiedRealState}'. Correcting.`)
            effectiveState = verifiedRealState
          }
        } catch {
          // Verification failed — don't assume connected, be safe
          console.warn(`[Connect] Could not verify connection state for ${effectiveInstanceName}. Defaulting to 'close'.`)
          effectiveState = 'close'
        }
      }

      const isConnected = effectiveState === 'open'
      const newStatus = isConnected ? 'connected' : 'connecting'

      // Update chip in database
      await db.chip.update({
        where: { id: chipId },
        data: {
          status: newStatus,
          evolutionInstance: effectiveInstanceName,
          qrPairingCode: code,
          lastSeen: isConnected ? new Date() : chip.lastSeen,
          ...(isConnected ? { isQrPaired: true } : {}),
        },
      })

      // Set proxy AFTER the instance is created and connected.
      // This uses POST /instance/proxy/{instanceId} which doesn't block
      // the initial WhatsApp connection / QR code generation.
      if (isConnected && proxyConfig && proxyConfig.enabled) {
        setProxy(effectiveInstanceName, proxyConfig).catch(err => {
          console.warn(`[Connect] Failed to set proxy for ${effectiveInstanceName} (non-blocking):`, err)
        })
      }

      return NextResponse.json({
        instanceName: effectiveInstanceName,
        qrcode: qrcode || null,
        code: code || null,
        state: effectiveState,
      })
    }

    // Instance exists — connect directly via router
    // NOTE: Do NOT call setWebhook() before routerConnectInstance()!
    // setWebhook() calls POST /instance/connect internally, which triggers
    // a premature reconnection using the stored session, causing the QR code
    // to be skipped. routerConnectInstance() already passes the webhookUrl
    // to its own /instance/connect call, so setWebhook() is redundant.
    const effectiveInstanceName = existing.name || instanceName

    // Connect via router
    const connectResult = await routerConnectInstance(effectiveInstanceName, webhookUrl)

    // Evolution Go: QR code comes via webhook, not in connect response.
    // Try to fetch QR code immediately as fallback.
    let qrcode: string | null = connectResult.qrcode
    let code: string | null = connectResult.code || connectResult.pairingCode || null
    let effectiveState: string = connectResult.state || 'close'
    if (!qrcode && effectiveState !== 'open') {
      try {
        // Wait a moment for Evolution Go to generate the QR code
        await new Promise(r => setTimeout(r, 1500))
        const qrResult = await getInstanceQRCode(effectiveInstanceName)
        qrcode = qrResult.qrcode ?? null
        code = code ?? qrResult.code ?? null
        // If QR fetch returns 'open' (session already logged in), update state
        if (qrResult.state === 'open') {
          effectiveState = 'open'
        }
      } catch {
        // QR code not available yet — will be delivered via webhook
      }
    }

    // ============================================
    // ZOMBIE INSTANCE DETECTION & AUTO-RECOVERY
    // ============================================
    // If after connecting, we still have no QR code AND the instance is not open,
    // the instance may be in a "zombie" state.
    //
    // IMPORTANT: We must NOT delete instances that have a stored jid!
    // A jid means the user previously scanned a QR code and has an active session.
    // Deleting would destroy the session and force another QR scan.
    // Only delete if there's no jid (instance was created but never connected).
    if (!qrcode && effectiveState !== 'open') {
      // Check if instance has a stored session before deciding to delete
      let instanceHasJid = false
      try {
        const { fetchInstances } = await import('@/lib/evolution-api')
        const allInstances = await fetchInstances()
        const currentInstance = allInstances.find((i: any) => i.name === effectiveInstanceName)
        if (currentInstance) {
          instanceHasJid = !!(currentInstance.jid || currentInstance.ownerJid)
        }
      } catch { /* can't check — be safe and don't delete */ }

      if (instanceHasJid) {
        // Instance has a stored session — DON'T delete it!
        // It might be reconnecting. Just return the current state.
        console.log(`[Connect] Instance "${effectiveInstanceName}" has stored session (jid) but no QR code. NOT deleting — session may be reconnecting.`)
      } else {
        // No stored session — safe to delete and recreate
        console.log(`[Connect] No QR code, not connected, no stored session for "${effectiveInstanceName}" — checking for zombie state...`)

        try {
          // Wait a bit more and check status
          await new Promise(r => setTimeout(r, 3000))
          const statusCheck = await v3GetConnectionState(effectiveInstanceName)

          if (statusCheck.state === 'close') {
            console.log(`[Connect] Instance "${effectiveInstanceName}" is zombie (state=close after connect, no jid). Deleting and recreating...`)

            // Delete the zombie instance
            try { await routerDisconnectInstance(effectiveInstanceName) } catch { /* may fail */ }
            try { await routerDeleteInstance(effectiveInstanceName) } catch { /* may fail */ }

            // Wait for deletion to take effect
            await new Promise(r => setTimeout(r, 2000))

            // Clear instance ID cache — the old UUID/token is now invalid
            clearInstanceIdCache()

            // Recreate instance from scratch — WITHOUT proxy!
            const newInstance = await createInstance(instanceName, undefined)
            const newEffectiveName = newInstance.name || instanceName

            const newConnectResult = await routerConnectInstance(newEffectiveName, webhookUrl)

            qrcode = newConnectResult.qrcode
            code = newConnectResult.code || newConnectResult.pairingCode || null
            effectiveState = newConnectResult.state || 'close'

            if (!qrcode && effectiveState !== 'open') {
              try {
                await new Promise(r => setTimeout(r, 2000))
                const retryQr = await getInstanceQRCode(newEffectiveName)
                qrcode = retryQr.qrcode ?? null
                code = code ?? retryQr.code ?? null
                if (retryQr.state === 'open') {
                  effectiveState = 'open'
                }
              } catch {
                // QR not available yet
              }
            }

            console.log(`[Connect] Zombie recovery: qrcode=${!!qrcode}, state=${effectiveState}`)

            // Verify state after zombie recovery
            if (effectiveState === 'open') {
              try {
                const verifiedState = await v3GetConnectionState(newEffectiveName)
                const verifiedRealState = verifiedState.state || 'close'
                if (verifiedRealState !== 'open') {
                  console.log(`[Connect] Zombie recovery: effectiveState was 'open' but /instance/status returned '${verifiedRealState}'. Correcting.`)
                  effectiveState = verifiedRealState
                }
              } catch {
                console.warn(`[Connect] Zombie recovery: Could not verify connection state for ${newEffectiveName}. Defaulting to 'close'.`)
                effectiveState = 'close'
              }
            }

            const isRecoveredConnected = effectiveState === 'open'
            const recoveryStatus = isRecoveredConnected ? 'connected' : 'connecting'

            await db.chip.update({
              where: { id: chipId },
              data: {
                status: recoveryStatus,
                evolutionInstance: newEffectiveName,
                qrPairingCode: code,
                lastSeen: isRecoveredConnected ? new Date() : chip.lastSeen,
                ...(isRecoveredConnected ? { isQrPaired: true } : {}),
              },
            })

            // Set proxy AFTER instance is connected (non-blocking)
            if (isRecoveredConnected && proxyConfig && proxyConfig.enabled) {
              setProxy(newEffectiveName, proxyConfig).catch(err => {
                console.warn(`[Connect] Failed to set proxy after zombie recovery for ${newEffectiveName}:`, err)
              })
            }

            return NextResponse.json({
              instanceName: newEffectiveName,
              qrcode: qrcode || null,
              code: code || null,
              state: effectiveState,
            })
          }
        } catch (zombieErr) {
          console.error(`[Connect] Zombie detection failed for "${effectiveInstanceName}":`, zombieErr)
          // Fall through to normal response
        }
      }
    }

    // CRITICAL FIX: Verify effectiveState against /instance/status before trusting it.
    // Same verification as the new-instance path above.
    if (effectiveState === 'open') {
      try {
        const verifiedState = await v3GetConnectionState(effectiveInstanceName)
        const verifiedRealState = verifiedState.state || 'close'
        if (verifiedRealState !== 'open') {
          console.log(`[Connect] effectiveState was 'open' but /instance/status returned '${verifiedRealState}'. Correcting.`)
          effectiveState = verifiedRealState
        }
      } catch {
        console.warn(`[Connect] Could not verify connection state for ${effectiveInstanceName}. Defaulting to 'close'.`)
        effectiveState = 'close'
      }
    }

    const isConnected = effectiveState === 'open'
    const newStatus = isConnected ? 'connected' : 'connecting'

    // Update chip in database
    await db.chip.update({
      where: { id: chipId },
      data: {
        status: newStatus,
        evolutionInstance: effectiveInstanceName,
        qrPairingCode: code,
        lastSeen: isConnected ? new Date() : chip.lastSeen,
        ...(isConnected ? { isQrPaired: true } : {}),
      },
    })

    return NextResponse.json({
      instanceName: effectiveInstanceName,
      qrcode: qrcode || null,
      code: code || null,
      state: effectiveState,
    })
  } catch (error: any) {
    console.error('WhatsApp connect error:', error)
    return NextResponse.json(
      { error: error.message || 'Erro ao conectar WhatsApp' },
      { status: 500 }
    )
  }
}
