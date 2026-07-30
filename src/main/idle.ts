import { powerMonitor, BrowserWindow } from 'electron'

export interface IdleState {
  idleSeconds: number
  isAway: boolean
}

const AWAY_THRESHOLD_SEC = 5 * 60 // 离开 5 分钟视为"离开"
const POLL_INTERVAL_MS = 30_000

let timer: NodeJS.Timeout | null = null
let wasAway = false

/**
 * 启动空闲检测。每周期把状态推给渲染进程;
 * 当用户从"离开"恢复为"活跃"时,回调 onReturn(awaySec),用于触发巡检询问。
 */
export function startIdleWatcher(
  getWin: () => BrowserWindow | null,
  onReturn?: (awaySec: number) => void
): void {
  if (timer) return
  timer = setInterval(() => {
    const win = getWin()
    const idleSeconds = powerMonitor.getSystemIdleTime()
    const isAway = idleSeconds >= AWAY_THRESHOLD_SEC
    const state: IdleState = { idleSeconds, isAway }
    if (!win?.isDestroyed()) win?.webContents.send('idle:state', state)

    // 边沿:离开 -> 活跃(无法精确知道离开了多久,传阈值作为下限估计)
    if (wasAway && !isAway) {
      onReturn?.(AWAY_THRESHOLD_SEC)
    }
    wasAway = isAway
  }, POLL_INTERVAL_MS)
}

export function stopIdleWatcher(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  wasAway = false
}
