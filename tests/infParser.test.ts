import { describe, it, expect } from 'vitest'
import { parseInf, matchDeviceToInf } from '../src/main/install/infParser'

const SAMPLE_INF = `
; HP LaserJet Pro sample INF
[Version]
Signature="$Windows NT$"
Class=Printer
Provider=%HP%
DriverVer=06/17/2021,61.300.1.24923

[Manufacturer]
%HP%=HP,NTamd64,NTarm64

[HP.NTamd64]
"HP LaserJet Pro M404-M405 PCL-6" = INSTALL_SECTION, USBPRINT\\HewlettPackardHP_LaserB57D, HewlettPackardHP_LaserB57D
"HP LaserJet Pro M304a PCL-6" = INSTALL_SECTION_2, USBPRINT\\HewlettPackardHP_LaserAAAA

[HP.NTarm64]
"HP LaserJet Pro M404-M405 PCL-6" = INSTALL_SECTION, USBPRINT\\HewlettPackardHP_LaserB57D

[Strings]
HP="HP"
`

describe('parseInf', () => {
  const inf = parseInf(SAMPLE_INF, 'sample.inf')

  it('reads DriverVer and provider with %string% substitution', () => {
    expect(inf.driverVersion).toBe('61.300.1.24923')
    expect(inf.provider).toBe('HP')
  })

  it('collects model entries from decorated sections', () => {
    const descriptions = inf.models.map((m) => m.description)
    expect(descriptions).toContain('HP LaserJet Pro M404-M405 PCL-6')
    expect(descriptions).toContain('HP LaserJet Pro M304a PCL-6')
  })

  it('captures hardware IDs per model', () => {
    const m404 = inf.models.find((m) => m.description.includes('M404'))
    expect(m404?.hardwareIds).toContain('USBPRINT\\HewlettPackardHP_LaserB57D')
  })

  it('ignores comment lines', () => {
    expect(inf.models.some((m) => m.description.includes('sample INF'))).toBe(false)
  })
})

describe('matchDeviceToInf', () => {
  const inf = parseInf(SAMPLE_INF, 'sample.inf')

  it('matches by exact hardware ID (case-insensitive)', () => {
    const m = matchDeviceToInf(inf, ['usbprint\\hewlettpackardhp_laserb57d'], 'whatever')
    expect(m?.matchedBy).toBe('hardware-id')
    expect(m?.model.description).toContain('M404')
  })

  it('falls back to model-string matching for network printers', () => {
    const m = matchDeviceToInf(inf, [], 'HP LaserJet Pro M404dn')
    expect(m?.matchedBy).toBe('model-string')
    expect(m?.matchedValue).toContain('M404')
  })

  it('returns null when the device is not listed', () => {
    expect(matchDeviceToInf(inf, ['USBPRINT\\CanonPIXMA1234'], 'Canon PIXMA TS8350')).toBeNull()
  })
})
