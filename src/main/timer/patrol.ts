import { BrowserWindow } from 'electron'
import { profileGet, profileSet, listTasks } from '../db'
import { getPersona } from '../llm/qwen'
import { PERSONAS } from '../llm/persona'
import { chatStream } from '../llm/qwen'
import { usageByDay, usageByCategory } from '../activity/watcher'

/**
 * 主动巡检:每隔一段时间由搭子主动询问用户进度/状态。
 * - 周期可配(默认 25 分钟),用绝对时间戳 + 偏移计算下一次,避免后台 throttling 漂移。
 * - 用户长时间离开后回归时立即询问一次(由 idle watcher 触发 onReturn)。
 * - 若没有 API Key,退化为本地预设问候。
 * - 不打扰专注中的番茄钟(由调用方传入 isFocusing 判断)。
 */

const DEFAULT_INTERVAL_MIN = 25
const AWAY_RETURN_THRESHOLD_SEC = 10 * 60 // 离开超过 10 分钟,回归时才询问
const TICK_MS = 30_000 // 30s 检查一次是否到点

let intervalTimer: NodeJS.Timeout | null = null
let nextPatrolTs = 0
let lastAskTs = 0
let isAsking = false

export function getPatrolIntervalMin(): number {
  const v = Number(profileGet('patrol_interval_min'))
  return v > 0 ? v : DEFAULT_INTERVAL_MIN
}

export function setPatrolIntervalMin(min: number): void {
  profileSet('patrol_interval_min', String(Math.max(5, Math.min(180, min))))
  resetNextPatrol()
}

function resetNextPatrol(): void {
  nextPatrolTs = Date.now() + getPatrolIntervalMin() * 60_000
}

export function startPatrol(getWin: () => BrowserWindow | null, isFocusing: () => boolean): void {
  if (intervalTimer) return
  resetNextPatrol()
  intervalTimer = setInterval(() => {
    if (isFocusing() || isAsking) return // 专注中不打扰
    if (Date.now() >= nextPatrolTs) {
      askPatrol(getWin(), 'patrol')
      nextPatrolTs = Date.now() + getPatrolIntervalMin() * 60_000
    }
  }, TICK_MS)
}

export function stopPatrol(): void {
  if (intervalTimer) {
    clearInterval(intervalTimer)
    intervalTimer = null
  }
}

/** 用户离开很久后回归,立即问一次(由 idle watcher 调用)。 */
export function onUserReturn(getWin: () => BrowserWindow | null, wasAwaySec: number): void {
  if (wasAwaySec < AWAY_RETURN_THRESHOLD_SEC) return
  if (isAsking) return
  askPatrol(getWin(), 'return', wasAwaySec)
}

async function askPatrol(
  win: BrowserWindow | null,
  trigger: 'patrol' | 'return',
  awaySec?: number
): Promise<void> {
  if (!win || win.isDestroyed()) return
  isAsking = true
  lastAskTs = Date.now()

  const persona = PERSONAS[getPersona()]
  const tasks = listTasks()
  const pending = tasks.filter((t) => t.status === 'todo').map((t) => t.title)

  // 今日最近使用 Top 3(近3小时以上占比) -- 给上下文让搭子知道用户在干嘛
  const topToday = usageByDay().slice(0, 3)
  const catToday = usageByCategory()
  const total = catToday.study + catToday.work + catToday.entertainment + catToday.other
  const funRatio = total > 0 ? catToday.entertainment / total : 0
  const topDesc = topToday
    .map((r) => `${r.process}${r.title ? `(${r.title.slice(0, 20)})` : ''}`)
    .join('、')

  let text: string
  if (profileGet('qwen_api_key')) {
    const context =
      trigger === 'return'
        ? `用户刚离开了 ${Math.round((awaySec ?? 0) / 60)} 分钟回来。待办:${pending.join('、') || '无'}。今日用得最多:${topDesc || '无记录'}。娱乐占比:${Math.round(funRatio * 100)}%。`
        : `用户已学习/工作一段时间。待办:${pending.join('、') || '无'}。今日用得最多:${topDesc || '无记录'}。娱乐占比:${Math.round(funRatio * 100)}%。如果娱乐占比高,可以温柔地说收收心;如果学习/工作多,可以夸。`
    const prompt = `你正在主动关心用户。${context}用你的人格(${persona.name})简短问一句关心用户状态的话,贴合他刚才在用的软件/或提醒回正事。不超过45字,中文,不要用 markdown。`
    try {
      text = await collectStream(prompt)
    } catch {
      text = fallbackAsk(trigger, awaySec, funRatio)
    }
  } else {
    text = fallbackAsk(trigger, awaySec, funRatio)
  }

  win.webContents.send('patrol:ask', { text, trigger })
  isAsking = false
}

function collectStream(prompt: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let full = ''
    chatStream(prompt, (d) => (full += d))
      .then(() => resolve(full.trim()))
      .catch(reject)
  })
}

function fallbackAsk(trigger: 'patrol' | 'return', awaySec?: number, funRatio = 0): string {
  if (trigger === 'return') {
    return `你离开了 ${Math.round((awaySec ?? 0) / 60)} 分钟,休息好些了吗?要继续的话我在哦~`
  }
  if (funRatio > 0.5) {
    return '嗨,刚才是不是刷了会儿?差不多了就回正事上来,我给你加油~'
  }
  const picks = ['进度怎么样啦?还顺利吗?', '要不要喝口水休息一下?', '卡住了吗?需要换换脑子吗?']
  return picks[Math.floor(Math.random() * picks.length)]
}

export function getLastAskTs(): number {
  return lastAskTs
}
