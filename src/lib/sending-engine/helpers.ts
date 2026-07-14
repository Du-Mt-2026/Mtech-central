// Sending Engine with Anti-Ban Protection v4.0
// ==============================================
// Realistic human behavior: gaussian delay distribution, typing proportional
// to message length, mid-composition pauses, presence management,
// ban detection, auto-warming, link preview control.
//
// v4.0 improvements:
//   - Delayed offline with jitter (human doesn't go offline instantly)
//   - Idle "reading" presence (chip appears online briefly between sends)
//   - alwaysOnline=false enforced on instance creation
//   - Link preview reads from AntiBanSettings (not hardcoded)
//   - Spintax consecutive dedup (avoid same variation twice in a row)
//
// Serverless-compatible: processes messages with real delays.
// Vercel Cron calls /api/campaigns/process-all every minute.
//
// This module contains shared helpers, types, in-memory state, and config
// accessors used by the rest of the sending-engine/* modules.

import { db } from '../db'
import {
  NURSERY_SCHEDULE,
  PREWARM_SCHEDULE,
  DEFAULT_HUMAN_BEHAVIOR,
  humanBehaviorConfigSchema,
  FIELD_DEFAULTS,
  type ScheduleEntry,
  type BreakWindow,
  type HumanBehaviorConfig,
} from '../constants'
import { toMins, getCurrentMinutes } from '../time-utils'

// ============================================================
// TYPES & CONSTANTS
// ============================================================

export interface AntiBanConfig {
  typingMinDelay: number
  typingMaxDelay: number
  messageIntervalMin: number
  messageIntervalMax: number
  dailyLimitPerChip: number
  warmingEnabled: boolean
  cooldownMinutes: number
  cooldownMinutesMax: number    // Cooldown variável: máximo minutos de pausa (range min-max)
  cooldownAfterMessages: number
  cooldownAfterMessagesMax: number  // Cooldown após N mensagens: máximo (range min-max)
  stopOnWarning: boolean
  sendingWindowStart: number  // minutos desde meia-noite (0-1440), default 480 (8:00)
  sendingWindowEnd: number    // minutos desde meia-noite (0-1440), default 1260 (21:00)
  timezone: string            // fuso horário, default 'America/Sao_Paulo'
  // Editable schedules loaded from DB
  nurserySchedule: ScheduleEntry[]
  prewarmSchedule: ScheduleEntry[]
  readyDailyLimit: number     // Phase 3 (Aquecido) daily limit per chip
  hourlyLimit: number         // Max messages per hour per chip
  // Break windows — pausas dentro da janela de envio
  breakWindows: BreakWindow[]
  // Link preview control
  linkPreviewEnabled: boolean  // Whether to allow link previews in sent messages
  // Human behavior simulation — makes bot patterns undetectable
  humanBehaviorEnabled: boolean
  humanBehaviorConfig: HumanBehaviorConfig
  // Ban detection — UI-configurable (was hardcoded)
  banCodes: number[]
  restrictionKeywords: string[]
  warningKeywords: string[]
  banLookbackHours: number
  banKeywordThreshold: number
  banMaxMessagesCheck: number
  warningMaxMessagesCheck: number
  // Sending engine — UI-configurable (was hardcoded)
  nurseryMinIntervalSec: number
  prewarmMinIntervalSec: number
  presenceStaggerMinMs: number
  presenceStaggerMaxMs: number
  mediaCheckTimeoutMs: number
}

// ============================================================
// TWO-PHASE WARMING SCHEDULE
// ============================================================
// Phase 1: Nursery (Berçário) — chip novo, 14 dias
// Phase 2: Prewarm (Pré-aquecido) — chip já passou pelo berçário, 20 dias
// After both phases: chip is "ready" with no limit restriction
// Phase 3: Ready (Aquecido) — chip fully warmed, configurable daily limit

