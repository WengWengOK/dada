import { useEffect, useState } from 'react'
import { useStore } from '../store'

export function Settings() {
  const personaId = useStore((s) => s.personaId)
  const apiKey = useStore((s) => s.apiKey)
  const model = useStore((s) => s.model)
  const setPersonaId = useStore((s) => s.setPersonaId)
  const setApiKeyStore = useStore((s) => s.setApiKey)
  const setModelStore = useStore((s) => s.setModel)

  const [personas, setPersonas] = useState<{ id: string; name: string; emoji: string }[]>([])
  const [keyInput, setKeyInput] = useState(apiKey)

  useEffect(() => {
    window.companion.getApiKey().then((k) => {
      setKeyInput(k)
      setApiKeyStore(k)
    })
    window.companion.getModel().then((m) => setModelStore(m))
    window.companion.getPersona().then((id) => setPersonaId(id))
    window.companion.listPersonas().then(setPersonas)
  }, [])

  const saveKey = async () => {
    await window.companion.setApiKey(keyInput.trim())
    setApiKeyStore(keyInput.trim())
    useStore.getState().showBubble('保存好啦~')
  }

  const pickPersona = async (id: string) => {
    await window.companion.setPersona(id)
    setPersonaId(id)
  }

  return (
    <div className="settings">
      <label>通义千问 API Key</label>
      <div className="row">
        <input
          type="password"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          placeholder="sk-..."
        />
        <button onClick={saveKey}>保存</button>
      </div>
      <p className="hint">在阿里云百炼控制台获取,本地保存不上传。</p>

      <label>模型</label>
      <select value={model} onChange={async (e) => {
        const m = e.target.value
        await window.companion.setModel(m)
        setModelStore(m)
      }}>
        <option value="qwen-turbo">qwen-turbo(快·省)</option>
        <option value="qwen-plus">qwen-plus(平衡)</option>
        <option value="qwen-max">qwen-max(最强)</option>
      </select>

      <label>搭子人格</label>
      <div className="persona-grid">
        {personas.map((p) => (
          <button
            key={p.id}
            className={`persona ${personaId === p.id ? 'active' : ''}`}
            onClick={() => pickPersona(p.id)}
          >
            <span className="emoji">{p.emoji}</span>
            <span>{p.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
