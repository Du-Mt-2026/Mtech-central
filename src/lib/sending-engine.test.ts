/**
 * Testes unitários para sending-engine.ts
 * 
 * Roda com: npx tsx src/lib/sending-engine.test.ts
 * 
 * Testa funções puras (sem DB, sem API) que são críticas para o anti-ban.
 * Estas funções foram onde bugs como o 2.13 (aquecimento) viveram escondidos.
 */

const DEFAULT_SETTINGS = {
  warmingEnabled: true,
  warmingStage: 1,
  nurserySchedule: JSON.stringify([
    { dayRange: '1-2', days: [1, 2], limit: 2 },
    { dayRange: '3-4', days: [3, 4], limit: 3 },
    { dayRange: '5-6', days: [5, 6], limit: 5 },
    { dayRange: '7-8', days: [7, 8], limit: 8 },
    { dayRange: '9-10', days: [9, 10], limit: 12 },
    { dayRange: '11-12', days: [11, 12], limit: 15 },
    { dayRange: '13-14', days: [13, 14], limit: 20 },
  ]),
  prewarmSchedule: JSON.stringify([
    { dayRange: '1-2', days: [1, 2], limit: 25 },
    { dayRange: '3-4', days: [3, 4], limit: 30 },
    { dayRange: '5-6', days: [5, 6], limit: 40 },
    { dayRange: '7-8', days: [7, 8], limit: 50 },
    { dayRange: '9-10', days: [9, 10], limit: 60 },
    { dayRange: '11-12', days: [11, 12], limit: 70 },
    { dayRange: '13-14', days: [13, 14], limit: 80 },
    { dayRange: '15-16', days: [15, 16], limit: 90 },
    { dayRange: '17-18', days: [17, 18], limit: 100 },
    { dayRange: '19-20', days: [19, 20], limit: 150 },
  ]),
  readyDailyLimit: 200,
  warmingMode: 'normal',
  messageIntervalMin: 90,
  messageIntervalMax: 220,
  dailyLimitPerChip: 150,
  hourlyLimit: 20,
  cooldownMinutes: 10,
  cooldownMinutesMax: 18,
  cooldownAfterMessages: 4,
  cooldownAfterMessagesMax: 6,
  sendingWindowStart: 510,
  sendingWindowEnd: 1050,
  breakWindows: JSON.stringify([{ start: 710, end: 780, label: 'Almoço' }]),
  typingMinDelay: 5,
  typingMaxDelay: 25,
  timezone: 'America/Sao_Paulo',
} as any

function parseSchedule(jsonStr: string | undefined | null, fallback: any[]): any[] {
  if (!jsonStr) return fallback
  try {
    const parsed = JSON.parse(jsonStr)
    if (!Array.isArray(parsed)) return fallback
    return parsed
  } catch { return fallback }
}

function parseBreakWindows(jsonStr: string | undefined | null): any[] {
  if (!jsonStr) return []
  try {
    const parsed = JSON.parse(jsonStr)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(w => typeof w.start === 'number' && typeof w.end === 'number' && w.start < w.end)
  } catch { return [] }
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min
}

function gaussianRandom(mean: number, stddev: number, min: number, max: number): number {
  const u1 = Math.random()
  const u2 = Math.random()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  const value = Math.round(mean + z * stddev)
  return Math.max(min, Math.min(max, value))
}

function calculateTypingDuration(text: string, settings?: any): number {
  if (!text || text.length === 0) return 0
  const minSpeed = settings?.typingMinDelay || 6
  const maxSpeed = settings?.typingMaxDelay || 14
  const speed = randomFloat(minSpeed, maxSpeed)
  const baseDuration = (text.length / speed) * 1000
  const longMsgThreshold = 100
  if (text.length > longMsgThreshold && Math.random() < 0.4) {
    return baseDuration + randomInt(1000, 4000)
  }
  if (Math.random() < 0.3) {
    return baseDuration + randomInt(1000, 4000)
  }
  return baseDuration
}

function isWithinSendingWindow(settings: any): boolean {
  const now = new Date()
  const tz = settings?.timezone || 'America/Sao_Paulo'
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
  const parts = formatter.formatToParts(now)
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0')
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0')
  const currentMinutes = hour * 60 + minute
  return currentMinutes >= (settings?.sendingWindowStart ?? 510) && currentMinutes < (settings?.sendingWindowEnd ?? 1050)
}

function getWarmingLimitForDay(warmingPhase: string, dayNumber: number, settings: any): number {
  if (!settings?.warmingEnabled) return settings?.readyDailyLimit || 200
  let schedule: any[] = []
  if (warmingPhase === 'nursery') schedule = parseSchedule(settings.nurserySchedule, [])
  else if (warmingPhase === 'prewarm') schedule = parseSchedule(settings.prewarmSchedule, [])
  else return settings.readyDailyLimit || 200
  for (const entry of schedule) {
    const [min, max] = entry.days
    if (dayNumber >= min && dayNumber <= max) return entry.limit
  }
  if (schedule.length > 0 && dayNumber > schedule[schedule.length - 1].days[1]) return schedule[schedule.length - 1].limit
  return 20
}

