# TinyGo Runtime AGENTS.md

本文件适用于 `internal/runtime/**`，负责通用会话、运行循环、门禁、供值器和操作执行。

## 约束

- `session.go` 只接线 compile/run/release、会话注册和 rules hash 校验；`generic_run.go` 管理单次确定性运行。
- DTO 语义先在 model 定义，编译形态先在 compile 定义；运行时不得隐式发明共享契约。
- ability attempt 条件集中经过 gate；生命值等数值变化经过 operation/pipeline，禁止直接写值。
- provider 生命周期和 tick 保持确定顺序；热路径遵守上层 TinyGo 内存和并发限制。
- 必须校验 `sessionId` 与 `expectedRulesHash`，按当前契约返回 `hash_mismatch` 或 `session_not_found`。
- 不恢复旧 `NewRunContext`、`Step`、DPS 文件或 step ABI。

## 验证

运行时行为变化按模块规则运行全量 Go 测试和原生 benchmark；会话、frame 或 outbox 交互变化还需构建最终 Wasm 并运行 Node smoke。
