import { useEffect, useState } from 'react'
import { SiteDonut } from './SiteDonut'
import { SiteTrend } from './SiteTrend'
import { ActivityTimeline } from './ActivityTimeline'

interface Category {
  study: number
  work: number
  social: number
  entertainment: number
  other: number
}

interface TopItem {
  key: string
  title: string
  subtitle?: string
  total_ms: number
  source: 'app' | 'web'
  category: string
}

interface Snap {
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

const CAT_COLOR: Record<string, string> = {
  study: 'var(--ok)',
  work: 'var(--accent)',
  social: '#ff9ad5',
  entertainment: 'var(--accent-2)',
  other: 'var(--muted)'
}
const CAT_EMOJI: Record<string, string> = {
  study: '📚',
  work: '💼',
  social: '💬',
  entertainment: '🎮',
  other: '📌'
}

export function Activity() {
  const [appTotal, setAppTotal] = useState(0)
  const [webTotal, setWebTotal] = useState(0)
  const [appCat, setAppCat] = useState<Category>({ study: 0, work: 0, social: 0, entertainment: 0, other: 0 })
  const [webCat, setWebCat] = useState<Category>({ study: 0, work: 0, social: 0, entertainment: 0, other: 0 })
  const [combined, setCombined] = useState<{ studyWorkMin: number; funMin: number; totalMin: number; funRatio: number } | null>(null)
  const [top, setTop] = useState<TopItem[]>([])
  const [snapshots, setSnapshots] = useState<Snap[]>([])
  const [loading, setLoading] = useState(true)
  const [setting, setSetting] = useState<{
    enabled: boolean
    intervalMs: number
    redactTitle: boolean
  } | null>(null)
  const [bridge, setBridge] = useState<{ enabled: boolean; port: number; url: string } | null>(null)

  const refresh = async () => {
    setLoading(true)
    const [t, c, d, s, wTotal, wCat, wByDay, snaps, ms, bri] = await Promise.all([
      window.companion.activityTotal(),
      window.companion.activityCategory(),
      window.companion.activityByDay(),
      window.companion.activitySettings(),
      window.companion.webTotal(),
      window.companion.webByCategory(),
      window.companion.webByDay(),
      window.companion.snapshotsRecent(15),
      window.companion.milestoneStats(),
      window.companion.bridgeInfo().catch(() => null)
    ])
    setAppTotal(t)
    setAppCat({ social: 0, ...c } as Category)
    setWebTotal(wTotal)
    setWebCat(wCat as Category)
    setCombined(ms)
    setBridge(bri)

    // 合并 Top 应用 + Top 网站
    const merged: TopItem[] = []
    for (const r of d) {
      merged.push({
        key: 'app:' + r.process + '|' + r.title,
        title: r.process,
        subtitle: r.title,
        total_ms: r.total_ms,
        source: 'app',
        category: classifyApp(r.process, r.title)
      })
    }
    for (const r of wByDay as any[]) {
      merged.push({
        key: 'web:' + r.domain + '|' + r.title,
        title: r.title || r.domain,
        subtitle: `🌐 ${r.domain}`,
        total_ms: r.total_ms,
        source: 'web',
        category: r.category || 'other'
      })
    }
    merged.sort((a, b) => b.total_ms - a.total_ms)
    setTop(merged.slice(0, 20))
    setSnapshots(snaps as Snap[])
    setSetting(s)
    setLoading(false)
  }

  useEffect(() => {
    refresh()
    const it = setInterval(refresh, 10_000) // 每 10s 自动刷一次,不用每秒
    return () => clearInterval(it)
  }, [])

  const toggleEnabled = async (v: boolean) => {
    await window.companion.setActivityEnabled(v)
    setSetting((s) => s && { ...s, enabled: v })
    if (!v) {
      setTop([])
      setAppCat({ study: 0, work: 0, social: 0, entertainment: 0, other: 0 })
      setAppTotal(0)
    } else {
      await refresh()
    }
  }

  const toggleRedact = async (v: boolean) => {
    await window.companion.setActivityRedactTitle(v)
    setSetting((s) => s && { ...s, redactTitle: v })
    if (v) await refresh()
  }

  const sum = (a: Category) => a.study + a.work + a.social + a.entertainment + a.other || 1
  const mins = (ms: number) => Math.round(ms / 60000)
  const pct = (part: number, total: number) => Math.max(0, Math.round((part / (total || 1)) * 100))

  const totalCat: Category = {
    study: appCat.study + webCat.study,
    work: appCat.work + webCat.work,
    social: appCat.social + webCat.social,
    entertainment: appCat.entertainment + webCat.entertainment,
    other: appCat.other + webCat.other
  }
  const totalMs = sum(totalCat)

  return (
    <div className="activity">
      {/* 桥接信息 + 里程碑小卡片 */}
      {combined && (
        <div className="milestone-card">
          <div className="ms-header">
            <div>
              <div className="ms-label">今日学习 + 工作</div>
              <div className="ms-value good">
                {combined.studyWorkMin}
                <span className="ms-unit">分钟</span>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="ms-label">活跃总时长</div>
              <div className="ms-value">{combined.totalMin}<span className="ms-unit">分钟</span></div>
              {combined.funRatio > 0.5 && (
                <div className="ms-warn">娱乐占比 {Math.round(combined.funRatio * 100)}%</div>
              )}
            </div>
          </div>
          <div className="ms-bar">
            <span className="bar study" style={{ width: pct(totalCat.study, totalMs) + '%' }} title={`学习 ${mins(totalCat.study)}分`} />
            <span className="bar work" style={{ width: pct(totalCat.work, totalMs) + '%' }} title={`工作 ${mins(totalCat.work)}分`} />
            <span className="bar fun" style={{ width: pct(totalCat.entertainment, totalMs) + '%' }} title={`娱乐 ${mins(totalCat.entertainment)}分`} />
            <span className="bar other" style={{ width: pct(totalCat.other + totalCat.social, totalMs) + '%' }} title={`其他+社交 ${mins(totalCat.other + totalCat.social)}分`} />
          </div>
          <div className="ms-footer">
            <span>📱 应用 {mins(appTotal)}分</span>
            <span>🌐 浏览器 {mins(webTotal)}分</span>
            {bridge && (
              <span className={bridge.enabled ? 'bridge-on' : 'bridge-off'} title={bridge.url}>
                插件桥接 {bridge.enabled ? '已开启(端口' + bridge.port + ')' : '未开启'}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 每日网站占比环形图(独立于应用记录开关, 由浏览器插件产生) */}
      <SiteDonut />
      {/* 近 7 天网站时长趋势 */}
      <SiteTrend />
      {/* 24 小时活动时间线: 学习/工作/娱乐/休息节奏 */}
      <ActivityTimeline />

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
            记录前台应用和使用时长 · 仅 Windows 可用
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
          <span className="hint">不记录窗口标题/网页正文(仅统计进程/域名,保护隐私)</span>
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
            <Row label="学习" value={mins(totalCat.study) + ' 分'} color="var(--ok)" />
            <Row label="工作" value={mins(totalCat.work) + ' 分'} color="var(--accent)" />
            <Row label="娱乐" value={mins(totalCat.entertainment) + ' 分'} color="var(--accent-2)" />
            <Row label="社交" value={mins(totalCat.social) + ' 分'} color="#ff9ad5" />
            <Row label="其他" value={mins(totalCat.other) + ' 分'} color="var(--muted)" />
          </div>

          <div className="cat-legend">
            <Dot color="var(--ok)" /> 学习
            <Dot color="var(--accent)" /> 工作
            <Dot color="var(--accent-2)" /> 娱乐
            <Dot color="var(--muted)" /> 其他
          </div>

          <div className="top-title">今日 Top (应用 + 网站)</div>
          <div className="top-list">
            {top.length === 0 && <div className="empty">刚开启记录,过几分钟再回来就有数据啦~</div>}
            {top.map((r, i) => (
              <div key={r.key} className="top-row">
                <span className="top-rank">{i + 1}</span>
                <div className="top-info">
                  <div className="top-name">
                    {r.source === 'web' ? '🌐' : '📱'} {r.title}
                    <span className="cat-tag" style={{ background: CAT_COLOR[r.category] + '22', color: CAT_COLOR[r.category] }}>
                      {CAT_EMOJI[r.category] || ''} {r.category}
                    </span>
                  </div>
                  {r.subtitle && <div className="top-title-inner">{(r.subtitle || '').slice(0, 48)}</div>}
                </div>
                <div className="top-time">{mins(r.total_ms)}分</div>
              </div>
            ))}
          </div>

          <div className="top-title">学习快照时间线 (最近)</div>
          <div className="snap-list">
            {snapshots.length === 0 && (
              <div className="empty">
                还没有快照。
                <br />
                学习类网站/软件停留 5 分钟后会自动记录一张~
              </div>
            )}
            {snapshots.map((s) => (
              <div key={s.id} className="snap-item">
                <div className="snap-head">
                  <span className="snap-ico" style={{ background: CAT_COLOR[s.category] + '22', color: CAT_COLOR[s.category] }}>
                    {s.source === 'web' ? '🌐' : '📱'}
                  </span>
                  <div className="snap-meta">
                    <div className="snap-title" title={s.title}>{s.title || '(无标题)'}</div>
                    <div className="snap-sub">
                      <span className="cat-tag" style={{ background: CAT_COLOR[s.category] + '22', color: CAT_COLOR[s.category] }}>
                        {CAT_EMOJI[s.category]} {s.category}
                      </span>
                      <span className="snap-time">{new Date(s.created_at).toLocaleTimeString()}</span>
                      {s.source === 'web' && s.domain && <span>· {s.domain}</span>}
                      {s.source === 'app' && s.process && <span>· {s.process}</span>}
                    </div>
                  </div>
                </div>
                {s.content && <div className="snap-body" title={s.content}>{s.content.slice(0, 180) || ''}</div>}
              </div>
            ))}
          </div>
        </>
      )}

      {!loading && !setting?.enabled && (
        <div className="empty">
          打开上面的开关,搭子就会开始记录你各应用的使用时长,
          <br />
          再配合浏览器插件,网页学习时长 + 编程软件时长一网打尽~
        </div>
      )}
    </div>
  )
}

function classifyApp(proc: string, title: string): string {
  const text = (proc + ' ' + title).toLowerCase()
  if (/(anki|obsidian|leetcode|mooc|course|教程|算法|英语|数学|考研|论文|笔记|课件|学习|复习|yuque|notion|onenote|zotero|xmind|marginnote)/i.test(text)) return 'study'
  if (/(code|idea|pycharm|clion|goland|webstorm|eclipse|vscode|androidstudio|sublime|intellij|docker|git|navicat|dbeaver|postman|apifox|figma|photoshop|wps|office|excel|word|powerpnt)/i.test(proc)) return 'work'
  if (/(wechat|qq|douyin|bilibili|xiaohongshu|weibo|zhihu|steam|youtube|netflix|music)/i.test(text)) return 'entertainment'
  return 'other'
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
