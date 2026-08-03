import { app } from 'electron'
import * as os from 'os'
import { runPowerShell } from './exec'
import type { HostInfo } from '@shared/types'

let cached: HostInfo | null = null

/** Detect whether the process is elevated — pnputil/Add-PrinterDriver need it. */
async function detectElevation(): Promise<boolean | null> {
  if (process.platform !== 'win32') return null
  const r = await runPowerShell(
    '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent())' +
      '.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'
  )
  if (r.code !== 0) return null
  const out = r.stdout.trim().toLowerCase()
  return out === 'true' ? true : out === 'false' ? false : null
}

export async function getHostInfo(): Promise<HostInfo> {
  if (cached) return cached
  const arch: 'x64' | 'arm64' = process.arch === 'arm64' ? 'arm64' : 'x64'
  // os.release() is "10.0.<build>"; build >= 22000 means Windows 11.
  const release = os.release()
  const build = release.split('.')[2] ?? '0'
  const windowsVersion = parseInt(build, 10) >= 22000 ? '11' : '10'
  cached = {
    arch,
    windowsVersion,
    windowsBuild: build,
    appVersion: app.getVersion(),
    isElevated: await detectElevation()
  }
  return cached
}
