import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { createMainWindow, getMainWindow, toggleWindow } from './window'
import { createTray } from './tray'
import { registerIpc } from './ipc'
import { startIdleWatcher, stopIdleWatcher } from './idle'
import { startScheduler, stopScheduler } from './timer/scheduler'
import { startPatrol, stopPatrol, onUserReturn } from './timer/patrol'
import { setFocusing, isFocusing } from './focus-state'
import { profileGet, profileSet } from './db'
import { PERSONAS } from './llm/persona'
import { startWatcher as startActivityWatcher, stopWatcher as stopActivityWatcher } from './activity/watcher'
import { startBridgeServer, stopBridgeServer } from './bridge-server'
import { startWeatherWatch } from './weather'

// 单实例锁,避免多开
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.whenReady().then(() => {
    registerIpc()
    createMainWindow()
    startWeatherWatch()

    // #region debug-point H4:createWindow-done
    ;(async () => { try {
      const fs = require('fs') as typeof import('node:fs');
      const p = '.dbg/companion-ui-bug.env';
      let u = 'http://127.0.0.1:7777/event', s = 'companion-ui-bug';
      try { const e = fs.readFileSync(p, 'utf8'); u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || u; s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || s } catch {}
      await fetch(u, { method: 'POST', body: JSON.stringify({ sessionId: s, runId: 'pre', hypothesisId: 'H4', location: 'src/main/index.ts:createMainWindow', msg: '[DEBUG] Main window created OK', data: { url: process.env['ELECTRON_RENDERER_URL'] || 'local-html', dev: !!process.env['ELECTRON_RENDERER_URL'], isPackaged: app.isPackaged }, ts: Date.now() }) }).catch(() => {})
    } catch {} })()
    // #endregion

    // 渲染进程错误捕获(证实 H4 必备)
    const w = getMainWindow();
    if (w) {
      w.webContents.on('console-message', (_e, level, msg, line, srcId) => {
        // 只上报 warn/error,防止 info 级日志刷爆
        if (level === 0 || level === 1) return
        // #region debug-point H4:console-error
        (async () => { try {
          const fs = require('fs') as typeof import('node:fs');
          const p = '.dbg/companion-ui-bug.env';
          let u = 'http://127.0.0.1:7777/event', s = 'companion-ui-bug';
          try { const e = fs.readFileSync(p, 'utf8'); u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || u; s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || s } catch {}
          await fetch(u, { method: 'POST', body: JSON.stringify({ sessionId: s, runId: 'pre', hypothesisId: 'H4', location: srcId + ':' + line, msg: '[DEBUG] renderer console warn/error', data: { level, msg: String(msg).slice(0, 600) }, ts: Date.now() }) }).catch(() => {})
        } catch {} })();
        // #endregion
      })
      w.webContents.on('did-fail-load', (_e, code, desc) => {
        // #region debug-point H1:did-fail-load
        (async () => { try {
          const fs = require('fs') as typeof import('node:fs');
          const p = '.dbg/companion-ui-bug.env';
          let u = 'http://127.0.0.1:7777/event', s = 'companion-ui-bug';
          try { const e = fs.readFileSync(p, 'utf8'); u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || u; s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || s } catch {}
          await fetch(u, { method: 'POST', body: JSON.stringify({ sessionId: s, runId: 'pre', hypothesisId: 'H1', location: 'src/main/index.ts:did-fail-load', msg: '[DEBUG] renderer page load FAIL', data: { code, desc }, ts: Date.now() }) }).catch(() => {})
        } catch {} })();
        // #endregion
      })
      w.webContents.on('render-process-gone', (_e, d) => {
        // #region debug-point H4:render-gone
        (async () => { try {
          const fs = require('fs') as typeof import('node:fs');
          const p = '.dbg/companion-ui-bug.env';
          let u = 'http://127.0.0.1:7777/event', s = 'companion-ui-bug';
          try { const e = fs.readFileSync(p, 'utf8'); u = e.match(/DEBUG_SERVER_URL=(.+)/)?.[1] || u; s = e.match(/DEBUG_SESSION_ID=(.+)/)?.[1] || s } catch {}
          await fetch(u, { method: 'POST', body: JSON.stringify({ sessionId: s, runId: 'pre', hypothesisId: 'H4', location: 'src/main/index.ts:render-process-gone', msg: '[DEBUG] render process CRASHED', data: d, ts: Date.now() }) }).catch(() => {})
        } catch {} })();
        // #endregion
      })
    }

    createTray()
    // 空闲检测:离开很久后回归时,触发一次巡检询问
    startIdleWatcher(getMainWindow, (awaySec) =>
      onUserReturn(getMainWindow, awaySec)
    )
    startScheduler(getMainWindow)
    // 巡检:专注中不打扰
    startPatrol(getMainWindow, isFocusing)
    // 活动采样(Windows only)
    startActivityWatcher()
    // 浏览器插件桥接 HTTP 服务
    startBridgeServer(getMainWindow)

    // 番茄钟专注状态同步(渲染进程上报)
    registerFocusIpc()

    // 全局快捷键:呼出/隐藏(窗口丢失时自动恢复位置)
    globalShortcut.register('CommandOrControl+Shift+D', () => {
      toggleWindow()
    })

    sendGreeting()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    // 桌面常驻:不退出,由托盘退出
  })

  app.on('before-quit', () => {
    stopIdleWatcher()
    stopScheduler()
    stopPatrol()
    stopActivityWatcher()
    stopBridgeServer()
    globalShortcut.unregisterAll()
  })
}

function sendGreeting(): void {
  const win = getMainWindow()
  if (!win) return
  const h = new Date().getHours()
  let greet = '嗨'
  if (h < 6) greet = '这么晚了还没睡呀'
  else if (h < 11) greet = '早上好'
  else if (h < 14) greet = '中午好'
  else if (h < 18) greet = '下午好'
  else if (h < 22) greet = '晚上好'
  else greet = '夜深啦'

  const persona = profileGet('persona') ?? 'cheerful'
  const personaName = PERSONAS[persona as keyof typeof PERSONAS]?.name ?? '元气鼓励'

  // 首次启动初始化昵称占位
  if (!profileGet('user_name')) profileSet('user_name', '同学')

  win.webContents.once('did-finish-load', () => {
    win.webContents.send('greeting', `${greet},${profileGet('user_name')}~ 我是你的搭子(${personaName}),今天一起加油吧!`)
  })
}

function registerFocusIpc(): void {
  ipcMain.on('focus:set', (_e, v: boolean) => setFocusing(v))
}
