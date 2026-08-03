/**
 * Model-token utilities shared by catalog ranking and INF verification.
 *
 * Vendors name driver packages after model RANGES ("HP LaserJet MFP
 * M232-M237") while devices report a specific model ("M234sdw"), so plain
 * substring/prefix matching misses them. A token like "M234sdw" is
 * considered covered by "M232-M237" when the letter prefix matches and the
 * number falls inside the range.
 */

export function tokenNumber(token: string): { prefix: string; num: number } | null {
  const m = /^([a-z]*)(\d{2,})/i.exec(token.trim())
  return m ? { prefix: m[1].toLowerCase(), num: parseInt(m[2], 10) } : null
}

/** True when `token` (e.g. "M234sdw") falls inside a range in `text`
 *  (e.g. "... M232-M237 ..."). */
export function tokenInRange(token: string, text: string): boolean {
  const t = tokenNumber(token)
  if (!t) return false
  const re = /([a-z]*)(\d{2,})\s*[-–]\s*([a-z]*)(\d{2,})/gi
  for (const m of text.matchAll(re)) {
    const startPrefix = m[1].toLowerCase()
    const endPrefix = m[3].toLowerCase()
    const start = parseInt(m[2], 10)
    const end = parseInt(m[4], 10)
    const prefixOk =
      (startPrefix && startPrefix === t.prefix) ||
      (endPrefix && endPrefix === t.prefix) ||
      (!startPrefix && !endPrefix && !t.prefix)
    if (prefixOk && t.num >= Math.min(start, end) && t.num <= Math.max(start, end)) return true
  }
  return false
}
