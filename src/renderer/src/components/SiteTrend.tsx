import { useEffect, useState } from 'react'
import { PALETTE } from './SiteDonut'

interface TrendPoint {
  date: string
  domain: string
  category: string
  total_ms: number
}

interface Seg {
  domain: string
  ms: number
  color: string
}
interface Day {
  date: string
  label: string
  segs: Seg[]
  total: number
}

const OTHER_COLOR = '#B9BDC4'
const DAYS = 7

const fmtMin = (ms: number) => {
  const min = Math.round(ms / 60000)
  if (min < 60) return min + ' 分'
  return Math.floor(min / 60) + 'h' + (min % 60) + 'm'
}

/** 近 7 天各网站使用时长堆叠柱状图 */
export function SiteTrend() {
  const [days, setDays] = useState<Day[]>([])
  const [top, setTop] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      try {
        const rows = (await window.companion.webTrend(DAYS)) as unknown as TrendPoint[]
        if (!alive) return
        // 7 天日期槽位(与 DB 同一 UTC 口径)
        const dayList: string[] = []
        const t0 = new Date()
        t0.setDate(t0.getDate() - (DAYS - 1))
        for (let i = 0; i < DAYS; i++) {
          const t = new Date(t0)
          t.setDate(t0.getDate() + i)
          dayList.push(t.toISOString().slice(0, 10))
        }
        const today = dayList[dayList.length - 1]

        // 各域名 7 天总量 → top5
        const totalByDomain = new Map<string, number>()
        for (const r of rows) {
          totalByDomain.set(r.domain, (totalByDomain.get(r.domain) || 0) + r.total_ms)
        }
        const topDomains = [...totalByDomain.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map((e) => e[0])
        const colorOf = (d: string) => {
          const i = topDomains.indexOf(d)
          return i >= 0 ? PALETTE[i] : OTHER_COLOR
        }

        const byDate = new Map<string, TrendPoint[]>()
        for (const r of rows) {
          const arr = byDate.get(r.date) || []
          arr.push(r)
          byDate.set(r.date, arr)
        }

        const out: Day[] = dayList.map((date) => {
          const arr = (byDate.get(date) || []).slice().sort((a, b) => b.total_ms - a.total_ms)
          let other = 0
          const segs: Seg[] = []
          for (const a of arr) {
            if (topDomains.includes(a.domain)) {
              segs.push({ domain: a.domain, ms: a.total_ms, color: colorOf(a.domain) })
            } else {
              other += a.total_ms
            }
          }
          if (other > 0) segs.push({ domain: '(其他)', ms: other, color: OTHER_COLOR })
          const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
          const label =
            date === today ? '今天' : m ? `${Number(m[2])}/${Number(m[3])}` : date
          return {
            date,
            label,
            segs,
            total: segs.reduce((s, x) => s + x.ms, 0)
          }
        })
        setDays(out)
        setTop(topDomains)
      } catch {
        if (alive) {
          setDays([])
          setTop([])
        }
      }
      if (alive) setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [])

  const maxDay = Math.max(...days.map((d) => d.total), 1)
  const W = 340
  const H = 210
  const x0 = 38
  const y0 = 12
  const plotW = W - x0 - 6
  const plotH = H - y0 - 26
  const band = plotW / DAYS
  const barW = band * 0.56

  return (
    <div className="site-trend">
      <div className="donut-head">
        <span className="donut-title">📊 近 7 天网站时长趋势</span>
      </div>
      {loading ? (
        <div className="empty">加载中…</div>
      ) : days.length === 0 || maxDay === 0 ? (
        <div className="empty">近 7 天还没有网页记录,装好浏览器插件后这里会有趋势~</div>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="trend-svg" role="img" aria-label="近7天网站时长堆叠柱状图">
            {/* 网格线(0/25/50/75/100%) + 左侧分钟标签 */}
            {[0, 25, 50, 75, 100].map((k) => {
              const y = y0 + plotH - (k / 100) * plotH
              return (
                <g key={k}>
                  <line x1={x0} y1={y} x2={x0 + plotW} y2={y} stroke="rgba(0,0,0,0.08)" strokeWidth="1" />
                  <text x={x0 - 5} y={y + 3} textAnchor="end" fontSize="9.5" fill="var(--muted)">
                    {Math.round((maxDay * k) / 100 / 60000)}
                  </text>
                </g>
              )
            })}
            {days.map((d, i) => {
              const cx = x0 + i * band + band / 2
              const bw = barW
              let acc = 0
              return (
                <g key={d.date}>
                  {d.segs.map((s, j) => {
                    const h = (s.ms / maxDay) * plotH
                    const y = y0 + plotH - acc - h
                    acc += h
                    return (
                      <rect
                        key={j}
                        x={cx - bw / 2}
                        y={y}
                        width={bw}
                        height={Math.max(h, 0)}
                        fill={s.color}
                        rx="2"
                      >
                        <title>{`${d.date} ${s.domain} ${fmtMin(s.ms)}`}</title>
                      </rect>
                    )
                  })}
                  <text x={cx} y={y0 + plotH + 15} textAnchor="middle" fontSize="10" fill="var(--muted)">
                    {d.label}
                  </text>
                  {d.total > 0 && (
                    <text x={cx} y={y0 + plotH - acc - 4} textAnchor="middle" fontSize="9.5" fill="var(--text)">
                      {fmtMin(d.total)}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>

          <div className="trend-legend">
            {top.map((d, i) => (
              <span key={d} className="tl-item">
                <span className="dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                {d}
              </span>
            ))}
            <span className="tl-item">
              <span className="dot" style={{ background: OTHER_COLOR }} />
              其他
            </span>
          </div>
        </>
      )}
    </div>
  )
}
