# Agent Note: OpenAI-compatible tool schemas carry explicit requirement arrays

Status: implemented

English | [中文](2026-08-14-openai-tool-schema-required-arrays.zh.md)

## Problem

The Harness JSON Schema compiler omits `required` when an object has no required properties. That is valid JSON Schema, but some OpenAI-compatible gateways decode the omitted field as `null` and reject a request because `function.parameters.required` must be an array. Empty-argument tools such as `get_goal` expose this incompatibility directly, and nested optional objects can trigger it at deeper levels.

## Decision

The `llm-pi-ai` adapter normalizes function tool schemas in the `openai-completions` payload through pi-ai's `onPayload` hook. It clones the payload and recursively adds `required: []` to object schema nodes whose field is absent or `null`, including nested properties and array items. Existing required arrays, non-function tools, other payload fields, and non-OpenAI-Completions protocols retain their values. The Harness tool compiler remains provider-neutral and continues emitting the standard JSON Schema representation.

## Alternatives considered

**Make the core tool schema compiler always emit `required: []`.** Rejected because the omission is valid JSON Schema and belongs to the compatibility behavior of the provider that needs the stricter wire representation; changing the shared compiler would alter every adapter's request input and increase merge conflicts in core tools.

**Patch only `get_goal` and other known empty-argument tools.** Rejected because optional nested object schemas and future tools would remain vulnerable, while the gateway requirement applies to the complete function schema rather than a fixed tool inventory.

**Normalize every pi-ai protocol payload.** Rejected because the requirement is specific to OpenAI-compatible function schemas and other protocols may assign different meanings to their payload objects. The adapter selects the hook only for models whose API is `openai-completions`.

## Consequences

Custom OpenAI-compatible gateways receive an explicit array for every object schema's optional requirements, including `get_goal` with `required: []`, without requiring tool authors to add provider-specific fields. The outbound payload is cloned, so request context schemas are not mutated. A gateway with stricter validation can still reject unsupported JSON Schema keywords; this change only resolves the missing-versus-null array incompatibility.

## Testing

`packages/llm/llm-pi-ai/tests/adapter.spec.ts` drives the production adapter through a mock HTTP server and asserts the serialized request for an empty-argument tool, an object nested under `properties`, an object nested under array `items`, an explicit `null`, and a pre-existing non-empty `required` array.
