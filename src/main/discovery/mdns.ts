import { Bonjour } from 'bonjour-service'
import { logInfo } from '../logger'

export interface MdnsPrinter {
  ip: string
  name: string
  /** Exact make/model from `ty` or `product` TXT record when present */
  model?: string
  pdl?: string
  serviceType: string
}

const SERVICE_TYPES = ['ipp', 'pdl-datastream', 'printer']

/**
 * Browse mDNS for _ipp._tcp, _pdl-datastream._tcp and _printer._tcp.
 * The `ty` and `product` TXT records give the exact make/model; `pdl`
 * lists the supported page description languages.
 */
export function discoverMdns(
  durationMs = 6000,
  onResult?: (p: MdnsPrinter) => void
): Promise<MdnsPrinter[]> {
  return new Promise((resolve) => {
    const bonjour = new Bonjour()
    const found = new Map<string, MdnsPrinter>()

    const browsers = SERVICE_TYPES.map((type) =>
      bonjour.find({ type, protocol: 'tcp' }, (service) => {
        const ip = (service.addresses ?? []).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a))
        if (!ip) return
        const txt = (service.txt ?? {}) as Record<string, string>
        const ty = txt.ty || txt.TY
        const product = (txt.product || txt.PRODUCT || '').replace(/^\(|\)$/g, '')
        const model = ty || product || undefined
        const pdl = txt.pdl || txt.PDL
        logInfo(`mDNS: found "${service.name}" (${type}) at ${ip}${model ? ` — ${model}` : ''}`)
        const existing = found.get(ip)
        if (!existing || (!existing.model && model)) {
          const entry: MdnsPrinter = { ip, name: service.name, model, pdl, serviceType: type }
          found.set(ip, entry)
          onResult?.(entry)
        }
      })
    )

    setTimeout(() => {
      for (const b of browsers) b.stop()
      bonjour.destroy()
      resolve([...found.values()])
    }, durationMs)
  })
}
