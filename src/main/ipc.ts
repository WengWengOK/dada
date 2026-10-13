import { ipcMain, BrowserWindow } from 'electron'
import { getMainWindow, setIgnoreMouseEvents, togglePanel, moveWindow, minimizeWindow, resizeWindow } from './window'

// 渲染端日志转发到主进程终端(排查渲染端行为用)
ipcMain.on('log', (_e, msg: unknown) => {
  console.log('[renderer]', msg)
})
import {
  listTasks,
  addTask,
  completeTask,
  deleteTask,
  saveDailyReport,
  addMemory,
  recentMemories,
  recentChat
} from './db'
import {
  getApiKey,
  setApiKey,
  getModel,
  setModel,
  getPersona,
  setPersona,
  chatStream,
  chatOnce,
  planTasks,
  type PlannedTask
} from './llm/qwen'
import { PERSONAS, type PersonaId } from './llm/persona'
import { scheduleReminder } from './timer/scheduler'
import {
  getPatrolIntervalMin,
  setPatrolIntervalMin
} from './timer/patrol'
import {
  isEnabled as activityEnabled,
  setEnabled as setActivityEnabled,
  getIntervalMs,
  setIntervalMs,
  isRedactTitle,
  setRedactTitle,
  usageByDay,
  usageSummaryByProcess,
  usageTotal,
  usageByCategory,
  type UsageAggregate
} from './activity/watcher'
import {
  webUsageByDay,
  webUsageByCategory,
  webUsageTotal,
  recentSnapshots,
  snapshotStatsByCategory,
  webUsageDetail,
  webUsageTrend,
  activityTimeline,
  type WebUsageAggregate,
  type SnapshotRow
} from './db'
import {
  getCombinedStats,
  resetMilestonesToday
} from './milestone'
import { getBridgePort, isBridgeEnabled } from './bridge-server'

export function registerIpc(): void {
  // ---------- 窗口 ----------
  ipcMain.on('window:set-ignore-mouse', (_e, ignore: boolean) => setIgnoreMouseEvents(ignore))
  ipcMain.on('window:toggle-panel', (_e, expanded: boolean) => togglePanel(expanded))
  ipcMain.on('window:hide', () => getMainWindow()?.hide())
  ipcMain.on('window:move', (_e, dx: number, dy: number) => moveWindow(dx, dy))
  ipcMain.on('window:minimize', () => minimizeWindow())
  ipcMain.on('window:resize', (_e, dw: number, dh: number) => resizeWindow(dw, dh))

  // ---------- 设置 ----------
  ipcMain.handle('settings:get-api-key', () => getApiKey())
  ipcMain.handle('settings:set-api-key', (_e, key: string) => setApiKey(key))
  ipcMain.handle('settings:get-model', () => getModel())
  ipcMain.handle('settings:set-model', (_e, m: string) => setModel(m))

  // ---------- 人格 ----------
  ipcMain.handle('persona:list', () =>
    (Object.keys(PERSONAS) as PersonaId[]).map((id) => ({
      id,
      name: PERSONAS[id].name,
      emoji: PERSONAS[id].emoji
    }))
  )
  ipcMain.handle('persona:get', () => getPersona())
  ipcMain.handle('persona:set', (_e, id: PersonaId) => setPersona(id))

  // ---------- 任务 ----------
  ipcMain.handle('tasks:list', () => listTasks())
  ipcMain.handle('tasks:add', (_e, title: string, planMin: number) => addTask(title, planMin))
  ipcMain.handle('tasks:complete', (_e, id: number) => completeTask(id))
  ipcMain.handle('tasks:delete', (_e, id: number) => deleteTask(id))

  // ---------- 记忆 ----------
  ipcMain.handle('memory:add', (_e, kind: string, content: string) => addMemory(kind, content))
  ipcMain.handle('memory:list', () => recentMemories(20))

  // ---------- 提醒 ----------
  ipcMain.handle('reminder:add', (_e, ts: number, kind: string, payload: string) =>
    scheduleReminder(ts, kind, payload)
  )

  // ---------- 对话(流式) ----------
  // 渲染进程发 'chat:send',主进程逐 token 回推 'chat:token',结束推 'chat:done' / 'chat:error'
  ipcMain.on('chat:send', async (e, text: string) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? getMainWindow()
    try {
      await chatStream(text, (delta) => {
        if (!win?.isDestroyed()) win?.webContents.send('chat:token', delta)
      })
      win?.webContents.send('chat:done')
    } catch (err) {
      win?.webContents.send('chat:error', (err as Error).message)
    }
  })

  // ---------- 每日日记 ----------
  ipcMain.handle('daily:generate', async () => {
    return generateDailyReport()
  })

  // ---------- 计划自然语言拆解 ----------
  // 返回拆解后的任务列表(不自动入库,由渲染层确认后再批量 addTask)
  ipcMain.handle('plan:parse', async (_e, text: string): Promise<PlannedTask[]> => {
    if (!text?.trim()) return []
    return planTasks(text.trim())
  })

  // ---------- 巡检间隔配置 ----------
  ipcMain.handle('patrol:get-interval', () => getPatrolIntervalMin())
  ipcMain.handle('patrol:set-interval', (_e, min: number) => setPatrolIntervalMin(min))

  // ---------- 活动/窗口使用统计 ----------
  ipcMain.handle('activity:settings', () => ({
    enabled: activityEnabled(),
    intervalMs: getIntervalMs(),
    redactTitle: isRedactTitle()
  }))
  ipcMain.handle('activity:set-enabled', (_e, v: boolean) => setActivityEnabled(v))
  ipcMain.handle('activity:set-interval', (_e, ms: number) => setIntervalMs(ms))
  ipcMain.handle('activity:set-redact-title', (_e, v: boolean) => setRedactTitle(v))
  ipcMain.handle('activity:by-day', (_e, date?: string) => usageByDay(date) as UsageAggregate[])
  ipcMain.handle('activity:summary-by-process', (_e, date?: string) =>
    usageSummaryByProcess(date)
  )
  ipcMain.handle('activity:total', (_e, date?: string) => usageTotal(date))
  ipcMain.handle('activity:category', (_e, date?: string) => usageByCategory(date))
  ipcMain.handle('activity:timeline', (_e, date?: string) => activityTimeline(date))

  // ---------- 浏览器网页时长 + 快照 + 里程碑 ----------
  ipcMain.handle('web:by-day', (_e, date?: string) => webUsageByDay(date) as WebUsageAggregate[])
  ipcMain.handle('web:by-category', (_e, date?: string) => webUsageByCategory(date))
  ipcMain.handle('web:total', (_e, date?: string) => webUsageTotal(date))
  ipcMain.handle('web:detail', (_e, date: string, domain: string) =>
    webUsageDetail(date, domain)
  )
  ipcMain.handle('web:trend', (_e, days = 7) => webUsageTrend(days))
  ipcMain.handle('snapshots:recent', (_e, limit = 20, opts?: any) =>
    recentSnapshots(limit, opts as any) as SnapshotRow[]
  )
  ipcMain.handle('snapshots:stats', (_e, date?: string) => snapshotStatsByCategory(date))
  ipcMain.handle('milestone:stats', () => getCombinedStats())
  ipcMain.handle('milestone:reset-today', () => resetMilestonesToday())
  ipcMain.handle('bridge:info', () => ({
    enabled: isBridgeEnabled(),
    port: getBridgePort(),
    url: `http://127.0.0.1:${getBridgePort()}`
  }))
}

