import { getProvider } from './providers.js'

const ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_MAX_TOKENS = 4096

const THINKING_BUDGET = { low: 2048, medium: 8192, high: 16384 }

// Normalize the client's `thinking` request field into
// { enabled, effort, budgetTokens } | null.
// Accepted shapes: boolean, 'low'|'medium'|'high', or
// { enabled/type, effort, budgetTokens/budget_tokens }.
function normalizeReasoning(thinking) {
  let enabled = false
  let effort = null
  let budgetTokens
  if (thinking === true) enabled = true
  else if (typeof thinking === 'string') {
    if (['low', 'medium', 'high'].includes(thinking.toLowerCase())) {
      enabled = true
      effort = thinking.toLowerCase()
    }
  } else if (thinking && typeof thinking === 'object') {
    if (thinking.type === 'enabled') enabled = true
    else if (typeof thinking.enabled === 'boolean') enabled = thinking.enabled
    if (['low', 'medium', 'high'].includes(String(thinking.effort || '').toLowerCase())) {
      effort = String(thinking.effort).toLowerCase()
    }
    const budget = Number(thinking.budgetTokens ?? thinking.budget_tokens)
    if (Number.isFinite(budget) && budget > 0) budgetTokens = budget
  }
  if (!enabled) return null
  return { enabled, effort, budgetTokens }
}

function reasoningEffort(reasoning) {
  if (!reasoning?.enabled) return null
  if (['low', 'medium', 'high'].includes(reasoning.effort)) return reasoning.effort
  return 'medium'
}

function contentToText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n')
}

function transformBlockForAnthropic(block) {
  if (block.type === 'text') return { type: 'text', text: block.text }
  if (block.type === 'image') {
    return { type: 'image', source: { type: 'base64', media_type: block.mediaType, data: block.data } }
  }
  if (block.type === 'file') {
    const lang = block.language || 'text'
    return { type: 'text', text: `File: ${block.name}\n\`\`\`${lang}\n${block.data}\n\`\`\`` }
  }
  return { type: 'text', text: '' }
}

function transformBlockForOpenAI(block) {
  if (block.type === 'text') return { type: 'text', text: block.text }
  if (block.type === 'image') {
    return { type: 'image_url', image_url: { url: `data:${block.mediaType};base64,${block.data}` } }
  }
  if (block.type === 'file') {
    const lang = block.language || 'text'
    return { type: 'text', text: `File: ${block.name}\n\`\`\`${lang}\n${block.data}\n\`\`\`` }
  }
  return { type: 'text', text: '' }
}

function transformMessages(messages, providerId) {
  const transform = providerId === 'anthropic' ? transformBlockForAnthropic : transformBlockForOpenAI
  return messages.map((m) => {
    if (typeof m.content === 'string') return m
    if (!Array.isArray(m.content)) return m
    return { ...m, content: m.content.map(transform) }
  })
}

function splitMessages(messages, providerId) {
  const system = []
  const rest = []
  const transformed = transformMessages(messages, providerId)
  for (const m of transformed) {
    if (m.role === 'system') system.push(contentToText(m.content))
    else rest.push({ role: m.role, content: m.content })
  }
  return { system: system.join('\n\n'), messages: rest }
}

async function* sseLines(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) yield part
  }
  if (buffer.trim()) yield buffer
}

function parseData(block) {
  const lines = block.split('\n')
  const out = []
  for (const line of lines) {
    if (line.startsWith('data:')) out.push(line.slice(5).trim())
    else if (line.startsWith('event:')) out.event = line.slice(6).trim()
  }
  return out
}

async function readError(response) {
  let detail = ''
  try {
    detail = (await response.text()).slice(0, 600)
  } catch {}
  const status = response.status
  let hint = ''
  if (status === 401) hint = ' Check the API key.'
  else if (status === 404) hint = ' Check the model id and base URL.'
  else if (status === 429) hint = ' Rate limited or out of credits.'
  throw new Error(`HTTP ${status} from provider.${hint}\n${detail}`)
}

function assertOk(response) {
  if (!response.ok) return readError(response)
  return null
}

