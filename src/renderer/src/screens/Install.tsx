import { useEffect, useRef, useState } from 'react'
import type {
  DiscoveredPrinter,
  InstallResult,
  InstallStepId,
  InstallStepUpdate,
  RankedCandidate
} from '@shared/types'

const STEP_LABELS: { id: InstallStepId; label: string }[] = [
  { id: 'download', label: 'Download .cab from Microsoft' },
  { id: 'extract', label: 'Extract (expand.exe)' },
  { id: 'inf-verify', label: 'Verify device is listed in the INF' },
  { id: 'pnputil', label: 'Stage driver (pnputil)' },
  { id: 'add-driver', label: 'Add printer driver' },
  { id: 'add-port', label: 'Set up port' },
  { id: 'add-printer', label: 'Create printer' }
]

const STATUS_ICON = { running: '◌', ok: '✓', warn: '⚠', fail: '✕' } as const

export default function Install({
  printer,
  candidate,
  onBack,
  onDone
}: {
  printer: DiscoveredPrinter
  candidate: RankedCandidate
  onBack: () => void
  onDone: (r: InstallResult) => void
}): JSX.Element {
  const [steps, setSteps] = useState<Record<string, InstallStepUpdate>>({})
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<InstallResult | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    const unsub = window.driverpick.onInstallStep((u) => {
      setSteps((prev) => ({ ...prev, [u.step]: u }))
    })
    return unsub
  }, [])

  async function start(ignoreInfMismatch = false): Promise<void> {
    if (startedRef.current && !ignoreInfMismatch) return
    startedRef.current = true
    setRunning(true)
    setResult(null)
    if (ignoreInfMismatch) setSteps({})
    const r = await window.driverpick.install({ printer, candidate, ignoreInfMismatch })
    setResult(r)
    setRunning(false)
    onDone(r)
  }

  const infMismatch = result?.error === 'inf-mismatch'

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-1 flex items-center gap-3">
        {!running && (
          <button onClick={onBack} className="text-sm text-slate-400 hover:text-slate-200">
            ← back
          </button>
        )}
        <h2 className="text-xl font-semibold">Install</h2>
      </div>
      <p className="mb-4 text-sm text-slate-400">
        Installing <span className="text-slate-200">{candidate.title}</span> for{' '}
        <span className="text-slate-200">{printer.model}</span>. Every command streams to the
        log pane on the right.
      </p>

      {!startedRef.current && (
        <button
          onClick={() => void start()}
          className="mb-4 rounded bg-sky-600 px-5 py-2 text-sm font-medium hover:bg-sky-500"
        >
          Start installation
        </button>
      )}

      <ol className="space-y-2">
        {STEP_LABELS.map((s) => {
          const u = steps[s.id]
          return (
            <li
              key={s.id}
              className={`flex items-start gap-3 rounded border p-3 text-sm ${
                !u
                  ? 'border-slate-800 bg-slate-900/50 text-slate-500'
                  : u.status === 'ok'
                    ? 'border-emerald-900 bg-emerald-950/30'
                    : u.status === 'fail'
                      ? 'border-red-900 bg-red-950/30'
                      : u.status === 'warn'
                        ? 'border-amber-900 bg-amber-950/30'
                        : 'border-sky-900 bg-sky-950/30'
              }`}
            >
              <span className="mt-0.5 w-4 text-center">
                {u ? STATUS_ICON[u.status] : '·'}
              </span>
              <div>
                <div className="font-medium text-slate-200">{s.label}</div>
                {u && <div className="mt-0.5 text-xs text-slate-400">{u.message}</div>}
              </div>
            </li>
          )
        })}
      </ol>

      {infMismatch && (
        <div className="mt-4 rounded border border-amber-800 bg-amber-950/40 p-4 text-sm">
          <p className="font-medium text-amber-300">
            ⚠ This driver package does not list your device.
          </p>
          <p className="mt-1 text-amber-200/80">
            The INF [Models] sections were checked and your hardware ID / model string was not
            found. The recommended action is to go back and pick the next-ranked candidate.
          </p>
          {result?.infVerification?.allModels.length ? (
            <details className="mt-2 text-xs text-amber-200/60">
              <summary className="cursor-pointer">Models this package does support</summary>
              <ul className="mt-1 list-inside list-disc">
                {result.infVerification.allModels.slice(0, 15).map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </details>
          ) : null}
          <div className="mt-3 flex gap-2">
            <button
              onClick={onBack}
              className="rounded bg-amber-600 px-4 py-1.5 text-sm font-medium text-black hover:bg-amber-500"
            >
              Pick another driver (recommended)
            </button>
            <button
              onClick={() => void start(true)}
              className="rounded border border-amber-700 px-4 py-1.5 text-sm text-amber-300 hover:bg-amber-950"
            >
              Install anyway
            </button>
          </div>
        </div>
      )}

      {result && !result.success && !infMismatch && (
        <div className="mt-4 rounded border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
          <p className="font-medium">Installation failed</p>
          <p className="mt-1">{result.error}</p>
          <p className="mt-1 text-red-400/70">
            The full command output is in the log pane and the log file.
          </p>
        </div>
      )}
    </div>
  )
}
