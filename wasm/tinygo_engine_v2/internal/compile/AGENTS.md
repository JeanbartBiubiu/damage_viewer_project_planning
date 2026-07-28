# TinyGo Compile AGENTS.md

## 适用范围

本文件适用于 `wasm/tinygo_engine_v2/internal/compile/**`。

## 默认读写边界

1. 默认可写：generic compile、校验、索引构建与 compile 测试。
2. Canonical 入口是 `CompileGeneric(CompileRequest) -> GenericCompileResult{Session CompiledSession}`，不写 runtime 状态。
3. 新 DTO 字段先落在 `internal/model/generic*.go`，再在 compile 层消费。
4. 旧 `Bundle` / `CompiledBundle` / `compile.go` 已删除；不要重新引入 legacy bundle compile。

## 关键入口

1. `generic.go`：`CompileGeneric`、`CompiledSession`、ability/provider/operation IR。
2. `generic_validate.go`：collect-all 语义校验。
3. `generic_test.go`：compile 契约回归。

## 最小验证

1. 改 compile 层后至少运行 `go test -count=1 ./internal/compile`。
2. 影响 runtime 消费形态时运行 `go test -count=1 ./...`。
3. 影响 host 契约时额外：`go run ./cmd/bench` 与（有 wasm 产物时）`node .\scripts\smoke-node.mjs`。

## 常见陷阱

1. 进入已知 schema 后应 collect-all，不要遇第一个错误就返回。
2. abilityRef / providerRef 必须在 compile 期 intern，供 run 查找。
3. 不要把已删除的 legacy Bundle 字段扩成新 canonical 契约。
4. 不要在 compile 层引入 scheduler、outbox 或可变 runtime 状态。