// Typing speed: characters per second (human average is 5-15 for mobile)
// FALLBACK CONSTANTS — only used when humanBehaviorConfig has no typingSimulation section.
// The UI/DB is the source of truth. These exist as safety defaults.
const TYPING_SPEED_MIN = 6    // chars/second (slow typer)
const TYPING_SPEED_MAX = 14   // chars/second (fast typer)
export const TYPING_MIN_MS = 3000    // minimum typing time (3 seconds even for short messages)
export const TYPING_MAX_MS = 25000   // maximum typing time (25 seconds — avoids Vercel timeout)
const TYPING_PAUSE_CHANCE = 0.3  // 30% chance of a mid-typing pause (simulates thinking)
const TYPING_PAUSE_MIN_MS = 1000  // Min mid-typing pause
const TYPING_PAUSE_MAX_MS = 4000  // Max mid-typing pause
const TYPING_LONG_MSG_THRESHOLD = 100  // Chars to consider "long message"
const TYPING_LONG_MSG_PAUSE_CHANCE = 0.4  // 40% chance for long msgs
const TYPING_SEGMENTS_MIN = 2
const TYPING_SEGMENTS_MAX = 3

// ============================================================
// PRESENCE HUMANIZATION CONSTANTS
// ============================================================
// FALLBACK CONSTANTS — only used when humanBehaviorConfig has no presence section.
// The UI/DB is the source of truth. These exist as safety defaults.
const OFFLINE_DELAY_MIN_MS = 3000    // Minimum time to stay "online" after sending (3s)
const OFFLINE_DELAY_MAX_MS = 15000   // Maximum time to stay "online" after sending (15s)

// Idle "reading" presence: between messages, the chip briefly appears online
// as if reading incoming messages. This happens during:
//   - Break windows (lunch, meeting) — simulates checking WhatsApp during break
//   - Between sends when interval > 60s — simulates reading other chats
//   - During cooldown — simulates being on WhatsApp but not sending
const IDLE_READING_CHANCE = 0.25       // 25% chance of a "reading" presence during idle
const IDLE_READING_DURATION_MIN_MS = 2000   // Minimum "reading" time (2s)
const IDLE_READING_DURATION_MAX_MS = 8000   // Maximum "reading" time (8s)
const IDLE_READING_INTERVAL_MIN_S = 60     // Only do idle reading if interval >= 60s

// ============================================================
// CONFIG ACCESS HELPERS — read from humanBehaviorConfig (UI/DB) with fallback to constants
// ============================================================
// These functions ensure the UI is ALWAYS the source of truth.
// If the DB has a value, use it. If not, fall back to the hardcoded constants above.

export function getTypingConfig(settings: AntiBanConfig) {
  const ts = settings.humanBehaviorConfig?.typingSimulation
  return {
    speedMin: ts?.speedMin ?? TYPING_SPEED_MIN,
    speedMax: ts?.speedMax ?? TYPING_SPEED_MAX,
    pauseChance: (ts?.pauseChance ?? Math.round(TYPING_PAUSE_CHANCE * 100)) / 100,
    pauseMinMs: ts?.pauseMinMs ?? TYPING_PAUSE_MIN_MS,
    pauseMaxMs: ts?.pauseMaxMs ?? TYPING_PAUSE_MAX_MS,
    longMsgThreshold: ts?.longMsgThreshold ?? TYPING_LONG_MSG_THRESHOLD,
    longMsgPauseChance: (ts?.longMsgPauseChance ?? Math.round(TYPING_LONG_MSG_PAUSE_CHANCE * 100)) / 100,
    segmentsMin: ts?.segmentsMin ?? TYPING_SEGMENTS_MIN,
    segmentsMax: ts?.segmentsMax ?? TYPING_SEGMENTS_MAX,
  }
}

export function getPresenceConfig(settings: AntiBanConfig) {
  const p = settings.humanBehaviorConfig?.presence
  return {
    offlineDelayMinMs: p?.offlineDelayMinMs ?? OFFLINE_DELAY_MIN_MS,
    offlineDelayMaxMs: p?.offlineDelayMaxMs ?? OFFLINE_DELAY_MAX_MS,
    idleReadingChance: (p?.idleReadingChance ?? Math.round(IDLE_READING_CHANCE * 100)) / 100,
    idleReadingDurationMinMs: p?.idleReadingDurationMinMs ?? IDLE_READING_DURATION_MIN_MS,
    idleReadingDurationMaxMs: p?.idleReadingDurationMaxMs ?? IDLE_READING_DURATION_MAX_MS,
    idleReadingMinIntervalSec: p?.idleReadingMinIntervalSec ?? IDLE_READING_INTERVAL_MIN_S,
    preSendOnlineMs: p?.preSendOnlineMs ?? 1000,
    preComposePauseMinMs: p?.preComposePauseMinMs ?? 800,
    preComposePauseMaxMs: p?.preComposePauseMaxMs ?? 3000,
    mediaRecordingMinMs: p?.mediaRecordingMinMs ?? 2000,
    mediaRecordingMaxMs: p?.mediaRecordingMaxMs ?? 4000,
  }
}

