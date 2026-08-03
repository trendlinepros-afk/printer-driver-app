import { describe, it, expect } from 'vitest'
import { tokenInRange, tokenNumber } from '../src/main/matching'
import { buildFallbackQueries } from '../src/main/catalog/search'
import { parseInf, matchDeviceToInf } from '../src/main/install/infParser'
import { rankCandidates } from '../src/main/catalog/ranking'
import type { CatalogCandidate } from '../src/shared/types'

describe('tokenNumber', () => {
  it('splits letter prefix and number', () => {
    expect(tokenNumber('M234sdw')).toEqual({ prefix: 'm', num: 234 })
    expect(tokenNumber('2760')).toEqual({ prefix: '', num: 2760 })
    expect(tokenNumber('dn')).toBeNull()
  })
})

describe('tokenInRange', () => {
  it('matches a specific model inside a series range', () => {
    expect(tokenInRange('M234sdw', 'HP LaserJet MFP M232-M237 PCLmS')).toBe(true)
    expect(tokenInRange('M404dn', 'HP LaserJet Pro M404-M405')).toBe(true)
  })
  it('rejects numbers outside the range or wrong prefix', () => {
    expect(tokenInRange('M240', 'HP LaserJet MFP M232-M237')).toBe(false)
    expect(tokenInRange('P234', 'HP LaserJet MFP M232-M237')).toBe(false)
  })
  it('ignores text without ranges', () => {
    expect(tokenInRange('M234sdw', 'HP - Printer - 32.1.2001.8207')).toBe(false)
  })
})

describe('buildFallbackQueries', () => {
  it('broadens M234sdw to the stripped token then the family', () => {
    expect(buildFallbackQueries('HP LaserJet MFP M234sdw')).toEqual([
      'HP LaserJet MFP M234',
      'HP LaserJet MFP'
    ])
  })
  it('returns nothing for models with no digit token', () => {
    expect(buildFallbackQueries('Generic Printer')).toEqual([])
  })
})

// End-to-end: the exact real-world case — SNMP reports M234sdw, the HP
// package is named and INF'd as M232-M237.
const RANGE_INF = `
[Version]
Signature="$Windows NT$"
Class=Printer
Provider=%HP%
DriverVer=10/07/2020,32.1.2001.8207
[Manufacturer]
%HP%=HP,NTamd64
[HP.NTamd64]
"HP LaserJet MFP M232-M237 PCLmS" = PCLMS_SECTION, USBPRINT\\HPHP_LaserJet_MFPBEEF
[Strings]
HP="HP"
`

describe('M234sdw device against M232-M237 series package', () => {
  it('passes INF verification via the range', () => {
    const inf = parseInf(RANGE_INF, 'hpypclms32_v4.inf')
    const m = matchDeviceToInf(inf, [], 'HP LaserJet MFP M234sdw')
    expect(m?.matchedBy).toBe('model-string')
    expect(m?.matchedValue).toContain('M232-M237')
  })

  it('ranks a range-titled candidate as model-specific', () => {
    const candidate: CatalogCandidate = {
      updateId: 'range',
      title: 'HP LaserJet MFP M232-M237 Printer Driver',
      products: 'Windows 10 and later drivers',
      classification: 'Drivers (Printers)',
      lastUpdated: '10/7/2020',
      version: '32.1.2001.8207',
      sizeText: '13.3 MB',
      sizeBytes: 13944171
    }
    const ranked = rankCandidates([candidate], {
      arch: 'x64',
      windowsMajor: '11',
      hardwareIds: [],
      model: 'HP LaserJet MFP M234sdw'
    })
    expect(ranked[0].score).toBeGreaterThanOrEqual(50)
    expect(ranked[0].reasons.join(' ')).toContain('model-specific')
  })
})
