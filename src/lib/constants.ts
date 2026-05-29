// ============================================================
// SHARED CONSTANTS — Single Source of Truth
// ============================================================
// Schedules and defaults used by sending-engine.ts, antiban/route.ts,
// and the frontend. All derived from Prisma schema defaults.
// NEVER duplicate these — import from here.

import { z } from 'zod'

// ============================================================
// ZOD SCHEMAS — Validation + Type Derivation
// ============================================================
// Schemas are the single source of truth for validation.
// Types are derived from schemas via z.infer<typeof schema>.

export const scheduleEntrySchema = z.object({
  dayRange: z.string().min(1),
  days: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
  limit: z.number().int().min(1),
})

export const breakWindowSchema = z.object({
  start: z.number().int().min(0).max(1440),
  end: z.number().int().min(0).max(1440),
  label: z.string().default('Pausa'),
}).refine(d => d.start < d.end, { message: 'start deve ser menor que end' })

// ============================================================
// HUMAN BEHAVIOR CONFIG — Zod Schemas
// ============================================================
// Makes the bot's timing patterns indistinguishable from a real human.
// All values come from UI → DB → sending-engine reads dynamically.

export const clusterConfigSchema = z.object({
  enabled: z.boolean().default(true),
  minSize: z.number().int().min(2).max(6).default(2),           // Min messages per cluster burst
  maxSize: z.number().int().min(2).max(8).default(4),           // Max messages per cluster burst
  microPauseMinSec: z.number().int().min(1).max(30).default(3), // Min pause between cluster msgs (seconds)
  microPauseMaxSec: z.number().int().min(1).max(60).default(8), // Max pause between cluster msgs (seconds)
  afterClusterPauseMinSec: z.number().int().min(10).max(300).default(30), // Min pause after cluster (seconds)
  afterClusterPauseMaxSec: z.number().int().min(10).max(600).default(90), // Max pause after cluster (seconds)
}).refine(d => d.maxSize >= d.minSize, { message: 'Tamanho máximo deve ser >= mínimo', path: ['maxSize'] })
  .refine(d => d.microPauseMaxSec >= d.microPauseMinSec, { message: 'Micro-pausa máxima deve ser >= mínima', path: ['microPauseMaxSec'] })
  .refine(d => d.afterClusterPauseMaxSec >= d.afterClusterPauseMinSec, { message: 'Pausa pós-cluster máxima deve ser >= mínima', path: ['afterClusterPauseMaxSec'] })

export const cooldownPresenceConfigSchema = z.object({
  enabled: z.boolean().default(true),
  chancePercent: z.number().int().min(5).max(100).default(40),   // Chance of appearing online during cooldown
  durationMinSec: z.number().int().min(2).max(120).default(5),   // Min seconds of online appearance
  durationMaxSec: z.number().int().min(2).max(120).default(25),  // Max seconds of online appearance
  intervalMinMin: z.number().int().min(1).max(30).default(2),    // Min minutes between online appearances
  intervalMaxMin: z.number().int().min(1).max(60).default(5),    // Max minutes between online appearances
}).refine(d => d.durationMaxSec >= d.durationMinSec, { message: 'Duração máxima deve ser >= mínima', path: ['durationMaxSec'] })
  .refine(d => d.intervalMaxMin >= d.intervalMinMin, { message: 'Intervalo máximo deve ser >= mínimo', path: ['intervalMaxMin'] })

export const dayRhythmConfigSchema = z.object({
  enabled: z.boolean().default(true),
  morningFactor: z.number().int().min(50).max(300).default(130),  // Morning (09-12h): 130% = 1.3x slower
  middayFactor: z.number().int().min(50).max(300).default(80),   // Midday (12-14h): 80% = faster
  afternoonFactor: z.number().int().min(50).max(300).default(100), // Afternoon (14-17h): 100% = normal
})