export function getDeliveryRateConfig(settings: AntiBanConfig) {
  const dr = settings.humanBehaviorConfig?.deliveryRate
  return {
    enabled: dr?.enabled ?? true,
    normalThreshold: dr?.normalThreshold ?? 60,
    mediumThreshold: dr?.mediumThreshold ?? 40,
    mediumMultiplier: dr?.mediumMultiplier ?? 1.5,
    lowThreshold: dr?.lowThreshold ?? 20,
    lowMultiplier: dr?.lowMultiplier ?? 2.5,
    criticalMultiplier: dr?.criticalMultiplier ?? 4.0,
    minSample: dr?.minSample ?? 10,
  }
}

export const DEFAULT_SETTINGS: AntiBanConfig = {
  typingMinDelay: 5100,
  typingMaxDelay: 24900,
  messageIntervalMin: 59,
  messageIntervalMax: 148,
  dailyLimitPerChip: 200,
  warmingEnabled: true,
  cooldownMinutes: 8,
  cooldownMinutesMax: 13,
  cooldownAfterMessages: 5,
  cooldownAfterMessagesMax: 9,
  stopOnWarning: true,
  sendingWindowStart: 540,  // 9:00 in minutes-from-midnight
  sendingWindowEnd: 1020,   // 17:00 in minutes-from-midnight
  timezone: 'America/Sao_Paulo',
  nurserySchedule: NURSERY_SCHEDULE,
  prewarmSchedule: PREWARM_SCHEDULE,
  readyDailyLimit: 200,
  hourlyLimit: 30,
  breakWindows: [],
  linkPreviewEnabled: false,  // Default OFF — link previews in bulk are a bot signature. User can enable via UI.
  humanBehaviorEnabled: true,
  humanBehaviorConfig: DEFAULT_HUMAN_BEHAVIOR,
  // Ban detection defaults — SINGLE SOURCE OF TRUTH from constants.ts FIELD_DEFAULTS
  banCodes: JSON.parse(FIELD_DEFAULTS.banCodes as string) as number[],
  restrictionKeywords: JSON.parse(FIELD_DEFAULTS.restrictionKeywords as string) as string[],
  warningKeywords: JSON.parse(FIELD_DEFAULTS.warningKeywords as string) as string[],
  banLookbackHours: 24,
  banKeywordThreshold: 2,
  banMaxMessagesCheck: 50,
  warningMaxMessagesCheck: 20,
  // Sending engine defaults
  nurseryMinIntervalSec: 120,
  prewarmMinIntervalSec: 60,
  presenceStaggerMinMs: 500,
  presenceStaggerMaxMs: 2000,
  mediaCheckTimeoutMs: 5000,
}

/**
 * Parse break windows from JSON string
 */
function parseBreakWindows(jsonStr: string | undefined | null): BreakWindow[] {
  if (!jsonStr) return []
  try {
    const parsed = JSON.parse(jsonStr)
    if (Array.isArray(parsed)) {
      return parsed.filter((w: { start?: number; end?: number; label?: string }) => w.start !== undefined && w.end !== undefined).map((w: { start?: number; end?: number; label?: string }) => ({
        start: Number(w.start),
        end: Number(w.end),
        label: String(w.label || 'Pausa'),
      }))
    }
  } catch { /* ignore */ }
  return []
}

/**
 * Parse human behavior config from JSON string, validating with Zod schema.
 * Falls back to DEFAULT_HUMAN_BEHAVIOR on any parse/validation error.
 */
function parseHumanBehaviorConfig(jsonStr: string | undefined | null): HumanBehaviorConfig {
  if (!jsonStr) return DEFAULT_HUMAN_BEHAVIOR
  try {
    const parsed = JSON.parse(jsonStr)
    const result = humanBehaviorConfigSchema.safeParse(parsed)
    if (result.success) return result.data
    console.debug('[SendingEngine] humanBehaviorConfig validation failed, using defaults:', result.error.issues[0]?.message)
  } catch { /* ignore */ }
  return DEFAULT_HUMAN_BEHAVIOR
}

