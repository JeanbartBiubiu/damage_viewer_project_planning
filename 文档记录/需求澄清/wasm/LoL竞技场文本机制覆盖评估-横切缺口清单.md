TASK_KEY: wasm-lol-entity-coverage-audit
DOC_TYPE: 需求澄清
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-04-10 00:00:00

# LoL竞技场文本机制覆盖评估-横切缺口清单

日期：2026-04-10  
状态：已收口 
数据基线：四类实体全量覆盖审计最近一轮结果

## 2026-04-11 补充修正

- 这页原先只关注 `crit / defensive_window / incoming_damage_split / ability_on_hit_bridge` 四个横切家族，已经不足以解释全量遍历中新暴露出来的样本。
- 当前需要补回两类分类修正：
  - `history_window`
  - `control_runtime_and_repeat_gate`
- 它们和“横切 gap 家族”不完全是一回事：
  - `history_window` 主要是把既有 `wasm-history-window` 任务接回 LoL 审计
  - `control_runtime_and_repeat_gate` 主要是把之前被过滤或压扁的控制结果态、每目标锁窗显式抬出来
- 这页正文继续保留为旧横切 gap 家族收口记录；新增分类修正统一参考 [LoL竞技场文本机制覆盖评估-补充专题-历史窗口与控制效果锁窗.md](C:/project/damage_viewer_project_planning/文档记录/需求澄清/wasm/LoL竞技场文本机制覆盖评估-补充专题-历史窗口与控制效果锁窗.md)。

## 当前结论

- 审计层仍然能看到 `4` 个 gap family、`11` 条 gap entry。
- 但按当前实现口径，这 `4` 个家族已经分成了 3 种处理方式：
  - `crit_policy_gap`：保留为真实横切能力，优先实现。
  - `invulnerable_window_gap`：保留为真实横切能力，但实现口径简化为 `霸体 + 0伤害判定`。
  - `incoming_damage_split_gap`：降级为“技能或效果自持变量 + 定时结算”，不再单列成通用横切能力。
  - `ability_on_hit_bridge_gap`：暂缓，明确记为 deferred，不进入当前 MVP。

## 总表

| gapFamily | 当前状态 | 代表条目 | 当前口径 |
| --- | --- | --- | --- |
| `crit_policy_gap` | active | `champion:Tryndamere:passive`、`item:3031`、`item:3143`、`item:223031`、`item:223143`、`augment:92`、`augment:118`、`augment:48` | 继续作为通用能力实现，重点是“哪些 packet 允许暴击”以及“暴击在数值成形后如何解析”。 |
| `incoming_damage_split_gap` | downgraded | `augment:251` | 不做通用 `incoming_damage_rewrite`。先正常减伤，再由所属技能或效果自己读取变量并结算后续持续伤害。 |
| `ability_on_hit_bridge_gap` | deferred | `augment:29` | 仍是未解语义，但本轮先跳过，不纳入当前运行时草案的实现顺序。 |
| `invulnerable_window_gap` | active_simplified | `augment:11` | 不做复杂“屏蔽哪些 packet kind”系统，先收成 `control_immune + force_damage_to_zero`。 |

## 1. `crit_policy_gap`

- 这是当前最明确、影响面最大的横切缺口。
- 最新口径不是“等命中事件再判暴击”，而是：
  1. 先形成 packet 的基础数值。
  2. 如果该 `attack / skill / item_proc` 允许暴击，再在这个阶段解析暴击。
  3. 然后再提交最终伤害和后置事件。
- 这意味着它仍然是横切能力，但判断时机前移到了“数值解析阶段”，而不是“命中回调阶段”。

## 2. `incoming_damage_split_gap`

- 当前样本：`augment:251 NumbToPain`
- 最新口径下，它不再要求通用的“承伤改写 + 延迟伤害缓冲池”。
- 当前处理方式改成：
  1. 先按正常物理/魔法伤害流程和减伤公式结算即时伤害。
  2. 所属技能或效果把需要保留的数值写入自己的运行时变量。
  3. 后续持续伤害由该技能或效果自己通过 scheduler 读取变量并计算。
- 结论：
  - 这仍然是一个特殊语义。
  - 但它不再是值得单列成通用层的横切 gap。

## 3. `ability_on_hit_bridge_gap`

- 当前样本：`augment:29 EtherealWeapon`
- 这类“技能也能施加攻击特效并且带每目标冷却”的语义仍然没有真正解决。
- 但当前优先级明确降低：
  - 先跳过。
  - 不把它写进本轮 MVP 的能力建设顺序。
  - 文档里保留为 deferred，避免后面误以为已经解决。

## 4. `invulnerable_window_gap`

- 当前样本：`augment:11 CantTouchThis`
- 最新口径下，不继续做大而全的 `invulnerable_window` 设计，而是先做最小收口：
  - `control_immune`
  - `force_damage_to_zero`
- 也就是说，它从“复杂无敌窗口系统”收缩成“防御窗口状态”。
- 这仍然是通用能力，但规模已经明显小于原草案。

## 本轮符文收口

本轮符文没有新增横切缺口：

- `rune:8306 海克斯科技闪现罗网`
  - 转为 `filtered / filter_mobility_spell_replace`
- `rune:8313 三重补药`
  - 转为 `filtered / filter_consumable_meta`
- `rune:8352 时间扭曲补药`
  - 转为 `filtered / filter_consumable_meta`

## 当前优先级

1. `crit_policy_gap`
2. `invulnerable_window_gap`
3. `ability_on_hit_bridge_gap`
   当前是 deferred，只保留占位，不进入本轮实现。
4. `incoming_damage_split_gap`
   当前已降级，不单列成通用能力。

## 收口判断

- 当前已经不需要再按“4 个横切 gap 全部做成通用层”的思路推进。
- 更合理的路线是：
  - 先做 `crit_policy`
  - 再做简化后的 `defensive_window`
  - 把 `incoming_damage_split` 下沉到具体技能或效果状态
  - 把 `ability_on_hit_bridge` 延后
- 后续如果全量遍历又扫出新 gap，只有在它既不能并入 `crit_policy`、也不能并入 `defensive_window`、也不能下沉到技能自持状态时，才新增新的横切家族。
