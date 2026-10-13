import { useEffect, useState } from 'react'
import { useStore } from './store'
import type { Emotion } from './store'
import { Companion } from './components/Companion'
import { ChatPanel } from './components/ChatPanel'
import { TaskList } from './components/TaskList'
import { Settings } from './components/Settings'
import { Pomodoro } from './components/Pomodoro'
import { Activity } from './components/Activity'

const TABS = [
  { id: 'chat', label: '聊' },
  { id: 'tasks', label: '任' },
  { id: 'pomodoro', label: '钟' },
  { id: 'activity', label: '计' },
  { id: 'diary', label: '记' },
  { id: 'settings', label: '设' }
] as const

function App() {
  const expanded = useStore((s) => s.expanded)
  const tab = useStore((s) => s.tab)
  const setTab = useStore((s) => s.setTab)
  const bubble = useStore((s) => s.bubble)
  const showBubble = useStore((s) => s.showBubble)
  const setExpanded = useStore((s) => s.setExpanded)
  const setGreeting = useStore((s) => s.setGreeting)
  const setIdleAway = useStore((s) => s.setIdleAway)
  const setEmotion = useStore((s) => s.setEmotion)

  // 启动问候 + 事件订阅
  useEffect(() => {
    const report = (hyp: string, loc: string, msg: string, data: any) => {
      try {
        void fetch('http://127.0.0.1:7777/event', {
          method: 'POST',
          body: JSON.stringify({
            sessionId: 'companion-ui-bug',
            runId: 'pre',
            hypothesisId: hyp,
            location: loc,
            msg: '[DEBUG] ' + msg,
            data,
            ts: Date.now()
          })
        }).catch(() => {})
      } catch {}
    }
    // #region debug-point H1+H4:app-effect-init
    report('H4', 'src/renderer/src/App.tsx:useEffect-init', 'App event-effect start', {
      hasWinCompanion: !!window.companion,
      onGreetingT: typeof window?.companion?.onGreeting,
      onMilestoneT: typeof window?.companion?.onMilestone,
      togglePanelT: typeof window?.companion?.togglePanel
    })
    // #endregion

    const offGreet = window.companion.onGreeting((text) => {
      setGreeting(text)
      setEmotion('love', 5000)
      report('H4', 'App.tsx:onGreeting', 'onGreeting fired', { text: text.slice(0, 120) })
    })
    // 天气降水提醒: 冒泡 + 惊讶表情
    const offWeather = window.companion.onWeatherAlert((text) => {
      window.companion.log('weather-alert received: ' + text)
      showBubble(text)
      setEmotion('surprised', 6000)
    })
    const offIdle = window.companion.onIdleState((s) => {
      setIdleAway(s.isAway)
      // 离开很久没来理搭子 → 大哭撒娇(2 小时以上)
      if (s.isAway && s.idleSeconds >= 7200) setEmotion('cry')
    })
    const offRemind = window.companion.onReminder((r) => {
      const text =
        r.kind === 'patrol' ? '进度怎么样啦?还顺利吗?' : r.payload || '到点啦~'
      showBubble(text)
      setEmotion(r.kind === 'patrol' ? 'shy' : 'surprised', 4500)
    })
    // 搭子主动巡检/鼓励: 弹泡; patrol/hourly/return 自动展开聊天面板, short 只弹泡不打断
    const offPatrol = window.companion.onPatrolAsk((r) => {
      window.companion.log('patrol:ask received trigger=' + r.trigger + ' text=' + r.text)
      showBubble(r.text)
      if (r.trigger === 'short') {
        // 2 分钟短鼓励: 轻量气泡,不切面板不打断操作; 摸鱼提醒时坏笑, 其余开心
        setEmotion(r.category === 'entertainment' ? 'smug' : 'happy', 3000)
        return
      }
      setTab('chat')
      // 阶段鼓励(满 1 小时)激动, 久别回归热情欢迎, 普通巡检鼓励
      setEmotion(
        r.trigger === 'hourly' ? 'excited' : r.trigger === 'return' ? 'love' : 'encourage',
        6000
      )
      if (!useStore.getState().expanded) {
        setExpanded(true)
        window.companion.togglePanel(true)
      }
    })
    // 里程碑达成:弹鼓励气泡,达到大里程碑顺便切到聊天面板给夸夸
    const offMilestone = window.companion.onMilestone((r) => {
      const levelEmoji =
        r.level === 'great' ? '🎉 ' : r.level === 'good' ? '⭐ ' : r.level === 'warn' ? '💡 ' : '✨ '
      showBubble(levelEmoji + r.message)
      // 情绪映射: great=激动, good=开心, warn=担心
      const emo: Emotion =
        r.level === 'great' ? 'excited' : r.level === 'good' ? 'happy' : r.level === 'warn' ? 'sad' : 'shy'
      const hold = r.level === 'great' ? 12000 : r.level === 'good' ? 9000 : 6000
      setEmotion(emo, hold)
      if (r.level === 'great') {
        if (!useStore.getState().expanded) {
          setExpanded(true)
          window.companion.togglePanel(true)
        }
      }
    })
    // 全局 document 级 click 捕获(验证面板内点击是否被 dispatch)
    const docCapture = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      const cls = target?.className ? (typeof target.className === 'string' ? target.className.slice(0, 120) : String(target.className).slice(0,120)) : ''
      const tag = target?.tagName || ''
      // 仅在 panel / collapse / 按钮 / tab 有交互的位置打日志,避免刷爆
      const interesting = target?.closest?.('.panel, .tabs, .collapse, .tabs button, .primary, .chat, .msg-list, .input-row, button.collapse')
      if (interesting) {
        report('H2', 'App.tsx:doc-click-capture', 'document.click captured on UI', {
          tag,
          cls,
          text: (target?.textContent || '').slice(0, 40),
          expanded: useStore.getState().expanded
        })
      }
    }
    document.addEventListener('click', docCapture, true)
    return () => {
      offGreet()
      offWeather()
      offIdle()
      offRemind()
      offPatrol()
      offMilestone()
      document.removeEventListener('click', docCapture, true)
    }
  }, [setGreeting, setIdleAway, showBubble, setTab, setExpanded, setEmotion])

  // 气泡自动隐藏(普通 5s,巡检/回归 8s 留时间回应)
  useEffect(() => {
    if (!bubble) return
    const t = setTimeout(() => showBubble(null), 6000)
    return () => clearTimeout(t)
  }, [bubble, showBubble])

  return (
    <div className="root" data-expanded={expanded}>
      <div className="stage">
        <Companion />
        {bubble && <div className="bubble">{bubble}</div>}
      </div>

      {expanded && (
        <div className="panel">
          <div className="tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? 'active' : ''}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
            <button
              className="collapse"
              onClick={() => {
                window.companion.minimize()
              }}
              title="最小化"
            >
              −
            </button>
            <button
              className="collapse"
              onClick={() => {
                setExpanded(false)
                window.companion.togglePanel(false)
              }}
              title="关闭面板"
            >
              ×
            </button>
          </div>
          <div className="panel-body">
            {tab === 'chat' && <ChatPanel />}
            {tab === 'tasks' && <TaskList />}
            {tab === 'pomodoro' && <Pomodoro />}
            {tab === 'activity' && <Activity />}
            {tab === 'settings' && <Settings />}
            {tab === 'diary' && <Diary />}
          </div>
        </div>
      )}

      {/* 自定义 resize 手柄 (右下角, 折叠/展开都可调节大小) */}
      <div
        className="resize-handle"
        onPointerDown={(e) => {
          e.stopPropagation()
          window.companion.setIgnoreMouse(false)
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          ;(e.currentTarget as HTMLElement).dataset.lastSx = String(e.screenX)
          ;(e.currentTarget as HTMLElement).dataset.lastSy = String(e.screenY)
        }}
        onPointerMove={(e) => {
          const el = e.currentTarget as HTMLElement
          const lastSx = Number(el.dataset.lastSx)
          const lastSy = Number(el.dataset.lastSy)
          if (!lastSx && !lastSy) return
          const dw = e.screenX - lastSx
          const dh = e.screenY - lastSy
          el.dataset.lastSx = String(e.screenX)
          el.dataset.lastSy = String(e.screenY)
          if (dw !== 0 || dh !== 0) {
            window.companion.resizeWindow(Math.round(dw), Math.round(dh))
          }
        }}
        onPointerUp={(e) => {
          const el = e.currentTarget as HTMLElement
          delete el.dataset.lastSx
          delete el.dataset.lastSy
          try { el.releasePointerCapture(e.pointerId) } catch {}
        }}
        title="拖动调整大小"
      >
        ⤡
      </div>
    </div>
  )
}

function Diary() {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)

  const gen = async () => {
    setLoading(true)
    try {
      const r = await window.companion.generateDaily()
      setContent(`📅 ${r.date}\n\n${r.content}`)
    } catch (e) {
      setContent('生成失败:' + (e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="diary">
      <button className="primary" onClick={gen} disabled={loading}>
        {loading ? '搭子正在写…' : '让搭子写今日日记'}
      </button>
      {content && <pre className="diary-content">{content}</pre>}
    </div>
  )
}

export default App