export const pauseTierSchema = z.object({
  weight: z.number().int().min(0).max(100).default(40),          // Weight for weighted random selection (%)
  minMin: z.number().int().min(1).max(60).default(2),            // Min duration in minutes
  maxMin: z.number().int().min(1).max(120).default(5),           // Max duration in minutes
}).refine(d => d.maxMin >= d.minMin, { message: 'Máximo deve ser >= mínimo', path: ['maxMin'] })

export const nonlinearPausesConfigSchema = z.object({
  enabled: z.boolean().default(true),
  short: pauseTierSchema.default({ weight: 40, minMin: 2, maxMin: 5 }),
  medium: pauseTierSchema.default({ weight: 40, minMin: 8, maxMin: 15 }),
  long: pauseTierSchema.default({ weight: 20, minMin: 20, maxMin: 35 }),
}).refine(d => (d.short.weight + d.medium.weight + d.long.weight) > 0, { message: 'Pesos devem somar > 0' })

export const typingSimulationConfigSchema = z.object({
  speedMin: z.number().int().min(1).max(30).default(6),           // Min chars/sec typing speed
  speedMax: z.number().int().max(30).default(14),                 // Max chars/sec typing speed
  pauseChance: z.number().int().min(0).max(100).default(30),      // % chance of mid-typing pause
  pauseMinMs: z.number().int().min(500).max(10000).default(1000), // Min mid-typing pause ms
  pauseMaxMs: z.number().int().min(500).max(10000).default(4000), // Max mid-typing pause ms
  longMsgThreshold: z.number().int().min(50).max(500).default(100), // Chars to consider "long message"
  longMsgPauseChance: z.number().int().min(0).max(100).default(40), // % chance of pause for long msgs
  segmentsMin: z.number().int().min(2).max(5).default(2),         // Min typing segments for long msgs
  segmentsMax: z.number().int().min(2).max(6).default(3),         // Max typing segments for long msgs
}).refine(d => d.speedMax >= d.speedMin, { message: 'Velocidade máxima deve ser >= mínima', path: ['speedMax'] })
  .refine(d => d.pauseMaxMs >= d.pauseMinMs, { message: 'Pausa máxima deve ser >= mínima', path: ['pauseMaxMs'] })
  .refine(d => d.segmentsMax >= d.segmentsMin, { message: 'Segmentos máximos deve ser >= mínimos', path: ['segmentsMax'] })

export const presenceConfigSchema = z.object({
  offlineDelayMinMs: z.number().int().min(1000).max(60000).default(3000),   // Min ms to stay online after send
  offlineDelayMaxMs: z.number().int().min(1000).max(60000).default(15000),  // Max ms to stay online after send
  idleReadingChance: z.number().int().min(0).max(100).default(25),           // % chance of idle reading
  idleReadingDurationMinMs: z.number().int().min(1000).max(30000).default(2000), // Min ms reading
  idleReadingDurationMaxMs: z.number().int().min(1000).max(30000).default(8000), // Max ms reading
  idleReadingMinIntervalSec: z.number().int().min(30).max(300).default(60),  // Only idle read if interval >= this
  preSendOnlineMs: z.number().int().min(500).max(10000).default(1000),       // Ms of "available" before composing
  preComposePauseMinMs: z.number().int().min(500).max(10000).default(800),   // Min ms pause before composing
  preComposePauseMaxMs: z.number().int().min(500).max(10000).default(3000),  // Max ms pause before composing
  mediaRecordingMinMs: z.number().int().min(1000).max(10000).default(2000),  // Min ms "recording" for media
  mediaRecordingMaxMs: z.number().int().min(1000).max(10000).default(4000),  // Max ms "recording" for media
}).refine(d => d.offlineDelayMaxMs >= d.offlineDelayMinMs, { message: 'Delay offline máximo deve ser >= mínimo', path: ['offlineDelayMaxMs'] })
  .refine(d => d.idleReadingDurationMaxMs >= d.idleReadingDurationMinMs, { message: 'Duração leitura máxima deve ser >= mínima', path: ['idleReadingDurationMaxMs'] })
  .refine(d => d.preComposePauseMaxMs >= d.preComposePauseMinMs, { message: 'Pausa pré-compose máxima deve ser >= mínima', path: ['preComposePauseMaxMs'] })
  .refine(d => d.mediaRecordingMaxMs >= d.mediaRecordingMinMs, { message: 'Gravação máxima deve ser >= mínima', path: ['mediaRecordingMaxMs'] })

