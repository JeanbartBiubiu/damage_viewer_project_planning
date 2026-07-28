# TinyGo Runtime AGENTS.md

## 适用范围

本文件适用于 `wasm/tinygo_engine_v2/internal/runtime/**`。

## 默认读写边界

1. 默认可写：generic session、`RunGeneric`、gate/provider/execution 与 runtime 测试。
2. `internal/model/generic*.go`、`internal/compile/generic.go`、`internal/abi`、`internal/scheduler`、`internal/formula`、`internal/pipeline` 为协作边界。
3. DTO 字段语义变化先改 model，不要在 runtime 内隐式发明新契约。
4. 旧 `NewRunContext`/`Step` 与 `dps_*.go` 已从本目录移除；不要重新引入。

## 关键入口

1. `session.go`：`CompileFrame`/`CompileJSON`、`RunFrame`/`RunJSON`、`ReleaseSessionFrame`/`ReleaseSessionJSON`、session registry 与 hash 校验。
2. `generic_run.go`：`RunGeneric` 单次 deterministic run。
3. `generic_execution.go`：operation 执行。
4. `generic_gate.go`：ability attempt gate。
5. `generic_provider.go` / `generic_provider_tick.go`：provider 生命周期与 tick。

## 最小验证

1. 改 runtime 行为后运行 `go test -count=1 ./...` 和 `go run ./cmd/bench`。
2. 改 session/frame/outbox 交互时额外运行 `node .\scripts\smoke-node.mjs`（需先构建 wasm）。

## 常见陷阱

1. run 必须校验 `sessionId` + `expectedRulesHash`；错配写 `hash_mismatch` / `session_not_found`。
2. 不要绕过 gate 分散 ability attempt 条件。
3. HP 变化必须经 operation/pipeline，禁止 raw set。
4. 热路径不要引入 goroutine、channel、lock、反射或 panic/recover 控制流。
5. 不要把已删除的 legacy step ABI 描述成当前仍存在的路径。
