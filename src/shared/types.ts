// Types shared between main and renderer processes.

export type DiscoverySource = 'mdns' | 'snmp' | 'tcp' | 'usb' | 'manual'

export interface DiscoveredPrinter {
  id: string
  /** Best-known make/model string, e.g. "HP LaserJet Pro M404dn" */
  model: string
  ip?: string
  mac?: string
  sources: DiscoverySource[]
  /** Full PnP HardwareIDs array (USB devices) — the most important data we collect */
  hardwareIds: string[]
  /** Supported page description languages from mDNS `pdl` TXT record */
  pdl?: string
  /** Raw detail strings per source, for the UI tooltip / log */
  detail: string[]
  usbPortHint?: string
}

export interface DiscoveryProgress {
  phase: 'mdns' | 'snmp' | 'tcp' | 'usb'
  message: string
  done: boolean
}

export interface CatalogCandidate {
  updateId: string
  title: string
  products: string
  classification: string
  lastUpdated: string
  version: string
  sizeText: string
  sizeBytes: number
}

export interface RankedCandidate extends CatalogCandidate {
  score: number
  reasons: string[]
  isWindowsDefault: boolean
  archFiltered: boolean
  pdl?: string
}

export interface CatalogSearchResult {
  candidates: RankedCandidate[]
  queriesTried: string[]
  /** Set when the scrape failed — the UI links the user to the catalog to eyeball it */
  error?: string
  catalogUrl: string
}

export interface HostInfo {
  arch: 'x64' | 'arm64'
  windowsVersion: string
  windowsBuild: string
  appVersion: string
  /** true/false on Windows; null when it could not be determined (e.g. dev on non-Windows) */
  isElevated: boolean | null
}

export type InstallStepId =
  | 'download'
  | 'extract'
  | 'inf-verify'
  | 'pnputil'
  | 'add-driver'
  | 'add-port'
  | 'add-printer'

export interface InstallStepUpdate {
  step: InstallStepId
  status: 'running' | 'ok' | 'warn' | 'fail'
  message: string
}

export interface InfVerification {
  verified: boolean
  matchedBy?: 'hardware-id' | 'model-string'
  matchedValue?: string
  infModelName?: string
  infPath?: string
  allModels: string[]
}

export interface InstallRequest {
  printer: DiscoveredPrinter
  candidate: RankedCandidate
  /** Force install even if INF verification failed and the user accepted the warning */
  ignoreInfMismatch?: boolean
}

export interface InstallResult {
  success: boolean
  printerName?: string
  driverName?: string
  driverVersion?: string
  portName?: string
  publishedInfName?: string
  infVerification?: InfVerification
  error?: string
}

export interface UninstallRequest {
  printerName?: string
  driverName?: string
  publishedInfName?: string
  portName?: string
  portCreatedByUs: boolean
}

export interface TestPageResult {
  success: boolean
  method: 'cim' | 'printui'
  message: string
}

export interface LogEntry {
  ts: string
  level: 'info' | 'cmd' | 'out' | 'err' | 'warn' | 'ok'
  text: string
}

export interface UpdateCheckResult {
  currentVersion: string
  latestVersion?: string
  updateAvailable: boolean
  releaseUrl?: string
  downloadUrl?: string
  error?: string
}

/** API surface the preload script exposes as window.driverpick */
export interface DriverPickApi {
  getHostInfo(): Promise<HostInfo>
  startDiscovery(): Promise<void>
  onDiscoveryResult(cb: (p: DiscoveredPrinter[]) => void): () => void
  onDiscoveryProgress(cb: (p: DiscoveryProgress) => void): () => void
  searchCatalog(printer: DiscoveredPrinter): Promise<CatalogSearchResult>
  searchCatalogManual(query: string): Promise<CatalogSearchResult>
  install(req: InstallRequest): Promise<InstallResult>
  onInstallStep(cb: (u: InstallStepUpdate) => void): () => void
  uninstall(req: UninstallRequest): Promise<{ success: boolean; error?: string }>
  sendTestPage(printerName: string): Promise<TestPageResult>
  onLog(cb: (e: LogEntry) => void): () => void
  getLogFilePath(): Promise<string>
  revealLogFile(): Promise<void>
  checkForUpdates(): Promise<UpdateCheckResult>
  downloadUpdate(url: string): Promise<{ success: boolean; path?: string; error?: string }>
  openExternal(url: string): Promise<void>
}
