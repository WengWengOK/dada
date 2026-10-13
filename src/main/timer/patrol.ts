import { BrowserWindow } from 'electron'
import { profileGet, profileSet, listTasks } from '../db'
import { getPersona } from '../llm/qwen'
import { PERSONAS } from '../llm/persona'
import { chatStream } from '../llm/qwen'
import { usageByDay, usageByCategory, getCurrentForeground, categorize } from '../activity/watcher'

/**
 * 主动巡检:每隔一段时间由搭子主动询问用户进度/状态。
 * - 周期可配(默认 25 分钟),用绝对时间戳 + 偏移计算下一次,避免后台 throttling 漂移。
 * - 用户长时间离开后回归时立即询问一次(由 idle watcher 触发 onReturn)。
 * - 若没有 API Key,退化为本地预设问候。
 * - 不打扰专注中的番茄钟(由调用方传入 isFocusing 判断)。
 *
 * 主动鼓励(行为感知,本地模板,不耗 LLM):
 * - 短鼓励: 每 2 分钟按当前前台窗口分类弹一句(学习/工作加油,摸鱼提醒),只弹气泡不打断。
 * - 阶段鼓励: 今日累计专注(学习+工作)每满 1 小时弹一次"非常棒",并展开面板。
 */

const DEFAULT_INTERVAL_MIN = 25
const AWAY_RETURN_THRESHOLD_SEC = 10 * 60 // 离开超过 10 分钟,回归时才询问
const TICK_MS = 30_000 // 30s 检查一次是否到点
const SHORT_ENCOURAGE_MS = 2 * 60 * 1000 // 短鼓励间隔: 2 分钟

let intervalTimer: NodeJS.Timeout | null = null
let nextPatrolTs = 0
let lastAskTs = 0
let isAsking = false
let lastShortTs = 0
let hourlyLevel = 0 // 已提示过的累计专注小时档位(持久化,避免重启重复提示)

// ---------- 短鼓励文案库(本地模板,轮换) ----------
const SHORT_STUDY = [
  '加油学习,继续努力!你正在一点点变强。',
  '认真学习的样子最好看,保持这个节奏!',
  '又推进了一步,今天的你在闪闪发光。',
  '坚持就是胜利,再往前一点点就到终点了。',
  '知识在悄悄积累,相信坚持的力量!'
]
const SHORT_WORK = [
  '工作很投入,效率稳稳的,继续加油!',
  '专注的时光最有价值,保持住状态!',
  '干活的样子很棒,稳住节奏,别太累。'
]
const SHORT_FUN = [
  '刷了好一会儿啦,起来活动活动,别忘了待办哦~',
  '休息可以,但别让摸鱼偷走今天的计划呀~',
  '看完这个就去学习吧,我一直在这里等你!'
]
const SHORT_OTHER = [
  '嗨,不管在忙什么,记得劳逸结合哦~',
  '在忙什么呢?需要帮忙随时叫我~',
  '记得起来活动一下,喝口水,继续加油!'
]

function pickShortText(cat: string): string | null {
  let pool: string[]
  if (cat === 'study') pool = SHORT_STUDY
  else if (cat === 'work') pool = SHORT_WORK
  else if (cat === 'entertainment') pool = SHORT_FUN
  else pool = SHORT_OTHER // 未识别窗口也给温和提醒,保证 2 分钟必有反馈
  return pool[Math.floor(Math.random() * pool.length)]
}

function loadHourlyLevel(): void {
  const v = Number(profileGet('hourly_encourage_level'))
  hourlyLevel = Number.isFinite(v) && v >= 0 ? v : 0
}

function saveHourlyLevel(): void {
  profileSet('hourly_encourage_level', String(hourlyLevel))
}

/** 短鼓励: 按当前前台窗口分类弹一句(只弹气泡,不展开面板) */
function sendShortEncourage(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  if (profileGet('short_encourage_enabled') === '0') return
  const fg = getCurrentForeground()
  const cat = fg ? categorize(fg.process, fg.title) : 'other'
  const text = pickShortText(cat)
  // 开发期日志,便于确认链路
  console.log(`[patrol] short encourage cat=${cat} win=${fg?.process ?? 'none'} text=${text}`)
  win.webContents.send('patrol:ask', { text, trigger: 'short', category: cat })
}

/** 阶段鼓励: 今日累计专注(学习+工作)每满 1 小时提示一次 */
function tryHourlyEncourage(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return
  if (profileGet('hourly_encourage_enabled') === '0') return
  const cat = usageByCategory()
  const focusMin = Math.floor((cat.study + cat.work) / 60_000)
  const level = Math.floor(focusMin / 60)
  if (level >= 1 && level > hourlyLevel) {
    hourlyLevel = level
    saveHourlyLevel()
    const text = `非常棒!你今天已经专注学习/工作 ${level} 个小时了,给自己一点掌声吧!`
    win.webContents.send('patrol:ask', { text, trigger: 'hourly', hours: level })
  }
}

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
  loadHourlyLevel()
  lastShortTs = Date.now()
  intervalTimer = setInterval(() => {
    if (isFocusing() || isAsking) return // 专注中不打扰
    const now = Date.now()
    // 短鼓励: 每 2 分钟一次
    if (now - lastShortTs >= SHORT_ENCOURAGE_MS) {
      lastShortTs = now
      sendShortEncourage(getWin())
    }
    // 阶段鼓励: 累计专注每满 1 小时
    tryHourlyEncourage(getWin())
    // 原巡检询问
    if (now >= nextPatrolTs) {
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