/**
 * Parse a JSON array of numbers from the DB, falling back to default.
 * Used for banCodes.
 */
function parseJsonNumberArray(jsonStr: string | undefined | null, fallback: number[]): number[] {
  if (!jsonStr) return fallback
  try {
    const parsed = JSON.parse(jsonStr)
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'number') {
      return parsed.map(Number)
    }
  } catch { /* ignore */ }
  return fallback
}

/**
 * Parse a JSON array of strings from the DB, falling back to default.
 * Used for restrictionKeywords, warningKeywords.
 */
function parseJsonStringArray(jsonStr: string | undefined | null, fallback: string[]): string[] {
  if (!jsonStr) return fallback
  try {
    const parsed = JSON.parse(jsonStr)
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') {
      return parsed.map(String)
    }
  } catch { /* ignore */ }
  return fallback
}

/**
 * Parse a JSON schedule string from the DB, falling back to default schedule
 */
function parseSchedule(jsonStr: string | undefined | null, fallback: ScheduleEntry[]): ScheduleEntry[] {
  if (!jsonStr) return fallback
  try {
    const parsed = JSON.parse(jsonStr)
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].dayRange && parsed[0].limit !== undefined) {
      // Ensure days field exists for each entry
      return parsed.map((entry: { dayRange: string; days?: [number, number]; limit: number }) => ({
        dayRange: entry.dayRange,
        days: entry.days || [1, 1],
        limit: Number(entry.limit) || 1,
      }))
    }
  } catch { /* ignore */ }
  return fallback
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Uniform random integer between min and max (inclusive).
 * Used for simple selections where bell-curve distribution isn't needed.
 */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Uniform random float between min and max.
 */
export function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min
}

/**
 * Gaussian (normal) random number using Box-Muller transform.
 * Returns a value centered around `mean` with standard deviation `stddev`.
 * Clamped to [min, max] to prevent extreme outliers.
 *
 * WHY: Human behavior follows a bell curve — moderate delays are most common,
 * extreme values are rare. Uniform random produces equally-likely values across
 * the range, which is a known bot signature detectable by WhatsApp's anti-spam.
 *
 * Example: gaussianRandom(60, 15, 30, 90)
 * → Most values near 60, rarely below 30 or above 90
 * → ~68% of values within [45, 75], ~95% within [30, 90]
 */
export function gaussianRandom(mean: number, stddev: number, min: number, max: number): number {
  // Box-Muller transform: converts uniform random to gaussian
  const u1 = Math.random()
  const u2 = Math.random()
  const z0 = Math.sqrt(-2.0 * Math.log(u1 || 0.0001)) * Math.cos(2.0 * Math.PI * u2)

  const value = mean + z0 * stddev
  return Math.max(min, Math.min(max, Math.round(value)))
}

/**
 * Gaussian random float (non-integer). Same as gaussianRandom but without rounding.
 */
export function gaussianRandomFloat(mean: number, stddev: number, min: number, max: number): number {
  const u1 = Math.random()
  const u2 = Math.random()
  const z0 = Math.sqrt(-2.0 * Math.log(u1 || 0.0001)) * Math.cos(2.0 * Math.PI * u2)
  const value = mean + z0 * stddev
  return Math.max(min, Math.min(max, value))
}

/**
 * Generate a gaussian-distributed delay in seconds between min and max.
 * Mean = midpoint, stddev = (max - min) / 6 (covers ~99.7% within range).
 * This makes moderate delays most common and extreme delays rare — like humans.
 */
export function gaussianDelaySeconds(min: number, max: number): number {
  const mean = (min + max) / 2
  const stddev = (max - min) / 6 // 3-sigma covers 99.7% of the range
  return gaussianRandom(mean, stddev, min, max)
}

/**
 * Check if current time is within the sending window
 *
 * BUGFIX: Removed double toMins() call — getAntiBanSettings() already converts
 * DB values to minutes. Calling toMins() again was redundant and confusing.
 * Also added robust handling for the 0-1440 (all-day) window case.
 */
