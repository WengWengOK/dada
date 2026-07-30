import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'

export function ChatPanel() {
  const messages = useStore((s) => s.messages)
  const streaming = useStore((s) => s.streaming)
  const pushUser = useStore((s) => s.pushUser)
  const startAssistant = useStore((s) => s.startAssistant)
  const appendAssistant = useStore((s) => s.appendAssistant)
  const finishAssistant = useStore((s) => s.finishAssistant)
  const showBubble = useStore((s) => s.showBubble)
  const apiKey = useStore((s) => s.apiKey)

  const [input, setInput] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  // 订阅流式 token
  useEffect(() => {
    const offToken = window.companion.onChatToken((delta) => appendAssistant(delta))
    const offDone = window.companion.onChatDone(() => finishAssistant())
    const offErr = window.companion.onChatError((msg) => {
      appendAssistant(`\n[出错] ${msg}`)
      finishAssistant()
    })
    return () => {
      offToken()
      offDone()
      offErr()
    }
  }, [appendAssistant, finishAssistant])

  // 自动滚到底
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const send = () => {
    const text = input.trim()
    if (!text || streaming) return
    if (!apiKey) {
      showBubble('还没配置通义千问 API Key 哦,去设置里填一下吧~')
      return
    }
    pushUser(text)
    startAssistant()
    window.companion.sendChat(text)
    setInput('')
  }

  return (
    <div className="chat">
      <div className="msg-list" ref={listRef}>
        {messages.length === 0 && (
          <div className="empty">和搭子说点什么吧,比如「今天要复习高数第三章」~</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            <div className="bubble">{m.content || (m.streaming ? '…' : '')}</div>
          </div>
        ))}
      </div>
      <div className="input-row">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="说点什么…"
          disabled={streaming}
        />
        <button onClick={send} disabled={streaming}>
          发送
        </button>
      </div>
    </div>
  )
}
