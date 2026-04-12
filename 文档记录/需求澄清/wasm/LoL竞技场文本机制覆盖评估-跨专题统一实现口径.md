TASK_KEY: wasm-lol-entity-coverage-audit
DOC_TYPE: 需求澄清
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-04-09 16:34:41

# LoL竞技场文本机制覆盖评估-跨专题统一实现口径

日期：2026-04-10
状态：已确认
数据快照：`文档记录/详细设计/最小验证/数据/lol_竞技场静态文本快照`
Data Dragon 版本：`16.7.1`
来源专题：

- `LoL竞技场文本机制覆盖评估-专题-标记附着与消费`
- `LoL竞技场文本机制覆盖评估-专题-属性派生与穿透顺序`
- `LoL竞技场文本机制覆盖评估-专题-充能阶段与冷却返还`
- `LoL竞技场文本机制覆盖评估-专题-计数器初值阈值消费与周期触发`

## 2026-04-11 补充修正

- 这页原先的“四层运行时口径”只够覆盖首批高频样本，不足以覆盖竞技场全量遍历。
- 全量审计时，必须额外显式补回两类语义：
  - `history`：最近承伤、灰色生命值、状态快照回溯
  - `control`：控制施加、控制免疫、`defensive_window`、`per_target_lockout`
- 用户提到的“`N` 秒内被控超过 `M` 秒后获得霸体”不需要新造顶层系统，按 `recent_cc_duration_window + counter_state + stack_threshold_proc + defensive_window` 组合表达即可。
- `remaining_charges` 不再允许吞并“储存最近值”或“每目标锁窗”语义。
- 这一轮新增的细化结论统一收口在 [LoL竞技场文本机制覆盖评估-补充专题-历史窗口与控制效果锁窗.md](C:/project/damage_viewer_project_planning/文档记录/需求澄清/wasm/LoL竞技场文本机制覆盖评估-补充专题-历史窗口与控制效果锁窗.md)。

范围约束：

- 只讨论 `1v1` 数值计算
- 跳过召唤物
- 地形、位移、多目标、建筑物、史诗级野怪只在必要时标记为 `需转换`
- `第8/9组` 当前阶段继续跳过，不并回主链路
- 本文目标不是再扩样本，而是把已确认专题收成实现前统一口径

## 文档目的

前四个二级专题已经证明：当前瓶颈不在新公式节点，而在运行时状态和触发契约能否统一。  
本文只做一件事：把前面已经稳定下来的结论压成一份实现前规范，避免后续又退回到按英雄逐条特判。

## 当前统一前提

1. 阿卡丽 `E` 按 `E1 / E2` 两个技能处理，`E2` 通过目标上的标记状态解锁。
2. 伊芙琳 `W` 当前只保留“成熟后再命中消费”的主收益线，提前打破印记的低收益分支先剪掉。
3. 死亡 / 复活相关钩子当前阶段不进入实现收口。
4. 穿透必须写进物理伤害、魔法伤害公式内部，不做公式外的模糊修正。
5. `第7组` 只作为属性层基线附录；`第8/9组` 继续留在边界层，不进入 `1v1` 核心战斗模板。

## 四层运行时口径

### 1. 标记层

本层只负责“先附着、后消费、再刷新/引爆”的目标级状态，不负责计数器和属性派生。

稳定实体：

- `mark_state`
- `armed_mark`
- `stored_damage_on_mark`

`mark_state` 最小字段集：

- `source_ref`
- `target_ref`
- `duration`
- `armed_at`
- `consume_trigger`
- `consume_result`

`stored_damage_on_mark` 额外字段：

- `stored_damage_amount`
- `detonation_rule`

稳定模板：

- `mark_attach`
- `mark_arm`
- `mark_consume`
- `mark_refresh_or_unlock`
- `stored_damage_on_mark`
- `mark_detonate`

本层已经定死的边界：

- 标记不是布尔值，而是目标级可消费状态。
- 标记消费结果不一定是伤害，也可以是冷却刷新、技能解锁、资源返还。
- 只有像 `劫 R` 这种“窗口内储伤、到期再爆”的机制才进入 `stored_damage_on_mark`。
- `阿卡丽 / 伊芙琳 / 伊泽瑞尔 / 艾瑞莉娅` 这类样本都留在 `mark_state`，不要误抬成储伤模型。

### 2. 属性层

本层只负责属性读写与伤害公式内部修正，不负责触发时机和计数过程。

稳定模板：

- `flat_stat_bonus`
- `derived_stat_from_attrs`
- `stack_to_stat`
- `penetration_modifier`
- `adaptive_force`

本层已经定死的边界：

- `flat_stat_bonus` 是属性层基线，不是本轮主收口对象。
- `derived_stat_from_attrs` 负责“读多个输入属性，再写回一个派生属性”。
- `stack_to_stat` 负责“从层数/计数结果写回一个或多个属性”，但层数本体仍归计数器层。
- `penetration_modifier` 必须进入 `physical_damage_formula(...)` 和 `magic_damage_formula(...)` 内部。
- 穿透顺序按“先应用攻击方穿透，再进入目标防御减伤”处理。
- `adaptive_force` 保持为独立中间属性，不提前折叠成 `AD / AP`。

