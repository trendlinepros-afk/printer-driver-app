import { BrowserWindow } from 'electron'
import { discoverMdns } from './mdns'
import { sweepSnmp } from './snmp'
import { getLocalSubnetHosts, sweepTcp } from './tcpProbe'
import { discoverUsb } from './usb'
import { logInfo } from '../logger'
import type { DiscoveredPrinter, DiscoveryProgress } from '@shared/types'

let discoveryRunning = false

function send(win: BrowserWindow, printers: Map<string, DiscoveredPrinter>): void {
  win.webContents.send('discovery:result', [...printers.values()])
}

function progress(win: BrowserWindow, p: DiscoveryProgress): void {
  win.webContents.send('discovery:progress', p)
}

function upsert(
  printers: Map<string, DiscoveredPrinter>,
  key: string,
  partial: Partial<DiscoveredPrinter> & { model?: string }
): DiscoveredPrinter {
  const existing = printers.get(key)
  if (existing) {
    if (partial.model && (!existing.model || existing.model.startsWith('Unknown'))) {
      existing.model = partial.model
    }
    if (partial.sources) {
      for (const s of partial.sources) {
        if (!existing.sources.includes(s)) existing.sources.push(s)
      }
    }
    if (partial.hardwareIds?.length) existing.hardwareIds = partial.hardwareIds
    if (partial.pdl && !existing.pdl) existing.pdl = partial.pdl
    if (partial.detail) existing.detail.push(...partial.detail)
    return existing
  }
  const created: DiscoveredPrinter = {
    id: key,
    model: partial.model ?? 'Unknown printer',
    ip: partial.ip,
    sources: partial.sources ?? [],
    hardwareIds: partial.hardwareIds ?? [],
    pdl: partial.pdl,
    detail: partial.detail ?? [],
    usbPortHint: partial.usbPortHint
  }
  printers.set(key, created)
  return created
}

/**
 * Run all discovery mechanisms in parallel, streaming merged, deduplicated
 * results (by IP for network printers, by device ID for USB) to the renderer
 * as they arrive.
 */
export async function runDiscovery(win: BrowserWindow): Promise<void> {
  if (discoveryRunning) return
  discoveryRunning = true
  const printers = new Map<string, DiscoveredPrinter>()
  logInfo('Discovery started (mDNS + SNMP + TCP probe + USB in parallel)')

  const hosts = getLocalSubnetHosts()

  const mdnsTask = discoverMdns().then((list) => {
    for (const m of list) {
      upsert(printers, m.ip, {
        ip: m.ip,
        model: m.model ?? m.name,
        sources: ['mdns'],
        pdl: m.pdl,
        detail: [`mDNS (${m.serviceType}): ${m.name}${m.model ? ` — ty/product: ${m.model}` : ''}`]
      })
    }
    send(win, printers)
    progress(win, { phase: 'mdns', message: `mDNS done — ${list.length} found`, done: true })
  })

  const snmpTask = sweepSnmp(hosts).then((list) => {
    for (const s of list) {
      const model = s.printerName || s.hrDeviceDescr || s.sysDescr || 'Unknown printer'
      upsert(printers, s.ip, {
        ip: s.ip,
        model,
        sources: ['snmp'],
        detail: [
          `SNMP sysDescr: ${s.sysDescr ?? '—'}`,
          `SNMP hrDeviceDescr: ${s.hrDeviceDescr ?? '—'}`,
          `SNMP prtGeneral name: ${s.printerName ?? '—'}`
        ]
      })
    }
    send(win, printers)
    progress(win, { phase: 'snmp', message: `SNMP sweep done — ${list.length} answered`, done: true })
  })

  const tcpTask = sweepTcp(hosts).then((list) => {
    for (const t of list) {
      upsert(printers, t.ip, {
        ip: t.ip,
        sources: ['tcp'],
        detail: [`TCP: open print port(s) ${t.openPorts.join(', ')}`]
      })
    }
    send(win, printers)
    progress(win, { phase: 'tcp', message: `TCP probe done — ${list.length} hosts`, done: true })
  })

  const usbTask = discoverUsb().then((list) => {
    for (const u of list) {
      upsert(printers, u.deviceId, {
        model: u.name,
        sources: ['usb'],
        hardwareIds: u.hardwareIds,
        usbPortHint: u.usbPortHint,
        detail: [`USB DeviceID: ${u.deviceId}`, `HardwareIDs: ${u.hardwareIds.join(' | ') || '—'}`]
      })
    }
    send(win, printers)
    progress(win, { phase: 'usb', message: `USB scan done — ${list.length} found`, done: true })
  })

  await Promise.allSettled([mdnsTask, snmpTask, tcpTask, usbTask])
  send(win, printers)
  logInfo(`Discovery finished — ${printers.size} device(s) total`)
  discoveryRunning = false
}
