async function json(url, options) {
  const res = await fetch(url, options)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

export function fetchProviders() {
  return json('/api/providers')
}

export function fetchModels(providerId, apiKey, baseUrl) {
  const params = new URLSearchParams()
  if (baseUrl) params.set('baseUrl', baseUrl)
  const qs = params.toString()
  // Keys ride in a header, never in the query string, so they can't leak into
  // access logs, proxy logs, or browser history.
  return json(`/api/providers/${providerId}/models${qs ? `?${qs}` : ''}`, {
    headers: apiKey ? { 'x-api-key': apiKey } : {},
  })
}

/**
 * Streams a chat completion over SSE via fetch, since EventSource cannot POST.
 * Calls onEvent for each normalized event: start | thinking | text | usage | error | done.
 * Returns an abort function.
 */
export function streamChat({ provider, model, messages, apiKey, baseUrl, temperature, thinking, onRawEvent }, onEvent) {
  const controller = new AbortController()

  const run = async () => {
    let response
    try {
      response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider, model, messages, apiKey, baseUrl, temperature, thinking }),
        signal: controller.signal,
      })
    } catch (e) {
      if (e.name !== 'AbortError') onEvent({ type: 'error', error: e.message })
      return
    }

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '')
      onEvent({ type: 'error', error: `HTTP ${response.status}. ${detail.slice(0, 300)}` })
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() ?? ''

        for (const chunk of chunks) {
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data:')) continue
            const payload = line.slice(5).trim()
            if (!payload) continue
            try {
              const parsed = JSON.parse(payload)
              onRawEvent?.({ t: Date.now(), ...parsed })
              onEvent(parsed)
            } catch {}
          }
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') onEvent({ type: 'error', error: e.message })
    }
  }

  run()
  return () => controller.abort()
}