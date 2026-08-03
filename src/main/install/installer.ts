import { BrowserWindow, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as fsp from 'fs/promises'
import { runExe, runPowerShell, runPowerShellJson } from '../exec'
import { getDownloadUrls } from '../catalog/catalogClient'
import { parseInf, matchDeviceToInf, type InfMatch, type ParsedInf } from './infParser'
import { logInfo, logWarn, logErr, logOk } from '../logger'
import type {
  InstallRequest,
  InstallResult,
  InstallStepId,
  InfVerification
} from '@shared/types'

function step(
  win: BrowserWindow,
  stepId: InstallStepId,
  status: 'running' | 'ok' | 'warn' | 'fail',
  message: string
): void {
  if (!win.isDestroyed()) win.webContents.send('install:step', { step: stepId, status, message })
}

function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

function formatMB(bytes: number): string {
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

async function downloadCab(
  url: string,
  destDir: string,
  expectedBytes: number,
  onProgress?: (received: number, total: number) => void
): Promise<{ path: string; bytes: number }> {
  const fileName = decodeURIComponent(url.split('/').pop() ?? 'driver.cab').replace(/[^\w.-]/g, '_')
  const dest = path.join(destDir, fileName)
  logInfo(`Downloading ${url}`)
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status} for ${url}`)
  const total = Number(res.headers.get('content-length')) || expectedBytes || 0
  const reader = res.body.getReader()
  const out = fs.createWriteStream(dest)
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (!out.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => out.once('drain', resolve))
      }
      onProgress?.(received, total)
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      out.end((err?: Error | null) => (err ? reject(err) : resolve()))
    })
  }
  const bytes = (await fsp.stat(dest)).size
  logInfo(`Downloaded ${fileName} — ${bytes.toLocaleString()} bytes`)
  if (expectedBytes > 0) {
    // Catalog sizes are truncated for display; allow 5% slack.
    const ratio = bytes / expectedBytes
    if (ratio < 0.95 || ratio > 1.05) {
      logWarn(
        `Size mismatch: catalog metadata says ~${expectedBytes.toLocaleString()} bytes, got ${bytes.toLocaleString()}`
      )
    } else {
      logOk('Size matches catalog metadata')
    }
  }
  return { path: dest, bytes }
}

async function findInfFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await fsp.readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await findInfFiles(full)))
    else if (e.name.toLowerCase().endsWith('.inf')) out.push(full)
  }
  return out
}

/** Parse pnputil output for "Published Name: oemNN.inf" (locale best-effort). */
export function parsePnputilPublishedName(output: string): string | undefined {
  const m = output.match(/:\s*(oem\d+\.inf)/i)
  return m?.[1]
}

export async function runInstall(win: BrowserWindow, req: InstallRequest): Promise<InstallResult> {
  const result: InstallResult = { success: false }
  const workDir = path.join(app.getPath('temp'), 'driverpick', req.candidate.updateId)
  try {
    await fsp.rm(workDir, { recursive: true, force: true })
    await fsp.mkdir(workDir, { recursive: true })

    /* 1 — download */
    step(win, 'download', 'running', 'Resolving download URL from the catalog…')
    const urls = await getDownloadUrls(req.candidate.updateId)
    if (!urls.length) throw new Error('The catalog returned no download links for this update.')
    // Throttle progress updates so the IPC channel isn't flooded on fast links.
    let lastProgressAt = 0
    const cab = await downloadCab(urls[0], workDir, req.candidate.sizeBytes, (received, total) => {
      const now = Date.now()
      if (now - lastProgressAt < 400 && received !== total) return
      lastProgressAt = now
      const pct = total > 0 ? ` (${Math.round((received / total) * 100)}%)` : ''
      step(
        win,
        'download',
        'running',
        `Downloading… ${formatMB(received)}${total > 0 ? ` / ${formatMB(total)}` : ''}${pct}`
      )
    })
    step(win, 'download', 'ok', `Downloaded ${path.basename(cab.path)} (${cab.bytes.toLocaleString()} bytes)`)

    /* 2 — extract */
    step(win, 'extract', 'running', 'Extracting with expand.exe…')
    const extractDir = path.join(workDir, 'extracted')
    await fsp.mkdir(extractDir, { recursive: true })
    const expand = await runExe('expand.exe', ['-F:*', cab.path, extractDir])
    if (expand.code !== 0) throw new Error(`expand.exe failed with exit code ${expand.code}`)
    const infFiles = await findInfFiles(extractDir)
    if (!infFiles.length) throw new Error('No .inf files found in the extracted package.')
    step(win, 'extract', 'ok', `Extracted — found ${infFiles.length} INF file(s)`)

    /* 3 — INF verification (the differentiator) */
    step(win, 'inf-verify', 'running', 'Verifying the INF actually lists this device…')
    let match: InfMatch | null = null
    let matchedInf: ParsedInf | null = null
    const allModels: string[] = []
    for (const infPath of infFiles) {
      const parsed = parseInf(await fsp.readFile(infPath, 'latin1'), infPath)
      allModels.push(...parsed.models.map((m) => m.description))
      const m = matchDeviceToInf(parsed, req.printer.hardwareIds, req.printer.model)
      if (m && !match) {
        match = m
        matchedInf = parsed
      }
    }
    const verification: InfVerification = {
      verified: !!match,
      matchedBy: match?.matchedBy,
      matchedValue: match?.matchedValue,
      infModelName: match?.model.description,
      infPath: matchedInf?.path,
      allModels: [...new Set(allModels)].slice(0, 50)
    }
    result.infVerification = verification
    if (match && matchedInf) {
      step(
        win,
        'inf-verify',
        'ok',
        match.matchedBy === 'hardware-id'
          ? `Verified: hardware ID ${match.matchedValue} listed in ${path.basename(matchedInf.path)}`
          : `Verified: model "${match.matchedValue}" listed in ${path.basename(matchedInf.path)}`
      )
    } else {
      logWarn('INF verification FAILED — this driver package does not list your device.')
      step(
        win,
        'inf-verify',
        req.ignoreInfMismatch ? 'warn' : 'fail',
        'This package does not list your device in any INF [Models] section. ' +
          'Consider the next-ranked candidate instead.'
      )
      if (!req.ignoreInfMismatch) {
        result.error = 'inf-mismatch'
        return result
      }
    }
    const infToInstall = matchedInf?.path ?? infFiles[0]
    const driverDisplayName = match?.model.description

    /* 4 — stage + install with pnputil */
    step(win, 'pnputil', 'running', 'Staging driver with pnputil…')
    const pnp = await runExe('pnputil.exe', ['/add-driver', infToInstall, '/install'])
    if (pnp.code !== 0) throw new Error(`pnputil failed with exit code ${pnp.code}`)
    const publishedName = parsePnputilPublishedName(pnp.stdout)
    result.publishedInfName = publishedName
    step(win, 'pnputil', 'ok', `Driver staged${publishedName ? ` as ${publishedName}` : ''}`)

    /* 5 — Add-PrinterDriver + port + printer */
    if (!driverDisplayName) {
      throw new Error('Could not determine the driver display name from the INF.')
    }
    step(win, 'add-driver', 'running', `Add-PrinterDriver "${driverDisplayName}"…`)
    const addDriver = await runPowerShell(
      `if (-not (Get-PrinterDriver -Name ${psQuote(driverDisplayName)} -ErrorAction SilentlyContinue)) { ` +
        `Add-PrinterDriver -Name ${psQuote(driverDisplayName)} } else { 'Driver already installed' }`
    )
    if (addDriver.code !== 0) throw new Error('Add-PrinterDriver failed — see log above.')
    result.driverName = driverDisplayName
    step(win, 'add-driver', 'ok', `Printer driver "${driverDisplayName}" installed`)

    /* port */
    let portName: string
    if (req.printer.ip) {
      portName = `IP_${req.printer.ip}`
      step(win, 'add-port', 'running', `Creating RAW 9100 port ${portName}…`)
      const addPort = await runPowerShell(
        `if (-not (Get-PrinterPort -Name ${psQuote(portName)} -ErrorAction SilentlyContinue)) { ` +
          `Add-PrinterPort -Name ${psQuote(portName)} -PrinterHostAddress ${psQuote(req.printer.ip)} } ` +
          `else { 'Port already exists' }`
      )
      if (addPort.code !== 0) throw new Error('Add-PrinterPort failed — see log above.')
      step(win, 'add-port', 'ok', `Port ${portName} ready`)
    } else {
      // USB: the port already exists — find the USB00x port.
      step(win, 'add-port', 'running', 'Locating existing USB printer port…')
      const ports = await runPowerShellJson<{ Name: string }[] | { Name: string }>(
        `Get-PrinterPort | Where-Object { $_.Name -like 'USB*' } | Select-Object Name | ConvertTo-Json`
      )
      const list = ports ? (Array.isArray(ports) ? ports : [ports]) : []
      const hinted = req.printer.usbPortHint
      portName = hinted ?? list[0]?.Name
      if (!portName) throw new Error('No USB printer port (USB00x) found. Is the printer plugged in and on?')
      step(win, 'add-port', 'ok', `Using existing port ${portName}`)
    }
    result.portName = portName

    /* printer object, with name-collision suffixing */
    step(win, 'add-printer', 'running', 'Creating printer…')
    const baseName = req.printer.model.slice(0, 60)
    let printerName = baseName
    for (let i = 2; i <= 9; i++) {
      const exists = await runPowerShellJson<unknown>(
        `Get-Printer -Name ${psQuote(printerName)} -ErrorAction SilentlyContinue | Select-Object Name | ConvertTo-Json`
      )
      if (!exists) break
      printerName = `${baseName} (${i})`
    }
    const addPrinter = await runPowerShell(
      `Add-Printer -Name ${psQuote(printerName)} -DriverName ${psQuote(driverDisplayName)} -PortName ${psQuote(portName)}`
    )
    if (addPrinter.code !== 0) throw new Error('Add-Printer failed — see log above.')
    result.printerName = printerName
    result.driverVersion = matchedInf?.driverVersion
    step(win, 'add-printer', 'ok', `Printer "${printerName}" created on ${portName}`)

    logOk(`Install complete: "${printerName}" using "${driverDisplayName}"`)
    result.success = true
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logErr(`Install failed: ${message}`)
    result.error = message
    return result
  }
}
