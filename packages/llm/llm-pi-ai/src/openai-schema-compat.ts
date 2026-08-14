/**
 * Normalize OpenAI-compatible tool schemas at the provider payload boundary.
 *
 * Some OpenAI-compatible gateways require every object schema to carry a
 * `required` array and decode an omitted field as `null`. The Harness schema
 * compiler omits that field when an object has no required properties, which
 * is valid JSON Schema but rejected by those gateways.
 *
 * @module dsh-llm-pi-ai/openai-schema-compat
 */

type JsonObject = Record<string, unknown>

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Add an explicit empty `required` array to every object schema in a value. */
function addRequiredArrays(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(addRequiredArrays)
  if (!isJsonObject(value)) return value

  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, addRequiredArrays(child)]),
  )
  if (normalized.type === 'object' && (normalized.required === undefined || normalized.required === null)) {
    normalized.required = []
  }
  return normalized
}

/**
 * Normalize function tool schemas in one OpenAI Completions payload.
 *
 * Other payload fields and non-function tools remain unchanged. The returned
 * value is a cloned payload only when a `tools` array is present, so callers
 * can safely pass the result to pi-ai's serializer without mutating context.
 * @param payload - pi-ai's provider payload before serialization.
 * @returns The payload with object-schema `required` arrays made explicit.
 */
export function normalizeOpenAiPayload(payload: unknown): unknown {
  if (!isJsonObject(payload) || !Array.isArray(payload.tools)) return payload

  const tools = payload.tools as unknown[]
  return {
    ...payload,
    tools: tools.map((tool) => {
      if (!isJsonObject(tool) || tool.type !== 'function' || !isJsonObject(tool.function)) return tool
      if (!('parameters' in tool.function)) return tool
      return {
        ...tool,
        function: {
          ...tool.function,
          parameters: addRequiredArrays(tool.function.parameters),
        },
      }
    }),
  }
}
