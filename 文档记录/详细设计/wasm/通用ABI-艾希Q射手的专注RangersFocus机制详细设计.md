TASK_KEY: wasm-generic-ashe-rangers-focus
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-14

# 通用 ABI - 艾希 Q 射手的专注（Ranger's Focus）rank5 机制详细设计

关联验证记录：[通用 ABI 艾希 Q 射手的专注 Rangers Focus 机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务只迁移 G8 精确候选中的 Ashe Q / Ranger's Focus **rank5** 可表达子集；G8 分类为 `partial`，不得标为 fully migrated。

## 1. Partial 声明与数据合同

本项为 **partial**：仅表达 Focus 叠层门控、Q 施放资源、Flurry 持续与多箭物理公式；不宣称完整英雄 Q 闭环。

| 环节 | 合同 |
| --- | --- |
| scope | 仅 rank5；无专用英雄分支，全部由 generic provider/state/formula/castCondition 表达 |
| Focus | 普攻叠层至 4 层可施放；刷新后按 4/5/6/7 秒槽位逐层掉落 |
| cast gate | `cast_condition` / `castCondition` 读 owning mounted provider 的 Focus；false 或 eval error → skip，不耗资源、不启冷却、不发 event |
| cost | Q 消耗 30 mana |
| Flurry | 持续 6 秒；+75% AS；期间不再积 Focus |
| arrows | 首发 6 箭、后续 5 箭；每箭 `raw = 0.28 * resolvedAD` |
| hit event | 每次 Flurry 普攻只发一个 `basic_attack_hit`（非逐箭事件） |
| cross-check | `resolvedAD=100` 时：首发 6×28=168；后续 5×28=140 |

已包含：Focus 四层施放门控、30 mana、6 秒 Flurry、+75% AS、首发/后续 6/5 箭各 28% resolved AD、每次 Flurry 普攻只发一个 `basic_attack_hit`、Focus 刷新后的 4/5/6/7 秒槽位掉层。

## 2. 跨模块边界

| Worktree | Commit | 职责 | 不越界 |
| --- | --- | --- | --- |
| Backend | `46219f0` | `ability_definitions` 与 log 新增 optional `cast_condition_formula_key`；兼容 migration 为 `ADD COLUMN IF NOT EXISTS`；Ashe 幂等 seed 与静态 SQL 测试 | **不得**实际跑 DDL / live migration / publish |
| Wasm | `476b780` | `AbilityDefinition.castCondition` 编译为能力自身 program；施放门控在已解析 `abilityRef` 的 owning mounted provider state 中读 Focus；formula false 或 eval error 都 skip，且不消耗资源/启动冷却/发 event；无 `castCondition` 的既有能力行为不变 | 不实现 attack-timer reset、逐箭飞行、Frost Shot 等 |
| Web | `452b036` | optional `castConditionFormulaKey` 入 DTO/Admin 表单；assembler `formulaRef` 投影为 `castCondition` | 无 live backend E2E |
| Planning | 本详细设计、验证记录与 `task_rules.json` 映射 | 不改 Backend/Wasm/Web 代码 |

## 3. 可表达机制边界

仅使用既有 Generic ABI：

- provider timed/stack state（Focus 与掉层槽位）
- optional castCondition formula（施放门控）
- mana cost / Flurry duration / AS modifier
- physical formula on Flurry 普攻（聚合箭数 × 0.28 × resolvedAD）

**无专用英雄分支。** 不可表达或未建模：attack-timer reset、逐箭飞行、Frost Shot、吸血、建筑物/多目标、完整 rotation/cadence、其它 rank、live migration/Admin publish/浏览器对 live backend E2E。

## 4. 非目标

- attack-timer reset、逐箭飞行轨迹。
- Frost Shot、吸血、建筑物/多目标结算。
- 完整 rotation / cadence、其它 rank 数值表。
- 实际执行 compatibility DDL、live migration、Admin publish、浏览器 live E2E。
- 把本 partial 误计为完整射手的专注闭环，或宣称 G8 全量 goal 完成。
