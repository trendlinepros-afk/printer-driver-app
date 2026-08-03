import { runExe, runPowerShell } from '../exec'
import { logInfo, logOk, logWarn } from '../logger'
import type { UninstallRequest } from '@shared/types'

function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

/**
 * "Remove what I just did": printer → port (if we created it) → printer
 * driver → staged driver package. Each step is best-effort so a partial
 * install can still be cleaned up; failures are logged, not silent.
 */
export async function runUninstall(req: UninstallRequest): Promise<{ success: boolean; error?: string }> {
  logInfo('Rolling back the installation…')
  const problems: string[] = []

  if (req.printerName) {
    const r = await runPowerShell(
      `Remove-Printer -Name ${psQuote(req.printerName)} -ErrorAction Stop`
    )
    if (r.code !== 0) problems.push(`Remove-Printer "${req.printerName}" failed`)
    else logOk(`Removed printer "${req.printerName}"`)
  }

  if (req.portName && req.portCreatedByUs) {
    const r = await runPowerShell(
      `Remove-PrinterPort -Name ${psQuote(req.portName)} -ErrorAction Stop`
    )
    if (r.code !== 0) problems.push(`Remove-PrinterPort "${req.portName}" failed`)
    else logOk(`Removed port "${req.portName}"`)
  }

  if (req.driverName) {
    // The spooler may need a moment to release the driver after Remove-Printer.
    const r = await runPowerShell(
      `Start-Sleep -Seconds 2; Remove-PrinterDriver -Name ${psQuote(req.driverName)} -ErrorAction Stop`
    )
    if (r.code !== 0) problems.push(`Remove-PrinterDriver "${req.driverName}" failed`)
    else logOk(`Removed printer driver "${req.driverName}"`)
  }

  if (req.publishedInfName) {
    const r = await runExe('pnputil.exe', ['/delete-driver', req.publishedInfName, '/uninstall', '/force'])
    if (r.code !== 0) problems.push(`pnputil /delete-driver ${req.publishedInfName} failed`)
    else logOk(`Deleted staged driver package ${req.publishedInfName}`)
  }

  if (problems.length) {
    logWarn(`Rollback finished with issues: ${problems.join('; ')}`)
    return { success: false, error: problems.join('; ') }
  }
  logOk('Rollback complete — system restored.')
  return { success: true }
}
