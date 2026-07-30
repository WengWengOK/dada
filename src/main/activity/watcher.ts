import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { profileGet, profileSet } from '../db'
import { addAppUsage, usageByDay, usageSummaryByProcess, usageTotal, type UsageAggregate } from '../db'

/** Windows 前台窗口采样器。
 *  - 首次探测用 execFileSync 快速确认可用性并做一次立即采样。
 *  - 后台常驻一个 PowerShell 子进程,每 INTERVAL_MS 输出一行 JSON(进程名+标题),避免频繁启子进程开销。
 *  - 非 Windows 平台(如 Linux 构建/测试)自动静默,什么也不做。
 *  - 关闭开关 / 脱敏 / 采样间隔 走 profile。
 */

const INTERVAL_MS_KEY = 'activity_interval_ms'
const ENABLE_KEY = 'activity_enabled'
const REDACT_KEY = 'activity_redact_title'

const DEFAULT_INTERVAL_MS = 3000

export function isEnabled(): boolean {
  return profileGet(ENABLE_KEY) !== '0'
}
export function setEnabled(v: boolean): void {
  profileSet(ENABLE_KEY, v ? '1' : '0')
  if (!v) stopWatcher()
  else startWatcher()
}

export function getIntervalMs(): number {
  const n = Number(profileGet(INTERVAL_MS_KEY))
  return n >= 1000 ? n : DEFAULT_INTERVAL_MS
}
export function setIntervalMs(ms: number): void {
  profileSet(INTERVAL_MS_KEY, String(Math.max(1000, Math.min(30000, ms))))
}

export function isRedactTitle(): boolean {
  return profileGet(REDACT_KEY) === '1'
}
export function setRedactTitle(v: boolean): void {
  profileSet(REDACT_KEY, v ? '1' : '0')
}

export interface Foreground {
  process: string
  title: string
  timestamp: number
}

let watcher: ChildProcess | null = null
let last: Foreground | null = null // (process, title, startTs) 合并成 timestamp=startTs

