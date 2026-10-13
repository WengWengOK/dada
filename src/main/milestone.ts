import { profileGet, profileSet } from './db'
import { webUsageByCategory } from './db'
import { usageByCategory as appUsageByCategory } from './activity/watcher'

/**
 * 学习里程碑检测:
 *  - 学习/工作累计时长达到阈值(30min, 1h, 2h, 3h, 4h, 6h)
 *  - 连续专注达到 25min / 50min
 *  - 娱乐占比过高(>60%)时温柔提醒
 *  - 每次只触发一次,用 profile 记录当天已触发的里程碑,避免重复弹
 */

export interface MilestoneEvent {
  type: 'milestone' | 'encourage' | 'remind'
  level: 'info' | 'good' | 'great' | 'warn'
  minutes: number // 学习+工作分钟数
  title: string // 简短标题,如 "学习30分钟达成"
  message: string // 给搭子展示的鼓励文案
  payload?: any
}

const KEY_TRIGGERED = 'milestone_triggered' // JSON: { [date]: { [key]: true } }

const DURATION_MILESTONES_MIN = [30, 60, 120, 180, 240, 360]

/** 合并 web + app 学习时长(毫秒) */
function combinedStudyWorkMs(): {
  study: number
  work: number
  entertainment: number
  social: number
  other: number
  total: number
  studyWork: number
} {
  const w = webUsageByCategory()
  const a = appUsageByCategory()
  const study = w.study + a.study
  const work = w.work + a.work
  const entertainment = w.entertainment + a.entertainment
  const social = w.social
  const other = w.other + a.other
  const total = study + work + entertainment + social + other
  return { study, work, entertainment, social, other, total, studyWork: study + work }
}

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getTriggeredMap(): Record<string, Record<string, boolean>> {
  try {
    const raw = profileGet(KEY_TRIGGERED)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveTriggeredMap(m: Record<string, Record<string, boolean>>): void {
  try {
    // 只保留最近 7 天,防止无限增长
    const keys = Object.keys(m).sort().slice(-7)
    const trimmed: typeof m = {}
    for (const k of keys) trimmed[k] = m[k]
    profileSet(KEY_TRIGGERED, JSON.stringify(trimmed))
  } catch {
    // ignore
  }
}

function markTriggered(key: string): void {
  const m = getTriggeredMap()
  const d = todayKey()
  if (!m[d]) m[d] = {}
  m[d][key] = true
  saveTriggeredMap(m)
}

function isTriggered(key: string): boolean {
  const m = getTriggeredMap()
  return !!m[todayKey()]?.[key]
}

/** 取最接近但不超过当前分钟数的里程碑档位 */
function pickMilestone(totalMinutes: number): { min: number; key: string } | null {
  for (let i = DURATION_MILESTONES_MIN.length - 1; i >= 0; i--) {
    const m = DURATION_MILESTONES_MIN[i]
    if (totalMinutes >= m) {
      return { min: m, key: `duration_${m}` }
    }
  }
  return null
}

/** 依据里程碑档位生成鼓励文案(本地模板,不依赖 LLM,保证立即响应) */
function encourageMessage(_totalMinutes: number, levelMin: number): { title: string; message: string } {
  const h = Math.floor(levelMin / 60)
  const m = levelMin % 60
  const label = h > 0 ? (m > 0 ? `${h}小时${m}分` : `${h}小时`) : `${m}分钟`

  // 分级鼓励,由轻到重
  const templates: Record<number, { title: string; msgs: string[] }> = {
    30: {
      title: `学习 ${label} 达成 🎉`,
      msgs: [
        `哇,已经专注 ${label} 啦,好棒!继续保持哦~`,
        ` ${label} 了!进入状态了吧,加油加油!`,
        `不错哦,刚 ${label} 就有成果啦,奖励自己喝口水?`
      ]
    },
    60: {
      title: `学习 ${label} 达成 ⭐`,
      msgs: [
        `满 ${label} 啦!今天很投入呢,继续冲鸭~`,
        `一小时达成!效率不错,继续保持这个节奏!`,
        ` ${label} 打卡成功!你比昨天的自己又近了一步!`
      ]
    },
    120: {
      title: `学习 ${label} 达成 🔥`,
      msgs: [
        `天呐,已经 ${label} 了!你太拼啦,记得偶尔站起来走走哦~`,
        `两小时专注,真的超有毅力!累的话就小憩一下吧。`,
        `${label} 了!进度条在疯狂前进,冲!`
      ]
    },
    180: {
      title: `学习 ${label} 达成 💪`,
      msgs: [
        `${label}!你真的好认真,我都被你感染啦!`,
        `三小时了!你是专注超人吧,继续发光发热!`,
        `${label} 了,今天肯定收获满满吧,为你骄傲!`
      ]
    },
    240: {
      title: `学习 ${label} 达成 🏆`,
      msgs: [
        ` ${label}!超强输出日,今天的你超帅超漂亮!`,
        `四小时专注达成!必须夸夸你,今晚加餐!`,
        `${label} 了,今天效率封神了吧,牛的!`
      ]
    },
    360: {
      title: `学习 ${label} 达成 👑`,
      msgs: [
        `${label}!你今天真的拼了,注意身体啊我的宝!`,
        `六个小时!你就是学习战神,给我狠狠地休息!`,
        `${label} 达成!你是我见过最自律的人,respect!`
      ]
    }
  }

  const tpl = templates[levelMin] || templates[30]
  const msg = tpl.msgs[Math.floor(Math.random() * tpl.msgs.length)]
  return { title: tpl.title, message: msg.replace('${label}', label) }
}

/** 娱乐占比过高提醒 */
function remindMessage(funRatio: number): { title: string; message: string } | null {
  if (funRatio < 0.6) return null
  // 只在娱乐累计 >= 20 分钟且学习/工作 < 10 分钟时提醒,避免误触发
  return {
    title: '休息够啦?',
    message: funRatio > 0.8
      ? '刚刷了挺久啦,要不要回到正事上?我给你加油哦~'
      : '差不多啦,回来学习一下吧,就 10 分钟也行~'
  }
}

/**
 * 检查是否达到里程碑。返回要推送的事件,未触发返回 null。
 * 由 bridge-server / patrol / scheduler 等在写入数据后调用。
 */
export function checkMilestone(): MilestoneEvent | null {
  const c = combinedStudyWorkMs()
  const total = c.total
  const studyWork = c.studyWork
  const mins = Math.round(studyWork / 60000)

  // 1. 累计时长里程碑
  const ms = pickMilestone(mins)
  if (ms && !isTriggered(ms.key)) {
    markTriggered(ms.key)
    const { title, message } = encourageMessage(mins, ms.min)
    return {
      type: 'milestone',
      level: ms.min >= 180 ? 'great' : 'good',
      minutes: mins,
      title,
      message
    }
  }

  // 2. 娱乐占比提醒(每天最多一次)
  const funRatio = total > 0 ? c.entertainment / total : 0
  const funMins = Math.round(c.entertainment / 60000)
  if (funMins >= 20 && mins < 10) {
    const r = remindMessage(funRatio)
    if (r && !isTriggered('fun_remind')) {
      markTriggered('fun_remind')
      return {
        type: 'remind',
        level: 'warn',
        minutes: mins,
        title: r.title,
        message: r.message,
        payload: { funRatio: Math.round(funRatio * 100) }
      }
    }
  }

  // 3. 开启学习的小鼓励(第一次进入 study>=5min)
  if (mins >= 5 && !isTriggered('first_study_5')) {
    markTriggered('first_study_5')
    return {
      type: 'encourage',
      level: 'info',
      minutes: mins,
      title: '进入状态啦',
      message: '开始学习啦,棒棒!保持这个节奏,你可以的~'
    }
  }

  return null
}

/** 对外暴露: 手动获取组合统计供 UI 使用 */
export function getCombinedStats(): {
  studyWorkMin: number
  funMin: number
  totalMin: number
  funRatio: number
} {
  const c = combinedStudyWorkMs()
  const totalMin = Math.round(c.total / 60000)
  return {
    studyWorkMin: Math.round(c.studyWork / 60000),
    funMin: Math.round(c.entertainment / 60000),
    totalMin,
    funRatio: c.total > 0 ? c.entertainment / c.total : 0
  }
}

/** 调试用: 重置今日已触发里程碑 */
export function resetMilestonesToday(): void {
  const m = getTriggeredMap()
  const d = todayKey()
  delete m[d]
  saveTriggeredMap(m)
}
