/**
 * Minimal INF parser for the verification step — the differentiator over
 * Windows' blind install. We parse the [Manufacturer] and per-arch
 * [Models] sections of every extracted .inf and confirm the device's
 * hardware ID (or model string, for network/manual printers) actually
 * appears before anything is staged.
 */
import { tokenInRange } from '../matching'

export interface InfModelEntry {
  /** Display name, e.g. "HP LaserJet Pro M404-M405 PCL-6" */
  description: string
  installSection: string
  hardwareIds: string[]
}

export interface ParsedInf {
  path: string
  driverVersion?: string
  provider?: string
  /** [Version] Class= value, e.g. "Printer", "Image" (scanners) */
  driverClass?: string
  models: InfModelEntry[]
}

interface IniSection {
  name: string
  lines: string[]
}

function splitSections(content: string): IniSection[] {
  const sections: IniSection[] = []
  let current: IniSection | null = null
  for (let rawLine of content.split(/\r?\n/)) {
    // Strip comments (";" outside quotes) and whitespace.
    const commentIdx = findCommentStart(rawLine)
    if (commentIdx >= 0) rawLine = rawLine.slice(0, commentIdx)
    const line = rawLine.trim()
    if (!line) continue
    const header = line.match(/^\[(.+)\]$/)
    if (header) {
      current = { name: header[1].trim(), lines: [] }
      sections.push(current)
    } else if (current) {
      current.lines.push(line)
    }
  }
  return sections
}

function findCommentStart(line: string): number {
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') inQuotes = !inQuotes
    else if (ch === ';' && !inQuotes) return i
  }
  return -1
}

function stripQuotes(s: string): string {
  const t = s.trim()
  return t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t
}

/** Resolve %token% string substitutions from the [Strings] section. */
function resolveStrings(value: string, strings: Map<string, string>): string {
  return value.replace(/%([^%]+)%/g, (whole, key: string) => {
    return strings.get(key.toLowerCase()) ?? whole
  })
}

export function parseInf(content: string, infPath = ''): ParsedInf {
  const sections = splitSections(content)
  const byName = new Map<string, IniSection>()
  for (const s of sections) byName.set(s.name.toLowerCase(), s)

  const strings = new Map<string, string>()
  for (const s of sections) {
    if (s.name.toLowerCase() === 'strings' || s.name.toLowerCase().startsWith('strings.')) {
      for (const line of s.lines) {
        const eq = line.indexOf('=')
        if (eq < 0) continue
        strings.set(line.slice(0, eq).trim().toLowerCase(), stripQuotes(line.slice(eq + 1)))
      }
    }
  }

  const version = byName.get('version')
  let driverVersion: string | undefined
  let provider: string | undefined
  let driverClass: string | undefined
  if (version) {
    for (const line of version.lines) {
      const eq = line.indexOf('=')
      if (eq < 0) continue
      const key = line.slice(0, eq).trim().toLowerCase()
      const value = resolveStrings(stripQuotes(line.slice(eq + 1)), strings)
      if (key === 'driverver') driverVersion = value.split(',').pop()?.trim()
      if (key === 'provider') provider = value
      if (key === 'class') driverClass = value
    }
  }

  // [Manufacturer]: "%HP%" = HP, NTamd64, NTarm64 → model sections
  // "HP", "HP.NTamd64", "HP.NTarm64" (first listed decoration or bare name).
  const models: InfModelEntry[] = []
  const manufacturer = byName.get('manufacturer')
  if (manufacturer) {
    for (const line of manufacturer.lines) {
      const eq = line.indexOf('=')
      if (eq < 0) continue
      const rhs = line.slice(eq + 1).trim()
      const parts = rhs.split(',').map((p) => p.trim())
      const baseSection = parts[0]
      const decorations = parts.slice(1)
      const sectionNames = decorations.length
        ? decorations.map((d) => `${baseSection}.${d}`)
        : [baseSection]
      // Also try the bare section — some INFs list decorations but ship both.
      sectionNames.push(baseSection)
      for (const name of sectionNames) {
        const modelSection = byName.get(name.toLowerCase())
        if (!modelSection) continue
        for (const modelLine of modelSection.lines) {
          const meq = modelLine.indexOf('=')
          if (meq < 0) continue
          const description = resolveStrings(stripQuotes(modelLine.slice(0, meq)), strings)
          const values = modelLine
            .slice(meq + 1)
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean)
          const installSection = values[0] ?? ''
          const hardwareIds = values.slice(1).map((v) => resolveStrings(v, strings))
          if (description && !models.some((m) => m.description === description && m.installSection === installSection)) {
            models.push({ description, installSection, hardwareIds })
          }
        }
      }
    }
  }

  return { path: infPath, driverVersion, provider, driverClass, models }
}

