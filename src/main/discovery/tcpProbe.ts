import * as net from 'net'
import * as os from 'os'
import { logInfo } from '../logger'

export interface TcpProbeResult {
  ip: string
  openPorts: number[]
}

const PRINTER_PORTS = [9100, 631]

/** Enumerate all host addresses of the local /24s (IPv4, non-internal). */
export function getLocalSubnetHosts(): string[] {
  const hosts = new Set<string>()
  const ifaces = os.networkInterfaces()
  for (const list of Object.values(ifaces)) {
    for (const iface of list ?? []) {
      if (iface.family !== 'IPv4' || iface.internal) continue
      const parts = iface.address.split('.')
      if (parts.length !== 4) continue
      const prefix = parts.slice(0, 3).join('.')
      for (let i = 1; i <= 254; i++) {
        const ip = `${prefix}.${i}`
        if (ip !== iface.address) hosts.add(ip)
      }
    }
  }
  return [...hosts]
}

function probePort(ip: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    const finish = (open: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, ip)
  })
}

/**
 * TCP-probe ports 9100 (RAW) and 631 (IPP) across the given hosts to find
 * print hosts that don't answer SNMP or mDNS.
 */
export async function sweepTcp(
  hosts: string[],
  concurrency = 128,
  onResult?: (r: TcpProbeResult) => void
): Promise<TcpProbeResult[]> {
  const results: TcpProbeResult[] = []
  let index = 0
  async function worker(): Promise<void> {
    while (index < hosts.length) {
      const ip = hosts[index++]
      const open: number[] = []
      for (const port of PRINTER_PORTS) {
        if (await probePort(ip, port)) open.push(port)
      }
      if (open.length) {
        logInfo(`TCP: ${ip} has open print port(s): ${open.join(', ')}`)
        const entry: TcpProbeResult = { ip, openPorts: open }
        results.push(entry)
        onResult?.(entry)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, worker))
  return results
}
