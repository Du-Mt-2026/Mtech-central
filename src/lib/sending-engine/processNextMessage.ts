// Message processing — processNextMessage (the main per-message loop) and the
// legacy processCampaign wrapper.
//
// This module orchestrates a single message send: claim → chip lock → ban
// check → interval/cooldown check → presence simulation → send → post-send
// anti-ban behaviors (delayed offline, idle reading, cooldown trigger) →
// next-interval calculation. It pulls in helpers, antiBan, and humanBehavior.

import {
  sendTextMessage as routerSendText,
  sendMediaMessage as routerSendMedia,
  setPresence as routerSetPresence,
  formatPhoneNumber,
} from '../evolution-router'
import { enqueueReconnection } from '../reconnection-queue'
import { db } from '../db'
import { WARMING_MODE_MULTIPLIERS } from '../constants'
import { toMins, getCurrentMinutes } from '../time-utils'
import {
  type AntiBanConfig,
  getAntiBanSettings,
  isWithinSendingWindow,
  getActiveBreakWindow,
  getPresenceConfig,
  getTypingConfig,
  getDeliveryRateConfig,
  ABSOLUTE_MIN_INTERVAL_SEC,
  chipLastSendMap,
  isChipInMemoryCooling,
  markChipSent,
  releaseMessageAndChipLock,
  resetDailyIfNeeded,
  resetHourlyIfNeeded,
  advanceWarmingPhase,
  isInCooldown,
  getAvailableChipsForReassignment,
  randomInt,
  gaussianRandom,
  gaussianDelaySeconds,
} from './helpers'
import {
  detectChipBan,
  checkForWarnings,
  getEffectiveDailyLimit,
  getMinimumIntervalForChip,
} from './antiBan'
import {
  calculateTypingDuration,
  delayedOfflineWithJitter,
  performIdleReadingPresence,
  getNonlinearPauseMinutes,
  getClusterDelaySeconds,
  getDayRhythmMultiplier,
} from './humanBehavior'

// ============================================================
// MESSAGE PROCESSING
// ============================================================

/**
 * Process the NEXT pending message for a campaign.
 * Returns the delay (ms) the caller should wait before processing the next one.
 */

