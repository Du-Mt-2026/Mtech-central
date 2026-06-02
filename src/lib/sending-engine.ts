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

import {
  sendTextMessage as routerSendText,
  sendMediaMessage as routerSendMedia,
  setPresence as routerSetPresence,
  getConnectionState as routerGetConnectionState,

  formatPhoneNumber,
} from './evolution-router'
import { enqueueReconnection } from './reconnection-queue'
import { db } from './db'
import type { Chip } from '@prisma/client'
import { NURSERY_SCHEDULE, PREWARM_SCHEDULE, WARMING_MODE_MULTIPLIERS, DEFAULT_HUMAN_BEHAVIOR, humanBehaviorConfigSchema, FIELD_DEFAULTS, type ScheduleEntry, type BreakWindow, type HumanBehaviorConfig } from './constants'
import { toMins, getCurrentMinutes } from './time-utils'

// ============================================================
// TYPES & CONSTANTS
// ============================================================

interface AntiBanConfig {
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
const TYPING_MIN_MS = 3000    // minimum typing time (3 seconds even for short messages)
const TYPING_MAX_MS = 25000   // maximum typing time (25 seconds — avoids Vercel timeout)
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

function getTypingConfig(settings: AntiBanConfig) {
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

function getPresenceConfig(settings: AntiBanConfig) {
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

function getDeliveryRateConfig(settings: AntiBanConfig) {
  const dr = settings.humanBehaviorConfig?.deliveryRate
  return {
    normalThreshold: dr?.normalThreshold ?? 60,
    mediumThreshold: dr?.mediumThreshold ?? 40,
    mediumMultiplier: dr?.mediumMultiplier ?? 1.5,
    lowThreshold: dr?.lowThreshold ?? 20,
    lowMultiplier: dr?.lowMultiplier ?? 2.5,
    criticalMultiplier: dr?.criticalMultiplier ?? 4.0,
    minSample: dr?.minSample ?? 10,
  }
}

const DEFAULT_SETTINGS: AntiBanConfig = {
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
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Uniform random float between min and max.
 */
function randomFloat(min: number, max: number): number {
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
function gaussianRandom(mean: number, stddev: number, min: number, max: number): number {
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
function gaussianRandomFloat(mean: number, stddev: number, min: number, max: number): number {
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
function gaussianDelaySeconds(min: number, max: number): number {
  const mean = (min + max) / 2
  const stddev = (max - min) / 6 // 3-sigma covers 99.7% of the range
  return gaussianRandom(mean, stddev, min, max)
}

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
function calculateTypingDuration(text: string, settings?: AntiBanConfig): number {
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
 * Check if current time is within the sending window
 *
 * BUGFIX: Removed double toMins() call — getAntiBanSettings() already converts
 * DB values to minutes. Calling toMins() again was redundant and confusing.
 * Also added robust handling for the 0-1440 (all-day) window case.
 */
function isWithinSendingWindow(settings: AntiBanConfig): boolean {
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
function getActiveBreakWindow(settings: AntiBanConfig): BreakWindow | null {
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

// ============================================================
// ANTI-BAN LOGIC
// ============================================================

/**
 * Get the warming limit for a chip based on its current phase and day.
 * Uses the DB-loaded warming schedules (nursery + prewarm).
 */
function getWarmingLimitForDay(
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

function getMinimumIntervalForChip(
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

function getEffectiveDailyLimit(
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
  } else if (phase === 'nursery') {
    dayInPhase = Math.floor((now.getTime() - warmingStart.getTime()) / (1000 * 60 * 60 * 24)) + 1
  } else {
    // prewarm phase — use prewarmStartedAt as reference (not warmingStartedAt)
    const prewarmStart = chip.prewarmStartedAt ? new Date(chip.prewarmStartedAt) : warmingStart
    dayInPhase = Math.floor((now.getTime() - prewarmStart.getTime()) / (1000 * 60 * 60 * 24)) + 1
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
 * Get anti-ban settings from DB or defaults
 */
async function getAntiBanSettings(): Promise<AntiBanConfig> {
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
const MAX_CLUSTER_CACHE_SIZE = 200
interface ClusterState {
  count: number           // How many messages sent in current cluster
  inCluster: boolean      // Whether currently in an active cluster
  targetSize: number      // How many messages this cluster should contain
}
const clusterStateMap = new Map<string, ClusterState>()

/**
 * Clean up cluster state map if it grows too large.
 * Evicts the oldest half of entries when over the limit.
 */
function evictClusterCacheIfNeeded(): void {
  if (clusterStateMap.size <= MAX_CLUSTER_CACHE_SIZE) return
  const keysIter = clusterStateMap.keys()
  for (let i = 0; i < MAX_CLUSTER_CACHE_SIZE / 2; i++) {
    const oldest = keysIter.next().value
    if (oldest !== undefined) clusterStateMap.delete(oldest)
  }
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
function getDayRhythmMultiplier(settings: AntiBanConfig): number {
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
function getClusterDelaySeconds(
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
function getNonlinearPauseMinutes(settings: AntiBanConfig): number | null {
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
async function performIdleReadingPresence(
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
async function delayedOfflineWithJitter(
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

/**
 * Reset chip daily counter if a new day has started (timezone-aware)
 */
async function resetDailyIfNeeded(chipId: string, timezone: string = 'America/Sao_Paulo'): Promise<void> {
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
async function resetHourlyIfNeeded(chipId: string): Promise<void> {
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
async function advanceWarmingPhase(chipId: string, settings: AntiBanConfig): Promise<void> {
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
    const prewarmStart = chip.prewarmStartedAt ? new Date(chip.prewarmStartedAt) : createdAt
    const daysSincePrewarm = Math.floor((now.getTime() - prewarmStart.getTime()) / (1000 * 60 * 60 * 24)) + 1
    
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
async function isInCooldown(chipId: string, settings: AntiBanConfig): Promise<{ inCooldown: boolean; cooldownUntil: Date | null }> {
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

/**
 * Detect if a chip might be banned by checking its connection state.
 * If the chip is disconnected or has a disconnection reason, it may be banned.
 * Returns true if the chip appears to be banned/disconnected.
 */
type ChipBanInfo = Pick<Chip, 'id' | 'evolutionInstance' | 'status' | 'disconnectionReasonCode'>

async function detectChipBan(chip: ChipBanInfo, settings: AntiBanConfig = DEFAULT_SETTINGS): Promise<{ banned: boolean; reason: string; disconnected: boolean; tempBan?: boolean }> {
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
async function checkForWarnings(chipId: string, settings: AntiBanConfig = DEFAULT_SETTINGS): Promise<boolean> {
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

// ============================================================
// CAMPAIGN MANAGEMENT
// ============================================================

/**
 * Resolve {{KEY: var1 | var2 | var3}} blocks in text.
 * For each KEY block, pick a random variation.
 * Supports nested {{variable}} inside variations (e.g., {{KEY: Meu nome é {{vendedor}}... | ...}})
 *
 * ANTI-BAN: Consecutive dedup — if the same KEY block appears in messages
 * sent one after another, avoid picking the same variation twice in a row.
 * This prevents the pattern where a bot sends identical phrasing to multiple
 * contacts, which is detectable. Uses a simple static cache keyed by block content.
 */
// Cache of last-used variation index per KEY block content
// C4/C5 FIX: Cap the variation cache to prevent unbounded memory growth
const MAX_SPINTAX_CACHE_SIZE = 500
const lastUsedVariation = new Map<string, number>()

function evictSpintaxCacheIfNeeded(): void {
  if (lastUsedVariation.size <= MAX_SPINTAX_CACHE_SIZE) return
  const keysIter = lastUsedVariation.keys()
  for (let i = 0; i < MAX_SPINTAX_CACHE_SIZE / 2; i++) {
    const oldest = keysIter.next().value
    if (oldest !== undefined) lastUsedVariation.delete(oldest)
  }
}

function resolveKeyBlocks(text: string): string {
  // C4/C5 FIX: Evict old entries before potentially adding new ones
  evictSpintaxCacheIfNeeded()

  // Use a custom parser to handle nested {{ }} inside KEY blocks
  let result = ''
  let i = 0
  while (i < text.length) {
    // Look for {{KEY:
    if (text.slice(i, i + 7) === '{{KEY: ') {
      // Find the matching }}
      let depth = 0
      let j = i + 7
      let found = false
      for (; j < text.length - 1; j++) {
        if (text[j] === '{' && text[j + 1] === '{') {
          depth++
          j++ // skip next {
        } else if (text[j] === '}' && text[j + 1] === '}') {
          if (depth > 0) {
            depth--
            j++ // skip next }
          } else {
            // Found the closing }}
            const innerContent = text.slice(i + 7, j)
            const variations = innerContent.split('|').map(s => s.trim()).filter(Boolean)
            if (variations.length > 0) {
              // ANTI-BAN: Consecutive dedup — avoid same variation twice in a row
              let chosenIdx: number
              const cacheKey = innerContent
              const lastIdx = lastUsedVariation.get(cacheKey)

              if (variations.length > 1 && lastIdx !== undefined) {
                // Pick a different variation than last time
                const availableIndices = variations.map((_, idx) => idx).filter(idx => idx !== lastIdx)
                chosenIdx = availableIndices[Math.floor(Math.random() * availableIndices.length)]
              } else {
                chosenIdx = Math.floor(Math.random() * variations.length)
              }

              lastUsedVariation.set(cacheKey, chosenIdx)
              result += variations[chosenIdx]
            }
            i = j + 2
            found = true
            break
          }
        }
      }
      if (!found) {
        // No matching }}, keep as-is
        result += text[i]
        i++
      }
    } else {
      result += text[i]
      i++
    }
  }
  return result
}

/**
 * Resolve old-style {{KEY_NAME}} markers using MessageKey records from the database.
 * Each key has variations stored as JSON; pick a random one.
 */
async function resolveMessageKeyMarkers(text: string): Promise<string> {
  // Find remaining {{SOME_NAME}} patterns that are NOT {{KEY:...}}
  // After contact variable resolution, any remaining {{var}} is either a MessageKey or an unknown variable
  const markerRegex = /\{\{([A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_]*)\}\}/g
  let match
  const markers = new Set<string>()
  while ((match = markerRegex.exec(text)) !== null) {
    const name = match[1]
    if (!name.startsWith('KEY:')) {
      markers.add(name)
    }
  }

  if (markers.size === 0) return text

  // Look up message keys from the database
  const keys = await db.messageKey.findMany({
    where: { name: { in: Array.from(markers) } },
  })

  let result = text
  for (const key of keys) {
    try {
      const variations: string[] = JSON.parse(key.variations)
      if (variations.length > 0) {
        const chosen = variations[Math.floor(Math.random() * variations.length)]
        const escapedName = key.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        result = result.replace(new RegExp(`\\{\\{${escapedName}\\}\\}`, 'g'), chosen)
      }
    } catch { /* ignore */ }
  }
  return result
}

/**
 * Start a campaign: create pending messages and set status to running.
 *
 * CRITICAL ORDER: Messages MUST be created BEFORE the campaign status is set to 'running'.
 * If we set status='running' first, the processing loop (auto-process every 60s) can
 * pick up the campaign, find 0 pending messages, and immediately mark it as completed.
 *
 * Uses a database transaction with row-level lock on the Campaign row to prevent
 * race conditions. Two concurrent calls to startCampaign for the same campaign will
 * serialize — the second will see that messages already exist and skip.
 *
 * Additionally, a @@unique([campaignId, contactId, stepOrder]) constraint on Message
 * prevents duplicate records at the database level.
 */
export async function startCampaign(campaignId: string): Promise<{ messageCount: number }> {
  // ============================================================
  // PHASE 1: Atomic status check + lock
  // Use a transaction with row-level lock to prevent race conditions.
  // Two concurrent calls will serialize — only one proceeds to create messages.
  // IMPORTANT: Do NOT set status='running' here — that happens AFTER messages exist.
  // ============================================================
  const startResult = await db.$transaction(async (tx) => {
    // Lock the campaign row to prevent concurrent start attempts
    const campaign = await tx.$queryRaw<Array<{id: string, status: string}>>`
      SELECT id, status FROM "Campaign" WHERE id = ${campaignId} FOR UPDATE
    `

    if (campaign.length === 0) {
      throw new Error('Campanha não encontrada')
    }

    const currentStatus = campaign[0].status

    // If already running with messages, skip
    if (currentStatus === 'running') {
      const existingCount = await tx.message.count({ where: { campaignId } })
      if (existingCount > 0) {
        console.debug(`[SendingEngine] Campaign ${campaignId} already running with ${existingCount} messages — skipping`)
        return { canProceed: false, messageCount: existingCount }
      }
    }

    // If already completed/cancelled, cannot start
    if (currentStatus === 'completed' || currentStatus === 'cancelled') {
      throw new Error(`Campanha não pode ser iniciada no status "${currentStatus}"`)
    }

    // If not draft/scheduled, cannot start
    if (currentStatus !== 'draft' && currentStatus !== 'scheduled') {
      throw new Error(`Campanha não pode ser iniciada no status "${currentStatus}"`)
    }

    // Check for existing messages (in case a previous attempt partially succeeded)
    const existingMessages = await tx.message.count({ where: { campaignId } })
    if (existingMessages > 0) {
      // Messages exist from a previous attempt — just mark as running
      console.debug(`[SendingEngine] Campaign ${campaignId} already has ${existingMessages} messages — marking as running`)
      await tx.campaign.update({
        where: { id: campaignId },
        data: { status: 'running', startedAt: new Date(), nextSendAt: null },
      })
      return { canProceed: false, messageCount: existingMessages }
    }

    // Campaign is draft/scheduled with no messages — we can proceed
    // DO NOT set status='running' here! Wait until messages are created.
    return { canProceed: true, messageCount: 0 }
  }, {
    maxWait: 10000,
    timeout: 30000,
  })

  if (!startResult.canProceed) {
    return { messageCount: startResult.messageCount }
  }

  // ============================================================
  // PHASE 2: Create messages (campaign is still in 'draft' status)
  // The processing loop only picks up 'running' campaigns, so there's
  // no risk of premature processing while we're creating messages.
  // ============================================================
  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    include: {
      chips: { include: { chip: true } },
      sequenceSteps: { orderBy: { stepOrder: 'asc' } },
      contactList: { include: { contacts: true } },
    },
  })

  if (!campaign) throw new Error('Campanha não encontrada')
  if (!campaign.contactList) throw new Error('Campanha não tem lista de contatos')
  if (campaign.chips.length === 0) throw new Error('Campanha não tem chips atribuídos')

  // Derive message content from sequence steps (each step may have variations)
  const hasSteps = campaign.sequenceSteps.length > 0

  // Parse steps and their variations
  type VariationObj = { content: string; mediaUrl?: string; mediatype?: string }
  type StepWithVariations = {
    stepOrder: number
    content: string
    mediaUrl: string | null
    mediatype: string | null
    delayMinutes: number
    delayUnit: string
    variations: VariationObj[]
  }

  const parsedSteps: StepWithVariations[] = campaign.sequenceSteps.map(s => {
    let stepVariations: VariationObj[] = []
    try {
      const raw = JSON.parse(s.variations || '[]')
      if (Array.isArray(raw) && raw.length > 0) {
        stepVariations = raw.filter((v: VariationObj) =>
          (v.content && v.content.trim()) || v.mediaUrl || v.mediatype
        )
      }
    } catch { /* ignore */ }
    return {
      stepOrder: s.stepOrder,
      content: s.content,
      mediaUrl: s.mediaUrl || null,
      mediatype: s.mediatype || null,
      delayMinutes: s.delayMinutes,
      delayUnit: s.delayUnit || 'minutes',
      variations: stepVariations,
    }
  })

  if (!hasSteps || parsedSteps.length === 0) {
    // Revert to draft since there are no messages
    await db.campaign.update({ where: { id: campaignId }, data: { status: 'draft', startedAt: null } })
    throw new Error('Campanha não tem mensagens configuradas. Adicione etapas com mensagens.')
  }

  // Sort steps by stepOrder to ensure correct ordering
  parsedSteps.sort((a, b) => a.stepOrder - b.stepOrder)

  // DIAGNOSTIC: Log parsed step data to help debug media issues
  for (const ps of parsedSteps) {
    console.debug(`[SendingEngine] Parsed step ${ps.stepOrder}: content="${ps.content?.substring(0, 50)}...", mediaUrl=${ps.mediaUrl || 'null'}, mediatype=${ps.mediatype || 'null'}, variations=${ps.variations.length}`)
  }

  const contacts = campaign.contactList.contacts
  const chips = campaign.chips.map(cc => cc.chip).filter(c => c.evolutionInstance)

  if (chips.length === 0) {
    await db.campaign.update({ where: { id: campaignId }, data: { status: 'draft', startedAt: null } })
    throw new Error('Nenhum chip com instância WhatsApp conectada')
  }
  if (contacts.length === 0) {
    await db.campaign.update({ where: { id: campaignId }, data: { status: 'draft', startedAt: null } })
    throw new Error('Lista de contatos vazia')
  }

  // ============================================================
  // FILTER OUT BLOCKED CONTACTS
  // Contacts who blocked the sender chip are auto-skipped.
  // This prevents wasting campaign quota and avoids ban risk
  // (sending to blocked contacts is a spam signal for Meta).
  // ============================================================
  const chipIds = chips.map(c => c.id)
  const blockedContacts = await db.blockedContact.findMany({
    where: {
      chipId: { in: chipIds },
      unblockedAt: null, // Only active blocks
    },
    select: { chipId: true, contactPhone: true, contactId: true },
  })

  // Create a Set of blocked phone numbers per chip for fast lookup
  const blockedPerChip = new Map<string, Set<string>>()
  for (const bc of blockedContacts) {
    if (!blockedPerChip.has(bc.chipId)) {
      blockedPerChip.set(bc.chipId, new Set())
    }
    blockedPerChip.get(bc.chipId)!.add(bc.contactPhone)
  }

  // Also create a global set of blocked contact IDs (for quick filtering)
  const blockedContactIds = new Set(
    blockedContacts.filter(bc => bc.contactId).map(bc => bc.contactId!)
  )

  // Filter contacts: remove those who are blocked on ANY campaign chip
  const filteredContacts = contacts.filter(contact => {
    // Check by contact ID first (fast path)
    if (blockedContactIds.has(contact.id)) return false
    // Check by phone number against each chip's block list
    for (const chipId of chipIds) {
      const blockedPhones = blockedPerChip.get(chipId)
      if (blockedPhones && blockedPhones.has(contact.phone)) return false
    }
    return true
  })

  const skippedCount = contacts.length - filteredContacts.length
  if (skippedCount > 0) {
    console.log(`[SendingEngine] Campaign ${campaignId}: filtered out ${skippedCount} blocked contacts (${filteredContacts.length} remaining)`)
  }

  // Create messages for ALL steps in the sequence
  // For multi-step: each contact gets one message per step, processed in order
  const messagesToCreate: { campaignId: string; chipId: string; contactId: string; content: string; status: "pending"; stepOrder: number; mediaUrl: string | null; mediatype: string | null }[] = []
  for (let i = 0; i < filteredContacts.length; i++) {
    const contact = filteredContacts[i]
    const chip = chips[i % chips.length]

    for (const step of parsedSteps) {
      // Build the items pool for this step (main content + variations)
      const stepItems: { content: string; mediaUrl: string | null; mediatype: string | null }[] = []
      if (step.variations.length > 0) {
        for (const v of step.variations) {
          stepItems.push({
            content: v.content,
            mediaUrl: v.mediaUrl || step.mediaUrl || null,
            mediatype: v.mediatype || step.mediatype || null,
          })
        }
      } else {
        stepItems.push({
          content: step.content,
          mediaUrl: step.mediaUrl || null,
          mediatype: step.mediatype || null,
        })
      }

      // Pick a random variation for this contact
      const messageItem = stepItems[Math.floor(Math.random() * stepItems.length)]

      // Replace template variables — resolve KEY blocks first, then contact variables, then message key markers
      // Step 1: Resolve inline {{KEY: var1 | var2 | var3}} blocks (random variation per contact)
      let content = resolveKeyBlocks(messageItem.content)

      // Step 2: Replace contact variables from customFields
      let customData: Record<string, string> = {}
      try {
        if (contact.customFields) {
          customData = JSON.parse(contact.customFields)
        }
      } catch { /* ignore invalid JSON */ }

      const allFields: Record<string, string> = {
        nome: contact.name,
        telefone: contact.phone,
        ...customData,
      }

      // Resolve all {{variable}} patterns
      content = content.replace(/\{\{([a-zA-ZÀ-ÿ_][a-zA-ZÀ-ÿ0-9_]*)\}\}/g, (match, varName) => {
        const key = varName.toLowerCase()
        if (allFields[key] !== undefined) {
          return allFields[key]
        }
        return match
      })

      // Legacy single-brace format
      content = content.replace(/\{([a-zA-ZÀ-ÿ_][a-zA-ZÀ-ÿ0-9_]*)\}/g, (match, varName) => {
        const key = varName.toLowerCase()
        if (allFields[key] !== undefined) {
          return allFields[key]
        }
        return match
      })

      // Step 3: Resolve old-style {{KEY_NAME}} markers
      content = await resolveMessageKeyMarkers(content)

      console.debug(`[SendingEngine] Creating message for campaign ${campaignId}, contact ${contact.id}, step ${step.stepOrder}: content="${content.substring(0, 50)}...", mediaUrl=${messageItem.mediaUrl || 'null'}, mediatype=${messageItem.mediatype || 'null'}`)

      messagesToCreate.push({
        campaignId: campaign.id,
        chipId: chip.id,
        contactId: contact.id,
        content,
        status: 'pending' as const,
        stepOrder: step.stepOrder,
        mediaUrl: messageItem.mediaUrl || null,
        mediatype: messageItem.mediatype || null,
      })
    }
  }

  // Create messages with skipDuplicates — if the unique constraint (campaignId, contactId, stepOrder)
  // is violated, skip that record instead of failing. This is the FINAL safety net against duplicates.
  const createResult = await db.message.createMany({
    data: messagesToCreate,
    skipDuplicates: true,
  })

  console.debug(`[SendingEngine] Created ${createResult.count} messages for campaign ${campaignId} (requested ${messagesToCreate.length})`)

  // ============================================================
  // PHASE 3: NOW set campaign to 'running' — AFTER messages exist
  // This is the critical ordering: the processing loop will only
  // pick up 'running' campaigns, and by now messages are guaranteed
  // to exist, so processNextMessage won't prematurely complete it.
  // ============================================================
  await db.campaign.update({
    where: { id: campaignId },
    data: { status: 'running', startedAt: new Date(), nextSendAt: null },
  })

  console.debug(`[SendingEngine] Campaign ${campaignId} is now RUNNING with ${createResult.count} messages`)

  return { messageCount: createResult.count }
}

// ============================================================
// MESSAGE PROCESSING
// ============================================================

/**
 * Process the NEXT pending message for a campaign.
 * Returns the delay (ms) the caller should wait before processing the next one.
 */
export async function processNextMessage(campaignId: string): Promise<{
  processed: boolean
  delayMs: number
  remaining: number
  completed: boolean
  reason?: string
  events?: Array<{ type: string; chipName?: string; campaignName?: string; reason?: string }>
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

  // Get campaign anti-ban settings (WITHOUT nextSendAt — we handle that atomically below)
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
  // ATOMIC CAMPAIGN SLOT CLAIM — anti-ban interval persistence
  // ============================================
  // CRITICAL FIX: The old non-atomic check-then-set (SELECT nextSendAt, then later UPDATE)
  // had a race condition — multiple concurrent invocations could all read nextSendAt as
  // null/expired before any of them wrote the new value, causing burst sends (2-4s gaps).
  //
  // This atomic claim uses UPDATE ... WHERE to check AND set nextSendAt in a single
  // database operation. PostgreSQL row-level locking ensures that concurrent UPDATEs
  // are serialized — the second UPDATE sees the first's changes and its WHERE clause fails.
  //
  // Flow:
  //   1. Try to set campaign.nextSendAt = NOW() + estimatedDelay WHERE nextSendAt IS NULL OR < NOW()
  //   2. If count=1: we claimed the slot — proceed to send
  //   3. If count=0: another invocation has the slot — read their nextSendAt and return wait
  //   4. After sending, update nextSendAt with the ACTUAL calculated delay
  //   5. On error, release the claim with a short retry delay
  if (antiBanEnabled) {
    // Calculate estimated delay for the claim (use the interval midpoint as a safe estimate)
    // ANTI-BAN SAFETY: UI settings are the minimum safety floor.
    // Campaign can go SLOWER (higher) but never FASTER (lower) than UI settings.
    const intervalMin = Math.max(campaignIntervalMin ?? 0, settings.messageIntervalMin)
    const intervalMax = Math.max(campaignIntervalMax ?? 0, settings.messageIntervalMax)
    const estimatedDelayMs = gaussianDelaySeconds(intervalMin, intervalMax) * 1000

    // Apply warming mode multiplier to the estimate
    const modeMultiplier = WARMING_MODE_MULTIPLIERS[warmingMode]
    const adjustedEstimateMs = modeMultiplier
      ? Math.round(estimatedDelayMs * modeMultiplier.intervalMultiplier)
      : estimatedDelayMs

    // Atomic claim: only succeeds if nextSendAt is null or in the past
    const claimResult = await db.campaign.updateMany({
      where: {
        id: campaignId,
        OR: [
          { nextSendAt: null },
          { nextSendAt: { lt: new Date() } },
        ],
      },
      data: { nextSendAt: new Date(Date.now() + adjustedEstimateMs) },
    })

    if (claimResult.count === 0) {
      // Another invocation already claimed this campaign's slot — read their wait time
      const currentCampaign = await db.campaign.findUnique({
        where: { id: campaignId },
        select: { nextSendAt: true },
      })
      const waitMs = currentCampaign?.nextSendAt
        ? Math.max(new Date(currentCampaign.nextSendAt).getTime() - Date.now(), 1000)
        : settings.messageIntervalMin * 1000
      console.debug(`[SendingEngine] Campaign slot already claimed — waiting ${Math.round(waitMs/1000)}s (until ${currentCampaign?.nextSendAt?.toISOString()})`)
      return {
        processed: false,
        delayMs: waitMs,
        remaining: -1,
        completed: false,
        reason: `campaign_interval_wait`,
      }
    }

    console.debug(`[SendingEngine] Campaign slot claimed for ${Math.round(adjustedEstimateMs/1000)}s`)
  }

  // CHECK SENDING WINDOW — don't send outside business hours
  if (antiBanEnabled && !isWithinSendingWindow(settings)) {
    const currentMins = getCurrentMinutes(settings.timezone)
    console.debug(`[SendingEngine] Outside sending window (${currentMins}min, window: ${settings.sendingWindowStart}-${settings.sendingWindowEnd}, tz: ${settings.timezone}). Pausing.`)
    // Release the campaign slot claim with a 1-minute wait (next check)
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
      // Release the campaign slot claim with the break window wait time
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
  // CONTACT-BY-CONTACT PROCESSING
  // ============================================================
  // Process ALL steps for one contact before moving to the next.
  // Messages are created in order: A-step1, A-step2, B-step1, B-step2, ...
  // Using 'id' (auto-increment) preserves creation order even when createdAt is identical.
  //
  // Step 1: Find the NEXT CONTACT to process (earliest pending message by ID)
  // Step 2: Find the NEXT STEP for that contact (lowest stepOrder)
  // This guarantees contact-by-contact ordering: A1→A2→A3 → B1→B2→B3 → ...

  const earliestPending = await db.message.findFirst({
    where: { campaignId, status: 'pending' },
    orderBy: { id: 'asc' },  // id preserves creation order (A1, A2, B1, B2, ...)
    select: { contactId: true },
  })

  if (!earliestPending) {
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
    // When there are no pending messages but some are stuck in "sending",
    // the campaign can never complete. This recovers stale messages so they
    // can be reprocessed or the campaign can be marked as completed.
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
    const recovered = await db.message.updateMany({
      where: { campaignId, status: 'sending', updatedAt: { lt: fiveMinutesAgo } },
      data: { status: 'pending' },
    })
    if (recovered.count > 0) {
      console.debug(`[SendingEngine] Recovered ${recovered.count} stuck "sending" messages during completion check — will reprocess`)
      return { processed: false, delayMs: 1000, remaining: -1, completed: false, reason: 'recovered_stuck_messages' }
    }

    // Messages are genuinely in "sending" state (not stale yet) — wait
    return { processed: false, delayMs: 3000, remaining: stillSending, completed: false, reason: 'message_in_sending_state' }
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
        const failedCount = await db.message.updateMany({
          where: {
            campaignId,
            contactId: message.contactId,
            stepOrder: { gte: message.stepOrder },
            status: 'pending',
          },
          data: { status: 'failed', error: 'Etapa anterior falhou — sequência interrompida' },
        })
        console.debug(`[SendingEngine] Contact ${message.contactId}: previous step failed, skipping ${failedCount.count} remaining steps`)
        const remaining = await db.message.count({ where: { campaignId, status: 'pending' } })
        return { processed: true, delayMs: 1000, remaining, completed: remaining === 0 }
      }

      if (previousStepSending) {
        // Previous step is currently being sent — wait briefly and retry
        const remaining = await db.message.count({ where: { campaignId, status: 'pending' } })
        return { processed: false, delayMs: 2000, remaining, completed: false, reason: 'waiting_for_sending_step' }
      }

      // Previous step not found at all (shouldn't happen) — wait
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
          return {
            processed: false,
            delayMs: waitMs, // Return actual remaining delay — callers MUST wait this
            remaining: -1,
            completed: false,
            reason: `step_delay_${message.stepOrder}`,
          }
        }
      }
    }
  }

  if (!message) {
    // AUTO-COMPLETION FIX: Same recovery logic as above
    // Check for stale "sending" messages and recover them before deciding
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
    const recovered = await db.message.updateMany({
      where: { campaignId, status: 'sending', updatedAt: { lt: fiveMinutesAgo } },
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
      const otherChips = await db.chip.findMany({
        where: {
          id: { not: message.chip.id },
          status: 'connected',
          evolutionInstance: { not: null },
          campaigns: { some: { campaignId } },
        },
      })

      if (otherChips.length > 0) {
        // Reassign pending messages from this chip to other campaign chips (round-robin)
        const pendingMessages = await db.message.findMany({
          where: { campaignId, chipId: message.chip.id, status: 'pending' },
          take: 50,
        })

        for (let i = 0; i < pendingMessages.length; i++) {
          const targetChip = otherChips[i % otherChips.length]
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
      const otherChips = await db.chip.findMany({
        where: {
          id: { not: message.chip.id },
          status: 'connected',
          evolutionInstance: { not: null },
          campaigns: { some: { campaignId } },
        },
      })

      if (otherChips.length > 0) {
        // Reassign pending messages from the banned chip to other campaign chips (round-robin)
        const pendingMessages = await db.message.findMany({
          where: { campaignId, chipId: message.chip.id, status: 'pending' },
          take: 50,
        })

        for (let i = 0; i < pendingMessages.length; i++) {
          const targetChip = otherChips[i % otherChips.length]
          await db.message.update({
            where: { id: pendingMessages[i].id },
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

  // Check hourly limit
  if (antiBanEnabled && settings.hourlyLimit > 0) {
    const hourlySent = currentChip.hourlySent ?? 0
    if (hourlySent >= settings.hourlyLimit) {
      console.debug(`[SendingEngine] Chip ${currentChip.name} hit hourly limit (${hourlySent}/${settings.hourlyLimit}) — waiting`)
      // Release campaign slot claim with 1-minute wait
      await db.campaign.update({ where: { id: campaignId }, data: { nextSendAt: new Date(Date.now() + 60 * 1000) } })
      return {
        processed: false,
        delayMs: 60 * 1000, // Check again in 1 minute
        remaining: -1,
        completed: false,
        reason: `hourly_limit_${currentChip.name}`,
      }
    }
  }

  // ============================================
  // CHECK CHIP nextSendAt — anti-ban interval persistence
  // ============================================
  // Replaces the old "minimum interval" check that only worked for warming chips.
  // Now ALL chips have their interval persisted via nextSendAt, so even when
  // the serverless function timeout truncates a long delay, the next invocation
  // will respect the remaining wait time.
  // This also ensures chips NOT in warming still respect their interval.
  if (antiBanEnabled && currentChip.nextSendAt) {
    const now = Date.now()
    const nextSendTime = new Date(currentChip.nextSendAt).getTime()
    if (nextSendTime > now) {
      const waitMs = nextSendTime - now
      const phase = currentChip.warmingPhase || 'nursery'
      console.debug(`[SendingEngine] Chip ${currentChip.name} (${phase}) nextSendAt not reached — waiting ${Math.round(waitMs/1000)}s (until ${currentChip.nextSendAt!.toISOString()})`)
      // Release campaign slot claim with the chip's wait time
      await db.campaign.update({ where: { id: campaignId }, data: { nextSendAt: new Date(Date.now() + waitMs) } })
      return {
        processed: false,
        delayMs: waitMs,
        remaining: -1,
        completed: false,
        reason: `chip_interval_wait_${currentChip.name}`,
      }
    }
  }

  // Check daily limit (with warming mode multiplier)
  const effectiveLimit = getEffectiveDailyLimit(currentChip, settings, warmingMode)
  if (antiBanEnabled && currentChip.sentToday >= effectiveLimit) {
    console.debug(`[SendingEngine] Chip ${currentChip.name} hit daily limit (${currentChip.sentToday}/${effectiveLimit}) — reassigning messages to other chips`)

    // Find other connected chips that BELONG to this campaign (via CampaignChip)
    const otherChips = await db.chip.findMany({
      where: {
        id: { not: currentChip.id },
        status: 'connected',
        evolutionInstance: { not: null },
        campaigns: { some: { campaignId } },
      },
    })

    if (otherChips.length > 0) {
      // Reassign up to 50 pending messages from this chip to other chips (round-robin)
      const pendingMessages = await db.message.findMany({
        where: { campaignId, chipId: currentChip.id, status: 'pending' },
        take: 50,
      })

      for (let i = 0; i < pendingMessages.length; i++) {
        const targetChip = otherChips[i % otherChips.length]
        await db.message.update({
          where: { id: pendingMessages[i].id },
          data: { chipId: targetChip.id },
        })
      }

      console.debug(`[SendingEngine] Reassigned ${pendingMessages.length} messages from ${currentChip.name} to other chips`)

      // Return with short delay so we can try processing again with the reassigned messages
      const remaining = await db.message.count({ where: { campaignId, status: 'pending' } })
      // Release campaign slot claim with short delay (messages were reassigned)
      await db.campaign.update({ where: { id: campaignId }, data: { nextSendAt: new Date(Date.now() + 1000) } })
      return { processed: false, delayMs: 1000, remaining, completed: remaining === 0, reason: `daily_limit_reassigned_${currentChip.name}` }
    }

    // No other chips available — truly stuck
    // Release campaign slot claim with 1-minute wait
    await db.campaign.update({ where: { id: campaignId }, data: { nextSendAt: new Date(Date.now() + 60 * 1000) } })
    return {
      processed: false,
      delayMs: 60 * 1000,
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

      // Release campaign slot claim with the cooldown wait time
      await db.campaign.update({ where: { id: campaignId }, data: { nextSendAt: new Date(Date.now() + waitMs) } })
      return {
        processed: false,
        delayMs: waitMs,
        remaining: -1,
        completed: false,
        reason: 'cooldown',
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
  const claimed = await db.message.updateMany({
    where: { id: message.id, status: 'sending' },
    data: { status: 'sending' },  // No-op update to verify claim is still valid
  })

  if (claimed.count === 0) {
    // Message was recovered/reset by another process — skip it
    console.debug(`[SendingEngine] Message ${message.id} claim lost (no longer in 'sending'), skipping`)
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
    // ANTI-BAN: DELAYED OFFLINE with jitter
    // ============================================
    // After the message is sent, the human doesn't go offline instantly.
    // They stay online for a while (reading reply, checking other chats),
    // THEN close WhatsApp. This delay+jitter makes the pattern natural.
    //
    // OLD: setPresence('unavailable', 0) — instant offline (bot signature)
    // NEW: stay online 3-15s (gaussian) → then go offline
    let offlineDelayMs = 0
    if (antiBanEnabled) {
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
    let readingTimeMs = 0
    if (antiBanEnabled) {
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

    // Increment chip counter (daily + hourly)
    // Also set warmingStartedAt on first-ever send (if not already set)
    await db.chip.update({
      where: { id: message.chipId },
      data: {
        sentToday: { increment: 1 },
        hourlySent: { increment: 1 },
        lastSeen: new Date(),
        // Set warmingStartedAt on first send — warming clock starts from here, not from registration
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
    if (antiBanEnabled && settings.cooldownAfterMessages > 0 && settings.cooldownMinutes > 0) {
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
    // INTERVAL FLOOR — with cluster micro-pause exception
    // ============================================
    // The messageIntervalMin floor prevents sending too fast.
    //
    // For after-cluster pauses and normal gaussian intervals, the floor applies normally.
    // For cluster micro-pauses, we apply a PROPORTIONAL floor instead of the full
    // messageIntervalMin. The micro-pause should be a fraction of the normal interval
    // to create a natural burst pattern, but NOT so short that it triggers WhatsApp spam
    // detection. The floor is 25-35% of messageIntervalMin (minimum 10s), which for a
    // 59s minimum gives a micro-pause floor of ~15s — fast enough to look like a burst
    // but slow enough to not look automated.
    if (isClusterMicroPause) {
      // Cluster micro-pause: proportional floor (25-35% of intervalMin, min 10s)
      // This creates a natural burst without triggering spam detection
      const microPauseFloorMs = Math.max(10000, Math.round(settings.messageIntervalMin * 1000 * 0.3))
      nextDelay = Math.max(nextDelay, microPauseFloorMs)
    } else {
      // Normal interval or after-cluster pause: apply messageIntervalMin floor
      nextDelay = Math.max(nextDelay, settings.messageIntervalMin * 1000)
    }

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
          const delivered = sample.filter(m => m.status === 'delivered' || m.status === 'read').length
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
    // For READY chips with cluster micro-pauses: SKIP the phase floor.
    // Ready chips are trusted to use human-like burst patterns safely.
    // The cluster micro-pause (3-8s) + after-cluster pause (30-90s) averages
    // out to a safe rate over time, and the burst pattern looks natural.
    if (antiBanEnabled) {
      const effectiveMinInterval = getMinimumIntervalForChip(currentChip, settings)
      const minIntervalMs = effectiveMinInterval * 1000
      const chipPhase = currentChip.warmingPhase || 'ready'

      // Only enforce the phase floor for:
      // 1. Non-micro-pause delays (normal gaussian, after-cluster)
      // 2. Nursery/prewarm chips even with micro-pauses (safety first for new chips)
      // For ready chips with micro-pauses: the burst pattern is safe and natural.
      const shouldEnforcePhaseFloor = !isClusterMicroPause || chipPhase !== 'ready'

      if (shouldEnforcePhaseFloor && nextDelay < minIntervalMs) {
        console.debug(`[SendingEngine] Chip ${currentChip.name} (${chipPhase}): bumping delay from ${Math.round(nextDelay/1000)}s to minimum ${Math.round(minIntervalMs/1000)}s`)
        nextDelay = minIntervalMs
      } else if (isClusterMicroPause && chipPhase === 'ready') {
        console.debug(`[SendingEngine] Chip ${currentChip.name} (ready): cluster micro-pause ${Math.round(nextDelay/1000)}s — skipping phase floor for natural burst pattern`)
      }
    }

    // ============================================
    // PERSIST nextSendAt ON CHIP AND CAMPAIGN
    // ============================================
    // This OVERWRITES the estimated claim from the atomic slot claim above
    // with the ACTUAL calculated delay (which accounts for offline/reading time,
    // warming minimums, and mode multipliers).
    const chipNextSendAt = new Date(Date.now() + nextDelay)
    const campaignNextSendAt = new Date(Date.now() + nextDelay)

    // Persist chip nextSendAt — this chip cannot send again until this time
    await db.chip.update({
      where: { id: message.chipId },
      data: { nextSendAt: chipNextSendAt },
    })

    // Persist campaign nextSendAt — overwrite the claim estimate with the actual delay
    // This prevents multiple chips from sending for the same campaign in rapid succession
    await db.campaign.update({
      where: { id: campaignId },
      data: { nextSendAt: campaignNextSendAt },
    })

    console.debug(`[SendingEngine] Next delay: ${Math.round(nextDelay/1000)}s — chip ${currentChip.name} nextSendAt=${chipNextSendAt.toISOString()}, campaign nextSendAt=${campaignNextSendAt.toISOString()}`)

    const remaining = await db.message.count({ where: { campaignId, status: 'pending' } })

    return { processed: true, delayMs: nextDelay, remaining, completed: remaining === 0 }

  } catch (error: any) {
    console.error(`[SendingEngine] Failed to send message ${message.id}:`, error.message)

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
          campaigns: { some: { campaignId } },
        },
      })

      if (otherChips.length > 0) {
        // Reassign pending messages (round-robin)
        const pendingMessages = await db.message.findMany({
          where: { campaignId, chipId: message.chipId, status: 'pending' },
          take: 50,
        })
        for (let i = 0; i < pendingMessages.length; i++) {
          const targetChip = otherChips[i % otherChips.length]
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
    // GENERIC ERROR HANDLING (non-ban errors)
    // ============================================
    await db.message.update({
      where: { id: message.id },
      data: {
        status: 'failed',
        error: errorMsg.substring(0, 500),
      },
    })

    // Release the campaign slot claim with a retry delay based on user settings
    // Previously hardcoded to 5000ms (5s) — now respects the configured minimum interval.
    const errorRetryDelayMs = settings.messageIntervalMin * 1000
    if (antiBanEnabled) {
      await db.campaign.update({
        where: { id: campaignId },
        data: { nextSendAt: new Date(Date.now() + errorRetryDelayMs) },
      })
    }

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
  const result = await processNextMessage(campaignId)
  return {
    processed: result.processed ? 1 : 0,
    succeeded: result.processed ? 1 : 0,
    failed: 0,
    skipped: 0,
  }
}

/**
 * Recover stuck "sending" messages — messages that were marked as "sending"
 * but never completed (server crash, timeout, etc.). Resets them to "pending"
 * so they can be reprocessed. Should be called before processing.
 */
export async function recoverStuckMessages(campaignId?: string): Promise<number> {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)

    const where: Record<string, unknown> = {
      status: 'sending',
      updatedAt: { lt: fiveMinutesAgo },
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
 * H5 FIX: Release orphaned campaign slots.
 *
 * When a process claims a campaign slot (sets nextSendAt) and then crashes or
 * times out before completing, the slot remains "locked" forever — nextSendAt
 * is set to a time in the future, and no new messages can be sent for that campaign.
 *
 * This function finds campaign slots that have been held for too long (more than
 * SLOT_STALE_THRESHOLD_MS) and releases them by setting nextSendAt = null.
 *
 * Threshold: 10 minutes — generous enough to allow for long anti-ban intervals
 * (up to ~5 min), but short enough to prevent campaigns from getting stuck.
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

  // Find all connected chips
  const connectedChips = await db.chip.findMany({
    where: {
      status: 'connected',
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
