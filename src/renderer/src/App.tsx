import { useEffect, useState } from 'react'
import { useStore } from './store'
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

  // 启动问候 + 事件订阅
  useEffect(() => {
    const offGreet = window.companion.onGreeting((text) => setGreeting(text))
    const offIdle = window.companion.onIdleState((s) => setIdleAway(s.isAway))
    const offRemind = window.companion.onReminder((r) => {
      const text =
        r.kind === 'patrol' ? '进度怎么样啦?还顺利吗?' : r.payload || '到点啦~'
      showBubble(text)
    })
    // 搭子主动巡检:弹泡 + 自动展开聊天面板方便回应
    const offPatrol = window.companion.onPatrolAsk((r) => {
      showBubble(r.text)
      setTab('chat')
      if (!useStore.getState().expanded) {
        setExpanded(true)
        window.companion.togglePanel(true)
      }
    })
    return () => {
      offGreet()
      offIdle()
      offRemind()
      offPatrol()
    }
  }, [setGreeting, setIdleAway, showBubble, setTab, setExpanded])

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
                setExpanded(false)
                window.companion.togglePanel(false)
              }}
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
