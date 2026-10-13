import { create } from 'zustand'
import type { TaskRow } from '../../shared/types'

export interface ChatMsg {
  id: number
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

type Tab = 'chat' | 'tasks' | 'settings' | 'diary' | 'pomodoro' | 'activity'
export type Emotion =
  | 'neutral'
  | 'happy'
  | 'encourage'
  | 'sad'
  | 'sleepy'
  | 'shy'
  | 'excited'
  | 'thinking'
  | 'love'
  | 'smug'
  | 'cry'
  | 'surprised'

interface AppState {
  expanded: boolean
  tab: Tab
  messages: ChatMsg[]
  streaming: boolean
  greeting: string
  bubble: string | null
  tasks: TaskRow[]
  personaId: string
  apiKey: string
  model: string
  idleAway: boolean
  emotion: Emotion

  setExpanded: (v: boolean) => void
  setTab: (t: Tab) => void
  setGreeting: (s: string) => void
  showBubble: (s: string | null) => void
  setStreaming: (v: boolean) => void
  appendAssistant: (delta: string) => void
  pushUser: (text: string) => void
  startAssistant: () => void
  finishAssistant: () => void
  setTasks: (t: TaskRow[]) => void
  setPersonaId: (id: string) => void
  setApiKey: (k: string) => void
  setModel: (m: string) => void
  setIdleAway: (v: boolean) => void
  setEmotion: (e: Emotion, holdMs?: number) => void
}

let msgId = 1

export const useStore = create<AppState>((set, get) => ({
  expanded: false,
  tab: 'chat',
  messages: [],
  streaming: false,
  greeting: '',
  bubble: null,
  tasks: [],
  personaId: 'cheerful',
  apiKey: '',
  model: 'qwen-turbo',
  idleAway: false,
  emotion: 'neutral',

  setExpanded: (v) => set({ expanded: v }),
  setTab: (t) => set({ tab: t }),
  setGreeting: (s) => set({ greeting: s, bubble: s }),
  showBubble: (s) => set({ bubble: s }),
  setStreaming: (v) => set({ streaming: v }),

  pushUser: (text) =>
    set((st) => ({
      messages: [...st.messages, { id: msgId++, role: 'user', content: text }]
    })),

  startAssistant: () =>
    set((st) => ({
      streaming: true,
      messages: [...st.messages, { id: msgId++, role: 'assistant', content: '', streaming: true }]
    })),

  appendAssistant: (delta) =>
    set((st) => {
      const msgs = [...st.messages]
      const last = msgs[msgs.length - 1]
      if (last && last.role === 'assistant' && last.streaming) {
        msgs[msgs.length - 1] = { ...last, content: last.content + delta }
      }
      return { messages: msgs }
    }),

  finishAssistant: () =>
    set((st) => {
      const msgs = [...st.messages]
      const last = msgs[msgs.length - 1]
      if (last && last.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, streaming: false }
      }
      // 思考结束回退情绪
      return { messages: msgs, streaming: false, emotion: st.idleAway ? 'sleepy' : 'neutral' }
    }),

  setTasks: (t) => set({ tasks: t }),
  setPersonaId: (id) => set({ personaId: id }),
  setApiKey: (k) => set({ apiKey: k }),
  setModel: (m) => set({ model: m }),
  setIdleAway: (v) => {
    set({
      idleAway: v,
      emotion: v
        ? 'sleepy'
        : ['sleepy', 'cry'].includes(get().emotion)
          ? 'neutral'
          : get().emotion
    })
  },

  setEmotion: (e, holdMs) => {
    const prev = get().emotion
    set({ emotion: e })
    if (holdMs && holdMs > 0) {
      // holdMs 之后回退到 neutral；但若期间用户再次 setEmotion 则忽略本次回退
      // (用非严格比对: 如果当前仍等于我们设置的 e 才回退)
      setTimeout(() => {
        if (get().emotion === e) {
          const fallBack: Emotion = get().idleAway ? 'sleepy' : 'neutral'
          set({ emotion: fallBack })
        }
      }, holdMs)
      // 避免 prev 未使用的 TS 警告
      void prev
    }
  }
}))
