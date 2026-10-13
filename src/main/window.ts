import { app, BrowserWindow, nativeImage, shell, screen } from 'electron'
import { join } from 'node:path'
import { profileGet, profileSet } from './db'

const isDev = !!process.env['ELECTRON_RENDERER_URL'] && !app.isPackaged

let win: BrowserWindow | null = null
let isExpanded = false
let saveTimer: NodeJS.Timeout | null = null

/**
 * 窗口状态管理:
 * - 位置(x/y)与当前尺寸全局持久化,重启恢复上次布局
 * - 折叠态(只放人物)与展开态(人物+面板)各自记忆尺寸,来回切换不丢
 * - 拖动/缩放过程中用防抖落盘,避免高频写 profile
 * - 窗口始终 clamp 在屏幕工作区内,防拖出屏幕丢失
 */
const COLLAPSED_W = 220
const COLLAPSED_H = 260
const DEFAULT_EXPANDED_W = 380
const DEFAULT_EXPANDED_H = 560
// 折叠态缩放范围(挂件形态)
const COLLAPSED_MIN_W = 180
const COLLAPSED_MIN_H = 200
const COLLAPSED_MAX_W = 600
const COLLAPSED_MAX_H = 800
// 展开态缩放范围(面板形态, 高度下限保证面板可读)
const EXPANDED_MIN_W = 300
const EXPANDED_MIN_H = 480
const EXPANDED_MAX_W = 800
const EXPANDED_MAX_H = 1000
/** 拖动时窗口至少保留在屏幕内的边距 */
const KEEP_ON_SCREEN = 60

function clampSize(w: number, h: number, expanded: boolean): { w: number; h: number } {
  const minW = expanded ? EXPANDED_MIN_W : COLLAPSED_MIN_W
  const minH = expanded ? EXPANDED_MIN_H : COLLAPSED_MIN_H
  const maxW = expanded ? EXPANDED_MAX_W : COLLAPSED_MAX_W
  const maxH = expanded ? EXPANDED_MAX_H : COLLAPSED_MAX_H
  return {
    w: Math.min(Math.max(Math.round(w), minW), maxW),
    h: Math.min(Math.max(Math.round(h), minH), maxH)
  }
}

function defaultState(): { x: number; y: number; w: number; h: number; expanded: boolean } {
  const wa = screen.getPrimaryDisplay().workAreaSize
  return {
    x: wa.width - COLLAPSED_W - 24,
    y: wa.height - COLLAPSED_H - 24,
    w: COLLAPSED_W,
    h: COLLAPSED_H,
    expanded: false
  }
}

/** 从 profile 恢复上次的窗口位置/尺寸(校验屏幕可见与尺寸范围) */
function loadState(): { x: number; y: number; w: number; h: number; expanded: boolean } {
  try {
    const x = Number(profileGet('window_x'))
    const y = Number(profileGet('window_y'))
    const w = Number(profileGet('window_w'))
    const h = Number(profileGet('window_h'))
    const expanded = profileGet('window_expanded') === '1'
    if (![x, y, w, h].every((v) => Number.isFinite(v) && v > 0)) return defaultState()
    const size = clampSize(w, h, expanded)
    // 防分辨率变化 / 外接屏拔掉后窗口跑出屏幕外
    const onScreen = screen.getAllDisplays().some((d) => {
      const a = d.workArea
      return (
        x < a.x + a.width - KEEP_ON_SCREEN &&
        y < a.y + a.height - KEEP_ON_SCREEN &&
        x + size.w > a.x + KEEP_ON_SCREEN &&
        y + size.h > a.y + KEEP_ON_SCREEN
      )
    })
    if (!onScreen) return defaultState()
    return { x: Math.round(x), y: Math.round(y), ...size, expanded }
  } catch {
    return defaultState()
  }
}

/** 读取某档位记忆尺寸(没有则用默认) */
function rememberedSize(expanded: boolean): { w: number; h: number } {
  const w = Number(profileGet(expanded ? 'window_expanded_w' : 'window_collapsed_w'))
  const h = Number(profileGet(expanded ? 'window_expanded_h' : 'window_collapsed_h'))
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return clampSize(w, h, expanded)
  return expanded ? { w: DEFAULT_EXPANDED_W, h: DEFAULT_EXPANDED_H } : { w: COLLAPSED_W, h: COLLAPSED_H }
}

function persist(): void {
  if (!win || win.isDestroyed()) return
  const [x, y] = win.getPosition()
  const [w, h] = win.getSize()
  profileSet('window_x', String(x))
  profileSet('window_y', String(y))
  profileSet('window_w', String(w))
  profileSet('window_h', String(h))
  profileSet('window_expanded', isExpanded ? '1' : '0')
  profileSet(isExpanded ? 'window_expanded_w' : 'window_collapsed_w', String(w))
  profileSet(isExpanded ? 'window_expanded_h' : 'window_collapsed_h', String(h))
}

/** 拖动/缩放结束 500ms 后落盘,避免高频写 profile */
function schedulePersist(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    persist()
  }, 500)
}

/** 与窗口重叠面积最大的显示器工作区(拖到副屏时用副屏而非主屏) */
function bestWorkArea(b: { x: number; y: number; width: number; height: number }): Electron.Rectangle {
  let best = screen.getPrimaryDisplay().workArea
  let maxOverlap = -1
  for (const d of screen.getAllDisplays()) {
    const a = d.workArea
    const ox = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x)
    const oy = Math.min(b.y + b.height, a.y + a.height) - Math.max(b.y, a.y)
    const ov = Math.max(ox, 0) * Math.max(oy, 0)
    if (ov > maxOverlap) {
      maxOverlap = ov
      best = a
    }
  }
  return best
}

