TASK_KEY: wasm-engine-v2-architecture
DOC_TYPE: 需求澄清
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-01

# WASM 通用计算引擎需求对齐记录

本文记录 2026-07-01 针对 Wasm 通用计算引擎的 grill-me 对齐结论。它只回答“系统应该是什么”和“当前偏差在哪里”，不作为可直接编码的详细设计。实现细节仍应拆到 `文档记录/概要设计/wasm/` 与 `文档记录/详细设计/wasm/`。

相关入口：

1. `文档记录/需求澄清/wasm/WASM需求澄清.md`
2. `文档记录/需求澄清/wasm/WASM机制覆盖需求.md`
3. `文档记录/需求澄清/wasm/WASM-TypeList与状态动作控制需求澄清.md`
4. `文档记录/概要设计/wasm/WASM概要设计.md`
5. `文档记录/详细设计/wasm/WASM详细设计.md`

## 1. 总体定位

Wasm 后端应是一个独立、确定性、数据驱动的计算引擎。它不读取数据库，不负责前端编辑，也不把具体游戏机制硬编码成引擎分支。

外部系统负责把游戏数据、用户选择、前端自定义数字覆盖和版本信息编译成 canonical JSON；Wasm 只消费最新 canonical schema，并在 compile 阶段把规则定义编译成只读运行产物。

Wasm ABI 生命周期首期明确拆成 `compile` 和 `run`。`compile` 消费 canonical rules/object，生成只读 compiled artifact/session；`run` 消费 run config、初始 mutable snapshot、采样参数和安全预算等运行配置，并基于同一个 compiled artifact 支持多次运行。

compiled artifact/session 由 Worker/Wasm 内部持有，JS 侧只拿 opaque `sessionId` 和轻量元数据。`compile` 至少返回 `sessionId`、`schemaVersion`、`schemaHash`、`rulesHash`；`run` 传入 `sessionId` 和 `expectedRulesHash`。如果 session 不存在、Worker 重启、schema/hash 不匹配，必须拒绝 run 并要求重新 compile。hash 只用于错配检测、结果追踪和 evidence，不让 JS 解析 compiled artifact。

同一个 compiled session 可以被多次 `run` 复用，但 runtime state 必须按 run 完全隔离。compiled session 只读；每次 `run` 都从传入的 `initialSnapshot` 创建新的 mutable runtime state。HP、resource、cooldown、dynamic provider instance、shield instance、event queue、series、warnings 和 evidence 都不跨 run 继承。

P0 不支持把某次 `run` 的 `finalSnapshot` 作为下一次 `run` 的 `initialSnapshot` 来“接着打一段”，也不支持模拟暂停/恢复或 `continueRun`。每次 `run` 都从本次 run 的 `0ms` 开始，由外部传入的初始对象快照和 run config 重新生成 driver/event queue。

P0 `initialSnapshot`/`finalSnapshot` 只包含本次 run 的战斗状态字段：combatant attrs/resources、cooldowns、active dynamic providers、shield instances、ability/provider/combatant vars。snapshot 不包含 event queue、driver/scheduler 进度、series、warnings、evidence、临时 pipeline frame 或其他只属于单次 run 执行过程的内部结构。

snapshot 中的 dynamic provider 和 shield instance 只保存 definition ref 与 mutable instance state，不完整拷贝 ability、modifier 或 rule 定义。dynamic provider 至少包含 `providerRef`/`definitionRef`、source、owner、stacks、expireAt、state；shield instance 至少包含 shield definition ref、source、owner、remaining、priority、expireAt、state。具体能力、modifier、吸收规则和触发规则仍由 compiled session 中的定义提供。

`initialSnapshot` 必须和当前 compiled session 的 hash 匹配。snapshot 需要携带 `schemaHash`/`rulesHash` 或等价的 `snapshotRulesHash`；`run` 前若发现 snapshot hash 与 session hash 不匹配，必须拒绝并要求重新 materialize/compile，不能 best-effort 迁移旧 snapshot。

`run` 必须显式携带 stop policy。P0 stop policy 支持 `durationMs`、`stopOnTargetDeath`、`stopWhenNoEvents` 和安全预算耗尽；默认必须有 `durationMs` 上限，目标死亡和事件队列为空可以提前结束，安全预算耗尽属于受控停止，返回 `done`、`summary.stopReason=budget_exceeded` 和 warning/evidence。

新 Wasm ABI 不暴露旧后端/旧前端术语，只接受 `combatant`、`provider`、`ability`、`typeKey` 等 canonical 概念。`skills`、`skill_mounts`、`ActionTemplateV2`、`target_category=hero` 等旧表或旧 DTO 可以在后端、前端展示或迁移层继续存在，但必须在 publish/materialize 层转换完成后再进入 Wasm。

Wasm compile 的错误策略分两层：协议/结构类错误可以 fast-fail，例如 JSON 解析失败、ABI envelope 缺失、不支持的 `schemaVersion`、顶层 required 字段缺失；进入已知 schema 且能可靠遍历后，必须尽量 collect-all errors。语义类 collect-all 需要覆盖未知 type key、matcher domain 错误、type 树深度/环错误、公式路径或类型错误、引用不存在、operation target 不存在、无界触发循环、bucket/domain 不匹配、HP raw set 等禁止操作。只要存在 compile error，就拒绝进入 run。

`compile` 成功但存在 warning 时仍然生成可运行 session，返回 `compile.ok=true`、`sessionId` 和 `warnings[]`。warning 只能表达非致命问题，例如有界触发链、可降级配置、确定性近似或兼容迁移提示；无界循环、未知引用、未知 type、公式类型错误等会改变可执行语义的问题必须仍然是 error。

