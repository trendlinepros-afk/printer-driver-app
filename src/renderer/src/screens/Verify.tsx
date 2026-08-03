import { useState } from 'react'
import type { DiscoveredPrinter, InstallResult, TestPageResult } from '@shared/types'

export default function Verify({
  printer,
  result,
  onStartOver
}: {
  printer: DiscoveredPrinter
  result: InstallResult
  onStartOver: () => void
}): JSX.Element {
  const [testResult, setTestResult] = useState<TestPageResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [removed, setRemoved] = useState<{ success: boolean; error?: string } | null>(null)

  async function sendTest(): Promise<void> {
    if (!result.printerName) return
    setTesting(true)
    setTestResult(null)
    const r = await window.driverpick.sendTestPage(result.printerName)
    setTestResult(r)
    setTesting(false)
  }

  async function removeAll(): Promise<void> {
    setRemoving(true)
    const r = await window.driverpick.uninstall({
      printerName: result.printerName,
      driverName: result.driverName,
      publishedInfName: result.publishedInfName,
      portName: result.portName,
      portCreatedByUs: !!printer.ip
    })
    setRemoved(r)
    setRemoving(false)
  }

  const ok = result.success && !removed
  return (
    <div className="mx-auto max-w-3xl">
      <h2 className="mb-4 text-xl font-semibold">Verify</h2>

      <div
        className={`mb-5 rounded-lg border p-6 text-center ${
          removed?.success
            ? 'border-slate-700 bg-slate-900'
            : ok
              ? 'border-emerald-700 bg-emerald-950/40'
              : 'border-red-800 bg-red-950/40'
        }`}
      >
        <p className="text-3xl font-bold">
          {removed?.success ? 'Rolled back' : ok ? '✓ Installed' : '✕ Failed'}
        </p>
        {removed?.success && (
          <p className="mt-2 text-sm text-slate-400">Everything DriverPick added was removed.</p>
        )}
        {removed && !removed.success && (
          <p className="mt-2 text-sm text-amber-300">Partial rollback: {removed.error}</p>
        )}
      </div>

      {!removed && (
        <dl className="mb-5 grid grid-cols-[160px_1fr] gap-y-2 rounded border border-slate-800 bg-slate-900 p-4 text-sm">
          <dt className="text-slate-400">Printer</dt>
          <dd>{result.printerName}</dd>
          <dt className="text-slate-400">Driver</dt>
          <dd>
            {result.driverName}
            {result.driverVersion && <span className="text-slate-400"> · v{result.driverVersion}</span>}
          </dd>
          <dt className="text-slate-400">Port</dt>
          <dd>{result.portName}</dd>
          <dt className="text-slate-400">Staged package</dt>
          <dd>{result.publishedInfName ?? '—'}</dd>
          <dt className="text-slate-400">INF verification</dt>
          <dd>
            {result.infVerification?.verified ? (
              <span className="text-emerald-400">
                verified via {result.infVerification.matchedBy} ({result.infVerification.matchedValue})
              </span>
            ) : (
              <span className="text-amber-400">not verified — installed anyway on request</span>
            )}
          </dd>
        </dl>
      )}

      <div className="flex flex-wrap gap-3">
        {!removed && (
          <button
            onClick={() => void sendTest()}
            disabled={testing}
            className="rounded bg-sky-600 px-5 py-2 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
          >
            {testing ? 'Sending…' : 'Send test page'}
          </button>
        )}
        {!removed && (
          <button
            onClick={() => void removeAll()}
            disabled={removing}
            className="rounded border border-red-800 px-5 py-2 text-sm text-red-400 hover:bg-red-950 disabled:opacity-50"
          >
            {removing ? 'Removing…' : 'Remove what I just did'}
          </button>
        )}
        <button
          onClick={onStartOver}
          className="rounded border border-slate-700 px-5 py-2 text-sm text-slate-300 hover:bg-slate-800"
        >
          Start over
        </button>
      </div>

      {testResult && (
        <p
          className={`mt-4 rounded border p-3 text-sm ${
            testResult.success
              ? 'border-emerald-800 bg-emerald-950/30 text-emerald-300'
              : 'border-red-800 bg-red-950/30 text-red-300'
          }`}
        >
          {testResult.message}
        </p>
      )}
    </div>
  )
}
