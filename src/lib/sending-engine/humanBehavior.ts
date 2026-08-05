// Human behavior simulation — typing duration, cluster sending, day-rhythm
// multipliers, nonlinear pauses, idle reading presence, delayed offline,
// break-window reading presence.
//
// WHY: WhatsApp's anti-spam detects bots by their metronome-like timing.
// This module produces gaussian-distributed delays, burst-like cluster
// patterns, and presence signals that mimic real human usage.

import { db } from '../db'
import {
  setPresence as routerSetPresence,
  formatPhoneNumber,
} from '../evolution-router'
import { DEFAULT_HUMAN_BEHAVIOR } from '../constants'
import {
  type AntiBanConfig,
  DEFAULT_SETTINGS,
  getTypingConfig,
  getPresenceConfig,
  getAntiBanSettings,
  getActiveBreakWindow,
  randomInt,
  randomFloat,
  gaussianRandom,
  gaussianRandomFloat,
  gaussianDelaySeconds,
  TYPING_MIN_MS,
  TYPING_MAX_MS,
  clusterStateMap,
  evictClusterCacheIfNeeded,
} from './helpers'

/**
 * Calculate realistic typing duration based on message length.
 * Uses GAUSSIAN distribution for typing speed — most people type at
 * average speed, very few type extremely fast or slow.
 *
 * Features:
 * - Gaussian typing speed (mean 10 chars/s, stddev 2.5)
 * - 30% chance of a "thinking pause" (1-4 seconds)
 * - Short messages get minimum from UI settings (typingMinDelay)
 * - Long messages cap at UI settings (typingMaxDelay)
 *
 * IMPORTANT: All bounds come from AntiBanSettings (UI-configurable).
 * If no settings are passed, falls back to hardcoded constants for safety.
 */
export function calculateTypingDuration(text: string, settings?: AntiBanConfig): number {
  const charCount = text.length
  const tc = getTypingConfig(settings ?? DEFAULT_SETTINGS)
  // Gaussian typing speed: most people type at average speed
  // with standard deviation based on config
  const meanSpeed = (tc.speedMin + tc.speedMax) / 2
  const stddev = (tc.speedMax - tc.speedMin) / 4
  const typingSpeed = gaussianRandomFloat(meanSpeed, stddev, tc.speedMin, tc.speedMax)
  let durationMs = (charCount / typingSpeed) * 1000

  // Clamp to DYNAMIC bounds from UI settings (not hardcoded constants)
  const minMs = settings?.typingMinDelay ?? TYPING_MIN_MS
  const maxMs = settings?.typingMaxDelay ?? TYPING_MAX_MS
  durationMs = Math.max(minMs, Math.min(maxMs, durationMs))

  // Thinking pause (chance and duration from UI config)
  if (Math.random() < tc.pauseChance) {
    durationMs += randomInt(tc.pauseMinMs, tc.pauseMaxMs)
  }

  return Math.round(durationMs)
}

/**
 * Get the day-rhythm multiplier for the current time.
 * Humans send at different speeds depending on time of day:
 *   Morning (9-12h):  slower (1.3x = more interval)
 *   Midday (12-14h):  faster (0.8x = less interval)
 *   Afternoon (14-17h): normal (1.0x)
 *   Outside these:    conservative (use morning factor)
 *
 * All values come from settings.humanBehaviorConfig.dayRhythm.
 */
export function getDayRhythmMultiplier(settings: AntiBanConfig): number {
  if (!settings.humanBehaviorEnabled) return 1
  const dayRhythm = settings.humanBehaviorConfig.dayRhythm
  if (!dayRhythm.enabled) return 1

  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    timeZone: settings.timezone,
  })
  const hourStr = formatter.format(now)
  // Parse hour (formatter may return "9 AM" or "9" depending on locale)
  const hour = parseInt(hourStr, 10)
  if (isNaN(hour)) return 1

  if (hour >= 9 && hour < 12) {
    return dayRhythm.morningFactor / 100
  } else if (hour >= 12 && hour < 14) {
    return dayRhythm.middayFactor / 100
  } else if (hour >= 14 && hour < 17) {
    return dayRhythm.afternoonFactor / 100
  } else {
    // Outside 9-17h: use morning factor (conservative = slower)
    return dayRhythm.morningFactor / 100
  }
}

