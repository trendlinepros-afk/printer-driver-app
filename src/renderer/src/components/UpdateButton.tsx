import { useState } from 'react'
import type { UpdateCheckResult } from '@shared/types'

type Phase = 'idle' | 'checking' | 'result' | 'installing'

/**
 * Manual "Check for updates": queries this app's GitHub Releases and, when a
 * newer version exists, one click downloads it, installs it silently, and
 * relaunches the app.
 */
export default function UpdateButton(): JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<UpdateCheckResult | null>(null)
  const [error, setError] = useState('')

  async function check(): Promise<void> {
    setPhase('checking')
    setError('')
    const r = await window.driverpick.checkForUpdates()
    setResult(r)
    if (r.error) setError(r.error)
    setPhase('result')
  }

  async function installNow(): Promise<void> {
    if (!result?.downloadUrl || !result.latestVersion) {
      if (result?.releaseUrl) void window.driverpick.openExternal(result.releaseUrl)
      return
    }
    setPhase('installing')
    const r = await window.driverpick.installUpdate(result.downloadUrl, result.latestVersion)
    if (!r.success) {
      setError(r.error ?? 'Update failed')
      setPhase('result')
    }
    // On success the main process quits this instance and relaunches.
  }

  return (
    <div className="relative flex items-center gap-2">
      <button
        onClick={() => void check()}
        disabled={phase === 'checking' || phase === 'installing'}
        className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
      >
        {phase === 'checking' ? 'Checking…' : 'Check for updates'}
      </button>
      {phase === 'result' && result && (
        <span className="text-xs">
          {error ? (
            <span className="inline-block max-w-[220px] truncate align-middle text-amber-400" title={error}>
              {error}
            </span>
          ) : result.updateAvailable ? (
            <button
              onClick={() => void installNow()}
              className="rounded bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500"
            >
              {result.downloadUrl
                ? `Update to ${result.latestVersion} & restart`
                : `${result.latestVersion} available — view release`}
            </button>
          ) : (
            <span className="text-emerald-400">Up to date</span>
          )}
        </span>
      )}
      {phase === 'installing' && (
        <span className="text-xs text-sky-400">Downloading &amp; installing — the app will restart…</span>
      )}
    </div>
  )
}
