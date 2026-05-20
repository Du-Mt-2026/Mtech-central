// Sending Engine with Anti-Ban Protection v2.0
// ==============================================
// Realistic human behavior: typing proportional to message length,
// random line breaks, emoji variation, ban detection, auto-warming.
// Serverless-compatible: processes messages with real delays.
// Vercel Cron calls /api/campaigns/process-all every minute.

import { sendTextMessage, sendMediaMessage, setPresence, formatPhoneNumber, getConnectionState } from './evolution-api'
import { db } from './db'

// ============================================================
// TYPES & CONSTANTS
// ============================================================

interface ScheduleEntry {
  dayRange: string
  days: [number, number]
  limit: number
}

interface AntiBanConfig {
  typingMinDelay: number
  typingMaxDelay: number
  messageIntervalMin: number
  messageIntervalMax: number
  dailyLimitPerChip: number
  warmingEnabled: boolean
  warmingDays: number
  cooldownMinutes: number
  cooldownAfterMessages: number
  stopOnWarning: boolean
  randomLineBreaks: boolean
  emojiVariation: boolean
  sendingWindowStart: number  // minutos desde meia-noite (0-1440), default 480 (8:00)
  sendingWindowEnd: number    // minutos desde meia-noite (0-1440), default 1260 (21:00)
  timezone: string            // fuso horário, default 'America/Sao_Paulo'
  // Editable schedules loaded from DB
  nurserySchedule: ScheduleEntry[]
  prewarmSchedule: ScheduleEntry[]
  readyDailyLimit: number     // Phase 3 (Aquecido) daily limit per chip
  hourlyLimit: number         // Max messages per hour per chip
}

// ============================================================
// TWO-PHASE WARMING SCHEDULE
// ============================================================
// Phase 1: Nursery (Berçário) — chip novo, 14 dias
// Phase 2: Prewarm (Pré-aquecido) — chip já passou pelo berçário, 20 dias
// After both phases: chip is "ready" with no limit restriction
// Phase 3: Ready (Aquecido) — chip fully warmed, configurable daily limit

export const NURSERY_SCHEDULE: { dayRange: string; days: [number, number]; limit: number }[] = [
  { dayRange: '1-2',   days: [1, 2],   limit: 10 },
  { dayRange: '3-4',   days: [3, 4],   limit: 20 },
  { dayRange: '5-6',   days: [5, 6],   limit: 30 },
  { dayRange: '7-8',   days: [7, 8],   limit: 40 },
  { dayRange: '9-10',  days: [9, 10],  limit: 50 },
  { dayRange: '11-12', days: [11, 12], limit: 60 },
  { dayRange: '13-14', days: [13, 14], limit: 80 },
]

export const PREWARM_SCHEDULE: { dayRange: string; days: [number, number]; limit: number }[] = [
  { dayRange: '1',   days: [1, 1],   limit: 11 },
  { dayRange: '2',   days: [2, 2],   limit: 15 },
  { dayRange: '3',   days: [3, 3],   limit: 20 },
  { dayRange: '4',   days: [4, 4],   limit: 25 },
  { dayRange: '5',   days: [5, 5],   limit: 30 },
  { dayRange: '6',   days: [6, 6],   limit: 35 },
  { dayRange: '7',   days: [7, 7],   limit: 40 },
  { dayRange: '8',   days: [8, 8],   limit: 45 },
  { dayRange: '9',   days: [9, 9],   limit: 50 },
  { dayRange: '10',  days: [10, 10], limit: 60 },
  { dayRange: '11',  days: [11, 11], limit: 70 },
  { dayRange: '12',  days: [12, 12], limit: 80 },
  { dayRange: '13',  days: [13, 13], limit: 90 },
  { dayRange: '14',  days: [14, 14], limit: 100 },
  { dayRange: '15',  days: [15, 15], limit: 120 },
  { dayRange: '16',  days: [16, 16], limit: 140 },
  { dayRange: '17',  days: [17, 17], limit: 160 },
  { dayRange: '18',  days: [18, 18], limit: 180 },
  { dayRange: '19',  days: [19, 19], limit: 190 },
  { dayRange: '20',  days: [20, 20], limit: 200 },
]

// Legacy warming schedule (kept for backward compat with old chips)
const WARMING_LIMITS = [10, 30, 80, 150, 200]