export async function processNextMessage(campaignId: string, skipContactIds?: Set<string>): Promise<{
  processed: boolean
  delayMs: number
  remaining: number
  completed: boolean
  reason?: string
  events?: Array<{ type: string; chipName?: string; campaignName?: string; reason?: string }>
  skippedContactId?: string  // Contact ID that was skipped (step_delay) — caller should add to skip list
}> {
  // Check if campaign is paused or completed
  const campaignStatus = await db.campaign.findUnique({
    where: { id: campaignId },
    select: { status: true },
  })
  if (!campaignStatus) {
    return { processed: false, delayMs: 0, remaining: 0, completed: true }
  }
  if (campaignStatus.status === 'paused') {
    return { processed: false, delayMs: 0, remaining: -1, completed: false, reason: 'paused' }
  }

  // Get campaign anti-ban settings (nextSendAt is handled per-chip, not campaign-level)
  const campaignInfo = await db.campaign.findUnique({
    where: { id: campaignId },
    select: { antiBanEnabled: true, warmingMode: true, sendIntervalMin: true, sendIntervalMax: true },
  })
  const antiBanEnabled = campaignInfo?.antiBanEnabled ?? true
  const warmingMode = campaignInfo?.warmingMode || 'normal'
  // Use campaign-specific interval if available, otherwise fall back to global settings
  const campaignIntervalMin = campaignInfo?.sendIntervalMin
  const campaignIntervalMax = campaignInfo?.sendIntervalMax

  const settings = await getAntiBanSettings()

  // ============================================
  // PARALLEL CHIP SENDING — no campaign-level slot claim
  // ============================================
  // v5.0: Removed the campaign-level atomic slot claim that blocked ALL chips.
  // Each chip now operates independently with its own nextSendAt.
  // The campaign.nextSendAt is ONLY used for campaign-level state
  // (sending window, break windows, completion) — NOT for chip intervals.
  //
  // Message selection now filters for chips that are ready to send:
  //   - chip.nextSendAt is null or in the past
  //   - chip.cooldownUntil is null or in the past
  //   - chip.status = 'connected'
  //   - chip.evolutionInstance IS NOT NULL
  //
  // This allows multiple chips in the same campaign to send in parallel.
  // When one chip is in cooldown/interval, other chips continue sending.

  // CHECK SENDING WINDOW — don't send outside business hours
  if (antiBanEnabled && !isWithinSendingWindow(settings)) {
    const currentMins = getCurrentMinutes(settings.timezone)
    console.debug(`[SendingEngine] Outside sending window (${currentMins}min, window: ${settings.sendingWindowStart}-${settings.sendingWindowEnd}, tz: ${settings.timezone}). Pausing.`)
    // v5.0: Set campaign.nextSendAt to avoid re-checking too often (campaign-level state)
    await db.campaign.update({
      where: { id: campaignId },
      data: { nextSendAt: new Date(Date.now() + 60 * 1000) },
    })
    return {
      processed: false,
      delayMs: 60 * 1000, // Check again in 1 minute
      remaining: -1,
      completed: false,
      reason: `outside_sending_window_${Math.floor(currentMins/60)}h${currentMins%60}m`,
    }
  }

  // CHECK BREAK WINDOWS — pausas dentro da janela de envio (almoço, reunião, etc.)
  if (antiBanEnabled && settings.breakWindows.length > 0) {
    const activeBreak = getActiveBreakWindow(settings)
    if (activeBreak) {
      const currentMins = getCurrentMinutes(settings.timezone)
      const breakEndMins = toMins(activeBreak.end)
      // Wait until break ends
      const waitMins = breakEndMins - currentMins
      const waitMs = Math.max(waitMins * 60 * 1000, 60 * 1000) // at least 1 minute
      const startH = Math.floor(toMins(activeBreak.start) / 60)
      const startM = toMins(activeBreak.start) % 60
      const endH = Math.floor(breakEndMins / 60)
      const endM = breakEndMins % 60
      console.debug(`[SendingEngine] In break window "${activeBreak.label}" (${String(startH).padStart(2,'0')}:${String(startM).padStart(2,'0')}-${String(endH).padStart(2,'0')}:${String(endM).padStart(2,'0')}). Waiting ${waitMins}min.`)
      // v5.0: Set campaign.nextSendAt until break ends (campaign-level state)
      await db.campaign.update({
        where: { id: campaignId },
        data: { nextSendAt: new Date(Date.now() + waitMs) },
      })
      return {
        processed: false,
        delayMs: waitMs,
        remaining: -1,
        completed: false,
        reason: `break_${activeBreak.label}_${Math.floor(currentMins/60)}h${currentMins%60}m`,
      }
    }
  }

  // ============================================================
  // CONTACT-BY-CONTACT PROCESSING (with parallel chip support)
  // ============================================================
  // Process ALL steps for one contact before moving to the next.
  // Messages are created in order: A-step1, A-step2, B-step1, B-step2, ...
  // Using 'id' (auto-increment) preserves creation order even when createdAt is identical.
  //
  // v5.0 PARALLEL: Message selection now filters for chips that are READY to send.
  // If the earliest pending message's chip is in cooldown/interval, we skip it
  // and find the next pending message whose chip IS ready. This allows multiple
  // chips to send in parallel within the same campaign.
  //
  // Step 1: Find the NEXT CONTACT whose chip is ready (earliest pending message with ready chip)
  // Step 2: Find the NEXT STEP for that contact (lowest stepOrder)
  // This preserves contact-by-contact ordering when chips are ready.

  // Helper: chip readiness filter used in queries
  // PROBLEMA 4: inclui `paused: false` para que chips pausados individualmente
  // não sejam selecionados para envio (continuam conectados ao WhatsApp, mas
  // não recebem novas mensagens de campanha).
  const chipReadyFilter = antiBanEnabled ? {
    status: 'connected',
    paused: false,
    evolutionInstance: { not: null },
    AND: [
      { OR: [{ nextSendAt: null }, { nextSendAt: { lt: new Date() } }] },
      { OR: [{ cooldownUntil: null }, { cooldownUntil: { lt: new Date() } }] },
    ],
  } : {
    // When anti-ban is disabled, only check connection status
    status: 'connected',
    paused: false,
    evolutionInstance: { not: null },
  }

  const earliestPending = await db.message.findFirst({
    where: { 
      campaignId, 
      status: 'pending',
      chip: chipReadyFilter,
      // Skip contacts whose step delay hasn't been met yet
      ...(skipContactIds && skipContactIds.size > 0 ? { contactId: { notIn: Array.from(skipContactIds) } } : {}),
    },
    orderBy: { id: 'asc' },  // id preserves creation order (A1, A2, B1, B2, ...)
    select: { contactId: true },
  })

  if (!earliestPending) {
    // No pending messages with ready chips. Check if there are ANY pending messages
    // (regardless of chip readiness) to distinguish between "no messages" and "no ready chips".
    const anyPending = await db.message.count({
      where: { campaignId, status: 'pending' },
    })

    if (anyPending === 0) {
      // No pending messages at all — check for campaign completion
      const stillSending = await db.message.count({
        where: { campaignId, status: 'sending' },
      })

      if (stillSending === 0) {
        await db.campaign.update({
          where: { id: campaignId },
          data: { status: 'completed', completedAt: new Date(), nextSendAt: null },
        })
        return { processed: false, delayMs: 0, remaining: 0, completed: true }
      }

      // AUTO-COMPLETION FIX: Recover stuck "sending" messages (stuck > 5 min)
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)
      const recovered = await db.message.updateMany({
        where: { campaignId, status: 'sending', updatedAt: { lt: tenMinutesAgo } },
        data: { status: 'pending' },
      })
      if (recovered.count > 0) {
        console.debug(`[SendingEngine] Recovered ${recovered.count} stuck "sending" messages during completion check — will reprocess`)
        return { processed: false, delayMs: 1000, remaining: -1, completed: false, reason: 'recovered_stuck_messages' }
      }

      // Messages are genuinely in "sending" state (not stale yet) — wait
      return { processed: false, delayMs: 3000, remaining: stillSending, completed: false, reason: 'message_in_sending_state' }
    }

    // There ARE pending messages but NO chips are ready (all in cooldown/interval/disconnected)
    // Set a short campaign.nextSendAt to avoid hammering the DB, then return no_ready_chip
    console.debug(`[SendingEngine] ${anyPending} pending messages but no chips ready — waiting for next tick`)
    await db.campaign.update({
      where: { id: campaignId },
      data: { nextSendAt: new Date(Date.now() + 60 * 1000) }, // Check again in 1 minute
    })
    return { processed: false, delayMs: 60 * 1000, remaining: anyPending, completed: false, reason: 'no_ready_chip' }
  }

  const targetContactId = earliestPending.contactId

  // Find the next pending step for THIS contact (lowest stepOrder first)
  // H6 FIX: Use atomic claim to prevent race condition — two concurrent cron
  // invocations could both find the same pending message and send it twice.
  // By atomically updating the status to 'sending', only ONE invocation succeeds.
  const message = await db.message.findFirst({
    where: { campaignId, contactId: targetContactId, status: 'pending' },
    include: { chip: true, contact: true },
    orderBy: { stepOrder: 'asc' },
  })

  if (!message) {
    // No more pending messages for this contact — might have been picked up by another process
    return { processed: false, delayMs: 1000, remaining: -1, completed: false, reason: 'no_pending_message' }
  }

  // H6 FIX: Atomic message claim — try to set status to 'sending' only if still 'pending'.
  // If count=0, another invocation already claimed this message — skip it.
  const claimResult = await db.message.updateMany({
    where: { id: message.id, status: 'pending' },
    data: { status: 'sending' },
  })

  if (claimResult.count === 0) {
    // Another process already claimed this message — back off briefly
    console.debug(`[SendingEngine] Message ${message.id} already claimed by another process — skipping`)
    return { processed: false, delayMs: 2000, remaining: -1, completed: false, reason: 'message_already_claimed' }
  }

  // ============================================
  // CHIP LOCK: Immediately mark chip as busy to prevent race conditions
  // ============================================
  // After claiming the message, immediately set a temporary nextSendAt on the chip.
  // This prevents another concurrent invocation from selecting the SAME chip
  // before we finish processing this message. The temporary value will be
  // overwritten with the real interval after the message is sent.
  // Use a conditional update — only succeed if the chip's nextSendAt is still
  // null or in the past (i.e., the chip is still "ready").
  // BUGFIX: Track the lock timestamp so the nextSendAt check doesn't reject
  // our own lock. Previously, the code set a 120s lock, then re-fetched the
  // chip from DB and found nextSendAt in the future, causing an infinite loop
  // of claim → lock → check → release → claim again.
  const chipLockTimestamp = Date.now() + 120_000
  const chipLockResult = await db.chip.updateMany({
    where: {
      id: message.chipId,
      OR: [
        { nextSendAt: null },
        { nextSendAt: { lt: new Date() } },
      ],
    },
    data: { nextSendAt: new Date(chipLockTimestamp) }, // 2-minute temporary lock
  })

  if (chipLockResult.count === 0) {
    // Another invocation already locked this chip — release our message claim and back off
    console.debug(`[SendingEngine] Chip ${message.chip.name} already locked by another process — releasing message claim`)
    await db.message.update({ where: { id: message.id }, data: { status: 'pending' } })
    return { processed: false, delayMs: 2000, remaining: -1, completed: false, reason: 'chip_already_locked' }
  }

  // For multi-step campaigns: check if this contact's previous step has been sent
  // CONTACT-BY-CONTACT: if previous step not sent yet, WAIT for it (don't skip to other contacts)
  if (message && message.stepOrder > 1) {
    // Check if previous step has a successful status (sent, delivered, or read)
    const previousStepSent = await db.message.findFirst({
      where: {
        campaignId,
        contactId: message.contactId,
        stepOrder: message.stepOrder - 1,
        status: { in: ['sent', 'delivered', 'read'] },
      },
    })

    if (!previousStepSent) {
      // Check if previous step is currently being sent (status: 'sending')
      const previousStepSending = await db.message.findFirst({
        where: {
          campaignId,
          contactId: message.contactId,
          stepOrder: message.stepOrder - 1,
          status: 'sending',
        },
      })

      // Check if previous step FAILED — if so, fail this step too (skip this contact entirely)
      const previousStepFailed = await db.message.findFirst({
        where: {
          campaignId,
          contactId: message.contactId,
          stepOrder: message.stepOrder - 1,
          status: 'failed',
        },
      })

      if (previousStepFailed) {
        // Previous step failed — mark this step and all subsequent steps for this contact as failed
        // IMPORTANT: The current message is in 'sending' status (claimed), so update it FIRST
        await db.message.update({
          where: { id: message.id },
          data: { status: 'failed', error: 'Etapa anterior falhou — sequência interrompida' },
        })
        // Then fail any remaining pending steps for this contact
        const failedCount = await db.message.updateMany({
          where: {
            campaignId,
            contactId: message.contactId,
            stepOrder: { gt: message.stepOrder },
            status: 'pending',
          },
          data: { status: 'failed', error: 'Etapa anterior falhou — sequência interrompida' },
        })
        console.debug(`[SendingEngine] Contact ${message.contactId}: previous step failed, skipping ${failedCount.count + 1} remaining steps (including current claimed message)`)
        const remaining = await db.message.count({ where: { campaignId, status: 'pending' } })
        return { processed: true, delayMs: 1000, remaining, completed: remaining === 0 }
      }

      if (previousStepSending) {
        // Previous step is currently being sent — release claim and wait briefly
        await releaseMessageAndChipLock(message.id, message.chipId, 'waiting_for_sending_step')
        const remaining = await db.message.count({ where: { campaignId, status: 'pending' } })
        return { processed: false, delayMs: 2000, remaining, completed: false, reason: 'waiting_for_sending_step' }
      }

      // Previous step not found at all (shouldn't happen) — release claim and wait
      await releaseMessageAndChipLock(message.id, message.chipId, 'waiting_for_previous_step')
      const remaining = await db.message.count({ where: { campaignId, status: 'pending' } })
      return { processed: false, delayMs: 3000, remaining, completed: false, reason: 'waiting_for_previous_step' }
    }

    // Check delay between steps: if delayMinutes is configured, wait the appropriate time
    const campaignSteps = await db.campaign.findUnique({
      where: { id: campaignId },
      include: { sequenceSteps: true },
    })
    const currentStepConfig = campaignSteps?.sequenceSteps.find(
      s => s.stepOrder === message.stepOrder
    )
    if (currentStepConfig && currentStepConfig.delayMinutes > 0) {
      // Find when the previous step for this contact was sent
      const previousStepSentAt = await db.message.findFirst({
        where: {
          campaignId,
          contactId: message.contactId,
          stepOrder: message.stepOrder - 1,
          status: { in: ['sent', 'delivered', 'read'] },
          sentAt: { not: null },
        },
        orderBy: { sentAt: 'desc' },
        select: { sentAt: true },
      })
      if (previousStepSentAt?.sentAt) {
        const elapsedMs = Date.now() - new Date(previousStepSentAt.sentAt).getTime()
        const requiredDelayMs = (currentStepConfig.delayUnit === 'seconds' ? currentStepConfig.delayMinutes : currentStepConfig.delayMinutes * 60) * 1000
        if (elapsedMs < requiredDelayMs) {
          const waitMs = requiredDelayMs - elapsedMs
          const delayUnitLabel = currentStepConfig.delayUnit === 'seconds' ? 'seg' : 'min'
          console.debug(`[SendingEngine] Step ${message.stepOrder} for contact ${message.contactId}: delay not met (${Math.round(elapsedMs/1000)}s/${currentStepConfig.delayMinutes}${delayUnitLabel}) — waiting ${Math.round(waitMs/1000)}s`)
          // Release the claim so this message can be picked up later when the delay is met
          await db.message.update({ where: { id: message.id }, data: { status: 'pending' } })
          return {
            processed: false,
            delayMs: waitMs, // Return actual remaining delay — callers MUST wait this
            remaining: -1,
            completed: false,
            reason: `step_delay_${message.stepOrder}`,
            skippedContactId: message.contactId,  // Tell caller to skip this contact in next query
          }
        }
      }
    }
  }

  if (!message) {
    // AUTO-COMPLETION FIX: Same recovery logic as above
    // Check for stale "sending" messages and recover them before deciding
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)
    const recovered = await db.message.updateMany({
      where: { campaignId, status: 'sending', updatedAt: { lt: tenMinutesAgo } },
      data: { status: 'pending' },
    })
    if (recovered.count > 0) {
      console.debug(`[SendingEngine] Recovered ${recovered.count} stuck "sending" messages during completion check (path 2) — will reprocess`)
      return { processed: false, delayMs: 1000, remaining: -1, completed: false, reason: 'recovered_stuck_messages' }
    }

    const stillPending = await db.message.count({
      where: { campaignId, status: { in: ['pending', 'sending'] } },
    })

    if (stillPending === 0) {
      await db.campaign.update({
        where: { id: campaignId },
        data: { status: 'completed', completedAt: new Date(), nextSendAt: null },
      })
      return { processed: false, delayMs: 0, remaining: 0, completed: true }
    }

    return { processed: false, delayMs: 5000, remaining: stillPending, completed: false }
  }

  // Check chip exists and has evolution instance
  if (!message.chip.evolutionInstance) {
    await db.message.update({
      where: { id: message.id },
      data: { status: 'failed', error: 'Chip sem instância Evolution API' },
    })
    return { processed: true, delayMs: 1000, remaining: -1, completed: false }
  }

  // CHECK FOR CHIP BAN — detect banned chips (disconnected chips are NOT banned!)
  if (antiBanEnabled) {
    const banCheck = await detectChipBan(message.chip, settings)

    if (banCheck.disconnected) {
      // Chip is disconnected but NOT banned — try to reassign messages to OTHER chips in this campaign
      console.debug(`[SendingEngine] Chip ${message.chip.name} is DISCONNECTED — checking for other chips in this campaign`)

      // Find other connected chips that BELONG to this campaign (via CampaignChip)
      // PROBLEMA 4: exclui chips pausados individualmente — eles não devem
      // receber mensagens redistribuídas.
      const otherChips = await db.chip.findMany({
        where: {
          id: { not: message.chip.id },
          status: 'connected',
          paused: false,
          evolutionInstance: { not: null },
          campaigns: { some: { campaignId } },
        },
      })

      if (otherChips.length > 0) {
        // Reassign pending messages from this chip to other campaign chips (round-robin)
        // CRITICAL FIX: Não redistribuir mensagens onde um step anterior do mesmo
        // contato já foi ENVIADO por este chip. Essas mensagens devem permanecer no
        // chip desconectado e serem enviadas quando ele reconectar — garante que o
        // mesmo chip envie todas as mensagens para o mesmo contato.
        const allPendingMessages = await db.message.findMany({
          where: { campaignId, chipId: message.chip.id, status: 'pending' },
          take: 50,
        })

        // Buscar todos os contactIds que já têm step 1 enviado por este chip
        const sentStep1ContactIds = new Set<string>()
        const sentMessages = await db.message.findMany({
          where: {
            campaignId,
            chipId: message.chip.id,
            status: { in: ['sent', 'delivered', 'read'] },
            stepOrder: 1,
          },
          select: { contactId: true },
        })
        for (const sm of sentMessages) {
          sentStep1ContactIds.add(sm.contactId)
        }

        // Separar: mensagens que PODEM ser redistribuídas vs mensagens que DEVEM PERMANECER
        const pendingMessages = allPendingMessages.filter(m => !sentStep1ContactIds.has(m.contactId))
        const keptMessages = allPendingMessages.filter(m => sentStep1ContactIds.has(m.contactId))

        if (keptMessages.length > 0) {
          console.debug(`[SendingEngine] Keeping ${keptMessages.length} messages on disconnected chip ${message.chip.name} (step 1 already sent by this chip — waiting for reconnection)`)
        }

        const availableChips = await getAvailableChipsForReassignment(campaignId, otherChips)
          for (let i = 0; i < pendingMessages.length; i++) {
          const targetChip = availableChips[i % availableChips.length]
          await db.message.update({
            where: { id: pendingMessages[i].id },
            data: { chipId: targetChip.id },
          })
        }

        console.debug(`[SendingEngine] Reassigned ${pendingMessages.length} messages from disconnected chip ${message.chip.name} to other campaign chips`)

        // Mark current message as failed (it was stuck on the disconnected chip)
        await db.message.update({
          where: { id: message.id },
          data: { status: 'failed', error: `Chip desconectado: ${banCheck.reason} — mensagem redirecionada para outro chip da campanha` },
        })

        // Notify campaign about the disconnection
        await db.campaign.update({
          where: { id: campaignId },
          data: { statusReason: `Chip ${message.chip.name} desconectou — ${pendingMessages.length} mensagens redirecionadas para outros chips da campanha` },
        })

        const remaining = await db.message.count({ where: { campaignId, status: 'pending' } })
        return { processed: false, delayMs: 1000, remaining, completed: remaining === 0, reason: `disconnected_reassigned_${message.chip.name}`, events: [{ type: 'chip_disconnected', chipName: message.chip.name, campaignName: undefined }] }
      }

      // No other campaign chips available — queue chip for reconnection, then pause the campaign
      console.debug(`[SendingEngine] No other campaign chips available for disconnected chip ${message.chip.name} — queueing reconnection and pausing campaign`)

      // Queue the chip for automatic reconnection (same logic as webhook handler)
      // When the chip reconnects, autoResumeCampaigns() will resume the campaign
      try {
        await enqueueReconnection(message.chip.id, {
          immediate: true, // High priority — chip is in an active campaign
          reason: `Sending engine detected disconnection: ${banCheck.reason}`,
        })
        console.log(`[SendingEngine] Chip ${message.chip.name} enqueued for auto-reconnection`)
      } catch (reconnectErr: any) {
        console.error(`[SendingEngine] Failed to enqueue chip ${message.chip.name} for reconnection: ${reconnectErr.message}`)
      }

      await db.message.update({
        where: { id: message.id },
        data: { status: 'failed', error: `Chip desconectado: ${banCheck.reason} — nenhum outro chip na campanha` },
      })

      // Pause the campaign — no other chips in this campaign to send
      // When the chip reconnects, autoResumeCampaigns() will resume it automatically
      await db.campaign.update({
        where: { id: campaignId },
        data: {
          status: 'paused',
          statusReason: `Pausada automaticamente: chip ${message.chip.name} desconectou — aguardando reconexão automática`,
          pausedAt: new Date(),
          nextSendAt: null,
        },
      })
      console.debug(`[SendingEngine] Campaign ${campaignId} PAUSED — chip ${message.chip.name} disconnected, queued for reconnection`)
      return { processed: false, delayMs: 0, remaining: -1, completed: false, reason: 'auto_paused_no_campaign_chips', events: [{ type: 'chip_disconnected', chipName: message.chip.name }, { type: 'campaign_auto_paused', reason: 'Chip desconectou — reconexão automática em andamento' }] }
    }

    if (banCheck.banned) {
      const banType = banCheck.tempBan ? 'BAN TEMPORÁRIO' : 'BAN PERMANENTE'
      console.warn(`[SendingEngine] Chip ${message.chip.name} appears ${banType}: ${banCheck.reason}`)

      // Update chip status to banned (already done by detectChipBan for temp bans,
      // but do it here too for permanent bans and as safety net)
      await db.chip.update({
        where: { id: message.chip.id },
        data: { status: 'banned' },
      }).catch(() => {})

      // Find other connected chips that BELONG to this campaign (via CampaignChip)
      // PROBLEMA 4: exclui chips pausados individualmente
      const otherChips = await db.chip.findMany({
        where: {
          id: { not: message.chip.id },
          status: 'connected',
          paused: false,
          evolutionInstance: { not: null },
          campaigns: { some: { campaignId } },
        },
      })

      if (otherChips.length > 0) {
        // Reassign pending messages from the banned chip to other campaign chips
        // CRITICAL FIX: Agrupar por contato — todos os steps do mesmo contato
        // devem ir para o MESMO chip novo. Chip banido não reconecta, então
        // precisamos redistribuir tudo, mas mantendo a consistência de chip por contato.
        // RACE CONDITION FIX: Usar updateMany atômico por grupo de contato em vez
        // de update individual. Isso previne que processo concorrente faça claim
        // das mensagens enquanto estão sendo redistribuídas.
        const pendingMessages = await db.message.findMany({
          where: { campaignId, chipId: message.chip.id, status: 'pending' },
          take: 50,
          select: { id: true, contactId: true },
        })

        const availableChips = await getAvailableChipsForReassignment(campaignId, otherChips)
        // Group by contactId to ensure all steps for same contact go to same chip
        const contactGroups = new Map<string, string[]>() // contactId → messageIds
        for (const m of pendingMessages) {
          if (!contactGroups.has(m.contactId)) contactGroups.set(m.contactId, [])
          contactGroups.get(m.contactId)!.push(m.id)
        }
        let groupIdx = 0
        for (const [contactId, messageIds] of contactGroups) {
          const targetChip = availableChips[groupIdx % availableChips.length]
          groupIdx++
          // Atomic update: all messages for this contact go to the same chip
          // This is atomic and prevents race condition where another process
          // could claim individual messages between updates
          await db.message.updateMany({
            where: {
              id: { in: messageIds },
              status: 'pending', // Only update if still pending (not claimed by another process)
            },
            data: { chipId: targetChip.id },
          })
        }

        console.debug(`[SendingEngine] Reassigned ${pendingMessages.length} messages from banned chip ${message.chip.name} to other campaign chips`)

        // Mark current message as failed
        await db.message.update({
          where: { id: message.id },
          data: { status: 'failed', error: `Chip banido: ${banCheck.reason} — mensagens redirecionadas para outro chip da campanha` },
        })

        // Notify campaign about the ban
        await db.campaign.update({
          where: { id: campaignId },
          data: { statusReason: `Chip ${message.chip.name} foi banido — ${pendingMessages.length} mensagens redirecionadas para outros chips da campanha` },
        })

        const remaining = await db.message.count({ where: { campaignId, status: 'pending' } })
        return { processed: false, delayMs: 2000, remaining, completed: remaining === 0, reason: `banned_reassigned_${message.chip.name}`, events: [{ type: 'chip_banned', chipName: message.chip.name }] }
      }

      // No other campaign chips available — pause the campaign and notify
      console.debug(`[SendingEngine] No other campaign chips available for banned chip ${message.chip.name} — pausing campaign`)

      await db.message.update({
        where: { id: message.id },
        data: { status: 'failed', error: `Chip banido: ${banCheck.reason} — nenhum outro chip na campanha` },
      })

      // Pause the campaign — no other chips in this campaign to send
      await db.campaign.update({
        where: { id: campaignId },
        data: {
          status: 'paused',
          statusReason: `Pausada automaticamente: chip ${message.chip.name} foi banido e não há outros chips disponíveis na campanha`,
          pausedAt: new Date(),
          nextSendAt: null,
        },
      })
      console.debug(`[SendingEngine] Campaign ${campaignId} PAUSED — chip ${message.chip.name} banned, no other campaign chips available`)
      return { processed: false, delayMs: 0, remaining: -1, completed: false, reason: 'auto_paused_banned_no_campaign_chips', events: [{ type: 'chip_banned', chipName: message.chip.name }, { type: 'campaign_auto_paused', reason: 'Chip banido e não há outros chips disponíveis' }] }
    }
  }

  // CHECK FOR WHATSAPP WARNINGS — stopOnWarning
  if (antiBanEnabled && settings.stopOnWarning) {
    const hasWarning = await checkForWarnings(message.chip.id, settings)
    if (hasWarning) {
      // Release the claimed message back to pending before pausing
      await db.message.update({ where: { id: message.id }, data: { status: 'pending' } })
      // Pause the campaign — a warning was detected
      await db.campaign.update({
        where: { id: campaignId },
        data: {
          status: 'paused',
          statusReason: 'Campanha pausada automaticamente — aviso de spam detectado pelo WhatsApp. Retome com cautela.',
          pausedAt: new Date(),
          nextSendAt: null,
        },
      })
      console.debug(`[SendingEngine] Campaign ${campaignId} PAUSED — WhatsApp warning detected for chip ${message.chip.name}`)
      return {
        processed: false,
        delayMs: 0,
        remaining: -1,
        completed: false,
        reason: 'whatsapp_warning_detected',
        events: [{ type: 'campaign_auto_paused', reason: 'Aviso de spam detectado pelo WhatsApp' }],
      }
    }
  }

  // Reset daily counter if needed (timezone-aware)
  await resetDailyIfNeeded(message.chipId, settings.timezone)

  // AUTO-ADVANCE WARMING STAGE (fix for critical bug)
  if (antiBanEnabled && settings.warmingEnabled) {
    await advanceWarmingPhase(message.chipId, settings)
  }

  // Re-fetch chip after potential updates
  const chip = await db.chip.findUnique({ where: { id: message.chipId } })
  if (!chip) {
    await db.message.update({
      where: { id: message.id },
      data: { status: 'failed', error: 'Chip não encontrado' },
    })
    return { processed: true, delayMs: 1000, remaining: -1, completed: false }
  }

  // Reset hourly counter if needed
  if (antiBanEnabled) {
    await resetHourlyIfNeeded(chip.id)
  }

  // Re-fetch chip after hourly reset
  const chipAfterHourly = await db.chip.findUnique({ where: { id: message.chipId } })
  const currentChip = chipAfterHourly || chip

  // Check hourly limit — v5.0: Don't block campaign, release claim so other chips can send
  if (antiBanEnabled && settings.hourlyLimit > 0) {
    const hourlySent = currentChip.hourlySent ?? 0
    if (hourlySent >= settings.hourlyLimit) {
      console.debug(`[SendingEngine] Chip ${currentChip.name} hit hourly limit (${hourlySent}/${settings.hourlyLimit}) — releasing claim, other chips may continue`)
      // Release the message claim so it can be picked up by another chip later
      await releaseMessageAndChipLock(message.id, message.chipId, 'hourly_limit')
      return {
        processed: false,
        delayMs: 1000, // Short delay — process-all loop will try other chips
        remaining: -1,
        completed: false,
        reason: `hourly_limit_${currentChip.name}`,
      }
    }
  }

  // ============================================
  // CHECK CHIP nextSendAt — anti-ban interval persistence
  // ============================================
  // v5.0: With the new message selection query filtering for ready chips,
  // this check should rarely trigger (only due to race conditions where
  // the chip's nextSendAt changed between the query and this check).
  // When it does trigger, we release the message claim and return a
  // chip-specific reason — DON'T block the campaign.
  //
  // BUGFIX: Skip this check if the nextSendAt is our own temporary lock
  // (set at line ~2012). Previously, the code would set a 120s lock,
  // then re-fetch the chip from DB, find nextSendAt in the future,
  // and release the claim — creating an infinite loop.
  // Now we check if the nextSendAt matches our lock timestamp.
  if (antiBanEnabled && currentChip.nextSendAt) {
    const now = Date.now()
    const nextSendTime = new Date(currentChip.nextSendAt).getTime()
    // Skip check if this is our own temporary lock (within 1s tolerance)
    const isOurOwnLock = Math.abs(nextSendTime - chipLockTimestamp) < 1000
    if (nextSendTime > now && !isOurOwnLock) {
      const waitMs = nextSendTime - now
      const phase = currentChip.warmingPhase || 'nursery'
      console.debug(`[SendingEngine] Chip ${currentChip.name} (${phase}) nextSendAt not reached — releasing claim, other chips may continue (wait ${Math.round(waitMs/1000)}s)`)
      // Release the message claim so it can be picked up later when this chip is ready
      await releaseMessageAndChipLock(message.id, message.chipId, 'chip_interval_wait', chipLockTimestamp)
      return {
        processed: false,
        delayMs: 1000, // Short delay — process-all loop will try other chips
        remaining: -1,
        completed: false,
        reason: `chip_interval_wait_${currentChip.name}`,
      }
    }
  }

  // IN-MEMORY SEND GUARD: Even with DB nextSendAt, a race condition could allow
  // two concurrent ticks to both pass the DB check. This in-memory guard is the
  // last resort — if this chip sent a message less than 60s ago, block it.
  if (antiBanEnabled && isChipInMemoryCooling(message.chipId)) {
    const lastSend = chipLastSendMap.get(message.chipId) || 0
    const elapsed = Math.round((Date.now() - lastSend) / 1000)
    console.debug(`[SendingEngine] Chip ${currentChip.name} in-memory cooling (${elapsed}s since last send, minimum ${ABSOLUTE_MIN_INTERVAL_SEC}s) — releasing claim`)
    await releaseMessageAndChipLock(message.id, message.chipId, 'in_memory_cooling', chipLockTimestamp)
    return {
      processed: false,
      delayMs: 1000,
      remaining: -1,
      completed: false,
      reason: `chip_interval_wait_${currentChip.name}`,
    }
  }

  // Check daily limit (with warming mode multiplier)
  const effectiveLimit = getEffectiveDailyLimit(currentChip, settings, warmingMode)
  let atomicSentToday = currentChip.sentToday
  let dailyLimitExceeded = false
  // BUGFIX: Track whether we've incremented sentToday/hourlySent so we can rollback
  // if the send fails or we exit early. Previously, the increment happened twice
  // (once here as a "reservation", once after the send) — causing double counting.
  let sentTodayIncremented = false

  if (antiBanEnabled) {
    // CONDITIONAL ATOMIC INCREMENT: Only increment if sentToday < effectiveLimit.
    // This prevents the race condition where two concurrent processes both pass
    // the "sentToday >= effectiveLimit" check before either increments.
    try {
      const conditionalIncrement = await db.$executeRaw`
        UPDATE "Chip"
        SET "sentToday" = "sentToday" + 1, "hourlySent" = "hourlySent" + 1, "updatedAt" = NOW()
        WHERE id = ${currentChip.id} AND "sentToday" < ${effectiveLimit}
      `
      if (conditionalIncrement === 0) {
        dailyLimitExceeded = true
        console.debug(`[SendingEngine] Chip ${currentChip.name} hit daily limit CONDITIONALLY (${currentChip.sentToday}/${effectiveLimit}) — increment blocked`)
      } else {
        const chipAfterIncrement = await db.chip.findUnique({
          where: { id: currentChip.id },
          select: { sentToday: true },
        })
        atomicSentToday = chipAfterIncrement?.sentToday ?? currentChip.sentToday + 1
        sentTodayIncremented = true
      }
    } catch (atomicErr: any) {
      console.warn(`[SendingEngine] Conditional atomic increment failed (${atomicErr.message}), falling back to increment-then-check`)
      const chipAfterAtomicIncrement = await db.chip.update({
        where: { id: currentChip.id },
        data: {
          sentToday: { increment: 1 },
          hourlySent: { increment: 1 },
        },
      })
      atomicSentToday = chipAfterAtomicIncrement.sentToday
      sentTodayIncremented = true
      if (atomicSentToday > effectiveLimit) {
        dailyLimitExceeded = true
        sentTodayIncremented = false
        await db.chip.update({
          where: { id: currentChip.id },
          data: {
            sentToday: { decrement: 1 },
            hourlySent: { decrement: 1 },
          },
        })
        console.debug(`[SendingEngine] Chip ${currentChip.name} hit daily limit ATOMICALLY (${atomicSentToday - 1}/${effectiveLimit}) — reverting increment and reassigning`)
      }
    }
  } else {
    // BUGFIX: antiBan disabled — simple increment (previously this case was handled
    // by the second increment at line ~3175, which we removed to fix double counting)
    await db.$executeRaw`UPDATE "Chip" SET "sentToday" = "sentToday" + 1, "hourlySent" = "hourlySent" + 1, "updatedAt" = NOW() WHERE "id" = ${message.chipId}`
    sentTodayIncremented = true
  }

  if (dailyLimitExceeded) {
    console.debug(`[SendingEngine] Chip ${currentChip.name} hit daily limit (${currentChip.sentToday}/${effectiveLimit}) — reassigning messages to other chips`)

    // Find other connected chips that BELONG to this campaign (via CampaignChip)
    const otherChips = await db.chip.findMany({
      where: {
        id: { not: currentChip.id },
        status: 'connected',
        paused: false,
        evolutionInstance: { not: null },
        campaigns: { some: { campaignId } },
      },
    })

    if (otherChips.length > 0) {
      const pendingMessages = await db.message.findMany({
        where: { campaignId, chipId: currentChip.id, status: 'pending' },
        take: 50,
      })

      const availableChips = await getAvailableChipsForReassignment(campaignId, otherChips)
          for (let i = 0; i < pendingMessages.length; i++) {
        const targetChip = availableChips[i % availableChips.length]
        await db.message.update({
          where: { id: pendingMessages[i].id },
          data: { chipId: targetChip.id },
        })
      }
      console.debug(`[SendingEngine] Reassigned ${pendingMessages.length} messages from ${currentChip.name} to ${otherChips.length} other chips`)
    }

    // Release the claim on this message so it can be picked up by another chip
    await releaseMessageAndChipLock(message.id, message.chipId, 'daily_limit')
    return {
      processed: false,
      delayMs: 1000,
      remaining: -1,
      completed: false,
      reason: `daily_limit_${currentChip.name}`,
    }
  }

  // Check cooldown
  if (antiBanEnabled) {
    const cooldownCheck = await isInCooldown(message.chipId, settings)
    if (cooldownCheck.inCooldown) {
      // Calculate how long until cooldown expires
      const waitMs = cooldownCheck.cooldownUntil
        ? Math.max(cooldownCheck.cooldownUntil.getTime() - Date.now(), 60 * 1000)
        : settings.cooldownMinutes * 60 * 1000
      console.debug(`[SendingEngine] Chip ${currentChip.name} in cooldown — waiting ${Math.round(waitMs/1000)}s`)

      // HUMAN BEHAVIOR: Cooldown Presence — appear online briefly during cooldown
      // Instead of going 100% offline during cooldown, the chip occasionally
      // appears "available" for a few seconds, as if checking WhatsApp.
      // This uses the cooldownPresence config from the DB.
      if (settings.humanBehaviorEnabled && settings.humanBehaviorConfig.cooldownPresence.enabled) {
        const cp = settings.humanBehaviorConfig.cooldownPresence
        const intervalMin = cp.intervalMinMin
        const intervalMax = cp.intervalMaxMin
        // Only do cooldown presence if the wait is long enough (at least intervalMin minutes)
        if (waitMs >= intervalMin * 60 * 1000 && message.chip.evolutionInstance) {
          const phone = message.contact.phone
          const formattedPhone = formatPhoneNumber(phone)
          const jid = `${formattedPhone}@s.whatsapp.net`
          // Fire-and-forget: don't await, just trigger the presence
          performIdleReadingPresence(message.chip.evolutionInstance, jid, true, settings)
            .then(readingMs => {
              if (readingMs > 0) {
                console.debug(`[SendingEngine] Cooldown presence: ${readingMs}ms online for chip ${currentChip.name}`)
              }
            })
            .catch(() => { /* non-fatal */ })
        }
      }

      // v5.0: Don't block the campaign with campaign.nextSendAt during cooldown.
      // Release the message claim so other chips can pick it up or the process-all
      // loop can try other chips. The chip's cooldownUntil already prevents this
      // chip from being selected by the message query.
      await releaseMessageAndChipLock(message.id, message.chipId, 'send_error_recovery')
      // BUGFIX: Rollback the sentToday increment since we're not actually sending
      if (sentTodayIncremented) {
        try {
          await db.$executeRaw`UPDATE "Chip" SET "sentToday" = GREATEST("sentToday" - 1, 0), "hourlySent" = GREATEST("hourlySent" - 1, 0) WHERE "id" = ${message.chipId}`
          sentTodayIncremented = false
        } catch (rbErr: any) {
          console.error(`[SendingEngine] Failed to rollback sentToday (cooldown): ${rbErr.message}`)
        }
      }
      return {
        processed: false,
        delayMs: 1000, // Short delay — process-all loop will try other chips
        remaining: -1,
        completed: false,
        reason: `cooldown_${currentChip.name}`,
      }
    }
  }

  // ============================================================
  // DEDUPLICATION CHECK: Before sending, verify that no other message
  // for the same (campaignId, contactId, stepOrder) has already been
  // sent. This catches any residual duplicates that might exist from
  // before the unique constraint was added.
  // ============================================================
  if (message.campaignId) {
    const alreadySent = await db.message.findFirst({
      where: {
        campaignId: message.campaignId,
        contactId: message.contactId,
        stepOrder: message.stepOrder,
        status: { in: ['sent', 'delivered', 'read', 'sending'] },
        id: { not: message.id },  // Exclude this message itself
      },
      select: { id: true },
    })

    if (alreadySent) {
      // Another message for this contact+step was already sent — mark this as failed (duplicate)
      console.debug(`[SendingEngine] DUPLICATE DETECTED: Message ${message.id} for contact ${message.contactId} step ${message.stepOrder} — already sent as message ${alreadySent.id}. Marking as failed.`)
      await db.message.update({
        where: { id: message.id },
        data: { status: 'failed', error: 'Mensagem duplicada — já enviada em outro registro' },
      })
      // BUGFIX: Rollback the sentToday increment since we're not actually sending
      if (sentTodayIncremented) {
        try {
          await db.$executeRaw`UPDATE "Chip" SET "sentToday" = GREATEST("sentToday" - 1, 0), "hourlySent" = GREATEST("hourlySent" - 1, 0) WHERE "id" = ${message.chipId}`
          sentTodayIncremented = false
        } catch (rbErr: any) {
          console.error(`[SendingEngine] Failed to rollback sentToday (duplicate): ${rbErr.message}`)
        }
      }
      const remaining = await db.message.count({ where: { campaignId, status: 'pending' } })
      return { processed: true, delayMs: 1000, remaining, completed: remaining === 0 }
    }
  }

  // ============================================================
  // CRITICAL: Verify this message is still in 'sending' status (our claim from line ~1886)
  // The first atomic claim already set status from 'pending' → 'sending'.
  // Here we just verify it hasn't been reset by another process.
  // If count=0, the message was recovered/reset — skip it.
  // ============================================================
  const claimCheck = await db.message.findFirst({
    where: { id: message.id, status: 'sending' },
    select: { id: true },
  })

  if (!claimCheck) {
    // Message was recovered/reset by another process — skip it
    console.debug(`[SendingEngine] Message ${message.id} claim lost (no longer in 'sending'), skipping`)
    // BUGFIX: Rollback the sentToday increment since we're not actually sending
    if (sentTodayIncremented) {
      try {
        await db.$executeRaw`UPDATE "Chip" SET "sentToday" = GREATEST("sentToday" - 1, 0), "hourlySent" = GREATEST("hourlySent" - 1, 0) WHERE "id" = ${message.chipId}`
        sentTodayIncremented = false
      } catch (rbErr: any) {
        console.error(`[SendingEngine] Failed to rollback sentToday (claim lost): ${rbErr.message}`)
      }
    }
    return { processed: false, delayMs: 500, remaining: -1, completed: false, reason: 'message_claim_lost' }
  }

  try {
    const instanceName = chip.evolutionInstance!
    const formattedPhone = formatPhoneNumber(message.contact.phone)

    // ============================================
    // ANTI-BAN: REALISTIC PRESENCE SIMULATION
    // ============================================
    if (antiBanEnabled) {
      // ============================================
      // ANTI-BAN: PRESENCE — Signal "available" before sending
      // ============================================
      // Set presence to "available" so WhatsApp shows the chip as online
      // before we start composing. This mimics real user behavior:
      // user opens chat → appears online → starts typing
      const pc = getPresenceConfig(settings)
      try {
        await routerSetPresence(instanceName, `${formattedPhone}@s.whatsapp.net`, 'available', pc.preSendOnlineMs)
      } catch {
        // Non-fatal — presence is best-effort
      }
      // Brief pause to let "online" status register before composing starts (from UI config)
      await new Promise(resolve => setTimeout(resolve, gaussianRandom(
        (pc.preComposePauseMinMs + pc.preComposePauseMaxMs) / 2,
        (pc.preComposePauseMaxMs - pc.preComposePauseMinMs) / 4,
        pc.preComposePauseMinMs,
        pc.preComposePauseMaxMs
      )))

      // Determine presence type based on message content
      const hasMedia = !!(message.mediaUrl && message.mediatype)
      const validMediaTypes = ['image', 'document', 'video', 'audio']
      const isMediaType = hasMedia && validMediaTypes.includes(message.mediatype as string)
      const isAudio = message.mediatype === 'audio'

      if (isMediaType) {
        // Media messages: use "recording" presence (shows 📷/🎙️ indicator)
        // Duration from UI config for non-audio media
        const mediaDurationMs = isAudio
          ? calculateTypingDuration(message.content, settings)
          : randomInt(pc.mediaRecordingMinMs, pc.mediaRecordingMaxMs)

        console.debug(`[SendingEngine] Recording presence for ${mediaDurationMs}ms (${message.mediatype}) to ${formattedPhone}`)

        try {
          await routerSetPresence(instanceName, `${formattedPhone}@s.whatsapp.net`, 'recording', mediaDurationMs)
        } catch {
          // Non-fatal
        }

        await new Promise(resolve => setTimeout(resolve, mediaDurationMs))
      } else {
        // Text messages: use "composing" with mid-composition pauses
        // HUMANIZED TYPING: Instead of one continuous "digitando...",
        // we simulate stopping and restarting — like a real person who
        // pauses to think, then continues typing.
        const totalTypingMs = calculateTypingDuration(message.content, settings)
        const jid = `${formattedPhone}@s.whatsapp.net`

        // Decide if this message will have mid-composition pauses
        // Config from UI: longMsgThreshold, longMsgPauseChance, segments, pause durations
        const tc = getTypingConfig(settings)
        const shouldPauseMidType = message.content.length > tc.longMsgThreshold
          ? Math.random() < tc.longMsgPauseChance
          : Math.random() < tc.pauseChance * 0.67 // shorter msgs: 2/3 of normal pause chance

        if (shouldPauseMidType && totalTypingMs > settings.typingMinDelay) {
          // Split typing into segments with pauses between (config from UI)
          const segments = randomInt(tc.segmentsMin, tc.segmentsMax)
          const perSegment = Math.floor(totalTypingMs / segments)

          for (let seg = 0; seg < segments; seg++) {
            // Start composing
            try {
              await routerSetPresence(instanceName, `${formattedPhone}@s.whatsapp.net`, 'composing', perSegment)
            } catch {
              // Non-fatal — some evoGO versions may not support this endpoint
            }
            await new Promise(resolve => setTimeout(resolve, perSegment))

            // If not the last segment, pause (stop typing briefly)
            if (seg < segments - 1) {
              // "Unavailable" presence briefly — the "digitando..." stops
              const pauseMs = gaussianRandom(
                (tc.pauseMinMs + tc.pauseMaxMs) / 2,
                (tc.pauseMaxMs - tc.pauseMinMs) / 4,
                tc.pauseMinMs,
                tc.pauseMaxMs
              )
              try {
                await routerSetPresence(instanceName, `${formattedPhone}@s.whatsapp.net`, 'unavailable', pauseMs)
              } catch {
                // Non-fatal
              }
              await new Promise(resolve => setTimeout(resolve, pauseMs))
            }
          }

          console.debug(`[SendingEngine] Humanized typing (${segments} segments, total ${totalTypingMs}ms) for ${message.content.length} chars to ${formattedPhone}`)
        } else {
          // Single continuous typing session (simpler, for short messages)
          try {
            await routerSetPresence(instanceName, `${formattedPhone}@s.whatsapp.net`, 'composing', totalTypingMs)
          } catch {
            // Non-fatal — some evoGO versions may not support this endpoint
          }
          await new Promise(resolve => setTimeout(resolve, totalTypingMs))

          console.debug(`[SendingEngine] Typing for ${totalTypingMs}ms (${message.content.length} chars) to ${formattedPhone}`)
        }
      }
    }

    // ============================================
    // ANTI-BAN: TEXT CONTENT (no variation — removed randomLineBreaks/emojiVariation)
    // ============================================
    let finalContent = message.content

    // ============================================
    // SEND THE MESSAGE
    // ============================================
    // DIAGNOSTIC: Log what we're about to send (step, content preview, media info)
    console.debug(`[SendingEngine] Sending message ${message.id} step=${message.stepOrder} to ${formattedPhone} via chip ${chip.evolutionInstance}: mediaUrl=${message.mediaUrl || 'null'} mediatype=${message.mediatype || 'null'} content="${finalContent.substring(0, 80)}..."`)

    let result
    if (message.mediaUrl && message.mediatype) {
      const validMediaTypes = ['image', 'document', 'video', 'audio']
      const mt = message.mediatype as 'image' | 'document' | 'video' | 'audio'
      if (validMediaTypes.includes(mt)) {
        // Validate media URL before sending — check if the URL is accessible
        try {
          const urlCheck = await fetch(message.mediaUrl, { method: 'HEAD', signal: AbortSignal.timeout(settings.mediaCheckTimeoutMs) })
          if (!urlCheck.ok) {
            console.debug(`[SendingEngine] Media URL check failed: ${urlCheck.status} for ${message.mediaUrl}`)
            await db.message.update({
              where: { id: message.id },
              data: { status: 'failed', error: `URL de mídia inacessível (HTTP ${urlCheck.status})` },
            })
            const remaining = await db.message.count({ where: { campaignId, status: 'pending' } })
            return { processed: true, delayMs: 1000, remaining, completed: remaining === 0 }
          }
        } catch (urlError: any) {
          // Timeout or network error — URL is not reachable
          console.debug(`[SendingEngine] Media URL check error: ${urlError.message} for ${message.mediaUrl}`)
          await db.message.update({
            where: { id: message.id },
            data: { status: 'failed', error: `URL de mídia inacessível: ${urlError.message}` },
          })
          const remaining = await db.message.count({ where: { campaignId, status: 'pending' } })
          return { processed: true, delayMs: 1000, remaining, completed: remaining === 0 }
        }

        const caption = mt === 'audio' ? '' : (finalContent || '')
        result = await routerSendMedia(instanceName, formattedPhone, message.mediaUrl, mt, {
          caption,
          delay: 0, // We already handled delay via presence simulation
        })
      } else {
        // Text message for invalid mediatype fallback — linkPreview from settings
        result = await routerSendText(instanceName, formattedPhone, finalContent, {
          delay: 0,
          linkPreview: settings.linkPreviewEnabled,
        })
      }
    } else {
      // ANTI-BAN: Link preview control — reads from AntiBanSettings.
      // Default OFF — link previews generate additional network requests (OG scraping)
      // that can be detected as automated behavior. Real users rarely send links
      // with previews in bulk messages. Can be enabled per-campaign if needed.
      result = await routerSendText(instanceName, formattedPhone, finalContent, {
        delay: 0,
        linkPreview: settings.linkPreviewEnabled,
      })
    }

    // Update message status
    await db.message.update({
      where: { id: message.id },
      data: {
        status: 'sent',
        sentAt: new Date(),
        evolutionMessageId: result.key?.id || null,
      },
    })

    // CRITICAL FIX: Garantir que todos os steps subsequentes do mesmo contato
    // usem o MESMO chip que enviou esta mensagem. Sem isso, quando um chip
    // desconecta e suas mensagens são redistribuídas, o step 2 pode acabar
    // sendo enviado por um chip diferente do step 1 — violando a regra de que
    // o mesmo chip deve enviar todas as mensagens para o mesmo contato.
    if (message.stepOrder === 1) {
      await db.message.updateMany({
        where: {
          campaignId,
          contactId: message.contactId,
          stepOrder: { gt: message.stepOrder },
          status: 'pending',
        },
        data: { chipId: message.chipId },
      }).catch(() => { /* non-critical — best effort */ })
    }

    // IN-MEMORY SEND GUARD: Mark this chip as having sent a message just now.
    // This prevents race conditions where concurrent ticks could send two messages
    // from the same chip within seconds of each other.
    markChipSent(message.chipId)

    // ============================================
    // INBOX: Create InboxMessage so campaign messages appear in inbox
    // ============================================
    try {
      const remoteJid = `${formattedPhone}@s.whatsapp.net`
      const evolutionMsgId = result.key?.id || null
      // Skip if already exists (e.g., webhook already created it)
      if (evolutionMsgId) {
        const existing = await db.inboxMessage.findUnique({ where: { evolutionMsgId } }).catch(() => null)
        if (!existing) {
          await db.inboxMessage.create({
            data: {
              instanceName: chip.evolutionInstance || '',
              chipId: chip.id,
              remoteJid,
              remotePhone: formattedPhone,
              fromMe: true,
              messageContent: finalContent || '',
              messageType: message.mediatype || 'text',
              mediaUrl: message.mediaUrl || null,
              contactName: message.contact?.name || null,
              evolutionMsgId,
              isRead: true,
              isGroup: false,
              isCampaign: true,
              ack: 1,
              status: 'sent',
              createdAt: new Date(),
            },
          })
        }
      }
      // Upsert conversation so it appears in the conversation list
      await db.conversation.upsert({
        where: { chipId_remoteJid: { chipId: chip.id, remoteJid } },
        create: {
          chipId: chip.id,
          remoteJid,
          remotePhone: formattedPhone,
          contactName: message.contact?.name || formattedPhone,
          lastMessagePreview: (finalContent || '').substring(0, 200),
          lastMessageAt: new Date(),
          lastMessageType: message.mediatype || 'text',
          lastMessageFromMe: true,
          lastMessageStatus: 'sent',
        },
        update: {
          lastMessagePreview: (finalContent || '').substring(0, 200),
          lastMessageAt: new Date(),
          lastMessageType: message.mediatype || 'text',
          lastMessageFromMe: true,
          lastMessageStatus: 'sent',
        },
      }).catch(() => { /* non-critical */ })

      // SSE broadcast so inbox updates in real-time when campaign message is sent
      try {
        const { broadcastToChip } = await import('@/app/api/inbox/events/route')
        broadcastToChip(chip.id, 'new_message', {
          remoteJid,
          fromMe: true,
          messageType: message.mediatype || 'text',
          messageContent: (finalContent || '').substring(0, 200),
          pushName: chip.profileName || chip.name,
          contactName: message.contact?.name || formattedPhone,
          isGroup: false,
          isCampaign: true,
          timestamp: Date.now(),
        })
      } catch { /* SSE broadcast is non-critical */ }
    } catch (inboxErr: any) {
      console.debug(`[SendingEngine] InboxMessage creation skipped: ${inboxErr.message}`)
    }

    // ============================================
    // STEP FOLLOW-UP PRE-CHECK (before anti-ban behaviors)
    // ============================================
    // Check if this message has a follow-up step with a short delay.
    // If so, skip anti-ban behaviors (delayed offline, idle reading, cooldown)
    // that would add extra delay between step 1 and step 2.
    // This is checked BEFORE the anti-ban behaviors so we can skip them.
    // The result is also used later for the step follow-up override.
    let stepFollowUpDelayMs: number | null = null
    let hasShortStepFollowUp = false
    try {
      const nextStep = await db.message.findFirst({
        where: { campaignId, contactId: message.contactId, stepOrder: message.stepOrder + 1, status: 'pending' },
        select: { id: true, stepOrder: true },
      })
      if (nextStep) {
        const stepConfig = await db.sequenceStep.findFirst({
          where: { campaignId, stepOrder: nextStep.stepOrder },
          select: { delayMinutes: true, delayUnit: true },
        })
        if (stepConfig && stepConfig.delayMinutes > 0) {
          stepFollowUpDelayMs = (stepConfig.delayUnit === 'seconds' ? stepConfig.delayMinutes : stepConfig.delayMinutes * 60) * 1000
          if (stepFollowUpDelayMs <= 30_000) {
            hasShortStepFollowUp = true
            console.debug(`[SendingEngine] Step follow-up detected: ${Math.round(stepFollowUpDelayMs/1000)}s delay before step ${nextStep.stepOrder} for contact ${message.contactId} — skipping anti-ban delays between steps`)
          }
        }
      }
    } catch (stepErr: any) { console.error(`[SendingEngine] Step follow-up pre-check failed: ${stepErr.message}`) }

    // ============================================
    // ANTI-BAN: DELAYED OFFLINE with jitter
    // ============================================
    // After the message is sent, the human doesn't go offline instantly.
    // They stay online for a while (reading reply, checking other chats),
    // THEN close WhatsApp. This delay+jitter makes the pattern natural.
    //
    // OLD: setPresence('unavailable', 0) — instant offline (bot signature)
    // NEW: stay online 3-15s (gaussian) → then go offline
    //
    // SKIP for step follow-ups with short delay — the "human-like" offline
    // delay between step 1 and step 2 would violate the configured step delay.
    let offlineDelayMs = 0
    if (antiBanEnabled && !hasShortStepFollowUp) {
      const jid = `${formattedPhone}@s.whatsapp.net`
      offlineDelayMs = await delayedOfflineWithJitter(instanceName, jid, settings)
      console.debug(`[SendingEngine] Delayed offline: stayed online ${offlineDelayMs}ms after send — human-like`)
    }

    // ============================================
    // ANTI-BAN: IDLE "READING" PRESENCE
    // ============================================
    // During the interval between messages, there's a chance the chip
    // briefly appears online as if reading incoming messages.
    // This only happens when the interval is long enough (>= 60s)
    // and with configured probability (25%).
    // The reading time is SUBTRACTED from the next delay so the total
    // interval stays consistent with the configured settings.
    //
    // SKIP for step follow-ups with short delay — reading presence between
    // step 1 and step 2 adds unnecessary delay and is not human-like
    // (a human sending a follow-up doesn't stop to read other chats first).
    let readingTimeMs = 0
    if (antiBanEnabled && !hasShortStepFollowUp) {
      // ANTI-BAN SAFETY: UI settings are the minimum safety floor.
      // Campaign can go SLOWER (higher) but never FASTER (lower) than UI settings.
      const intervalMin = Math.max(campaignIntervalMin ?? 0, settings.messageIntervalMin)
      const intervalMax = Math.max(campaignIntervalMax ?? 0, settings.messageIntervalMax)
      const avgInterval = (intervalMin + intervalMax) / 2
      const pc = getPresenceConfig(settings)
      if (avgInterval >= pc.idleReadingMinIntervalSec) {
        readingTimeMs = await performIdleReadingPresence(instanceName, `${formattedPhone}@s.whatsapp.net`, false, settings)
        if (readingTimeMs > 0) {
          console.debug(`[SendingEngine] Idle reading presence: ${readingTimeMs}ms — simulates checking WhatsApp between sends`)
        }
      }
    }

    // BUGFIX: sentToday and hourlySent were already incremented earlier (line ~2653)
    // as a "reservation" before the send. We do NOT increment again here — that was
    // a duplicate-counting bug. Only update lastSeen and warmingStartedAt.
    await db.chip.update({
      where: { id: message.chipId },
      data: {
        lastSeen: new Date(),
        ...(currentChip.warmingStartedAt ? {} : { warmingStartedAt: new Date() }),
      },
    })

    // ============================================
    // POST-SEND: Check if chip hit cooldown threshold
    // ============================================
    // Only trigger cooldown HERE (after a message is actually sent), not in isInCooldown.
    // This prevents the re-trigger bug where sentToday % cooldownAfterMessages === 0
    // would re-enter cooldown every time isInCooldown was called after cooldown expired.
    //
    // Variable cooldown: random between cooldownMinutes and cooldownMinutesMax
    // Variable threshold: random between cooldownAfterMessages and cooldownAfterMessagesMax
    // ANTI-BAN: Use gaussian distribution for cooldown durations — humans don't have
    // uniformly random rest periods; moderate durations are more natural.
    // SKIP cooldown for step follow-ups with short delay — don't enter cooldown
    // between step 1 and step 2. The cooldown will be checked again after step 2.
    if (antiBanEnabled && !hasShortStepFollowUp && settings.cooldownAfterMessages > 0 && settings.cooldownMinutes > 0) {
      const chipAfterSend = await db.chip.findUnique({ where: { id: message.chipId } })
      if (chipAfterSend && chipAfterSend.sentToday > 0) {
        // Variable threshold: gaussian-distributed around midpoint
        const thresholdMin = settings.cooldownAfterMessages
        const thresholdMax = Math.max(settings.cooldownAfterMessagesMax, settings.cooldownAfterMessages)
        const threshold = gaussianRandom(
          Math.round((thresholdMin + thresholdMax) / 2),
          (thresholdMax - thresholdMin) / 6,
          thresholdMin,
          thresholdMax
        )

        if (chipAfterSend.sentToday % threshold === 0) {
          // HUMAN BEHAVIOR: Non-linear pauses — weighted random tier selection
          // instead of uniform gaussian distribution. Produces more natural
          // distribution with short/medium/long pause tiers.
          // Falls back to gaussian if human behavior is disabled.
          let cooldownDuration: number
          const nonlinearMinutes = getNonlinearPauseMinutes(settings)
          if (nonlinearMinutes !== null) {
            cooldownDuration = Math.round(nonlinearMinutes)
          } else {
            // Variable cooldown duration: gaussian-distributed (original behavior)
            const cooldownMin = settings.cooldownMinutes
            const cooldownMax = Math.max(settings.cooldownMinutesMax, settings.cooldownMinutes)
            cooldownDuration = gaussianRandom(
              Math.round((cooldownMin + cooldownMax) / 2),
              (cooldownMax - cooldownMin) / 6,
              cooldownMin,
              cooldownMax
            )
          }

          const cooldownUntil = new Date(Date.now() + cooldownDuration * 60 * 1000)
          await db.chip.update({
            where: { id: message.chipId },
            data: { cooldownUntil },
          })
          console.debug(`[SendingEngine] Chip ${chipAfterSend.name} entering cooldown after ${chipAfterSend.sentToday} messages (threshold: ${threshold}, duration: ${cooldownDuration}min) — cooldown until ${cooldownUntil.toISOString()}`)
        }
      }
    }

    console.debug(`[SendingEngine] Sent message ${message.id} to ${formattedPhone} via ${instanceName}`)

    // ============================================
    // CALCULATE NEXT MESSAGE DELAY + PERSIST nextSendAt
    // ============================================
    // The interval is how long to wait BEFORE processing the next message.
    // Use campaign-specific interval if available, otherwise global settings.
    // Apply warming mode multiplier to the interval.
    // ANTI-BAN: Use GAUSSIAN distribution for delays — mimics human behavior
    // where moderate intervals are most common and extreme values are rare.
    // Uniform random is a known bot signature.
    //
    // IMPORTANT: The interval is the WAIT time between messages.
    // Humanization (offline delay, idle reading) is ADDITIONAL behavior that
    // makes the chip appear more human — it does NOT replace the configured interval.
    // Previously, we subtracted alreadySpentMs from the delay, which collapsed
    // intervals to as low as 5s. Now the interval is respected as-is.
    // ANTI-BAN SAFETY: UI settings are the minimum safety floor.
    // Campaign can go SLOWER (higher) but never FASTER (lower) than UI settings.
    const intervalMin = Math.max(campaignIntervalMin ?? 0, settings.messageIntervalMin)
    const intervalMax = Math.max(campaignIntervalMax ?? 0, settings.messageIntervalMax)
    let nextDelay: number

    // HUMAN BEHAVIOR: Cluster Sending — burst-like sending pattern
    // Instead of always using the full gaussian interval between messages,
    // send a few messages with short micro-pauses (cluster burst),
    // then take a longer after-cluster pause before the next burst.
    // Falls back to normal gaussian interval if cluster is disabled.
    //
    // CRITICAL: Track whether the delay came from a cluster MICRO-pause
    // (within a burst) vs an after-cluster pause. Micro-pauses are
    // intentionally shorter than normal intervals but must still be safe
    // (10-30s range) to avoid WhatsApp spam detection.
    let isClusterMicroPause = false
    const clusterResult = getClusterDelaySeconds(campaignId, message.chipId, settings)
    if (clusterResult !== null) {
      nextDelay = clusterResult.delaySec * 1000
      isClusterMicroPause = clusterResult.isMicroPause
    } else {
      nextDelay = gaussianDelaySeconds(intervalMin, intervalMax) * 1000
    }

    // ============================================
    // INTERVAL FLOOR — messageIntervalMin is the absolute minimum
    // ============================================
    // BUGFIX: Previously, cluster micro-pauses had a lower floor (50% of intervalMin,
    // minimum 30s), which allowed gaps as short as 2-7 seconds between messages from
    // the same chip. WhatsApp detects rapid-fire sending as automated behavior.
    // Now, messageIntervalMin (default 59s) is the ABSOLUTE minimum for ALL delay types.
    // Cluster "burst" patterns still work — the variation comes from the gaussian
    // distribution within [intervalMin, intervalMax], not from sub-minimum delays.
    // The after-cluster pause naturally provides longer pauses that balance the pattern.
    const ABSOLUTE_MIN_INTERVAL_MS = 60_000 // 60 seconds — never send faster than this
    nextDelay = Math.max(nextDelay, ABSOLUTE_MIN_INTERVAL_MS)

    // ALWAYS enforce messageIntervalMin as the floor — no exceptions for cluster micro-pauses
    nextDelay = Math.max(nextDelay, settings.messageIntervalMin * 1000)

    const modeMultiplier = WARMING_MODE_MULTIPLIERS[warmingMode]
    if (modeMultiplier && antiBanEnabled) {
      nextDelay = Math.round(nextDelay * modeMultiplier.intervalMultiplier)
    }

    // HUMAN BEHAVIOR: Day Rhythm — time-of-day multiplier
    // Humans send at different speeds depending on the time of day.
    // Morning is slower, midday is faster, afternoon is normal.
    // Applied AFTER all other interval calculations.
    if (antiBanEnabled && settings.humanBehaviorEnabled && settings.humanBehaviorConfig.dayRhythm.enabled) {
      const rhythmMultiplier = getDayRhythmMultiplier(settings)
      nextDelay = Math.round(nextDelay * rhythmMultiplier)
    }

    // ============================================
    // DELIVERY RATE AUTO-ADJUST
    // ============================================
    // If the chip's delivery rate is dropping, slow down automatically.
    // This prevents Meta from flagging the chip as spam when recipients
    // aren't engaging (which signals "unwanted messages").
    //
    // All thresholds and multipliers come from UI/DB via deliveryRate config.
    if (antiBanEnabled) {
      try {
        const drc = getDeliveryRateConfig(settings)
        // If user disabled delivery rate auto-adjust in UI, skip entirely.
        if (!drc.enabled) {
          // No-op — keep current speed
        } else {
        const recentMessages = await db.message.findMany({
          where: {
            chipId: currentChip.id,
            status: { in: ['sent', 'delivered', 'read'] },
            sentAt: { not: null },
          },
          orderBy: { sentAt: 'desc' },
          take: drc.minSample * 5, // Fetch more for statistical relevance, calculate on minSample
          select: { status: true },
        })

        if (recentMessages.length >= drc.minSample) {
          const sample = recentMessages.slice(0, drc.minSample)
          // BUGFIX: Consider 'sent' as delivered when calculating delivery rate.
          // The Evolution API webhook does not always update message status to
          // 'delivered' (ack=2 receipts are not consistently processed). Without
          // counting 'sent', the delivery rate always reads as 0% and triggers
          // the critical 4x slowdown multiplier on every message — even when
          // messages are actually being delivered.
          // WhatsApp only returns HTTP 200 (which sets status='sent') when the
          // message has been accepted by the server, so 'sent' is a reliable
          // signal that the message reached WhatsApp's infrastructure.
          const delivered = sample.filter(m =>
            m.status === 'sent' || m.status === 'delivered' || m.status === 'read'
          ).length
          const deliveryRate = (delivered / sample.length) * 100

          let deliveryMultiplier = 1.0
          if (deliveryRate < drc.lowThreshold) {
            deliveryMultiplier = drc.criticalMultiplier
          } else if (deliveryRate < drc.mediumThreshold) {
            deliveryMultiplier = drc.lowMultiplier
          } else if (deliveryRate < drc.normalThreshold) {
            deliveryMultiplier = drc.mediumMultiplier
          }

          if (deliveryMultiplier > 1.0) {
            nextDelay = Math.round(nextDelay * deliveryMultiplier)
            console.warn(`[SendingEngine] Delivery rate ${deliveryRate.toFixed(0)}% — slowing down ${deliveryMultiplier}x for chip ${currentChip.name}`)
          }
        }
        } // end if (drc.enabled)
      } catch (deliveryErr: any) {
        // Non-critical — if this fails, just use normal speed
        console.error(`[SendingEngine] Delivery rate check failed: ${deliveryErr.message}`)
      }
    }

    // ============================================
    // ENFORCE PHASE MINIMUM INTERVAL
    // ============================================
    // For nursery/prewarm chips, the interval must be at least the phase minimum.
    // This safety floor applies even to cluster micro-pauses for warming chips —
    // new chips should NEVER send too fast, even in bursts.
    //
    // BUGFIX: Always enforce the phase floor for ALL chips and ALL delay types.
    // No chip should ever send faster than its minimum interval, regardless of phase.
    // Previously, ready chips with cluster micro-pauses could skip this floor,
    // resulting in gaps as short as 2-7 seconds between messages.
    if (antiBanEnabled) {
      const effectiveMinInterval = getMinimumIntervalForChip(currentChip, settings)
      const minIntervalMs = effectiveMinInterval * 1000
      const chipPhase = currentChip.warmingPhase || 'ready'

      if (nextDelay < minIntervalMs) {
        console.debug(`[SendingEngine] Chip ${currentChip.name} (${chipPhase}): bumping delay from ${Math.round(nextDelay/1000)}s to minimum ${Math.round(minIntervalMs/1000)}s`)
        nextDelay = minIntervalMs
      }
    }

    // ============================================
    // STEP FOLLOW-UP OVERRIDE
    // If this message has a follow-up step with a configured delay shorter
    // than the anti-ban calculated nextDelay, override to respect the step delay.
    // This ensures "4 seconds after step 1" actually means 4 seconds, not 60s.
    //
    // CRITICAL: When this override is active, we also:
    // 1. Clear the in-memory send guard so step 2 can be sent after the short delay
    // 2. Set chip.nextSendAt relative to when the message was actually SENT (not now),
    //    so anti-ban processing time doesn't add to the step delay
    // ============================================
    if (stepFollowUpDelayMs !== null && stepFollowUpDelayMs < nextDelay) {
      console.debug(`[SendingEngine] Step follow-up override: reducing delay from ${Math.round(nextDelay/1000)}s to ${Math.round(stepFollowUpDelayMs/1000)}s for next step of contact ${message.contactId}`)
      nextDelay = stepFollowUpDelayMs
      // Clear in-memory guard so step 2 can be sent after the short delay
      chipLastSendMap.delete(message.chipId)
    }

    // ============================================
    // PERSIST nextSendAt ON CHIP ONLY (v5.0 parallel)
    // ============================================
    // v5.0: Only persist chip.nextSendAt — each chip has its own independent interval.
    // Campaign.nextSendAt is NOT set here because other chips in the same campaign
    // should be able to send independently. The process-all loop handles calling
    // processNextMessage again for other ready chips in this campaign.
    const chipNextSendAt = new Date(Date.now() + nextDelay)

    // Persist chip nextSendAt — this chip cannot send again until this time
    await db.chip.update({
      where: { id: message.chipId },
      data: { nextSendAt: chipNextSendAt },
    })

    console.debug(`[SendingEngine] Next delay: ${Math.round(nextDelay/1000)}s — chip ${currentChip.name} nextSendAt=${chipNextSendAt.toISOString()} (other chips can send independently)`)

    const remaining = await db.message.count({ where: { campaignId, status: 'pending' } })

    return { processed: true, delayMs: nextDelay, remaining, completed: remaining === 0 }

  } catch (error: any) {
    console.error(`[SendingEngine] Failed to send message ${message.id}:`, error.message)

    // BUGFIX: Rollback the sentToday/hourlySent increment since the send failed.
    // The increment was done earlier (line ~2653) as a "reservation" — if the send
    // fails, we must release that reservation to avoid inflating the count.
    if (sentTodayIncremented) {
      try {
        await db.$executeRaw`UPDATE "Chip" SET "sentToday" = GREATEST("sentToday" - 1, 0), "hourlySent" = GREATEST("hourlySent" - 1, 0) WHERE "id" = ${message.chipId}`
        console.debug(`[SendingEngine] Rolled back sentToday increment for chip ${message.chipId} due to send failure`)
      } catch (rollbackErr: any) {
        console.error(`[SendingEngine] Failed to rollback sentToday for chip ${message.chipId}:`, rollbackErr.message)
      }
    }

    // ============================================
    // BAN DETECTION FROM SEND ERRORS
    // ============================================
    // CRITICAL: Evolution API V3 can return HTTP 403 for TWO different reasons:
    //   1) Instance token is stale/invalid → NOT a ban, just an auth issue
    //      (the evolutionFetch function auto-retries with token refresh)
    //   2) WhatsApp actually banned the account → IS a ban
    //
    // The Evolution API error format is: "Evolution Go API error (403): <body>"
    // The WhatsApp ban code 403 comes via the Disconnected webhook with data.Code=403.
    //
    // If the auto-retry in evolutionFetch already handled the stale token case,
    // we should NOT get here for auth issues — only for real WhatsApp bans.
    // But we still check carefully to avoid false positives.
    const BAN_CODES = settings.banCodes
    const errorMsg = error.message || ''
    const isEvolutionAPIError = errorMsg.startsWith('Evolution Go API error')
    const matchedCode = BAN_CODES.find(code => errorMsg.includes(`(${code})`))

    // Only treat as ban if:
    //   - It's an Evolution API error with a ban code
    //   - AND the error body mentions WhatsApp-specific ban indicators
    //   - OR the auto-retry already failed (meaning it's not just a stale token)
    const banIndicators = ['ban', 'blocked', 'removed', 'logged out', 'desconectado', 'session ended']
    const isBanFromSendError = isEvolutionAPIError && matchedCode && (
      banIndicators.some(ind => errorMsg.toLowerCase().includes(ind)) ||
      !errorMsg.includes('apikey') // If it mentions apikey, it's an auth issue, not a ban
    )

    if (isBanFromSendError) {
      console.warn(`[SendingEngine] BAN DETECTED from send error for chip ${message.chip.name}: ${errorMsg.substring(0, 200)}`)

      // Mark chip as banned immediately
      await db.chip.update({
        where: { id: message.chipId },
        data: {
          status: 'banned',
          disconnectionReasonCode: parseInt(errorMsg.match(/\((\d{3})\)/)?.[1] || '403'),
        },
      })

      // Mark message as failed with ban reason
      await db.message.update({
        where: { id: message.id },
        data: {
          status: 'failed',
          error: `Chip banido durante envio: ${errorMsg.substring(0, 300)}`,
        },
      })

      // Try to reassign pending messages to other connected chips in this campaign
      const otherChips = await db.chip.findMany({
        where: {
          id: { not: message.chipId },
          status: 'connected',
          paused: false,
          campaigns: { some: { campaignId } },
        },
      })

      if (otherChips.length > 0) {
        // Reassign pending messages (round-robin)
        const pendingMessages = await db.message.findMany({
          where: { campaignId, chipId: message.chipId, status: 'pending' },
          take: 50,
        })
        const availableChips = await getAvailableChipsForReassignment(campaignId, otherChips)
          for (let i = 0; i < pendingMessages.length; i++) {
          const targetChip = availableChips[i % availableChips.length]
          await db.message.update({
            where: { id: pendingMessages[i].id },
            data: { chipId: targetChip.id },
          })
        }
        console.debug(`[SendingEngine] Reassigned ${pendingMessages.length} pending messages from banned chip ${message.chip.name} to ${otherChips.length} other chips`)

        const remaining = await db.message.count({ where: { campaignId, status: 'pending' } })
        return {
          processed: true,
          delayMs: settings.messageIntervalMin * 1000,
          remaining,
          completed: remaining === 0,
          reason: `banned_reassigned_${message.chip.name}`,
          events: [{ type: 'chip_banned' }],
        }
      } else {
        // No other chips — auto-pause campaign
        await db.campaign.update({
          where: { id: campaignId },
          data: {
            status: 'paused',
            statusReason: `Pausada automaticamente: chip ${message.chip.name} banido durante envio (código 403), sem outros chips disponíveis`,
            pausedAt: new Date(),
            nextSendAt: null,
          },
        })
        console.warn(`[SendingEngine] Campaign ${campaignId} auto-paused: chip ${message.chip.name} banned, no other chips available`)

        const remaining = await db.message.count({ where: { campaignId, status: 'pending' } })
        return {
          processed: true,
          delayMs: 0,
          remaining,
          completed: remaining === 0,
          reason: 'auto_paused_banned_no_campaign_chips',
          events: [{ type: 'chip_banned' }, { type: 'campaign_auto_paused' }],
        }
      }
    }

    // ============================================
    // CIRCUIT BREAKER: Erro 463 — pausa chip por 2h e redistribui
    // ============================================
    // O erro 463 indica que o WhatsApp está recusando entregas para
    // destinatários específicos através deste chip (provável shadowban
    // ou degradação de reputação). Em vez de continuar enviando e
    // acumular falhas, o circuit breaker:
    //   1. Pausa o chip por 2 horas (auto-retoma via autoUnpauseExpiredChips)
    //   2. Redistribui mensagens pendentes para outros chips da campanha
    //   3. Marca a mensagem atual como failed
    if (errorMsg.includes('463')) {
      console.warn(`[CircuitBreaker] Erro 463 detectado para chip ${message.chip.name} — ativando circuit breaker (2h pause + redistribute)`)

      const CIRCUIT_BREAKER_PAUSE_MS = 2 * 60 * 60 * 1000 // 2 horas
      const pausedUntil = new Date(Date.now() + CIRCUIT_BREAKER_PAUSE_MS)

      // 1. Pausar o chip por 2 horas
      await db.chip.update({
        where: { id: message.chipId },
        data: {
          paused: true,
          pausedAt: new Date(),
          pausedUntil,
          pauseReason: `Circuit breaker: erro 463 (WhatsApp recusou entrega) — pausado por 2h, auto-retoma em ${pausedUntil.toISOString()}`,
        },
      })

      // 2. Encontrar outros chips conectados e não pausados nesta campanha
      const otherChips = await db.chip.findMany({
        where: {
          id: { not: message.chipId },
          status: 'connected',
          paused: false,
          evolutionInstance: { not: null },
          campaigns: { some: { campaignId } },
        },
      })

      if (otherChips.length > 0) {
        // Redistribuir mensagens pendentes (incluindo a atual) para outros chips
        // Marcar a mensagem atual como pending (não failed) para que seja reenviada
        await db.message.update({
          where: { id: message.id },
          data: { status: 'pending', error: null, sentAt: null },
        })

        const pendingMessages = await db.message.findMany({
          where: { campaignId, chipId: message.chipId, status: 'pending' },
          take: 100,
        })

        const availableChips = await getAvailableChipsForReassignment(campaignId, otherChips)
        // CRITICAL FIX: Agrupar por contato — todos os steps do mesmo contato
        // devem ir para o MESMO chip novo.
        const contactGroups = new Map<string, typeof pendingMessages>()
        for (const m of pendingMessages) {
          if (!contactGroups.has(m.contactId)) contactGroups.set(m.contactId, [])
          contactGroups.get(m.contactId)!.push(m)
        }
        let groupIdx = 0
        for (const [, msgs] of contactGroups) {
          const targetChip = availableChips[groupIdx % availableChips.length]
          groupIdx++
          for (const m of msgs) {
            await db.message.update({
              where: { id: m.id },
              data: { chipId: targetChip.id },
            })
          }
        }

        console.warn(`[CircuitBreaker] Chip ${message.chip.name} pausado por 2h. ${pendingMessages.length} mensagens redistribuídas para ${otherChips.length} outros chips da campanha`)

        // Notificar campanha
        await db.campaign.update({
          where: { id: campaignId },
          data: {
            statusReason: `Circuit breaker 463: chip ${message.chip.name} pausado por 2h — ${pendingMessages.length} mensagens redirecionadas para outros chips`,
          },
        })

        const remaining = await db.message.count({ where: { campaignId, status: 'pending' } })
        return {
          processed: true,
          delayMs: 1000,
          remaining,
          completed: remaining === 0,
          reason: `circuit_breaker_463_${message.chip.name}`,
          events: [{ type: 'chip_circuit_breaker', chipName: message.chip.name }],
        }
      } else {
        // Nenhum outro chip disponível — marcar como failed e pausar campanha
        await db.message.update({
          where: { id: message.id },
          data: {
            status: 'failed',
            error: `Circuit breaker 463: chip pausado por 2h, nenhum outro chip disponível para redirecionar`,
          },
        })

        await db.campaign.update({
          where: { id: campaignId },
          data: {
            status: 'paused',
            statusReason: `Circuit breaker 463: chip ${message.chip.name} pausado por 2h — sem outros chips disponíveis, campanha pausada`,
            pausedAt: new Date(),
            nextSendAt: null,
          },
        })

        console.warn(`[CircuitBreaker] Chip ${message.chip.name} pausado por 2h. Nenhum outro chip disponível — campanha pausada`)

        const remaining = await db.message.count({ where: { campaignId, status: 'pending' } })
        return {
          processed: true,
          delayMs: 0,
          remaining,
          completed: remaining === 0,
          reason: 'circuit_breaker_463_no_chips',
          events: [{ type: 'chip_circuit_breaker' }, { type: 'campaign_auto_paused' }],
        }
      }
    }

    // ============================================
    // GENERIC ERROR HANDLING (non-ban errors)
    // ============================================
    await db.message.update({
      where: { id: message.id },
      data: {
        status: 'failed',
        error: errorMsg.substring(0, 500),
      },
    })

    // v5.0: Don't block the campaign with nextSendAt on error.
    // Other chips can still send. The failed message is already marked.
    const errorRetryDelayMs = settings.messageIntervalMin * 1000

    const remaining = await db.message.count({ where: { campaignId, status: 'pending' } })
    return { processed: true, delayMs: errorRetryDelayMs, remaining, completed: remaining === 0 }
  }
}

/**
 * Legacy function kept for backwards compatibility.
 */
export async function processCampaign(campaignId: string): Promise<{
  processed: number
  succeeded: number
  failed: number
  skipped: number
}> {
  const result = await processNextMessage(campaignId, undefined)
  return {
    processed: result.processed ? 1 : 0,
    succeeded: result.processed ? 1 : 0,
    failed: 0,
    skipped: 0,
  }
}
