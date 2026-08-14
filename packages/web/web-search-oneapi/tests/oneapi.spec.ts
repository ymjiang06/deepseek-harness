import { afterEach, describe, expect, it, vi } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  OneApiSearchProvider,
  ONEAPI_PROVIDER_ID,
  mapOneApiResponse,
} from '@deepseek-ai/dsh-web-search-oneapi'

const options = {
  apiKey: 'oneapi-key',
  baseURL: 'https://oneapi.test',
  model: 'DeepSeek-V4-Pro',
  maxOutputTokens: 4096,
  searchContextSize: 'medium' as const,
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OneAPI response mapping', () => {
  it('maps native search results and the strict JSON response envelope', () => {
    expect(mapOneApiResponse({
      content: [
        { type: 'server_tool_use', name: 'web_search', input: { query: 'hello' } },
        {
          type: 'web_search_tool_result',
          content: [{ type: 'web_search_result', url: 'https://a.test', title: 'A', snippet: 'summary' }],
        },
        {
          type: 'text',
          text: JSON.stringify({
            content: 'A sourced answer',
            sources: [{ url: 'https://b.test', title: 'B', snippet: 'excerpt' }],
          }),
        },
      ],
    })).toEqual({
      content: 'A sourced answer',
      sources: [
        { url: 'https://a.test', title: 'A', snippet: 'summary' },
        { url: 'https://b.test', title: 'B', snippet: 'excerpt' },
      ],
      truncated: false,
    })
  })

  it('extracts a URL when the gateway omits the result block content', () => {
    expect(mapOneApiResponse({
      content: [
        { type: 'web_search_tool_result' },
        { type: 'text', text: 'Source: https://a.test/page.' },
      ],
    })).toEqual({
      content: 'Source: https://a.test/page.',
      sources: [{ url: 'https://a.test/page' }],
      truncated: false,
    })
  })

  it('ignores non-http sources and tolerates an ordinary response message', () => {
    expect(mapOneApiResponse({
      content: [{
        type: 'text',
        text: 'answer',
        citations: [{ url: 'file:///tmp/a' }],
      }],
    })).toEqual({ content: 'answer', sources: [], truncated: false })
  })
})

describe('OneAPI search provider', () => {
  it('uses the Anthropic Messages web_search request shape', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      content: [
        { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://a.test' }] },
        {
          type: 'text',
          text: JSON.stringify({ content: 'answer', sources: [{ url: 'https://a.test' }] }),
        },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new OneApiSearchProvider(options)
    expect(provider.id).toBe(ONEAPI_PROVIDER_ID)
    expect(provider.available()).toBe(true)
    await expect(provider.search({ query: 'hello' })).resolves.toMatchObject({ content: 'answer' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://oneapi.test/v1/messages')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer oneapi-key')
    expect(headers['x-api-key']).toBe('oneapi-key')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    const body = JSON.parse(init.body as string) as { messages: [{ content: [{ text: string }] }] }
    expect(body).toMatchObject({
      model: 'DeepSeek-V4-Pro',
      max_tokens: 4096,
      messages: [{
        role: 'user',
      }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    })
    expect(body.messages[0].content[0].text).toContain('hello')
  })

  it('resolves a credential reference per request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ content: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await new OneApiSearchProvider({ ...options, apiKey: '', apiKeyEnv: credentialRef('ONEAPI_API_KEY'), resolveApiKey: async () => 'resolved-key' })
      .search({ query: 'q' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer resolved-key')
  })

  it('maps HTTP errors and forwards cancellation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'bad key' } }, { status: 401 })))
    await expect(new OneApiSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'bad key' }))

    const controller = new AbortController()
    controller.abort()
    await expect(new OneApiSearchProvider(options).search({ query: 'q' }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })
})
