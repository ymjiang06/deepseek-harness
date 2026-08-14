/**
 * OneAPI web search over the Anthropic-compatible Messages endpoint. This
 * mirrors the request that successfully enables web search for DeepSeek-V4-Pro
 * through the local OneAPI gateway. It deliberately bypasses ctx.llm, like
 * the other web providers, so the auxiliary search request owns its wire format.
 * @module @deepseek-ai/dsh-web-search-oneapi/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type {
  OneApiMessageOutput,
  OneApiResponse,
  OneApiSearchSource,
  OneApiSearchRequest,
  OneApiUrlCitation,
  OneApiWebSearchCall,
} from './types.ts'

export const ONEAPI_PROVIDER_ID = 'oneapi'
export const ONEAPI_DEFAULT_BASE_URL = 'https://oneapi-comate.baidu-int.com'
export const ONEAPI_DEFAULT_MODEL = 'DeepSeek-V4-Pro'
export const ONEAPI_DEFAULT_MAX_OUTPUT_TOKENS = 4096
export const ONEAPI_DEFAULT_SEARCH_CONTEXT_SIZE = 'medium' as const

const USER_AGENT = 'deepseek-harness/0.0.1'
const API_VERSION = '2023-06-01'
const SEARCH_MAX_USES = { low: 3, medium: 5, high: 10 } as const
const URL_PATTERN = /https?:\/\/[^\s<>"'`\)\]}]+/gu

export type OneApiSearchContextSize = 'low' | 'medium' | 'high'

export interface OneApiSearchProviderOptions {
  apiKey?: string
  resolveApiKey?: () => Promise<string | undefined>
  apiKeyEnv?: CredentialRef
  /** OneAPI/Anthropic base URL; `/v1/messages` is appended. */
  baseURL: string
  model: string
  maxOutputTokens: number
  searchContextSize: OneApiSearchContextSize
}

/** Map an Anthropic search result or URL annotation to the normalized web source. */
export function mapOneApiSource(source: OneApiSearchSource | OneApiUrlCitation): WebSearchSource | undefined {
  const url = typeof source.url === 'string' ? source.url.trim() : ''
  if (!isHttpUrl(url)) return undefined
  const title = typeof source.title === 'string' ? source.title.trim() : ''
  const snippet = 'snippet' in source && typeof source.snippet === 'string'
    ? source.snippet.trim()
    : 'cited_text' in source && typeof source.cited_text === 'string'
      ? source.cited_text.trim()
      : ''
  const publishedAt = 'page_age' in source && typeof source.page_age === 'string'
    ? source.page_age.trim()
    : 'published_at' in source && typeof source.published_at === 'string'
      ? source.published_at.trim()
      : 'publishedAt' in source && typeof source.publishedAt === 'string'
        ? source.publishedAt.trim()
        : ''
  return {
    url,
    ...title.length > 0 ? { title } : {},
    ...snippet.length > 0 ? { snippet } : {},
    ...publishedAt.length > 0 ? { publishedAt } : {},
  }
}

interface SearchEnvelope {
  content?: string
  sources?: OneApiSearchSource[]
}

/** Map the Anthropic Messages response, including OneAPI's JSON/text fallbacks. */
export function mapOneApiResponse(response: OneApiResponse): WebSearchResult {
  const blocks = response.content ?? []
  const textBlocks = blocks
    .filter((block): block is OneApiMessageOutput => block.type === 'text')
    .flatMap(block => typeof block.text === 'string' ? [block.text] : [])
  const envelopes = textBlocks.flatMap((text) => {
    const parsed = parseSearchEnvelope(text)
    return parsed === undefined ? [] : [parsed]
  })

  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  const add = (source: WebSearchSource | undefined): void => {
    if (source === undefined || seen.has(source.url)) return
    seen.add(source.url)
    sources.push(source)
  }

  for (const item of blocks) {
    if (item.type !== 'web_search_tool_result') continue
    const result = item as OneApiWebSearchCall
    for (const source of result.content ?? []) add(mapOneApiSource(source))
  }
  for (const item of blocks) {
    if (item.type !== 'text') continue
    const text = item as OneApiMessageOutput
    for (const citation of text.citations ?? []) add(mapOneApiSource(citation))
  }
  for (const envelope of envelopes) {
    for (const source of envelope.sources ?? []) add(mapOneApiSource(source))
  }
  if (sources.length === 0) {
    for (const text of textBlocks) {
      for (const url of extractHttpUrls(text)) add({ url })
    }
  }

  const content = envelopes.find(envelope => envelope.content !== undefined)?.content
    ?? textBlocks.filter(text => parseSearchEnvelope(text) === undefined).join('\n\n')
  return {
    ...content.length > 0 ? { content } : {},
    sources,
    truncated: false,
  }
}