async function* streamAnthropic({ messages, model, apiKey, baseUrl, temperature, maxTokens, reasoning, signal }) {
  const { system, messages: msgs } = splitMessages(messages, 'anthropic')
  const requestedBudget = reasoning?.enabled
    ? Math.max(
        1024,
        Number.isFinite(reasoning.budgetTokens)
          ? reasoning.budgetTokens
          : THINKING_BUDGET[reasoning.effort] || THINKING_BUDGET.medium
      )
    : null
  // Anthropic requires max_tokens to exceed the thinking budget.
  const effectiveMax = requestedBudget
    ? Math.max(maxTokens || DEFAULT_MAX_TOKENS, requestedBudget + 2048)
    : maxTokens || DEFAULT_MAX_TOKENS
  // Extended thinking requires temperature to be unset (or 1).
  const body = {
    model,
    max_tokens: effectiveMax,
    system: system || undefined,
    messages: msgs,
    stream: true,
    temperature: requestedBudget ? undefined : temperature,
    ...(requestedBudget ? { thinking: { type: 'enabled', budget_tokens: requestedBudget } } : {}),
  }
  const response = await fetch(`${baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
    signal,
  })
  const err = await assertOk(response)
  if (err) throw err

  for await (const block of sseLines(response, signal)) {
    const data = parseData(block)
    if (!data.length) continue
    const type = data.event
    const json = data[0]
    if (type === 'content_block_delta') {
      try {
        const parsed = JSON.parse(json)
        if (parsed.delta?.type === 'text_delta' && parsed.delta.text) {
          yield { type: 'text', text: parsed.delta.text }
        } else if (parsed.delta?.type === 'thinking_delta' && parsed.delta.thinking) {
          yield { type: 'thinking', text: parsed.delta.thinking }
        }
      } catch {}
    } else if (type === 'message_start') {
      try {
        const usage = JSON.parse(json).message?.usage
        if (usage?.input_tokens) yield { type: 'usage', input: usage.input_tokens }
      } catch {}
    } else if (type === 'message_delta') {
      try {
        const usage = JSON.parse(json).usage
        if (usage?.output_tokens) yield { type: 'usage', output: usage.output_tokens }
      } catch {}
    } else if (type === 'error') {
      throw new Error(`Provider error: ${json}`)
    }
  }
}

async function* streamOpenAI({ messages, model, apiKey, baseUrl, temperature, maxTokens, reasoning, signal }) {
  const headers = { 'content-type': 'application/json' }
  if (apiKey) headers.authorization = `Bearer ${apiKey}`

  const { messages: msgs } = splitMessages(messages, 'openai')

  // Only send reasoning_effort when the caller explicitly asked for thinking;
  // unknown params can trip strict OpenAI-compatible servers.
  const effort = reasoningEffort(reasoning)
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: msgs,
      stream: true,
      stream_options: { include_usage: true },
      temperature,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      ...(effort ? { reasoning_effort: effort } : {}),
    }),
    signal,
  })
  const err = await assertOk(response)
  if (err) throw err

  for await (const block of sseLines(response, signal)) {
    const data = parseData(block)
    const first = data[0]
    if (first === '[DONE]') break
    if (!first) continue
    try {
      const parsed = JSON.parse(first)
      if (parsed.object?.startsWith('orchestrator.')) {
        yield { type: 'meta', meta: parsed }
        continue
      }
      if (parsed.usage) {
        yield {
          type: 'usage',
          input: parsed.usage.prompt_tokens || undefined,
          output: parsed.usage.completion_tokens || undefined,
        }
      }
      const delta = parsed.choices?.[0]?.delta
      // Reasoning-capable OpenAI-compatible backends (DeepSeek, GLM, OpenCode
      // Go, Ollama, …) stream chain-of-thought deltas here.
      const thinking = typeof delta?.reasoning_content === 'string' ? delta.reasoning_content : delta?.reasoning
      if (typeof thinking === 'string' && thinking) yield { type: 'thinking', text: thinking }
      const text = delta?.content
      if (text) yield { type: 'text', text }
      if (parsed.error) throw new Error(`Provider error: ${parsed.error.message}`)
    } catch (e) {
      if (e.message?.startsWith('Provider error')) throw e
      if (e instanceof SyntaxError) continue
      throw e
    }
  }
}

export async function* streamChat({ providerId, messages, model, apiKey, baseUrl, temperature, maxTokens, thinking, signal }) {
  const provider = getProvider(providerId)
  if (!provider) throw new Error(`Unknown provider: ${providerId}`)

  const reasoning = normalizeReasoning(thinking)

  const defaultBase = provider.baseUrl.replace(/\/+$/, '')
  const requestedBase = baseUrl ? baseUrl.replace(/\/+$/, '') : ''
  const onDefaultBase = !requestedBase || requestedBase === defaultBase

  // Credential-safety rules:
  // 1. A custom base URL is honored only for keyless providers (local/compatible
  //    endpoints). Credentialed providers must not be redirected — otherwise a
  //    crafted base URL turns this server into a key-exfiltration proxy.
  // 2. Provider env keys are attached only when calling the registered default
  //    base. A redirected request gets at most the key the client sent itself.
  if (!onDefaultBase && !provider.keyless) {
    throw new Error(
      'Custom base URLs are not allowed for credentialed providers. Configure the endpoint on the server instead.'
    )
  }
  const resolvedBase = onDefaultBase ? defaultBase : requestedBase
  const resolvedKey = apiKey || (onDefaultBase ? process.env[provider.envKey] || '' : '')

  if (!resolvedKey && !provider.keyless) {
    throw new Error(
      `Missing ${provider.envKey}. Add it to .env or set it in Settings.`
    )
  }

  const ctx = {
    messages,
    model,
    apiKey: resolvedKey,
    baseUrl: resolvedBase,
    temperature,
    maxTokens,
    reasoning,
    signal,
  }

  // Every request streams a routing header + summary first/last so the UI can
  // show which endpoint actually served the response — for any provider, not
  // just the orchestrator. Never includes keys or headers.
  yield {
    type: 'meta',
    meta: { object: 'proxy.request', provider: providerId, model, baseUrl: resolvedBase },
  }

  const started = Date.now()
  let chunkCount = 0
  let inputTokens
  let outputTokens

  const inner =
    providerId === 'anthropic' ? streamAnthropic(ctx) : streamOpenAI(ctx)
  for await (const event of inner) {
    if (event.type !== 'meta') chunkCount++
    if (event.type === 'usage') {
      inputTokens = event.input ?? inputTokens
      outputTokens = event.output ?? outputTokens
    }
    yield event
  }

  yield {
    type: 'meta',
    meta: {
      object: 'proxy.done',
      provider: providerId,
      model,
      baseUrl: resolvedBase,
      chunkCount,
      inputTokens,
      outputTokens,
      durationMs: Date.now() - started,
    },
  }
}