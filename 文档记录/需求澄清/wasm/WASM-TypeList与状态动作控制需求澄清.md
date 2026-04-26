TASK_KEY: wasm-engine-v2-architecture
DOC_TYPE: 需求澄清
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-04-26 16:45:00

# WASM TypeList 与状态动作控制需求澄清

本文说明为什么 TinyGo V2 需要补 TypeList 与状态动作控制规则，以及该能力的边界。概要位置见 `文档记录/概要设计/wasm/WASM-TypeList与状态动作控制概要设计.md`，编码细节见 `文档记录/详细设计/wasm/WASM-TypeList与状态动作控制详细设计.md`。

## 1. 问题

当前 TinyGo V2 只有 `StatusTemplateV2.BlocksActions` 这种粗粒度开关。它只能表达“某状态阻止 actor 执行所有 action”，不能表达 LoL 常见控制差异：

1. `silence` 禁止施法和使用物品，但不禁止普攻。
2. `disarm` 禁止普攻，但不禁止普通技能。
3. `ground` 禁止 dash/blink 标签动作，但不禁止非位移技能。
4. `knockdown` 不一定禁止所有新动作，但需要打断正在进行的 dash。
5. `stun/suppression/stasis` 需要禁止多类动作，并可能打断 cast/channel/dash/普攻前摇。

后端已经用 `status_action_control_rules` 表整理了这类规则，但 Wasm bundle 和 TinyGo runtime 尚未同步。

## 2. 目标

P0 目标：

1. 让 Wasm 能消费后端状态动作控制规则。
2. 用 TypeList/TypeSet 支撑 status/action/tag/phase 的精确匹配。
3. 用统一 `CanCast` 判断 action 是否可发起。
4. 保留当前 `BlocksActions` 回归行为，但把它降级为 legacy shorthand。
5. 为后续 `ExecutionInstance` 打断链路预留规则与编译产物。

## 3. 必须覆盖的判定

`forbid` 判定：

1. 某 actor 身上存在匹配 status。
2. 本次 action 的基础类型命中 `action_type_ids`。
3. 如果规则声明 `action_match_type_ids`，本次 action 的 tag/type 也必须命中。
4. 命中后 action 不执行，并输出可追踪的 block reason。

`interrupt` 判定：

1. 某 actor 身上新增、刷新或持续存在匹配 status/control。
2. actor 当前有 `ExecutionInstance`。
3. execution phase 命中 `interrupt_phase_type_ids`。
4. 命中后取消 execution 后续事件。

## 4. 非目标

1. 不在 Wasm 内直接读取数据库表或 SQL seed。
2. 不把数据库 `type_id` 当作 TinyGo 热路径 ID；进入 Wasm 前必须转换或声明到 `TypeCatalogV2`。
3. 不在本能力里实现 forced action。`berserk/charm/fear/taunt` 的“被迫做什么”另走 forced intent 设计；本能力只表达自由动作的 forbid/interrupt。
4. 不用 Bloom filter；所有匹配必须精确。
5. 不把 status、control、execution、cadence 合并成一个巨型状态对象。

## 5. 验收口径

P0 完成后至少能用测试证明：

1. `silence` 禁 `cast_skill/cast_item`，不禁 `basic_attack`。
2. `disarm` 禁 `basic_attack`，不禁 `cast_skill`。
3. `ground` 禁带 `dash/blink` tag 的 action。
4. `stun` 保持当前“阻断并释放后重试”的行为。
5. 有显式 `statusActionControlRules` 时，不再依赖 `BlocksActions`。
