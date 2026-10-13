import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { BrowserWindow } from 'electron'
import {
  addWebUsage,
  addSnapshot,
  webUsageTotal,
  webUsageByCategory,
  profileGet
} from './db'
import {
  usageByCategory as appUsageByCategory,
  usageTotal as appUsageTotal
} from './activity/watcher'
import { checkMilestone, type MilestoneEvent } from './milestone'

/**
 * 浏览器插件 <-> Electron 桌面端 本地桥接 HTTP 服务。
 * 浏览器插件通过 http://127.0.0.1:<PORT> 把网页时长/快照数据上报过来。
 * 端口默认 8765,可通过 profile 配置。
 */

const PORT_KEY = 'bridge_port'
const DEFAULT_PORT = 8765
const ENABLE_KEY = 'bridge_enabled'

export function getBridgePort(): number {
  const n = Number(profileGet(PORT_KEY))
  return n >= 1024 && n <= 65535 ? n : DEFAULT_PORT
}

export function isBridgeEnabled(): boolean {
  return profileGet(ENABLE_KEY) !== '0'
}

let server: ReturnType<typeof createServer> | null = null
let getMainWindowRef: (() => BrowserWindow | null) | null = null

/** 解析 JSON body,失败返回 null */
function readJsonBody(req: IncomingMessage): Promise<any | null> {
  return new Promise((resolve) => {
    let buf = ''
    let size = 0
    const MAX = 2 * 1024 * 1024 // 2MB 上限,快照别太大
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX) {
        resolve(null)
        req.destroy()
        return
      }
      buf += chunk
    })
    req.on('end', () => {
      if (!buf) {
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(buf))
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

function sendJson(res: ServerResponse, code: number, obj: any): void {
  const body = JSON.stringify(obj)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  })
  res.end(body)
}

/** 根据插件上报的 category 做归一化,白名单过滤 */
function normalizeCategory(cat: any): 'study' | 'work' | 'social' | 'entertainment' | 'other' {
  const valid = ['study', 'work', 'social', 'entertainment', 'other']
  const s = String(cat || '').toLowerCase()
  return (valid.includes(s) ? s : 'other') as any
}

async function handleUsageReport(body: any): Promise<{ ok: boolean; message?: string }> {
  if (!body || typeof body !== 'object') return { ok: false, message: 'invalid body' }
  const { domain, title, url, category, startTs, endTs, durationMs, visits } = body
  if (!domain || typeof durationMs !== 'number' || durationMs <= 0) {
    return { ok: false, message: 'missing required fields' }
  }
  const now = Date.now()
  const safeStart = typeof startTs === 'number' && startTs > 0 ? startTs : now - durationMs
  const safeEnd = typeof endTs === 'number' && endTs > 0 ? endTs : now
  addWebUsage({
    domain: String(domain).slice(0, 256),
    title: String(title || domain).slice(0, 512),
    url: String(url || '').slice(0, 2048),
    category: normalizeCategory(category),
    startTs: safeStart,
    endTs: safeEnd,
    durationMs: Math.min(durationMs, 2 * 60 * 60 * 1000), // 单次最大 2h,防止脏数据
    visits: typeof visits === 'number' && visits > 0 ? visits : 1
  })
  // 触发里程碑检测
  triggerMilestoneCheck()
  return { ok: true }
}

async function handleSnapshotReport(body: any): Promise<{ ok: boolean; message?: string; id?: number }> {
  if (!body || typeof body !== 'object') return { ok: false, message: 'invalid body' }
  const { source, domain, title, content, category, url, process } = body
  if (!title) return { ok: false, message: 'missing title' }
  const id = addSnapshot({
    source: source === 'app' ? 'app' : 'web',
    domain: String(domain || '').slice(0, 256),
    title: String(title).slice(0, 512),
    content: String(content || '').slice(0, 8192),
    category: normalizeCategory(category),
    url: String(url || '').slice(0, 2048),
    process: String(process || '').slice(0, 256)
  })
  triggerMilestoneCheck()
  return { ok: true, id }
}

