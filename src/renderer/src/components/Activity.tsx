import { useEffect, useState } from 'react'

interface Category {
  study: number
  work: number
  entertainment: number
  other: number
}

export function Activity() {
  const [total, setTotal] = useState(0)
  const [category, setCategory] = useState<Category>({ study: 0, work: 0, entertainment: 0, other: 0 })
  const [byDay, setByDay] = useState<{ process: string; title: string; total_ms: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [setting, setSetting] = useState<{
    enabled: boolean
    intervalMs: number
    redactTitle: boolean
  } | null>(null)

  const refresh = async () => {
    setLoading(true)
    const [t, c, d, s] = await Promise.all([
      window.companion.activityTotal(),
      window.companion.activityCategory(),
      window.companion.activityByDay(),
      window.companion.activitySettings()
    ])
    setTotal(t)
    setCategory(c)
    setByDay(d)
    setSetting(s)
    setLoading(false)
  }

  useEffect(() => {
    refresh()
  }, [])

  const toggleEnabled = async (v: boolean) => {
    await window.companion.setActivityEnabled(v)
    setSetting((s) => s && { ...s, enabled: v })
    if (!v) {
      setByDay([])
      setCategory({ study: 0, work: 0, entertainment: 0, other: 0 })
      setTotal(0)
    } else {
      await refresh()
    }
  }

  const toggleRedact = async (v: boolean) => {
    await window.companion.setActivityRedactTitle(v)
    setSetting((s) => s && { ...s, redactTitle: v })
    if (v) await refresh()
  }

  const sum = category.study + category.work + category.entertainment + category.other || 1
  const mins = (ms: number) => Math.round(ms / 60000)
  const pct = (ms: number) => Math.max(0, Math.round((ms / sum) * 100))

  return (
    <div className="activity">
      <div className="act-setting">
        <div className="switch-row">
          <label className="switch">
            <input
              type="checkbox"
              checked={setting?.enabled ?? false}
              onChange={(e) => toggleEnabled(e.target.checked)}
            />
            <span className="slider" />
          </label>
          <span className="hint">
            记录前台应用和使用时长{process.platform !== 'win32' ? ' · 仅 Windows 可用' : ''}
          </span>
        </div>
        <div className="switch-row">
          <label className="switch">
            <input
              type="checkbox"
              checked={setting?.redactTitle ?? false}
              disabled={!setting?.enabled}
              onChange={(e) => toggleRedact(e.target.checked)}
            />
            <span className="slider" />
          </label>
          <span className="hint">不记录窗口标题(仅统计进程名,保护隐私)</span>
        </div>
        <div className="switch-row">
          <span className="hint" style={{ marginRight: 8 }}>采样间隔</span>
          <select
            value={setting?.intervalMs ?? 3000}
            disabled={!setting?.enabled}
            onChange={async (e) => {
              const ms = Number(e.target.value)
              await window.companion.setActivityInterval(ms)
              setSetting((s) => s && { ...s, intervalMs: ms })
            }}
          >
            <option value={2000}>2 秒</option>
            <option value={3000}>3 秒</option>
            <option value={5000}>5 秒</option>
            <option value={10000}>10 秒</option>
          </select>
        </div>
      </div>

      <hr className="divider" />

      {loading && <div className="empty">加载中…</div>}

      {!loading && setting?.enabled && (
        <>
          <div className="act-summary">
            <Row label="今日活跃总时长" value={mins(total) + ' 分钟'} />
            <Row label="学习" value={mins(category.study) + ' 分'} color="var(--ok)" />
            <Row label="工作" value={mins(category.work) + ' 分'} color="var(--accent)" />
            <Row label="娱乐" value={mins(category.entertainment) + ' 分'} color="var(--accent-2)" />
            <Row label="其他" value={mins(category.other) + ' 分'} color="var(--muted)" />
          </div>

          <div className="cat-bar">
            <span className="bar study" style={{ width: pct(category.study) + '%' }} title={`学习 ${pct(category.study)}%`} />
            <span className="bar work" style={{ width: pct(category.work) + '%' }} title={`工作 ${pct(category.work)}%`} />
            <span className="bar fun" style={{ width: pct(category.entertainment) + '%' }} title={`娱乐 ${pct(category.entertainment)}%`} />
            <span className="bar other" style={{ width: pct(category.other) + '%' }} title={`其他 ${pct(category.other)}%`} />
          </div>
          <div className="cat-legend">
            <Dot color="var(--ok)" /> 学习
            <Dot color="var(--accent)" /> 工作
            <Dot color="var(--accent-2)" /> 娱乐
            <Dot color="var(--muted)" /> 其他
          </div>

          <div className="top-title">今日 Top 应用</div>
          <div className="top-list">
            {byDay.length === 0 && <div className="empty">刚开启记录,过几分钟再回来就有数据啦~</div>}
            {byDay.slice(0, 15).map((r, i) => (
              <div key={i} className="top-row">
                <span className="top-rank">{i + 1}</span>
                <div className="top-info">
                  <div className="top-name">{r.process}</div>
                  {r.title && <div className="top-title-inner">{r.title.slice(0, 40)}</div>}
                </div>
                <div className="top-time">{mins(r.total_ms)}分</div>
              </div>
            ))}
          </div>
        </>
      )}

      {!loading && !setting?.enabled && (
        <div className="empty">
          打开上面的开关,搭子就会开始记
          <br />
          录你各应用的使用时长,
          <br />
          互动和每日日记也会更贴合你的实际哦~
        </div>
      )}
    </div>
  )
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="s-row">
      <div className="s-label">{label}</div>
      <div className="s-val" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  )
}

function Dot({ color, children }: { color: string; children?: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--muted)' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
      {children}
    </span>
  )
}