// Warming mode multipliers
const WARMING_MODE_MULTIPLIERS: Record<string, { intervalMultiplier: number; limitMultiplier: number }> = {
  normal: { intervalMultiplier: 1, limitMultiplier: 1 },
  agressive: { intervalMultiplier: 0.5, limitMultiplier: 1.5 },
  stealth: { intervalMultiplier: 2, limitMultiplier: 0.6 },
}

// Typing speed: characters per second (human average is 5-15 for mobile)
const TYPING_SPEED_MIN = 6    // chars/second (slow typer)
const TYPING_SPEED_MAX = 14   // chars/second (fast typer)
const TYPING_MIN_MS = 3000    // minimum typing time (3 seconds even for short messages)
const TYPING_MAX_MS = 25000   // maximum typing time (25 seconds — avoids Vercel timeout)
const TYPING_PAUSE_CHANCE = 0.3  // 30% chance of a mid-typing pause (simulates thinking)

// Common emoji swaps for variation
const EMOJI_SWAPS: Record<string, string[]> = {
  '🙂': ['😊', '😄', '🙂', '😃'],
  '😊': ['🙂', '😄', '😊', '😃'],
  '👍': ['👌', '👍', '🤝', '👏'],
  '❤️': ['💜', '🧡', '❤️', '💙'],
  '😎': ['🤓', '😎', '😄', '🤩'],
  '🤦': ['😅', '🤦', '🙈', '😬'],
  '✨': ['🌟', '⭐', '✨', '💫'],
  '!': ['!', '!!', '!'],
  '?': ['?', '??', '?'],
}

// Line break insertion points (after these words/chars)
const LINE_BREAK_POINTS = [',', '.', '!', '?', ' - ', ': ']