export const deliveryRateConfigSchema = z.object({
  normalThreshold: z.number().int().min(10).max(100).default(60),   // Delivery rate >= 60% → normal
  mediumThreshold: z.number().int().min(10).max(100).default(40),   // Delivery rate 40-59% → medium slow
  mediumMultiplier: z.number().min(1).max(5).default(1.5),           // 1.5x slower
  lowThreshold: z.number().int().min(5).max(100).default(20),       // Delivery rate 20-39% → slow
  lowMultiplier: z.number().min(1).max(5).default(2.5),              // 2.5x slower
  criticalMultiplier: z.number().min(1).max(10).default(4.0),        // Delivery rate < 20% → very slow
  minSample: z.number().int().min(5).max(100).default(10),           // Min messages to calculate rate
})

export const humanBehaviorConfigSchema = z.object({
  cluster: clusterConfigSchema,
  cooldownPresence: cooldownPresenceConfigSchema,
  dayRhythm: dayRhythmConfigSchema,
  nonlinearPauses: nonlinearPausesConfigSchema,
  typingSimulation: typingSimulationConfigSchema.optional(),
  presence: presenceConfigSchema.optional(),
  deliveryRate: deliveryRateConfigSchema.optional(),
})

export type ClusterConfig = z.infer<typeof clusterConfigSchema>
export type CooldownPresenceConfig = z.infer<typeof cooldownPresenceConfigSchema>
export type DayRhythmConfig = z.infer<typeof dayRhythmConfigSchema>
export type PauseTier = z.infer<typeof pauseTierSchema>
export type NonlinearPausesConfig = z.infer<typeof nonlinearPausesConfigSchema>
export type TypingSimulationConfig = z.infer<typeof typingSimulationConfigSchema>
export type PresenceConfig = z.infer<typeof presenceConfigSchema>
export type DeliveryRateConfig = z.infer<typeof deliveryRateConfigSchema>
export type HumanBehaviorConfig = z.infer<typeof humanBehaviorConfigSchema>

// Default human behavior config (matches Prisma @default)
export const DEFAULT_HUMAN_BEHAVIOR: HumanBehaviorConfig = {
  cluster: {
    enabled: true,
    minSize: 2,
    maxSize: 4,
    microPauseMinSec: 3,
    microPauseMaxSec: 8,
    afterClusterPauseMinSec: 30,
    afterClusterPauseMaxSec: 90,
  },
  cooldownPresence: {
    enabled: true,
    chancePercent: 40,
    durationMinSec: 5,
    durationMaxSec: 25,
    intervalMinMin: 2,
    intervalMaxMin: 5,
  },
  dayRhythm: {
    enabled: true,
    morningFactor: 130,
    middayFactor: 80,
    afternoonFactor: 100,
  },
  nonlinearPauses: {
    enabled: true,
    short: { weight: 40, minMin: 2, maxMin: 5 },
    medium: { weight: 40, minMin: 8, maxMin: 15 },
    long: { weight: 20, minMin: 20, maxMin: 35 },
  },
  typingSimulation: {
    speedMin: 6,
    speedMax: 14,
    pauseChance: 30,
    pauseMinMs: 1000,
    pauseMaxMs: 4000,
    longMsgThreshold: 100,
    longMsgPauseChance: 40,
    segmentsMin: 2,
    segmentsMax: 3,
  },
  presence: {
    offlineDelayMinMs: 3000,
    offlineDelayMaxMs: 15000,
    idleReadingChance: 25,
    idleReadingDurationMinMs: 2000,
    idleReadingDurationMaxMs: 8000,
    idleReadingMinIntervalSec: 60,
    preSendOnlineMs: 1000,
    preComposePauseMinMs: 800,
    preComposePauseMaxMs: 3000,
    mediaRecordingMinMs: 2000,
    mediaRecordingMaxMs: 4000,
  },
  deliveryRate: {
    normalThreshold: 60,
    mediumThreshold: 40,
    mediumMultiplier: 1.5,
    lowThreshold: 20,
    lowMultiplier: 2.5,
    criticalMultiplier: 4.0,
    minSample: 10,
  },
}

