import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import type { Emotion } from '../store'

/** 情绪 -> 帧文件映射 (放在 public/companion/ 下, Vite 会作为静态资源提供) */
const EMOTION_FILES: Record<Emotion, string> = {
  neutral: '/companion/neutral.png',
  happy: '/companion/happy.png',
  encourage: '/companion/encourage.png',
  sad: '/companion/sad.png',
  sleepy: '/companion/sleepy.png',
  shy: '/companion/shy.png',
  excited: '/companion/excited.png',
  thinking: '/companion/thinking.png',
  love: '/companion/love.png',
  smug: '/companion/smug.png',
  cry: '/companion/cry.png',
  surprised: '/companion/surprised.png'
}

/**
 * 搭子形象:
 *  - 基于本地 PNG 表情帧(默认 6 张: neutral/happy/encourage/sad/sleepy/shy)
 *  - 用户提供的主图覆盖 neutral.png 即可替换角色立绘
 *  - 待机使用 CSS 浮动/呼吸动画,表情切换有淡入淡出过渡
 */
export function Companion() {
  const expanded = useStore((s) => s.expanded)
  const setExpanded = useStore((s) => s.setExpanded)
  const emotion = useStore((s) => s.emotion)
  const idleAway = useStore((s) => s.idleAway)
  const setEmotion = useStore((s) => s.setEmotion)

  const ref = useRef<HTMLDivElement>(null)
  // 单击 vs 双击 判别器: 双击会先触发两次 click, 必须延迟 click 动作等 doubleclick 到来
  const clickTimer = useRef<number | null>(null)
  // 拖动状态 (pointer 事件驱动的 "点击 vs 拖动" 状态机)
  const dragStart = useRef<{ sx: number; sy: number; lastSx: number; lastSy: number } | null>(null)
  const dragging = useRef(false)
  const DRAG_THRESHOLD = 5 // 位移超过 5px 才认定为拖动, 避免手抖误触

  // H1: 挂载时上报 6 张资源的加载状态
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

    // #region debug-point H1:companion-mount
    report('H1', 'src/renderer/src/components/Companion.tsx:mount', 'Companion mounted', {
      emotion,
      idleAway,
      expanded,
      hasRef: !!ref.current,
      winCompanionOk: !!window.companion,
      togglePanelType: typeof window?.companion?.togglePanel,
      setIgnoreMouseType: typeof window?.companion?.setIgnoreMouse
    })
    // H3: 挂载时测量 char-frame 实际可见尺寸和位置
    const t = window.setTimeout(() => {
      if (ref.current) {
        const stage = ref.current.closest('.stage') as HTMLElement | null
        const frame = ref.current.querySelector('.char-frame') as HTMLElement | null
        report('H3', 'Companion.tsx:measure', 'Stage+char-frame measured', {
          stageRect: stage?.getBoundingClientRect() ?? null,
          frameRect: frame?.getBoundingClientRect() ?? null,
          stageStyle: stage ? { h: stage.clientHeight, w: stage.clientWidth } : null,
          compRect: ref.current.getBoundingClientRect(),
          winSize: { w: window.innerWidth, h: window.innerHeight },
          expanded: useStore.getState().expanded
        })
      }
      // H1: 拉取 6 张图片, 看返回状态
      const keys = Object.keys(EMOTION_FILES) as Emotion[]
      keys.forEach(async (k) => {
        const url = EMOTION_FILES[k]
        try {
          const r = await fetch(url, { method: 'GET', cache: 'no-store' })
          const blob = await r.blob()
          report('H1', 'Companion.tsx:img-fetch', `Emotion frame fetched (${k})`, {
            emotion: k,
            url,
            status: r.status,
            ok: r.ok,
            size: blob.size,
            type: blob.type
          })
        } catch (e) {
          report('H1', 'Companion.tsx:img-fetch', `Emotion frame FETCH ERROR (${k})`, {
            emotion: k,
            url,
            err: (e as Error).message
          })
        }
      })
    }, 150)
    // #endregion

    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * 窗口穿透策略:
   *   1) mount 时强制 setIgnoreMouse(false) —— 第一下点击就能命中
   *   2) 鼠标在窗口内移动 → 强制 false (需要交互, 不能穿透)
   *   3) expanded=true 期间 → 强制 false (面板上有按钮/输入框)
   *   4) 鼠标静止 ≥ 800ms 且 expanded=false → 自动 true (不挡后面的 Edge)
   *      这里"静止"用节流的 mousemove 检测, 最后一次 move 后 800ms 没新事件就算静止
   *
   * 关键: forward:true 保证穿透时 mousemove 仍能到达 DOM,
   *       所以 onMove 能在穿透状态下"复活"可点击状态
   */
  useEffect(() => {
    window.companion.setIgnoreMouse(false)

    let idleTimer: number | null = null
    const scheduleIdle = () => {
      if (idleTimer !== null) window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(() => {
        if (!useStore.getState().expanded) {
          window.companion.setIgnoreMouse(true)
        }
        idleTimer = null
      }, 800)
    }
    const cancelIdle = () => {
      if (idleTimer !== null) {
        window.clearTimeout(idleTimer)
        idleTimer = null
      }
    }

    const onMove = () => {
      cancelIdle()
      window.companion.setIgnoreMouse(false)
      scheduleIdle() // 每次移动后重新计时, 静止 800ms 再穿透
    }

    document.addEventListener('mousemove', onMove, true)
    scheduleIdle() // 启动倒计时 (mount 后 800ms 内没鼠标动就穿透)

    return () => {
      document.removeEventListener('mousemove', onMove, true)
      cancelIdle()
    }
  }, [])

  // 面板展开 → 强制可点, 取消穿透倒计时
  useEffect(() => {
    if (expanded) {
      window.companion.setIgnoreMouse(false)
    }
  }, [expanded])

  // 当前帧 + 上一帧(交叉淡入淡出,避免硬切)
  const [prev, setPrev] = useState<Emotion | null>(null)
  // 眨眼: 待机时切到闭眼帧 160ms
  const [blinking, setBlinking] = useState(false)
  const EAT_FRAMES = ['/companion/eat1.png', '/companion/eat2.png', '/companion/eat3.png', '/companion/eat4.png']
  const [eatFrame, setEatFrame] = useState(0)
  const src = useMemo(() => {
    if (expanded) return EAT_FRAMES[eatFrame]
    if (emotion === 'neutral' && blinking) return '/companion/neutral_blink.png'
    return EMOTION_FILES[emotion]
  }, [emotion, blinking, expanded, eatFrame])
  useEffect(() => {
    let cancel = false
    setPrev(emotion)
    // 450ms 后清 prev,让旧帧脱离
    const t = window.setTimeout(() => {
      if (!cancel) setPrev(null)
    }, 450)
    return () => {
      cancel = true
      window.clearTimeout(t)
    }
  }, [emotion])

  // 待机眨眼: 面板收起、不在睡眠、且是 neutral 时, 每 4 秒眨一次
  useEffect(() => {
    if (expanded || idleAway || emotion !== 'neutral') {
      setBlinking(false)
      return
    }
    let off = false
    let closeTimer: number | null = null
    const schedule = () => {
      const wait = 3800 + Math.random() * 1200
      return window.setTimeout(() => {
        if (off) return
        setBlinking(true)
        closeTimer = window.setTimeout(() => {
          if (off) return
          setBlinking(false)
          schedule()
        }, 160)
      }, wait)
    }
    const openTimer = schedule()
    return () => {
      off = true
      window.clearTimeout(openTimer)
      if (closeTimer) window.clearTimeout(closeTimer)
    }
  }, [expanded, idleAway, emotion])

  // 展开详情页: 咀嚼帧循环
  useEffect(() => {
    if (!expanded) return
    const t = window.setInterval(() => setEatFrame((f) => (f + 1) % 4), 450)
    return () => window.clearInterval(t)
  }, [expanded])

  return (
    <div
      ref={ref}
      className={`companion img-mode e-${emotion} `}
      onPointerDown={(e) => {
        // 拖动前确保窗口不穿透, pointer 事件才能正常收到
        window.companion.setIgnoreMouse(false)
        // 记住起点 (screen 坐标 + 上一帧坐标), 算每帧增量
        dragStart.current = { sx: e.screenX, sy: e.screenY, lastSx: e.screenX, lastSy: e.screenY }
        dragging.current = false
        // 捕获指针, 即使鼠标甩出 div 也能收到 move/up
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const start = dragStart.current
        if (!start) return
        const dxTotal = e.screenX - start.sx
        const dyTotal = e.screenY - start.sy
        // 还没进入拖动: 检查阈值
        if (!dragging.current) {
          if (Math.abs(dxTotal) >= DRAG_THRESHOLD || Math.abs(dyTotal) >= DRAG_THRESHOLD) {
            dragging.current = true
            ref.current?.classList.add('dragging')
            // 一旦进入拖动, 取消所有挂起的单击动作
            if (clickTimer.current !== null) {
              window.clearTimeout(clickTimer.current)
              clickTimer.current = null
            }
            e.currentTarget.setPointerCapture(e.pointerId)
          }
          return
        }
        // 正在拖动: 发增量 (不是累积!) —— 避免主进程二次累加导致起飞
        const frameDx = e.screenX - start.lastSx
        const frameDy = e.screenY - start.lastSy
        start.lastSx = e.screenX
        start.lastSy = e.screenY
        if (frameDx !== 0 || frameDy !== 0) {
          window.companion.moveWindow(frameDx, frameDy)
        }
      }}
      onPointerUp={(e) => {
        const wasDragging = dragging.current
        ref.current?.classList.remove('dragging')
        dragStart.current = null
        dragging.current = false
        try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}

        if (wasDragging) return // 真的拖过 → 不触发 click 动作

        // 没拖 → 这是一次 click (双击也会先触发两次 click, 这里用延迟判别)
        if (clickTimer.current !== null) {
          window.clearTimeout(clickTimer.current)
          clickTimer.current = null
        }
        clickTimer.current = window.setTimeout(() => {
          clickTimer.current = null
          const next = !useStore.getState().expanded
          setExpanded(next)
          window.companion.togglePanel(next)
        }, 260)
      }}
      onDoubleClick={() => {
        // 清掉挂起的单击动作 → 让双击只切表情不触发展开
        if (clickTimer.current !== null) {
          window.clearTimeout(clickTimer.current)
          clickTimer.current = null
        }
        const seq: Emotion[] = ['happy', 'shy', 'encourage', 'smug', 'love', 'thinking', 'excited', 'surprised']
        const pick = seq[Math.floor(Math.random() * seq.length)]
        setEmotion(pick, 3500)
      }}
      title="点我聊天 / 双击换个表情 ~"
    >
      <div className="char-frame">
        {prev && prev !== emotion && (
          <img
            key={'p-' + prev}
            className="char-img prev"
            src={EMOTION_FILES[prev]}
            alt=""
            draggable={false}
          />
        )}
        <img
          key={'c-' + emotion}
          className="char-img current"
          src={src}
          alt="companion"
          draggable={false}
          onLoad={(e) => {
            // #region debug-point H1:img-onload
            try {
              const t = e.currentTarget
              void fetch('http://127.0.0.1:7777/event', { method: 'POST', body: JSON.stringify({ sessionId: 'companion-ui-bug', runId: 'pre', hypothesisId: 'H1', location: 'Companion.tsx:img-onload:' + emotion, msg: `[DEBUG] Image onLoad fired (${emotion})`, data: { w: t.naturalWidth, h: t.naturalHeight, src: t.src, clientW: t.clientWidth, clientH: t.clientHeight, offsetParent: !!t.offsetParent }, ts: Date.now() }) }).catch(() => {})
            } catch {}
            // #endregion
          }}
          onError={(e) => {
            // 图加载失败时显示占位: 不崩溃
            const t = e.currentTarget
            if (!t.dataset.fallback) {
              t.dataset.fallback = '1'
              t.style.visibility = 'hidden'
              // #region debug-point H1:img-onerror
              try {
                void fetch('http://127.0.0.1:7777/event', { method: 'POST', body: JSON.stringify({ sessionId: 'companion-ui-bug', runId: 'pre', hypothesisId: 'H1', location: 'Companion.tsx:img-onerror:' + emotion, msg: `[DEBUG] Image onError fired (${emotion})`, data: { src: t.src }, ts: Date.now() }) }).catch(() => {})
              } catch {}
              // #endregion
            }
          }}
        />

      </div>
      {idleAway && <div className="zzz">💤</div>}
    </div>
  )
}
