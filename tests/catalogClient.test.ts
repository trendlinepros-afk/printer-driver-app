import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  parseSearchResults,
  parseDownloadDialog,
  parseSizeText,
  searchUrl
} from '../src/main/catalog/catalogClient'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8')

describe('parseSearchResults', () => {
  const results = parseSearchResults(fixture('search-results.html'))

  it('parses all data rows and skips the header', () => {
    expect(results).toHaveLength(3)
  })

  it('extracts the update GUID from the row id', () => {
    expect(results[0].updateId).toBe('8b18d442-c464-46f1-9e6c-3aa6a4d0a123')
  })

  it('extracts title, products, classification, date and version', () => {
    const r = results[0]
    expect(r.title).toBe('HP LaserJet Pro M404-M405 PCL-6 (V4) Printer Driver')
    expect(r.products).toBe('Windows 10 and later drivers')
    expect(r.classification).toBe('Drivers (Printers)')
    expect(r.lastUpdated).toBe('6/17/2021')
    expect(r.version).toBe('61.300.1.24923')
  })

  it('prefers the hidden originalSize byte count', () => {
    expect(results[0].sizeBytes).toBe(21495808)
    expect(results[0].sizeText).toBe('20.5 MB')
  })

  it('returns an empty array for a page with no results table', () => {
    expect(parseSearchResults('<html><body>We did not find any results</body></html>')).toEqual([])
  })
})

describe('parseSizeText', () => {
  it('parses KB/MB/GB', () => {
    expect(parseSizeText('20.5 MB')).toBe(Math.round(20.5 * 1024 * 1024))
    expect(parseSizeText('812 KB')).toBe(812 * 1024)
    expect(parseSizeText('1.1 GB')).toBe(Math.round(1.1 * 1024 ** 3))
    expect(parseSizeText('garbage')).toBe(0)
  })
})

describe('parseDownloadDialog', () => {
  it('extracts .cab URLs on download.windowsupdate.com', () => {
    const urls = parseDownloadDialog(fixture('download-dialog.html'))
    expect(urls).toHaveLength(1)
    expect(urls[0]).toBe(
      'https://catalog.s.download.windowsupdate.com/c/msdownload/update/driver/drvs/2021/06/20049246_abcdef0123456789abcdef0123456789abcdef01.cab'
    )
  })

  it('returns empty for a page with no links', () => {
    expect(parseDownloadDialog('<html><body>error</body></html>')).toEqual([])
  })
})

describe('searchUrl', () => {
  it('URL-encodes the query', () => {
    expect(searchUrl('USBPRINT\\HPHP_LaserJet_Pro')).toBe(
      'https://www.catalog.update.microsoft.com/Search.aspx?q=USBPRINT%5CHPHP_LaserJet_Pro'
    )
  })
})