function getEffectiveDailyLimit(chip: any, settings: any): number {
  if (!settings?.warmingEnabled || !chip?.warmingEnabled) return chip?.dailyLimit || settings?.dailyLimitPerChip || 200
  const startedAt = chip.warmingStartedAt || chip.prewarmStartedAt
  if (!startedAt) return 20
  const tz = settings?.timezone || 'America/Sao_Paulo'
  const start = new Date(startedAt)
  const now = new Date()
  const startStr = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(start)
  const nowStr = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const startDate = new Date(startStr)
  const nowDate = new Date(nowStr)
  const dayDiff = Math.floor((nowDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000))
  const dayNumber = dayDiff + 1
  return getWarmingLimitForDay(chip.warmingPhase || 'nursery', dayNumber, settings)
}

let testsPassed = 0
let testsFailed = 0
const failures: string[] = []

function assert(condition: boolean, message: string) {
  if (condition) testsPassed++
  else { testsFailed++; failures.push(message); console.error(`  ❌ FAIL: ${message}`) }
}
function assertEqual(actual: any, expected: any, message: string) {
  if (actual === expected) testsPassed++
  else { testsFailed++; failures.push(`${message} (expected ${expected}, got ${actual})`); console.error(`  ❌ FAIL: ${message} (expected ${expected}, got ${actual})`) }
}
function assertInRange(value: number, min: number, max: number, message: string) {
  if (value >= min && value <= max) testsPassed++
  else { testsFailed++; failures.push(`${message} (expected ${min}-${max}, got ${value})`); console.error(`  ❌ FAIL: ${message}`) }
}
function test(name: string, fn: () => void) {
  console.log(`\n▶ ${name}`)
  try { fn() } catch (e: any) { testsFailed++; failures.push(`${name}: ${e.message}`); console.error(`  ❌ ERROR: ${e.message}`) }
}

console.log('🧪 Testes do sending-engine.ts')
console.log('================================')

