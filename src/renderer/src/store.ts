import { create } from 'zustand'
import type { TaskRow } from '../../shared/types'

export interface ChatMsg {
  id: number
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

type Tab = 'chat' | 'tasks' | 'settings' | 'diary' | 'pomodoro' | 'activity'

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
}

let msgId = 1

export const useStore = create<AppState>((set) => ({
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
      return { messages: msgs, streaming: false }
    }),

  setTasks: (t) => set({ tasks: t }),
  setPersonaId: (id) => set({ personaId: id }),
  setApiKey: (k) => set({ apiKey: k }),
  setModel: (m) => set({ model: m }),
  setIdleAway: (v) => set({ idleAway: v })
}))
