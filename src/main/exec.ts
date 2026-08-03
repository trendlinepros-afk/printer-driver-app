import { spawn } from 'child_process'
import { logCmd, logOut, logErr } from './logger'

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

/**
 * Run a PowerShell command. Every invocation is streamed to the log pane:
 * the command itself, all stdout/stderr lines, and a non-zero exit is
 * surfaced loudly — never a silent failure.
 */
export function runPowerShell(command: string, opts?: { timeoutMs?: number }): Promise<ExecResult> {
  return runProcess(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    command,
    opts
  )
}

/** Run a plain executable (expand.exe, pnputil.exe, rundll32.exe …). */
export function runExe(
  exe: string,
  args: string[],
  opts?: { timeoutMs?: number }
): Promise<ExecResult> {
  return runProcess(exe, args, `${exe} ${args.join(' ')}`, opts)
}

function runProcess(
  exe: string,
  args: string[],
  displayCommand: string,
  opts?: { timeoutMs?: number }
): Promise<ExecResult> {
  logCmd(`> ${displayCommand}`)
  return new Promise((resolve) => {
    const child = spawn(exe, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = opts?.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          child.kill()
        }, opts.timeoutMs)
      : null

    child.stdout.on('data', (d: Buffer) => {
      const text = d.toString()
      stdout += text
      for (const line of text.split(/\r?\n/)) if (line.trim()) logOut(line)
    })
    child.stderr.on('data', (d: Buffer) => {
      const text = d.toString()
      stderr += text
      for (const line of text.split(/\r?\n/)) if (line.trim()) logErr(line)
    })
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      logErr(`FAILED to start: ${displayCommand} — ${err.message}`)
      resolve({ code: -1, stdout, stderr: stderr + err.message })
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      const exit = timedOut ? -2 : (code ?? -1)
      if (exit !== 0) {
        logErr(
          timedOut
            ? `TIMED OUT after ${opts?.timeoutMs}ms: ${displayCommand}`
            : `Exit code ${exit}: ${displayCommand}`
        )
      }
      resolve({ code: exit, stdout, stderr })
    })
  })
}

/** Run PowerShell and parse stdout as JSON (use with ConvertTo-Json). */
export async function runPowerShellJson<T>(command: string): Promise<T | null> {
  const res = await runPowerShell(command)
  if (res.code !== 0) return null
  const trimmed = res.stdout.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as T
  } catch {
    logErr(`Could not parse PowerShell output as JSON: ${trimmed.slice(0, 200)}`)
    return null
  }
}
