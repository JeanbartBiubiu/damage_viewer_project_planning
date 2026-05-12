# TinyGo Runtime AGENTS.md

## 适用范围

本文件适用于 `wasm/tinygo_engine_v2/internal/runtime/**`。

## 默认读写边界

1. 默认可写：session、run context、runtime state、RNG 和 runtime 测试。
2. `internal/model`、`internal/compile`、`internal/abi`、`internal/scheduler`、`internal/attribute`、`internal/resource`、`internal/formula` 默认作为协作边界读取。
3. DTO 字段语义变化先改 `internal/model`，不要在 runtime 内隐式发明新契约。

## 关键入口

1. `session.go`：`InitFrame`、`BeginRunFrame`、`Snapshot*Frame`、`Step`、`AbortRun`。
2. `runtime.go`：`NewRunContext`、`Step`、`CanCast`、效果处理、状态/护盾、snapshot/action snapshot。
3. `rng.go`：确定性随机。
4. `runtime_test.go`：runtime 行为回归。

## 最小验证

1. 改 runtime 行为后运行 `go test ./...` 和 `go run ./cmd/bench`。
2. 改 session、frame 或 outbox 交互时额外运行 `node .\scripts\smoke-node.mjs`。

## 常见陷阱

1. 不要绕过 `CanCast` 分散 action gate。
2. snapshot 类调用不得推进 scheduler。
3. 不要从输出日志倒推机制状态；状态应存在独立 runtime 结构中。
4. 热路径不要引入 goroutine、channel、lock、反射或 panic/recover 控制流。
