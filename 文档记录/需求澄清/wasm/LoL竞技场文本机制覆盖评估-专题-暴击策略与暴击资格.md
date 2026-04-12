TASK_KEY: wasm-lol-entity-coverage-audit
DOC_TYPE: 需求澄清
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-04-10 00:00:00

# LoL竞技场文本机制覆盖评估-专题-暴击策略与暴击资格

日期：2026-04-10
状态：已确认缺口
数据快照：`文档记录/详细设计/最小验证/数据/lol_竞技场静态文本快照`
Data Dragon 版本：`16.7.1`

## 范围约束

- 只讨论 `1v1` 数值主链路里的暴击资格与暴击结算策略。
- 只收“哪些 packet 可以暴击、如何暴击、暴击后如何派生”的语义。
- 纯暴击率数值加成不单独成节；只有当它牵涉资格、倍率、溢出转换、受击减免或 `on_crit` 订阅时才进本专题。

## 专题定位

当前的运行时层已经能承接：

- `formula`
- `sustain`
- `trigger`
- `mark`
- `attr`
- `tempo`
- `counter`
- `filter`

但暴击并不是其中任意一层的普通样本。它是横切策略，真正的链路更接近：

- `DamagePacket.tags`
- `crit_policy`
- `active_damage_policies`
- `on_crit event`

所以本专题的结论是：**暴击资格与暴击策略必须作为一条独立缺口存在，不能继续塞进普通运行时层。**

## 最小能力清单

当前最小收口建议是 6 项：

1. `packet_crit_eligibility`
   - 普攻、技能、装备效果、DoT、治疗、护盾是否允许暴击。
2. `crit_resolution_mode`
   - 至少支持 `expected` 期望模式；后续再补 `random(seed)`。
3. `crit_multiplier_policy`
   - 默认暴击倍率、特例倍率、技能暴击倍率、装备效果暴击倍率。
4. `crit_overflow_convert`
   - 暴击率封顶后转额外属性或额外暴击伤害。
5. `defender_crit_mitigation`
   - 受击方减少所受暴击伤害。
6. `on_crit event`
   - 暴击后订阅冷却返还、额外真伤、叠层、资源返还等次级效果。

## 与现有 8 层的关系

- `attr` 仍负责提供 `crit_chance / crit_damage_bonus` 这类属性源。
- `formula` 仍负责普通伤害公式，但“是否暴击、暴击如何放大”不再由它独自决定。
- `sustain` 可继续处理治疗和护盾本身，但“治疗/护盾能否暴击”属于 `crit_policy`。
- `tempo`、`counter`、`trigger` 仍可消费 `on_crit event`，但它们不是暴击资格真源。

换句话说：

- `Tryndamere passive` 是 `crit chance` 的来源，不是完整暴击系统。
- `Yuntal Wildarrows` 是 `on_crit -> refund_cooldown` 的订阅者，不是暴击资格真源。
- `Zeri E` 是 `on_crit -> cooldown_refund` 的消费者，也依赖统一 `crit_policy`。

## 样本矩阵

### 样本 1：`augment:48` `珠光护手`

- 技能可以暴击。
- 同时给出暴击总伤害倍率。
- 同时包含 `AP -> crit chance` 转换。

判断：

- 这是最典型的 `crit_policy_gap`。
- 既不是普通 `formula`，也不是普通 `attr`。

### 样本 2：`augment:92` `易损`

- 装备效果和持续伤害效果可以暴击。

判断：

- 这是 `item proc / DoT` 的暴击资格策略。
- 当前 8 层没有任何一层能单独描述它。

### 样本 3：`augment:118` `会心治疗`

- 治疗和护盾可以暴击。

判断：

- 这是 `heal/shield packet` 的暴击资格策略。
- 不能误写成普通 `sustain` 增幅。

### 样本 4：`item:3031` `无尽之刃`

- 直接给出暴击伤害。

判断：

- 这不是普通面板加成。
- 它要求引擎存在 `crit bonus multiplier` 口径。

### 样本 5：`item:3143` `兰顿之兆`

- 减少所受暴击伤害。

判断：

- 这是防守侧 `crit mitigation policy`。
- 不能被误并为普通减伤。

### 样本 6：`item:3032` `育恩塔尔荒野箭`

- 攻击叠暴击几率。
- 暴击时额外缩减冷却。

判断：

- 它本身不是新的策略层。
- 但它明确依赖 `crit chance source + on_crit event`。

### 样本 7：`champion:Tryndamere:passive`

- 怒气被动增加暴击几率。

判断：

- 这是英雄侧 `crit chance` 属性源。
- 之所以仍是缺口，不是因为怒气计数器不会建模，而是因为当前没有统一的暴击资格与消费口径。

### 样本 8：`champion:Zeri:spell:ZeriQ / ZeriE`

- `Q` 按攻击处理，可暴击。
- `E` 在暴击时额外缩减冷却。

判断：

- 这是 `packet kind bridge + on_crit consumer`。
- 证明暴击策略和普通技能公式必须解耦。

## 当前收口判断

本专题确认 3 件事：

1. `crit policy` 是独立缺口，不属于现有 8 层。
2. 只要实现了统一的 `crit_policy + on_crit event`，很多现有 `tempo / trigger / sustain` 条目就不需要再单独开新系统。
3. 在草案设计前，审计表里凡是涉及“技能可暴击、DoT 可暴击、治疗/护盾可暴击、暴击率溢出转换、受暴击减伤”的条目，都应优先标成 `crit_policy_gap`。

## 分阶段建议

### MVP

- 只做 `expected crit`。
- 支持普攻/技能/装备效果是否可暴击。
- 支持基础暴击倍率与暴击伤害加成。

### P1

- 增加 `random(seed)` 随机暴击模式。
- 增加 `on_crit event`。
- 允许 `tempo / counter / trigger` 订阅暴击事件。

### P2

- 扩到 DoT 暴击。
- 扩到治疗/护盾暴击。
- 扩到暴击率溢出转换和防守侧暴击减免。

## 当前结论

本专题的最终判断是：**继续做全量覆盖审计没有问题，但“暴击资格与暴击策略”已经被证明是实现前必须单独拉出的横切缺口。**

它不该继续混在：

- 普通属性层
- 普通伤害公式层
- 普通治疗/护盾层
- 普通节奏层

后续如果进入结构草案阶段，`crit_policy` 应与 `mark_state / derived_stat_from_attrs / cast_stage / counter_state` 并列为独立能力入口，而不是作为某个模板的附带字段处理。
