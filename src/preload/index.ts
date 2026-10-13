import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // 窗口
  setIgnoreMouse: (ignore: boolean) => ipcRenderer.send('window:set-ignore-mouse', ignore),
  togglePanel: (expanded: boolean) => ipcRenderer.send('window:toggle-panel', expanded),
  hide: () => ipcRenderer.send('window:hide'),
  moveWindow: (dx: number, dy: number) => ipcRenderer.send('window:move', dx, dy),
  minimize: () => ipcRenderer.send('window:minimize'),
  resizeWindow: (dw: number, dh: number) => ipcRenderer.send('window:resize', dw, dh),

  // 渲染端日志(转发到主进程终端, 排查用)
  log: (msg: string) => ipcRenderer.send('log', msg),

  // 设置
  getApiKey: () => ipcRenderer.invoke('settings:get-api-key'),
  setApiKey: (k: string) => ipcRenderer.invoke('settings:set-api-key', k),
  getModel: () => ipcRenderer.invoke('settings:get-model'),
  setModel: (m: string) => ipcRenderer.invoke('settings:set-model', m),

  // 人格
  listPersonas: () => ipcRenderer.invoke('persona:list'),
  getPersona: () => ipcRenderer.invoke('persona:get'),
  setPersona: (id: string) => ipcRenderer.invoke('persona:set', id),

  // 任务
  listTasks: () => ipcRenderer.invoke('tasks:list'),
  addTask: (title: string, planMin: number) => ipcRenderer.invoke('tasks:add', title, planMin),
  completeTask: (id: number) => ipcRenderer.invoke('tasks:complete', id),
  deleteTask: (id: number) => ipcRenderer.invoke('tasks:delete', id),

  // 记忆
  addMemory: (kind: string, content: string) => ipcRenderer.invoke('memory:add', kind, content),
  listMemories: () => ipcRenderer.invoke('memory:list'),

  // 提醒
  addReminder: (ts: number, kind: string, payload: string) =>
    ipcRenderer.invoke('reminder:add', ts, kind, payload),

  // 对话(流式)
  sendChat: (text: string) => ipcRenderer.send('chat:send', text),
  onChatToken: (cb: (delta: string) => void) => {
    const h = (_e: unknown, delta: string) => cb(delta)
    ipcRenderer.on('chat:token', h)
    return () => ipcRenderer.off('chat:token', h)
  },
  onChatDone: (cb: () => void) => {
    const h = () => cb()
    ipcRenderer.on('chat:done', h)
    return () => ipcRenderer.off('chat:done', h)
  },
  onChatError: (cb: (msg: string) => void) => {
    const h = (_e: unknown, msg: string) => cb(msg)
    ipcRenderer.on('chat:error', h)
    return () => ipcRenderer.off('chat:error', h)
  },

  // 日记
  generateDaily: () => ipcRenderer.invoke('daily:generate'),

  // 计划自然语言拆解
  parsePlan: (text: string) => ipcRenderer.invoke('plan:parse', text),

  // 巡检间隔
  getPatrolInterval: () => ipcRenderer.invoke('patrol:get-interval'),
  setPatrolInterval: (min: number) => ipcRenderer.invoke('patrol:set-interval', min),

  // 番茄钟专注状态上报(主进程据此跳过巡检打扰)
  setFocusing: (v: boolean) => ipcRenderer.send('focus:set', v),

  // 活动/窗口使用统计
  activitySettings: () => ipcRenderer.invoke('activity:settings'),
  setActivityEnabled: (v: boolean) => ipcRenderer.invoke('activity:set-enabled', v),
  setActivityInterval: (ms: number) => ipcRenderer.invoke('activity:set-interval', ms),
  setActivityRedactTitle: (v: boolean) => ipcRenderer.invoke('activity:set-redact-title', v),
  activityByDay: (date?: string) => ipcRenderer.invoke('activity:by-day', date),
  activitySummaryByProcess: (date?: string) => ipcRenderer.invoke('activity:summary-by-process', date),
  activityTotal: (date?: string) => ipcRenderer.invoke('activity:total', date),
  activityCategory: (date?: string) => ipcRenderer.invoke('activity:category', date),
  activityTimeline: (date?: string) => ipcRenderer.invoke('activity:timeline', date),

  // 浏览器网页时长(插件上报)
  webByDay: (date?: string) => ipcRenderer.invoke('web:by-day', date),
  webByCategory: (date?: string) => ipcRenderer.invoke('web:by-category', date),
  webTotal: (date?: string) => ipcRenderer.invoke('web:total', date),
  webDetail: (date: string, domain: string) => ipcRenderer.invoke('web:detail', date, domain),
  webTrend: (days?: number) => ipcRenderer.invoke('web:trend', days),

  // 学习内容快照
  snapshotsRecent: (limit?: number, opts?: any) => ipcRenderer.invoke('snapshots:recent', limit, opts),
  snapshotsStats: (date?: string) => ipcRenderer.invoke('snapshots:stats', date),

  // 里程碑 + 桥接
  milestoneStats: () => ipcRenderer.invoke('milestone:stats'),
  milestoneResetToday: () => ipcRenderer.invoke('milestone:reset-today'),
  bridgeInfo: () => ipcRenderer.invoke('bridge:info'),

  // 事件订阅
  onGreeting: (cb: (text: string) => void) => {
    const h = (_e: unknown, text: string) => cb(text)
    ipcRenderer.on('greeting', h)
    return () => ipcRenderer.off('greeting', h)
  },
  // 天气降水提醒(搭子冒泡)
  onWeatherAlert: (cb: (text: string) => void) => {
    const h = (_e: unknown, text: string) => cb(text)
    ipcRenderer.on('weather-alert', h)
    return () => ipcRenderer.off('weather-alert', h)
  },
  onIdleState: (cb: (s: { idleSeconds: number; isAway: boolean }) => void) => {
    const h = (_e: unknown, s: { idleSeconds: number; isAway: boolean }) => cb(s)
    ipcRenderer.on('idle:state', h)
    return () => ipcRenderer.off('idle:state', h)
  },
  onReminder: (cb: (r: { kind: string; payload: string }) => void) => {
    const h = (_e: unknown, r: { kind: string; payload: string }) => cb(r)
    ipcRenderer.on('reminder:fire', h)
    return () => ipcRenderer.off('reminder:fire', h)
  },
  // 搭子主动巡检询问(由主进程巡检模块触发)
  onPatrolAsk: (cb: (r: { text: string; trigger: 'patrol' | 'return' }) => void) => {
    const h = (_e: unknown, r: { text: string; trigger: 'patrol' | 'return' }) => cb(r)
    ipcRenderer.on('patrol:ask', h)
    return () => ipcRenderer.off('patrol:ask', h)
  },
  // 里程碑达成: 气泡显示鼓励
  onMilestone: (
    cb: (r: {
      type: 'milestone' | 'encourage' | 'remind'
      level: 'info' | 'good' | 'great' | 'warn'
      minutes: number
      title: string
      message: string
      payload?: any
    }) => void
  ) => {
    const h = (_e: unknown, r: any) => cb(r)
    ipcRenderer.on('milestone:hit', h)
    return () => ipcRenderer.off('milestone:hit', h)
  }
}

export type CompanionApi = typeof api

contextBridge.exposeInMainWorld('companion', api);

// #region debug-point H5:preload-expose
;(() => {
  try {
    const p = 'http://127.0.0.1:7777/event'
    const body = JSON.stringify({
      sessionId: 'companion-ui-bug',
      runId: 'pre',
      hypothesisId: 'H5',
      location: 'src/preload/index.ts:exposeInMainWorld',
      msg: '[DEBUG] Preload window.companion exposed OK',
      data: {
        // 检查关键 API 是否挂上去了
        setIgnoreMouse: typeof (api as any).setIgnoreMouse,
        togglePanel: typeof (api as any).togglePanel,
        hide: typeof (api as any).hide,
        sendChat: typeof (api as any).sendChat,
        onMilestone: typeof (api as any).onMilestone,
        apiKeysCount: Object.keys(api).length
      },
      ts: Date.now()
    })
    const xhr = new (globalThis as any).XMLHttpRequest()
    xhr.open('POST', p, true)
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.onreadystatechange = () => { /* fire and forget */ }
    try { xhr.send(body) } catch { /* ignore */ }
  } catch { /* ignore */ }
})()
// #endregion
