import { useState } from 'react'
import type { UpdateCheckResult } from '@shared/types'

type Phase = 'idle' | 'checking' | 'result' | 'downloading' | 'downloaded'

/**
 * Manual "Check for updates": queries this app's GitHub Releases and, when a
 * newer version exists, downloads the latest exe to the Downloads folder.
 */
export default function UpdateButton(): JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<UpdateCheckResult | null>(null)
  const [savedPath, setSavedPath] = useState('')
  const [error, setError] = useState('')

  async function check(): Promise<void> {
    setPhase('checking')
    setError('')
    const r = await window.driverpick.checkForUpdates()
    setResult(r)
    if (r.error) setError(r.error)
    setPhase('result')
  }

  async function download(): Promise<void> {
    if (!result?.downloadUrl) {
      if (result?.releaseUrl) void window.driverpick.openExternal(result.releaseUrl)
      return
    }
    setPhase('downloading')
    const r = await window.driverpick.downloadUpdate(result.downloadUrl)
    if (r.success && r.path) {
      setSavedPath(r.path)
      setPhase('downloaded')
    } else {
      setError(r.error ?? 'Download failed')
      setPhase('result')
    }
  }

  return (
    <div className="relative flex items-center gap-2">
      <button
        onClick={() => void check()}
        disabled={phase === 'checking' || phase === 'downloading'}
        className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
      >
        {phase === 'checking' ? 'Checking…' : 'Check for updates'}
      </button>
      {phase === 'result' && result && (
        <span className="text-xs">
          {error ? (
            <span className="text-amber-400">{error}</span>
          ) : result.updateAvailable ? (
            <button onClick={() => void download()} className="text-sky-400 underline">
              {result.latestVersion} available — download
            </button>
          ) : (
            <span className="text-emerald-400">Up to date</span>
          )}
        </span>
      )}
      {phase === 'downloading' && <span className="text-xs text-slate-400">Downloading…</span>}
      {phase === 'downloaded' && (
        <span className="text-xs text-emerald-400" title={savedPath}>
          Saved to Downloads — run it to update
        </span>
      )}
    </div>
  )
}
