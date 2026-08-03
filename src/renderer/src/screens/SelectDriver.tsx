import { useEffect, useState } from 'react'
import type { CatalogSearchResult, DiscoveredPrinter, RankedCandidate } from '@shared/types'

export default function SelectDriver({
  printer,
  onBack,
  onConfirm
}: {
  printer: DiscoveredPrinter
  onBack: () => void
  onConfirm: (c: RankedCandidate) => void
}): JSX.Element {
  const [result, setResult] = useState<CatalogSearchResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [manualQuery, setManualQuery] = useState('')

  async function search(query?: string): Promise<void> {
    setLoading(true)
    setResult(null)
    const r = query
      ? await window.driverpick.searchCatalogManual(query)
      : await window.driverpick.searchCatalog(printer)
    setResult(r)
    // Preselect the top pick — the user confirms or overrides, never silent.
    const top = r.candidates.find((c) => !c.isWindowsDefault) ?? r.candidates[0]
    setSelectedId(top?.updateId ?? null)
    setLoading(false)
  }

  useEffect(() => {
    void search()
  }, [printer.id])

  const selected = result?.candidates.find((c) => c.updateId === selectedId) ?? null

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-1 flex items-center gap-3">
        <button onClick={onBack} className="text-sm text-slate-400 hover:text-slate-200">
          ← back
        </button>
        <h2 className="text-xl font-semibold">Select a driver</h2>
      </div>
      <p className="mb-4 text-sm text-slate-400">
        For <span className="text-slate-200">{printer.model}</span>
        {printer.ip && <span> at {printer.ip}</span>}
        {printer.hardwareIds.length > 0 && (
          <span className="ml-2 text-emerald-500">— searching by exact hardware ID</span>
        )}
      </p>

      {loading && (
        <p className="rounded border border-slate-800 bg-slate-900 p-6 text-center text-sm text-slate-400">
          Searching the Microsoft Update Catalog… (one polite request at a time)
        </p>
      )}

      {result?.error && (
        <div className="mb-4 rounded border border-amber-800 bg-amber-950/40 p-4 text-sm text-amber-300">
          <p>{result.error}</p>
          <button
            onClick={() => void window.driverpick.openExternal(result.catalogUrl)}
            className="mt-2 text-sky-400 underline"
          >
            Open this search in the Microsoft Update Catalog
          </button>
        </div>
      )}

      {!loading && result && (
        <>
          <ul className="space-y-2">
            {result.candidates.map((c, i) => (
              <li key={c.updateId}>
                <label
                  className={`block cursor-pointer rounded border p-4 ${
                    selectedId === c.updateId
                      ? 'border-sky-500 bg-sky-950/30'
                      : 'border-slate-800 bg-slate-900 hover:border-slate-600'
                  } ${c.isWindowsDefault ? 'opacity-80' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="candidate"
                      checked={selectedId === c.updateId}
                      onChange={() => setSelectedId(c.updateId)}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium">{c.title}</span>
                        <span className="shrink-0 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                          score {c.score}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                        <span>v{c.version || '—'}</span>
                        <span>{c.lastUpdated}</span>
                        <span>{c.sizeText}</span>
                        {c.pdl && <span>{c.pdl}</span>}
                        <span className="text-slate-500">{c.products}</span>
                      </div>
                      <p
                        className={`mt-1 text-xs ${
                          c.isWindowsDefault
                            ? 'text-amber-400'
                            : i === 0
                              ? 'text-emerald-400'
                              : 'text-slate-400'
                        }`}
                      >
                        {c.reasons.join(' · ')}
                      </p>
                    </div>
                  </div>
                </label>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-center justify-between">
            <div className="flex gap-2">
              <input
                value={manualQuery}
                onChange={(e) => setManualQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && manualQuery.trim() && void search(manualQuery.trim())}
                placeholder="Refine search…"
                className="rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm outline-none focus:border-sky-600"
              />
              <button
                onClick={() => manualQuery.trim() && void search(manualQuery.trim())}
                className="rounded bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600"
              >
                Search again
              </button>
            </div>
            <button
              onClick={() => selected && onConfirm(selected)}
              disabled={!selected}
              className="rounded bg-sky-600 px-5 py-2 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
            >
              Install selected driver →
            </button>
          </div>
        </>
      )}
    </div>
  )
}
