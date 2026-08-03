import { describe, it, expect } from 'vitest'
import { parseInf, matchDeviceToInf, rankInfMatches } from '../src/main/install/infParser'

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

// Mirrors the real HP LaserJet M232-M237 package: a REST stub INF, the
// actual v4 print driver INF, and a scanner INF all list the device.
const STUB_INF = `
[Version]
Signature="$Windows NT$"
Class=Printer
Provider=%HP%
DriverVer=10/07/2020,1.0.0.0
[Manufacturer]
%HP%=HP,NTamd64
[HP.NTamd64]
"HP LaserJet MFP M232-M237(REST)" = REST_SECTION, HPRestStubDevice
[Strings]
HP="HP"
`
const DRIVER_INF = `
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
const SCANNER_INF = `
[Version]
Signature="$Windows NT$"
Class=Image
Provider=%HP%
DriverVer=10/07/2020,1.0.0.0
[Manufacturer]
%HP%=HP,NTamd64
[HP.NTamd64]
"HP LaserJet MFP M232-M237 Scan" = SCAN_SECTION, HPScanDevice
[Strings]
HP="HP"
`

describe('rankInfMatches', () => {
  const infs = [
    parseInf(STUB_INF, 'HPRestStub.INF'),
    parseInf(DRIVER_INF, 'hpypclms32_v4.inf'),
    parseInf(SCANNER_INF, 'HPeSCLScan.INF')
  ]

  it('parses the driver class', () => {
    expect(infs[0].driverClass).toBe('Printer')
    expect(infs[2].driverClass).toBe('Image')
  })

  it('ranks the real print driver INF above stub and scanner INFs', () => {
    const matches = rankInfMatches(infs, [], 'HP LaserJet MFP M232-M237')
    expect(matches.length).toBe(3)
    expect(matches[0].inf.path).toBe('hpypclms32_v4.inf')
    expect(matches[1].inf.path).toBe('HPRestStub.INF')
    expect(matches[2].inf.path).toBe('HPeSCLScan.INF')
  })

  it('keeps all matches as fallbacks so a failed Add-PrinterDriver can retry', () => {
    const matches = rankInfMatches(infs, [], 'HP LaserJet MFP M232-M237')
    expect(matches.map((m) => m.match.model.description)).toContain(
      'HP LaserJet MFP M232-M237(REST)'
    )
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
