/**
 * Microsoft Update Catalog scraper.
 *
 * There is no official API, so this module scrapes politely: one request at
 * a time, a shared in-memory cache per session, and a real User-Agent.
 * Parsing is separated from fetching so the parsers can be unit-tested
 * against fixture HTML — this is the most likely module to break when
 * Microsoft changes the page layout.
 */
import * as cheerio from 'cheerio'
import type { CatalogCandidate } from '@shared/types'

export const CATALOG_BASE = 'https://www.catalog.update.microsoft.com'

export function searchUrl(query: string): string {
  return `${CATALOG_BASE}/Search.aspx?q=${encodeURIComponent(query)}`
}

/* ------------------------------------------------------------------ */
/* Parsing (pure — unit tested against fixtures)                       */
/* ------------------------------------------------------------------ */

/**
 * Parse the Search.aspx results table. Rows live in
 * #ctl00_catalogBody_updateMatches with id "<guid>_R<n>"; each row's link
 * id is "<guid>_link" and the size cell contains a hidden span
 * "<guid>_size" with the exact byte count.
 */
export function parseSearchResults(html: string): CatalogCandidate[] {
  const $ = cheerio.load(html)
  const rows = $('#ctl00_catalogBody_updateMatches tr')
  const candidates: CatalogCandidate[] = []
  rows.each((_, row) => {
    const $row = $(row)
    const rowId = $row.attr('id') ?? ''
    // Header row has id "headerRow"; data rows are "<guid>_R<n>".
    const guidMatch = rowId.match(/^([0-9a-f-]{36})_R\d+$/i)
    if (!guidMatch) return
    const updateId = guidMatch[1].toLowerCase()
    const cells = $row.find('td')
    // Layout: [icon, title, products, classification, last updated, version, size, download btn]
    const title = $row.find(`a[id="${guidMatch[1]}_link"]`).text().trim() || $(cells[1]).text().trim()
    const products = $(cells[2]).text().trim()
    const classification = $(cells[3]).text().trim()
    const lastUpdated = $(cells[4]).text().trim()
    const version = $(cells[5]).text().trim()
    const sizeCell = $(cells[6])
    const sizeText = sizeCell.find('span[id$="_size"]').first().text().trim() || sizeCell.text().trim()
    const hiddenBytes = sizeCell.find('span[id$="_originalSize"]').first().text().trim()
    const sizeBytes = hiddenBytes ? parseInt(hiddenBytes, 10) : parseSizeText(sizeText)
    if (!title) return
    candidates.push({
      updateId,
      title,
      products,
      classification,
      lastUpdated,
      version,
      sizeText,
      sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0
    })
  })
  return candidates
}

export function parseSizeText(text: string): number {
  const m = text.match(/([\d.]+)\s*(KB|MB|GB)/i)
  if (!m) return 0
  const n = parseFloat(m[1])
  const unit = m[2].toUpperCase()
  return Math.round(n * (unit === 'KB' ? 1024 : unit === 'MB' ? 1024 ** 2 : 1024 ** 3))
}

/**
 * Parse the DownloadDialog.aspx response. The page embeds a JS
 * `downloadInformation[...].files[...].url = 'https://...'` structure;
 * pull every windowsupdate.com file URL out of it.
 */
export function parseDownloadDialog(body: string): string[] {
  const urls = new Set<string>()
  const re = /https?:\/\/[a-z0-9.-]*(?:download\.windowsupdate\.com|delivery\.mp\.microsoft\.com)\/[^'"\s\\]+/gi
  for (const m of body.matchAll(re)) {
    urls.add(m[0])
  }
  return [...urls]
}

/* ------------------------------------------------------------------ */
/* Fetching (serialized, cached)                                       */
/* ------------------------------------------------------------------ */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

// Polite scraping: strictly one in-flight catalog request at a time.
let requestChain: Promise<unknown> = Promise.resolve()
const REQUEST_GAP_MS = 500

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = requestChain.then(fn).then(async (r) => {
    await new Promise((res) => setTimeout(res, REQUEST_GAP_MS))
    return r
  })
  requestChain = next.catch(() => undefined)
  return next
}

const searchCache = new Map<string, CatalogCandidate[]>()
const downloadCache = new Map<string, string[]>()

export function clearCaches(): void {
  searchCache.clear()
  downloadCache.clear()
}

export async function searchCatalog(query: string): Promise<CatalogCandidate[]> {
  const key = query.toLowerCase()
  const cached = searchCache.get(key)
  if (cached) return cached
  const results = await enqueue(async () => {
    const res = await fetch(searchUrl(query), {
      headers: { 'User-Agent': USER_AGENT }
    })
    if (!res.ok) {
      throw new Error(`Catalog search failed: HTTP ${res.status} for ${searchUrl(query)}`)
    }
    const html = await res.text()
    // "We did not find any results" pages parse to an empty list — that's fine.
    return parseSearchResults(html)
  })
  searchCache.set(key, results)
  return results
}

/**
 * Resolve download URLs for an update GUID via the well-known
 * DownloadDialog.aspx POST used by PSWindowsUpdate and similar tools.
 */
export async function getDownloadUrls(updateId: string): Promise<string[]> {
  const cached = downloadCache.get(updateId)
  if (cached) return cached
  const urls = await enqueue(async () => {
    const payload = [{ size: 0, languages: '', uidInfo: updateId, updateID: updateId }]
    const body = new URLSearchParams({
      updateIDs: JSON.stringify(payload),
      updateIDsBlockedForImport: '',
      wsusApiPresent: '',
      contentImport: '',
      sku: '',
      serverName: '',
      ssl: '',
      portNumber: '',
      version: ''
    }).toString()
    const res = await fetch(`${CATALOG_BASE}/DownloadDialog.aspx`, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    })
    if (!res.ok) {
      throw new Error(`DownloadDialog failed: HTTP ${res.status} for update ${updateId}`)
    }
    return parseDownloadDialog(await res.text())
  })
  downloadCache.set(updateId, urls)
  return urls
}
