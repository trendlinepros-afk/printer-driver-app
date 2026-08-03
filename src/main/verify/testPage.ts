import { runExe, runPowerShell } from '../exec'
import { logOk, logWarn } from '../logger'
import type { TestPageResult } from '@shared/types'

/**
 * Send a Windows test page: Win32_Printer.PrintTestPage via CIM, falling
 * back to printui.dll if CIM fails.
 */
export async function sendTestPage(printerName: string): Promise<TestPageResult> {
  const cim = await runPowerShell(
    `$p = Get-CimInstance Win32_Printer -Filter "Name = '${printerName.replace(/'/g, "''")}'" ; ` +
      `if (-not $p) { Write-Error 'Printer not found'; exit 1 } ; ` +
      `$r = Invoke-CimMethod -InputObject $p -MethodName PrintTestPage ; ` +
      `Write-Output ("ReturnValue=" + $r.ReturnValue) ; ` +
      `if ($r.ReturnValue -ne 0) { exit 2 }`
  )
  if (cim.code === 0 && /ReturnValue=0/.test(cim.stdout)) {
    logOk(`Test page queued to "${printerName}" via CIM`)
    return { success: true, method: 'cim', message: 'Test page sent (Win32_Printer.PrintTestPage).' }
  }

  logWarn('CIM PrintTestPage failed — falling back to printui.dll')
  const fallback = await runExe('rundll32.exe', [
    'printui.dll,PrintUIEntry',
    '/k',
    `/n${printerName}`
  ])
  if (fallback.code === 0) {
    logOk(`Test page queued to "${printerName}" via printui.dll`)
    return { success: true, method: 'printui', message: 'Test page sent (printui.dll fallback).' }
  }
  return {
    success: false,
    method: 'printui',
    message: `Both PrintTestPage methods failed (CIM: ${cim.stdout.trim() || cim.stderr.trim() || 'no output'}).`
  }
}
