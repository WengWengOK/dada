import { useEffect, useState } from 'react'
import { useStore } from '../store'

interface PlannedItem {
  title: string
  plan_min: number
}

export function TaskList() {
  const tasks = useStore((s) => s.tasks)
  const setTasks = useStore((s) => s.setTasks)
  const showBubble = useStore((s) => s.showBubble)
  const [title, setTitle] = useState('')
  const [plan, setPlan] = useState(25)

  // 智能排计划
  const [planText, setPlanText] = useState('')
  const [planned, setPlanned] = useState<PlannedItem[] | null>(null)
  const [parsing, setParsing] = useState(false)

  const refresh = async () => setTasks(await window.companion.listTasks())

  useEffect(() => {
    refresh()
  }, [])

  const add = async () => {
    if (!title.trim()) return
    await window.companion.addTask(title.trim(), plan)
    setTitle('')
    await refresh()
  }

  const complete = async (id: number, t: string) => {
    await window.companion.completeTask(id)
    showBubble(`做到「${t}」啦,真棒!继续加油~ ✨`)
    await refresh()
  }

  const remove = async (id: number) => {
    await window.companion.deleteTask(id)
    await refresh()
  }

  // 解析自然语言计划
  const parse = async () => {
    if (!planText.trim()) return
    setParsing(true)
    try {
      const items = await window.companion.parsePlan(planText.trim())
      setPlanned(items.length ? items : null)
      if (!items.length) showBubble('没解析出来,换个说法试试?比如「复习高数第三章 + 写英语作文」')
    } catch (e) {
      showBubble('解析失败:' + (e as Error).message)
    } finally {
      setParsing(false)
    }
  }

  const confirmPlanned = async () => {
    if (!planned) return
    for (const it of planned) {
      await window.companion.addTask(it.title, it.plan_min)
    }
    showBubble(`加好 ${planned.length} 个任务啦,开冲!💪`)
    setPlanned(null)
    setPlanText('')
    await refresh()
  }

  return (
    <div className="tasks">
      {/* 智能排计划 */}
      <div className="plan-box">
        <input
          value={planText}
          onChange={(e) => setPlanText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && parse()}
          placeholder="一句话描述计划,搭子帮你拆…"
          disabled={parsing}
        />
        <button onClick={parse} disabled={parsing || !planText.trim()}>
          {parsing ? '…' : '拆'}
        </button>
      </div>

      {planned && (
        <div className="plan-preview">
          <div className="plan-head">搭子拆好了,可改</div>
          {planned.map((it, i) => (
            <div key={i} className="plan-item">
              <input
                className="pi-title"
                value={it.title}
                onChange={(e) => {
                  const next = [...planned]
                  next[i] = { ...it, title: e.target.value }
                  setPlanned(next)
                }}
              />
              <input
                className="pi-min"
                type="number"
                value={it.plan_min}
                min={0}
                max={240}
                onChange={(e) => {
                  const next = [...planned]
                  next[i] = { ...it, plan_min: Number(e.target.value) || 0 }
                  setPlanned(next)
                }}
              />
              <button
                className="pi-del"
                onClick={() => setPlanned(planned.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
          <div className="plan-actions">
            <button className="primary" onClick={confirmPlanned}>
              全部加入
            </button>
            <button onClick={() => setPlanned(null)}>取消</button>
          </div>
        </div>
      )}

      {/* 手动添加 */}
      <div className="add-row">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="单个任务…"
        />
        <input
          type="number"
          value={plan}
          onChange={(e) => setPlan(Number(e.target.value) || 0)}
          min={0}
          max={240}
          title="预计分钟"
          className="plan-min"
        />
        <button onClick={add}>+</button>
      </div>
      <div className="task-list">
        {tasks.length === 0 && <div className="empty">还没有任务,加一个开始吧~</div>}
        {tasks.map((t) => (
          <div key={t.id} className={`task ${t.status}`}>
            <button className="check" onClick={() => t.status === 'todo' && complete(t.id, t.title)}>
              {t.status === 'done' ? '✓' : ''}
            </button>
            <span className="t-title">{t.title}</span>
            {t.plan_min > 0 && <span className="t-plan">{t.plan_min}min</span>}
            <button className="del" onClick={() => remove(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
