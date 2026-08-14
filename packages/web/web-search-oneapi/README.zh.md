# @deepseek-ai/dsh-web-search-oneapi

[English](README.md) | 中文

由 OneAPI Anthropic Messages 接口支持的 `WebSearchProvider`，用于 harness `ctx.web` seam。它向 `POST /v1/messages` 发送原生 `web_search_20250305` server tool，这正是当前 OneAPI 网关为 `DeepSeek-V4-Pro` 提供的请求格式。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | （未设置） | 字面 API 密钥。优先使用 `apiKeyEnv`。 |
| `apiKeyEnv` | `ONEAPI_API_KEY` | 每次搜索解析的凭据引用。 |
| `baseURL` | `$ONEAPI_BASE_URL` 或 `https://oneapi-comate.baidu-int.com` | OneAPI/Anthropic 基址；provider 追加 `/v1/messages`，已经以 `/v1` 结尾的基址也可使用。 |
| `model` | `DeepSeek-V4-Pro` | 网关提供的可搜索模型名称。 |
| `maxOutputTokens` | `4096` | 生成答案的 token 上限。 |
| `searchContextSize` | `medium` | 映射到原生搜索的 `max_uses`：`low` = 3、`medium` = 5、`high` = 10。 |

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

provider 会把原生 `web_search_tool_result` 来源映射为规范化的 `WebSearchResult`。当前 OneAPI 对该模型返回的结果块内容为空，因此 provider 同时要求模型返回严格 JSON，并在最终文本中兜底提取 HTTP URL。它不使用 `ctx.llm`；搜索是一次独立的 Anthropic Messages 辅助请求，使用提供方私有的 wire format。
