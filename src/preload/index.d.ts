import type { TaskRow } from '../shared/types'

export interface CompanionApi {
  setIgnoreMouse: (ignore: boolean) => void
  togglePanel: (expanded: boolean) => void
  hide: () => void

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

  onGreeting: (cb: (text: string) => void) => () => void
  onIdleState: (cb: (s: { idleSeconds: number; isAway: boolean }) => void) => () => void
  onReminder: (cb: (r: { kind: string; payload: string }) => void) => () => void
  onPatrolAsk: (cb: (r: { text: string; trigger: 'patrol' | 'return' }) => void) => () => void
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