function handlePing(): { ok: boolean; time: number; bridgeEnabled: boolean } {
  return { ok: true, time: Date.now(), bridgeEnabled: isBridgeEnabled() }
}

function handleStats(): any {
  const webCat = webUsageByCategory()
  const appCat = appUsageByCategory()
  const combined = {
    study: webCat.study + appCat.study,
    work: webCat.work + appCat.work,
    social: webCat.social,
    entertainment: webCat.entertainment + appCat.entertainment,
    other: webCat.other + appCat.other
  }
  return {
    ok: true,
    web: { total: webUsageTotal(), byCategory: webCat },
    app: { total: appUsageTotal(), byCategory: appCat },
    combined
  }
}

let lastMilestoneCheck = 0
const MILESTONE_COOLDOWN_MS = 60 * 1000 // 至少间隔 1 分钟才检查一次里程碑,避免太频繁

function triggerMilestoneCheck(): void {
  const now = Date.now()
  if (now - lastMilestoneCheck < MILESTONE_COOLDOWN_MS) return
  lastMilestoneCheck = now
  try {
    const win = getMainWindowRef?.()
    const ev = checkMilestone()
    if (ev && win && !win.isDestroyed()) {
      win.webContents.send('milestone:hit', ev)
    }
  } catch {
    // ignore
  }
}

function route(req: IncomingMessage, res: ServerResponse): void {
  // CORS 预检
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {})
    return
  }
  const url = req.url || '/'
  const path = url.split('?')[0]

  // GET 路由
  if (req.method === 'GET') {
    if (path === '/ping') return sendJson(res, 200, handlePing())
    if (path === '/stats') return sendJson(res, 200, handleStats())
    return sendJson(res, 404, { ok: false, error: 'not found' })
  }

  // POST 路由
  if (req.method === 'POST') {
    readJsonBody(req).then(async (body) => {
      if (body === null && path !== '/ping') {
        return sendJson(res, 400, { ok: false, error: 'invalid json body' })
      }
      if (path === '/usage') return sendJson(res, 200, await handleUsageReport(body))
      if (path === '/snapshot') return sendJson(res, 200, await handleSnapshotReport(body))
      if (path === '/batch') return sendJson(res, 200, await handleBatch(body))
      return sendJson(res, 404, { ok: false, error: 'not found' })
    })
    return
  }

  sendJson(res, 405, { ok: false, error: 'method not allowed' })
}

async function handleBatch(body: any): Promise<{ ok: boolean; usages?: number; snapshots?: number; errors?: string[] }> {
  if (!body || typeof body !== 'object') return { ok: false, errors: ['invalid body'] }
  const errors: string[] = []
  let usages = 0
  let snapshots = 0
  if (Array.isArray(body.usages)) {
    for (const u of body.usages) {
      const r = await handleUsageReport(u)
      if (r.ok) usages++
      else errors.push(`usage: ${r.message}`)
    }
  }
  if (Array.isArray(body.snapshots)) {
    for (const s of body.snapshots) {
      const r = await handleSnapshotReport(s)
      if (r.ok) snapshots++
      else errors.push(`snapshot: ${r.message}`)
    }
  }
  return { ok: true, usages, snapshots, errors: errors.slice(0, 10) }
}

/** 启动桥接服务。调用方需要传入获取主窗口的引用(用于里程碑事件推送)。 */
export function startBridgeServer(getWin: () => BrowserWindow | null): void {
  if (server) return
  if (!isBridgeEnabled()) return
  getMainWindowRef = getWin

  const port = getBridgePort()
  server = createServer((req, res) => route(req, res))
  server.unref() // 不阻止进程退出

  server.on('error', (err: any) => {
    if (err?.code === 'EADDRINUSE') {
      // 端口被占用,打印一条即可,不影响其他功能
      console.warn(`[bridge] port ${port} in use, bridge server skipped`)
    }
  })

  server.listen(port, '127.0.0.1', () => {
    console.log(`[bridge] listening on http://127.0.0.1:${port}`)
  })
}

export function stopBridgeServer(): void {
  try {
    server?.close()
  } catch {
    // ignore
  }
  server = null
  getMainWindowRef = null
}

export type { MilestoneEvent }