const DEFAULT_SETTINGS: AntiBanConfig = {
  typingMinDelay: 3000,
  typingMaxDelay: 15000,
  messageIntervalMin: 30,
  messageIntervalMax: 90,
  dailyLimitPerChip: 200,
  warmingEnabled: true,
  warmingDays: 7,
  cooldownMinutes: 30,
  cooldownAfterMessages: 50,
  stopOnWarning: true,
  randomLineBreaks: false,
  emojiVariation: true,
  sendingWindowStart: 480,  // 8:00 in minutes-from-midnight
  sendingWindowEnd: 1260,   // 21:00 in minutes-from-midnight
  timezone: 'America/Sao_Paulo',
  nurserySchedule: NURSERY_SCHEDULE,
  prewarmSchedule: PREWARM_SCHEDULE,
  readyDailyLimit: 200,
  hourlyLimit: 30,
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
      return parsed.map((entry: any) => ({
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

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min
}

/**
 * Calculate realistic typing duration based on message length.
 * A human types at 6-14 chars/second on mobile.
 * Short messages get a minimum of 3 seconds.
 * Long messages cap at 25 seconds (Vercel timeout safety).
 * 30% chance of a "thinking pause" mid-typing (1-4 seconds).
 */
function calculateTypingDuration(text: string): number {
  const charCount = text.length
  const typingSpeed = randomFloat(TYPING_SPEED_MIN, TYPING_SPEED_MAX)
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
 * Apply random line breaks to message content.
 * Inserts line breaks after punctuation with 20-40% probability.
 * This makes each message visually different even with the same text.
 */
function applyRandomLineBreaks(text: string): string {
  let result = text
  const breakChance = randomFloat(0.2, 0.4)

  for (const point of LINE_BREAK_POINTS) {
    // Split by the punctuation mark
    const parts = result.split(point)
    if (parts.length <= 1) continue

    // Rejoin with occasional line breaks
    result = parts[0]
    for (let i = 1; i < parts.length; i++) {
      if (Math.random() < breakChance && parts[i].trim().length > 0) {
        result += point + '\n' + parts[i]
      } else {
        result += point + parts[i]
      }
    }
  }

  return result
}

/**
 * Apply emoji variation to message content.
 * Swaps common emojis and punctuation with random alternatives.
 */
function applyEmojiVariation(text: string): string {
  let result = text

  for (const [original, alternatives] of Object.entries(EMOJI_SWAPS)) {
    // Only swap with 50% probability per occurrence
    const regex = new RegExp(escapeRegex(original), 'g')
    result = result.replace(regex, () => {
      if (Math.random() < 0.5) {
        return alternatives[Math.floor(Math.random() * alternatives.length)]
      }
      return original
    })
  }

  return result
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Get current hour in the configured timezone
 */
function getCurrentMinutes(timezone: string): number {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    timeZone: timezone,
  })
  const parts = formatter.formatToParts(now)
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10)
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10)
  return hour * 60 + minute
}

// Backward compat: if value is < 25, it's old hour format → convert to minutes
function toMins(val: number): number {
  return val < 25 ? val * 60 : val
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
 * Nursery chips: messages spread evenly across sending window (min 5 min)
 * Prewarm chips: half the nursery interval (min 2 min)
 * Ready/Aquecido chips: use normal interval (30-90s from settings)
 */
function getMinimumIntervalForChip(
  chip: { warmingPhase?: string; warmingEnabled: boolean; dailyLimit: number; createdAt: string; prewarmStartedAt?: Date | null },
  settings: AntiBanConfig
): number {
  if (!chip.warmingEnabled || !settings.warmingEnabled) return 0

  const phase = (chip as any).warmingPhase || 'nursery'

  if (phase === 'ready') {
    // Ready/aquecido: use the normal interval from settings (minimum of intervalMin)
    return settings.messageIntervalMin
  }

  // Calculate the sending window duration in minutes
  const windowStart = toMins(settings.sendingWindowStart)
  const windowEnd = toMins(settings.sendingWindowEnd)
  const windowMinutes = windowEnd > windowStart ? windowEnd - windowStart : (1440 - windowStart + windowEnd)

  // Get the effective daily limit for this chip to determine spacing
  const effectiveLimit = getEffectiveDailyLimit(chip, settings)
  if (effectiveLimit <= 0) return 300 // safety fallback

  // Calculate minimum minutes between messages
  const minMinutesBetween = windowMinutes / effectiveLimit

  if (phase === 'nursery') {
    // Full spreading for nursery chips — minimum 5 minutes (300 seconds)
    return Math.max(300, Math.round(minMinutesBetween * 60))
  } else {
    // Prewarm: half the nursery interval — minimum 2 minutes (120 seconds)
    return Math.max(120, Math.round(minMinutesBetween * 60 * 0.5))
  }
}

function getEffectiveDailyLimit(
  chip: { dailyLimit: number; warmingEnabled: boolean; warmingStage: number; warmingPhase?: string; prewarmStartedAt?: Date | null; createdAt: string },
  settings: AntiBanConfig,
  warmingMode?: string
): number {
  if (!chip.warmingEnabled || !settings.warmingEnabled) {
    return chip.dailyLimit || settings.dailyLimitPerChip
  }

  // New two-phase warming logic
  const phase = (chip as any).warmingPhase || 'nursery'
  
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
  let dayInPhase: number
  const now = new Date()
  
  if (phase === 'nursery') {
    const createdAt = new Date(chip.createdAt)
    dayInPhase = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24)) + 1
  } else {
    // prewarm phase
    const prewarmStart = (chip as any).prewarmStartedAt ? new Date((chip as any).prewarmStartedAt) : new Date(chip.createdAt)
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
        warmingDays: saved.warmingDays,
        cooldownMinutes: saved.cooldownMinutes,
        cooldownAfterMessages: saved.cooldownAfterMessages,
        stopOnWarning: saved.stopOnWarning,
        randomLineBreaks: saved.randomLineBreaks,
        emojiVariation: saved.emojiVariation,
        // New fields with safe defaults for existing DB rows
        sendingWindowStart: toMins((saved as any).sendingWindowStart ?? 480),
        sendingWindowEnd: toMins((saved as any).sendingWindowEnd ?? 1260),
        timezone: (saved as any).timezone ?? 'America/Sao_Paulo',
        // Editable warming schedules (loaded from DB, parsed from JSON)
        nurserySchedule: parseSchedule((saved as any).nurserySchedule, NURSERY_SCHEDULE),
        prewarmSchedule: parseSchedule((saved as any).prewarmSchedule, PREWARM_SCHEDULE),
        readyDailyLimit: (saved as any).readyDailyLimit ?? 200,
        hourlyLimit: (saved as any).hourlyLimit ?? 30,
      }
    }
  } catch {
    // Use defaults
  }
  return DEFAULT_SETTINGS
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
  const lastHourlyReset = new Date((chip as any).lastHourlyResetAt ?? chip.lastResetAt)
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

  const phase = (chip as any).warmingPhase || 'nursery'
  
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
      console.log(`[SendingEngine] Chip ${chip.name} graduated from NURSERY → PREWARM (day ${daysSinceCreation})`)
    }
  } else if (phase === 'prewarm') {
    // Check if prewarm period is complete (20 days from prewarmStartedAt)
    const prewarmStart = (chip as any).prewarmStartedAt ? new Date((chip as any).prewarmStartedAt) : createdAt
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
      console.log(`[SendingEngine] Chip ${chip.name} graduated from PREWARM → READY (prewarm day ${daysSincePrewarm})`)
    }
  }
}

