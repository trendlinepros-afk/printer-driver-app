import { app, BrowserWindow } from 'electron'
import * as path from 'path'
import { registerIpcHandlers } from './ipc'
import { initLogger, logInfo } from './logger'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1150,
    height: 800,
    minWidth: 900,
    minHeight: 640,
    title: 'DriverPick',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  const logPath = initLogger()
  registerIpcHandlers(() => mainWindow)
  createWindow()
  logInfo(`DriverPick ${app.getVersion()} started — log file: ${logPath}`)
})

app.on('window-all-closed', () => {
  app.quit()
})
