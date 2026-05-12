# TinyGo Model AGENTS.md

## 适用范围

本文件适用于 `wasm/tinygo_engine_v2/internal/model/**`。

## 默认读写边界

1. 默认可写：V2 DTO、枚举、错误码、frame kind、payload 契约和兼容 alias。
2. 不要在本目录放编译、运行时或宿主逻辑。
3. 字段语义变化必须同步检查 `internal/compile`、`internal/runtime` 和前端 `web/src/engine/**` 假设。

## 关键入口

1. `EngineBundleV2`、`EngineRunInputV2`：输入契约。
2. `ActionSnapshotV2`、`SnapshotV2`、`DonePayloadV2`、`ErrorPayload`：输出契约。
3. `FrameKind`、`ErrCode` 和机制枚举。

## 最小验证

1. 改字段、枚举或错误码后运行 `go test ./...`。
2. 涉及 ABI/outbox payload 时额外运行 `node .\scripts\smoke-node.mjs`。

## 常见陷阱

1. 公共 DTO 字段语义不要随手改名或复用。
2. 新增字段要明确 JSON tag、默认值和 compile/runtime 消费方。
3. 兼容 alias 只作为旧名兼容层，不要把旧名重新变成新契约。