// Legacy function kept for backward compat — now delegates to advanceWarmingPhase
async function advanceWarmingStage(chipId: string, settings: AntiBanConfig): Promise<void> {
  return advanceWarmingPhase(chipId, settings)
}

/**
 * Check if chip is in cooldown period.
 * Uses cooldownUntil timestamp on the chip record.
 */
async function isInCooldown(chipId: string, settings: AntiBanConfig): Promise<boolean> {
  const chip = await db.chip.findUnique({ where: { id: chipId } })
  if (!chip) return true

  const now = new Date()

  // If chip has an active cooldownUntil and it hasn't expired yet
  if (chip.cooldownUntil && new Date(chip.cooldownUntil) > now) {
    console.log(`[SendingEngine] Chip ${chipId} in cooldown until ${chip.cooldownUntil}`)
    return true
  }

  // Check if chip just hit the cooldown threshold
  if (chip.sentToday > 0 && chip.sentToday % settings.cooldownAfterMessages === 0) {
    const cooldownUntil = new Date(now.getTime() + settings.cooldownMinutes * 60 * 1000)
    await db.chip.update({
      where: { id: chipId },
      data: { cooldownUntil },
    })
    console.log(`[SendingEngine] Chip ${chipId} entering cooldown after ${chip.sentToday} messages until ${cooldownUntil.toISOString()}`)
    return true
  }

  // Cooldown expired — clear it
  if (chip.cooldownUntil) {
    await db.chip.update({
      where: { id: chipId },
      data: { cooldownUntil: null },
    })
  }

  return false
}

/**
 * Detect if a chip might be banned by checking its connection state.
 * If the chip is disconnected or has a disconnection reason, it may be banned.
 * Returns true if the chip appears to be banned/disconnected.
 */
