import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
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
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DriverPick' }
    })
    if (res.status === 404) {
      return { currentVersion, updateAvailable: false, error: 'No releases published yet.' }
    }
    if (!res.ok) throw new Error(`GitHub API returned HTTP ${res.status}`)
    const release = (await res.json()) as GitHubRelease
    const latestVersion = release.tag_name
    const updateAvailable = isNewer(latestVersion, currentVersion)
    // Prefer the portable exe (runs in place), fall back to the installer.
    const asset =
      release.assets.find((a) => /portable.*\.exe$/i.test(a.name)) ??
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

/** Download the release asset into the user's Downloads folder. */
export async function downloadUpdate(
  url: string
): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    const fileName = decodeURIComponent(url.split('/').pop() ?? 'DriverPick.exe').replace(
      /[^\w.-]/g,
      '_'
    )
    const dest = path.join(app.getPath('downloads'), fileName)
    logInfo(`Downloading update from ${url}`)
    const res = await fetch(url, { headers: { 'User-Agent': 'DriverPick' }, redirect: 'follow' })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(dest))
    logOk(`Update downloaded to ${dest}`)
    return { success: true, path: dest }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logErr(`Update download failed: ${message}`)
    return { success: false, error: message }
  }
}
