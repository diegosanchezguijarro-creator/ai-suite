import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { createCore } from './core.js'

let win = null
let core = null

async function boot() {
  core = await createCore({ dataDir: app.getPath('userData'), log: (...a) => console.log(...a) })
  const port = await core.start()
  const url = `http://localhost:${port}`

  win = new BrowserWindow({
    width: 1180,
    height: 780,
    title: 'AI Suite',
    autoHideMenuBar: true,
    backgroundColor: '#0e1013',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  await win.loadURL(url)

  win.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target)
    return { action: 'deny' }
  })

  win.on('closed', () => {
    win = null
  })
}

app.whenReady().then(boot)

app.on('window-all-closed', () => {
  // Quit closes the dashboard; children get stopped in will-quit.
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async () => {
  try { await core?.shutdown() } catch {}
})

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
}
