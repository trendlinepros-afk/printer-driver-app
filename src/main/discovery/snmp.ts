import * as snmp from 'net-snmp'
import { logInfo } from '../logger'

export interface SnmpPrinter {
  ip: string
  sysDescr?: string
  hrDeviceDescr?: string
  /** prtGeneralPrinterName — usually the cleanest model string */
  printerName?: string
}

const OID_SYS_DESCR = '1.3.6.1.2.1.1.1.0'
const OID_HR_DEVICE_DESCR = '1.3.6.1.2.1.25.3.2.1.3.1'
const OID_PRT_NAME = '1.3.6.1.2.1.43.5.1.1.16.1'

/**
 * Query a single host with SNMP v2c (falling back to v1), community "public".
 * Returns null when the host doesn't answer — which is normal, not an error.
 */
export function querySnmpHost(ip: string, timeoutMs = 1200): Promise<SnmpPrinter | null> {
  return new Promise((resolve) => {
    const session = snmp.createSession(ip, 'public', {
      version: snmp.Version2c,
      timeout: timeoutMs,
      retries: 0
    })
    const oids = [OID_SYS_DESCR, OID_HR_DEVICE_DESCR, OID_PRT_NAME]
    let settled = false
    const finish = (result: SnmpPrinter | null): void => {
      if (settled) return
      settled = true
      try {
        session.close()
      } catch {
        /* already closed */
      }
      resolve(result)
    }
    session.on('error', () => finish(null))
    session.get(oids, (error: Error | null, varbinds: snmp.VarBind[]) => {
      if (error) {
        // Some devices reject multi-OID gets or only speak v1 — retry v1 with sysDescr only.
        retryV1(ip, timeoutMs).then(finish)
        return
      }
      const out: SnmpPrinter = { ip }
      for (const vb of varbinds ?? []) {
        if (snmp.isVarbindError(vb)) continue
        const value = vb.value?.toString().trim()
        if (!value) continue
        if (vb.oid === OID_SYS_DESCR) out.sysDescr = value
        else if (vb.oid === OID_HR_DEVICE_DESCR) out.hrDeviceDescr = value
        else if (vb.oid === OID_PRT_NAME) out.printerName = value
      }
      if (!out.sysDescr && !out.hrDeviceDescr && !out.printerName) return finish(null)
      finish(out)
    })
  })
}

function retryV1(ip: string, timeoutMs: number): Promise<SnmpPrinter | null> {
  return new Promise((resolve) => {
    const session = snmp.createSession(ip, 'public', {
      version: snmp.Version1,
      timeout: timeoutMs,
      retries: 0
    })
    let settled = false
    const finish = (r: SnmpPrinter | null): void => {
      if (settled) return
      settled = true
      try {
        session.close()
      } catch {
        /* already closed */
      }
      resolve(r)
    }
    session.on('error', () => finish(null))
    session.get([OID_SYS_DESCR], (error: Error | null, varbinds: snmp.VarBind[]) => {
      if (error || !varbinds?.length || snmp.isVarbindError(varbinds[0])) return finish(null)
      const sysDescr = varbinds[0].value?.toString().trim()
      finish(sysDescr ? { ip, sysDescr } : null)
    })
  })
}

/**
 * Sweep a list of hosts with bounded concurrency. Only hosts that answered
 * the TCP probe (or are otherwise interesting) should be passed in — but a
 * full /24 sweep is also fine given the concurrency cap.
 */
export async function sweepSnmp(hosts: string[], concurrency = 48): Promise<SnmpPrinter[]> {
  const results: SnmpPrinter[] = []
  let index = 0
  async function worker(): Promise<void> {
    while (index < hosts.length) {
      const ip = hosts[index++]
      const r = await querySnmpHost(ip)
      if (r) {
        logInfo(`SNMP: ${ip} answered — ${r.printerName || r.hrDeviceDescr || r.sysDescr}`)
        results.push(r)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, worker))
  return results
}