首期战斗拓扑固定为 1v1 双对象。这里的“双对象”是两个主要 combatant，不是任意 N 对象战场。对象内部可以拥有 provider、ability、status、runtime state 等子结构。召唤物、分身、多单位目标选择不进入首期；若机制需要“子对象”，优先作为 provider、temporary provider 或 ability state 表达，不作为第三个 combatant 调度。

P0 target model 只支持固定 1v1 selector：`self`、`opponent`、`source`、`target`。范围选择、多目标、随机选敌、lowestHp/highestAttr/allEnemies 等 target query 不进入 P0 runtime；后续如果扩展多单位战斗，再设计 target query ABI。

当前 TinyGo V2 还不是稳定 MVP，因此新通用引擎 schema 和核心模型可以直接替换现有实现，不要求兼容旧 DTO 或在旧 generic runtime 上渐进迁移。P0 canonical 实体模型直接切到 `Combatant -> Provider -> Ability`，不再以 `ActionTemplateV2` 作为新引擎核心模型。旧 `single_attacker_dps` / step-loop lane 与对应 Wasm 导出已从 TinyGo V2 源码移除；历史 rationale 见下文 §11。

首期运行模式只支持 deterministic/expected single-run，不支持 seeded random。暴击等随机机制首期使用 expected 或 deterministic policy；随机分布模拟后续再扩展。

## 2. 对象与能力模型

已确认：

1. 引擎首期固定 `source/target` 或 `self/enemy` 双 combatant。
2. combatant 本身不是只有 HP 的扁平对象，而是能力与状态的调度容器。
3. `Skill` 在 wasm core 中应抽象为 `Ability`；技能、装备主动/被动、符文、天赋、状态提供的动作，本质上都可以是 ability。
4. `Combatant` 拥有 `CapabilityProvider[]`。
5. `CapabilityProvider.kind` 至少包括 `champion`、`item`、`rune`、`talent`、`status`、`system`。
6. `CapabilityProvider` 提供 `Ability[]`。
7. `Ability.kind` 至少包括 `active`、`passive_listener`、`aura_modifier`、`tick`、`stateful`。
8. 普攻不是特殊系统能力，而是带 `basic_attack` tag 的 active ability。
9. DPS driver 应自动驱动 ability，而不是特判“自动平 A”。
10. P0 driver 不自动扫描所有 active ability，也不要求前端逐 action 调 Wasm；run config 必须显式提供 driver plan。
11. driver plan 采用 scheduled attempt / discrete-event 形态：entries 显式列出 abilityRef、priority、firstAtMs、repeat/interval 或 whileReady、简单 condition，并生成 `ability_attempt` 等带逻辑时间戳的计划事件。
12. driver plan 的 condition 是 P0 公式 DSL 的受限 bool 子集，只允许读取已闭环的 `source/target attr/resource`、`ability.param` 和 cooldown/resource gate 相关数据；不允许读取 `history.*`、`event.*`、`ability.state.*`、`provider.state.*`。
13. runtime 用事件优先队列按 `timeMs + priority + stable order` 弹出事件；处理事件时进入 operation/event pipeline，并可以继续 enqueue cooldown ready、provider expire、provider tick、下一次 repeat attempt、采样点等后续事件。它跳到下一个事件点，不做固定 tick 或逐毫秒扫描。
14. 同一 `timeMs` 的默认事件类别顺序为 `expire/cleanup -> provider_tick -> scheduled ability_attempt -> triggered events/pipeline continuations -> sample`；事件类别顺序是引擎语义，不允许用户配置覆盖，同类内部再按可配置 priority + stable order。
15. Wasm driver 按 driver plan 加 cooldown、resource、gate 和 runtime state 判断执行；普攻只是 plan 中引用的 `basic_attack` ability。
16. P0 active ability runtime 只支持 instant cast：attempt 通过后在同一个逻辑时间点完成 lifecycle 与 ability operations。
17. 普通 ability 的资源成本和冷却是内建 lifecycle：attempt 先做 cooldown/resource/condition gate；成功后由 lifecycle 自动扣 cost、启动 cooldown，再进入 ability operations。
18. 同一次 ability execution 必须具备类似 DB 事务的执行帧语义：gate 通过后，将 lifecycle 的 cost/CD mutation 和 ability operations 一起放入 staged frame；frame 成功才原子提交到 runtime state，fatal error 时不能把半提交状态写进 `finalSnapshot`。
19. 同一 execution frame 内，lifecycle cost/CD 按顺序先 staged，并对后续 ability operations 的读取可见；这保证“施法已接受后”的规则读取是确定的，同时最终提交仍然是原子的。
20. 父 ability execution frame 成功提交后，才 enqueue 由它触发出来的 listener/子 ability 事件；子 listener/ability 使用独立 execution frame 执行，不能加入父 frame 回滚边界。
21. 子 frame 的 fatal error 可以终止当前 run，但不能回滚已经成功提交的父 frame；父子之间通过 committed state 与 event payload 传递上下文。
22. listener/子 ability 读取上下文时，以父 frame 已提交后的 committed state 为准，同时通过 `event.*` 读取父事件 payload，例如 damage amount、source、target、abilityRef；不暴露完整 oldState/newState 双快照。
23. ability schema 作者不需要用 `resource_change(spend mana)` 和 `cooldown_change(start cooldown)` 重复表达普通施法成本与基础 CD；复杂退款、重置、减 CD、额外资源变化再用 operation 表达。
24. `ability_attempt` 被 gate 拦住时必须记录 `attempt_skipped` evidence，原因至少覆盖 cooldown 未好、resource 不足、condition=false、目标不可用等。
25. gate 失败不停止该 driver entry，也不允许立即在同一 `timeMs` 忙循环重试；`repeat.interval` 按 interval 继续排下一次，`whileReady` 根据下一次可能 ready 时间重新 enqueue。
26. `whileReady` 的下一次可能 ready 时间按 gate 的最早可变时间推导：cooldown 未好取 cooldown ready time；resource 不足且存在已知 regen 时估算 resource ready time；condition=false 且无法推导变化时间时退化为 `conditionRecheckIntervalMs`。
27. `conditionRecheckIntervalMs` P0 默认值为 `100ms`，可由 run config 覆盖，但必须限制在 `10ms..1000ms` 内，避免过密重试或过粗漏判。
28. `Action` 不再作为能力实体；在新 schema 中只表示一次执行请求、执行事件或 runtime dispatch 概念。
29. `ActionTemplateV2` 不作为新引擎核心 DTO；若保留，只能属于 legacy/compat lane 或内部迁移对照。
30. P0 ability/operation 的 target selector 只能引用 `self`、`opponent`、`source`、`target`，并由 1v1 runtime 明确解析；不接受范围、多目标或随机 selector。