/**
 * Calculate the delay for the next message using cluster sending logic.
 * Returns the delay in seconds.
 *
 * In a cluster (burst): short micro-pauses between messages (3-8s)
 * After cluster: longer pause (30-90s) before the next cluster
 *
 * All values come from settings.humanBehaviorConfig.cluster.
 */
export function getClusterDelaySeconds(
  campaignId: string,
  chipId: string,
  settings: AntiBanConfig
): { delaySec: number; isMicroPause: boolean } | null {
  if (!settings.humanBehaviorEnabled) return null
  const cluster = settings.humanBehaviorConfig.cluster
  if (!cluster.enabled) return null

  const key = `${campaignId}:${chipId}`

  // C4/C5 FIX: Evict old entries before adding new ones
  evictClusterCacheIfNeeded()

  let state = clusterStateMap.get(key)

  if (!state || !state.inCluster) {
    // Start a new cluster
    const targetSize = randomInt(cluster.minSize, cluster.maxSize)
    state = { count: 0, inCluster: true, targetSize }
    clusterStateMap.set(key, state)
  }

  state.count++

  if (state.count < state.targetSize) {
    // Still in cluster — use micro-pause
    const delaySec = gaussianDelaySeconds(cluster.microPauseMinSec, cluster.microPauseMaxSec)
    return { delaySec, isMicroPause: true }
  } else {
    // Cluster complete — use after-cluster pause, then reset
    const delaySec = gaussianDelaySeconds(cluster.afterClusterPauseMinSec, cluster.afterClusterPauseMaxSec)
    // Reset cluster state — next call will start a fresh cluster
    clusterStateMap.delete(key)
    return { delaySec, isMicroPause: false }
  }
}

/**
 * Calculate cooldown duration using non-linear pause tiers.
 * Instead of uniform random between min-max, uses weighted random
 * selection between short/medium/long pause tiers.
 *
 * This produces a more natural distribution where:
 *   - Short pauses are common (quick breaks)
 *   - Medium pauses are common (lunch, etc.)
 *   - Long pauses are less common (extended breaks)
 *
 * All values come from settings.humanBehaviorConfig.nonlinearPauses.
 */
export function getNonlinearPauseMinutes(settings: AntiBanConfig): number | null {
  if (!settings.humanBehaviorEnabled) return null
  const nlPauses = settings.humanBehaviorConfig.nonlinearPauses
  if (!nlPauses.enabled) return null

  const tiers = [
    { weight: nlPauses.short.weight, minMin: nlPauses.short.minMin, maxMin: nlPauses.short.maxMin },
    { weight: nlPauses.medium.weight, minMin: nlPauses.medium.minMin, maxMin: nlPauses.medium.maxMin },
    { weight: nlPauses.long.weight, minMin: nlPauses.long.minMin, maxMin: nlPauses.long.maxMin },
  ]

  const totalWeight = tiers.reduce((sum, t) => sum + t.weight, 0)
  if (totalWeight <= 0) return null

  // Weighted random selection
  let roll = Math.random() * totalWeight
  let selectedTier = tiers[0]
  for (const tier of tiers) {
    roll -= tier.weight
    if (roll <= 0) {
      selectedTier = tier
      break
    }
  }

  // Random duration within the selected tier's range
  return randomFloat(selectedTier.minMin, selectedTier.maxMin)
}

// ============================================================
// PRESENCE HUMANIZATION FUNCTIONS
// ============================================================

