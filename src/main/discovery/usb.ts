import { runPowerShellJson } from '../exec'
import { logInfo } from '../logger'

export interface UsbPrinter {
  name: string
  deviceId: string
  /** Full HardwareIDs array — the most important data we collect */
  hardwareIds: string[]
  usbPortHint?: string
}

interface RawPnpEntity {
  Name: string | null
  DeviceID: string | null
  HardwareID: string[] | string | null
  PNPClass: string | null
}

/**
 * Enumerate USB-attached printers via Win32_PnPEntity, capturing the full
 * HardwareIDs array. USBPRINT\ instances carry the exact vendor hardware ID
 * that the ranking stage matches against catalog INFs.
 */
export async function discoverUsb(): Promise<UsbPrinter[]> {
  const script = `
    Get-CimInstance Win32_PnPEntity |
      Where-Object { $_.PNPClass -eq 'Printer' -or ($_.DeviceID -like 'USBPRINT\\*') } |
      Select-Object Name, DeviceID, HardwareID, PNPClass |
      ConvertTo-Json -Depth 3
  `.trim()
  const raw = await runPowerShellJson<RawPnpEntity | RawPnpEntity[]>(script)
  if (!raw) return []
  const entities = Array.isArray(raw) ? raw : [raw]
  const printers: UsbPrinter[] = []
  for (const e of entities) {
    if (!e?.DeviceID) continue
    const hardwareIds = Array.isArray(e.HardwareID)
      ? e.HardwareID
      : e.HardwareID
        ? [e.HardwareID]
        : []
    const p: UsbPrinter = {
      name: e.Name ?? e.DeviceID,
      deviceId: e.DeviceID,
      hardwareIds
    }
    logInfo(`USB: ${p.name} [${hardwareIds.join(', ') || 'no hardware IDs'}]`)
    printers.push(p)
  }
  // Attach USB00x port hints so the installer can reuse the existing port.
  const ports = await runPowerShellJson<{ Name: string }[] | { Name: string }>(
    `Get-PrinterPort | Where-Object { $_.Name -like 'USB*' } | Select-Object Name | ConvertTo-Json`
  )
  if (ports) {
    const list = Array.isArray(ports) ? ports : [ports]
    if (list.length === 1 && printers.length === 1) {
      printers[0].usbPortHint = list[0].Name
    }
  }
  return printers
}