引用 ability 时不使用全局裸 `abilityId`，而使用 providerRef + local ability key。

providerRef 规则：

1. `provider.kind` 只用于分类和 matcher，不用于唯一寻址。
2. persistent provider 使用 `kind:stableId`，例如 `champion:ahri`、`item:blade_of_the_ruined_king`、`rune:conqueror`。
3. dynamic provider 在 stableId 后追加 runtime instance id，例如 `status:kindred_r#inst_42`。
4. ability 在 provider 内使用 local key，例如 `source.provider["champion:ahri"].ability["Q"]`、`source.provider["item:blade_of_the_ruined_king"].ability["passive"]`。

provider/ability runtime state 的读写边界：

1. 当前 ability 可以读写自己的 `ability.state/*`。
2. 当前 provider 可以读写自己 provider 下所有 ability 的 state。
3. combatant 级规则可以读写自己身上的 provider/ability state。
4. 只能读取 target 的公开状态，不能直接写 target 的 provider/ability state。
5. 跨对象影响必须通过 operation 表达，例如 apply status、damage、resource change、modifier。

runtime state 的命名与生命周期：

1. `ability.state.*` 生命周期跟某个 ability 绑定，例如 `ability.state.comboStep`。
2. `provider.state.*` 生命周期跟 provider 绑定，例如 `provider.state.itemStacks`。
3. `source.var.*` / `target.var.*` 是 combatant 级临时变量，生命周期跟本次 run 的 combatant 绑定。
4. 能归属到 ability 的状态不放 provider；能归属到 provider 的状态不放 combatant var。
5. `var` 只用于确实跨 provider/ability 的角色级临时状态。

## 3. 属性、资源与运行态值

已确认：

1. `base/current/max/resolved` 是同一个属性槽位的不同视图，不应拆成互不相关的 base 属性。
2. `AttributeSlot` 专门处理 `base/current/max/resolved`、modifier、bucket resolver 和 dirty/resolve。
3. `ResourceSlot` 专门处理 `current/max`、spend、refund、clamp。
4. provider runtime state、ability runtime state、变量、计数器等使用更通用的 typed `ValueSlot`。
5. 公式读取能力按两档推进：P0 runtime 先闭环对象属性、资源和当前 ability 参数；provider state、ability state、事件上下文和历史窗口先作为 schema/compile 预留能力。
6. Wasm schema 中当前执行能力的路径根统一使用 `ability`，例如 `ability.param.baseDamage`、`ability.state.stacks`、`ability.cooldown.remaining`。
7. 前端可以继续向用户展示 `skill` 这个领域词，但发布层必须转换为 canonical 的 `ability` 路径根；Wasm 不同时支持 `skill` 和 `ability` 两套根。
8. `source.attr.attack_damage.resolved`、`target.attr.hp.current`、`ability.param.baseDamage`、`event.damage.final` 这类显式路径是目标方向。
9. history/window 的目标最小读取能力固定为 `sum`、`count`、`last`、`delta`，但不要求进入首批 P0 runtime 闭环。
10. `sum` 用于读取时间窗口内某类事件某个字段的累计值。
11. `count` 用于读取时间窗口内某类事件的次数。
12. `last` 用于读取最近一次匹配事件的字段值。
13. `delta` 用于读取某个路径在时间窗口内的变化量。

## 4. 规则定义、公式与操作

已确认：

