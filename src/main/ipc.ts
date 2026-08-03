import { BrowserWindow, ipcMain, shell } from 'electron'
import { runDiscovery } from './discovery'
import { searchForPrinter, searchManual } from './catalog/search'
import { runInstall } from './install/installer'
import { runUninstall } from './install/uninstall'
import { sendTestPage } from './verify/testPage'
import { getHostInfo } from './hostInfo'
import { getLogFilePath } from './logger'
import { checkForUpdates, installUpdate } from './updates'
import type { DiscoveredPrinter, InstallRequest, UninstallRequest } from '@shared/types'

/**
 * All shell/SNMP/scraping work lives in the main process behind these
 * typed IPC handlers; the renderer is pure UI.
 */
export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('host:info', () => getHostInfo())
  ipcMain.handle('log:path', () => getLogFilePath())
  ipcMain.handle('log:reveal', () => {
    const p = getLogFilePath()
    if (p) shell.showItemInFolder(p)
  })

  ipcMain.handle('discovery:start', async () => {
    const win = getWindow()
    if (win) void runDiscovery(win)
  })

  ipcMain.handle('catalog:search', (_e, printer: DiscoveredPrinter) => searchForPrinter(printer))
  ipcMain.handle('catalog:searchManual', (_e, query: string) => searchManual(query))

  ipcMain.handle('install:run', (_e, req: InstallRequest) => {
    const win = getWindow()
    if (!win) return { success: false, error: 'No window' }
    return runInstall(win, req)
  })
  ipcMain.handle('install:uninstall', (_e, req: UninstallRequest) => runUninstall(req))

  ipcMain.handle('verify:testPage', (_e, printerName: string) => sendTestPage(printerName))

  ipcMain.handle('updates:check', () => checkForUpdates())
  ipcMain.handle('updates:install', (_e, url: string, latestVersion: string) =>
    installUpdate(url, latestVersion)
  )
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url)
    return Promise.resolve()
  })
}