/**
 * 把窗口位置钳制到屏幕工作区内(窗口完全可见, 永不丢失)。
 * 透明无边框窗口拖到屏幕外会"消失", 因此拖动/缩放都限制为完全屏内。
 */
function clampPos(x: number, y: number): { x: number; y: number } {
  const [w, h] = win && !win.isDestroyed() ? win.getSize() : [COLLAPSED_W, COLLAPSED_H]
  const a = bestWorkArea({ x, y, width: w, height: h })
  const nx = Math.min(Math.max(x, a.x), a.x + a.width - Math.min(w, a.width))
  const ny = Math.min(Math.max(y, a.y), a.y + a.height - Math.min(h, a.height))
  return { x: Math.round(nx), y: Math.round(ny) }
}

/** 缩放时也限制尺寸不超过所在屏幕工作区 */
function clampSizeToScreen(w: number, h: number): { w: number; h: number } {
  if (!win || win.isDestroyed()) return { w, h }
  const [x, y] = win.getPosition()
  const a = bestWorkArea({ x, y, width: w, height: h })
  return { w: Math.min(w, a.width), h: Math.min(h, a.height) }
}

export function getMainWindow(): BrowserWindow | null {
  return win
}

export function createMainWindow(): BrowserWindow {
  const state = loadState()
  isExpanded = state.expanded

  win = new BrowserWindow({
    width: state.w,
    height: state.h,
    x: state.x,
    y: state.y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
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

  // 任务栏图标: 用搭子形象图(生产构建后位于 out/renderer/companion/, dev 下加载失败则用默认)
  try {
    const icon = nativeImage.createFromPath(join(__dirname, '../renderer/companion/neutral.png'))
    if (!icon.isEmpty()) win.setIcon(icon)
  } catch {
    // ignore
  }

  win.on('closed', () => {
    win = null
  })

  // 系统级移动/缩放(如 Win+方向键、贴靠)也触发保存
  win.on('moved', schedulePersist)
  win.on('resized', schedulePersist)

  // 实时钳制: 拖动/缩放过程中窗口始终完全在屏幕内, 防止拖出屏幕丢失
  let clamping = false
  const clampNow = () => {
    if (clamping || !win || win.isDestroyed()) return
    const [x, y] = win.getPosition()
    const p = clampPos(x, y)
    if (p.x !== x || p.y !== y) {
      clamping = true
      win.setPosition(p.x, p.y)
      clamping = false
    }
  }
  win.on('move', clampNow)
  win.on('resize', clampNow)

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

/** 渲染进程驱动窗口移动(screen 坐标增量),窗口始终保留在屏幕内 */
export function moveWindow(deltaX: number, deltaY: number): void {
  if (!win) return
  const [x, y] = win.getPosition()
  const p = clampPos(x + Math.round(deltaX), y + Math.round(deltaY))
  win.setPosition(p.x, p.y)
  schedulePersist()
}

/** 最小化窗口 (隐藏到托盘) */
export function minimizeWindow(): void {
  win?.minimize()
}

/** 自定义窗口缩放 (渲染进程驱动), 当前档位尺寸会被记忆 */
export function resizeWindow(dw: number, dh: number): void {
  if (!win) return
  const [x, y, w, h] = [...win.getPosition(), ...win.getSize()]
  const size = clampSize(w + Math.round(dw), h + Math.round(dh), isExpanded)
  // 缩放不能超出所在屏幕工作区, 防止窗口撑出屏幕后手柄够不到
  const onScreen = clampSizeToScreen(size.w, size.h)
  const p = clampPos(x, y)
  win.setBounds({ x: p.x, y: p.y, width: onScreen.w, height: onScreen.h })
  schedulePersist()
}

/** 折叠/展开: 切换时恢复各自档位记忆的尺寸 */
export function togglePanel(expanded: boolean): void {
  if (!win) return
  isExpanded = expanded
  const [x, y] = win.getPosition()
  const size = rememberedSize(expanded)
  const p = clampPos(x, y)
  win.setBounds({ x: p.x, y: p.y, width: size.w, height: size.h })
  schedulePersist()
}

/** 窗口是否"丢失": 缩到极小或几乎全部在屏幕外(透明小窗口很难找) */
function isWindowLost(): boolean {
  if (!win || win.isDestroyed()) return true
  const [x, y] = win.getPosition()
  const [w, h] = win.getSize()
  const onScreen = screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return (
      x < a.x + a.width - KEEP_ON_SCREEN &&
      y < a.y + a.height - KEEP_ON_SCREEN &&
      x + w > a.x + KEEP_ON_SCREEN &&
      y + h > a.y + KEEP_ON_SCREEN
    )
  })
  return !onScreen || w < 150 || h < 150
}

/** 恢复到默认布局(主屏右下角, 折叠态) */
export function resetWindowPosition(): void {
  if (!win || win.isDestroyed()) {
    createMainWindow()
    return
  }
  const d = defaultState()
  isExpanded = false
  win.setBounds({ x: d.x, y: d.y, width: d.w, height: d.h })
  persist()
}

/** 呼出/收起窗口(托盘点击、全局快捷键)。丢失时先恢复默认布局再显示。 */
export function toggleWindow(): void {
  if (!win || win.isDestroyed()) {
    createMainWindow()
    return
  }
  if (isWindowLost()) resetWindowPosition()
  if (win.isMinimized()) {
    // 最小化到任务栏后, 点托盘/快捷键应恢复而不是隐藏
    win.restore()
    win.focus()
  } else if (win.isVisible()) {
    win.hide()
  } else {
    win.show()
    win.focus()
  }
}
