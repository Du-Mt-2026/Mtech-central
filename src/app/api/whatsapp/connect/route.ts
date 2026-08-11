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
import { getInstanceName as v3GetInstanceName, findInstanceByName as v3FindInstanceByName, resolveChipProxy, getInstanceQRCode, getConnectionState as v3GetConnectionState, clearInstanceIdCache, enableRejectCallAfterConnection } from '@/lib/evolution-api'
import { getQRCode } from '@/lib/qr-cache'

// Helper: busca QR code com retry (Evolution Go pode demorar pra gerar)
async function fetchQRWithRetry(instanceName: string, maxRetries = 3, delayMs = 3000): Promise<{ qrcode: string | null; code: string | null; state: string }> {
  // PRIMEIRO: checa cache (QR code recebido via webhook)
  const cachedQR = getQRCode(instanceName)
  if (cachedQR?.qrcode) {
    console.log(`[QR] QR code encontrado no cache para ${instanceName}`)
    return { qrcode: cachedQR.qrcode, code: cachedQR.code, state: 'close' }
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const qrResult = await getInstanceQRCode(instanceName)
      if (qrResult.qrcode) {
        console.log(`[QR] QR code obtido na tentativa ${attempt}/${maxRetries} para ${instanceName}`)
        return { qrcode: qrResult.qrcode, code: qrResult.code || null, state: qrResult.state || 'close' }
      }
      if (qrResult.state === 'open') {
        return { qrcode: null, code: null, state: 'open' }
      }
      console.log(`[QR] Tentativa ${attempt}/${maxRetries}: sem QR code ainda, aguardando ${delayMs}ms...`)
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, delayMs))
    } catch (err) {
      console.warn(`[QR] Tentativa ${attempt}/${maxRetries} falhou:`, err)
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, delayMs))
    }
  }
  return { qrcode: null, code: null, state: 'close' }
}

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
    // SECURITY: Include token in webhook URL so Evolution Go sends it back for auth
    const webhookToken = process.env.EVOLUTION_API_KEY || ''
    const webhookUrl = webhookToken
      ? `${appUrl}/api/whatsapp/webhook?token=${webhookToken}`
      : `${appUrl}/api/whatsapp/webhook`

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
          // Fall through to the normal connect flow — it will try /instance/connect
          // which may auto-restore the session. If it fails, the stale session
          // cleanup logic below will handle it (delete + recreate).
          console.log(`[Connect] Chip "${chip.name}" has stored session (jid=${storedJid}) and state=connecting. Will try auto-restore via /instance/connect...`)
        }

        // If the instance has a stored session but is in 'close' state,
        // the session is STALE — Evolution Go can't restore it.
        //
        // CRITICAL FIX (2026-08-11): Previously this branch only logged and fell
        // through to the normal connect flow. The normal flow calls /instance/connect
        // (which returns the stale jid) and then /instance/qr (which returns a NEW
        // QR code). But the stale jid is STILL stored in Evolution Go's database.
        //
        // When the user scans the QR code with their phone, WhatsApp servers see
        // that there's already an "active" session registered for that phone number
        // (the stale one), and REJECT the new connection with the error:
        //   "Não foi possível conectar o dispositivo. Tente novamente mais tarde"
        //
        // THE FIX: Delete the instance entirely (which clears the stale jid from
        // Evolution Go's database) and create a fresh one. The fresh instance has
        // no jid, so WhatsApp servers accept the new QR code scan.
        //
        // This was the root cause of chips failing to reconnect after being
        // disconnected for a while (Meta expires idle sessions, but Evolution Go
        // keeps the jid in its DB).
        if (hasStoredSession && realStateValue === 'close') {
          console.log(`[Connect] Chip "${chip.name}" has STALE stored session (jid=${storedJid}, state=close). Forcing delete + recreate to clear stale jid...`)

          try {
            // 1. Disconnect (in case there's any pending connection)
            try {
              await routerDisconnectInstance(existing.name || instanceName)
            } catch (e) {
              console.log(`[Connect] Disconnect before delete failed (ok): ${e}`)
            }
            await new Promise(r => setTimeout(r, 1000))

            // 2. Delete the instance — this clears the stale jid
            try {
              await routerDeleteInstance(existing.name || instanceName)
            } catch (e) {
              console.warn(`[Connect] Delete failed (continuing): ${e}`)
            }
            await new Promise(r => setTimeout(r, 2000))

            // 3. Clear the instance ID cache — old UUID/token is invalid
            clearInstanceIdCache()

            // 4. Create a fresh instance with the SAME name
            const newInstance = await createInstance(instanceName)
            const freshName = newInstance.name || instanceName

            // 5. Connect the fresh instance
            const freshConnect = await routerConnectInstance(freshName, webhookUrl)

            // 6. Wait for QR code (4s for client goroutine to start)
            let freshQrcode: string | null = freshConnect.qrcode
            let freshCode: string | null = freshConnect.code || freshConnect.pairingCode || null
            let freshState: string = freshConnect.state || 'close'

            if (!freshQrcode && freshState !== 'open') {
              await new Promise(r => setTimeout(r, 4000))
              const qrRetry = await fetchQRWithRetry(freshName, 4, 3000)
              freshQrcode = qrRetry.qrcode
              freshCode = freshCode ?? qrRetry.code
              if (qrRetry.state === 'open') freshState = 'open'
            }

            const isConnected = freshState === 'open'
            const newStatus = isConnected ? 'connected' : 'connecting'

            await db.chip.update({
              where: { id: chipId },
              data: {
                status: newStatus,
                evolutionInstance: freshName,
                qrPairingCode: freshCode,
                lastSeen: isConnected ? new Date() : chip.lastSeen,
                ...(isConnected ? { isQrPaired: true } : {}),
              },
            })

            if (isConnected) {
              enableRejectCallAfterConnection(freshName).catch(err => {
                console.warn(`[Connect] Failed to enable rejectCall for ${freshName}:`, err)
              })
            }

            console.log(`[Connect] Stale session cleared. Fresh instance "${freshName}" ready (qrcode=${!!freshQrcode}, state=${freshState}).`)

            return NextResponse.json({
              instanceName: freshName,
              qrcode: freshQrcode || null,
              code: freshCode || null,
              state: freshState,
            })
          } catch (recoveryErr: any) {
            console.error(`[Connect] Stale session recovery failed for "${chip.name}":`, recoveryErr)
            // Fall through to normal flow as last resort
          }
        }

        // No stored session and state=close — normal case, just fall through.
        if (!hasStoredSession && realStateValue === 'close') {
          console.log(`[Connect] Chip "${chip.name}" has no stored session and state=close. Will try normal connect.`)
        }
      } catch {
        // Status check failed — proceed with normal connect flow
      }
    }

    if (!existing) {
      // Create new instance in Evolution Go — WITH proxy if available!
      //
      // PREVIOUS BUG: We used to create WITHOUT proxy because we assumed the
      // proxy (WireGuard/SOCKS5 at 10.0.0.x:8084) was unreachable from the
      // Evolution Go container. This is NO LONGER TRUE — iptables NAT rules
      // on KVM8 allow the Docker container to reach the WireGuard network.
      //
      // NEW STRATEGY: Create WITH proxy when the chip has a WireGuard IP.
      // This way, the first connection goes through the proxy from the start,
      // and we never need to disconnect to apply the proxy later.
      //
      // If proxy is unreachable, Evolution Go will fall back to direct connection
      // for QR code generation, so this doesn't block QR scanning.
      const newInstance = await createInstance(instanceName)
      const effectiveInstanceName = newInstance.name || instanceName

      // Connect via router
      const connectResult = await routerConnectInstance(effectiveInstanceName, webhookUrl)

      // Evolution Go: QR code comes via webhook, not in connect response.
      // Try to fetch QR code after giving Evolution Go time to start the client.
      //
      // CRITICAL: We must wait long enough for Evolution Go to start the client
      // in the background goroutine before calling GET /instance/qr. If we call
      // it too early, Evolution Go's GetQr function might see client==nil and
      // call StartInstance(), starting a SECOND client that invalidates the
      // QR code from the first client — this was the root cause of the
      // "QR code doesn't work when created through OctupusZap" bug.
      let qrcode: string | null = connectResult.qrcode
      let code: string | null = connectResult.code || connectResult.pairingCode || null
      let effectiveState: string = connectResult.state || 'close'
      if (!qrcode && effectiveState !== 'open') {
        await new Promise(r => setTimeout(r, 4000))
        const qrRetry = await fetchQRWithRetry(effectiveInstanceName, 3, 3000)
        qrcode = qrRetry.qrcode
        code = code ?? qrRetry.code
        if (qrRetry.state === 'open') effectiveState = 'open'
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

      // CRITICAL FIX: Do NOT call setProxy() after connection!
      // POST /instance/proxy/{instanceId} RESTARTS the WhatsApp connection in
      // Evolution Go. If the proxy is unreachable, the reconnection fails and
      // the instance stays permanently disconnected. This was the root cause
      // of chips disconnecting shortly after QR code scan.
      // Proxy should be set at creation time if accessible by the Evolution Go server.

      // Enable rejectCall AFTER connection is established (non-blocking).
      // rejectCall=true at creation causes "Reconnecting" loop bug.
      if (isConnected) {
        enableRejectCallAfterConnection(effectiveInstanceName).catch(err => {
          console.warn(`[Connect] Failed to enable rejectCall for ${effectiveInstanceName}:`, err)
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
    // Try to fetch QR code after giving Evolution Go time to start the client.
    //
    // CRITICAL: We must wait long enough for Evolution Go to start the client
    // in the background goroutine before calling GET /instance/qr. If we call
    // it too early, Evolution Go's GetQr function might see client==nil and
    // call StartInstance(), starting a SECOND client that invalidates the
    // QR code from the first client — this was the root cause of the
    // "QR code doesn't work when created through OctupusZap" bug.
    let qrcode: string | null = connectResult.qrcode
    let code: string | null = connectResult.code || connectResult.pairingCode || null
    let effectiveState: string = connectResult.state || 'close'
    if (!qrcode && effectiveState !== 'open') {
      await new Promise(r => setTimeout(r, 4000))
      const qrRetry = await fetchQRWithRetry(effectiveInstanceName, 3, 3000)
      qrcode = qrRetry.qrcode
      code = code ?? qrRetry.code
      if (qrRetry.state === 'open') effectiveState = 'open'
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
      // No QR code and not connected — the instance is stuck.
      // Check if instance has a stored session (jid) and whether it's active or stale.
      let instanceHasJid = false
      let instanceSessionIsStale = false
      try {
        const { fetchInstances } = await import('@/lib/evolution-api')
        const allInstances = await fetchInstances()
        const currentInstance = allInstances.find((i: any) => i.name === effectiveInstanceName)
        if (currentInstance) {
          instanceHasJid = !!(currentInstance.jid || currentInstance.ownerJid)
        }

        // If the instance has a jid, verify whether the session is actually active
        if (instanceHasJid) {
          try {
            const statusCheck = await v3GetConnectionState(effectiveInstanceName)
            const realState = statusCheck.state || 'close'
            // If the real state is NOT 'open', the session is stale — the jid is from
            // a dead session that Evolution Go can't restore. We need to clear it.
            if (realState !== 'open') {
              instanceSessionIsStale = true
              console.log(`[Connect] Instance "${effectiveInstanceName}" has jid but session is STALE (state=${realState}). Will force cleanup.`)
            } else {
              // Session is actually active — the initial connect just missed it
              console.log(`[Connect] Instance "${effectiveInstanceName}" has active session (state=open). Restoring DB status.`)
              await db.chip.update({
                where: { id: chipId },
                data: {
                  status: 'connected',
                  isQrPaired: true,
                  lastSeen: new Date(),
                },
              })
              return NextResponse.json({
                instanceName: effectiveInstanceName,
                qrcode: null,
                code: null,
                state: 'open',
              })
            }
          } catch {
            // Can't verify — assume stale to be safe
            instanceSessionIsStale = true
          }
        }
      } catch { /* can't check — proceed with cleanup */ }

      // For instances with stale sessions OR no jid at all — we need to
      // delete and recreate to force a fresh QR code.
      // The connectInstance() function already tried disconnect+reconnect for stale sessions,
      // but if we still don't have a QR code, the instance needs a full reset.
      if (!instanceHasJid || instanceSessionIsStale) {
        console.log(`[Connect] No QR code after connect for "${effectiveInstanceName}" (hasJid=${instanceHasJid}, stale=${instanceSessionIsStale}). Deleting and recreating...`)

        try {
          // Wait a bit more for any pending operations
          await new Promise(r => setTimeout(r, 2000))

          // Disconnect and delete the instance
          try { await routerDisconnectInstance(effectiveInstanceName) } catch { /* may fail */ }
          try { await routerDeleteInstance(effectiveInstanceName) } catch { /* may fail */ }

          // Wait for deletion to take effect
          await new Promise(r => setTimeout(r, 2000))

          // Clear instance ID cache — the old UUID/token is now invalid
          clearInstanceIdCache()

          // Recreate instance from scratch — WITH proxy if available!
          const newInstance = await createInstance(instanceName)
          const newEffectiveName = newInstance.name || instanceName

          const newConnectResult = await routerConnectInstance(newEffectiveName, webhookUrl)

          qrcode = newConnectResult.qrcode
          code = newConnectResult.code || newConnectResult.pairingCode || null
          effectiveState = newConnectResult.state || 'close'

          if (!qrcode && effectiveState !== 'open') {
            const recoveryQr = await fetchQRWithRetry(newEffectiveName, 4, 3000)
            qrcode = recoveryQr.qrcode
            code = code ?? recoveryQr.code
            if (recoveryQr.state === 'open') effectiveState = 'open'
          }

          console.log(`[Connect] Instance recovery: qrcode=${!!qrcode}, state=${effectiveState}`)

          // NOTE: No verification of effectiveState='open' against /instance/status here.
          // Same reason — the WhatsApp handshake may be in progress.

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

          // CRITICAL FIX: Do NOT call setProxy() after connection!
          // Same reason as above — POST /instance/proxy restarts the connection.

          return NextResponse.json({
            instanceName: newEffectiveName,
            qrcode: qrcode || null,
            code: code || null,
            state: effectiveState,
          })
        } catch (recoveryErr) {
          console.error(`[Connect] Instance recovery failed for "${effectiveInstanceName}":`, recoveryErr)
          // Fall through to normal response
        }
      }
    }

    // connectInstance() already verifies against /instance/status when a jid is returned.
    // If state='open', the instance is truly connected (Connected=true AND LoggedIn=true).
    // If state='close', the session is stale or missing — needs QR code.

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