### 3. 节奏层

本层只负责技能可释放性、可恢复次数和冷却回收，不负责标记附着和计数阈值。

稳定状态与模板：

- `cast_stage`
- `remaining_charges`
- `recharge_timer`
- `consume_charge`
- `refund_cooldown`
- `reset_skill_cd`
- `grant_charge`

本层已经定死的边界：

- `cast_stage` 是同一技能内部的顺序阶段链，不等于充能。
- `remaining_charges` 是“还能放几次”的库存，不等于阶段链。
- `recharge_timer` 只负责给充能池回补次数，不等于普通冷却计时。
- `refund_cooldown` 是按数值缩短剩余冷却，不等于 `reset_skill_cd`。
- `grant_charge` 单独承接击杀 / 参与击杀驱动的额外再次施放次数，不和冷却返还混用。

### 4. 计数器层

本层只负责记次数、预置初值、阈值消费和周期供给，不负责标记附着和属性派生公式。

稳定状态与模板：

- `counter_state`
- `counter_seed`
- `stack_threshold_proc`
- `periodic_proc`
- `counter_consume`

常见伴随状态：

- `lockout_window`
- `permanent_growth`

本层已经定死的边界：

- `counter_state` 不等于普通 `buff stack`。
- `counter_seed / initial_value` 可以覆盖开场满层或预置效果，不需要先引入死亡 / 复活钩子。
- `stack_threshold_proc` 统一承接“第 N 次触发”和“叠到 N 层触发”。
- `periodic_proc` 与计数器、阈值触发属于同一层运行时契约，不再单独拆一套子系统。
- 布隆、布兰德、羊刀式“第 N 次触发”应按同一类计数器机制讨论。

## 跨层调用规则

### 允许的调用方向

1. `mark_consume` 可以产出伤害、资源返还、`refund_cooldown`、`reset_skill_cd` 或技能解锁。
2. `counter_state / stack_threshold_proc` 可以驱动 `stack_to_stat`、控制效果、延迟爆炸或永久成长。
3. `remaining_charges / grant_charge` 可以被命中、击杀、参与击杀等事件驱动，但它们仍属于节奏层，不吞并事件来源本身。
4. 伤害公式只读取属性层产出的属性口径与 `penetration_modifier`，不直接管理标记、计数器或充能状态。

### 不允许的混用方式

1. 不要把 `mark_state` 压成“是否有标记”的布尔位。
2. 不要把 `cast_stage` 和 `remaining_charges` 合并成一个“技能次数”桶。
3. 不要把 `refund_cooldown`、`reset_skill_cd`、`grant_charge` 都叫成“刷新”。
4. 不要把 `counter_state` 直接当成普通 buff 层数使用。
5. 不要把 `adaptive_force` 直接写死成 `AD` 或 `AP`。
6. 不要把穿透实现成公式外层的普通属性加成。

## 当前明确不做的范围

1. 死亡 / 复活 / 死后延迟结算钩子，不进入这一轮统一实现口径。
2. 召唤物、伙伴、地图对象、建筑物、史诗级野怪，只保留 `需转换` 标记。
3. `loadout` 替换、经济奖励、round meta、身份伪装等边界机制，继续留给 `第8/9组`。
4. 纯 `item-only` 的基础属性加成，不扩成新的主专题，只作为属性层基线参考。

## 建议的最小实现收口

如果下一步进入实现准备，最少需要先把下面 4 组口径固定：

1. `mark_state / stored_damage_on_mark`
   - 先把目标级标记状态做成可附着、可武装、可消费、可引爆的统一载荷。
2. `derived_stat_from_attrs / penetration_modifier / adaptive_force`
   - 先把属性层读写、穿透顺序和独立中间属性的口径定死。
3. `cast_stage / remaining_charges / refund_cooldown / grant_charge`
   - 先把节奏层的状态边界拉开，避免以后所有技能节奏都挤进一个桶。
4. `counter_state / counter_seed / stack_threshold_proc / periodic_proc`
   - 先把计数器专题收成统一触发契约，避免按英雄散落实现。

## 实现前稳定结论

1. V2 当前不需要为了 LoL 竞技场文本再新增一批公式 AST 节点。
2. 当前真正需要统一的是运行时状态层，而不是继续扩数值表达式。
3. 四层运行时口径已经足够覆盖前面专题里的核心样本。
4. 只要按这四层分工落实现，后续新增英雄、装备、强化时大概率都应先落模板，再判断是否真有必要开特判。

## 当前判断

本文结论是：**LoL 竞技场当前最需要的不是更多专题，而是一份跨专题统一实现口径；而这份口径现在已经足够稳定，可以直接作为实现前规范使用。**

更具体地说：

- 标记层解决“附着、消费、引爆”
- 属性层解决“派生、穿透、适应之力”
- 节奏层解决“阶段、充能、冷却回收”
- 计数器层解决“记数、阈值、周期触发”

下一步如果继续推进，重点应该转向“按这四层整理实现接口或运行时结构”，而不是再回头重复拆样本。