export const antiBanUpdateSchema = z.object({
  typingMinDelay: z.number().int().min(1000).optional(),
  typingMaxDelay: z.number().int().min(1000).optional(),
  messageIntervalMin: z.number().int().min(1).optional(),
  messageIntervalMax: z.number().int().min(1).optional(),
  dailyLimitPerChip: z.number().int().min(1).optional(),
  warmingEnabled: z.boolean().optional(),
  cooldownMinutes: z.number().int().min(1).optional(),
  cooldownMinutesMax: z.number().int().min(1).optional(),
  cooldownAfterMessages: z.number().int().min(1).optional(),
  cooldownAfterMessagesMax: z.number().int().min(1).optional(),
  stopOnWarning: z.boolean().optional(),
  sendingWindowStart: z.number().int().min(0).max(1440).optional(),
  sendingWindowEnd: z.number().int().min(0).max(1440).optional(),
  timezone: z.string().min(1).optional(),
  breakWindows: z.union([
    z.string(),
    z.array(breakWindowSchema),
  ]).optional(),
  nurserySchedule: z.union([
    z.string(),
    z.array(scheduleEntrySchema),
  ]).optional(),
  prewarmSchedule: z.union([
    z.string(),
    z.array(scheduleEntrySchema),
  ]).optional(),
  readyDailyLimit: z.number().int().min(10).optional(),
  hourlyLimit: z.number().int().min(5).optional(),
  linkPreviewEnabled: z.boolean().optional(),
  humanBehaviorEnabled: z.boolean().optional(),
  humanBehaviorConfig: z.union([
    z.string(),
    humanBehaviorConfigSchema,
  ]).optional(),
}).refine(
  d => {
    if (d.typingMinDelay !== undefined && d.typingMaxDelay !== undefined) {
      return d.typingMaxDelay >= d.typingMinDelay
    }
    return true
  },
  { message: 'Delay máximo deve ser maior ou igual ao mínimo', path: ['typingMaxDelay'] }
)

// ============================================================
// DERIVED TYPES
// ============================================================

export type ScheduleEntry = z.infer<typeof scheduleEntrySchema>
export type BreakWindow = z.infer<typeof breakWindowSchema>
export type AntiBanUpdate = z.infer<typeof antiBanUpdateSchema>

/** Full anti-ban settings object as returned by GET /api/antiban */
export interface AntiBanSettings {
  id: string
  typingMinDelay: number
  typingMaxDelay: number
  messageIntervalMin: number
  messageIntervalMax: number
  dailyLimitPerChip: number
  warmingEnabled: boolean
  cooldownMinutes: number
  cooldownMinutesMax: number
  cooldownAfterMessages: number
  cooldownAfterMessagesMax: number
  stopOnWarning: boolean
  sendingWindowStart: number
  sendingWindowEnd: number
  timezone: string
  nurserySchedule: string   // JSON string of ScheduleEntry[]
  prewarmSchedule: string   // JSON string of ScheduleEntry[]
  readyDailyLimit: number
  hourlyLimit: number
  breakWindows: string      // JSON string of BreakWindow[]
  linkPreviewEnabled: boolean
  humanBehaviorEnabled: boolean
  humanBehaviorConfig: string    // JSON string of HumanBehaviorConfig
}