export function isWithinSendingWindow(settings: AntiBanConfig): boolean {
  const currentMins = getCurrentMinutes(settings.timezone)
  // NOTE: settings.sendingWindowStart/End are already in minutes (converted by getAntiBanSettings)
  // No need to call toMins() again — they're already minutes-from-midnight values.
  const start = settings.sendingWindowStart
  const end = settings.sendingWindowEnd

  // Edge case: 0-1440 (00:00-24:00) means "all day" — always within window
  // This must be checked FIRST to avoid any comparison issues
  if (start === 0 && end >= 1440) return true

  if (start <= end) {
    // Same day window: e.g., 540-1020 (9:00-17:00)
    if (end >= 1440) return currentMins >= start
    return currentMins >= start && currentMins < end
  } else {
    // Overnight window: e.g., 1320-360 (22:00-06:00)
    return currentMins >= start || currentMins < end
  }
}

/**
 * Check if current time is within any break window.
 * Returns the active break window if found, or null if not in a break.
 */
export function getActiveBreakWindow(settings: AntiBanConfig): BreakWindow | null {
  const currentMins = getCurrentMinutes(settings.timezone)
  for (const bw of settings.breakWindows) {
    const bwStart = toMins(bw.start)
    const bwEnd = toMins(bw.end)
    if (currentMins >= bwStart && currentMins < bwEnd) {
      return bw
    }
  }
  return null
}

/**
 * Get anti-ban settings from DB or defaults
 */
export async function getAntiBanSettings(): Promise<AntiBanConfig> {
  try {
    const saved = await db.antiBanSettings.findFirst()
    if (saved) {
      return {
        typingMinDelay: saved.typingMinDelay,
        typingMaxDelay: saved.typingMaxDelay,
        messageIntervalMin: saved.messageIntervalMin,
        messageIntervalMax: saved.messageIntervalMax,
        dailyLimitPerChip: saved.dailyLimitPerChip,
        warmingEnabled: saved.warmingEnabled,
        cooldownMinutes: saved.cooldownMinutes,
        cooldownAfterMessages: saved.cooldownAfterMessages,
        stopOnWarning: saved.stopOnWarning,
        // New fields with safe defaults for existing DB rows
        sendingWindowStart: toMins(saved.sendingWindowStart),
        sendingWindowEnd: toMins(saved.sendingWindowEnd),
        timezone: saved.timezone,
        // Editable warming schedules (loaded from DB, parsed from JSON)
        nurserySchedule: parseSchedule(saved.nurserySchedule, NURSERY_SCHEDULE),
        prewarmSchedule: parseSchedule(saved.prewarmSchedule, PREWARM_SCHEDULE),
        readyDailyLimit: saved.readyDailyLimit,
        hourlyLimit: saved.hourlyLimit,
        // Variable cooldown
        cooldownMinutesMax: saved.cooldownMinutesMax,
        cooldownAfterMessagesMax: saved.cooldownAfterMessagesMax,
        // Break windows
        breakWindows: parseBreakWindows(saved.breakWindows),
        // Link preview — read dynamically from DB (user configurable in UI)
        // Default is OFF for anti-ban (link previews in bulk are detectable)
        linkPreviewEnabled: saved.linkPreviewEnabled ?? false,
        // Human behavior simulation — read dynamically from DB
        humanBehaviorEnabled: saved.humanBehaviorEnabled ?? true,
        humanBehaviorConfig: parseHumanBehaviorConfig(saved.humanBehaviorConfig),
        // Ban detection — read dynamically from DB
        banCodes: parseJsonNumberArray(saved.banCodes, DEFAULT_SETTINGS.banCodes),
        restrictionKeywords: parseJsonStringArray(saved.restrictionKeywords, DEFAULT_SETTINGS.restrictionKeywords),
        warningKeywords: parseJsonStringArray(saved.warningKeywords, DEFAULT_SETTINGS.warningKeywords),
        banLookbackHours: saved.banLookbackHours ?? 24,
        banKeywordThreshold: saved.banKeywordThreshold ?? 2,
        banMaxMessagesCheck: saved.banMaxMessagesCheck ?? 50,
        warningMaxMessagesCheck: saved.warningMaxMessagesCheck ?? 20,
        // Sending engine — read dynamically from DB
        nurseryMinIntervalSec: saved.nurseryMinIntervalSec ?? 120,
        prewarmMinIntervalSec: saved.prewarmMinIntervalSec ?? 60,
        presenceStaggerMinMs: saved.presenceStaggerMinMs ?? 500,
        presenceStaggerMaxMs: saved.presenceStaggerMaxMs ?? 2000,
        mediaCheckTimeoutMs: saved.mediaCheckTimeoutMs ?? 5000,
      }
    }
  } catch {
    // Use defaults
  }
  return DEFAULT_SETTINGS
}

