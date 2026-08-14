# Agent Note: OpenAI 兼容工具 schema 显式携带 required 数组

Status: implemented

[English](2026-08-14-openai-tool-schema-required-arrays.md) | 中文

## 问题

当对象没有任何必填属性时，Harness 的 JSON Schema 编译器会省略 `required`。这符合 JSON Schema，但一些 OpenAI 兼容网关会把省略字段解码为 `null`，并因 `function.parameters.required` 必须是数组而拒绝请求。`get_goal` 这类无参数工具会直接暴露这个不兼容，嵌套的可选对象也可能在更深层触发它。

## 决策

`llm-pi-ai` 适配器通过 pi-ai 的 `onPayload` 钩子规范化 `openai-completions` 请求中的函数工具 schema。它克隆请求并递归处理对象型 schema 节点：当节点缺少 `required` 或该字段为 `null` 时补上 `required: []`，包括嵌套属性和数组项。已有的 required 数组、非函数工具、其他请求字段以及非 OpenAI Completions 协议都保留原值。Harness 工具编译器保持提供方无关，继续生成标准 JSON Schema 表示。

## 考虑过的替代方案

**让核心工具 schema 编译器始终生成 `required: []`。** 不采用，因为省略字段符合 JSON Schema，应该由需要更严格线路表示的提供方负责兼容；修改共享编译器会改变每个适配器的请求输入，并增加核心工具与上游合并时的冲突。

**只修补 `get_goal` 和其他已知的无参数工具。** 不采用，因为可选嵌套对象以及未来新增工具仍会暴露同一问题，而网关要求适用于完整函数 schema，而不是固定工具清单。

**规范化所有 pi-ai 协议的请求。** 不采用，因为要求只针对 OpenAI 兼容函数 schema，其他协议可能对请求对象赋予不同语义。适配器只为 API 为 `openai-completions` 的模型选择这个钩子。

## 影响

自定义 OpenAI 兼容网关会在每个对象 schema 的可选要求字段上收到显式数组，包括带 `required: []` 的 `get_goal`，工具作者不需要加入提供方专用字段。出站请求使用克隆值，因此不会修改请求上下文中的 schema。更严格的网关仍可能因不支持的 JSON Schema 关键字而拒绝请求；本修复只解决缺失值与 `null` 数组之间的不兼容。

## 测试

`packages/llm/llm-pi-ai/tests/adapter.spec.ts` 通过 mock HTTP 服务器驱动生产适配器，并断言序列化请求中包含无参数工具、`properties` 下的嵌套对象、数组 `items` 下的嵌套对象、显式 `null`，以及原有的非空 `required` 数组。