// ============================================================
// WARMING SCHEDULES
// ============================================================
// Phase 1: Nursery (Berçário) — chip novo, 14 dias
// Phase 2: Prewarm (Pré-aquecido) — chip já passou pelo berçário, 20 dias
// After both phases: chip is "ready" with no limit restriction

export const NURSERY_SCHEDULE: ScheduleEntry[] = [
  { dayRange: '1-2',   days: [1, 2],   limit: 10 },
  { dayRange: '3-4',   days: [3, 4],   limit: 20 },
  { dayRange: '5-6',   days: [5, 6],   limit: 30 },
  { dayRange: '7-8',   days: [7, 8],   limit: 40 },
  { dayRange: '9-10',  days: [9, 10],  limit: 50 },
  { dayRange: '11-12', days: [11, 12], limit: 60 },
  { dayRange: '13-14', days: [13, 14], limit: 80 },
]

export const PREWARM_SCHEDULE: ScheduleEntry[] = [
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

// ============================================================
// ANTI-BAN FIELD DEFAULTS
// ============================================================
// Single source of truth for all anti-ban default values.
// Matches Prisma schema @default() values exactly.
// Used by: sending-engine.ts (DEFAULT_SETTINGS), antiban/route.ts (_resetToDefaults, _resetSection, _resetField)

export const FIELD_DEFAULTS: Record<string, unknown> = {
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
  sendingWindowStart: 540,
  sendingWindowEnd: 1020,
  timezone: 'America/Sao_Paulo',
  breakWindows: '[]',
  nurserySchedule: JSON.stringify(NURSERY_SCHEDULE),
  prewarmSchedule: JSON.stringify(PREWARM_SCHEDULE),
  readyDailyLimit: 200,
  hourlyLimit: 30,
  linkPreviewEnabled: false,
  humanBehaviorEnabled: true,
  humanBehaviorConfig: JSON.stringify(DEFAULT_HUMAN_BEHAVIOR),
}

// Section-to-fields mapping for _resetSection
export const SECTION_FIELDS: Record<string, string[]> = {
  typing: ['typingMinDelay', 'typingMaxDelay'],
  interval: ['messageIntervalMin', 'messageIntervalMax'],
  warming: ['warmingEnabled', 'nurserySchedule', 'prewarmSchedule', 'readyDailyLimit', 'hourlyLimit'],
  cooldown: ['dailyLimitPerChip', 'cooldownMinutes', 'cooldownMinutesMax', 'cooldownAfterMessages', 'cooldownAfterMessagesMax', 'stopOnWarning', 'linkPreviewEnabled'],
  sendingWindow: ['sendingWindowStart', 'sendingWindowEnd', 'timezone', 'breakWindows'],
  humanBehavior: ['humanBehaviorEnabled', 'humanBehaviorConfig'],
}

// Allowed fields whitelist for PATCH
export const ALLOWED_FIELDS = [
  'typingMinDelay',
  'typingMaxDelay',
  'messageIntervalMin',
  'messageIntervalMax',
  'dailyLimitPerChip',
  'warmingEnabled',
  'cooldownMinutes',
  'cooldownMinutesMax',
  'cooldownAfterMessages',
  'cooldownAfterMessagesMax',
  'stopOnWarning',
  'sendingWindowStart',
  'sendingWindowEnd',
  'timezone',
  'breakWindows',
  'nurserySchedule',
  'prewarmSchedule',
  'readyDailyLimit',
  'hourlyLimit',
  'linkPreviewEnabled',
  'humanBehaviorEnabled',
  'humanBehaviorConfig',
]

// Warming mode multipliers
export const WARMING_MODE_MULTIPLIERS: Record<string, { intervalMultiplier: number; limitMultiplier: number }> = {
  normal: { intervalMultiplier: 1, limitMultiplier: 1 },
  agressive: { intervalMultiplier: 0.5, limitMultiplier: 1.5 },
  stealth: { intervalMultiplier: 2, limitMultiplier: 0.6 },
}
