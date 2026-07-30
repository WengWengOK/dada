import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { createMainWindow, getMainWindow } from './window'
import { createTray } from './tray'
import { registerIpc } from './ipc'
import { startIdleWatcher, stopIdleWatcher } from './idle'
import { startScheduler, stopScheduler } from './timer/scheduler'
import { startPatrol, stopPatrol, onUserReturn } from './timer/patrol'
import { setFocusing, isFocusing } from './focus-state'
import { profileGet, profileSet } from './db'
import { PERSONAS } from './llm/persona'
import { startWatcher as startActivityWatcher, stopWatcher as stopActivityWatcher } from './activity/watcher'

// 单实例锁,避免多开
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.whenReady().then(() => {
    registerIpc()
    createMainWindow()
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

    // 番茄钟专注状态同步(渲染进程上报)
    registerFocusIpc()

    // 全局快捷键:呼出/隐藏
    globalShortcut.register('CommandOrControl+Shift+D', () => {
      const w = getMainWindow()
      if (!w) return
      if (w.isVisible()) w.hide()
      else w.show()
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