// ============================================================
// HUMAN BEHAVIOR SIMULATION — Cluster State & Helpers
// ============================================================

/**
 * Per-campaign+chip cluster state — tracks consecutive messages
 * to implement burst-like sending patterns (cluster sending).
 *
 * WHY: Humans don't send messages with perfectly uniform intervals.
 * They tend to send a few messages in quick succession (a "cluster"),
 * then pause for a while before the next burst. This makes the
 * sending pattern look natural instead of metronome-like.
 *
 * C4/C5 FIX: Cap the map size to prevent unbounded memory growth
 * in serverless warm starts (Vercel reuses function instances).
 */
export const MAX_CLUSTER_CACHE_SIZE = 200
export interface ClusterState {
  count: number           // How many messages sent in current cluster
  inCluster: boolean      // Whether currently in an active cluster
  targetSize: number      // How many messages this cluster should contain
}
export const clusterStateMap = new Map<string, ClusterState>()

// ============================================================
// IN-MEMORY PER-CHIP SEND GUARD — prevents race conditions
// ============================================================
// Even with DB-level nextSendAt, two concurrent cron ticks can both
// select the same chip before either updates the DB. This in-memory
// guard provides a last-resort check: if a chip sent a message less
// than ABSOLUTE_MIN_INTERVAL_SEC ago, block it regardless of DB state.
// This is especially important in serverless/container environments
// where the process may handle multiple ticks sequentially.
export const ABSOLUTE_MIN_INTERVAL_SEC = 60 // matches ABSOLUTE_MIN_INTERVAL_MS / 1000
export const chipLastSendMap = new Map<string, number>() // chipId → timestamp of last send

export function isChipInMemoryCooling(chipId: string): boolean {
  const lastSend = chipLastSendMap.get(chipId)
  if (!lastSend) return false
  const elapsed = (Date.now() - lastSend) / 1000
  return elapsed < ABSOLUTE_MIN_INTERVAL_SEC
}

export function markChipSent(chipId: string): void {
  chipLastSendMap.set(chipId, Date.now())
}

/**
 * Clean up cluster state map if it grows too large.
 * Evicts the oldest half of entries when over the limit.
 */
export function evictClusterCacheIfNeeded(): void {
  if (clusterStateMap.size <= MAX_CLUSTER_CACHE_SIZE) return
  const keysIter = clusterStateMap.keys()
  for (let i = 0; i < MAX_CLUSTER_CACHE_SIZE / 2; i++) {
    const oldest = keysIter.next().value
    if (oldest !== undefined) clusterStateMap.delete(oldest)
  }
}

/**
 * Release a claimed message back to 'pending' and clear the chip's temporary lock.
 * This MUST be called whenever we release a message claim after the chip lock was set,
 * to ensure the chip doesn't stay locked for the full 2-minute temporary period.
 *
 * BUGFIX: Only clear nextSendAt if it's within a few seconds of our temporary lock
 * timestamp (now + 120s). Previously, this function cleared ANY nextSendAt within
 * the next 2 minutes, which could erase a LEGITIMATE interval set by a previous
 * successful send (e.g., nextSendAt = now + 59s). This caused the chip to be
 * immediately available again, bypassing the anti-ban interval.
 */