async function generateDailyReport(): Promise<{ date: string; content: string }> {
  const tasks = listTasks()
  const doneTasks = tasks.filter((t) => t.status === 'done')
  const recent = recentChat(30)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n')

  // 活动数据:Top 应用 + 类别分解
  const top = usageByDay().slice(0, 8)
  const category = usageByCategory()
  const total = usageTotal()

  const topStr = top
    .map((r, i) => `${i + 1}. [${r.process}] ${r.title || '—'} · ${fmtMs(r.total_ms)}`)
    .join('\n')
  const catStr = `学习 ${fmtMs(category.study)} · 工作 ${fmtMs(category.work)} · 娱乐 ${fmtMs(
    category.entertainment
  )} · 其他 ${fmtMs(category.other)}`

  const summary = `
[任务] 共 ${tasks.length} 个,完成 ${doneTasks.length} 个。
完成项:${doneTasks.map((t) => t.title).join('、') || '无'}
[活动] 总活跃 ${fmtMs(total)}
  分类:${catStr}
  Top 应用:
${topStr || '  无数据'}
[对话摘要]
${recent.slice(-1000)}
`.trim()

  const date = new Date().toISOString().slice(0, 10)

  let content: string
  if (getApiKey()) {
    try {
      content = await chatOnce(
        `你是用户的桌面搭子,用你的人格写今日综合进展点评:先肯定今天(必须基于上面活动数据具体夸,不空泛),再说可以优化的小点(如果娱乐占比高,温柔提醒别太沉迷,不要指责),再给明天一条小建议。中文,180字内,不要 markdown。`,
        summary
      )
    } catch {
      content = fallbackReport(doneTasks.length, tasks.length, total, category)
    }
  } else {
    content = fallbackReport(doneTasks.length, tasks.length, total, category)
  }

  saveDailyReport(date, content)
  return { date, content }
}

function fmtMs(ms: number): string {
  if (ms <= 0) return '0分'
  const total = Math.round(ms / 60000)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m}分`
  if (m === 0) return `${h}时`
  return `${h}时${m}分`
}

function fallbackReport(
  done: number,
  total: number,
  activeMs: number,
  cat: { study: number; work: number; entertainment: number; other: number }
): string {
  const ratio = total > 0 ? done / total : 0
  const study = Math.round((cat.study + cat.work) / 60000)
  const fun = Math.round(cat.entertainment / 60000)
  const active = Math.round(activeMs / 60000)
  let mood = '一般'
  if (ratio >= 0.8) mood = '超棒'
  else if (ratio >= 0.5) mood = '不错'
  else if (ratio === 0 && total > 0) mood = '今天有点摸鱼哦'
  return `今天完成 ${done}/${total} 个任务,状态:${mood}。
活跃 ${active} 分钟,学习/工作 ${study} 分,娱乐 ${fun} 分。
辛苦啦,明天加油!`
}
