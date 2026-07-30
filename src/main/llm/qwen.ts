import { profileGet, profileSet, addChat, recentChat, recentMemories } from '../db'
import { PERSONAS, DEFAULT_PERSONA, type PersonaId } from './persona'

/** 通义千问 OpenAI 兼容端点 */
const QWEN_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const DEFAULT_MODEL = 'qwen-turbo'

export function getApiKey(): string {
  return profileGet('qwen_api_key') || process.env.QWEN_API_KEY || ''
}

export function setApiKey(key: string): void {
  profileSet('qwen_api_key', key)
}

export function getModel(): string {
  return profileGet('qwen_model') || DEFAULT_MODEL
}

export function setModel(model: string): void {
  profileSet('qwen_model', model)
}

export function getPersona(): PersonaId {
  const p = profileGet('persona') as PersonaId | null
  return p && p in PERSONAS ? p : DEFAULT_PERSONA
}

export function setPersona(id: PersonaId): void {
  profileSet('persona', id)
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 拼装上下文:人格 system prompt + 相关记忆 + 最近对话 */
function buildMessages(userText: string): ChatMessage[] {
  const persona = PERSONAS[getPersona()]
  const memories = recentMemories(8)
    .map((m) => `- [${m.kind}] ${m.content}`)
    .join('\n')
  const memoryBlock = memories ? `\n\n【你记得的关于用户的事】\n${memories}` : ''

  const recent = recentChat(10).reverse().map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content
  }))

  return [
    { role: 'system', content: persona.systemPrompt + memoryBlock },
    ...recent,
    { role: 'user', content: userText }
  ]
}

/**
 * 流式对话。逐 token 回调,完成后返回完整文本。
 * 失败时抛出错误,由调用方处理。
 */
export async function chatStream(
  userText: string,
  onToken: (delta: string) => void
): Promise<string> {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('未配置通义千问 API Key,请在设置中填入。')

  const messages = buildMessages(userText)

  const resp = await fetch(`${QWEN_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: getModel(),
      messages,
      stream: true
    })
  })

  if (!resp.ok || !resp.body) {
    const txt = await resp.text().catch(() => '')
    throw new Error(`通义千问请求失败 ${resp.status}: ${txt.slice(0, 200)}`)
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let full = ''

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE: 按 \n\n 分块解析
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      const delta = parseSseChunk(chunk)
      if (delta) {
        full += delta
        onToken(delta)
      }
    }
  }

  if (full) {
    addChat('user', userText)
    addChat('assistant', full)
  }
  return full
}

function parseSseChunk(chunk: string): string {
  // 每行形如 data: {...}
  for (const line of chunk.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const data = trimmed.slice(5).trim()
    if (data === '[DONE]') return ''
    try {
      const json = JSON.parse(data)
      return json?.choices?.[0]?.delta?.content ?? ''
    } catch {
      return ''
    }
  }
  return ''
}

// ---------- 计划自然语言拆解 ----------

export interface PlannedTask {
  title: string
  plan_min: number
}

/**
 * 把自然语言计划(如「今天复习高数第三章 + 写英语作文」)拆解成任务列表。
 * 调用通义千问返回 JSON,解析失败则回退到按分隔符切分。
 */
export async function planTasks(naturalText: string): Promise<PlannedTask[]> {
  const apiKey = getApiKey()
  if (!apiKey) return fallbackPlan(naturalText)

  const system = `你是学习计划助手。把用户的计划拆成 1-6 个可执行的小任务。
严格只输出 JSON 数组,不要任何解释、不要 markdown 代码块。
格式:[{"title":"任务名(简短动词开头)","plan_min":预计分钟数}]
plan_min 取整数,合理估时,通常 15-90。`

  try {
    const text = await chatOnce(system, naturalText)
    const json = extractJson(text)
    if (Array.isArray(json)) {
      return json
        .map((t) => ({
          title: String(t?.title ?? '').trim(),
          plan_min: Number(t?.plan_min) || 0
        }))
        .filter((t) => t.title)
        .slice(0, 6)
    }
  } catch {
    // fallthrough
  }
  return fallbackPlan(naturalText)
}

/** 非流式单次请求,用于内部结构化任务(拆计划、日记寄语等)。 */
export async function chatOnce(system: string, user: string): Promise<string> {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('no api key')

  const resp = await fetch(`${QWEN_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: getModel(),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      stream: false
    })
  })
  if (!resp.ok) throw new Error(`qwen ${resp.status}`)
  const data: any = await resp.json()
  return data?.choices?.[0]?.message?.content ?? ''
}

/** 从可能含杂质的文本里提取首个 JSON 数组。 */
function extractJson(text: string): unknown {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

function fallbackPlan(text: string): PlannedTask[] {
  // 按 + 、 ， ; 等分隔符切分
  const parts = text
    .split(/[+,，;；\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.slice(0, 6).map((title) => ({ title, plan_min: 25 }))
}