/** 立即一次采样。失败返回 null。仅用于启动时立刻拿一个锚点。 */
export function sampleOnce(): Foreground | null {
  if (process.platform !== 'win32') return null
  try {
    const raw = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public class W32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int mc);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
$h = [W32]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 1024
[W32]::GetWindowText($h, $sb, $sb.Capacity) | Out-Null
$pid = 0
[W32]::GetWindowThreadProcessId($h, [ref]$pid) | Out-Null
$proc = (Get-Process -Id $pid -ErrorAction SilentlyContinue).Name
[pscustomobject]@{process=$proc; title=$sb.ToString()} | ConvertTo-Json -Compress
`
      ],
      { timeout: 3000, windowsHide: true, encoding: 'utf8' }
    )
    const obj = JSON.parse(raw.trim())
    return {
      process: String(obj.process ?? 'unknown').toLowerCase(),
      title: String(obj.title ?? ''),
      timestamp: Date.now()
    }
  } catch {
    return null
  }
}

let parserBuf = ''

/** 启动常驻 watcher。非 Windows / 已禁用 时是 no-op。 */
export function startWatcher(): void {
  if (watcher) return
  if (!isEnabled()) return
  if (process.platform !== 'win32') return

  // 先采一次作为锚点
  last = sampleOnce()
  if (!last) last = { process: 'unknown', title: '', timestamp: Date.now() }

  const intervalSec = (getIntervalMs() / 1000).toFixed(1)

  // 常驻 PowerShell: 每 N 秒输出一个 JSON
  const script = `
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public class W32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int mc);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
while ($true) {
  $h = [W32]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder 1024
  [W32]::GetWindowText($h, $sb, $sb.Capacity) | Out-Null
  $pid = 0
  [W32]::GetWindowThreadProcessId($h, [ref]$pid) | Out-Null
  $proc = (Get-Process -Id $pid -ErrorAction SilentlyContinue).Name
  [pscustomobject]@{process=$proc; title=$sb.ToString()} | ConvertTo-Json -Compress
  Start-Sleep -Milliseconds ${intervalSec}000
}
`

  watcher = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore']
  })
  watcher.unref()

  parserBuf = ''
  watcher.stdout?.on('data', (chunk: Buffer) => {
    parserBuf += chunk.toString('utf8')
    let idx: number
    while ((idx = parserBuf.indexOf('\n')) !== -1) {
      const line = parserBuf.slice(0, idx).trim()
      parserBuf = parserBuf.slice(idx + 1)
      if (!line) continue
      try {
        const obj = JSON.parse(line)
        handleSample({
          process: String(obj.process ?? 'unknown').toLowerCase(),
          title: String(obj.title ?? ''),
          timestamp: Date.now()
        })
      } catch {
        // ignore malformed line
      }
    }
  })

  watcher.on('exit', () => {
    watcher = null
  })
}

export function stopWatcher(): void {
  // flush 当前段
  flushLast(Date.now())
  try {
    watcher?.kill()
  } catch {
    // ignore
  }
  watcher = null
}

function handleSample(cur: Foreground): void {
  if (!last) {
    last = cur
    return
  }
  if (cur.process === last.process && cur.title === last.title) {
    // 同一窗口,继续累加,不写库(等切换或 stop 时 flush)
    return
  }
  const now = cur.timestamp
  flushLast(now)
  last = { process: cur.process, title: cur.title, timestamp: now }
}

function flushLast(endTs: number): void {
  if (!last) return
  const dur = endTs - last.timestamp
  // 小于 2 秒的切换视为误采样,跳过
  if (dur >= 2000) {
    const title = isRedactTitle() ? '' : last.title
    addAppUsage(last.process, title, last.timestamp, endTs, dur)
  }
}

// ---------- 活动分类(学习/工作/摸鱼/其他) ----------

type Category = 'study' | 'work' | 'entertainment' | 'other'

export interface CategoryRule {
  category: Category
  match: (proc: string, title: string) => boolean
}

const RULES: CategoryRule[] = [
  // 学习
  {
    category: 'study',
    match: (proc, title) =>
      /anki|obsidian|notion|onenote|zotero|kindle|djvu|calibre|course|mooc|bilibili|yuque|xmind|marginnote/i.test(
        proc + ' ' + title
      ) ||
      /(学习|复习|考研|网课|高数|英语|算法|leetcode|题库|笔记|教程|课件|论文)/i.test(title)
  },
  // 工作 / 编码
  {
    category: 'work',
    match: (proc, title) =>
      /(code|devenv|idea|pycharm|clion|goland|webstorm|androidstudio|eclipse|vs|sublime|intellij|terminus|warp|powershell|cmd|git|docker|navicat|dbeaver|postman|apifox|figma|sketch|photoshop|illustrator|excel|word|powerpnt|wps|outlook|teams|feishu|dingtalk|enterprisewechat|todesk|xshell|putty|vscode)/i.test(
        proc
      )
  },
  // 娱乐 / 摸鱼
  {
    category: 'entertainment',
    match: (proc, title) =>
      /(wechat|qq|douyin|kuaishou|xiaohongshu|weibo|zhihu|bilibili|steam|epic|leagueclient|wegame|netease cloud music|qqmusic|kuwo|kugou|spotify|youtube|netflix)/i.test(
        proc
      ) ||
      /(抖音|B站|微博|小红书|微信|QQ|游戏|直播|番剧|综艺|电视剧|电影|视频|冲浪)/i.test(title)
  }
]

export function categorize(process: string, title: string): Category {
  for (const r of RULES) if (r.match(process, title)) return r.category
  return 'other'
}

export interface CategoryBreakdown {
  study: number
  work: number
  entertainment: number
  other: number
}

/** 按类别聚合(毫秒)。 */
export function usageByCategory(date?: string): CategoryBreakdown {
  const agg = usageByDay(date)
  const out: CategoryBreakdown = { study: 0, work: 0, entertainment: 0, other: 0 }
  for (const row of agg) {
    out[categorize(row.process, row.title)] += row.total_ms
  }
  return out
}

export { usageByDay, usageSummaryByProcess, usageTotal }
export type { UsageAggregate }
