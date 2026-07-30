import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'

const PRESETS = [25, 5, 50]

export function Pomodoro() {
  const [endTs, setEndTs] = useState<number | null>(null)
  const [remaining, setRemaining] = useState(25 * 60)
  const [minutes, setMinutes] = useState(25)
  const tickRef = useRef<number | null>(null)

  useEffect(() => {
    if (!endTs) return
    tickRef.current = window.setInterval(() => {
      const r = Math.max(0, Math.round((endTs - Date.now()) / 1000))
      setRemaining(r)
      if (r <= 0) {
        stop()
        useStore.getState().showBubble('番茄钟结束啦,辛苦了,休息一下吧 💪')
        window.companion.addReminder(Date.now(), 'pomodoro', '')
      }
    }, 1000)
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endTs])

  const start = () => {
    const end = Date.now() + minutes * 60 * 1000
    setEndTs(end)
    setRemaining(minutes * 60)
    window.companion.setFocusing(true) // 专注中,巡检不打扰
  }

  const stop = () => {
    setEndTs(null)
    if (tickRef.current) window.clearInterval(tickRef.current)
    window.companion.setFocusing(false)
  }

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(remaining % 60).padStart(2, '0')

  return (
    <div className="pomodoro">
      <div className="p-time">
        {mm}:{ss}
      </div>
      <div className="p-presets">
        {PRESETS.map((p) => (
          <button
            key={p}
            className={minutes === p ? 'active' : ''}
            disabled={!!endTs}
            onClick={() => setMinutes(p)}
          >
            {p}min
          </button>
        ))}
      </div>
      <div className="p-actions">
        {!endTs ? (
          <button className="primary" onClick={start}>
            开始专注
          </button>
        ) : (
          <button onClick={stop}>停止</button>
        )}
      </div>
    </div>
  )
}
