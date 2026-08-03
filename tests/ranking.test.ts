import { describe, it, expect } from 'vitest'
import {
  rankCandidates,
  extractModelTokens,
  detectPdl,
  type RankingContext
} from '../src/main/catalog/ranking'
import type { CatalogCandidate } from '../src/shared/types'

function candidate(overrides: Partial<CatalogCandidate>): CatalogCandidate {
  return {
    updateId: Math.random().toString(36).slice(2),
    title: 'Some driver',
    products: 'Windows 10 and later drivers',
    classification: 'Drivers (Printers)',
    lastUpdated: '1/1/2021',
    version: '1.0.0.0',
    sizeText: '10 MB',
    sizeBytes: 10_000_000,
    ...overrides
  }
}

const ctx: RankingContext = {
  arch: 'x64',
  windowsMajor: '11',
  hardwareIds: ['USBPRINT\\HewlettPackardHP_LaserB57D', 'HewlettPackardHP_LaserB57D'],
  model: 'HP LaserJet Pro M404dn'
}

describe('extractModelTokens', () => {
  it('finds digit-bearing model tokens', () => {
    expect(extractModelTokens('HP LaserJet Pro M404dn')).toEqual(['M404dn'])
    expect(extractModelTokens('Brother MFC-L2750DW series')).toEqual(['MFC-L2750DW'])
  })
})

describe('detectPdl', () => {
  it('detects PDLs from driver titles', () => {
    expect(detectPdl('HP LaserJet Pro M404-M405 PCL-6 (V4) Printer Driver')).toBe('PCL6')
    expect(detectPdl('Xerox GPD PS V6.212.5.0')).toBe('PS')
    expect(detectPdl('Some PostScript and PCL 6 driver')).toBe('PCL6/PS')
    expect(detectPdl('Plain driver title')).toBeUndefined()
  })

  it('is attached to ranked candidates', () => {
    const c = candidate({ updateId: 'a', title: 'HP LaserJet Pro M404dn PCL-6 Driver' })
    const ranked = rankCandidates([c], ctx)
    expect(ranked[0].pdl).toBe('PCL6')
  })
})

describe('rankCandidates', () => {
  it('ranks the model-specific driver above universal/series drivers', () => {
    const modelSpecific = candidate({
      updateId: 'a',
      title: 'HP LaserJet Pro M404-M405 PCL-6 (V4) Printer Driver'
    })
    const universal = candidate({ updateId: 'b', title: 'HP Universal Printing PCL 6' })
    const ranked = rankCandidates([universal, modelSpecific], ctx)
    expect(ranked[0].updateId).toBe('a')
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
    expect(ranked[0].reasons.join(' ')).toContain('model-specific')
  })

  it('penalizes series/universal drivers by 20', () => {
    const universal = candidate({ updateId: 'b', title: 'HP Universal Printing PCL 6' })
    const ranked = rankCandidates([universal], ctx)
    // −20 generic, +10 "Drivers (Printers)" classification
    expect(ranked[0].score).toBe(-10)
    expect(ranked[0].reasons.join(' ')).toContain('generic')
  })

  it('ranks scanner/imaging packages far below print drivers regardless of version', () => {
    // Real case: "HP Image Driver Update" (v63.x) outranked the actual
    // print driver (v32.x) purely on the newer-version tiebreak.
    const scanner = candidate({
      updateId: 'img',
      title: 'HP Image Driver Update',
      version: '63.8.7102.0',
      lastUpdated: '6/1/2023'
    })
    const printDriver = candidate({
      updateId: 'prn',
      title: 'HP - Printer',
      version: '32.1.2001.8207',
      lastUpdated: '5/9/2020'
    })
    const ranked = rankCandidates([scanner, printDriver], ctx)
    expect(ranked[0].updateId).toBe('prn')
    expect(ranked.find((c) => c.updateId === 'img')?.reasons.join(' ')).toContain(
      'not a print driver'
    )
  })

  it('gives +100 for a hardware ID match in catalog metadata', () => {
    const withHwid = candidate({
      updateId: 'a',
      title: 'HP driver',
      products: 'USBPRINT\\HewlettPackardHP_LaserB57D'
    })
    const ranked = rankCandidates([withHwid], ctx)
    expect(ranked[0].score).toBeGreaterThanOrEqual(100)
    expect(ranked[0].reasons).toContain('exact hardware ID match')
  })

  it('always pins the Microsoft IPP Class Driver last, labeled as the Windows default', () => {
    const ipp = candidate({ updateId: 'ipp', title: 'Microsoft IPP Class Driver' })
    const modelSpecific = candidate({ updateId: 'a', title: 'HP LaserJet Pro M404dn Driver' })
    const universal = candidate({ updateId: 'b', title: 'HP Universal Printing PCL 6' })
    const ranked = rankCandidates([ipp, modelSpecific, universal], ctx)
    expect(ranked.at(-1)?.updateId).toBe('ipp')
    expect(ranked.at(-1)?.isWindowsDefault).toBe(true)
    expect(ranked.at(-1)?.reasons[0]).toContain('Windows would likely install by default')
  })

  it('applies the +20 newer-version tiebreak within equal-score groups', () => {
    const older = candidate({
      updateId: 'old',
      title: 'HP LaserJet Pro M404dn Driver',
      version: '1.0.0.0',
      lastUpdated: '1/1/2019'
    })
    const newer = candidate({
      updateId: 'new',
      title: 'HP LaserJet Pro M404dn Driver',
      version: '2.0.0.0',
      lastUpdated: '6/17/2021'
    })
    const ranked = rankCandidates([older, newer], ctx)
    expect(ranked[0].updateId).toBe('new')
    expect(ranked[0].score - ranked[1].score).toBe(20)
    expect(ranked[0].reasons.join(' ')).toContain('newer version')
  })

  it('hard-filters wrong-architecture candidates', () => {
    const armOnly = candidate({ updateId: 'arm', title: 'HP M404dn Driver ARM64' })
    const ranked = rankCandidates([armOnly], ctx)
    expect(ranked).toHaveLength(0)
  })

  it('hard-filters pre-Windows-10-only candidates', () => {
    const old = candidate({
      updateId: 'w7',
      title: 'HP LaserJet Pro M404dn Driver',
      products: 'Windows 7,Windows 8.1'
    })
    const ranked = rankCandidates([old], ctx)
    expect(ranked).toHaveLength(0)
  })

  it('collapses same-package rows listed under different catalog GUIDs', () => {
    const a = candidate({
      updateId: 'guid-a',
      title: 'HP - Printer - 32.1.2001.8207',
      version: '',
      sizeText: '13.3 MB',
      products: 'Windows 10, version 1903 and later, Servicing Drivers'
    })
    const b = candidate({
      updateId: 'guid-b',
      title: 'HP - Printer - 32.1.2001.8207',
      version: '',
      sizeText: '13.3 MB',
      products: 'Windows 10 and later drivers'
    })
    const ranked = rankCandidates([a, b], ctx)
    expect(ranked).toHaveLength(1)
  })

  it('deduplicates candidates by update GUID across merged searches', () => {
    const a = candidate({ updateId: 'same', title: 'HP LaserJet Pro M404dn Driver' })
    const b = candidate({ updateId: 'same', title: 'HP LaserJet Pro M404dn Driver' })
    expect(rankCandidates([a, b], ctx)).toHaveLength(1)
  })
})
