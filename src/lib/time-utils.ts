// ============================================================
// SHARED TIME UTILITIES
// ============================================================
// Used by sending-engine.ts and antiban/route.ts.
// NEVER duplicate — import from here.

/**
 * Convert hour-or-minutes value to minutes-from-midnight.
 * Backward compat: if value is < 25, it's old hour format → convert to minutes.
 * Examples:
 *   toMins(8)   → 480  (8:00 in old hour format)
 *   toMins(480) → 480  (already in minutes format)
 *   toMins(21)  → 1260 (21:00 in old hour format)
 *   toMins(1260)→ 1260 (already in minutes format)
 */
export function toMins(val: number): number {
  return val < 25 ? val * 60 : val
}

/**
 * Get current time as minutes-from-midnight in the given timezone.
 * Handles the edge case where hour12:false returns "24" for midnight (ISO 8601 convention).
 *
 * BUGFIX: Some Node.js Alpine builds with ICU quirks can return hour > 23,
 * producing values > 1440. We clamp the result to [0, 1439] via modulo.
 */
export function getCurrentMinutes(timezone: string): number {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    timeZone: timezone,
  })
  const parts = formatter.formatToParts(now)
  let hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10)
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10)

  // Debug: log raw Intl output to diagnose ICU issues
  if (hour > 23 || isNaN(hour) || isNaN(minute)) {
    const rawParts = parts.map(p => `${p.type}=${p.value}`).join(', ')
    console.warn(`[getCurrentMinutes] Unexpected Intl result: hour=${hour}, minute=${minute}, parts=[${rawParts}], timezone=${timezone}`)
  }

  // hour12:false can return hour=24 for midnight (ISO 8601) — treat as 0
  // Also handle hour > 24 from some ICU implementations
  if (hour >= 24) hour = hour - 24

  const result = hour * 60 + minute
  // Safety clamp: a day has 1440 minutes, result must be in [0, 1439]
  return ((result % 1440) + 1440) % 1440
}