export async function releaseMessageAndChipLock(messageId: string, chipId: string, reason: string, lockTimestamp?: number) {
  await db.message.update({ where: { id: messageId }, data: { status: 'pending' } })
  // Only clear nextSendAt if we can confirm it's our own temporary lock.
  // If lockTimestamp is provided, only clear if the chip's nextSendAt matches it (±2s).
  // If lockTimestamp is NOT provided (legacy callers), only clear if it's a temporary
  // lock (within 130 seconds — the chip lock is always 120s). This prevents
  // clearing legitimate interval locks (e.g. 60s, 90s, 120s) that were set
  // by successful sends.
  if (lockTimestamp) {
    // Precise: only clear if it's our lock (within ±2 seconds tolerance)
    const chip = await db.chip.findUnique({ where: { id: chipId }, select: { nextSendAt: true } })
    if (chip?.nextSendAt) {
      const diff = Math.abs(new Date(chip.nextSendAt).getTime() - lockTimestamp)
      if (diff < 2000) {
        await db.chip.update({ where: { id: chipId }, data: { nextSendAt: null } })
      }
    }
  } else {
    // Legacy fallback: only clear if nextSendAt is within 130s from now.
    // The chip lock is always set to now + 120s, so this only clears temporary
    // locks, NOT legitimate interval locks (which are >= 60s but could be up to 180s).
    // FIX: was 180s (3 min), now 130s — prevents clearing legitimate 90-120s intervals.
    const oneThirtySecondsFromNow = new Date(Date.now() + 130_000)
    await db.chip.updateMany({
      where: {
        id: chipId,
        nextSendAt: { lt: oneThirtySecondsFromNow },
      },
      data: { nextSendAt: null },
    })
  }
  console.debug(`[SendingEngine] Released claim for message ${messageId} and chip lock (${reason})`)
}

/**
 * Reset chip daily counter if a new day has started (timezone-aware)
 */
export async function resetDailyIfNeeded(chipId: string, timezone: string = 'America/Sao_Paulo'): Promise<void> {
  const chip = await db.chip.findUnique({ where: { id: chipId } })
  if (!chip) return

  const now = new Date()
  const lastReset = new Date(chip.lastResetAt)

  // Use timezone-aware date comparison
  const formatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'numeric', day: 'numeric',
    timeZone: timezone,
  })

  const nowDateStr = formatter.format(now)
  const lastDateStr = formatter.format(lastReset)

  if (nowDateStr !== lastDateStr) {
    await db.chip.update({
      where: { id: chipId },
      data: { sentToday: 0, verifiedToday: 0, lastResetAt: now, lastVerifiedResetAt: now, hourlySent: 0, lastHourlyResetAt: now },
    })
  }
}

/**
 * Reset chip hourly counter if an hour has passed since last reset.
 */
export async function resetHourlyIfNeeded(chipId: string): Promise<void> {
  const chip = await db.chip.findUnique({ where: { id: chipId } })
  if (!chip) return

  const now = new Date()
  const lastHourlyReset = new Date(chip.lastHourlyResetAt ?? chip.lastResetAt)
  const hoursSinceReset = (now.getTime() - lastHourlyReset.getTime()) / (1000 * 60 * 60)

  if (hoursSinceReset >= 1) {
    await db.chip.update({
      where: { id: chipId },
      data: { hourlySent: 0, lastHourlyResetAt: now },
    })
  }
}

/**
 * Auto-advance warming phase based on days since chip creation.
 * Two-phase system:
 *   1. Nursery (14 days) — chip novo, limite muito baixo
 *   2. Prewarm (20 days) — chip pré-aquecido, ramp-up progressivo
 *   3. Ready — chip pronto, sem restrição de aquecimento
 */
