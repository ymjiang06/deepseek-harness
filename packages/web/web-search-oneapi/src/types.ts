/** Provider-private wire types for OneAPI's Anthropic Messages web search API. */

export interface OneApiSearchRequest {
  model: string
  max_tokens: number
  messages: readonly [{
    readonly role: 'user'
    readonly content: readonly [{
      readonly type: 'text'
      readonly text: string
    }]
  }]
  tools: readonly [{
    readonly type: 'web_search_20250305'
    readonly name: 'web_search'
    readonly max_uses: number
  }]
}

export interface OneApiUrlCitation {
  type?: string
  url?: string | null
  title?: string | null
  cited_text?: string | null
}

export interface OneApiOutputText {
  type?: string
  text?: string | null
  citations?: OneApiUrlCitation[]
}

export type OneApiMessageOutput = OneApiOutputText

export interface OneApiSearchSource {
  type?: string
  url?: string | null
  title?: string | null
  snippet?: string | null
  page_age?: string | null
  published_at?: string | null
  publishedAt?: string | null
}

export interface OneApiServerToolUse {
  type?: string
  name?: string
  input?: Record<string, unknown>
}

export interface OneApiWebSearchCall {
  type?: string
  content?: OneApiSearchSource[]
}

export type OneApiResponseItem = OneApiMessageOutput | OneApiServerToolUse | OneApiWebSearchCall

export interface OneApiResponse {
  type?: string
  model?: string
  content?: OneApiResponseItem[]
  stop_reason?: string | null
  error?: { message?: string } | string
  message?: string
}
