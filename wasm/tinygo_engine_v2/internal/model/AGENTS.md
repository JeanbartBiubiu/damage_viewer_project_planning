# TinyGo Model AGENTS.md

## 适用范围

本文件适用于 `wasm/tinygo_engine_v2/internal/model/**`。

## 默认读写边界

1. 默认可写：generic DTO、枚举、错误码、frame kind、payload 契约。
2. 不要在本目录放编译、运行时或宿主逻辑。
3. Canonical 契约在 `generic.go` / `generic_compile.go` / `generic_run.go` / `generic_run_output.go`。
4. `types.go` 只保留仍被引用的共享基础类型（`FrameKind`、`SchemaVersion`、`ErrCode`、`EventPhase`、`TypeListV2`/`TypeMatcherV2`、`NumericBoundEvidenceV2` 等）；legacy EngineBundle / DPS DTO 已移除。

## 关键入口

1. `generic.go`：frame kind `200..214`、`CompileResult`、`EngineError`、`ReleaseSessionRequest`、`GenericReleaseDonePayload`。
2. `generic_compile.go`：`CompileRequest`、provider/ability/operation/formula DTO。
3. `generic_run.go`：`RunRequest`、`Snapshot`、`StopPolicy`、`SamplingConfig`。
4. `generic_run_output.go`：`DoneResult`、`RunSummary`、series/evidence。
5. `types.go`：仍存活的共享基础类型（无 legacy bundle/DPS DTO）。

## 最小验证

1. 改字段、枚举或错误码后运行 `go test -count=1 ./...`。
2. 涉及 ABI/outbox payload 时额外运行 `node .\scripts\smoke-node.mjs`。

## 常见陷阱

1. 公共 DTO 字段语义不要随手改名或复用。
2. 新增字段要明确 JSON tag、默认值与 compile/runtime 消费方。
3. 不要把已删除的 legacy DTO 名带进新 canonical 路径。
4. release 成功必须用 `FrameKindGenericReleaseResult`，不要复用 generic done。
