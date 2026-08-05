// Anti-Ban logic — warming limit calculation, daily limit calculation,
// chip ban detection, temp ban detection from inbox, warning detection.
//
// All functions here are pure (no in-memory state) — they read from DB
// and return values. Mutating operations are limited to status updates
// when a ban is detected (marking the chip as 'banned' in the DB).

import { db } from '../db'
import type { Chip } from '@prisma/client'
import { WARMING_MODE_MULTIPLIERS } from '../constants'
import { getConnectionState as routerGetConnectionState } from '../evolution-router'
import { type AntiBanConfig, DEFAULT_SETTINGS } from './helpers'

// ============================================================
// ANTI-BAN LOGIC
// ============================================================

/**
 * Get the warming limit for a chip based on its current phase and day.
 * Uses the DB-loaded warming schedules (nursery + prewarm).
 */
export function getWarmingLimitForDay(
  phase: string,
  day: number,
  settings: AntiBanConfig
): number {
  const schedule = phase === 'nursery' ? settings.nurserySchedule : settings.prewarmSchedule
  for (const entry of schedule) {
    if (day >= entry.days[0] && day <= entry.days[1]) {
      return entry.limit
    }
  }
  // Beyond schedule: return the max limit from the last entry, or a safe default if schedule is empty
  if (schedule.length === 0) {
    return phase === 'nursery' ? 10 : 200
  }
  return schedule[schedule.length - 1].limit
}

/**
 * Calculate minimum seconds between messages for a chip based on its phase.
 * 
 * IMPORTANT: The daily limit is already enforced separately (check daily limit below).
 * This function only sets a MINIMUM floor interval to prevent sending too fast.
 * It does NOT spread messages evenly across the window — that made intervals way too long.
 * 
 * Nursery chips: minimum 2 minutes between messages (safety floor)
 * Prewarm chips: minimum 1 minute between messages (safety floor)
 * Ready/Aquecido chips: use normal interval from settings (30-90s)
 */
type ChipWarmingInfo = Pick<Chip, 'warmingPhase' | 'warmingEnabled' | 'dailyLimit' | 'createdAt' | 'prewarmStartedAt'>

export function getMinimumIntervalForChip(
  chip: ChipWarmingInfo,
  settings: AntiBanConfig
): number {
  const phase = chip.warmingPhase || 'nursery'

  if (phase === 'ready') {
    // Ready/aquecido: ALWAYS return the user's configured minimum interval.
    // This is critical — ready chips must respect the UI settings.
    return settings.messageIntervalMin
  }

  // For nursery/prewarm: if warming is disabled on the chip or in settings,
  // still return the user's minimum interval as a safety floor.
  if (!chip.warmingEnabled || !settings.warmingEnabled) {
    return settings.messageIntervalMin
  }

  // The daily limit already controls HOW MANY messages can be sent per day.
  // This minimum interval is just a safety floor to prevent burst sending.
  // Use the user's configured interval, but with a minimum floor for warming chips.
  const userInterval = settings.messageIntervalMin

  if (phase === 'nursery') {
    // Nursery: minimum interval from settings (default: 120 seconds) — but respect user interval if higher
    return Math.max(settings.nurseryMinIntervalSec, userInterval)
  } else {
    // Prewarm: minimum interval from settings (default: 60 seconds) — but respect user interval if higher
    return Math.max(settings.prewarmMinIntervalSec, userInterval)
  }
}

type ChipLimitInfo = Pick<Chip, 'dailyLimit' | 'warmingEnabled' | 'warmingStage' | 'warmingPhase' | 'warmingStartedAt' | 'prewarmStartedAt' | 'createdAt'>