1. 规则定义进入 Wasm 后是只读的。
2. 用户自定义数字覆盖发生在前端 materialize simulation object 之后、ABI payload 之前，不在 Wasm 内做可变规则定义。
3. 公式 DSL 保持有限表达式 DSL，不引入任意脚本。
4. 公式 DSL 的 P0 边界分两档：runtime 必须闭环数值公式；schema/compile 可以先预留更复杂表达，不要求首轮 runtime 完整。
5. P0 runtime 必须支持 `const`、`read`、`ref`、`add/sub/mul/div`、`min/max/clamp`，返回类型以 number 为主，并在 compile 阶段做类型检查。
6. runtime 内部数值统一按 `float64` 计算，不在每个公式节点或 operation 后隐式保留两位小数；否则持续伤害、攻速、冷却、百分比乘区等场景会累积误差。
7. 公式 DSL 需要支持显式取整函数 `round/floor/ceil/trunc`，其中 `round` 可带 `decimals` 参数；游戏规则确实要求两位或整数结算时，必须在规则中显式声明。
8. runtime 公式或 operation 产生除零、`NaN`、`Inf` 等非有限数时，必须作为当前 run 的 fatal error 停止执行，并返回明确 error/evidence；不能静默转成 0，也不能自动 clamp。
9. P0 runtime 读路径先支持 `source.attr.*`、`target.attr.*`、`source.resource.*`、`target.resource.*`、`ability.param.*`。
10. 普通公式里的 `compare`、`and/or/not`、`if`、`event.*`、`history.*`、`ability.state.*`、`provider.state.*` 属于 P0 schema/compile 预留或 P0 后段/P1 runtime 能力；P0 例外是 driver plan condition 和 pipeline modifier condition 可使用受限 bool 子集。
11. 所有运行态数值变更都应走统一 command/operation pipeline，而不是 effect/status/item 直接写状态。
12. operation value policy 至少包括 `set`、`keep`、`add`、`multiply`、`percent_add`、`min`、`max`、`clamp`。
13. 这些数值操作适用于属性、资源、HP 变化、冷却、消耗、ability runtime numeric param 等运行态数字。
14. P0 operation 分成两档验收，避免按大清单一次性要求全部 runtime 完整。
15. P0 runtime 必须闭环的 operation：`damage`、`heal`、`shield`、`resource_change`、`attribute_change`、`cooldown_change`、`apply_provider`、`refresh_provider`、`expire_provider`、`emit_event`。
16. P0 schema/compile 预留、首轮 runtime 可不完整的 operation：`ability_state_change`、`provider_state_change`、`combatant_var_change`、`pipeline_guard`、`execute_threshold`、`interrupt`/`control`。
17. `interrupt`/`control` 首批只要求 schema/compile 能表达和校验，不要求 runtime 完整实现施法条、动作队列打断、前后摇取消、打断优先级或控制免疫。
18. `cast_time`、`channel`、前摇、后摇、施法条、移动限制、控制打断、免控等动作生命周期首批只做 schema/compile 预留，不进入 P0 runtime。
19. P0 集成验收优先按少量代表性竖切场景，而不是按 operation 清单逐项宣称全部完成。
20. HP 不提供直接 `set_hp` 语义；HP 变化必须通过 `damage`、`heal`、`shield` 或 pipeline guard 约束后的语义命令进入。
21. 千珏大招这类“期间不会低于某生命值”的机制应建模为 temporary provider 提供的 `pipeline_guard`，例如 `hp_floor`、`prevent_below`、`prevent_death`、`damage_cap`，用于约束本次 HP mutation 的 applied 结果，而不是直接设置 HP。
22. `pipeline_guard` 首期固定支持 `hp_floor`、`prevent_death`、`damage_cap`、`immune`；但 runtime 完整行为可作为 P0 后段或 P1。
23. HP 是强语义例外；其他 runtime numeric state 可以通过 operation value policy 直接 `set`。
24. `resource_change` 允许 `set`、`add`、`refund`、`spend`、`clamp`。
25. 普通 ability cost 不需要手写为 `resource_change`；`resource_change` 用于 ability 效果、被动、状态、装备、符文、资源回复 tick、抽蓝、返还资源、维持消耗等运行中资源变化。
26. `cooldown_change` 允许 `set`、`reduce`、`reset`、`refund`、`extend`。
27. `ability_state_change`、`provider_state_change`、`combatant_var_change` 允许使用通用 operation value policy。
28. `execute_threshold` 用于收集者这类“本次伤害结算后，目标 HP 满足阈值则直接终结目标”的机制；它必须发生在普通伤害、抗性、pipeline modifier 和 HP mutation 之后，不是额外伤害，也不能污染普通 damage source 或 damage timeline。
29. `execute_threshold` 需要输出独立 evidence，至少说明 threshold、检查时的 HP、max HP、是否触发和来源 ref；击杀收益、刷新、金币、参与击杀、多目标 execute、目标选择传播等不进入 P0 runtime，后续作为 P1/后段结算能力设计。

P0 集成验收样例固定为四条竖切：

1. 基础伤害竖切：一个 active ability 造成 damage，经 pipeline 扣 target HP，并输出 summary、finalSnapshot、series[]。
2. 资源 + 冷却竖切：一个 active ability 消耗 resource 并进入 cooldown；再次施放被 gate 阻止；结果中可解释资源和冷却状态。
3. 临时 provider + 属性/护盾竖切：ability apply_provider，provider 提供 attribute modifier 或 shield，过期后清理；验证 apply、refresh、expire provider 与 operation pipeline。
4. fixed interval tick provider 竖切：temporary provider 定义固定 tick 间隔，按事件队列触发 DOT/HOT/资源变化等 tick operation 或 tick ability，直到 provider 过期或被移除。

千珏大招这类 `pipeline_guard` 不进入首批竖切，先作为 P0 schema/compile 预留或 P0 后段能力。

## 5. Modifier、乘区与 resolver

已确认：