/** The OneAPI Anthropic Messages-backed search provider. */
export class OneApiSearchProvider implements WebSearchProvider {
  readonly id = ONEAPI_PROVIDER_ID

  private readonly resolveOptions: () => OneApiSearchProviderOptions

  constructor(options: OneApiSearchProviderOptions | (() => OneApiSearchProviderOptions)) {
    this.resolveOptions = typeof options === 'function' ? options : () => options
  }

  available(): boolean {
    const options = this.resolveOptions()
    return ((options.apiKey?.length ?? 0) > 0
      || options.resolveApiKey !== undefined)
      ? URL.canParse(options.baseURL)
        && options.model.length > 0
        && isPositiveInteger(options.maxOutputTokens)
      : false
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.resolveOptions()
    const apiKey = await this.apiKey(options, signal)
    throwIfAborted(signal)
    const endpoint = messagesEndpoint(options.baseURL)
    const body: OneApiSearchRequest = {
      model: options.model,
      max_tokens: options.maxOutputTokens,
      messages: [{
        role: 'user',
        content: [{
          type: 'text',
          text: `Perform a web search for the query: ${request.query}. After searching, respond with ONLY a valid JSON object using exactly this shape: {"content":"brief answer","sources":[{"url":"https://example.com","title":"source title","snippet":"relevant excerpt"}]}. Do not use markdown fences. Include HTTP or HTTPS source URLs returned by the search.`,
        }],
      }],
      tools: [{
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: SEARCH_MAX_USES[options.searchContextSize],
      }],
    }

    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'x-api-key': apiKey,
          'anthropic-version': API_VERSION,
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(`OneAPI search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `OneAPI Anthropic search error (HTTP ${status})`
      try {
        const parsed = await response.json() as OneApiResponse
        const detail = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message ?? parsed.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      return mapOneApiResponse(await response.json() as OneApiResponse)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      if (error instanceof WebError) throw error
      throw new WebError(`OneAPI returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  private async apiKey(options: OneApiSearchProviderOptions, signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal)
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
    let resolved: string | undefined
    try {
      resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(undefined), signal)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(`OneAPI search credential resolution failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    if (resolved !== undefined && resolved.length > 0) return resolved
    throw new WebError(
      `OneAPI search has no API key for "${options.apiKeyEnv ?? 'ONEAPI_API_KEY'}"; configure the credential reference or set apiKey`,
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  }
}

function parseSearchEnvelope(text: string): SearchEnvelope | undefined {
  const candidate = text.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '')
  try {
    const parsed: unknown = JSON.parse(candidate)
    if (!isRecord(parsed)) return undefined
    const content = typeof parsed.content === 'string' ? parsed.content : undefined
    const sources = Array.isArray(parsed.sources) ? parsed.sources.filter(isRecord) as OneApiSearchSource[] : undefined
    if (content === undefined && sources === undefined) return undefined
    return { ...content === undefined ? {} : { content }, ...sources === undefined ? {} : { sources } }
  } catch {
    return undefined
  }
}

function extractHttpUrls(text: string): string[] {
  const urls: string[] = []
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0].replace(/[.,;:!?]+$/u, '')
    if (isHttpUrl(url)) urls.push(url)
  }
  return urls
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) return false
  const protocol = new URL(value).protocol
  return protocol === 'http:' || protocol === 'https:'
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, '')
}

function messagesEndpoint(value: string): string {
  const base = trimTrailingSlash(value)
  return base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw searchAborted(signal)
}

function searchAborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('OneAPI search aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  if (signal.aborted) return Promise.reject(searchAborted(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(searchAborted(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(new Error(String(error).replace(/^Error: /u, ''), { cause: error }))
      },
    )
  })
}