/**
 * Perform an idle "reading" presence — chip briefly appears online
 * as if reading incoming messages, then goes back offline.
 *
 * WHY: A chip that is never online between sends looks like a bot.
 * Real humans occasionally open WhatsApp, read messages, then close it.
 * This function simulates that behavior during idle periods.
 *
 * WHEN this is called:
 *   - Between sends when the interval is long enough (>= 60s)
 *   - During cooldown periods
 *   - NOT during break windows (separate mechanism handles that)
 *
 * HUMAN BEHAVIOR: When humanBehaviorEnabled + cooldownPresence.enabled,
 * uses dynamic values from DB for chance, duration, and interval.
 * Falls back to hardcoded constants when human behavior is disabled.
 *
 * @param instanceName Evolution API instance name
 * @param jid WhatsApp JID to signal presence to (contact)
 * @param isCooldown Whether this is during a cooldown period (uses different chance/config)
 * @param settings AntiBanConfig for reading human behavior settings
 * @returns Duration spent "reading" in ms (0 if skipped)
 */
export async function performIdleReadingPresence(
  instanceName: string,
  jid: string,
  isCooldown: boolean = false,
  settings?: AntiBanConfig
): Promise<number> {
  // Determine chance and duration based on context and human behavior settings
  let chance: number
  let durationMinMs: number
  let durationMaxMs: number

  if (isCooldown && settings?.humanBehaviorEnabled && settings.humanBehaviorConfig.cooldownPresence.enabled) {
    // Use cooldown presence config from DB — dynamic, user-configurable
    const cp = settings.humanBehaviorConfig.cooldownPresence
    chance = cp.chancePercent / 100
    durationMinMs = cp.durationMinSec * 1000
    durationMaxMs = cp.durationMaxSec * 1000
  } else {
    // Use presence config from UI (or fallback constants)
    const pc = getPresenceConfig(settings ?? DEFAULT_SETTINGS)
    // For cooldown context, use cooldownPresence default from config (not hardcoded constant)
    const cooldownDefaultChance = DEFAULT_HUMAN_BEHAVIOR.cooldownPresence.chancePercent / 100
    chance = isCooldown ? cooldownDefaultChance : pc.idleReadingChance
    durationMinMs = pc.idleReadingDurationMinMs
    durationMaxMs = pc.idleReadingDurationMaxMs
  }

  // Only do idle reading with configured probability
  if (Math.random() > chance) return 0

  // Gaussian duration for "reading" — most people read for a moderate time
  const readingMs = gaussianRandom(
    (durationMinMs + durationMaxMs) / 2,
    (durationMaxMs - durationMinMs) / 6,
    durationMinMs,
    durationMaxMs
  )

  try {
    // Signal "available" — appears online
    await routerSetPresence(instanceName, jid, 'available', readingMs)
    // Stay "online" for the reading duration
    await new Promise(resolve => setTimeout(resolve, readingMs))
    // Go back offline — human closes WhatsApp after reading
    await routerSetPresence(instanceName, jid, 'unavailable', 0)
  } catch {
    // Non-fatal — presence is best-effort
  }

  return readingMs
}

/**
 * Delayed offline with jitter — human doesn't go offline instantly.
 *
 * After sending a message, a real human typically:
 * 1. Waits a bit (maybe reading the reply, checking other chats)
 * 2. Then closes WhatsApp (goes offline)
 *
 * Without this, the pattern "send → immediately offline" is detectable.
 * With this, the pattern is "send → stay online 3-15s → offline" which is natural.
 *
 * @param instanceName Evolution API instance name
 * @param jid WhatsApp JID
 * @returns Total delay in ms (including the "online" time before going offline)
 */
