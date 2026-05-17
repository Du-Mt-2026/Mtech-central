/**
 * Centralized phone number normalization for Brazilian numbers.
 *
 * The key insight: Brazilian phone numbers have predictable lengths:
 *   - Without country code: 10 digits (landline) or 11 digits (mobile)
 *   - With country code 55: 12 digits (landline) or 13 digits (mobile)
 *
 * The previous logic (`if (!startsWith('55')) prepend '55'`) was buggy for
 * DDD 55 (Rio Grande do Sul) because the cleaned number already starts with
 * "55" (the area code), so the country code was never added.
 *
 * Examples:
 *   "55 99999-9999"  → "5555999999999" (DDD 55 + mobile → país 55 + DDD 55 + número)
 *   "11 99999-0001"  → "5511999990001" (DDD 11 + mobile → país 55 + DDD 11 + número)
 *   "5511999990001"  → "5511999990001" (already has country code)
 *   "5555999999999"  → "5555999999999" (already has country code + DDD 55)
 */

/**
 * Normalizes a Brazilian phone number to include the country code (55).
 * Returns only digits, with the 55 country code prepended if missing.
 */
export function normalizePhone(phone: string): string {
  if (!phone) return ''

  // Strip all non-digit characters
  let cleaned = phone.replace(/[^0-9]/g, '')

  // Remove leading 0 (common in old dialing format)
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1)
  }

  // Remove duplicate country code if somehow doubled (e.g., "5555...5555...")
  if (cleaned.startsWith('5555') && cleaned.length > 13) {
    cleaned = '55' + cleaned.substring(4)
  }

  // Core logic: use LENGTH to determine if country code is present
  // 10-11 digits = DDD + number (no country code) → prepend 55
  // 12-13 digits = already has country code → keep as is
  if (cleaned.length >= 10 && cleaned.length <= 11) {
    // No country code — prepend 55
    cleaned = '55' + cleaned
  } else if (cleaned.length >= 12 && cleaned.length <= 13) {
    // Already has country code — keep as is
    // But verify it starts with 55 (Brazil)
    if (!cleaned.startsWith('55')) {
      // Non-Brazilian number with similar length — just return as is
      // (shouldn't happen in this system but handle gracefully)
    }
  } else if (cleaned.length > 13) {
    // Too long — likely has extra digits. Try to extract the valid portion.
    // If it starts with 55, take the first 13 digits (mobile) or 12 (landline)
    if (cleaned.startsWith('55')) {
      // Already has country code — trim to 13 digits max
      cleaned = cleaned.substring(0, 13)
    } else {
      // No country code but too long — trim and prepend
      cleaned = '55' + cleaned.substring(0, 11)
    }
  }
  // If length < 10, it's an invalid/short number — return as is (will likely fail validation)

  return cleaned
}

/**
 * Formats a normalized phone number for display.
 * Example: "5555999999999" → "+55 (55) 99999-9999"
 */
export function formatPhoneDisplay(phone: string): string {
  const normalized = normalizePhone(phone)

  if (normalized.startsWith('55') && normalized.length >= 12) {
    const ddi = normalized.slice(0, 2)
    const ddd = normalized.slice(2, 4)
    const rest = normalized.slice(4)

    if (rest.length <= 9) {
      return `+${ddi} (${ddd}) ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`
    }
    return `+${ddi} (${ddd}) ${rest}`
  }

  return phone
}

/**
 * Validates if a phone number is a valid Brazilian mobile or landline number
 * after normalization (12-13 digits starting with 55).
 */
export function isValidBrazilianPhone(phone: string): boolean {
  const normalized = normalizePhone(phone)
  return normalized.startsWith('55') && (normalized.length === 12 || normalized.length === 13)
}
