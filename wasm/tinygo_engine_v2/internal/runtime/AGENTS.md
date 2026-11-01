# TinyGo Runtime AGENTS.md

本文件适用于 `internal/runtime/**`，负责通用会话、运行循环、门禁、供值器和操作执行。

## 约束

- 根包只保留 `session.go` 会话与输出接线、`validation.go` 请求身份校验和 `run.go` 单次运行组合。`run.go` 创建并拥有唯一 `scheduler.Loop`，再组合执行器；不恢复根业务总状态。
- `execution` 根层只组合原时点读取、预算身份、跨功能顺序、真实帧预检与统一提交；实际业务执行和局部状态进入所属执行包。`actor`、`action`、`effect`、`report` 继续私有持有角色、行动、效果及报告状态，不复制成第二套总状态。
- `execution` 下有六个执行所有者：`actionflow` 行动与过程、`lifecycle` 效果生命周期、`operation` 数值操作、`hit` 命中与强化、`listener` 监听派发、`continuation` 复制与续接；另有 `admission` 准入、`evaluation` 运行求值、`usage` 共同额度三个支撑包。实现与私有不变量随实际所有者维护。
- 六个执行所有者不互相导入，也不导入父执行包、根运行包或调度器。`operation`、`lifecycle` 可以使用 `evaluation`，`hit`、`listener`、`continuation` 可以借用同一 `usage` 账；具体合法依赖由包边界脚本逐项声明，不能扩大为整个执行目录白名单。
- 每场只组合一份 `usage.Ledger`。命中规则与监听共享实际预留凭据，提交及失败释放保留原位置；使用身份仍归 `action`，不能在功能包另登记使用或复制共同额度。
- 功能包可通过消费方声明的有限同步能力交接真实帧阶段；不接收完整执行器、根帧、可写队列或任意状态入口。不保存单个可覆盖的“当前帧”，嵌套调用使用各自恢复凭据，也不新增逐事件适配对象、闭包或大快照。
- 时钟、队列、计数及停止状态只保存在同一个 `scheduler.Loop`。执行器借用它，行动、效果和报告不能另外建堆或推进时钟。
- DTO 语义先在 model 定义，编译形态先在 plan 定义并由 compile 生产；运行时不得隐式发明共享契约。
- 正式运行只消费计划；会话接线保留编译入口。本次驱动公式进入运行态独立公式表，不追加或覆盖共享计划的程序、索引和指令。
- 行动尝试与条件门禁由 `actionflow` 执行；生命值等数值变化经过 `operation` 与 `pipeline`，禁止直接写值。
- 效果生命周期和周期执行由 `lifecycle` 拥有业务规则；跨行动、监听、数值和提交的原顺序由根层组合。热路径遵守上层 TinyGo 内存和并发限制。
- 必须校验 `sessionId` 与 `expectedRulesHash`，按当前契约返回 `hash_mismatch` 或 `session_not_found`。
- 不恢复旧 `NewRunContext`、`Step`、DPS 文件或 step ABI。
- 包内单测验证所属私有不变量；公开入口组合用例位于 `tests/runtime/`。测试接线只组合真实循环及执行器，不公开内部状态或复制生产循环。

## 验证

运行时行为变化按模块规则运行全量 Go 测试和原生 benchmark；会话、frame 或 outbox 交互变化还需构建最终 Wasm 并运行 Node smoke。