export async function delayedOfflineWithJitter(
  instanceName: string,
  jid: string,
  settings?: AntiBanConfig
): Promise<number> {
  // Gaussian delay before going offline — reads from UI config
  const pc = getPresenceConfig(settings ?? DEFAULT_SETTINGS)
  const delayMs = gaussianRandom(
    (pc.offlineDelayMinMs + pc.offlineDelayMaxMs) / 2,
    (pc.offlineDelayMaxMs - pc.offlineDelayMinMs) / 6,
    pc.offlineDelayMinMs,
    pc.offlineDelayMaxMs
  )

  // During the delay, the chip stays "available" (online) — simulates reading/chatting
  // No need to set available again, it's already online from the send flow
  await new Promise(resolve => setTimeout(resolve, delayMs))

  // Now go offline
  try {
    await routerSetPresence(instanceName, jid, 'unavailable', 0)
  } catch {
    // Non-fatal
  }

  return delayMs
}

// ============================================================
// BREAK WINDOW PRESENCE — Simulate "reading" during breaks
// ============================================================

/**
 * During break windows (lunch, meeting, etc.), randomly make chips
 * appear online briefly as if they're checking WhatsApp during their break.
 * This is called from the process-all cron when we detect we're in a break window.
 *
 * WHY: A chip that is offline 100% of the time during lunch break looks
 * suspicious — real humans check their phones during lunch. This simulates
 * that behavior without sending any messages.
 *
 * @returns Number of chips that performed reading presence
 */
export async function performBreakWindowReadingPresence(): Promise<number> {
  const settings = await getAntiBanSettings()

  // Check if we're in a break window right now
  const activeBreak = getActiveBreakWindow(settings)
  if (!activeBreak) return 0

  // Only do reading presence — chance from UI config
  const breakSettings = await getAntiBanSettings()
  const breakPc = getPresenceConfig(breakSettings)
  if (Math.random() > (breakPc.idleReadingChance)) return 0

  // Find all connected chips (excluding paused ones — they shouldn't appear online)
  const connectedChips = await db.chip.findMany({
    where: {
      status: 'connected',
      paused: false,
      evolutionInstance: { not: null },
    },
    select: { id: true, name: true, evolutionInstance: true },
  })

  let readingCount = 0
  for (const chip of connectedChips) {
    if (!chip.evolutionInstance) continue

    // Per-chip chance (30% — not all chips go online at the same time)
    if (Math.random() > 0.3) continue

    try {
      // Gaussian reading duration from UI config
      const readingMs = gaussianRandom(
        (breakPc.idleReadingDurationMinMs + breakPc.idleReadingDurationMaxMs) / 2,
        (breakPc.idleReadingDurationMaxMs - breakPc.idleReadingDurationMinMs) / 6,
        breakPc.idleReadingDurationMinMs,
        breakPc.idleReadingDurationMaxMs
      )

      // Use a generic JID — presence to a recent contact makes it more realistic
      // Find the most recent contact this chip messaged
      const recentMsg = await db.message.findFirst({
        where: { chipId: chip.id, status: { in: ['sent', 'delivered', 'read'] } },
        include: { contact: true },
        orderBy: { sentAt: 'desc' },
      })

      const jid = recentMsg?.contact?.phone
        ? `${formatPhoneNumber(recentMsg.contact.phone)}@s.whatsapp.net`
        : 'status@broadcast'  // Fallback: presence to broadcast (less detectable)

      // Signal "available" — chip appears online
      await routerSetPresence(chip.evolutionInstance, jid, 'available', readingMs)
      // Stay online
      await new Promise(resolve => setTimeout(resolve, readingMs))
      // Go offline
      await routerSetPresence(chip.evolutionInstance, jid, 'unavailable', 0)

      readingCount++
      console.debug(`[SendingEngine] Break window reading: chip ${chip.name} online for ${readingMs}ms during "${activeBreak.label}"`)

      // Stagger — don't make all chips online at the exact same time
      await new Promise(resolve => setTimeout(resolve, randomInt(settings.presenceStaggerMinMs, settings.presenceStaggerMaxMs)))
    } catch {
      // Non-fatal
    }
  }

  return readingCount
}
