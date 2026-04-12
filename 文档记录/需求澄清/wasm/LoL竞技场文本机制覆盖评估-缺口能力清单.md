TASK_KEY: wasm-lol-entity-coverage-audit
DOC_TYPE: 需求澄清
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-04-10 00:00:00

# LoL竞技场文本机制覆盖评估-缺口能力清单

日期：2026-04-10  
状态：已收口 
对应文档：
- `LoL竞技场文本机制覆盖评估-横切缺口清单`
- `LoL竞技场文本机制覆盖评估-跨专题统一实现口径`
- `LoL竞技场文本机制覆盖评估-专题-暴击策略与暴击资格`

## 2026-04-11 补充修正

- 这页上一版把关注点过度收敛到 `crit_policy / defensive_window`，已经不够覆盖竞技场全量遍历。
- 这轮补出两个必须显式纳入分类，但不一定都要新起一套大系统的家族：
  - `history_window_integration`
  - `control_runtime_and_repeat_gate`
- `history_window_integration` 优先复用现有 [概要设计-历史值追踪与时间窗口机制.md](C:/project/damage_viewer_project_planning/文档记录/概要设计/wasm/概要设计-历史值追踪与时间窗口机制.md)。
- `control_runtime_and_repeat_gate` 当前最小只要求：
  - `control_apply`
  - `control_immunity_window`
  - `defensive_window`
  - `per_target_lockout`
- 用户提到的“`N` 秒受控累计超过 `M` 秒后获得霸体”按 `recent_cc_duration_window + counter_state + stack_threshold_proc + defensive_window` 组合表达，不需要再造新顶层。
- 旧正文仍可保留为 MVP 落地优先级；新增分类修正统一参考 [LoL竞技场文本机制覆盖评估-补充专题-历史窗口与控制效果锁窗.md](C:/project/damage_viewer_project_planning/文档记录/需求澄清/wasm/LoL竞技场文本机制覆盖评估-补充专题-历史窗口与控制效果锁窗.md)。

## 目的

这份清单不再把当前剩余问题一股脑写成 4 个都要做的通用层，而是按最新口径分成：

- 需要立刻做成通用能力的项
- 可以收缩成最小状态的项
- 可以下沉到技能或效果自身处理的项
- 可以明确延后的项

当前稳定基础层仍然是：

- `mark_state / stored_damage_on_mark`
- `flat_stat_bonus / derived_stat_from_attrs / stack_to_stat / penetration_modifier / adaptive_force`
- `cast_stage / remaining_charges / recharge_timer / refund_cooldown / reset_skill_cd / grant_charge`
- `counter_state / counter_seed / stack_threshold_proc / periodic_proc`

## 总表

| capabilityFamily | priority | 覆盖来源 | MVP | 后续 |
| --- | --- | --- | --- | --- |
| `crit_policy` | P0 | `8 entries` | `packet_can_crit`、`crit_resolve_after_base_value`、`crit_multiplier_policy`、`on_crit_event` | `defender_crit_mitigation`、`crit_overflow_convert`、`random(seed)` |
| `defensive_window` | P1 | `1 entry` | `window_start_trigger`、`window_duration`、`force_damage_to_zero`、`control_immune` | 更细的屏蔽矩阵、复杂优先级 |
| `ability_on_hit_bridge` | deferred | `1 entry` | 本轮不做 | 后续如果恢复优先级，再补 `per_target_cooldown` 和 `allowlist` |

## 1. `crit_policy`

### 当前覆盖样本

- 英雄：
  - `champion:Tryndamere:passive`
- 装备：
  - `item:3031`
  - `item:3143`
  - `item:223031`
  - `item:223143`
- 海克斯：
  - `augment:92`
  - `augment:118`
  - `augment:48`

### 最小能力项

1. `packet_can_crit`
   - 判定一个 packet 是否允许暴击。
   - 最少区分：
     - `attack`
     - `skill`
     - `item_proc`
2. `crit_resolve_after_base_value`
   - 暴击不是等到命中事件再判定。
   - 正确口径是：
     1. 先形成 packet 的基础数值。
     2. 如果该 packet 允许暴击，再解析暴击倍率。
     3. 然后提交最终伤害和后置事件。
3. `crit_multiplier_policy`
   - 默认暴击倍率。
   - 技能暴击倍率。
   - 特殊 proc 的暴击倍率。
4. `on_crit_event`
   - 暴击结算后给 `tempo / trigger / counter` 层消费。
5. `defender_crit_mitigation`
   - 被攻击方的受暴击减伤。
6. `crit_overflow_convert`
   - 暴击率溢出后的转换。

### MVP 收口

- `attack / skill / item_proc` 的期望暴击
- 暴击倍率加成
- `on_crit_event`
- 防守侧暴击减伤

### 非目标

- 本轮不处理暴击动画、播报、随机表现层。
- 本轮不把 `dot / heal / shield` 的暴击一起拉进来。

## 2. `defensive_window`

### 当前覆盖样本

- 海克斯：
  - `augment:11 CantTouchThis`

### 最小能力项

1. `window_start_trigger`
   - 当前样本里是“释放终极技能后”。
2. `window_duration`
   - 明确窗口持续时间。
3. `force_damage_to_zero`
   - 窗口生效时，把进入该角色的伤害结算为 `0`。
4. `control_immune`
   - 窗口生效时，给予霸体或控制免疫标记。

### MVP 收口

- 单一防御窗口
- `0` 伤害判定
- 霸体或控制免疫标记

### 非目标

- 本轮不做 revive / death hook / immortality 链。
- 本轮不做复杂的“只挡某类伤害、不挡另一类效果”矩阵。

## 3. 下沉或暂缓项

### `incoming_damage_split`

- 当前样本：`augment:251 NumbToPain`
- 最新口径下，不把它做成通用能力。
- 处理方式改成：
  1. 先正常走减伤公式。
  2. 需要保留的数值写入所属技能或效果自己的运行时变量。
  3. 后续持续伤害由该技能或效果自己调度结算。
- 结论：
  - 它仍然需要实现。
  - 但它不再占一个通用能力家族。

### `ability_on_hit_bridge`

- 当前样本：`augment:29 EtherealWeapon`
- 当前结论很简单：
  - 先跳过。
  - 文档保留为 deferred。
  - 不把它塞进当前 MVP 的运行时结构落地顺序。

## 与现有运行时层的关系

### 已有层负责什么

- `mark layer`
  - 附着、消费、储伤、引爆
- `attr layer`
  - 属性读写、派生、穿透、适应之力
- `tempo layer`
  - 阶段、充能、返还、重置
- `counter layer`
  - 计数、阈值、周期触发

### 这轮新增什么

- `crit_policy`
  - 统一 packet 是否允许暴击，以及暴击在数值成形后的解析时机。
- `defensive_window`
  - 统一短时霸体和 `0` 伤害窗口。
- `incoming_damage_split`
  - 不再新增通用层，改为技能自持状态。
- `ability_on_hit_bridge`
  - 保留为 deferred。

## 建议实现顺序

1. `crit_policy`
2. `defensive_window`
3. `ability_on_hit_bridge`
   当前仅保留文档占位，不进入本轮实现。

## 当前判断

这份能力清单意味着，当前已经可以结束“4 个 gap 全都做成通用层”的阶段，改成：

- 先做真正会反复复用的 `crit_policy`
- 再做简化后的 `defensive_window`
- 把 `incoming_damage_split` 下沉到具体技能或效果
- 把 `ability_on_hit_bridge` 延后

下一步如果继续推进，最自然的就是按这个口径回写运行时结构和模板接口，而不是继续扩写样本散文。
