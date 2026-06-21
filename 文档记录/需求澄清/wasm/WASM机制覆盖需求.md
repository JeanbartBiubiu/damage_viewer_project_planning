TASK_KEY: wasm-lol-entity-coverage-audit
DOC_TYPE: 需求澄清
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-04-25 16:31:02

# WASM 机制覆盖需求

本文收束原 `LoL竞技场全量覆盖审计-*` 与 `LoL竞技场文本机制覆盖评估-*` 散文档，作为 Wasm 计算引擎的机制需求入口。详细实现口径以 `WASM详细设计.md` 为准，本文只回答“引擎需要覆盖哪些机制能力，以及为什么这些能力是必要的”。

## 1. 覆盖对象

LoL 竞技场机制覆盖按四类实体审计：

1. 英雄：技能、被动、持续状态、阶段执行、命中触发、标记和资源。
2. 装备：属性、主动/被动、伤害触发、护盾治疗、冷却、唯一效果。
3. 符文：阈值、周期触发、状态条件、增益/减益、伤害/治疗策略。
4. 海克斯强化：模式级规则改写、派生属性、暴击资格、伤害策略和特殊触发。

这些实体不应在引擎里写成硬编码分支，而应统一落到 type/tag、trigger、command、pipeline、attribute、resource、history、counter、mark、crit、augment 等公共机制上。

## 2. 机制能力分组

### 2.1 比例、阈值和条件触发

代表样本包括护盾阈值、斩杀线、低血量增益、累计伤害触发和周期触发。

需要能力：

1. 公式读取属性、资源、历史窗口和 counter。
2. 条件支持大于、小于、区间、比例、缺失值、阈值跨越。
3. trigger matcher 支持 actor/action/item/status/effect/damage type/tag。
4. 同一事件内触发需要 once-per-event 和 fanout 限制。

### 2.2 护盾、治疗、吸血和 HP 变动

代表样本包括护盾产生、按伤害类型吸收、治疗溢出、吸血基于实际伤害、护盾猛击类效果。

需要能力：

1. ShieldInstance 独立于 StatusInstance。
2. 多实例护盾支持 scope、priority、refresh、expire。
3. 治疗输出 attempted、applied、overheal。
4. 吸血读取 actual damage dealt。
5. HP 变动必须走统一 ValuePipeline，不能由 action/status/item 直接改。

### 2.3 命中触发、on-hit 桥接和标记结算

代表样本包括阿卡丽 E、伊芙琳魅惑、伊泽瑞尔印记、布隆被动、布兰德叠层。

需要能力：

1. action/effect/damage packet 携带 type/tag。
2. TriggerIndex 按 EventPhase 和 TypeMatcher 命中。
3. MarkState 支持 source-target 方向、过期、消费、移除、lockout。
4. TypeList 网络支持一个 action 触发多个 type 下的 action，重叠 action 只执行一次。

### 2.4 资源、节奏、冷却、阶段和返还

代表样本包括充能技能、命中返还、冷却缩减、重复施放、阶段技能。

需要能力：

1. ResourceRuntime 支持 current/max、spend/refund/regen。
2. ActionRuntimeState 保存 readyAt、charges、recharge timers。
3. cooldown 支持 reduce/reset/refund。
4. auto-repeat 被控制阻断后可重排。
5. ExecutionInstance 表达 cast/channel/recovery/impact 等阶段。

### 2.5 叠层、时效、计数器和周期触发

代表样本包括每三次攻击、叠层刷新、阈值消耗、周期伤害、按时间衰减。

需要能力：

1. CounterState 支持 actor/pair/global scope。
2. counter 支持 initial value、threshold、consume、reset、periodic proc。
3. StatusInstance 支持 stacking、refresh、expire、duration policy。
4. history/counter/mark 必须是一等机制状态，不能从日志倒推。

### 2.6 抗性、穿透、转化和派生属性

代表样本包括护甲转攻击力、穿透顺序、适应之力、移动速度软上限、超额攻速转 AD。

需要能力：

1. AttributeRuntime 支持 base/current/max/resolved/dirty。
2. modifier 支持 flat、percent、override、clamp、temporary max。
3. 派生属性按阶段计算，避免循环依赖。
4. 穿透和减免只在对应伤害类型公式中生效。
5. bonus、missing、ratio 等读取口径要由属性系统统一提供。

### 2.7 暴击策略与暴击资格

代表样本包括珠光护手、易损、会心治疗、无尽之刃、兰顿之兆、技能/DoT 可暴击。

需要能力：

1. 暴击资格由 type/tag 和 active policy 决定，不写死枚举。
2. crit result 在 execution 级生成，source-side scalar 可复用。
3. damage、heal、shield、status、cadence scalar 都可以声明 crit policy。
4. target reactive damage 不继承 source crit。
5. P0 支持 deterministic/expected crit，P1 支持 seeded random。

### 2.8 防御窗口、免疫、不可选取和控制锁窗

代表样本包括无敌窗口、受控阈值给霸体、解控、免控、重复施放限制。

需要能力：

1. ControlDirectiveInstance 与 StatusInstance 分离。
2. action gate 读取控制状态，不暂停 scheduler。
3. interrupt 取消 execution 后续事件。
4. cleanse/immunity 使用矩阵表达。
5. defensive window 在 shield 和 HP mutation 前生效。

### 2.9 特殊文本过滤或转换

有些文本不应直接进入计算内核：

1. 纯展示描述。
2. 地图、单位寻路、召唤物 AI 等首期非目标。
3. 需要人工语义归类的复杂文本。
4. 可由前端或数据编译层预处理的描述。

这些能力应进入数据治理或 adapter，而不是让 TinyGo runtime 做自然语言判断。

## 3. TypeList 网络需求

机制覆盖要求实体可通过类型网络互相匹配：

1. action 可以触发 B type action。
2. action 也可以触发 C type action。
3. B/C type 内有同一个 action 时只执行一次。
4. item/status/augment/trigger 可以按 actor/action/item/status/effect/damage type/tag 匹配。

因此需求侧明确要求：

1. DTO 层实体声明 `types` 和 `tags`。
2. compile 层生成 `TypeRegistry`、`TypeSet`、`InvertedIndex`。
3. runtime 使用 bitset 精确匹配，不使用 Bloom filter。
4. 多 type 合并时使用 generation scratch 去重。
5. type 继承只允许 compile 阶段展开，runtime 不做递归遍历。

## 4. 最小实现优先级

### P0

1. TypeList / TypeSet / TypeIndex / DedupeScratch。
2. Damage/heal/shield/resource/attribute 四通道。
3. Trigger -> Command -> Resolver 回流。
4. HistoryWindow、CounterState、MarkState。
5. Control gate、interrupt、pending intent。
6. Crit deterministic/expected policy。

### P1

1. 完整 cadence charge/recharge/refund。
2. Augment active policies。
3. 属性派生 DAG 和循环检测。
4. 移动速度软上限。
5. seeded random crit。

### P2

1. 更复杂的召唤物、地形、寻路、目标选择。
2. 多单位战斗。
3. 文本自动归类和批量规则生成。

## 5. 当前收口结论

LoL 竞技场文本覆盖评估不再作为多个散文件进入 review。后续只看：

1. `WASM需求澄清.md`
2. `WASM机制覆盖需求.md`
3. `WASM概要设计.md`
4. `WASM详细设计.md`

原样本级判断已经合并为能力清单；如后续需要恢复样本级证据，应从 git 历史或原始数据源查找，而不是继续维护散文档。