1. modifier 可以来自任意 provider、ability、status 或 temporary provider，不限于 status。
2. P0 modifier 只支持两类：attribute modifier 和 pipeline modifier。
3. attribute modifier 只作用于属性 resolver，例如攻击力、攻速、护甲、最大生命值等 `attr.*.resolved` 计算。
4. P0 attribute modifier 无条件，挂载即生效；需要条件属性变化时，用 apply/expire temporary provider 或 status provider 生命周期表达。
5. pipeline modifier 只作用于命令结算 pipeline，例如 damage、heal、shield、resource、cooldown 等 command 的最终结算。
6. P0 pipeline modifier 只能修改当前 command 的数值、标签或结算标记，不允许产生额外 command；额外伤害、治疗、资源变化等新增行为必须通过 listener 或 ability operation 表达。
7. P0 pipeline modifier 支持有限条件：只能读取 `source/target attr/resource`、`ability.param`、event payload 基础字段，以及 type/tag matcher。
8. P0 pipeline modifier condition 不支持 `history.*`、`ability.state.*`、`provider.state.*`、嵌套 `if` 或完整条件 DSL；这些先作为 schema/compile 预留或 P1 扩展。
9. aura、事件 modifier、跨对象 modifier、复杂优先级与完整 modifier 系统先作为 schema/compile 预留或 P1 扩展，不进入 P0 runtime。
10. bucket/乘区是 resolver policy，不是 slot storage。
11. bucket 按 domain/channel 定义，不做全局混用。
12. 通用 bucket resolver 应用于属性与数值 command，例如 damage、heal、shield、cooldown、resource cost、ability runtime numeric param。
13. stage/phase 顺序显式定义；同一 stage 内按 priority + stable order。
14. damage pipeline 需要预留 `crit context`，用于表达 expected/deterministic 暴击拆分、是否真实暴击、暴击倍率、roll/seed 等上下文。P0 首期只要求 deterministic/expected single-run，不要求 seeded random 完整序列。
15. `critOnly` pipeline modifier 必须消费明确的 `crit context`，例如兰顿只修改暴击部分；缺少 `crit context` 时不能把整个 damage command 近似乘上同一个系数。首批 P0 竖切不要求闭环 `critOnly` modifier，但概要/详细设计必须保留该 payload 边界。

## 6. Status 与动态 provider

已确认：

1. status definition 保持独立定义。
2. runtime status instance 表现为 `CapabilityProvider(kind=status)`。
3. status instance 持有 state、stacks、expire、source、owner、provided abilities、modifiers。
4. champion/item/rune/talent/system provider 是持久 provider。
5. status/temporary/dot 等是动态 provider。
6. P0 支持最小 fixed interval tick provider：temporary/status provider 可以声明固定 `tickIntervalMs` 和 tick 行为，runtime enqueue `provider_tick` 事件，每次 tick 以独立 instant ability/operation frame 执行。
7. tick provider 在 provider 过期或被移除后不再触发；与过期时间同一 `timeMs` 时，按默认事件类别顺序先 expire/cleanup，因此不会执行过期边界上的 tick。
8. 动态 tick 间隔、haste 缩放、快照/实时双模式、多目标 tick 等复杂规则先作为 schema/compile 预留，不进入 P0 runtime。
9. shield 是专用 runtime object，不作为 P0 dynamic provider；护盾是跨游戏常见一等机制，应由 `ShieldInstance` 负责吸收规则、剩余值、优先级、过期和日志证据。
10. 如果某个护盾存在期间还提供能力、监听或属性，应额外创建 temporary provider 表达附带效果，而不是让所有 shield 都 provider 化。
11. 动态 provider 的状态变更仍走 operation pipeline。
12. temporary provider 的创建、刷新、叠层、到期和清理全部走 operation pipeline。
13. 创建使用 provider operation 表达；刷新/叠层使用 refresh/add-stack 类 operation 表达。
14. 到期由 scheduler 触发 expire operation；清理由 pipeline 统一移除 modifiers、listeners、provided abilities 和 runtime state。
15. status tick、effect 或 listener 不允许私下直接删除 provider。

## 7. 触发、事件与循环

已确认：

1. ability 之间可以互相触发，靠事件 type 和 matcher/listener 实现。
2. 允许有限链式触发。
3. compile 阶段需要检测调用链环。
4. 无界循环直接报错；有界循环允许通过，但必须带 warning/evidence。
5. runtime 仍保留硬保护，例如 `maxChainDepth`、`maxCommandsPerEvent`、`maxEvents`、visited guard。
6. P0 默认安全预算固定为 `maxChainDepth=32`、`maxCommandsPerEvent=256`、`maxEvents=100000`；后续可通过 ABI/config 调整，但首期必须有明确默认值。
7. 宿主/Worker 需要提供墙钟超时保护，默认单次模拟最多 30 秒；到期应 abort 当前 run，必要时直接 terminate/recreate Worker，避免未检测出的死循环卡住用户设备。
8. 30 秒超时是宿主安全边界，不参与战斗数值语义；Wasm 内部仍以 `maxEvents`、`maxCommandsPerEvent`、`maxChainDepth` 等确定性预算为主。
9. 离散事件 run 的正常停止条件由 stop policy 决定：达到 `durationMs`、目标死亡且 `stopOnTargetDeath=true`、事件队列为空且 `stopWhenNoEvents=true`，或安全预算耗尽。
10. event taxonomy 首期固定为：`ability_cast`、`ability_hit`、`provider_tick`、`damage_dealt`、`damage_taken`、`heal_applied`、`shield_applied`、`status_applied`、`status_expired`、`resource_changed`、`cooldown_changed`。
11. `before_damage_calc`、`after_modifier_resolve` 等细粒度节点首期作为 pipeline stage，不作为对外 event taxonomy。