export async function advanceWarmingPhase(chipId: string, settings: AntiBanConfig): Promise<void> {
  if (!settings.warmingEnabled) return

  const chip = await db.chip.findUnique({ where: { id: chipId } })
  if (!chip || !chip.warmingEnabled) return

  const phase = chip.warmingPhase || 'nursery'
  
  if (phase === 'ready') return // Already fully warmed

  const now = new Date()
  const createdAt = new Date(chip.createdAt)
  const daysSinceCreation = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)) + 1

  if (phase === 'nursery') {
    // Derive nursery duration from the schedule's last entry (not hardcoded).
    // If user customizes the schedule in UI, the engine respects it.
    const nurserySchedule = settings.nurserySchedule
    const nurseryDuration = nurserySchedule.length > 0
      ? nurserySchedule[nurserySchedule.length - 1].days[1]
      : 14  // Fallback if schedule is empty
    if (daysSinceCreation > nurseryDuration) {
      // Transition to prewarm phase
      await db.chip.update({
        where: { id: chipId },
        data: {
          warmingPhase: 'prewarm',
          prewarmStartedAt: now,
          warmingStage: 5, // Legacy compat
        },
      })
      console.debug(`[SendingEngine] Chip ${chip.name} graduated from NURSERY → PREWARM (day ${daysSinceCreation}, nursery duration: ${nurseryDuration} days)`)
    }
  } else if (phase === 'prewarm') {
    // Derive prewarm duration from the schedule's last entry (not hardcoded).
    const prewarmSchedule = settings.prewarmSchedule
    const prewarmDuration = prewarmSchedule.length > 0
      ? prewarmSchedule[prewarmSchedule.length - 1].days[1]
      : 20  // Fallback if schedule is empty
    // BUGFIX: Use warmingStartedAt (not prewarmStartedAt) for consistency with frontend.
    const warmingStart = chip.warmingStartedAt ? new Date(chip.warmingStartedAt) : createdAt
    // BUGFIX 2: Use Brasilia timezone for day calculation (matching frontend + getEffectiveDailyLimit)
    const spFmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'America/Sao_Paulo' })
    const nowSp = spFmt.format(now)
    const startSp = spFmt.format(warmingStart)
    const [nm2, nd2, ny2] = nowSp.split('/').map(Number)
    const [sm2, sd2, sy2] = startSp.split('/').map(Number)
    const nowDate2 = new Date(ny2, nm2 - 1, nd2)
    const startDate2 = new Date(sy2, sm2 - 1, sd2)
    const daysSincePrewarm = Math.max(1, Math.floor((nowDate2.getTime() - startDate2.getTime()) / (86400000)) + 1)
    
    if (daysSincePrewarm > prewarmDuration) {
      // Transition to ready
      await db.chip.update({
        where: { id: chipId },
        data: {
          warmingPhase: 'ready',
          warmingStage: 6, // Legacy compat — beyond old max
        },
      })
      console.debug(`[SendingEngine] Chip ${chip.name} graduated from PREWARM → READY (prewarm day ${daysSincePrewarm}, prewarm duration: ${prewarmDuration} days)`)
    }
  }
}



/**
 * Check if chip is in cooldown period.
 * Uses cooldownUntil timestamp on the chip record.
 *
 * IMPORTANT: This function ONLY checks if the chip is currently in an active cooldown.
 * Cooldown is triggered AFTER a message is successfully sent (in the post-send logic),
 * NOT here. This prevents the re-trigger bug where sentToday % cooldownAfterMessages === 0
 * would re-enter cooldown every time this function was called after cooldown expired.
 */
export async function isInCooldown(chipId: string, settings: AntiBanConfig): Promise<{ inCooldown: boolean; cooldownUntil: Date | null }> {
  const chip = await db.chip.findUnique({ where: { id: chipId } })
  if (!chip) return { inCooldown: true, cooldownUntil: null }

  const now = new Date()

  // If chip has an active cooldownUntil and it hasn't expired yet
  if (chip.cooldownUntil && new Date(chip.cooldownUntil) > now) {
    console.debug(`[SendingEngine] Chip ${chip.name} in cooldown until ${chip.cooldownUntil}`)
    return { inCooldown: true, cooldownUntil: new Date(chip.cooldownUntil) }
  }

  // Cooldown expired — clear it
  if (chip.cooldownUntil) {
    await db.chip.update({
      where: { id: chipId },
      data: { cooldownUntil: null },
    })
    console.debug(`[SendingEngine] Chip ${chip.name} cooldown expired, cleared`)
  }

  return { inCooldown: false, cooldownUntil: null }
}

// FIX: ContactLimit-aware chip filter for reassignment
export async function getAvailableChipsForReassignment(campaignId: string, chips: { id: string }[]): Promise<{ id: string }[]> {
  const campaignChips = await db.campaignChip.findMany({
    where: { campaignId, chipId: { in: chips.map(c => c.id) } },
    select: { chipId: true, contactLimit: true },
  })
  const limitMap = new Map(campaignChips.map(cc => [cc.chipId, cc.contactLimit]))
  const available: { id: string }[] = []
  for (const chip of chips) {
    const limit = limitMap.get(chip.id)
    const count = await db.message.count({ where: { campaignId, chipId: chip.id } })
    if (limit != null && count < limit) available.push(chip)
  }
  return available.length > 0 ? available : chips  // fallback to all chips if all full
}
