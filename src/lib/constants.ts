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
  sendingWindowStart: 480,
  sendingWindowEnd: 1260,
  timezone: 'America/Sao_Paulo',
  breakWindows: '[]',
  nurserySchedule: JSON.stringify(NURSERY_SCHEDULE),
  prewarmSchedule: JSON.stringify(PREWARM_SCHEDULE),
  readyDailyLimit: 200,
  hourlyLimit: 30,
}

// Section-to-fields mapping for _resetSection
export const SECTION_FIELDS: Record<string, string[]> = {
  typing: ['typingMinDelay', 'typingMaxDelay'],
  interval: ['messageIntervalMin', 'messageIntervalMax'],
  warming: ['warmingEnabled', 'nurserySchedule', 'prewarmSchedule', 'readyDailyLimit', 'hourlyLimit'],
  cooldown: ['dailyLimitPerChip', 'cooldownMinutes', 'cooldownMinutesMax', 'cooldownAfterMessages', 'cooldownAfterMessagesMax', 'stopOnWarning'],
  sendingWindow: ['sendingWindowStart', 'sendingWindowEnd', 'timezone', 'breakWindows'],
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
]

// Warming mode multipliers
export const WARMING_MODE_MULTIPLIERS: Record<string, { intervalMultiplier: number; limitMultiplier: number }> = {
  normal: { intervalMultiplier: 1, limitMultiplier: 1 },
  agressive: { intervalMultiplier: 0.5, limitMultiplier: 1.5 },
  stealth: { intervalMultiplier: 2, limitMultiplier: 0.6 },
}
