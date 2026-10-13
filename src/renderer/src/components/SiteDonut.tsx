import { useCallback, useEffect, useState } from 'react'

interface Site {
  domain: string
  title: string
  category: string
  total_ms: number
}

interface Detail {
  title: string
  url: string
  category: string
  total_ms: number
  total_visits: number
}

/** 环形图配色(取自 15 色清透色板), SiteTrend 复用 */
export const PALETTE = ['#9EACEA', '#8BC8EA', '#A2DDAA', '#F4B393', '#EAA7B2', '#E4D48F', '#C9A7E8']
/** 最多展示的网站数, 其余合并为"其他" */
const MAX_SEG = 5
const R = 68
const C = 2 * Math.PI * R
const SW = 24

const todayStr = () => new Date().toISOString().slice(0, 10)

export function SiteDonut() {
  const [date, setDate] = useState(todayStr)
  const [items, setItems] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail[] | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async (d: string) => {
    setLoading(true)
    try {
      const rows = (await window.companion.webByDay(d)) as unknown as Site[]
      setItems(rows || [])
    } catch {
      setItems([])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    setSelected(null)
    setDetail(null)
    void load(date)
  }, [date, load])

  const pick = async (domain: string) => {
    if (selected === domain) {
      setSelected(null)
      setDetail(null)
      return
    }
    setSelected(domain)
    setDetailLoading(true)
    setDetail(null)
    try {
      const rows = await window.companion.webDetail(date, domain)
      setDetail(rows || [])
    } catch {
      setDetail([])
    }
    setDetailLoading(false)
  }

  const totalMs = items.reduce((a, b) => a + b.total_ms, 0)
  const segs =
    items.length > MAX_SEG
      ? [
          ...items.slice(0, MAX_SEG),
          {
            domain: '(其他)',
            title: '',
            category: 'other',
            total_ms: items.slice(MAX_SEG).reduce((a, b) => a + b.total_ms, 0)
          }
        ]
      : items

  const fmtDur = (ms: number) => {
    const min = Math.round(ms / 60000)
    if (min < 60) return min + ' 分钟'
    return Math.floor(min / 60) + ' 小时 ' + (min % 60) + ' 分'
  }

  const shift = (d: string, delta: number) => {
    const t = new Date(d + 'T00:00:00')
    t.setDate(t.getDate() + delta)
    return t.toISOString().slice(0, 10)
  }
  const today = todayStr()
  const prev = shift(date, -1)
  const next = shift(date, 1)

  // 每段弧: stroke-dasharray 画弧, stroke-dashoffset 累计旋转
  let acc = 0
  const arcs = segs.map((s, i) => {
    const frac = totalMs ? s.total_ms / totalMs : 0
    const dash = frac * C
    const arc = { ...s, color: PALETTE[i % PALETTE.length], dash, offset: -acc, frac }
    acc += dash
    return arc
  })

  return (
    <div className="site-donut">
      <div className="donut-head">
        <span className="donut-title">🌐 每日网站占比</span>
        <div className="donut-nav">
          <button className="donut-btn" onClick={() => setDate(prev)} title="前一天">
            ‹
          </button>
          <span className="donut-date">{date === today ? '今天' : date}</span>
          <button
            className="donut-btn"
            onClick={() => setDate(next)}
            disabled={next > today}
            title="后一天"
          >
            ›
          </button>
        </div>
      </div>

      {loading ? (
        <div className="empty">加载中…</div>
      ) : totalMs === 0 ? (
        <div className="empty">
          这一天还没有网页浏览记录~
          <br />
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            需要先安装浏览器插件,才会记录每个网站的停留时长
          </span>
        </div>
      ) : (
        <>
          <div className="donut-body">
            <svg viewBox="0 0 200 200" className="donut-svg" role="img" aria-label="网站使用时长占比环形图">
              <circle cx="100" cy="100" r={R} fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth={SW} />
              {arcs.map(
                (a, i) =>
                  a.frac > 0 && (
                    <circle
                      key={i}
                      cx="100"
                      cy="100"
                      r={R}
                      fill="none"
                      stroke={a.color}
                      strokeWidth={SW}
                      strokeDasharray={`${Math.max(a.dash - 1.5, 0.5)} ${C}`}
                      strokeDashoffset={a.offset}
                      transform="rotate(-90 100 100)"
                    >
                      <title>{`${a.title || a.domain} ${Math.round(a.frac * 100)}%`}</title>
                    </circle>
                  )
              )}
              <text x="100" y="95" textAnchor="middle" className="donut-center-num">
                {Math.round(totalMs / 60000)}
              </text>
              <text x="100" y="114" textAnchor="middle" className="donut-center-lbl">
                分钟
              </text>
            </svg>

            <div className="donut-legend">
              {arcs.map((a, i) => (
                <div
                  key={i}
                  className={'donut-row' + (selected === a.domain ? ' selected' : '')}
                  onClick={() => a.domain !== '(其他)' && void pick(a.domain)}
                  title={a.domain === '(其他)' ? '' : '点击查看网页明细'}
                >
                  <span className="dot" style={{ background: a.color }} />
                  <div className="dn-info">
                    <div className="dn-name" title={a.title || a.domain}>
                      {(a.title || a.domain).slice(0, 26)}
                    </div>
                    {a.domain && a.title && (
                      <div className="dn-sub" title={a.domain}>
                        {a.domain}
                      </div>
                    )}
                  </div>
                  <span className="dn-val">
                    {fmtDur(a.total_ms)} · {Math.round(a.frac * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {selected && (
            <div className="donut-detail">
              <div className="dd-head">
                <span className="dd-title">📄 {selected} · 网页明细</span>
                <button className="donut-btn" onClick={() => { setSelected(null); setDetail(null) }}>
                  ×
                </button>
              </div>
              {detailLoading ? (
                <div className="empty">加载中…</div>
              ) : !detail || detail.length === 0 ? (
                <div className="empty">这个网站当天没有网页明细</div>
              ) : (
                <div className="dd-list">
                  {detail.map((d, i) => (
                    <div key={i} className="dd-row">
                      <div className="dd-info">
                        <div className="dd-name" title={d.title}>
                          {d.title || '(无标题)'}
                        </div>
                        {d.url && (
                          <div className="dd-url" title={d.url}>
                            {d.url.slice(0, 90)}
                          </div>
                        )}
                      </div>
                      <span className="dd-val">
                        {fmtDur(d.total_ms)} · {Math.round((d.total_ms / (totalMs || 1)) * 100)}% ·{' '}
                        {d.total_visits} 次
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
