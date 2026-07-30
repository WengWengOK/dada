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
