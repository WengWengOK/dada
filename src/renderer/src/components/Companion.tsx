import { useEffect, useRef } from 'react'
import { useStore } from '../store'

/**
 * 搭子形象(MVP):纯 CSS 绘制的二次元占位立绘。
 * 待机动画用 CSS transform,不走 React 状态,零额外渲染开销。
 * v0.3 替换为 Live2D。
 */
export function Companion() {
  const expanded = useStore((s) => s.expanded)
  const setExpanded = useStore((s) => s.setExpanded)
  const idleAway = useStore((s) => s.idleAway)
  const ref = useRef<HTMLDivElement>(null)

  // 交互区域:鼠标进入搭子时不穿透,离开时穿透(让桌面其他位置可点)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const enter = () => window.companion.setIgnoreMouse(false)
    const leave = () => window.companion.setIgnoreMouse(true)
    el.addEventListener('mouseenter', enter)
    el.addEventListener('mouseleave', leave)
    return () => {
      el.removeEventListener('mouseenter', enter)
      el.removeEventListener('mouseleave', leave)
    }
  }, [])

  return (
    <div
      ref={ref}
      className={`companion ${idleAway ? 'sleeping' : ''}`}
      onClick={() => {
        const next = !expanded
        setExpanded(next)
        window.companion.togglePanel(next)
      }}
      title="点我聊天"
    >
      <div className="char">
        <div className="hair" />
        <div className="face">
          <div className="eye left" />
          <div className="eye right" />
          <div className="mouth" />
          <div className="blush left" />
          <div className="blush right" />
        </div>
        <div className="body" />
      </div>
      {idleAway && <div className="zzz">💤</div>}
    </div>
  )
}
