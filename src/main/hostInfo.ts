import { app } from 'electron'
import * as os from 'os'
import type { HostInfo } from '@shared/types'

let cached: HostInfo | null = null

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
    appVersion: app.getVersion()
  }
  return cached
}