async function detectChipBan(chip: { id: string; evolutionInstance: string | null; status: string; disconnectionReasonCode: number | null }): Promise<{ banned: boolean; reason: string; disconnected: boolean }> {
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
      const state = await getConnectionState(chip.evolutionInstance)
      const instanceState = state?.instance?.state
      if (instanceState === 'close') {
        return { banned: true, reason: 'Evolution API reports connection state: close', disconnected: false }
      }
    } catch {
      // If we can't reach Evolution API, don't assume ban — could be network issue
      console.log(`[SendingEngine] Could not check connection state for ${chip.evolutionInstance}`)
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
        console.log(`[SendingEngine] WARNING detected for chip ${chip.name}: ${msg.messageContent?.substring(0, 100)}`)
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
 */
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
              result += variations[Math.floor(Math.random() * variations.length)]
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
 * Start a campaign: create pending messages and set status to running
 */
export async function startCampaign(campaignId: string): Promise<{ messageCount: number }> {
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
        stepVariations = raw.filter((v: VariationObj) => v.content && v.content.trim())
      }
    } catch { /* ignore */ }
    return {
      stepOrder: s.stepOrder,
      content: s.content,
      mediaUrl: s.mediaUrl || null,
      mediatype: s.mediatype || null,
      delayMinutes: s.delayMinutes,
      delayUnit: (s as any).delayUnit || 'minutes',
      variations: stepVariations,
    }
  })

  if (!hasSteps || parsedSteps.length === 0) {
    throw new Error('Campanha não tem mensagens configuradas. Adicione etapas com mensagens.')
  }

  // Sort steps by stepOrder to ensure correct ordering
  parsedSteps.sort((a, b) => a.stepOrder - b.stepOrder)

  const contacts = campaign.contactList.contacts
  const chips = campaign.chips.map(cc => cc.chip).filter(c => c.evolutionInstance)

  if (chips.length === 0) throw new Error('Nenhum chip com instância WhatsApp conectada')
  if (contacts.length === 0) throw new Error('Lista de contatos vazia')

  // Create messages for ALL steps in the sequence
  // For multi-step: each contact gets one message per step, processed in order
  const messagesToCreate = []
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
      // customFields contains ALL spreadsheet columns: {"nome":"Maria","whatsapp":"55119...","empresa":"Tech Corp","vendedora":"Ana"}
      let customData: Record<string, string> = {}
      try {
        if (contact.customFields) {
          customData = JSON.parse(contact.customFields)
        }
      } catch { /* ignore invalid JSON */ }

      // All fields: customFields already has every column from the spreadsheet
      // If customFields is missing core fields, add them as fallback
      const allFields: Record<string, string> = {
        nome: contact.name,
        telefone: contact.phone,
        ...customData, // customData overrides everything — it has the real values from the spreadsheet
      }

      // Resolve all {{variable}} patterns: if found in allFields, replace; if not, leave as-is
      // Match {{any_word_or_underscored_key}} but NOT {{KEY: ...}} (already resolved)
      content = content.replace(/\{\{([a-zA-ZÀ-ÿ_][a-zA-ZÀ-ÿ0-9_]*)\}\}/g, (match, varName) => {
        const key = varName.toLowerCase()
        if (allFields[key] !== undefined) {
          return allFields[key]
        }
        // Variable not found — leave {{varName}} as-is
        return match
      })

      // Legacy single-brace format: {nome}, {telefone}, etc.
      content = content.replace(/\{([a-zA-ZÀ-ÿ_][a-zA-ZÀ-ÿ0-9_]*)\}/g, (match, varName) => {
        const key = varName.toLowerCase()
        if (allFields[key] !== undefined) {
          return allFields[key]
        }
        return match
      })

      // Step 3: Resolve old-style {{KEY_NAME}} markers (from Chaves/MessageKey system)
      content = await resolveMessageKeyMarkers(content)

      messagesToCreate.push({
        campaignId: campaign.id,
        chipId: chip.id,
        contactId: contact.id,
        content,
        status: 'pending' as const,
        stepOrder: step.stepOrder,
        mediaUrl: messageItem.mediaUrl,
        mediatype: messageItem.mediatype,
      })
    }
  }

  await db.message.createMany({ data: messagesToCreate })

  await db.campaign.update({
    where: { id: campaignId },
    data: {
      status: 'running',
      startedAt: new Date(),
    },
  })

  return { messageCount: messagesToCreate.length }
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
    select: { antiBanEnabled: true, warmingMode: true, sendIntervalMin: true, sendIntervalMax: true },
  })
  const antiBanEnabled = campaignInfo?.antiBanEnabled ?? true
  const warmingMode = campaignInfo?.warmingMode || 'normal'
  // Use campaign-specific interval if available, otherwise fall back to global settings
  const campaignIntervalMin = campaignInfo?.sendIntervalMin
  const campaignIntervalMax = campaignInfo?.sendIntervalMax

  const settings = await getAntiBanSettings()

  // CHECK SENDING WINDOW — don't send outside business hours
  if (antiBanEnabled && !isWithinSendingWindow(settings)) {
    const currentMins = getCurrentMinutes(settings.timezone)
    const startMins = toMins(settings.sendingWindowStart)
    const endMins = toMins(settings.sendingWindowEnd)
    console.log(`[SendingEngine] Outside sending window (${currentMins}min, window: ${startMins}-${endMins}). Pausing.`)
    return {
      processed: false,
      delayMs: 60 * 1000, // Check again in 1 minute
      remaining: -1,
      completed: false,
      reason: `outside_sending_window_${Math.floor(currentMins/60)}h${currentMins%60}m`,
    }
  }

  // Find the next pending message
  // CONTACT-BY-CONTACT processing: process ALL steps for one contact before moving to the next.
  // Messages are created in contact-step order (contact1-step1, contact1-step2, contact2-step1, ...),
  // so ordering by createdAt first ensures we process contact-by-contact.
  const message = await db.message.findFirst({
    where: { campaignId, status: 'pending' },
    include: { chip: true, contact: true },
    orderBy: [
      { createdAt: 'asc' },  // Process in creation order (contact-by-contact)
      { stepOrder: 'asc' },  // Within same contact, process steps in order
    ],
  })

  // For multi-step campaigns: check if this contact's previous step has been sent
  // CONTACT-BY-CONTACT: if previous step not sent yet, WAIT for it (don't skip to other contacts)
  if (message && (message as any).stepOrder > 1) {
    // Check if previous step has a successful status (sent, delivered, or read)
    const previousStepSent = await db.message.findFirst({
      where: {
        campaignId,
        contactId: message.contactId,
        stepOrder: (message as any).stepOrder - 1,
        status: { in: ['sent', 'delivered', 'read'] },
      },
    })

    if (!previousStepSent) {
      // Check if previous step FAILED — if so, fail this step too (skip this contact entirely)
      const previousStepFailed = await db.message.findFirst({
        where: {
          campaignId,
          contactId: message.contactId,
          stepOrder: (message as any).stepOrder - 1,
          status: 'failed',
        },
      })
      if (previousStepFailed) {
        // Previous step failed — mark this step and all subsequent steps for this contact as failed
        const failedCount = await db.message.updateMany({
          where: {
            campaignId,
            contactId: message.contactId,
            stepOrder: { gte: (message as any).stepOrder },
            status: 'pending',
          },
          data: { status: 'failed', error: 'Etapa anterior falhou — sequência interrompida' },
        })
        console.log(`[SendingEngine] Contact ${message.contactId}: previous step failed, skipping ${failedCount.count} remaining steps`)
        const remaining = await db.message.count({ where: { campaignId, status: 'pending' } })
        return { processed: true, delayMs: 1000, remaining, completed: remaining === 0 }
      }

      // Previous step still pending (not sent yet) — wait for it to be processed first
      // This is the key to contact-by-contact processing: DON'T skip to other contacts
      const remaining = await db.message.count({ where: { campaignId, status: 'pending' } })
      return { processed: false, delayMs: 3000, remaining, completed: false, reason: 'waiting_for_previous_step' }
    }

    // Check delay between steps: if delayMinutes is configured, wait the appropriate time
    const campaignSteps = await db.campaign.findUnique({
      where: { id: campaignId },
      include: { sequenceSteps: true },
    })
    const currentStepConfig = campaignSteps?.sequenceSteps.find(
      (s: any) => s.stepOrder === (message as any).stepOrder
    )
    if (currentStepConfig && currentStepConfig.delayMinutes > 0) {
      // Find when the previous step for this contact was sent
      const previousStepSentAt = await db.message.findFirst({
        where: {
          campaignId,
          contactId: message.contactId,
          stepOrder: (message as any).stepOrder - 1,
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
          console.log(`[SendingEngine] Step ${(message as any).stepOrder} for contact ${message.contactId}: delay not met (${Math.round(elapsedMs/1000)}s/${currentStepConfig.delayMinutes}${delayUnitLabel}) — waiting ${Math.round(waitMs/1000)}s`)
          return {
            processed: false,
            delayMs: Math.min(waitMs, 60000), // Cap at 1 minute (next cron tick will re-check)
            remaining: -1,
            completed: false,
            reason: `step_delay_${(message as any).stepOrder}`,
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
        data: { status: 'completed', completedAt: new Date() },
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
      // Chip is disconnected but NOT banned — mark this message as failed and try next
      console.log(`[SendingEngine] Chip ${message.chip.name} is DISCONNECTED (not banned) — skipping message`)
      await db.message.update({
        where: { id: message.id },
        data: { status: 'failed', error: `Chip desconectado: ${banCheck.reason}` },
      })
      // Return with short delay so we can try the next message (might use a different chip)
      const remaining = await db.message.count({ where: { campaignId, status: 'pending' } })
      return { processed: true, delayMs: 1000, remaining, completed: remaining === 0 }
    }

    if (banCheck.banned) {
      console.log(`[SendingEngine] Chip ${message.chip.name} appears BANNED: ${banCheck.reason}`)

      // Update chip status to banned
      await db.chip.update({
        where: { id: message.chip.id },
        data: { status: 'banned' },
      })

      // Mark this message as failed
      await db.message.update({
        where: { id: message.id },
        data: { status: 'failed', error: `Chip banido: ${banCheck.reason}` },
      })

      // Return with short delay — the next iteration will pick up messages from other chips
      const remaining = await db.message.count({ where: { campaignId, status: 'pending' } })
      if (remaining === 0) {
        // Check if all remaining messages are from banned chips
        const allFailed = await db.message.count({ where: { campaignId, status: { in: ['pending', 'sending'] } } })
        if (allFailed === 0) {
          await db.campaign.update({ where: { id: campaignId }, data: { status: 'completed', completedAt: new Date() } })
          return { processed: true, delayMs: 0, remaining: 0, completed: true, reason: `chip_banned_${message.chip.name}` }
        }
      }
      return { processed: true, delayMs: 2000, remaining, completed: remaining === 0, reason: `chip_banned_${message.chip.name}` }
    }
  }

  // CHECK FOR WHATSAPP WARNINGS — stopOnWarning
  if (antiBanEnabled && settings.stopOnWarning) {
    const hasWarning = await checkForWarnings(message.chip.id)
    if (hasWarning) {
      // Pause the campaign — a warning was detected
      await db.campaign.update({
        where: { id: campaignId },
        data: { status: 'paused' },
      })
      console.log(`[SendingEngine] Campaign ${campaignId} PAUSED — WhatsApp warning detected for chip ${message.chip.name}`)
      return {
        processed: false,
        delayMs: 0,
        remaining: -1,
        completed: false,
        reason: 'whatsapp_warning_detected',
      }
    }
  }

  // Reset daily counter if needed (timezone-aware)
  await resetDailyIfNeeded(message.chipId, settings.timezone)

  // AUTO-ADVANCE WARMING STAGE (fix for critical bug)
  if (antiBanEnabled && settings.warmingEnabled) {
    await advanceWarmingStage(message.chipId, settings)
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
    const hourlySent = (currentChip as any).hourlySent ?? 0
    if (hourlySent >= settings.hourlyLimit) {
      console.log(`[SendingEngine] Chip ${currentChip.name} hit hourly limit (${hourlySent}/${settings.hourlyLimit}) — waiting`)
      return {
        processed: false,
        delayMs: 60 * 1000, // Check again in 1 minute
        remaining: -1,
        completed: false,
        reason: `hourly_limit_${currentChip.name}`,
      }
    }
  }

  // Check minimum interval for nursery/prewarm chips (smart message spreading)
  if (antiBanEnabled && settings.warmingEnabled && currentChip.warmingEnabled) {
    const minIntervalSeconds = getMinimumIntervalForChip(currentChip, settings)
    if (minIntervalSeconds > 0) {
      // Find the last message sent by this chip
      const lastMessage = await db.message.findFirst({
        where: { chipId: currentChip.id, status: { in: ['sent', 'delivered', 'read'] }, sentAt: { not: null } },
        orderBy: { sentAt: 'desc' },
        select: { sentAt: true },
      })
      if (lastMessage?.sentAt) {
        const elapsed = (Date.now() - new Date(lastMessage.sentAt).getTime()) / 1000
        if (elapsed < minIntervalSeconds) {
          const waitSeconds = Math.ceil(minIntervalSeconds - elapsed)
          const phase = (currentChip as any).warmingPhase || 'nursery'
          console.log(`[SendingEngine] Chip ${currentChip.name} (${phase}): minimum interval not reached (${Math.round(elapsed)}s/${minIntervalSeconds}s) — waiting ${waitSeconds}s`)
          return {
            processed: false,
            delayMs: waitSeconds * 1000,
            remaining: -1,
            completed: false,
            reason: `min_interval_${phase}_${currentChip.name}`,
          }
        }
      }
    }
  }

  // Check daily limit (with warming mode multiplier)
  const effectiveLimit = getEffectiveDailyLimit(currentChip, settings, warmingMode)
  if (antiBanEnabled && currentChip.sentToday >= effectiveLimit) {
    console.log(`[SendingEngine] Chip ${currentChip.name} hit daily limit (${currentChip.sentToday}/${effectiveLimit}) — reassigning messages to other chips`)

    // Find messages assigned to this chip and reassign them to other connected chips
    const otherChips = await db.chip.findMany({
      where: {
        id: { not: currentChip.id },
        status: 'connected',
        evolutionInstance: { not: null },
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

      console.log(`[SendingEngine] Reassigned ${pendingMessages.length} messages from ${currentChip.name} to other chips`)

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
  if (antiBanEnabled && await isInCooldown(message.chipId, settings)) {
    return {
      processed: false,
      delayMs: settings.cooldownMinutes * 60 * 1000,
      remaining: -1,
      completed: false,
      reason: 'cooldown',
    }
  }

  // Mark as sending
  await db.message.update({
    where: { id: message.id },
    data: { status: 'sending' },
  })

  try {
    const instanceName = chip.evolutionInstance!
    const formattedPhone = formatPhoneNumber(message.contact.phone)

    // ============================================
    // ANTI-BAN: REALISTIC TYPING SIMULATION
    // ============================================
    if (antiBanEnabled) {
      // Calculate typing duration proportional to message length
      const typingDurationMs = calculateTypingDuration(message.content)

      console.log(`[SendingEngine] Typing for ${typingDurationMs}ms (${message.content.length} chars) to ${formattedPhone}`)

      // Send "composing" presence with the calculated delay
      try {
        await setPresence(instanceName, `${formattedPhone}@s.whatsapp.net`, 'composing', typingDurationMs)
      } catch {
        // Non-fatal — some evoGO versions may not support this endpoint
      }

      // ACTUALLY WAIT the typing duration before sending
      // This is the critical fix: the contact sees "digitando..." for a realistic time
      await new Promise(resolve => setTimeout(resolve, typingDurationMs))
    }

    // ============================================
    // ANTI-BAN: TEXT VARIATION (line breaks + emoji)
    // ============================================
    let finalContent = message.content

    if (antiBanEnabled && settings.randomLineBreaks && false) { // Line breaks disabled - makes messages ugly
      finalContent = applyRandomLineBreaks(finalContent)
    }

    if (antiBanEnabled && settings.emojiVariation) {
      finalContent = applyEmojiVariation(finalContent)
    }

    // ============================================
    // SEND THE MESSAGE
    // ============================================
    let result
    if (message.mediaUrl && message.mediatype) {
      const validMediaTypes = ['image', 'document', 'video', 'audio']
      const mt = message.mediatype as 'image' | 'document' | 'video' | 'audio'
      if (validMediaTypes.includes(mt)) {
        const caption = mt === 'audio' ? '' : (finalContent || '')
        result = await sendMediaMessage(instanceName, formattedPhone, message.mediaUrl, mt, {
          caption,
          delay: 0, // We already handled delay via typing simulation
        })
      } else {
        result = await sendTextMessage(instanceName, formattedPhone, finalContent, {
          delay: 0,
        })
      }
    } else {
      result = await sendTextMessage(instanceName, formattedPhone, finalContent, {
        delay: 0, // Delay is already handled by typing simulation + interval
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

    // Increment chip counter (daily + hourly)
    await db.chip.update({
      where: { id: message.chipId },
      data: { sentToday: { increment: 1 }, hourlySent: { increment: 1 }, lastSeen: new Date() },
    })

    console.log(`[SendingEngine] Sent message ${message.id} to ${formattedPhone} via ${instanceName}`)

    // ============================================
    // CALCULATE NEXT MESSAGE DELAY
    // ============================================
    // The interval is how long to wait BEFORE processing the next message.
    // Use campaign-specific interval if available, otherwise global settings.
    // Apply warming mode multiplier to the interval.
    const intervalMin = campaignIntervalMin ?? settings.messageIntervalMin
    const intervalMax = campaignIntervalMax ?? settings.messageIntervalMax
    let nextDelay = randomInt(intervalMin, intervalMax) * 1000

    const modeMultiplier = WARMING_MODE_MULTIPLIERS[warmingMode]
    if (modeMultiplier && antiBanEnabled) {
      nextDelay = Math.round(nextDelay * modeMultiplier.intervalMultiplier)
    }

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
 * Get all running campaigns that need processing
 */
export async function getRunningCampaigns(): Promise<string[]> {
  const campaigns = await db.campaign.findMany({
    where: { status: 'running' },
    select: { id: true },
  })
  return campaigns.map(c => c.id)
}
