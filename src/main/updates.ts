import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import { spawn } from 'child_process'
import { logInfo, logErr, logOk } from './logger'
import type { UpdateCheckResult } from '@shared/types'

const GITHUB_REPO = 'trendlinepros-afk/printer-driver-app'
const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

interface GitHubAsset {
  name: string
  browser_download_url: string
}
interface GitHubRelease {
  tag_name: string
  html_url: string
  assets: GitHubAsset[]
}

function normalizeVersion(v: string): number[] {
  return v
    .replace(/^v/i, '')
    .split('.')
    .map((p) => parseInt(p, 10) || 0)
}

function isNewer(latest: string, current: string): boolean {
  const a = normalizeVersion(latest)
  const b = normalizeVersion(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

/**
 * Manual update check against this app's GitHub Releases. No auto-update,
 * no background polling — only runs when the user clicks the button.
 */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion()
  try {
    logInfo(`Checking for updates (current version ${currentVersion})…`)
    const res = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DriverPick' },
      signal: AbortSignal.timeout(15_000)
    })
    if (res.status === 404) {
      return { currentVersion, updateAvailable: false, error: 'No releases published yet.' }
    }
    if (!res.ok) throw new Error(`GitHub API returned HTTP ${res.status}`)
    const release = (await res.json()) as GitHubRelease
    const latestVersion = release.tag_name
    const updateAvailable = isNewer(latestVersion, currentVersion)
    // Portable builds update with the portable exe; installed builds with the
    // NSIS installer (which can run silently and relaunch the app).
    const isPortable = !!process.env.PORTABLE_EXECUTABLE_DIR
    const preferred = isPortable ? /portable.*\.exe$/i : /setup.*\.exe$/i
    const asset =
      release.assets.find((a) => preferred.test(a.name)) ??
      release.assets.find((a) => /\.exe$/i.test(a.name))
    logInfo(
      updateAvailable
        ? `Update available: ${latestVersion} (current ${currentVersion})`
        : `Already up to date (latest is ${latestVersion})`
    )
    return {
      currentVersion,
      latestVersion,
      updateAvailable,
      releaseUrl: release.html_url,
      downloadUrl: asset?.browser_download_url
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logErr(`Update check failed: ${message}`)
    return { currentVersion, updateAvailable: false, error: message }
  }
}

async function downloadTo(url: string, dest: string): Promise<void> {
  logInfo(`Downloading update from ${url}`)
  const res = await fetch(url, { headers: { 'User-Agent': 'DriverPick' }, redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(dest))
  logOk(`Update downloaded to ${dest}`)
}

/**
 * Download the update and apply it automatically:
 * - Installed (NSIS) build: run the new installer silently with the NSIS
 *   `--force-run` flag so the app relaunches when the install finishes,
 *   then quit this instance.
 * - Portable build: save the new exe next to the current one (versioned
 *   name), launch it, then quit this instance.
 */
export async function installUpdate(
  url: string,
  latestVersion: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
    if (portableDir) {
      const version = latestVersion.replace(/^v/i, '')
      const dest = path.join(portableDir, `DriverPick-Portable-${version}.exe`)
      await downloadTo(url, dest)
      logOk('Launching the new version — this window will close.')
      spawn(dest, [], { detached: true, stdio: 'ignore' }).unref()
    } else {
      const dir = path.join(app.getPath('temp'), 'driverpick-update')
      fs.mkdirSync(dir, { recursive: true })
      const dest = path.join(dir, 'DriverPick-Setup.exe')
      await downloadTo(url, dest)
      logOk('Running the installer — the app will restart when it finishes.')
      spawn(dest, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
    }
    // Give the spawned process a moment to start before this instance exits.
    setTimeout(() => app.quit(), 800)
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logErr(`Update failed: ${message}`)
    return { success: false, error: message }
  }
}