export function getEffectiveDailyLimit(
  chip: ChipLimitInfo,
  settings: AntiBanConfig,
  warmingMode?: string
): number {
  if (!chip.warmingEnabled || !settings.warmingEnabled) {
    return chip.dailyLimit || settings.dailyLimitPerChip
  }

  // New two-phase warming logic
  const phase = chip.warmingPhase || 'nursery'
  
  if (phase === 'ready') {
    // Phase 3: Aquecido — use readyDailyLimit from settings (editable)
    let limit = settings.readyDailyLimit || chip.dailyLimit || settings.dailyLimitPerChip
    const modeMultiplier = WARMING_MODE_MULTIPLIERS[warmingMode || 'normal']
    if (modeMultiplier) {
      limit = Math.round(limit * modeMultiplier.limitMultiplier)
    }
    return limit
  }

  // Calculate current day within the phase
  // KEY: If warmingStartedAt is null (chip never sent), fall back to createdAt
  // Previously: null = always Day 1, which meant old chips that never sent were
  // stuck on Day 1 limits forever. Now: null = use createdAt as a reasonable baseline,
  // so a chip created 10 days ago starts at Day 10 limits (not Day 1).
  let dayInPhase = 1
  const now = new Date()
  const warmingStart = chip.warmingStartedAt ? new Date(chip.warmingStartedAt) : chip.createdAt ? new Date(chip.createdAt) : null

  if (!warmingStart) {
    dayInPhase = 1
  } else {
    // BUGFIX: Use warmingStartedAt for ALL phases (nursery + prewarm), matching the frontend.
    // Previously, prewarm used prewarmStartedAt which could be NULL or recent,
    // causing the backend to calculate day 1-2 while the frontend calculated day 38.
    // This mismatch made the backend block at limit 20 while the UI showed 150.
    //
    // BUGFIX 2: Use Brasilia timezone (America/Sao_Paulo) for day calculation,
    // matching the frontend. Previously used UTC which could be off by 1 day
    // near midnight Brasilia time (UTC-3).
    const spFormatter = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'America/Sao_Paulo' })
    const nowStr = spFormatter.format(now)
    const startStr = spFormatter.format(warmingStart)
    const [nm, nd, ny] = nowStr.split('/').map(Number)
    const [sm, sd, sy] = startStr.split('/').map(Number)
    const nowDate = new Date(ny, nm - 1, nd)
    const startDate = new Date(sy, sm - 1, sd)
    dayInPhase = Math.max(1, Math.floor((nowDate.getTime() - startDate.getTime()) / (86400000)) + 1)
  }
  
  dayInPhase = Math.max(1, dayInPhase)
  
  let limit = getWarmingLimitForDay(phase, dayInPhase, settings)
  limit = Math.min(limit, chip.dailyLimit || settings.dailyLimitPerChip)

  // Apply warming mode multiplier
  const modeMultiplier = WARMING_MODE_MULTIPLIERS[warmingMode || 'normal']
  if (modeMultiplier) {
    limit = Math.round(limit * modeMultiplier.limitMultiplier)
  }

  return limit
}

/**
 * Detect if a chip might be banned by checking its connection state.
 * If the chip is disconnected or has a disconnection reason, it may be banned.
 * Returns true if the chip appears to be banned/disconnected.
 */
type ChipBanInfo = Pick<Chip, 'id' | 'evolutionInstance' | 'status' | 'disconnectionReasonCode'>

