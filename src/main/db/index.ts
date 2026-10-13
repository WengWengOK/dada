import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

let db: Database.Database | null = null

/** 单例获取数据库连接(WAL 模式,索引覆盖常用查询) */
export function getDb(): Database.Database {
  if (db) return db

  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'companion.db')

  db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')

  migrate(db)
  return db
}

function migrate(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS user_profile (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'todo',   -- todo | done
      plan_min   INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      done_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

    CREATE TABLE IF NOT EXISTS focus_sessions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id    INTEGER,
      start_ts   INTEGER NOT NULL,
      end_ts     INTEGER,
      planned_ms INTEGER NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS chat_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      role       TEXT NOT NULL,                  -- user | assistant | system
      content    TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_history(created_at);

    CREATE TABLE IF NOT EXISTS memories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      kind       TEXT NOT NULL,                  -- fact | event | preference
      content    TEXT NOT NULL,
      weight     REAL NOT NULL DEFAULT 1.0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_reports (
      date      TEXT PRIMARY KEY,                -- YYYY-MM-DD
      content   TEXT NOT NULL,
      mood      TEXT,
      energy    INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ts         INTEGER NOT NULL,
      kind       TEXT NOT NULL,                  -- task | pomodoro | patrol | custom
      payload    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_reminders_ts ON reminders(ts);

    CREATE TABLE IF NOT EXISTS app_usage (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      process    TEXT NOT NULL,                   -- 进程名, 如 code.exe
      title      TEXT NOT NULL,                   -- 窗口标题, 学习/工作时可推断在做什么
      start_ts   INTEGER NOT NULL,                -- 进入前台时间(ms)
      end_ts     INTEGER NOT NULL,                -- 离开时间(ms)
      duration_ms INTEGER NOT NULL,               -- 聚焦时长
      date       TEXT NOT NULL                    -- YYYY-MM-DD 聚合索引
    );
    CREATE INDEX IF NOT EXISTS idx_usage_date ON app_usage(date);
    CREATE INDEX IF NOT EXISTS idx_usage_process ON app_usage(process);

    -- 浏览器网页使用记录(由浏览器插件上报)
    CREATE TABLE IF NOT EXISTS web_usage (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      domain     TEXT NOT NULL,                   -- 域名,如 github.com
      title      TEXT NOT NULL,                   -- 网页标题
      url        TEXT NOT NULL DEFAULT '',        -- 完整URL
      category   TEXT NOT NULL,                   -- study/work/social/entertainment/other
      start_ts   INTEGER NOT NULL,                -- 进入时间(ms)
      end_ts     INTEGER NOT NULL,                -- 离开时间(ms)
      duration_ms INTEGER NOT NULL,               -- 停留时长
      visits     INTEGER NOT NULL DEFAULT 1,      -- 访问次数
      date       TEXT NOT NULL                    -- YYYY-MM-DD
    );
    CREATE INDEX IF NOT EXISTS idx_web_usage_date ON web_usage(date);
    CREATE INDEX IF NOT EXISTS idx_web_usage_domain ON web_usage(domain);
    CREATE INDEX IF NOT EXISTS idx_web_usage_category ON web_usage(category);

    -- 学习内容快照: 定期截取学习内容片段,用于判断学习类型+鼓励
    CREATE TABLE IF NOT EXISTS study_snapshots (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      source     TEXT NOT NULL,                   -- 'web' | 'app'
      domain     TEXT NOT NULL DEFAULT '',        -- 域名或进程名
      title      TEXT NOT NULL,                   -- 标题/窗口名
      content    TEXT NOT NULL DEFAULT '',        -- 内容摘要(快照文本)
      category   TEXT NOT NULL,                   -- study/work/entertainment/other
      url        TEXT NOT NULL DEFAULT '',        -- URL(可选)
      process    TEXT NOT NULL DEFAULT '',        -- 进程名(可选)
      created_at INTEGER NOT NULL                 -- 快照时间(ms)
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_created ON study_snapshots(created_at);
    CREATE INDEX IF NOT EXISTS idx_snapshots_category ON study_snapshots(category);
    CREATE INDEX IF NOT EXISTS idx_snapshots_source ON study_snapshots(source);
  `)
}

// ---------- 通用 CRUD ----------

export function profileGet(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM user_profile WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function profileSet(key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO user_profile(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(key, value)
}

export interface TaskRow {
  id: number
  title: string
  status: string
  plan_min: number
  created_at: number
  done_at: number | null
}

export function listTasks(): TaskRow[] {
  return getDb().prepare('SELECT * FROM tasks ORDER BY created_at DESC').all() as TaskRow[]
}

export function addTask(title: string, planMin = 0): TaskRow {
  const now = Date.now()
  const info = getDb()
    .prepare('INSERT INTO tasks(title, plan_min, created_at) VALUES(?, ?, ?)')
    .run(title, planMin, now)
  return getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid) as TaskRow
}

export function completeTask(id: number): void {
  getDb()
    .prepare("UPDATE tasks SET status = 'done', done_at = ? WHERE id = ?")
    .run(Date.now(), id)
}

export function deleteTask(id: number): void {
  getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id)
}

export function addChat(role: string, content: string): void {
  getDb().prepare('INSERT INTO chat_history(role, content, created_at) VALUES(?, ?, ?)').run(
    role,
    content,
    Date.now()
  )
}

export function recentChat(limit = 20): { role: string; content: string }[] {
  return getDb()
    .prepare('SELECT role, content FROM chat_history ORDER BY created_at DESC LIMIT ?')
    .all(limit) as { role: string; content: string }[]
}

export function addMemory(kind: string, content: string, weight = 1.0): void {
  getDb()
    .prepare('INSERT INTO memories(kind, content, weight, created_at) VALUES(?, ?, ?, ?)')
    .run(kind, content, weight, Date.now())
}

export function recentMemories(limit = 10): { kind: string; content: string }[] {
  return getDb()
    .prepare('SELECT kind, content FROM memories ORDER BY created_at DESC LIMIT ?')
    .all(limit) as { kind: string; content: string }[]
}

export function saveDailyReport(date: string, content: string, mood?: string, energy?: number): void {
  getDb()
    .prepare(
      `INSERT INTO daily_reports(date, content, mood, energy, created_at)
       VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET content = excluded.content, mood = excluded.mood, energy = excluded.energy, created_at = excluded.created_at`
    )
    .run(date, content, mood ?? null, energy ?? null, Date.now())
}

export function addReminder(ts: number, kind: string, payload = ''): void {
  getDb().prepare('INSERT INTO reminders(ts, kind, payload) VALUES(?, ?, ?)').run(ts, kind, payload)
}

export function dueReminders(before = Date.now()): { id: number; kind: string; payload: string }[] {
  return getDb()
    .prepare('SELECT id, kind, payload FROM reminders WHERE ts <= ? ORDER BY ts ASC')
    .all(before) as { id: number; kind: string; payload: string }[]
}

export function clearReminder(id: number): void {
  getDb().prepare('DELETE FROM reminders WHERE id = ?').run(id)
}

// ---------- 应用使用时长 ----------

export function addAppUsage(
  process: string,
  title: string,
  startTs: number,
  endTs: number,
  durationMs: number
): void {
  const date = new Date(startTs).toISOString().slice(0, 10)
  getDb()
    .prepare(
      'INSERT INTO app_usage(process, title, start_ts, end_ts, duration_ms, date) VALUES(?, ?, ?, ?, ?, ?)'
    )
    .run(process, title, startTs, endTs, durationMs, date)
}

export interface UsageAggregate {
  process: string
  title: string
  total_ms: number
}

/** 指定日期按 (process, title) 聚合。若 date=null 则当天。 */
export function usageByDay(date?: string): UsageAggregate[] {
  const d = date ?? new Date().toISOString().slice(0, 10)
  return getDb()
    .prepare(
      `SELECT process, title, SUM(duration_ms) AS total_ms
       FROM app_usage
       WHERE date = ?
       GROUP BY process, title
       ORDER BY total_ms DESC
       LIMIT 30`
    )
    .all(d) as UsageAggregate[]
}

export function usageSummaryByProcess(date?: string): { process: string; total_ms: number }[] {
  const d = date ?? new Date().toISOString().slice(0, 10)
  return getDb()
    .prepare(
      `SELECT process, SUM(duration_ms) AS total_ms
       FROM app_usage
       WHERE date = ?
       GROUP BY process
       ORDER BY total_ms DESC`
    )
    .all(d) as { process: string; total_ms: number }[]
}

export function usageTotal(date?: string): number {
  const d = date ?? new Date().toISOString().slice(0, 10)
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(duration_ms),0) AS t FROM app_usage WHERE date = ?')
    .get(d) as { t: number } | undefined
  return row?.t ?? 0
}

// ---------- 浏览器网页使用时长 ----------

export interface WebUsageRow {
  id: number
  domain: string
  title: string
  url: string
  category: string
  start_ts: number
  end_ts: number
  duration_ms: number
  visits: number
  date: string
}

export function addWebUsage(params: {
  domain: string
  title: string
  url?: string
  category: string
  startTs: number
  endTs: number
  durationMs: number
  visits?: number
}): void {
  const date = new Date(params.startTs).toISOString().slice(0, 10)
  getDb()
    .prepare(
      `INSERT INTO web_usage(domain, title, url, category, start_ts, end_ts, duration_ms, visits, date)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.domain,
      params.title,
      params.url || '',
      params.category,
      params.startTs,
      params.endTs,
      params.durationMs,
      params.visits || 1,
      date
    )
}

export interface WebUsageAggregate {
  domain: string
  title: string
  category: string
  total_ms: number
  total_visits: number
}

/** 指定日期按 (domain, title) 聚合。若 date=null 则当天。 */
export function webUsageByDay(date?: string): WebUsageAggregate[] {
  const d = date ?? new Date().toISOString().slice(0, 10)
  return getDb()
    .prepare(
      `SELECT domain, title, category,
              SUM(duration_ms) AS total_ms,
              SUM(visits) AS total_visits
       FROM web_usage
       WHERE date = ?
       GROUP BY domain, title
       ORDER BY total_ms DESC
       LIMIT 30`
    )
    .all(d) as WebUsageAggregate[]
}

export function webUsageByCategory(date?: string): {
  study: number
  work: number
  social: number
  entertainment: number
  other: number
} {
  const d = date ?? new Date().toISOString().slice(0, 10)
  const rows = getDb()
    .prepare(
      `SELECT category, COALESCE(SUM(duration_ms),0) AS t
       FROM web_usage
       WHERE date = ?
       GROUP BY category`
    )
    .all(d) as { category: string; t: number }[]
  const out = { study: 0, work: 0, social: 0, entertainment: 0, other: 0 }
  for (const r of rows) {
    const k = r.category as keyof typeof out
    if (k in out) out[k] = r.t
  }
  return out
}

export function webUsageTotal(date?: string): number {
  const d = date ?? new Date().toISOString().slice(0, 10)
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(duration_ms),0) AS t FROM web_usage WHERE date = ?')
    .get(d) as { t: number } | undefined
  return row?.t ?? 0
}

export interface WebUsageDetail {
  title: string
  url: string
  category: string
  total_ms: number
  total_visits: number
}

/** 某天某域名的具体网页明细(按停留时长降序) */
export function webUsageDetail(date: string, domain: string): WebUsageDetail[] {
  return getDb()
    .prepare(
      `SELECT title, url, category,
              SUM(duration_ms) AS total_ms,
              SUM(visits) AS total_visits
       FROM web_usage
       WHERE date = ? AND domain = ?
       GROUP BY title, url
       ORDER BY total_ms DESC
       LIMIT 50`
    )
    .all(date, domain) as WebUsageDetail[]
}

export interface WebTrendPoint {
  date: string
  domain: string
  category: string
  total_ms: number
}

/** 最近 days 天按 (date, domain) 聚合, 用于趋势图 */
export function webUsageTrend(days = 7): WebTrendPoint[] {
  const start = new Date()
  start.setDate(start.getDate() - (days - 1))
  const startStr = start.toISOString().slice(0, 10)
  return getDb()
    .prepare(
      `SELECT date, domain, category, SUM(duration_ms) AS total_ms
       FROM web_usage
       WHERE date >= ?
       GROUP BY date, domain
       ORDER BY date, total_ms DESC`
    )
    .all(startStr) as WebTrendPoint[]
}

// ---------- 24 小时活动时间线 ----------

export interface TimelineItem {
  source: 'app' | 'web'
  name: string
  detail: string
  category: string
  start_ts: number
  end_ts: number
}

/** 浏览器进程(其具体内容已由 web_usage 覆盖, 时间线里跳过避免双记) */
const BROWSER_PROCS = new Set(['msedge', 'chrome', 'edge', 'firefox', 'browser', 'browserprocess'])

/** 某天活动时间线: app_usage(非浏览器) + web_usage 合并, 按开始时间排序 */
export function activityTimeline(date?: string): TimelineItem[] {
  const d = date ?? new Date().toISOString().slice(0, 10)
  const apps = getDb()
    .prepare(
      `SELECT process, title, start_ts, end_ts FROM app_usage
       WHERE date = ? AND start_ts IS NOT NULL AND end_ts IS NOT NULL`
    )
    .all(d) as { process: string; title: string; start_ts: number; end_ts: number }[]
  const webs = getDb()
    .prepare(
      `SELECT domain, title, category, start_ts, end_ts FROM web_usage
       WHERE date = ? AND start_ts IS NOT NULL AND end_ts IS NOT NULL`
    )
    .all(d) as { domain: string; title: string; category: string; start_ts: number; end_ts: number }[]

  const items: TimelineItem[] = []
  for (const a of apps) {
    if (BROWSER_PROCS.has(a.process)) continue
    items.push({
      source: 'app',
      name: a.process,
      detail: a.title || '',
      category: 'other',
      start_ts: a.start_ts,
      end_ts: a.end_ts
    })
  }
  for (const w of webs) {
    items.push({
      source: 'web',
      name: w.domain,
      detail: w.title || '',
      category: w.category || 'other',
      start_ts: w.start_ts,
      end_ts: w.end_ts
    })
  }
  items.sort((a, b) => a.start_ts - b.start_ts)
  return items
}

// ---------- 学习内容快照 ----------

export interface SnapshotRow {
  id: number
  source: 'web' | 'app'
  domain: string
  title: string
  content: string
  category: string
  url: string
  process: string
  created_at: number
}

export function addSnapshot(params: {
  source: 'web' | 'app'
  domain?: string
  title: string
  content?: string
  category: string
  url?: string
  process?: string
}): number {
  const info = getDb()
    .prepare(
      `INSERT INTO study_snapshots(source, domain, title, content, category, url, process, created_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.source,
      params.domain || '',
      params.title,
      params.content || '',
      params.category,
      params.url || '',
      params.process || '',
      Date.now()
    )
  return Number(info.lastInsertRowid)
}

/** 获取最近 N 条快照,可按分类和来源过滤 */
export function recentSnapshots(
  limit = 20,
  options?: { category?: string; source?: 'web' | 'app'; sinceTs?: number }
): SnapshotRow[] {
  const clauses: string[] = []
  const args: any[] = []
  if (options?.category) {
    clauses.push('category = ?')
    args.push(options.category)
  }
  if (options?.source) {
    clauses.push('source = ?')
    args.push(options.source)
  }
  if (options?.sinceTs) {
    clauses.push('created_at >= ?')
    args.push(options.sinceTs)
  }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''
  args.push(limit)
  return getDb()
    .prepare(
      `SELECT * FROM study_snapshots ${where} ORDER BY created_at DESC LIMIT ?`
    )
    .all(...args) as SnapshotRow[]
}

/** 统计今日(或指定日期)各分类快照数量 */
export function snapshotStatsByCategory(date?: string): {
  study: number
  work: number
  entertainment: number
  other: number
} {
  const d = date ?? new Date().toISOString().slice(0, 10)
  const startOfDay = new Date(d + 'T00:00:00').getTime()
  const endOfDay = startOfDay + 86400000
  const rows = getDb()
    .prepare(
      `SELECT category, COUNT(*) AS c
       FROM study_snapshots
       WHERE created_at >= ? AND created_at < ?
       GROUP BY category`
    )
    .all(startOfDay, endOfDay) as { category: string; c: number }[]
  const out = { study: 0, work: 0, entertainment: 0, other: 0 }
  for (const r of rows) {
    const k = r.category as keyof typeof out
    if (k in out) out[k] = r.c
  }
  return out
}
