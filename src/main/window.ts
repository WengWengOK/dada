import { app, BrowserWindow, shell, screen } from 'electron'
import { join } from 'node:path'

const isDev = !!process.env['ELECTRON_RENDERER_URL'] && !app.isPackaged

let win: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return win
}

export function createMainWindow(): BrowserWindow {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize

  win = new BrowserWindow({
    width: 320,
    height: 420,
    x: sw - 340,
    y: sh - 440,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    title: '陪伴搭子',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      backgroundThrottling: true
    }
  })

  win.on('ready-to-show', () => win?.show())

  win.on('closed', () => {
    win = null
  })

  // 外部链接用系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

/** 切换点击穿透。forward: true 保证穿透时仍能收到 mousemove 用于还原。 */
export function setIgnoreMouseEvents(ignore: boolean): void {
  win?.setIgnoreMouseEvents(ignore, { forward: true })
}

export function togglePanel(expanded: boolean): void {
  if (!win) return
  if (expanded) {
    win.setSize(380, 560)
  } else {
    win.setSize(220, 260)
  }
}