export async function detectChipBan(chip: ChipBanInfo, settings: AntiBanConfig = DEFAULT_SETTINGS): Promise<{ banned: boolean; reason: string; disconnected: boolean; tempBan?: boolean }> {
  // Ban codes from settings (UI-configurable)
  const BAN_CODES = settings.banCodes

  // Check chip status first (fast)
  // IMPORTANT: "disconnected" is NOT the same as "banned"!
  // A chip that's disconnected might just need reconnection — don't block the campaign entirely.
  if (chip.status === 'banned') {
    return { banned: true, reason: `Chip status: banned`, disconnected: false }
  }

  if (chip.status === 'disconnected') {
    // Chip is disconnected — check if it's actually a temp ban (Meta doesn't always send ban codes)
    // Check inbox for WhatsApp restriction messages before assuming simple disconnection
    const tempBanDetected = await detectTempBanFromInbox(chip.id, chip.evolutionInstance, settings)
    if (tempBanDetected) {
      console.warn(`[SendingEngine] Chip ${chip.evolutionInstance} is disconnected but has WhatsApp restriction message — treating as temp ban`)
      // Update chip status to banned in DB so we don't try to reconnect
      await db.chip.update({
        where: { id: chip.id },
        data: { status: 'banned' },
      }).catch(() => {})
      return { banned: true, reason: 'WhatsApp: conta restrita (ban temporário) — detectado por mensagem de aviso no inbox', disconnected: false, tempBan: true }
    }
    // No restriction message found — treat as simple disconnection
    return { banned: false, reason: `Chip status: disconnected`, disconnected: true }
  }

  // Check disconnection reason code
  // Ban codes loaded from DB settings (default: 401, 403, 428, 440)
  if (chip.disconnectionReasonCode && BAN_CODES.includes(chip.disconnectionReasonCode)) {
    return { banned: true, reason: `Disconnection code: ${chip.disconnectionReasonCode}`, disconnected: false }
  }

  // Try to get live connection state from Evolution API
  if (chip.evolutionInstance) {
    try {
      const state = await routerGetConnectionState(chip.evolutionInstance)
      const instanceState = state?.state
      if (instanceState === 'close') {
        // 'close' can mean temporary disconnection OR temp ban OR permanent ban
        // Check for ban code first (using settings from DB)
        if (chip.disconnectionReasonCode && BAN_CODES.includes(chip.disconnectionReasonCode)) {
          return { banned: true, reason: `Evolution API state: close (ban code: ${chip.disconnectionReasonCode})`, disconnected: false }
        }
        // No ban code — but Meta's temp bans often don't come with codes!
        // Check inbox for WhatsApp restriction messages ("conta está restringida", "spam", etc.)
        const tempBanDetected = await detectTempBanFromInbox(chip.id, chip.evolutionInstance, settings)
        if (tempBanDetected) {
          console.warn(`[SendingEngine] Chip ${chip.evolutionInstance} has state:close + WhatsApp restriction message — treating as temp ban`)
          // Update chip status to banned so we don't try to reconnect (which could make it worse)
          await db.chip.update({
            where: { id: chip.id },
            data: { status: 'banned' },
          }).catch(() => {})
          return { banned: true, reason: 'WhatsApp: conta restrita (ban temporário) — detectado por mensagem de aviso no inbox', disconnected: false, tempBan: true }
        }
        // No ban code AND no restriction message — treat as temporary disconnection
        return { banned: false, reason: 'Evolution API reports connection state: close (no ban code)', disconnected: true }
      }
    } catch {
      // If we can't reach Evolution API, don't assume ban — could be network issue
      console.debug(`[SendingEngine] Could not check connection state for ${chip.evolutionInstance}`)
    }
  }

  return { banned: false, reason: '', disconnected: false }
}

/**
 * Detect temporary WhatsApp bans by checking the chip's inbox for
 * Meta's restriction messages. WhatsApp sends "Sua conta está restringida"
 * messages when imposing temp bans, but these don't always come with
 * a disconnection code in the Evolution API webhook.
 *
 * This is critical because:
 * - Meta's temp bans often disconnect the chip WITHOUT a ban code
 * - If we try to auto-reconnect a temp-banned chip, Meta may escalate to permanent ban
 * - The only reliable signal is the restriction message in the inbox
 */
