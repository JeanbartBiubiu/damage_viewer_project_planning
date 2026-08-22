TASK_KEY: wasm-generic-damage-precision
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-13

# 通用 ABI 事件快照与抗性精确结算详细设计

验证证据：[通用 ABI 事件快照与抗性精确结算验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)

## 1. 目标与边界

本任务补齐两项通用精度前置：

1. listener 公式可读取父 execution frame 的 entry 快照与 emit 执行点快照。
2. generic physical / magic / true damage 在护盾之前执行目标抗性结算。

破败与海妖 HP 公式升级为 attack-start 口径（`event.entry_target.attr.hp.current/max`）。现有 `damage0 → emit1` 数据顺序保持不变。

本任务不实现穿透、不重排 Backend basic attack step、不修改对外 frame ABI，也不实现完整鬼索。

## 2. Event snapshot 公式契约

支持路径：

```text
event.entry_source.attr.<key>[.base|.current|.max|.resolved]
event.entry_target.attr.<key>[.base|.current|.max|.resolved]
event.entry_source.resource.<key>[.current|.max]
event.entry_target.resource.<key>[.current|.max]

event.source.attr.<key>[.base|.current|.max|.resolved]
event.target.attr.<key>[.base|.current|.max|.resolved]
event.source.resource.<key>[.current|.max]
event.target.resource.<key>[.current|.max]
```

语义：

- `entry_*`：父 frame 创建时、cost/CD/operations 前的不可变快照。
- `event.source/target`：`emit_event` operation 执行当点的 staged snapshot。
- event source/target 始终指原始事件参与者，不随 listener owner-relative source/target 重映射。
- inline listener operations 与 listener `abilityRef` 子调用继承同一 event context。
- 非 event listener 上下文读取 event path 必须返回结构化公式错误，不能静默读 0。

参与者映射边界：

- `emit_event` 的 target 为 `source`/`self` 时，`event.entry_target` 仍按原始 event participant 选择 entry snapshot，不得误绑到 emit 操作自身的相对角色。
- 合法 `Resolved=0` 不得 fallback 到 `Current`；零值与缺失语义分离。

## 3. Runtime 实现边界

Wasm 允许写入：

- `wasm/tinygo_engine_v2/internal/formula/generic.go`
- `wasm/tinygo_engine_v2/internal/formula/generic_eval.go`
- 对应 formula tests
- `wasm/tinygo_engine_v2/internal/runtime/generic_execution.go`
- 对应 generic runtime tests
- `wasm/tinygo_engine_v2/internal/pipeline/resolver.go`
- `wasm/tinygo_engine_v2/internal/pipeline/resolver_test.go`
- 必要时 `internal/compile/generic.go` 与测试，仅用于拒绝未知 damage type
- `wasm/tinygo_engine_v2/README.md`
- `wasm/tinygo_engine_v2/dist/tinygo_engine_v2.wasm`

`executionFrame` 在创建时保存 entry source/target attr/resource；`emit_event` 保存 emit-point attr/resource。快照必须深拷贝，父 frame 后续 operation 不得反向修改。

listener dispatch 需要把 event context 同时传给 inline operation frame 与 child ability frame。provider tick、driver cast 等无 event 上下文路径保持不变。

## 4. 抗性结算契约

处理顺序：

```text
raw formula amount
  → target resolved resistance
  → mitigated amount
  → shield absorption
  → HP clipping
```

映射：

- `damage/physical` / `physical` → `armor.resolved`
- `damage/magic` / `magic` → `magic_resist.resolved`
- `damage/true` / `true` → 跳过抗性

公式：

```text
R >= 0: amount * 100 / (100 + R)
R < 0:  amount * (2 - 100 / (100 - R))
```

首批不读取 source penetration 属性；未知 damage type 在 compile 阶段拒绝，不能按 true/raw damage 处理。

pipeline outcome 内部保留：

- raw amount
- mitigated amount
- shield absorbed
- HP damage

generic summary `damageDealt` 采用抗性后、护盾前的 mitigated amount，延续 pre-shield packet 口径。HP clipping 不反向改变 summary。

## 5. Backend / Web 契约边界

- Backend 破败/海妖公式切到 `event.entry_target.attr.hp.current/max`；发布 revision 与 Public API 回读必须反映该路径。
- Web 同步 Wasm artifact（size/hash 与 Wasm 源一致），通过 loader/assembler/bridge/generic result parser 完成 live compile/run/release；本任务不要求修改页面 TypeScript 控件层。
