# @deepseek-ai/dsh-web-search-oneapi

English | [中文](README.zh.md)

OneAPI Anthropic Messages-backed `WebSearchProvider` for the harness `ctx.web` seam. It sends `POST /v1/messages` with the native `web_search_20250305` server tool, which is the wire format supported by the local OneAPI gateway for `DeepSeek-V4-Pro`.

## Config

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | (unset) | Literal API key. Prefer `apiKeyEnv`. |
| `apiKeyEnv` | `ONEAPI_API_KEY` | Credential reference resolved for each search. |
| `baseURL` | `$ONEAPI_BASE_URL` or `https://oneapi-comate.baidu-int.com` | OneAPI/Anthropic base URL. The provider appends `/v1/messages`; a base URL already ending in `/v1` is also accepted. |
| `model` | `DeepSeek-V4-Pro` | Search-capable model exposed by the gateway. |
| `maxOutputTokens` | `4096` | Maximum generated answer tokens. |
| `searchContextSize` | `medium` | Maps to native search `max_uses`: `low` = 3, `medium` = 5, `high` = 10. |

```yaml
- id: web
  config:
    searchProvider: oneapi

- id: web-search-oneapi
  name: '@deepseek-ai/dsh-web-search-oneapi'
  config:
    apiKeyEnv: ONEAPI_API_KEY
    baseURL: https://oneapi-comate.baidu-int.com
    model: DeepSeek-V4-Pro
```

The provider maps native `web_search_tool_result` sources into the normalized `WebSearchResult`. OneAPI currently returns an empty result block for this model, so the provider also asks for a strict JSON envelope and falls back to HTTP URLs in the final text. It does not use `ctx.llm`; search is an auxiliary Anthropic Messages request with its own provider-private wire format.