async function detectTempBanFromInbox(chipId: string, instanceName: string | null, settings: AntiBanConfig = DEFAULT_SETTINGS): Promise<boolean> {
  if (!instanceName) return false
  try {
    // Look for WhatsApp restriction messages in the last N hours (UI-configurable)
    // These come from WhatsApp's official JIDs
    const WHATSAPP_OFFICIAL_JIDS = [
      'status@broadcast',
      'server@whatsapp.com',
      'system@broadcast',
    ]
    // Restriction keywords loaded from DB settings (UI-configurable)
    const RESTRICTION_KEYWORDS = settings.restrictionKeywords
    // Ban lookback window and check limits from settings
    const lookbackMs = settings.banLookbackHours * 3600000

    // Check messages from WhatsApp official JIDs
    const officialWarnings = await db.inboxMessage.findMany({
      where: {
        instanceName,
        fromMe: false,
        remoteJid: { in: WHATSAPP_OFFICIAL_JIDS },
        createdAt: { gte: new Date(Date.now() - lookbackMs) },
      },
      take: settings.warningMaxMessagesCheck,
      orderBy: { createdAt: 'desc' },
    })

    for (const msg of officialWarnings) {
      const content = (msg.messageContent || '').toLowerCase()
      if (RESTRICTION_KEYWORDS.some(kw => content.includes(kw))) {
        console.warn(`[SendingEngine] Temp ban detected via official WhatsApp message: "${msg.messageContent?.substring(0, 80)}..."`)
        return true
      }
    }

    // Also check ALL recent messages for restriction keywords (broader net)
    // WhatsApp sometimes sends restriction notices from unexpected JIDs
    const recentMessages = await db.inboxMessage.findMany({
      where: {
        instanceName,
        fromMe: false,
        isCampaign: false, // Exclude our own campaign messages
        createdAt: { gte: new Date(Date.now() - lookbackMs) },
      },
      take: settings.banMaxMessagesCheck,
      orderBy: { createdAt: 'desc' },
    })

    for (const msg of recentMessages) {
      const content = (msg.messageContent || '').toLowerCase()
      // Only match if multiple keywords appear together (reduce false positives)
      // Threshold is UI-configurable (default: 2)
      const matchCount = RESTRICTION_KEYWORDS.filter(kw => content.includes(kw)).length
      if (matchCount >= settings.banKeywordThreshold) {
        console.warn(`[SendingEngine] Temp ban detected via inbox message (${matchCount} keyword matches): "${msg.messageContent?.substring(0, 80)}..."`)
        return true
      }
    }

    return false
  } catch (err: any) {
    console.error(`[SendingEngine] Error checking inbox for temp ban: ${err.message}`)
    return false // Don't assume ban on error
  }
}

/**
 * Check for WhatsApp warning messages in the inbox.
 * WhatsApp sends warning messages from specific JIDs when an account is at risk.
 */
export async function checkForWarnings(chipId: string, settings: AntiBanConfig = DEFAULT_SETTINGS): Promise<boolean> {
  try {
    const chip = await db.chip.findUnique({ where: { id: chipId } })
    if (!chip?.evolutionInstance) return false

    // Check for recent warning messages from WhatsApp
    // WhatsApp official JIDs: status@broadcast, server@whatsapp.com
    const WARNING_SENDERS = ['status@broadcast', 'server@whatsapp.com']
    // Warning keywords loaded from DB settings (UI-configurable)
    const WARNING_KEYWORDS = settings.warningKeywords
    // Ban lookback window from settings
    const lookbackMs = settings.banLookbackHours * 3600000

    const recentWarnings = await db.inboxMessage.findMany({
      where: {
        instanceName: chip.evolutionInstance,
        fromMe: false,
        remoteJid: { in: WARNING_SENDERS },
        createdAt: { gte: new Date(Date.now() - lookbackMs) },
      },
      take: settings.warningMaxMessagesCheck,
    })

    for (const msg of recentWarnings) {
      const content = (msg.messageContent || '').toLowerCase()
      if (WARNING_KEYWORDS.some(kw => content.includes(kw))) {
        console.debug(`[SendingEngine] WARNING detected for chip ${chip.name}: ${msg.messageContent?.substring(0, 100)}`)
        return true
      }
    }
  } catch {
    // Non-critical — don't block sending
  }
  return false
}
