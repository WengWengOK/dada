import { useCallback, useEffect, useState } from 'react'

interface TimelineItem {
  source: 'app' | 'web'
  name: string
  detail: string
  category: string
  start_ts: number
  end_ts: number
}

/** 片段(合并后) */
interface Seg {
  s: number
  e: number
  name: string
  detail: string
  category: string
}

const CATS = ['study', 'work', 'entertainment', 'other'] as const
const CAT_LABEL: Record<string, string> = {
  study: '学习',
  work: '工作',
  entertainment: '娱乐',
  other: '其他'
}
const CAT_COLOR: Record<string, string> = {
  study: '#52C41A',
  work: '#5B8DEF',
  entertainment: '#B58AE6',
  other: '#B9BDC4'
}

const DAY_MS = 24 * 60 * 60 * 1000
/** 同泳道相邻片段合并阈值(秒), 避免浏览器短记录画成碎条 */
const MERGE_GAP = 60_000

const todayStr = () => new Date().toISOString().slice(0, 10)
const fmtDur = (ms: number) => {
  const min = Math.round(ms / 60000)
  if (min < 60) return min + ' 分'
  return Math.floor(min / 60) + ' 小时 ' + (min % 60) + ' 分'
}
const fmtHM = (ts: number) => {
  const d = new Date(ts)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return h + ':' + m
}

/** 合并同类别相邻片段(间隙 < mergeGap 视为连续) */
function mergeSegs(items: TimelineItem[], cat: string, gap: number): Seg[] {
  const list = items
    .filter((i) => i.category === cat && i.end_ts > i.start_ts)
    .sort((a, b) => a.start_ts - b.start_ts)
  const out: Seg[] = []
  for (const it of list) {
    const last = out[out.length - 1]
    if (last && it.start_ts - last.e < gap) {
      if (it.end_ts > last.e) {
        last.e = it.end_ts
        last.name = it.name
        last.detail = it.detail || last.detail
      }
    } else {
      out.push({ s: it.start_ts, e: it.end_ts, name: it.name, detail: it.detail, category: cat })
    }
  }
  return out
}

/** 24 小时活动时间线: 一眼看出哪些时段在学习/工作/娱乐/休息 */
export function ActivityTimeline() {
  const [date, setDate] = useState(todayStr)
  const [items, setItems] = useState<TimelineItem[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (d: string) => {
    setLoading(true)
    try {
      const rows = (await window.companion.activityTimeline(d)) as unknown as TimelineItem[]
      setItems(rows || [])
    } catch {
      setItems([])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load(date)
  }, [date, load])

  const shift = (d: string, delta: number) => {
    const t = new Date(d + 'T00:00:00')
    t.setDate(t.getDate() + delta)
    return t.toISOString().slice(0, 10)
  }
  const today = todayStr()
  const dayStart = new Date(date + 'T00:00:00').getTime()

  // 各泳道片段
  const lanes = CATS.map((c) => ({ cat: c, segs: mergeSegs(items, c, MERGE_GAP) }))

  // 统计: 学习总时长/时段数/最长专注, 最长休息(活跃区间间隙)
  const studySegs = mergeSegs(items, 'study', 5 * 60_000)
  const totalStudyMs = studySegs.reduce((a, b) => a + (b.e - b.s), 0)
  const longestStudy = Math.max(...studySegs.map((g) => g.e - g.s), 0)
  const allSegs = lanes.flatMap((l) => l.segs).sort((a, b) => a.s - b.s)
  let longestRest = 0
  for (let i = 1; i < allSegs.length; i++) {
    const gap = allSegs[i].s - allSegs[i - 1].e
    if (gap > longestRest) longestRest = gap
  }

  // SVG 布局
  const W = 680
  const H = 150
  const x0 = 44
  const plotW = W - x0 - 10
  const laneH = 22
  const laneGap = 6
  const yTop = 16
  const axisY = H - 18

  return (
    <div className="timeline-card">
      <div className="donut-head">
        <span className="donut-title">🕐 24 小时活动时间线</span>
        <div className="donut-nav">
          <button className="donut-btn" onClick={() => setDate(shift(date, -1))} title="前一天">
            ‹
          </button>
          <span className="donut-date">{date === today ? '今天' : date}</span>
          <button
            className="donut-btn"
            onClick={() => setDate(shift(date, 1))}
            disabled={shift(date, 1) > today}
            title="后一天"
          >
            ›
          </button>
        </div>
      </div>

      {loading ? (
        <div className="empty">加载中…</div>
      ) : items.length === 0 ? (
        <div className="empty">
          这天没有活动记录~
          <br />
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            有网页浏览或应用使用记录后,这里会画出你一天的学习/工作/休息节奏
          </span>
        </div>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="timeline-svg" role="img" aria-label="24小时活动时间线">
            {/* 时刻刻度(每 2 小时) */}
            {Array.from({ length: 13 }, (_, i) => {
              const x = x0 + (i / 12) * plotW
              return (
                <g key={i}>
                  <line
                    x1={x}
                    y1={yTop - 4}
                    x2={x}
                    y2={axisY}
                    stroke={i % 6 === 0 ? 'rgba(0,0,0,0.16)' : 'rgba(0,0,0,0.07)'}
                    strokeWidth="1"
                  />
                  <text x={x} y={axisY + 12} textAnchor="middle" fontSize="9.5" fill="var(--muted)">
                    {i * 2}
                  </text>
                </g>
              )
            })}
            {/* 泳道标签 */}
            {lanes.map((l, i) => {
              const y = yTop + i * (laneH + laneGap)
              return (
                <g key={l.cat}>
                  <text x={x0 - 6} y={y + laneH / 2 + 3.5} textAnchor="end" fontSize="11" fill="var(--muted)">
                    {CAT_LABEL[l.cat]}
                  </text>
                  {l.segs.map((s, j) => {
                    const x = x0 + ((s.s - dayStart) / DAY_MS) * plotW
                    const w = Math.max(((s.e - s.s) / DAY_MS) * plotW, 2)
                    return (
                      <rect
                        key={j}
                        x={x}
                        y={y}
                        width={w}
                        height={laneH}
                        rx="3"
                        fill={CAT_COLOR[l.cat]}
                        opacity="0.85"
                      >
                        <title>
                          {`${fmtHM(s.s)}-${fmtHM(s.e)} ${fmtDur(s.e - s.s)} · ${s.detail || s.name}`}
                        </title>
                      </rect>
                    )
                  })}
                </g>
              )
            })}
          </svg>

          <div className="timeline-stats">
            <span className="ts-item">
              📚 学习 <b>{fmtDur(totalStudyMs)}</b>
            </span>
            <span className="ts-item">
              🧩 学习时段 <b>{studySegs.length}</b> 个
            </span>
            <span className="ts-item">
              🔥 最长专注 <b>{fmtDur(longestStudy)}</b>
            </span>
            <span className="ts-item">
              😴 最长休息 <b>{longestRest > 0 ? fmtDur(longestRest) : '—'}</b>
            </span>
          </div>
        </>
      )}
    </div>
  )
}
