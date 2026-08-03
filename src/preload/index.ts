import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  DiscoveredPrinter,
  DiscoveryProgress,
  DriverPickApi,
  InstallRequest,
  InstallStepUpdate,
  LogEntry,
  UninstallRequest
} from '@shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: DriverPickApi = {
  getHostInfo: () => ipcRenderer.invoke('host:info'),
  startDiscovery: () => ipcRenderer.invoke('discovery:start'),
  onDiscoveryResult: (cb: (p: DiscoveredPrinter[]) => void) => subscribe('discovery:result', cb),
  onDiscoveryProgress: (cb: (p: DiscoveryProgress) => void) => subscribe('discovery:progress', cb),
  searchCatalog: (printer: DiscoveredPrinter) => ipcRenderer.invoke('catalog:search', printer),
  searchCatalogManual: (query: string) => ipcRenderer.invoke('catalog:searchManual', query),
  install: (req: InstallRequest) => ipcRenderer.invoke('install:run', req),
  onInstallStep: (cb: (u: InstallStepUpdate) => void) => subscribe('install:step', cb),
  uninstall: (req: UninstallRequest) => ipcRenderer.invoke('install:uninstall', req),
  sendTestPage: (printerName: string) => ipcRenderer.invoke('verify:testPage', printerName),
  onLog: (cb: (e: LogEntry) => void) => subscribe('log', cb),
  getLogFilePath: () => ipcRenderer.invoke('log:path'),
  revealLogFile: () => ipcRenderer.invoke('log:reveal'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: (url: string, latestVersion: string) =>
    ipcRenderer.invoke('updates:install', url, latestVersion),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url)
}

contextBridge.exposeInMainWorld('driverpick', api)
