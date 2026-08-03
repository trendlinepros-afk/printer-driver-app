import { useEffect, useRef, useState } from 'react'
import type { LogEntry } from '@shared/types'

const COLORS: Record<LogEntry['level'], string> = {
  info: 'text-slate-300',
  cmd: 'text-sky-400',
  out: 'text-slate-400',
  err: 'text-red-400',
  warn: 'text-amber-400',
  ok: 'text-emerald-400'
}

/**
 * Always-visible log pane: every command and its full output streams here.
 * Verbosity is a feature — this is a tool for IT people.
 */
export default function LogPane(): JSX.Element {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [logPath, setLogPath] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unsub = window.driverpick.onLog((e) => {
      setEntries((prev) => (prev.length > 5000 ? [...prev.slice(-4000), e] : [...prev, e]))
    })
    void window.driverpick.getLogFilePath().then(setLogPath)
    return unsub
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior })
  }, [entries])

  return (
    <aside className="flex w-[420px] shrink-0 flex-col border-l border-slate-800 bg-black/60">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Activity log
        </span>
        <span className="max-w-[260px] truncate text-[10px] text-slate-600" title={logPath}>
          {logPath}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 font-mono text-[11px] leading-4">
        {entries.length === 0 && (
          <p className="p-2 text-slate-600">Commands and their output will appear here.</p>
        )}
        {entries.map((e, i) => (
          <div key={i} className={`whitespace-pre-wrap break-all ${COLORS[e.level]}`}>
            <span className="text-slate-600">{e.ts.slice(11, 19)} </span>
            {e.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </aside>
  )
}
