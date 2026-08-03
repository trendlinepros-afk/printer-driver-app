import { searchCatalog, searchUrl } from './catalogClient'
import { rankCandidates } from './ranking'
import { getHostInfo } from '../hostInfo'
import { logInfo, logWarn } from '../logger'
import type { CatalogCandidate, CatalogSearchResult, DiscoveredPrinter } from '@shared/types'

/**
 * Normalize a raw model string for a catalog query: strip status/URL noise
 * that SNMP sysDescr strings often carry.
 */
export function normalizeModelQuery(model: string): string {
  return model
    .replace(/;.*$/, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\((?:[^)]*)\)/g, ' ')
    .replace(/\b(v?\d+\.\d+[\d.]*)\b/g, ' ') // firmware versions
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Search by hardware ID when we have one, else by normalized make/model.
 * When both exist, run both and merge. The IPP class driver entry is
 * fetched too so the "Windows default" row is always present.
 */
export async function searchForPrinter(printer: DiscoveredPrinter): Promise<CatalogSearchResult> {
  const queries: string[] = []
  // USBPRINT\ hardware IDs are the highest-quality search key.
  const bestHwid = printer.hardwareIds.find((h) => /^USBPRINT\\/i.test(h)) ?? printer.hardwareIds[0]
  if (bestHwid) queries.push(bestHwid)
  const modelQuery = normalizeModelQuery(printer.model)
  // Never search the catalog for the "Unknown printer" placeholder.
  if (
    modelQuery &&
    !/^unknown\b/i.test(modelQuery) &&
    modelQuery.toLowerCase() !== bestHwid?.toLowerCase()
  ) {
    queries.push(modelQuery)
  }
  return runSearch(queries, printer)
}

export async function searchManual(query: string): Promise<CatalogSearchResult> {
  const printer: DiscoveredPrinter = {
    id: `manual:${query}`,
    model: query,
    sources: ['manual'],
    hardwareIds: [],
    detail: []
  }
  return runSearch([normalizeModelQuery(query)], printer)
}

/**
 * Progressively broader queries for when the exact model finds nothing.
 * Catalog entries are usually indexed under series-range names
 * ("M232-M237"), so "HP LaserJet MFP M234sdw" → "HP LaserJet MFP M234" →
 * "HP LaserJet MFP"; range-aware ranking then surfaces the right package.
 */
export function buildFallbackQueries(model: string): string[] {
  const norm = normalizeModelQuery(model)
  const words = norm.split(' ').filter(Boolean)
  const idx = words.findIndex((w) => /\d/.test(w))
  if (idx < 0) return []
  const brand = words.slice(0, idx).join(' ')
  const token = words[idx]
  const stripped = /^([A-Za-z]*\d+)/.exec(token)?.[1]
  const out: string[] = []
  if (stripped && stripped.toLowerCase() !== token.toLowerCase()) {
    out.push(brand ? `${brand} ${stripped}` : stripped)
  }
  if (brand.split(' ').length >= 2) out.push(brand)
  return out
}

async function runSearch(
  queries: string[],
  printer: DiscoveredPrinter
): Promise<CatalogSearchResult> {
  const host = await getHostInfo()
  const merged: CatalogCandidate[] = []
  const tried: string[] = []
  let lastError: string | undefined

  const searchOne = async (q: string): Promise<void> => {
    tried.push(q)
    try {
      logInfo(`Catalog search: "${q}"`)
      const results = await searchCatalog(q)
      logInfo(`Catalog search: "${q}" → ${results.length} result(s)`)
      merged.push(...results)
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      logWarn(`Catalog search failed for "${q}": ${lastError}`)
    }
  }

  for (const q of queries.filter(Boolean)) {
    await searchOne(q)
  }

  // Zero results → walk progressively broader queries until one hits.
  if (merged.length === 0) {
    for (const fallback of buildFallbackQueries(printer.model)) {
      if (tried.some((t) => t.toLowerCase() === fallback.toLowerCase())) continue
      logInfo(`No results yet — broadening the search to "${fallback}"`)
      await searchOne(fallback)
      if (merged.length > 0) break
    }
  }

  // Always try to surface the Microsoft IPP Class Driver as the
  // "what Windows would do" baseline.
  if (!merged.some((c) => /microsoft ipp class driver/i.test(c.title))) {
    try {
      const ipp = await searchCatalog('Microsoft IPP Class Driver')
      const first = ipp.find((c) => /microsoft ipp class driver/i.test(c.title))
      if (first) merged.push(first)
    } catch {
      logWarn('Could not fetch the Microsoft IPP Class Driver baseline entry')
    }
  }

  const ranked = rankCandidates(merged, {
    arch: host.arch,
    windowsMajor: host.windowsVersion,
    hardwareIds: printer.hardwareIds,
    model: printer.model
  })

  const result: CatalogSearchResult = {
    candidates: ranked,
    queriesTried: tried,
    catalogUrl: searchUrl(queries[0] ?? printer.model)
  }
  if (merged.length === 0 && lastError) {
    result.error = `Could not reach the Microsoft Update Catalog: ${lastError}`
  } else if (ranked.filter((c) => !c.isWindowsDefault).length === 0) {
    result.error =
      'No matching drivers found. Try a shorter query — e.g. just the model number ' +
      `("${suggestShorterQuery(printer.model)}") — or search the catalog directly.`
  }
  return result
}

export function suggestShorterQuery(model: string): string {
  const tokens = normalizeModelQuery(model).split(' ')
  return tokens.length > 2 ? tokens.slice(-2).join(' ') : normalizeModelQuery(model)
}
