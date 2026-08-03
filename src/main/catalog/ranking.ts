/**
 * Candidate ranking — the core differentiator over Windows' Add Printer flow.
 *
 * Scoring:
 *   +100  exact hardware ID match (catalog metadata now; re-confirmed against
 *         the extracted INF at install time)
 *   +50   title contains the exact model token (e.g. "M404dn")
 *   +20   newer version/date tiebreak among otherwise-equal candidates
 *   −20   "series" / "universal" / "class" drivers — kept, ranked below
 *         model-specific drivers
 *   Microsoft IPP Class Driver: always shown, pinned last, labeled as what
 *   Windows would likely install by default.
 *
 * Hard filters: architecture must match the host (x64/ARM64) and the OS
 * applicability must include the running Windows version.
 */
import { tokenInRange } from '../matching'
import type { CatalogCandidate, RankedCandidate } from '@shared/types'

export interface RankingContext {
  /** Host architecture */
  arch: 'x64' | 'arm64'
  /** e.g. "11" or "10" */
  windowsMajor: string
  /** Device hardware IDs (USB), e.g. USBPRINT\HewlettPackardHP_LaserJet... */
  hardwareIds: string[]
  /** Free-text model, e.g. "HP LaserJet Pro M404dn" */
  model: string
}

const GENERIC_WORDS = /\b(series|universal|class driver|generic)\b/i
const IPP_CLASS = /microsoft ipp class driver/i
// This is a PRINT driver tool — scanner/imaging/fax bundles (e.g. "HP Image
// Driver Update") pass catalog searches but are the wrong thing to install.
const SCAN_WORDS = /\b(scan(?:ner)?|imag(?:e|ing)|fax|ocr|twain|wia)\b/i

/** Best-effort PDL detection from the driver title (PCL6/PCL5/PS/XPS). */
export function detectPdl(title: string): string | undefined {
  const found: string[] = []
  if (/pcl[\s-]?6|pcl6/i.test(title)) found.push('PCL6')
  if (/pcl[\s-]?5/i.test(title)) found.push('PCL5')
  if (/postscript|\bps\b/i.test(title)) found.push('PS')
  if (/\bxps\b/i.test(title)) found.push('XPS')
  return found.length ? found.join('/') : undefined
}

/**
 * Extract model tokens worth matching exactly: alphanumeric tokens that
 * contain at least one digit ("M404dn", "MFC-L2750DW", "ET-2760").
 */
export function extractModelTokens(model: string): string[] {
  const tokens = model.split(/[\s/,()]+/).filter((t) => /\d/.test(t) && /[a-z]/i.test(t) || /^\d{3,}$/.test(t))
  return tokens.map((t) => t.replace(/[^\w-]/g, '')).filter((t) => t.length >= 3)
}

/**
 * Normalize a hardware ID for comparison: the catalog and INFs vary in
 * case and separator usage.
 */
export function normalizeHardwareId(id: string): string {
  return id.trim().toUpperCase().replace(/\s+/g, '')
}

function archMatches(candidate: CatalogCandidate, arch: 'x64' | 'arm64'): boolean {
  const text = `${candidate.title} ${candidate.products}`.toLowerCase()
  const mentionsX64 = /\b(x64|amd64|64-bit)\b/.test(text)
  const mentionsArm = /\barm64\b/.test(text)
  const mentionsX86Only = /\b(x86|32-bit)\b/.test(text) && !mentionsX64 && !mentionsArm
  if (arch === 'x64') {
    if (mentionsArm && !mentionsX64) return false
    if (mentionsX86Only) return false
  } else {
    if (mentionsX64 && !mentionsArm) return false
    if (mentionsX86Only) return false
  }
  // No arch mentioned at all → keep; the INF check at install time decides.
  return true
}

function osMatches(candidate: CatalogCandidate, windowsMajor: string): boolean {
  const products = candidate.products.toLowerCase()
  if (!/windows/.test(products)) return true // driver targets listed by product line only
  if (windowsMajor === '11') {
    // Windows 11 accepts drivers listed for Windows 11 or Windows 10 (same
    // driver model); reject listings that only name pre-10 versions.
    if (/windows 1[01]/.test(products)) return true
    return !/windows (7|8|8\.1|vista|xp|2000)\b/.test(products)
  }
  if (windowsMajor === '10') {
    if (/windows 10/.test(products)) return true
    return !/windows (7|8|8\.1|vista|xp|2000)\b/.test(products)
  }
  return true
}