## 8. Type、Tag 与 reservedType

已确认：

1. `reservedType` 是前端和 Wasm 需要共同使用的保留 type 常量来源。
2. 前端和 Wasm 应使用 const 或生成 const，不应运行时查 DB 表来理解 reservedType。
3. `types` 表是给用户自定义业务 type 用的。
4. 自定义 type/tag 首期至少要支持 combatant、provider、ability、status matcher。
5. `type_relations.target_category='type'` 已在表设计中表达层级关系。
6. type relation 的主要定位是配置编辑器的辅助分类和选择组织，不作为 Wasm 自动推导语义。
7. Wasm 不做父子 type 闭包展开；实体实际拥有的 type 必须在 canonical payload 中显式列出。
8. type 树最多两层：顶层分组 type + 一层具体 type，不允许“类型的类型的类型”。
9. 顶层 type 只作为 UI 分组/筛选节点；对象理论上不携带顶层 type，Wasm payload 和 matcher 只接收具体 type。
10. 一个具体 type 只能属于一个顶层分组。例如 `dash` 不能同时挂在 `movement` 和 `mobility` 下；如果业务需要多个分类，应让对象同时挂多个具体 type。
11. 如果页面需要表达“movement 的所有子 type”，应在前端配置页展示 movement 下的一层具体 type 供用户选择，并把最终选择结果固化为明确 type 列表。
12. type relation 的深度错误和环形关系需要双层报错：前端/发布层尽早提示用户，Wasm compile 也必须 collect-all 报错，防止坏 payload 进入模拟。
13. `reservedType` 不直接进入 Wasm matcher；它只作为前端/发布层/wasm 共享常量语义。发布层负责把 game-local type 解析成 canonical type key，Wasm matcher 只消费 canonical key 编译出的短 ID。
14. type key 统一使用 `domain/name` 字符串，例如 `ability/basic_attack`、`ability/dash`、`status/stun`、`provider/item`、`event/damage_dealt`、`damage/physical`。
15. Wasm 内部可以使用一个 flat TypeRegistry；不同语义靠 `domain/` 前缀防冲突。
16. matcher 字段必须在 compile 阶段限制允许的 domain，例如 ability matcher 不能填 `status/stun`。

## 9. ABI 前数字自定义

已确认：

1. 用户自定义编辑发生在“用户点击 Wasm 模拟后的对象 -> 用户自定义修改 -> ABI 协议”之间。
2. 用户看到的可以是一个大 JSON；工程上可以拆成 init payload 与 run payload。
3. 首期只允许修改已有 `tunable: true` 数字 value。
4. 不允许改 key、增删字段、改结构、改 string/bool/enum。
5. 结构 diff 若发现非数字 value 变更，应拒绝。
6. 安全边界只做有限值、非 NaN/Inf、engine max、probability 0..1 等硬约束。
7. 业务推荐范围只做 warning，不阻止用户模拟。
8. 前端只保存一个最近 override patch，使用 `localStorage`。
9. hash mismatch 时丢弃旧 patch。
10. override patch 不进入 Wasm 语义；Wasm 不知道哪些数字来自用户覆盖，只消费最终 canonical payload 中的数字值。

## 10. 输出与用户关注点

已确认：

