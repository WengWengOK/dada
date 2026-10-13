import type { TaskRow } from '../shared/types'

export interface CompanionApi {
  setIgnoreMouse: (ignore: boolean) => void
  togglePanel: (expanded: boolean) => void
  hide: () => void
  moveWindow: (dx: number, dy: number) => void
  minimize: () => void
  resizeWindow: (dw: number, dh: number) => void
  log: (msg: string) => void

  getApiKey: () => Promise<string>
  setApiKey: (k: string) => Promise<void>
  getModel: () => Promise<string>
  setModel: (m: string) => Promise<void>

  listPersonas: () => Promise<{ id: string; name: string; emoji: string }[]>
  getPersona: () => Promise<string>
  setPersona: (id: string) => Promise<void>

  listTasks: () => Promise<TaskRow[]>
  addTask: (title: string, planMin: number) => Promise<TaskRow>
  completeTask: (id: number) => Promise<void>
  deleteTask: (id: number) => Promise<void>

  addMemory: (kind: string, content: string) => Promise<void>
  listMemories: () => Promise<{ kind: string; content: string }[]>

  addReminder: (ts: number, kind: string, payload: string) => Promise<void>

  sendChat: (text: string) => void
  onChatToken: (cb: (delta: string) => void) => () => void
  onChatDone: (cb: () => void) => () => void
  onChatError: (cb: (msg: string) => void) => () => void

  generateDaily: () => Promise<{ date: string; content: string }>

  parsePlan: (text: string) => Promise<{ title: string; plan_min: number }[]>

  getPatrolInterval: () => Promise<number>
  setPatrolInterval: (min: number) => Promise<void>

  setFocusing: (v: boolean) => void

  activitySettings: () => Promise<{
    enabled: boolean
    intervalMs: number
    redactTitle: boolean
  }>
  setActivityEnabled: (v: boolean) => Promise<void>
  setActivityInterval: (ms: number) => Promise<void>
  setActivityRedactTitle: (v: boolean) => Promise<void>
  activityByDay: (date?: string) => Promise<{ process: string; title: string; total_ms: number }[]>
  activitySummaryByProcess: (date?: string) => Promise<{ process: string; total_ms: number }[]>
  activityTotal: (date?: string) => Promise<number>
  activityCategory: (date?: string) => Promise<{
    study: number
    work: number
    entertainment: number
    other: number
  }>

  webByDay: (date?: string) => Promise<
    { domain: string; title: string; category: string; total_ms: number; total_visits: number }[]
  >
  webByCategory: (date?: string) => Promise<{
    study: number
    work: number
    social: number
    entertainment: number
    other: number
  }>
  webTotal: (date?: string) => Promise<number>
  webDetail: (date: string, domain: string) => Promise<
    { title: string; url: string; category: string; total_ms: number; total_visits: number }[]
  >
  webTrend: (days?: number) => Promise<
    { date: string; domain: string; category: string; total_ms: number }[]
  >
  activityTimeline: (date?: string) => Promise<
    { source: 'app' | 'web'; name: string; detail: string; category: string; start_ts: number; end_ts: number }[]
  >

  snapshotsRecent: (
    limit?: number,
    opts?: any
  ) => Promise<
    {
      id: number
      source: 'web' | 'app'
      domain: string
      title: string
      content: string
      category: string
      url: string
      process: string
      created_at: number
    }[]
  >
  snapshotsStats: (date?: string) => Promise<{
    study: number
    work: number
    entertainment: number
    other: number
  }>

  milestoneStats: () => Promise<{
    studyWorkMin: number
    funMin: number
    totalMin: number
    funRatio: number
  }>
  milestoneResetToday: () => Promise<void>
  bridgeInfo: () => Promise<{ enabled: boolean; port: number; url: string }>

  onGreeting: (cb: (text: string) => void) => () => void
  onWeatherAlert: (cb: (text: string) => void) => () => void
  onIdleState: (cb: (s: { idleSeconds: number; isAway: boolean }) => void) => () => void
  onReminder: (cb: (r: { kind: string; payload: string }) => void) => () => void
  onPatrolAsk: (
    cb: (r: { text: string; trigger: 'patrol' | 'return' | 'short' | 'hourly'; category?: string; hours?: number }) => void
  ) => () => void
  onMilestone: (
    cb: (r: {
      type: 'milestone' | 'encourage' | 'remind'
      level: 'info' | 'good' | 'great' | 'warn'
      minutes: number
      title: string
      message: string
      payload?: any
    }) => void
  ) => () => void
}

export interface TaskRow {
  id: number
  title: string
  status: string
  plan_min: number
  created_at: number
  done_at: number | null
}

declare global {
  interface Window {
    companion: CompanionApi
  }
}
