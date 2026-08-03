import { useEffect, useState } from 'react'
import type {
  DiscoveredPrinter,
  HostInfo,
  InstallResult,
  RankedCandidate
} from '@shared/types'
import Discover from './screens/Discover'
import SelectDriver from './screens/SelectDriver'
import Install from './screens/Install'
import Verify from './screens/Verify'
import LogPane from './components/LogPane'
import UpdateButton from './components/UpdateButton'

export type Screen = 'discover' | 'select' | 'install' | 'verify'

const STEPS: { id: Screen; label: string }[] = [
  { id: 'discover', label: '1 · Discover' },
  { id: 'select', label: '2 · Select driver' },
  { id: 'install', label: '3 · Install' },
  { id: 'verify', label: '4 · Verify' }
]

export default function App(): JSX.Element {
  const [screen, setScreen] = useState<Screen>('discover')
  const [host, setHost] = useState<HostInfo | null>(null)
  const [printer, setPrinter] = useState<DiscoveredPrinter | null>(null)
  const [candidate, setCandidate] = useState<RankedCandidate | null>(null)
  const [installResult, setInstallResult] = useState<InstallResult | null>(null)

  useEffect(() => {
    void window.driverpick.getHostInfo().then(setHost)
  }, [])

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-slate-800 bg-slate-900 px-5 py-3">
        <h1 className="text-lg font-semibold tracking-tight">
          DriverPick
          <span className="ml-2 text-xs font-normal text-slate-400">
            find the right printer driver
          </span>
        </h1>
        <nav className="ml-6 flex gap-1">
          {STEPS.map((s) => (
            <span
              key={s.id}
              className={`rounded px-3 py-1 text-sm ${
                screen === s.id
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-400'
              }`}
            >
              {s.label}
            </span>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {host && (
            <span className="text-xs text-slate-500">
              Windows {host.windowsVersion} · {host.arch} · v{host.appVersion}
            </span>
          )}
          <UpdateButton />
        </div>
      </header>

      {host?.isElevated === false && (
        <div className="border-b border-amber-800 bg-amber-950/60 px-5 py-2 text-sm text-amber-300">
          ⚠ Not running as Administrator — driver installation will fail. Close this window and
          launch DriverPick from its installed shortcut or the portable exe so the UAC prompt
          appears.
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto p-5">
          {screen === 'discover' && (
            <Discover
              onSelect={(p) => {
                setPrinter(p)
                setCandidate(null)
                setScreen('select')
              }}
            />
          )}
          {screen === 'select' && printer && (
            <SelectDriver
              printer={printer}
              onBack={() => setScreen('discover')}
              onConfirm={(c) => {
                setCandidate(c)
                setInstallResult(null)
                setScreen('install')
              }}
            />
          )}
          {screen === 'install' && printer && candidate && (
            <Install
              printer={printer}
              candidate={candidate}
              onBack={() => setScreen('select')}
              onDone={(r) => {
                setInstallResult(r)
                if (r.success) setScreen('verify')
              }}
            />
          )}
          {screen === 'verify' && printer && installResult && (
            <Verify
              printer={printer}
              result={installResult}
              onStartOver={() => {
                setPrinter(null)
                setCandidate(null)
                setInstallResult(null)
                setScreen('discover')
              }}
            />
          )}
        </main>
        <LogPane />
      </div>
    </div>
  )
}