1. 用户最关心的是直观图表，而不是所有底层细节。
2. Wasm 仍应保留结构化日志、snapshot、done/error 和必要 evidence 字段。
3. ValueTrace 和更细的调试详情可以后续补接口，不作为当前最先完成目标。
4. DPS 曲线输出应来自通用 driver 驱动 ability 的结果，不应绑定 `single_attacker_dps` 的硬编码机制。
5. 首期 done/result 必须包含 chart-ready series，不能只输出 final snapshot 后让前端从日志二次拼时间线。
6. P0 `done` 最小 ABI 必须包括 `ok`、`summary`、`finalSnapshot`、`series[]`、`warnings[]`、`evidence`、`seriesSamplingEvidence`。
7. P0 `summary` 必须有固定最小字段，作为对比图表和结果总览的稳定行数据；至少包括 `durationMs`、`stopReason`、双方 final HP、双方伤害统计、`abilityAttemptCount`、`abilityCastCount`、`attemptSkippedCount`、`warningCount`、`evidenceTruncated`、`seriesDownsampled`。
8. P0 `summary.stopReason` 固定核心枚举：`duration_reached`、`target_dead`、`source_dead`、`both_dead`、`no_events`、`budget_exceeded`；不能用开放字符串替代。`fatal_error` 不属于 `done.summary.stopReason`，而是 `error` 通道。
9. 同一逻辑时间点双方都死亡时使用 `both_dead`；这不是 runtime invariant 异常，尤其要覆盖反伤、延迟伤害、同时间触发链等正常同归场景。
10. 多个 stop 条件在同一逻辑时间点同时满足时，`summary.stopReason` 使用固定主因优先级：`budget_exceeded > both_dead > source_dead/target_dead > duration_reached > no_events`；其它同时满足的条件进入 evidence，不改变主 stop reason。
11. 伤害统计必须保留双方视角，而不是只保留 source 输出。P0 字段口径至少覆盖 `sourceDamageDealt`、`sourceDamageTaken`、`targetDamageDealt`、`targetDamageTaken`；前期开发可以先主要驱动 source 输出，但 schema 需要能表达 target 输出、source 承受和后续 A/B 对打分析。
12. `abilityAttemptCount`、`abilityCastCount`、`attemptSkippedCount` 在 `summary` 先给全局总数，同时输出 `abilityStats[]` 按 `abilityRef` 分组的 attempt/cast/skip 计数；具体 UI 展示后续按图表效果再调整。
13. P0 `error` 最小 ABI 必须包括 `ok=false`、`phase`、`code`、`message`、`path` 或 `ref`、`severity`、`recoverable`、`details`、`schemaHash`、`rulesHash`，若已进入 session 还应包含 `sessionId`。
14. compile collect-all 返回 `errors[]`，每个 error 使用同一结构；只要存在 compile error 就不生成可运行 session。
15. compile 成功但存在 warning 时返回 `warnings[]` 且仍生成 session；此时 `compile.ok=true`，调用方可以继续 run。
16. run 阶段 fatal error 返回单个主 `error`，不再同时返回正常 `done`，也不提供可作为下一次 run 输入的 `finalSnapshot`。error 可附带 `evidence` 描述缺失 session、snapshot/hash 不匹配、runtime invariant 失败、非有限数值等上下文。
17. P0 `error.code` 固定核心枚举：`json_parse_error`、`schema_version_unsupported`、`missing_required_field`、`unknown_ref`、`unknown_type_key`、`matcher_domain_error`、`formula_type_error`、`operation_target_missing`、`trigger_cycle_unbounded`、`hp_raw_set_forbidden`、`session_not_found`、`hash_mismatch`、`runtime_invariant_failed`。
18. P0 `evidence` 必须是结构化数组，每项至少包含 `timeMs`、`kind`、`ref` 或 `path`、`message`、`data`。
19. P0 核心 `evidence.kind` 至少包括 `attempt_skipped`、`budget_exceeded`、`downsampled`、`guard_applied`、`hash_mismatch`、`session_missing`、`runtime_warning`。
20. P0 默认 `maxEvidenceItems=1000`；超过上限后不继续追加明细，只保留摘要计数，例如 `truncatedEvidenceCount` 和按 kind 聚合的计数。
21. `warnings[]` 是面向用户的摘要提示，`evidence` 是机器可追踪事实明细。warnings 用于有界循环、降采样、预算接近上限、业务范围 warning 等需要用户理解的概括信息；具体哪次 attempt skipped、哪条 guard applied 等明细进入 evidence。
22. warning 可以引用相关 evidence kind/id，但不重复记录完整明细。
23. P0 `warnings[]` 也必须结构化，每项至少包含 `code`、`message`、`severity`、`refs` 或 `evidenceRefs`，可选 `count` 用于同类聚合。
24. P0 默认 `maxWarnings=100`；超过上限后同类 warning 必须聚合计数，不继续无限追加用户摘要。
25. 图表输出相关细节由 Wasm/Worker 实现侧先按稳定 ABI、可画图、低成本原则收口；后续以前端实际图表效果和用户理解成本为准再迭代，不再逐项阻塞需求澄清。
26. chart/summary 等展示型输出默认保留小数点后两位即可；`finalSnapshot`、状态字段和内部计算状态不能因为展示格式被截断，避免结果对比、调试和后续分析继承到显示层误差。
27. `series[]` 至少覆盖 `timeMs`、双方 HP 当前值、双方累计伤害、双方累计 DPS、双方窗口 DPS；字段口径与 summary 的 source/target 双方视角保持一致。
28. 图表输出需要按使用场景分类，不应只按“单次时间序列”理解：
   - 按时间点展示的单轮次模拟：需要 time series。
   - 不同属性下的总伤害、耗费时间对比：需要 sweep comparison。
   - 不同装备下的伤害对比：需要 equipment comparison。
   - 同装备、不同模拟对象的对比：需要 target comparison。
29. 只有单轮次时间序列一定需要采样频率；对比类图表优先输出每个 variant 的 summary/comparison row，是否附带每个 variant 的 time series 由后续模式决定。
30. 不同属性、装备、目标等对比类模拟首期由前端/Worker 编排多次 single run 并汇总；Wasm core 首期只保证单次 run 稳定。
31. 对比类模拟应复用同一个 compiled artifact/session，只替换 run config、初始 mutable snapshot 或前端 materialize 后的数字值，避免每个 variant 都重复完整 compile；各 variant 的 runtime state 必须互相隔离。
32. 后续如果 variant 数量或性能压力证明有必要，再增加 Wasm batch/sweep ABI，不作为当前首期要求。
33. 单轮 time series 的采样间隔由 run input 指定，例如 `sampleEveryMs`；窗口 DPS 由 run input 的 `dpsWindowMs` 指定，P0 默认值为 `1000ms`。
34. time series 采样点也是 scheduled event：runtime 根据 `sampleEveryMs` enqueue `sample` 事件，和 ability attempt、provider expire、tick 共用事件队列。
35. 同一 `timeMs` 上战斗事件和 sample 事件的先后顺序必须由默认事件类别顺序 + priority + stable order 固定；sample 默认在同一时间点最后，记录该时刻所有战斗变化结算后的状态，避免同一输入多次运行出现不同曲线。
36. `windowDps` 在 `timeMs < dpsWindowMs` 的开局阶段使用实际可用窗口 `[0, timeMs]` 计算，即分母为当前已模拟时长，而不是固定 `dpsWindowMs`；`timeMs=0` 时按 `0` 或空值处理，避免除零。
37. Wasm 使用 `maxSeriesPoints` 作为兜底上限，P0 默认值为 `5000`；如果点数超过上限，按时间均匀降采样。
38. done/result 需要输出 `seriesSamplingEvidence`，说明原始采样间隔、是否降采样、最终点数。

