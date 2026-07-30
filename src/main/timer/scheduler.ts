import { BrowserWindow, Notification } from 'electron'
import { addReminder, dueReminders, clearReminder } from '../db'

/**
 * 提醒调度引擎。使用绝对时间戳触发,不依赖 setInterval 累加,避免后台 throttling 漂移。
 * 巡检周期 15s,精度足够且开销极低。
 */
const TICK_MS = 15_000
let timer: NodeJS.Timeout | null = null

export function scheduleReminder(ts: number, kind: string, payload = ''): void {
  addReminder(ts, kind, payload)
}

export function startScheduler(getWin: () => BrowserWindow | null): void {
  if (timer) return
  timer = setInterval(() => {
    const win = getWin()
    const due = dueReminders(Date.now())
    for (const r of due) {
      fireReminder(win, r.kind, r.payload)
      clearReminder(r.id)
    }
  }, TICK_MS)
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function fireReminder(win: BrowserWindow | null, kind: string, payload: string): void {
  // 搭子气泡提醒(由渲染进程呈现角色与动作)
  win?.webContents.send('reminder:fire', { kind, payload })

  // 系统通知兜底
  const text = reminderText(kind, payload)
  if (Notification.isSupported()) {
    new Notification({ title: '陪伴搭子', body: text }).show()
  }
}

function reminderText(kind: string, payload: string): string {
  switch (kind) {
    case 'pomodoro':
      return payload || '番茄钟结束啦,辛苦了,休息一下吧 💪'
    case 'patrol':
      return '进度怎么样啦?还顺利吗?'
    case 'task':
      return payload || '该开始下一个任务咯~'
    default:
      return payload || '到点啦!'
  }
}
