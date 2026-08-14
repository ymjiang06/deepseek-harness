/** Register a OneAPI Anthropic Messages web-search provider into `ctx.web`. */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import {
  OneApiSearchProvider,
  ONEAPI_DEFAULT_BASE_URL,
  ONEAPI_DEFAULT_MAX_OUTPUT_TOKENS,
  ONEAPI_DEFAULT_MODEL,
  ONEAPI_DEFAULT_SEARCH_CONTEXT_SIZE,
} from './provider.ts'
import type { OneApiSearchContextSize, OneApiSearchProviderOptions } from './provider.ts'

export {
  OneApiSearchProvider,
  ONEAPI_DEFAULT_BASE_URL,
  ONEAPI_DEFAULT_MAX_OUTPUT_TOKENS,
  ONEAPI_DEFAULT_MODEL,
  ONEAPI_DEFAULT_SEARCH_CONTEXT_SIZE,
  ONEAPI_PROVIDER_ID,
  mapOneApiResponse,
  mapOneApiSource,
} from './provider.ts'
export type { OneApiSearchContextSize, OneApiSearchProviderOptions } from './provider.ts'
export type {
  OneApiMessageOutput,
  OneApiOutputText,
  OneApiResponse,
  OneApiResponseItem,
  OneApiSearchRequest,
  OneApiSearchSource,
  OneApiServerToolUse,
  OneApiUrlCitation,
  OneApiWebSearchCall,
} from './types.ts'

export const name = 'web-search-oneapi'
export const inject = ['web']

const DEFAULT_API_KEY_ENV = 'ONEAPI_API_KEY'
const ONEAPI_BASE_URL_ENV = 'ONEAPI_BASE_URL'
export const WEB_SEARCH_ONEAPI_SETTINGS_NAMESPACE = settingsNamespace('web-search-oneapi')

export interface Config {
  apiKey?: string
  apiKeyEnv?: string
  baseURL?: string
  model?: string
  maxOutputTokens?: number
  searchContextSize?: OneApiSearchContextSize
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  model: z.string().default(ONEAPI_DEFAULT_MODEL),
  maxOutputTokens: z.number().step(1).min(1).default(ONEAPI_DEFAULT_MAX_OUTPUT_TOKENS),
  searchContextSize: z.union(['low', 'medium', 'high'] as const).default(ONEAPI_DEFAULT_SEARCH_CONTEXT_SIZE),
})

function resolveOptions(ctx: Context, config: Config): OneApiSearchProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0 ? config.apiKey : undefined
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    apiKeyEnv,
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    baseURL: config.baseURL
      ?? launchEnvironmentOf(ctx).get(ONEAPI_BASE_URL_ENV)?.value
      ?? ONEAPI_DEFAULT_BASE_URL,
    model: config.model ?? ONEAPI_DEFAULT_MODEL,
    maxOutputTokens: config.maxOutputTokens ?? ONEAPI_DEFAULT_MAX_OUTPUT_TOKENS,
    searchContextSize: config.searchContextSize ?? ONEAPI_DEFAULT_SEARCH_CONTEXT_SIZE,
  }
}

export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  installSettingsSection(ctx, WEB_SEARCH_ONEAPI_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {},
  })
  ctx.web.registerSearchProvider(new OneApiSearchProvider(() => resolveOptions(ctx, current())))
}