function normalizeId(id: string): string {
  return id.trim().toUpperCase().replace(/\s+/g, '')
}

function normalizeModel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export interface InfMatch {
  matchedBy: 'hardware-id' | 'model-string'
  matchedValue: string
  model: InfModelEntry
}

/**
 * Check whether the device (by hardware ID, or by model string for
 * network/manual printers) appears in the INF's model list.
 */
export function matchDeviceToInf(
  inf: ParsedInf,
  hardwareIds: string[],
  modelString: string
): InfMatch | null {
  const deviceIds = hardwareIds.map(normalizeId)
  for (const model of inf.models) {
    for (const hwid of model.hardwareIds) {
      const n = normalizeId(hwid)
      if (deviceIds.some((d) => d === n)) {
        return { matchedBy: 'hardware-id', matchedValue: hwid, model }
      }
    }
  }
  // Fall back to model-string matching for network/manual printers: every
  // digit-bearing token of the device model must match a token in the INF
  // model description. Prefix matches count, so "M404dn" matches an INF
  // that lists "M404-M405" (tokenized to "m404", "m405").
  const deviceModel = normalizeModel(modelString)
  if (!deviceModel) return null
  const deviceTokens = deviceModel.split(' ').filter((t) => /\d/.test(t) && t.length >= 3)
  for (const model of inf.models) {
    const desc = normalizeModel(model.description)
    if (!desc) continue
    if (desc.includes(deviceModel) || deviceModel.includes(desc)) {
      return { matchedBy: 'model-string', matchedValue: model.description, model }
    }
    const descTokens = desc.split(' ')
    // Prefix match ("M404dn" vs "M404") or range match ("M234sdw" vs the
    // raw description's "M232-M237").
    const tokenMatches = (t: string): boolean =>
      descTokens.some((d) => d.length >= 3 && (d.startsWith(t) || t.startsWith(d))) ||
      tokenInRange(t, model.description)
    if (deviceTokens.length && deviceTokens.every(tokenMatches)) {
      return { matchedBy: 'model-string', matchedValue: model.description, model }
    }
  }
  return null
}

export interface RankedInfMatch {
  inf: ParsedInf
  match: InfMatch
  priority: number
}

/**
 * Match the device against every INF in the package and rank the matches by
 * how likely each INF is to be the actual spooler print driver. Vendor
 * packages bundle stub INFs (e.g. HPRestStub.INF) and scanner INFs whose
 * [Models] also list the device but which Add-PrinterDriver rejects — real
 * printer-class driver INFs must be tried first, with the rest as fallbacks.
 */
export function rankInfMatches(
  infs: ParsedInf[],
  hardwareIds: string[],
  modelString: string
): RankedInfMatch[] {
  const out: RankedInfMatch[] = []
  for (const inf of infs) {
    const match = matchDeviceToInf(inf, hardwareIds, modelString)
    if (!match) continue
    let priority = match.matchedBy === 'hardware-id' ? 200 : 0
    const cls = (inf.driverClass ?? '').toLowerCase()
    if (cls === 'printer') priority += 100
    else if (cls) priority -= 100 // Image (scanner), USBDevice stubs, …
    const base = inf.path.split(/[\\/]/).pop()?.toLowerCase() ?? ''
    if (base.includes('stub') || /\bstub\b|\(rest\)/i.test(match.model.description)) priority -= 50
    if (/scan|fax/.test(base)) priority -= 150
    out.push({ inf, match, priority })
  }
  return out.sort((a, b) => b.priority - a.priority)
}
