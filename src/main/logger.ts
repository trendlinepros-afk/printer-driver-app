import { app, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import type { LogEntry } from '@shared/types'

let logFilePath: string | null = null
let stream: fs.WriteStream | null = null

/**
 * Log file goes next to the exe for the portable build, otherwise into
 * %LOCALAPPDATA%/DriverPick/logs.
 */
export function initLogger(): string {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
  const dir = portableDir
    ? portableDir
    : path.join(app.getPath('appData'), '..', 'Local', 'DriverPick', 'logs')
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    // fall back to userData if the preferred dir is not writable
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  let target = path.join(dir, `driverpick-${stamp}.log`)
  try {
    stream = fs.createWriteStream(target, { flags: 'a' })
  } catch {
    target = path.join(app.getPath('userData'), `driverpick-${stamp}.log`)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    stream = fs.createWriteStream(target, { flags: 'a' })
  }
  logFilePath = target
  return target
}

export function getLogFilePath(): string {
  return logFilePath ?? ''
}

export function log(level: LogEntry['level'], text: string): void {
  const entry: LogEntry = { ts: new Date().toISOString(), level, text }
  stream?.write(`${entry.ts} [${level.toUpperCase()}] ${text}\n`)
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('log', entry)
  }
}

export const logInfo = (t: string): void => log('info', t)
export const logCmd = (t: string): void => log('cmd', t)
export const logOut = (t: string): void => log('out', t)
export const logErr = (t: string): void => log('err', t)
export const logWarn = (t: string): void => log('warn', t)
export const logOk = (t: string): void => log('ok', t)
