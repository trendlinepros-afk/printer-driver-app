import { useEffect, useRef, useState } from 'react'
import type { DiscoveredPrinter, DiscoveryProgress } from '@shared/types'

const SOURCE_LABELS: Record<string, string> = {
  mdns: 'mDNS',
  snmp: 'SNMP',
  tcp: 'TCP probe',
  usb: 'USB',
  manual: 'manual'
}

/** Minimum time the "Scan in progress" screen stays up so early, partial
 *  results (e.g. a TCP hit with no name yet) aren't shown as "Unknown". */
const REVEAL_DELAY_MS = 5000

export default function Discover({
  onSelect
}: {
  onSelect: (p: DiscoveredPrinter) => void
}): JSX.Element {
  const [printers, setPrinters] = useState<DiscoveredPrinter[]>([])
  const [progress, setProgress] = useState<DiscoveryProgress[]>([])
  const [scanning, setScanning] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [manual, setManual] = useState('')
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function startScan(): void {
    setScanning(true)
    setRevealed(false)
    setProgress([])
    if (revealTimer.current) clearTimeout(revealTimer.current)
    revealTimer.current = setTimeout(() => setRevealed(true), REVEAL_DELAY_MS)
    void window.driverpick.startDiscovery()
  }

  useEffect(() => {
    const unsubResult = window.driverpick.onDiscoveryResult(setPrinters)
    const unsubProgress = window.driverpick.onDiscoveryProgress((p) => {
      setProgress((prev) => [...prev.filter((x) => x.phase !== p.phase), p])
    })
    startScan() // auto-scan on launch
    return () => {
      unsubResult()
      unsubProgress()
      if (revealTimer.current) clearTimeout(revealTimer.current)
    }
  }, [])

  useEffect(() => {
    if (progress.filter((p) => p.done).length >= 4) {
      setScanning(false)
      setRevealed(true)
    }
  }, [progress])

  function submitManual(): void {
    const q = manual.trim()
    if (!q) return
    onSelect({
      id: `manual:${q}`,
      model: q,
      sources: ['manual'],
      hardwareIds: [],
      detail: ['Entered manually']
    })
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">Discover printers</h2>
        <button
          onClick={startScan}
          disabled={scanning}
          className="rounded bg-sky-600 px-4 py-1.5 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
        >
          {scanning ? 'Scanning…' : 'Rescan'}
        </button>
      </div>

      <div className="mb-4 flex gap-3 text-xs text-slate-400">
        {(['mdns', 'snmp', 'tcp', 'usb'] as const).map((phase) => {
          const p = progress.find((x) => x.phase === phase)
          return (
            <span
              key={phase}
              className={`rounded-full border px-2 py-0.5 ${
                p?.done ? 'border-emerald-700 text-emerald-400' : 'border-slate-700'
              }`}
            >
              {SOURCE_LABELS[phase]}
              {p?.done ? ' ✓' : scanning ? ' …' : ''}
            </span>
          )
        })}
      </div>

      {!revealed ? (
        <div className="mb-4 flex flex-col items-center gap-3 rounded border border-slate-800 bg-slate-900 p-10">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-sky-500" />
          <p className="text-sm font-medium text-slate-200">Scan in progress…</p>
          <p className="text-xs text-slate-500">
            Probing mDNS, SNMP, TCP 9100/631 and USB — collecting names, models and serial
            numbers before showing results.
          </p>
        </div>
      ) : (
        <>
          {printers.length === 0 && !scanning && (
            <p className="mb-4 rounded border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
              Nothing found. No mDNS/SNMP response is normal on some networks — use the manual
              search below, or check that the printer is powered on and reachable.
            </p>
          )}

          <ul className="space-y-2">
            {printers.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => onSelect(p)}
                  className="w-full rounded border border-slate-800 bg-slate-900 p-4 text-left hover:border-sky-600"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{p.model}</span>
                    <span className="flex shrink-0 gap-1.5">
                      {p.sources.map((s) => (
                        <span key={s} className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">
                          {SOURCE_LABELS[s]}
                        </span>
                      ))}
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-[110px_1fr] gap-y-1 text-xs">
                    {p.ip && (
                      <>
                        <dt className="text-slate-500">IP address</dt>
                        <dd className="text-slate-300">{p.ip}</dd>
                      </>
                    )}
                    {!p.ip && (
                      <>
                        <dt className="text-slate-500">Connection</dt>
                        <dd className="text-slate-300">USB</dd>
                      </>
                    )}
                    {p.hostname && (
                      <>
                        <dt className="text-slate-500">Name</dt>
                        <dd className="text-slate-300">{p.hostname}</dd>
                      </>
                    )}
                    {p.serial && (
                      <>
                        <dt className="text-slate-500">Serial number</dt>
                        <dd className="text-slate-300">{p.serial}</dd>
                      </>
                    )}
                    {p.pdl && (
                      <>
                        <dt className="text-slate-500">Languages</dt>
                        <dd className="text-slate-300">{p.pdl}</dd>
                      </>
                    )}
                    {p.hardwareIds.length > 0 && (
                      <>
                        <dt className="text-slate-500">Hardware ID</dt>
                        <dd className="break-all text-emerald-500">{p.hardwareIds[0]}</dd>
                      </>
                    )}
                  </dl>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-6 rounded border border-slate-800 bg-slate-900 p-4">
        <h3 className="mb-2 text-sm font-medium text-slate-300">
          Can&apos;t find it? Search by make &amp; model
        </h3>
        <div className="flex gap-2">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitManual()}
            placeholder="e.g. HP LaserJet Pro M404dn"
            className="flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm outline-none focus:border-sky-600"
          />
          <button
            onClick={submitManual}
            className="rounded bg-slate-700 px-4 py-1.5 text-sm hover:bg-slate-600"
          >
            Find drivers
          </button>
        </div>
      </div>
    </div>
  )
}
