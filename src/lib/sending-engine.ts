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
import { db } from './db'
import type { Chip } from '@prisma/client'
import { NURSERY_SCHEDULE, PREWARM_SCHEDULE, WARMING_MODE_MULTIPLIERS, type ScheduleEntry, type BreakWindow } from './constants'
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
}

// ============================================================
// TWO-PHASE WARMING SCHEDULE
// ============================================================
// Phase 1: Nursery (Berçário) — chip novo, 14 dias
// Phase 2: Prewarm (Pré-aquecido) — chip já passou pelo berçário, 20 dias
// After both phases: chip is "ready" with no limit restriction
// Phase 3: Ready (Aquecido) — chip fully warmed, configurable daily limit

// Typing speed: characters per second (human average is 5-15 for mobile)
const TYPING_SPEED_MIN = 6    // chars/second (slow typer)
const TYPING_SPEED_MAX = 14   // chars/second (fast typer)
const TYPING_MIN_MS = 3000    // minimum typing time (3 seconds even for short messages)
const TYPING_MAX_MS = 25000   // maximum typing time (25 seconds — avoids Vercel timeout)
const TYPING_PAUSE_CHANCE = 0.3  // 30% chance of a mid-typing pause (simulates thinking)

// ============================================================
// PRESENCE HUMANIZATION CONSTANTS
// ============================================================
// Humans don't go offline instantly after sending a message.
// They stay online for a while, maybe read other chats, then go offline.
// These constants control the delayed-offline behavior.
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
const IDLE_READING_COOLDOWN_CHANCE = 0.4   // 40% chance of appearing online during cooldown