## 11. single_attacker_dps 的定位（历史决策 → 已移除）

已确认（历史 rationale，保留）：

1. 现有 `single_attacker_dps` 已经跑偏，不应继续作为新机制扩展主线。
2. 它曾冻结为 legacy/compat lane，用于旧页面或历史验证。
3. 新机制应进入通用 runtime、provider、ability、listener、operation pipeline。
4. 后续 DPS driver 只负责按规则调度 ability 并产出曲线数据。
5. 普攻 skill 化后，不应再在 DPS lane 里硬编码 first attack、attack speed cap、target dummy 等机制假设。
6. 新通用引擎完成前，现有页面可以继续调用 `single_attacker_dps`，但必须标记为 legacy/compat，并且不再新增机制。
7. 新通用引擎完成后，`single_attacker_dps` 不再作为对外入口；最多保留内部 fixture 或回归测试用于对照。
8. 所有新能力只进入通用 provider/ability/operation pipeline。

当前状态（LEGACY-DPS-REMOVAL）：TinyGo V2 已删除 `dps_*.go`、legacy step-loop 运行时/旧 compile-formula-scheduler 专路径，以及 `engine_init` / `engine_begin_run` / `engine_step` / snapshot / abort 导出。Worker/ABI 唯一业务入口为 `engine_compile` / `engine_run` / `engine_release_session`。通用 `sampling.dpsWindowMs` / windowDps / DPS series 指标保留。Web 侧资产与 adapter 同步是后续有序步骤。

## 12. 当前实现偏差摘要

基于当前 TinyGo V2 review，主要偏差如下：

1. Generic runtime 已有 `EngineBundleV2`、双 actor、attribute/resource/action/status/formula/trigger 骨架，但还不是 P0 已确认的 `Combatant -> Provider -> Ability` canonical schema，也不是完整 provider/ability/operation pipeline。
2. `AttributeSlot` 已有 base/current/max/resolved，但 `DerivedFormulaID` 尚未真正接入属性刷新。
3. formula VM 已有 numeric bytecode，但读取路径仍偏窄，尚未覆盖 `source/target/skill/event` 的完整路径模型。
4. `EffectTypeSpendResource`、`EffectTypeModifyAttribute` 已在 DTO 中出现，但 generic compile/runtime 没有完整映射执行。
5. `command`、`pipeline` 包仍是骨架，数值变更尚未全部统一回流。
6. TypeSet 当前是 flat bitset matcher，符合“不做父子闭包”的方向；偏差在于 compile/发布契约尚未明确校验两层树、父节点禁入 matcher 等规则。
7. `single_attacker_dps` 曾是同步完成的专用 lane，包含 LoL/ADC/single-target 假设；该 lane 与导出已从 TinyGo V2 移除。

## 13. 下一轮应继续确认的问题

后续 grill-me 只问会影响系统模型、ABI、数据表达、P0/P1 范围或实现路线的决策。已有成熟通用解法的执行细节由 Wasm/Worker 实现侧先按推荐方案收口，写入概要设计或详细设计；实际效果有问题再回到需求层修正。

Type 关系、路径读取、公式 DSL P0 两档边界、数值内部 float64 且不隐式两位取整、显式 round/floor/ceil/trunc、非有限数 runtime fatal、展示型输出默认两位小数、driver condition 受限 bool 子集、attribute modifier 无条件、pipeline modifier 只改当前 command、pipeline modifier condition 受限 bool 子集、crit context 与 `critOnly` modifier 保留边界、P0 active ability instant cast、ability lifecycle 内建 cost/cooldown、ability execution 事务帧、父子触发独立 frame、listener 读取 committed state + event payload、resource_change 用途边界、execute_threshold 后段结算边界、fixed interval tick provider、provider_tick 事件顺序、P0 1v1 target selector、P0 modifier 两类边界、history/window 目标能力、event taxonomy、runtime 安全预算、run stop policy、providerRef 唯一寻址、provider/ability state 读写边界、runtime state 命名、shield 专用 runtime object、temporary provider 生命周期、HP guard、operation set、cast/channel schema 预留、interrupt/control P0 预留边界、compile/run 生命周期、compiled session 持有与 hash 失效规则、多 run runtime state 隔离、P0 不支持 finalSnapshot 续跑、snapshot 战斗状态范围、snapshot instance definition ref 边界、snapshot/session hash 匹配边界、compile fast-fail/collect-all 边界、compile warning 不阻止 session、done/error 通道边界、error ABI、error.code 核心枚举、evidence 结构与限量、warnings/evidence 分工、warnings 结构与限量、summary 最小字段、abilityStats 按 abilityRef 分组、stopReason 核心枚举、both_dead 同归口径、stopReason 同时满足优先级、双方伤害统计视角、图表输出细节实现侧默认收口、schema/ABI 边界、旧术语不进入新 Wasm ABI、chart-ready 输出、series DPS 字段口径、windowDps 起始窗口口径、scheduled attempt / discrete-event driver plan 边界、attempt gate 失败调度规则、whileReady ready-time 推导规则、同 timeMs 默认事件顺序、事件类别固定且类内 priority 可配置、sample 事件采样口径、对比类编排边界、单轮 time series 采样口径、通用实现细节默认由实现侧收口、直接替换路线、P0 canonical `Provider + Ability` 模型、legacy 边界、deterministic 运行模式和 1v1 拓扑边界已收口。

下一步应从本文拆出概要设计与详细设计，并据此 review 当前 TinyGo V2 实现差距。
