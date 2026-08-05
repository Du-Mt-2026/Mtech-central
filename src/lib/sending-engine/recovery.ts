// Recovery & cron-entry helpers — recover stuck "sending" messages,
// release stale campaign slots, auto-unpause expired chips, and list
// running campaigns for the process-all cron.

import { db } from '../db'

/**
 * Recover stuck "sending" messages — messages that were marked as "sending"
 * but never completed (server crash, timeout, etc.). Resets them to "pending"
 * so they can be reprocessed. Should be called before processing.
 */
export async function recoverStuckMessages(campaignId?: string): Promise<number> {
  try {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)

    const where: Record<string, unknown> = {
      status: 'sending',
      updatedAt: { lt: tenMinutesAgo },
    }
    if (campaignId) where.campaignId = campaignId

    const result = await db.message.updateMany({
      where,
      data: { status: 'pending' },
    })

    if (result.count > 0) {
      console.debug(`[SendingEngine] Recovered ${result.count} stuck "sending" messages${campaignId ? ` for campaign ${campaignId}` : ''}`)
    }

    return result.count
  } catch (error: any) {
    console.error('[SendingEngine] Error recovering stuck messages:', error.message)
    return 0
  }
}

/**
 * Release orphaned campaign nextSendAt values.
 *
 * v5.0: With parallel chip sending, campaign.nextSendAt is only used for
 * campaign-level state (sending window, break windows, no_ready_chip throttle).
 * However, if a process sets campaign.nextSendAt and then crashes, the campaign
 * could be stuck with nextSendAt far in the future.
 *
 * This function finds campaign nextSendAt values that have been in the past
 * for more than SLOT_STALE_THRESHOLD_MS and resets them to null.
 *
 * Threshold: 10 minutes — generous enough to allow for break windows, but
 * short enough to prevent campaigns from getting stuck.
 */
const SLOT_STALE_THRESHOLD_MS = 10 * 60 * 1000 // 10 minutes

export async function releaseStaleCampaignSlots(): Promise<number> {
  try {
    const staleThreshold = new Date(Date.now() - SLOT_STALE_THRESHOLD_MS)

    // Find campaigns with nextSendAt in the past by more than the threshold
    // (meaning the slot was claimed a long time ago and never released)
    const result = await db.campaign.updateMany({
      where: {
        status: 'running',
        nextSendAt: { lt: staleThreshold },
      },
      data: { nextSendAt: null },
    })

    if (result.count > 0) {
      console.warn(`[SendingEngine] Released ${result.count} stale campaign slots (held for >${Math.round(SLOT_STALE_THRESHOLD_MS / 60000)}min)`)
    }

    return result.count
  } catch (error: any) {
    console.error('[SendingEngine] Error releasing stale campaign slots:', error.message)
    return 0
  }
}

/**
 * Get all running campaigns that need processing.
 * Also recovers any stuck "sending" messages and releases stale slots.
 */
export async function getRunningCampaigns(): Promise<string[]> {
  // CIRCUIT BREAKER: Auto-unpause chips whose pausedUntil has expired
  // (e.g. chips paused by the 463 circuit breaker for 2 hours)
  try {
    await autoUnpauseExpiredChips()
  } catch { /* non-critical */ }

  // Recover stuck messages across all running campaigns (best-effort)
  try {
    await recoverStuckMessages()
  } catch { /* non-critical */ }

  // H5 FIX: Release orphaned campaign slots that have been stuck for too long
  try {
    await releaseStaleCampaignSlots()
  } catch { /* non-critical */ }

  const campaigns = await db.campaign.findMany({
    where: { status: 'running' },
    select: { id: true },
  })
  return campaigns.map(c => c.id)
}

/**
 * CIRCUIT BREAKER — Auto-unpause chips whose pausedUntil has expired.
 *
 * When the 463 circuit breaker pauses a chip, it sets pausedUntil = now + 2h.
 * This function runs on every cron tick and unpauses chips when that time
 * has passed, allowing them to resume sending automatically.
 *
 * Manual pauses (pausedUntil = null) are NOT affected — they require
 * explicit user action to resume.
 */
async function autoUnpauseExpiredChips(): Promise<void> {
  const result = await db.chip.updateMany({
    where: {
      paused: true,
      pausedUntil: { not: null, lt: new Date() },
    },
    data: {
      paused: false,
      pausedAt: null,
      pausedUntil: null,
      pauseReason: null,
    },
  })
  if (result.count > 0) {
    console.log(`[CircuitBreaker] Auto-unpaused ${result.count} chip(s) whose pause period expired`)
  }
}
