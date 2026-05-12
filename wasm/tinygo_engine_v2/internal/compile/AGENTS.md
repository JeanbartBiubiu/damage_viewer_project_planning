# TinyGo Compile AGENTS.md

## 适用范围

本文件适用于 `wasm/tinygo_engine_v2/internal/compile/**`。

## 默认读写边界

1. 默认可写：Bundle 编译、短 ID、索引、引用校验和 compile 测试。
2. 只负责 `model.EngineBundle` 到 `CompiledBundle`，不写 runtime 状态。
3. 新 DTO 字段先落在 `internal/model`，再在 compile 层消费。

## 关键入口

1. `Bundle`：编译入口和问题收集。
2. `CompiledBundle`、`CompiledAction`、`CompiledStatus`、`ControlRuleIndex`：runtime 只读结构。
3. `compileActionCosts`、`compilePanelCosts`、`compilePanelEffects`、`compileControlRules`、`compileEffects`。
4. `compile_test.go`：编译契约回归。

## 最小验证

1. 改 compile 层后至少运行 `go test ./internal/compile`.
2. 影响 runtime 消费形态时运行 `go test ./...`。

## 常见陷阱

1. 编译校验应尽量 collect-all，不要遇到第一个错误就提前返回。
2. 短 ID 必须和编译后 slice 位置保持一致。
3. 不要把临时 legacy 兼容扩成新的正式契约。
4. 不要在 compile 层引入运行时状态、scheduler 或 outbox 行为。