const DEFAULT_SETTINGS: AntiBanConfig = {
  typingMinDelay: 3000,
  typingMaxDelay: 15000,
  messageIntervalMin: 30,
  messageIntervalMax: 90,
  dailyLimitPerChip: 200,
  warmingEnabled: true,
  cooldownMinutes: 30,
  cooldownMinutesMax: 30,
  cooldownAfterMessages: 50,
  cooldownAfterMessagesMax: 50,
  stopOnWarning: true,
  sendingWindowStart: 480,  // 8:00 in minutes-from-midnight
  sendingWindowEnd: 1260,   // 21:00 in minutes-from-midnight
  timezone: 'America/Sao_Paulo',
  nurserySchedule: NURSERY_SCHEDULE,
  prewarmSchedule: PREWARM_SCHEDULE,
  readyDailyLimit: 200,
  hourlyLimit: 30,
  breakWindows: [],
  linkPreviewEnabled: false,  // Default OFF — link previews in bulk are a bot signature
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
 * - Short messages get minimum 3 seconds
 * - Long messages cap at 25 seconds (Vercel timeout safety)
 */
function calculateTypingDuration(text: string): number {
  const charCount = text.length
  // Gaussian typing speed: most people type ~10 chars/s on mobile
  // with standard deviation of 2.5 chars/s
  const typingSpeed = gaussianRandomFloat(10, 2.5, TYPING_SPEED_MIN, TYPING_SPEED_MAX)
  let durationMs = (charCount / typingSpeed) * 1000

  // Clamp to reasonable bounds
  durationMs = Math.max(TYPING_MIN_MS, Math.min(TYPING_MAX_MS, durationMs))

  // 30% chance of a "thinking pause" (1-4 seconds)
  if (Math.random() < TYPING_PAUSE_CHANCE) {
    durationMs += randomInt(1000, 4000)
  }

  return Math.round(durationMs)
}

/**
 * Check if current time is within the sending window
 */
function isWithinSendingWindow(settings: AntiBanConfig): boolean {
  const currentMins = getCurrentMinutes(settings.timezone)
  const start = toMins(settings.sendingWindowStart)
  const end = toMins(settings.sendingWindowEnd)

  if (start <= end) {
    // Same day window: e.g., 8:00-21:00
    return currentMins >= start && currentMins < end
  } else {
    // Overnight window: e.g., 22:00-06:00
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
  // Beyond schedule: return the max limit from the last entry
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
  if (!chip.warmingEnabled || !settings.warmingEnabled) return 0

  const phase = chip.warmingPhase || 'nursery'

  if (phase === 'ready') {
    // Ready/aquecido: use the normal interval from settings (minimum of intervalMin)
    return settings.messageIntervalMin
  }

  // The daily limit already controls HOW MANY messages can be sent per day.
  // This minimum interval is just a safety floor to prevent burst sending.
  // Use the user's configured interval, but with a minimum floor for warming chips.
  const userInterval = settings.messageIntervalMin

  if (phase === 'nursery') {
    // Nursery: minimum 2 minutes (120 seconds) — but respect user interval if higher
    return Math.max(120, userInterval)
  } else {
    // Prewarm: minimum 60 seconds — but respect user interval if higher
    return Math.max(60, userInterval)
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
    // prewarm phase — use warmingStartedAt as reference
    dayInPhase = Math.floor((now.getTime() - warmingStart.getTime()) / (1000 * 60 * 60 * 24)) + 1
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
        // Link preview — read from DB, default OFF for anti-ban
        linkPreviewEnabled: false,  // Always OFF for anti-ban — link previews in bulk are detectable
      }
    }
  } catch {
    // Use defaults
  }
  return DEFAULT_SETTINGS
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
 * @param instanceName Evolution API instance name
 * @param jid WhatsApp JID to signal presence to (contact)
 * @returns Duration spent "reading" in ms (0 if skipped)
 */
async function performIdleReadingPresence(
  instanceName: string,
  jid: string
): Promise<number> {
  // Only do idle reading with configured probability
  if (Math.random() > IDLE_READING_CHANCE) return 0

  // Gaussian duration for "reading" — most people read for ~4s, rarely <2s or >8s
  const readingMs = gaussianRandom(
    (IDLE_READING_DURATION_MIN_MS + IDLE_READING_DURATION_MAX_MS) / 2,
    (IDLE_READING_DURATION_MAX_MS - IDLE_READING_DURATION_MIN_MS) / 6,
    IDLE_READING_DURATION_MIN_MS,
    IDLE_READING_DURATION_MAX_MS
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
  jid: string
): Promise<number> {
  // Gaussian delay before going offline
  // Mean ~8s, most between 3-15s, rare outside that range
  const delayMs = gaussianRandom(
    (OFFLINE_DELAY_MIN_MS + OFFLINE_DELAY_MAX_MS) / 2,
    (OFFLINE_DELAY_MAX_MS - OFFLINE_DELAY_MIN_MS) / 6,
    OFFLINE_DELAY_MIN_MS,
    OFFLINE_DELAY_MAX_MS
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
    // Check if nursery period is complete (14 days)
    if (daysSinceCreation > 14) {
      // Transition to prewarm phase
      await db.chip.update({
        where: { id: chipId },
        data: {
          warmingPhase: 'prewarm',
          prewarmStartedAt: now,
          warmingStage: 5, // Legacy compat
        },
      })
      console.debug(`[SendingEngine] Chip ${chip.name} graduated from NURSERY → PREWARM (day ${daysSinceCreation})`)
    }
  } else if (phase === 'prewarm') {
    // Check if prewarm period is complete (20 days from prewarmStartedAt)
    const prewarmStart = chip.prewarmStartedAt ? new Date(chip.prewarmStartedAt) : createdAt
    const daysSincePrewarm = Math.floor((now.getTime() - prewarmStart.getTime()) / (1000 * 60 * 60 * 24)) + 1
    
    if (daysSincePrewarm > 20) {
      // Transition to ready
      await db.chip.update({
        where: { id: chipId },
        data: {
          warmingPhase: 'ready',
          warmingStage: 6, // Legacy compat — beyond old max
        },
      })
      console.debug(`[SendingEngine] Chip ${chip.name} graduated from PREWARM → READY (prewarm day ${daysSincePrewarm})`)
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

async function detectChipBan(chip: ChipBanInfo): Promise<{ banned: boolean; reason: string; disconnected: boolean }> {
  // Check chip status first (fast)
  // IMPORTANT: "disconnected" is NOT the same as "banned"!
  // A chip that's disconnected might just need reconnection — don't block the campaign entirely.
  if (chip.status === 'banned') {
    return { banned: true, reason: `Chip status: banned`, disconnected: false }
  }

  if (chip.status === 'disconnected') {
    // Chip is disconnected — not banned, but can't send right now.
    // Return disconnected=true so the caller can skip to next chip instead of blocking.
    return { banned: false, reason: `Chip status: disconnected`, disconnected: true }
  }

  // Check disconnection reason code
  // WhatsApp ban codes: 401 (logged out), 403 (banned), 428 (replaced), 440 (device removed)
  const BAN_CODES = [401, 403, 428, 440]
  if (chip.disconnectionReasonCode && BAN_CODES.includes(chip.disconnectionReasonCode)) {
    return { banned: true, reason: `Disconnection code: ${chip.disconnectionReasonCode}`, disconnected: false }
  }

  // Try to get live connection state from Evolution API
  if (chip.evolutionInstance) {
    try {
      const state = await routerGetConnectionState(chip.evolutionInstance)
      const instanceState = state?.state
      if (instanceState === 'close') {
        // 'close' can mean temporary disconnection OR ban — check disconnection code
        // Only treat as banned if we have a known ban code; otherwise treat as disconnected
        const BAN_CODES = [401, 403, 428, 440]
        if (chip.disconnectionReasonCode && BAN_CODES.includes(chip.disconnectionReasonCode)) {
          return { banned: true, reason: `Evolution API state: close (ban code: ${chip.disconnectionReasonCode})`, disconnected: false }
        }
        // No ban code — treat as temporary disconnection, not a ban
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
 * Check for WhatsApp warning messages in the inbox.
 * WhatsApp sends warning messages from specific JIDs when an account is at risk.
 */
async function checkForWarnings(chipId: string): Promise<boolean> {
  try {
    const chip = await db.chip.findUnique({ where: { id: chipId } })
    if (!chip?.evolutionInstance) return false

    // Check for recent warning messages from WhatsApp
    // WhatsApp official JIDs: status@broadcast, server@whatsapp.com
    const WARNING_SENDERS = ['status@broadcast', 'server@whatsapp.com']
    const WARNING_KEYWORDS = ['segurança', 'suspeita', 'violação', 'banimento', 'restrição', 'security', 'violation', 'restricted', 'banned', 'warning', 'alerta', 'aviso']

    const recentWarnings = await db.inboxMessage.findMany({
      where: {
        instanceName: chip.evolutionInstance,
        fromMe: false,
        remoteJid: { in: WARNING_SENDERS },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // last 24h
      },
      take: 10,
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
const lastUsedVariation = new Map<string, number>()

function resolveKeyBlocks(text: string): string {
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
        result = result.replace(new RegExp(`\\{\\{${key.name}\\}\\}`, 'g'), chosen)
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

  // Create messages for ALL steps in the sequence
  // For multi-step: each contact gets one message per step, processed in order
  const messagesToCreate: { campaignId: string; chipId: string; contactId: string; content: string; status: "pending"; stepOrder: number; mediaUrl: string | null; mediatype: string | null }[] = []
  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i]
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

  // Get campaign anti-ban settings
  const campaignInfo = await db.campaign.findUnique({
    where: { id: campaignId },
    select: { antiBanEnabled: true, warmingMode: true, sendIntervalMin: true, sendIntervalMax: true, nextSendAt: true },
  })
  const antiBanEnabled = campaignInfo?.antiBanEnabled ?? true
  const warmingMode = campaignInfo?.warmingMode || 'normal'
  // Use campaign-specific interval if available, otherwise fall back to global settings
  const campaignIntervalMin = campaignInfo?.sendIntervalMin
  const campaignIntervalMax = campaignInfo?.sendIntervalMax

  const settings = await getAntiBanSettings()

  // ============================================
  // CHECK CAMPAIGN nextSendAt — anti-ban interval persistence
  // ============================================
  // If the campaign has a nextSendAt in the future, we must wait.
  // This persists the interval across serverless invocations (Vercel Cron).
  // Without this, when the function timeout truncates a 60s delay to only 20s,
  // the next cron tick would immediately send another message.
  if (antiBanEnabled && campaignInfo?.nextSendAt) {
    const now = Date.now()
    const nextSendTime = new Date(campaignInfo.nextSendAt).getTime()
    if (nextSendTime > now) {
      const waitMs = nextSendTime - now
      console.debug(`[SendingEngine] Campaign nextSendAt not reached — waiting ${Math.round(waitMs/1000)}s (until ${campaignInfo.nextSendAt.toISOString()})`)
      return {
        processed: false,
        delayMs: waitMs,
        remaining: -1,
        completed: false,
        reason: `campaign_interval_wait`,
      }
    }
  }

  // CHECK SENDING WINDOW — don't send outside business hours
  if (antiBanEnabled && !isWithinSendingWindow(settings)) {
    const currentMins = getCurrentMinutes(settings.timezone)
    const startMins = toMins(settings.sendingWindowStart)
    const endMins = toMins(settings.sendingWindowEnd)
    console.debug(`[SendingEngine] Outside sending window (${currentMins}min, window: ${startMins}-${endMins}). Pausing.`)
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

    return { processed: false, delayMs: 3000, remaining: stillSending, completed: false, reason: 'message_in_sending_state' }
  }

  const targetContactId = earliestPending.contactId

  // Find the next pending step for THIS contact (lowest stepOrder first)
  const message = await db.message.findFirst({
    where: { campaignId, contactId: targetContactId, status: 'pending' },
    include: { chip: true, contact: true },
    orderBy: { stepOrder: 'asc' },
  })

  if (!message) {
    // No more pending messages for this contact — might have been picked up by another process
    return { processed: false, delayMs: 1000, remaining: -1, completed: false, reason: 'no_pending_message' }
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
    const banCheck = await detectChipBan(message.chip)

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

      // No other campaign chips available — pause the campaign and notify
      console.debug(`[SendingEngine] No other campaign chips available for disconnected chip ${message.chip.name} — pausing campaign`)

      await db.message.update({
        where: { id: message.id },
        data: { status: 'failed', error: `Chip desconectado: ${banCheck.reason} — nenhum outro chip na campanha` },
      })

      // Pause the campaign — no other chips in this campaign to send
      await db.campaign.update({
        where: { id: campaignId },
        data: {
          status: 'paused',
          statusReason: `Pausada automaticamente: chip ${message.chip.name} desconectou e não há outros chips disponíveis na campanha`,
          pausedAt: new Date(),
          nextSendAt: null,
        },
      })
      console.debug(`[SendingEngine] Campaign ${campaignId} PAUSED — chip ${message.chip.name} disconnected, no other campaign chips available`)
      return { processed: false, delayMs: 0, remaining: -1, completed: false, reason: 'auto_paused_no_campaign_chips', events: [{ type: 'chip_disconnected', chipName: message.chip.name }, { type: 'campaign_auto_paused', reason: 'Chip desconectou e não há outros chips disponíveis' }] }
    }

    if (banCheck.banned) {
      console.debug(`[SendingEngine] Chip ${message.chip.name} appears BANNED: ${banCheck.reason}`)

      // Update chip status to banned
      await db.chip.update({
        where: { id: message.chip.id },
        data: { status: 'banned' },
      })

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
    const hasWarning = await checkForWarnings(message.chip.id)
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
      return { processed: false, delayMs: 1000, remaining, completed: remaining === 0, reason: `daily_limit_reassigned_${currentChip.name}` }
    }

    // No other chips available — truly stuck
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
  // CRITICAL: Atomically claim this message to prevent duplicates
  // Use updateMany with status='pending' filter — only claims if still pending
  // If another process already claimed it, this returns count=0 and we skip
  // This MUST be done right before sending, after all checks pass
  // ============================================================
  const claimed = await db.message.updateMany({
    where: { id: message.id, status: 'pending' },
    data: { status: 'sending' },
  })

  if (claimed.count === 0) {
    // Message was already claimed by another concurrent process — skip it
    console.debug(`[SendingEngine] Message ${message.id} already claimed by another process, skipping`)
    return { processed: false, delayMs: 500, remaining: -1, completed: false, reason: 'message_already_claimed' }
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
      try {
        await routerSetPresence(instanceName, `${formattedPhone}@s.whatsapp.net`, 'available', 1000)
      } catch {
        // Non-fatal — presence is best-effort
      }
      // Brief pause to let "online" status register before composing starts
      await new Promise(resolve => setTimeout(resolve, gaussianRandom(1500, 500, 800, 3000)))

      // Determine presence type based on message content
      const hasMedia = !!(message.mediaUrl && message.mediatype)
      const validMediaTypes = ['image', 'document', 'video', 'audio']
      const isMediaType = hasMedia && validMediaTypes.includes(message.mediatype as string)
      const isAudio = message.mediatype === 'audio'

      if (isMediaType) {
        // Media messages: use "recording" presence (shows 📷/🎙️ indicator)
        const mediaDurationMs = isAudio
          ? calculateTypingDuration(message.content)
          : randomInt(2000, 4000)

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
        const totalTypingMs = calculateTypingDuration(message.content)
        const jid = `${formattedPhone}@s.whatsapp.net`

        // Decide if this message will have mid-composition pauses
        // 40% chance for longer messages (>100 chars), 20% for shorter
        const shouldPauseMidType = message.content.length > 100
          ? Math.random() < 0.4
          : Math.random() < 0.2

        if (shouldPauseMidType && totalTypingMs > 6000) {
          // Split typing into 2-3 segments with pauses between
          const segments = Math.random() < 0.3 ? 3 : 2
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
              const pauseMs = gaussianRandom(2000, 800, 800, 5000)
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
    console.debug(`[SendingEngine] Sending message ${message.id} step=${message.stepOrder} to ${formattedPhone}: mediaUrl=${message.mediaUrl || 'null'} mediatype=${message.mediatype || 'null'} content="${finalContent.substring(0, 80)}..."`)

    let result
    if (message.mediaUrl && message.mediatype) {
      const validMediaTypes = ['image', 'document', 'video', 'audio']
      const mt = message.mediatype as 'image' | 'document' | 'video' | 'audio'
      if (validMediaTypes.includes(mt)) {
        // Validate media URL before sending — check if the URL is accessible
        try {
          const urlCheck = await fetch(message.mediaUrl, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
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
      offlineDelayMs = await delayedOfflineWithJitter(instanceName, jid)
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
      const intervalMin = campaignIntervalMin ?? settings.messageIntervalMin
      const intervalMax = campaignIntervalMax ?? settings.messageIntervalMax
      const avgInterval = (intervalMin + intervalMax) / 2
      if (avgInterval >= IDLE_READING_INTERVAL_MIN_S) {
        readingTimeMs = await performIdleReadingPresence(instanceName, `${formattedPhone}@s.whatsapp.net`)
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
          // Variable cooldown duration: gaussian-distributed
          const cooldownMin = settings.cooldownMinutes
          const cooldownMax = Math.max(settings.cooldownMinutesMax, settings.cooldownMinutes)
          const cooldownDuration = gaussianRandom(
            Math.round((cooldownMin + cooldownMax) / 2),
            (cooldownMax - cooldownMin) / 6,
            cooldownMin,
            cooldownMax
          )

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
    // IMPORTANT: Subtract the offline delay and reading time from the interval
    // so the total time between messages stays consistent with settings.
    // Without this, adding 3-15s offline delay + 2-8s reading would make
    // the effective interval much longer than configured.
    const intervalMin = campaignIntervalMin ?? settings.messageIntervalMin
    const intervalMax = campaignIntervalMax ?? settings.messageIntervalMax
    let nextDelay = gaussianDelaySeconds(intervalMin, intervalMax) * 1000

    // Subtract time already spent in delayed-offline and idle-reading
    // Clamp to minimum 5s to avoid sending too fast
    const alreadySpentMs = offlineDelayMs + readingTimeMs
    nextDelay = Math.max(nextDelay - alreadySpentMs, 5000)

    const modeMultiplier = WARMING_MODE_MULTIPLIERS[warmingMode]
    if (modeMultiplier && antiBanEnabled) {
      nextDelay = Math.round(nextDelay * modeMultiplier.intervalMultiplier)
    }

    // ============================================
    // ENFORCE WARMING PHASE MINIMUM INTERVAL
    // ============================================
    // For nursery/prewarm chips, the interval must be at least the phase minimum.
    // This is applied AFTER the gaussian calculation and mode multiplier,
    // ensuring that warming chips NEVER send faster than their phase allows.
    if (antiBanEnabled && currentChip.warmingEnabled && settings.warmingEnabled) {
      const minIntervalMs = getMinimumIntervalForChip(currentChip, settings) * 1000
      if (nextDelay < minIntervalMs) {
        console.debug(`[SendingEngine] Chip ${currentChip.name} (${currentChip.warmingPhase}): bumping delay from ${Math.round(nextDelay/1000)}s to warming minimum ${Math.round(minIntervalMs/1000)}s`)
        nextDelay = minIntervalMs
      }
    }

    // ============================================
    // PERSIST nextSendAt ON CHIP AND CAMPAIGN
    // ============================================
    // This is the KEY fix for the anti-ban jitter not working:
    // The delay is now saved to the database so that when the serverless
    // function times out and the next cron tick runs, it will see that
    // the chip/campaign cannot send yet and will wait.
    const chipNextSendAt = new Date(Date.now() + nextDelay)
    const campaignNextSendAt = new Date(Date.now() + nextDelay)

    // Persist chip nextSendAt — this chip cannot send again until this time
    await db.chip.update({
      where: { id: message.chipId },
      data: { nextSendAt: chipNextSendAt },
    })

    // Persist campaign nextSendAt — this campaign cannot send ANY message until this time
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

    await db.message.update({
      where: { id: message.id },
      data: {
        status: 'failed',
        error: error.message?.substring(0, 500),
      },
    })

    const remaining = await db.message.count({ where: { campaignId, status: 'pending' } })
    return { processed: true, delayMs: 5000, remaining, completed: remaining === 0 }
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
 * Get all running campaigns that need processing.
 * Also recovers any stuck "sending" messages before returning.
 */
export async function getRunningCampaigns(): Promise<string[]> {
  // Recover stuck messages across all running campaigns (best-effort)
  try {
    await recoverStuckMessages()
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

  // Only do reading presence ~40% of the time (not every cron tick)
  if (Math.random() > IDLE_READING_COOLDOWN_CHANCE) return 0

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

    // 30% chance per chip — not all chips go online at the same time
    if (Math.random() > 0.3) continue

    try {
      // Gaussian reading duration: 2-8s, mean ~5s
      const readingMs = gaussianRandom(
        (IDLE_READING_DURATION_MIN_MS + IDLE_READING_DURATION_MAX_MS) / 2,
        (IDLE_READING_DURATION_MAX_MS - IDLE_READING_DURATION_MIN_MS) / 6,
        IDLE_READING_DURATION_MIN_MS,
        IDLE_READING_DURATION_MAX_MS
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
      await new Promise(resolve => setTimeout(resolve, randomInt(500, 2000)))
    } catch {
      // Non-fatal
    }
  }

  return readingCount
}
