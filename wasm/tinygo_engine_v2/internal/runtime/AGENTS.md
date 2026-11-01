# TinyGo Runtime AGENTS.md

本文件适用于 `internal/runtime/**`，负责通用会话、运行循环、门禁、供值器和操作执行。

## 约束

- 根包只保留 `session.go` 会话与输出接线、`validation.go` 请求身份校验和 `run.go` 单次运行组合。`run.go` 创建并拥有唯一 `scheduler.Loop`，再组合执行器；不恢复根业务总状态。
- `execution` 统一协调帧及提交；`actor`、`action`、`effect`、`report` 私有持有各自状态，通过值、只读视图和暂存变更交换。子系统不接收执行器或根总状态，不互相导入业务控制。
- `execution` 下的准入、命中、监听和运行求值按明确输入独立判断或计算，局部状态随本场运行持有；四包彼此不导入，也不取得父层、调度或其他子系统的执行控制。
- 时钟、队列、计数及停止状态只保存在同一个 `scheduler.Loop`。执行器借用它，行动、效果和报告不能另外建堆或推进时钟。
- DTO 语义先在 model 定义，编译形态先在 plan 定义并由 compile 生产；运行时不得隐式发明共享契约。
- 正式运行只消费计划；会话接线保留编译入口。本次驱动公式进入运行态独立公式表，不追加或覆盖共享计划的程序、索引和指令。
- ability attempt 条件集中经过 gate；生命值等数值变化经过 operation/pipeline，禁止直接写值。
- provider 生命周期和 tick 保持确定顺序；热路径遵守上层 TinyGo 内存和并发限制。
- 必须校验 `sessionId` 与 `expectedRulesHash`，按当前契约返回 `hash_mismatch` 或 `session_not_found`。
- 不恢复旧 `NewRunContext`、`Step`、DPS 文件或 step ABI。
- 包内单测验证所属私有不变量；公开入口组合用例位于 `tests/runtime/`。测试接线只组合真实循环及执行器，不公开内部状态或复制生产循环。

## 验证

运行时行为变化按模块规则运行全量 Go 测试和原生 benchmark；会话、frame 或 outbox 交互变化还需构建最终 Wasm 并运行 Node smoke。