test('parseSchedule: JSON válido retorna array', () => {
  const result = parseSchedule('[{"dayRange":"1-2","days":[1,2],"limit":2}]', [])
  assertEqual(result.length, 1, 'Deve ter 1 entrada')
  assertEqual(result[0].limit, 2, 'Limit deve ser 2')
})
test('parseSchedule: JSON inválido retorna fallback', () => {
  const result = parseSchedule('invalid json', [{ dayRange: '1', days: [1], limit: 10 }])
  assertEqual(result.length, 1, 'Deve usar fallback')
})
test('parseSchedule: null retorna fallback', () => {
  const result = parseSchedule(null, [{ dayRange: '1', days: [1], limit: 10 }])
  assertEqual(result.length, 1, 'Deve usar fallback')
})
test('parseBreakWindows: JSON válido', () => {
  const result = parseBreakWindows('[{"start":710,"end":780,"label":"Almoço"}]')
  assertEqual(result.length, 1, 'Deve ter 1 janela')
})
test('parseBreakWindows: JSON inválido retorna vazio', () => {
  assertEqual(parseBreakWindows('invalid').length, 0, 'Deve retornar array vazio')
})
test('parseBreakWindows: null retorna vazio', () => {
  assertEqual(parseBreakWindows(null).length, 0, 'Deve retornar array vazio')
})
test('randomInt: retorna valor dentro do range', () => {
  for (let i = 0; i < 100; i++) assertInRange(randomInt(5, 10), 5, 10, 'randomInt deve estar no range')
})
test('gaussianRandom: retorna valor dentro do range', () => {
  for (let i = 0; i < 100; i++) assertInRange(gaussianRandom(100, 20, 50, 150), 50, 150, 'gaussianRandom deve estar no range')
})
test('gaussianRandom: média aproximada', () => {
  const values: number[] = []
  for (let i = 0; i < 1000; i++) values.push(gaussianRandom(100, 20, 50, 150))
  const avg = values.reduce((a, b) => a + b, 0) / values.length
  assert(avg > 90 && avg < 110, `Média deve ser ~100, foi ${avg}`)
})
test('calculateTypingDuration: texto vazio retorna 0', () => {
  assertEqual(calculateTypingDuration('', DEFAULT_SETTINGS), 0, 'Texto vazio deve retornar 0')
})
test('calculateTypingDuration: texto curto retorna duração positiva', () => {
  const d = calculateTypingDuration('Olá!', DEFAULT_SETTINGS)
  assert(d > 0, 'Duração deve ser positiva')
  assert(d < 2000, 'Texto curto não deve passar de 2s')
})
test('calculateTypingDuration: texto longo pode ter pause', () => {
  const d = calculateTypingDuration('A'.repeat(200), DEFAULT_SETTINGS)
  assert(d > 0, 'Duração deve ser positiva')
  assert(d < 40000, 'Texto longo não deve passar de 40s')
})
test('isWithinSendingWindow: retorna boolean', () => {
  assert(typeof isWithinSendingWindow(DEFAULT_SETTINGS) === 'boolean', 'Deve retornar boolean')
})
test('getWarmingLimitForDay: nursery dia 1 retorna 2', () => {
  assertEqual(getWarmingLimitForDay('nursery', 1, DEFAULT_SETTINGS), 2, 'Nursery dia 1 = 2')
})
test('getWarmingLimitForDay: nursery dia 14 retorna 20', () => {
  assertEqual(getWarmingLimitForDay('nursery', 14, DEFAULT_SETTINGS), 20, 'Nursery dia 14 = 20')
})
test('getWarmingLimitForDay: prewarm dia 1 retorna 25', () => {
  assertEqual(getWarmingLimitForDay('prewarm', 1, DEFAULT_SETTINGS), 25, 'Prewarm dia 1 = 25')
})
test('getWarmingLimitForDay: prewarm dia 20 retorna 150', () => {
  assertEqual(getWarmingLimitForDay('prewarm', 20, DEFAULT_SETTINGS), 150, 'Prewarm dia 20 = 150')
})
test('getWarmingLimitForDay: ready retorna 200', () => {
  assertEqual(getWarmingLimitForDay('ready', 100, DEFAULT_SETTINGS), 200, 'Ready = 200')
})
test('getWarmingLimitForDay: dia além do schedule retorna último limite', () => {
  assertEqual(getWarmingLimitForDay('prewarm', 30, DEFAULT_SETTINGS), 150, 'Dia 30 = 150')
})
test('getEffectiveDailyLimit: chip ready retorna dailyLimit', () => {
  const chip = { warmingEnabled: true, warmingPhase: 'ready', warmingStartedAt: new Date('2026-06-01').toISOString(), dailyLimit: 200 }
  assertEqual(getEffectiveDailyLimit(chip, DEFAULT_SETTINGS), 200, 'Ready = 200')
})
test('getEffectiveDailyLimit: chip sem warming retorna dailyLimit', () => {
  const chip = { warmingEnabled: false, warmingPhase: 'ready', dailyLimit: 150 }
  assertEqual(getEffectiveDailyLimit(chip, DEFAULT_SETTINGS), 150, 'Sem warming = dailyLimit')
})
test('getEffectiveDailyLimit: chip nursery dia 1 retorna 2', () => {
  const chip = { warmingEnabled: true, warmingPhase: 'nursery', warmingStartedAt: new Date().toISOString(), dailyLimit: 200 }
  assertEqual(getEffectiveDailyLimit(chip, DEFAULT_SETTINGS), 2, 'Nursery dia 1 = 2')
})
test('getEffectiveDailyLimit: chip prewarm dia 38 retorna 150', () => {
  const startedAt = new Date(); startedAt.setDate(startedAt.getDate() - 37)
  const chip = { warmingEnabled: true, warmingPhase: 'prewarm', warmingStartedAt: startedAt.toISOString(), dailyLimit: 200 }
  assertEqual(getEffectiveDailyLimit(chip, DEFAULT_SETTINGS), 150, 'Prewarm dia 38 = 150')
})
test('getEffectiveDailyLimit: sem warmingStartedAt retorna 20', () => {
  const chip = { warmingEnabled: true, warmingPhase: 'nursery', warmingStartedAt: null, dailyLimit: 200 }
  assertEqual(getEffectiveDailyLimit(chip, DEFAULT_SETTINGS), 20, 'Fallback = 20')
})
test('getWarmingLimitForDay: warming desabilitado retorna readyDailyLimit', () => {
  assertEqual(getWarmingLimitForDay('nursery', 1, { ...DEFAULT_SETTINGS, warmingEnabled: false }), 200, 'Warming off = readyDailyLimit')
})
test('parseBreakWindows: janela inválida é filtrada', () => {
  assertEqual(parseBreakWindows('[{"start":780,"end":780},{"start":790,"end":780}]').length, 0, 'Janelas inválidas filtradas')
})

console.log('\n================================')
console.log(`✅ Testes passaram: ${testsPassed}`)
console.log(`❌ Testes falharam: ${testsFailed}`)
console.log('================================')
if (testsFailed > 0) { console.log('\nFalhas:'); failures.forEach(f => console.log(`  - ${f}`)); process.exit(1) }
else { console.log('\n🎉 Todos os testes passaram!'); process.exit(0) }