export function scoreCandidate(
  candidate: CatalogCandidate,
  ctx: RankingContext
): { score: number; reasons: string[]; isWindowsDefault: boolean } {
  const reasons: string[] = []
  let score = 0
  const isWindowsDefault = IPP_CLASS.test(candidate.title)
  if (isWindowsDefault) {
    return {
      score: -1000,
      reasons: ['what Windows would likely install by default'],
      isWindowsDefault: true
    }
  }

  const haystack = `${candidate.title} ${candidate.products}`
  const normalizedHaystack = normalizeHardwareId(haystack)
  for (const hwid of ctx.hardwareIds) {
    if (normalizedHaystack.includes(normalizeHardwareId(hwid))) {
      score += 100
      reasons.push('exact hardware ID match')
      break
    }
  }

  // Exact token in title ("M404dn"), or a prefix relation with a title
  // token — vendor titles often cover a model range ("M404-M405").
  const tokens = extractModelTokens(ctx.model)
  const titleLower = candidate.title.toLowerCase()
  const titleTokens = titleLower.split(/[^a-z0-9]+/).filter((t) => t.length >= 3)
  const matchedToken = tokens.find((t) => {
    const tl = t.toLowerCase()
    return (
      titleLower.includes(tl) ||
      titleTokens.some((tt) => /\d/.test(tt) && (tt.startsWith(tl) || tl.startsWith(tt))) ||
      tokenInRange(t, candidate.title)
    )
  })
  if (matchedToken) {
    score += 50
    reasons.push(`model-specific ("${matchedToken}" matches title)`)
  }

  if (GENERIC_WORDS.test(candidate.title)) {
    score -= 20
    reasons.push('generic series/universal driver — ranked below model-specific')
  }

  if (SCAN_WORDS.test(candidate.title)) {
    score -= 60
    reasons.push('scanner/imaging/fax package — not a print driver')
  }

  if (/printer/i.test(candidate.classification)) {
    score += 10
    reasons.push('classified as a printer driver')
  }

  if (reasons.length === 0) {
    reasons.push('matched search terms only')
  }
  return { score, reasons, isWindowsDefault: false }
}

function parseCatalogDate(d: string): number {
  const t = Date.parse(d)
  return Number.isFinite(t) ? t : 0
}

function parseVersion(v: string): number[] {
  return v.split('.').map((p) => parseInt(p, 10) || 0)
}

function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * Rank candidates. Hard-filters arch/OS mismatches (except the IPP class
 * driver row, which is informational), scores the rest, then applies the
 * +20 newer-version tiebreak within groups of equal base score.
 */
export function rankCandidates(
  candidates: CatalogCandidate[],
  ctx: RankingContext
): RankedCandidate[] {
  // Deduplicate by updateId (merged hwid+model searches often overlap).
  const unique = new Map<string, CatalogCandidate>()
  for (const c of candidates) {
    if (!unique.has(c.updateId)) unique.set(c.updateId, c)
  }

  const scored: RankedCandidate[] = []
  for (const c of unique.values()) {
    const isDefaultRow = IPP_CLASS.test(c.title)
    const archOk = archMatches(c, ctx.arch)
    const osOk = osMatches(c, ctx.windowsMajor)
    if (!isDefaultRow && (!archOk || !osOk)) continue
    const { score, reasons, isWindowsDefault } = scoreCandidate(c, ctx)
    scored.push({
      ...c,
      score,
      reasons,
      isWindowsDefault,
      archFiltered: false,
      pdl: detectPdl(c.title)
    })
  }

  // +20 newer version/date tiebreak within equal-score groups.
  const groups = new Map<number, RankedCandidate[]>()
  for (const c of scored) {
    const g = groups.get(c.score) ?? []
    g.push(c)
    groups.set(c.score, g)
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const newest = [...group].sort(
      (a, b) =>
        compareVersions(b.version, a.version) ||
        parseCatalogDate(b.lastUpdated) - parseCatalogDate(a.lastUpdated)
    )[0]
    if (newest && !newest.isWindowsDefault) {
      newest.score += 20
      newest.reasons.push('newer version than similar candidates')
    }
  }

  scored.sort((a, b) => {
    // IPP class driver pinned last, always.
    if (a.isWindowsDefault !== b.isWindowsDefault) return a.isWindowsDefault ? 1 : -1
    return (
      b.score - a.score ||
      compareVersions(b.version, a.version) ||
      parseCatalogDate(b.lastUpdated) - parseCatalogDate(a.lastUpdated)
    )
  })
  // The catalog lists the same package under several GUIDs (one per product
  // grouping). Collapse rows with identical title/version/size, keeping the
  // best-ranked one, so the picker isn't a wall of duplicates.
  const seenDisplay = new Set<string>()
  return scored.filter((c) => {
    const key = `${c.title}|${c.version}|${c.sizeText}`.toLowerCase()
    if (seenDisplay.has(key)) return false
    seenDisplay.add(key)
    return true
  })
}
