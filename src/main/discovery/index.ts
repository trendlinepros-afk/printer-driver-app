import { BrowserWindow } from 'electron'
import { reverse } from 'dns/promises'
import { discoverMdns } from './mdns'
import { sweepSnmp, querySnmpHost, type SnmpPrinter } from './snmp'
import { getLocalSubnetHosts, sweepTcp } from './tcpProbe'
import { discoverUsb } from './usb'
import { logInfo, logWarn } from '../logger'
import type { DiscoveredPrinter, DiscoveryProgress } from '@shared/types'

let discoveryRunning = false
// Replay caches: the Discover screen remounts when the user navigates back,
// so discovery:start during/after a run re-sends what is already known
// instead of leaving the UI empty or stuck on "Scanning…".
const lastProgress = new Map<DiscoveryProgress['phase'], DiscoveryProgress>()
let lastResults: DiscoveredPrinter[] = []

function send(win: BrowserWindow, printers: Map<string, DiscoveredPrinter>): void {
  lastResults = [...printers.values()]
  if (!win.isDestroyed()) win.webContents.send('discovery:result', lastResults)
}

function progress(win: BrowserWindow, p: DiscoveryProgress): void {
  lastProgress.set(p.phase, p)
  if (!win.isDestroyed()) win.webContents.send('discovery:progress', p)
}

function replayState(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  win.webContents.send('discovery:result', lastResults)
  for (const p of lastProgress.values()) win.webContents.send('discovery:progress', p)
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
    if (partial.hostname && !existing.hostname) existing.hostname = partial.hostname
    if (partial.serial && !existing.serial) existing.serial = partial.serial
    if (partial.detail) existing.detail.push(...partial.detail)
    return existing
  }
  const created: DiscoveredPrinter = {
    id: key,
    model: partial.model ?? 'Unknown printer',
    ip: partial.ip,
    hostname: partial.hostname,
    serial: partial.serial,
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
 * results to the renderer host-by-host as they arrive — a printer must never
 * sit on screen as "Unknown" while its name is already known to a slower
 * phase. A TCP hit immediately triggers a priority SNMP query for that host
 * instead of waiting for the sweep to reach it.
 */
export async function runDiscovery(win: BrowserWindow): Promise<void> {
  if (discoveryRunning) {
    // A scan is already in flight (screen remounted) — bring the fresh
    // subscriber up to date; the running scan keeps streaming to it.
    replayState(win)
    return
  }
  discoveryRunning = true
  lastProgress.clear()
  const printers = new Map<string, DiscoveredPrinter>()
  logInfo('Discovery started (mDNS + SNMP + TCP probe + USB in parallel)')

  const hosts = getLocalSubnetHosts()
  const snmpQueried = new Set<string>()

  const applySnmp = (s: SnmpPrinter): void => {
    // hrDeviceDescr is the real model; prtGeneralPrinterName is the
    // USER-ASSIGNED name ("GAME ROOM") — never use it as the model.
    const model = s.hrDeviceDescr || s.sysDescr || undefined
    upsert(printers, s.ip, {
      ip: s.ip,
      model,
      hostname: s.printerName,
      serial: s.serial,
      sources: ['snmp'],
      detail: [
        `SNMP sysDescr: ${s.sysDescr ?? '—'}`,
        `SNMP hrDeviceDescr (model): ${s.hrDeviceDescr ?? '—'}`,
        `SNMP printer name: ${s.printerName ?? '—'}`,
        `SNMP serial: ${s.serial ?? '—'}`
      ]
    })
    send(win, printers)
  }

  const prioritySnmp = (ip: string): void => {
    if (snmpQueried.has(ip)) return
    snmpQueried.add(ip)
    void querySnmpHost(ip).then((s) => {
      if (s) applySnmp(s)
    })
  }

  const resolveHostname = (ip: string): void => {
    void reverse(ip)
      .then((names) => {
        if (names[0]) {
          upsert(printers, ip, { ip, hostname: names[0], detail: [`Reverse DNS: ${names[0]}`] })
          send(win, printers)
        }
      })
      .catch(() => {
        /* no PTR record — normal */
      })
  }

  const mdnsTask = discoverMdns(6000, (m) => {
    upsert(printers, m.ip, {
      ip: m.ip,
      model: m.model,
      hostname: m.name,
      sources: ['mdns'],
      pdl: m.pdl,
      detail: [`mDNS (${m.serviceType}): ${m.name}${m.model ? ` — ty/product: ${m.model}` : ''}`]
    })
    send(win, printers)
    // mDNS printers answer SNMP too — grab model/serial details right away.
    prioritySnmp(m.ip)
  })
    .then((list) => {
      progress(win, { phase: 'mdns', message: `mDNS done — ${list.length} found`, done: true })
    })
    .catch((err) => {
      logWarn(`mDNS discovery failed: ${err instanceof Error ? err.message : err}`)
      progress(win, { phase: 'mdns', message: 'mDNS unavailable', done: true })
    })

  const snmpTask = sweepSnmp(hosts, 48, applySnmp)
    .then((list) => {
      progress(win, { phase: 'snmp', message: `SNMP sweep done — ${list.length} answered`, done: true })
    })
    .catch((err) => {
      logWarn(`SNMP sweep failed: ${err instanceof Error ? err.message : err}`)
      progress(win, { phase: 'snmp', message: 'SNMP unavailable', done: true })
    })

  const tcpTask = sweepTcp(hosts, 128, (t) => {
    upsert(printers, t.ip, {
      ip: t.ip,
      sources: ['tcp'],
      detail: [`TCP: open print port(s) ${t.openPorts.join(', ')}`]
    })
    send(win, printers)
    // Don't wait for the SNMP sweep to reach this host — it has a print
    // port open, so query it now to fill in model/name/serial.
    prioritySnmp(t.ip)
    resolveHostname(t.ip)
  })
    .then((list) => {
      progress(win, { phase: 'tcp', message: `TCP probe done — ${list.length} hosts`, done: true })
    })
    .catch((err) => {
      logWarn(`TCP probe failed: ${err instanceof Error ? err.message : err}`)
      progress(win, { phase: 'tcp', message: 'TCP probe unavailable', done: true })
    })

  const usbTask = discoverUsb()
    .then((list) => {
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
    .catch((err) => {
      logWarn(`USB discovery failed: ${err instanceof Error ? err.message : err}`)
      progress(win, { phase: 'usb', message: 'USB scan unavailable', done: true })
    })

  await Promise.allSettled([mdnsTask, snmpTask, tcpTask, usbTask])
  send(win, printers)
  logInfo(`Discovery finished — ${printers.size} device(s) total`)
  discoveryRunning = false
}
