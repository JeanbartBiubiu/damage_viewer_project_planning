TASK_KEY: wasm-engine-v2-architecture
DOC_TYPE: 概要设计
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-04-23

# 概要设计：TinyGo 事件管线与对象化数据流

> 日期：2026-04-23
> 状态：草案
> 适用范围：TinyGo Wasm 战斗计算引擎
> 目标：说明对象化实体边界，以及实际计算时数据如何在实体间流转

---

## 1. 背景与结论

当前 `damage_wasm_dev` worktree 的 Wasm 计算引擎默认优先走 TinyGo 路线。TinyGo 版本不应简单复刻 Java/Rust 的类继承结构，也不应把两个 actor 做成两个真实线程。推荐方案是：

- 运行时状态按对象聚合，表达 actor、item、action、status 的归属关系。
- 执行拓扑保持中央事件驱动，由一个 `BattleScheduler` 串行推进。
- action 之间不直接互调，通过 `Event -> TriggerRule -> Command -> Scheduler` 联动。
- 数值修正不散落在 action 里，通过 `EffectResolver -> ValuePipeline -> Mutation` 统一落地。
- `EventPhase` 表示外层战斗生命周期节点，`ValuePhase` 表示内层数值计算节点，二者分层但互相衔接。

一句话结论：对象化负责“谁拥有什么能力与状态”，中央管线负责“什么时候执行、按什么顺序执行、如何结算数值”。

---

## 2. 设计目标

1. 支持前端输入完整数据包后，在 Wasm 内实例化两个 actor runtime。
2. 支持 actor 装备 item，并从 item 继承 action、trigger、modifier。
3. 支持 actor 自身 action 与装备 action 统一进入主动技能队列。
4. 支持 action 触发 action，且触发链可排序、可限制、可回放。
5. 支持伤害、治疗、资源变化、属性变化通过统一 effect/mutation 通道修改 actor。
6. 支持命中前后、施法前后、受伤前后、造成伤害前后等生命周期事件。
7. 支持暴击、增伤、减伤、抗性、护盾、最终 clamp 等数值修正阶段。
8. 保持单线程确定性，不依赖浏览器 Wasm 多线程能力。
9. 支持前端输入公式后，Wasm 在初始化阶段实例化公式对象；运行时只通过 `FormulaRef + EvalContext` 求值。

---

## 3. 非目标

- 不在第一版实现真实多线程或 actor 独立 goroutine 调度。
- 不让 item、status、action 直接互相调用并修改对方 actor。
- 不把所有事件阶段和数值阶段塞进同一个枚举。
- 不在 action 内部硬编码所有暴击、增伤、减伤和反伤逻辑。
- 不让公式对象持有战斗时状态或自行消费随机数。

---

## 4. 数据实体

### 4.1 静态定义层

静态定义层来自前端输入或编译后的 bundle，只描述规则，不持有战斗时状态。

```go
type EngineBundle struct {
    Actors    []ActorDefinition
    Items     []ItemDefinition
    Actions   []ActionDefinition
    Effects   []EffectDefinition
    Statuses  []StatusDefinition
    Triggers  []TriggerRule
    Modifiers []ModifierDefinition
    Formulas  []FormulaDefinition
}
```

核心实体如下：

| 实体 | 职责 |
|------|------|
| `ActorDefinition` | 角色模板，定义基础属性、初始资源、自带 action、默认生命周期参数 |
| `ItemDefinition` | 装备模板，提供属性修正、附带 action、被动 trigger、modifier |
| `ActionDefinition` | 普攻、主动技能、被动派生 action 的定义，描述成本、标签、施法阶段和 effect 列表 |
| `EffectDefinition` | 伤害、治疗、资源变化、属性变化、状态施加等效果模板 |
| `StatusDefinition` | 状态模板，描述控制、护盾、增益、减益、持续时间、刷新策略 |
| `TriggerRule` | 事件监听规则，匹配 `EventPhase` 后生成 `Command` |
| `ModifierDefinition` | 数值修正规则，声明作用于哪个 `ValuePhase` |
| `FormulaDefinition` | 公式定义，供 action、effect、condition、modifier 引用 |

### 4.2 编译索引层

Wasm 初始化时先把静态定义编译成更适合热路径使用的结构。字符串 ID 可以保留在边界层，热路径优先使用数字 ID。

```go
type CompiledBundle struct {
    ActionTable   []CompiledAction
    EffectTable   []CompiledEffect
    StatusTable   []CompiledStatus
    FormulaTable  []FormulaObject
    FormulaRegistry FormulaRegistry
    TriggerIndex  TriggerIndex
    ModifierIndex ModifierIndex
    IDMap         IDMap
}
```

核心索引如下：

| 索引 | 用途 |
|------|------|
| `TriggerIndex` | 按 `EventPhase + actionId/tag/source/target` 快速找到候选 trigger |
| `ModifierIndex` | 按 `ValuePhase + channel + tag/source/target` 快速找到候选 modifier |
| `FormulaRegistry` | 管理初始化时实例化的公式对象，并根据 formulaId 执行公式 |
| `ActionCatalog` | 根据 actionId 创建 `ActionInstance` |
| `EffectCatalog` | 根据 effectId 创建 `EffectInstance` |

`TriggerIndex` 是 action 联动的关键。action1 触发 action2/action3 时，不由 action1 直接调用它们，而是由 trigger 命中后生成 `QueueActionCommand`。

### 4.2.1 公式对象管理

前端输入的公式应在 Wasm 初始化阶段完成实例化。运行时不要重复解析公式文本或 AST，也不要在 action/effect 内部临时拼公式。

```go
type FormulaRegistry struct {
    Formulas []FormulaObject
    IDToIndex map[FormulaID]uint16
}

type FormulaObject struct {
    FormulaID FormulaID
    InputSpec FormulaInputSpec
    Program   FormulaProgram
}

type EvalContext struct {
    SourceActor ActorID
    TargetActor ActorID
    PairRef     PairRef
    ActionRef   ActionInstanceID
    EffectRef   EffectInstanceID
    Inputs      ValueInputs
}
```

公式对象的职责：

- 持有已编译的表达式、字节码或节点数组。
- 声明需要读取的输入，例如 source attribute、target status、effect input、pair state。
- 接收 `EvalContext` 后返回数值结果。
- 保持纯函数语义，不直接修改 `ActorRuntime`、`PairState`、`EffectInstance`。

公式对象不应做的事：

- 不持有战斗时状态。
- 不直接访问全局可变对象。
- 不自行消费 RNG。
- 不直接触发 action、effect 或 mutation。

如果未来公式需要随机函数，随机数仍由 `RngRuntime` 按 stream 和 draw index 提供，公式只能从 `EvalContext` 读取已经分配好的随机输入，不能自己调用随机源。第一版建议公式保持纯确定性，把暴击、命中、随机触发放在 pipeline 或 trigger runner 中消费 RNG。

### 4.3 运行时实体层

运行时实体只存在于一次 battle/run 中。

```go
type BattleRuntime struct {
    NowMs        int64
    Scheduler    *BattleScheduler
    Actors       map[ActorID]*ActorRuntime
    PairStates   map[PairRef]*PairState
    Executions   map[ExecutionID]*ExecutionInstance
    ChainState   ChainState
    Rng          RngRuntime
    Diagnostics  RuntimeDiagnostics
    Logs         []LogEntry
    Formulas     *FormulaRegistry
    Triggers     *TriggerIndex
    Modifiers    *ModifierIndex
}
```

```go
type ActorRuntime struct {
    ActorID       ActorID
    DefinitionID  ActorDefinitionID
    Attributes    AttributeState
    Resources     ResourceState
    HP            HPState
    Statuses      StatusState
    Loadout       ActorLoadout
    QueueManager  *ActionQueueManager
    ActionStates  map[ActionID]*ActionRuntimeState
    Cooldowns     CooldownState
    Counters      CounterState
    History       HistoryState
    RuntimeFlags  ActorRuntimeFlags
}
```

运行时实体职责如下：

| 实体 | 职责 |
|------|------|
| `BattleRuntime` | 一次模拟的根上下文，持有全局时间、actor、索引、日志和 chain 状态 |
| `BattleScheduler` | 唯一的全局事件队列，按 time、priority、sequence 推进 |
| `ActorRuntime` | actor 当前状态聚合，包含属性、资源、HP、状态、装备与技能装载结果 |
| `PairState` | source-target 关系状态，例如 mark、每目标冷却、锁定窗口 |
| `ActionQueueManager` | actor 级动作管理者，维护主动 action 请求、GCD、自动普攻节奏、队列策略 |
| `ActionRuntimeState` | action 的持久状态，例如冷却、充能、启用禁用 |
| `ExecutionInstance` | 一次执行中的施法、飞行体、延迟命中、引导状态 |
| `ScheduledEvent` | 调度器事件，承载 action、effect、status expire、tick 等 payload |
| `ActionInstance` | 一次实际 action 释放，记录 source、target、parent、chain、tags、临时参数 |
| `EffectInstance` | 一次实际 effect 结算，记录 source、target、channel、formula、tags、上下文输入 |
| `ValueContext` | 数值 pipeline 的上下文，承载基础值、当前值、修正来源、命中/暴击结果 |
| `Command` | trigger 的输出，表示下一步要排 action、施加 effect、添加 modifier 或改状态 |
| `Mutation` | effect 最终落地的状态变化，如扣血、回血、扣蓝、加状态、改属性 |
| `RngRuntime` | 中央随机数状态，保证随机消费顺序可回放 |
| `LogEntry` | 对外可见日志，用于前端展示、debug、回放和验证 |

### 4.4 ActorLoadout

actor 实例化时，应把角色自身、装备、初始状态贡献的能力合并成 `ActorLoadout`。

```go
type ActorLoadout struct {
    ActionIDs   []ActionID
    TriggerRefs []TriggerRef
    ModifierRefs []ModifierRef
}
```

合并顺序建议固定为：

1. actor definition 自身 action、trigger、modifier。
2. item definition 提供的 action、trigger、modifier。
3. initial status 提供的 trigger、modifier。
4. run input 临时 override。

合并结果必须可追踪来源，每个 ref 都要保留 `SourceKind` 与 `SourceID`，方便日志和冲突排查。

### 4.5 状态归属表

运行时状态必须先确认归属，避免所有内容都塞进 `ActorRuntime` 或 `StatusInstance`。

| 状态类型 | 推荐归属 | 示例 |
|----------|----------|------|
| actor 基础属性与资源 | `ActorRuntime` | HP、mana、attack_damage、armor |
| action 持久状态 | `ActionRuntimeState` | 冷却、充能、是否禁用 |
| 单次执行状态 | `ExecutionInstance` | 施法阶段、飞行体、延迟命中、引导剩余时间 |
| actor 临时状态 | `StatusInstance` | stun、shield、buff、debuff、dot、hot |
| source-target 关系 | `PairState` | mark、每目标冷却、锁定窗口、对某目标增伤 |
| 历史窗口 | `HistoryState` | 最近 3 秒受伤、最近 N 次命中、连击窗口 |
| 计数器 | `CounterState` | 第几次普攻、层数计数、触发次数 |
| 全局调度状态 | `BattleScheduler` | status expire、dot tick、飞行体落地事件 |
| 随机数状态 | `RngRuntime` | 暴击、命中、随机触发的 stream 与 draw index |

`LogEntry` 不是机制状态。日志用于展示、debug 和回放记录；机制查询应读 `HistoryState`、`CounterState` 或 `PairState`，不要在热路径回扫日志。

---

## 5. 事件与数值阶段

### 5.1 EventPhase

`EventPhase` 是外层生命周期节点，主要供 `TriggerRule` 监听，用来生成新 command。

```go
type EventPhase uint16

const (
    EventBattleStart EventPhase = iota
    EventActorSpawned
    EventActionQueued
    EventActionCastStart
    EventActionHitCheck
    EventBeforeEffect
    EventBeforeDamage
    EventAfterDamage
    EventBeforeHeal
    EventAfterHeal
    EventBeforeResourceChange
    EventAfterResourceChange
    EventBeforeAttributeChange
    EventAfterAttributeChange
    EventStatusApplied
    EventStatusExpired
    EventActionResolved
    EventActorDeath
    EventBattleEnd
)
```

`EventPhase` 可以触发：

- `QueueAction`
- `ApplyEffect`
- `ApplyStatus`
- `RemoveStatus`
- `AddTemporaryModifier`
- `CancelAction`
- `InterruptAction`
- `EmitLog`

### 5.2 ValuePhase

`ValuePhase` 是内层数值计算节点，只供 `ValueModifier` 修改当前 `ValueContext`，不直接触发新 action。

```go
type ValuePhase uint16

const (
    ValueBase ValuePhase = iota
    ValueSourceOutgoing
    ValuePreCrit
    ValueCrit
    ValuePostCrit
    ValueTargetIncoming
    ValueMitigation
    ValueShield
    ValueFinalClamp
)
```

`ValuePhase` 用于处理：

- 攻击方增伤、治疗加成、资源消耗修正。
- 暴击、命中、闪避、特殊倍率。
- 目标方减伤、易伤、治疗降低。
- 护甲、魔抗、穿透、真实伤害等 profile。
- 护盾吸收、最终取整、上下限 clamp。

### 5.3 两类阶段的关系

外层事件包住内层数值管线。

```text
EventActionCastStart
  -> EventActionHitCheck
  -> EventBeforeEffect
      -> ValueBase
      -> ValueSourceOutgoing
      -> ValueCrit
      -> ValueTargetIncoming
      -> ValueMitigation
      -> ValueShield
      -> ValueFinalClamp
  -> Mutation
  -> EventAfterDamage / EventAfterHeal / EventAfterResourceChange
  -> EventActionResolved
```

设计约束：

- `TriggerRule` 监听 `EventPhase`，可生成 command。
- `ValueModifier` 作用于 `ValuePhase`，只修改当前数值。
- 如果某个数值修正需要触发 action，应先通过 `EventPhase` 生成临时 modifier 或 command，不允许 modifier 直接排 action。

---

## 6. Trigger 与 Command

### 6.1 TriggerRule

`TriggerRule` 是 action 联动的声明式规则。

```go
type TriggerRule struct {
    RuleID     RuleID
    Owner      TriggerOwnerRef
    Listen     EventFilter
    Conditions []ConditionDef
    Commands   []CommandDef
    Priority   int16
    Limit      TriggerLimit
}
```

```go
type EventFilter struct {
    Phase       EventPhase
    SourceRole  EventActorRole
    TargetRole  EventActorRole
    ActionIDs   []ActionID
    ActionTypes []ActionType
    EffectKinds []EffectKind
    Tags        []TagID
}
```

### 6.2 Command

`Command` 是 trigger 的输出，不直接修改 actor，必须回到 scheduler 或 resolver。

```go
type CommandDef struct {
    Kind       CommandKind
    ActionID   ActionID
    EffectID   EffectID
    StatusID   StatusID
    TargetRole EventActorRole
    DelayMs    int64
    Priority   int16
}
```

常见 command：

| Command | 含义 |
|---------|------|
| `QueueAction` | 把 action 排入 `BattleScheduler` |
| `ApplyEffect` | 立即或延迟创建 `EffectInstance` |
| `ApplyStatus` | 给目标添加状态 |
| `RemoveStatus` | 移除状态 |
| `AddTemporaryModifier` | 给当前 chain 或 effect 注入临时数值修正 |
| `CancelAction` | 取消尚未结算的 action |
| `InterruptAction` | 打断可打断的施法或引导 |

### 6.3 连锁触发控制

action1 触发 action2/action3 的数据流如下：

```text
ActionInstance(action1)
  -> emit EventActionCastStart(action1)
  -> TriggerIndex 查候选规则
  -> TriggerRule 条件通过
  -> 生成 QueueAction(action2), QueueAction(action3)
  -> Scheduler 入队
```

需要内置以下防爆规则：

| 机制 | 目的 |
|------|------|
| `chainId` | 标记同一条触发链 |
| `parentActionId` | 追踪 action 由谁触发 |
| `chainDepth` | 限制递归深度 |
| `oncePerEvent` | 同一事件同一规则只触发一次 |
| `internalCooldown` | 被动自身内置冷却 |
| `maxCommandsPerEvent` | 限制单个事件派生数量 |

---

## 7. Effect 与 Mutation

### 7.1 EffectInstance

action 本身不直接扣血、回血、扣蓝或改属性。action 只生成 effect。

```go
type EffectInstance struct {
    EffectID     EffectID
    Kind         EffectKind
    SourceActor  ActorID
    TargetActor  ActorID
    FormulaID    FormulaID
    Tags         []TagID
    ActionRef    ActionInstanceID
    ChainID      ChainID
    Inputs       ValueInputs
}
```

基础 effect kind：

| EffectKind | 用途 |
|------------|------|
| `Damage` | 伤害结算 |
| `Heal` | 治疗结算 |
| `ModifyResource` | 蓝量、能量、怒气、弹药等资源变化 |
| `ModifyAttribute` | 攻击力、护甲、移速等属性变化 |
| `ApplyStatus` | 添加控制、护盾、buff、debuff |
| `RemoveStatus` | 清除或移除状态 |

### 7.2 Mutation

`EffectResolver` 执行完 effect 后只输出 mutation，再由统一应用器修改 `ActorRuntime`。

```go
type Mutation struct {
    Kind        MutationKind
    TargetActor ActorID
    Amount      float64
    AttributeID AttributeID
    ResourceID  ResourceID
    StatusID    StatusID
    Source      MutationSource
}
```

使用 mutation 的原因：

- 统一日志输出。
- 统一 after event。
- 方便回放和测试。
- 避免 action、item、status 越权直接修改 actor。

---

## 8. 运行时数据流

### 8.1 初始化流

```text
前端 EngineBundle + RunInput
  -> Wasm 校验引用
  -> 编译 ID 并实例化公式对象
  -> 构建 TriggerIndex / ModifierIndex
  -> 实例化 self ActorRuntime
  -> 实例化 enemy ActorRuntime
  -> 合并 actor/item/status loadout
  -> 创建两个 ActionQueueManager
  -> BattleScheduler 入队初始事件
```

初始化阶段输出的是完整 `BattleRuntime`，之后前端不参与内部调度。

### 8.2 调度流

```text
BattleScheduler.pop()
  -> 按 triggerAtMs / priority / sequence 取事件
  -> 更新 BattleRuntime.NowMs
  -> 分派到 action/effect/status/tick handler
  -> handler 可能生成新 Command
  -> Command 可能重新入队或进入 EffectResolver
```

同一时刻建议使用固定 phase 顺序：

1. 状态过期、控制解除。
2. 新状态应用、控制变化。
3. action gate 检查。
4. effect resolve。
5. after trigger 与队列补充。

眩晕不暂停 scheduler。眩晕只让对应 actor 的 action gate 拒绝通过、延后或中断，其他 actor 与状态事件继续推进。

### 8.3 Action 执行流

```text
ScheduledEvent(ActionIntent)
  -> ActorRuntime.QueueManager 校验队列规则
  -> action gate 检查死亡、眩晕、冷却、资源
  -> 创建 ActionInstance
  -> 必要时创建 ExecutionInstance
  -> EventActionCastStart
  -> TriggerRule 生成联动 Command
  -> 扣除资源或生成 ModifyResource effect
  -> ActionDefinition 生成 EffectInstance
  -> EffectResolver 执行 effect
  -> EventActionResolved
```

action gate 的结果应明确记录：

| 结果 | 含义 |
|------|------|
| `Allowed` | action 可以继续执行 |
| `BlockedByStun` | actor 处于眩晕，action 失败或延后 |
| `BlockedByCooldown` | 冷却未完成 |
| `BlockedByResource` | 资源不足 |
| `Cancelled` | 被其他事件取消 |
| `Interrupted` | 施法或引导中被打断 |

### 8.4 Damage 计算流

```text
Damage EffectInstance
  -> EventBeforeDamage
  -> 创建 ValueContext
  -> ValueBase 计算基础值
  -> ValueSourceOutgoing 处理来源方增伤
  -> ValueCrit 处理暴击
  -> ValueTargetIncoming 处理目标方减伤/易伤
  -> ValueMitigation 处理抗性与穿透
  -> ValueShield 处理护盾吸收
  -> ValueFinalClamp 处理最终上下限
  -> 输出 DamageMutation
  -> 应用扣盾/扣血
  -> EventAfterDamage
```

敌方在受击时的额外减伤不应该写进 action。它应来自目标 actor、装备或状态贡献的 `ModifierDefinition`，在 `ValueTargetIncoming` 或 `ValueMitigation` 阶段参与当前 `ValueContext`。

### 8.5 Heal / Resource / Attribute 流

治疗、资源、属性变化复用同一套结构，只是 channel 不同。

```text
EffectInstance
  -> EventBeforeHeal / EventBeforeResourceChange / EventBeforeAttributeChange
  -> ValuePipeline
  -> Mutation
  -> 修改 ActorRuntime
  -> EventAfterHeal / EventAfterResourceChange / EventAfterAttributeChange
```

`ModifyResource` 适合处理 mana、energy、rage、ammo 等资源。HP 建议第一版仍由 `Damage` 和 `Heal` 专用通道处理，因为 HP 牵涉护盾、死亡、受击与治疗事件。

---

### 8.6 公式求值流

公式求值统一通过 `FormulaRegistry`，调用方只持有 `FormulaID` 或编译后的短索引。

```text
Action / Effect / Condition / Modifier
  -> 提供 FormulaID
  -> FormulaRegistry 查找 FormulaObject
  -> 构造 EvalContext
  -> FormulaObject.Eval(ctx)
  -> 返回 float64 / bool-like number
```

公式求值的输入来源可以包括：

- source actor 属性、资源、状态、计数器。
- target actor 属性、资源、状态、计数器。
- pair state，例如 mark 层数、source-target 锁定窗口。
- action instance，例如 action tag、action type、施法阶段。
- effect instance，例如 effect kind、damage type、base input。
- pipeline 输入，例如 `effective_resistance`、`crit_multiplier`。
- run input override 或前端传入的场景参数。

公式对象保持无状态。公式求值结果只作为当前流程输入，不直接落地为 actor 状态变更。状态变更必须继续通过 `EffectResolver -> Mutation`。

### 8.7 护盾语义

护盾同时有两层含义：

- 作为状态对象：护盾实例归属到 `StatusInstance` 或独立 `ShieldState`，记录来源、剩余值、过期时间、吸收类型、刷新策略。
- 作为结算阶段：伤害进入 `ValueShield` 阶段时，中央 damage pipeline 按固定顺序扣减护盾。

护盾吸收不应只是本地变量变化，而应生成标准 mutation：

```text
DamageMutation
  -> ShieldAbsorbMutation
  -> HpDamageMutation
  -> EventAfterDamage
```

这样可以支持护盾破裂、吸收后触发、伤害后触发、日志展示和回放校验。

---

## 9. 补充运行时基础设施

### 9.1 PairState

`PairState` 是一等运行时状态，用于保存 source-target 关系，不能完全用 target-bound status 替代。

```go
type PairState struct {
    SourceActor ActorID
    TargetActor ActorID
    Marks       MarkState
    Lockouts    PerTargetLockoutState
    Counters    CounterState
    History     HistoryState
}
```

适合放入 `PairState` 的机制：

- 只有 A 对 B 生效的 mark。
- A 对 B 的每目标冷却。
- A 对 B 的短时间增伤或减伤窗口。
- A 最近对 B 造成的伤害历史。
- B 最近从 A 承受的控制或打断窗口。

### 9.2 ActionRuntimeState 与 ExecutionInstance

`ActionRuntimeState` 是 action 的持久状态，`ExecutionInstance` 是一次执行中的时态对象，两者需要拆开。

| 实体 | 生命周期 | 承载内容 |
|------|----------|----------|
| `ActionRuntimeState` | actor 存活期间 | 冷却、充能、启用禁用、自动普攻节奏 |
| `ActionInstance` | 一次 action 请求到完成 | source、target、chain、parent、tags、临时输入 |
| `ExecutionInstance` | action 执行阶段 | cast stage、飞行体、延迟命中、引导、可打断状态 |

这样眩晕、沉默、打断、飞行体落地可以各自作用在正确对象上。眩晕可以阻止新的 `ActionInstance`，打断可以终止 `ExecutionInstance`，但二者不应该直接清空 `ActionRuntimeState` 的冷却和充能。

### 9.3 HistoryState 与 CounterState

历史窗口和计数器是机制状态，不是展示日志。

```go
type HistoryState struct {
    DamageEvents RingBuffer
    HealEvents   RingBuffer
    ActionEvents RingBuffer
    ControlEvents RingBuffer
}

type CounterState struct {
    Values map[CounterID]int32
}
```

使用场景：

- 最近 3 秒受到多少伤害。
- 连续第 N 次普攻。
- 某个状态在窗口内触发过几次。
- 最近一次命中、暴击、治疗的时间。

日志可以记录这些事件，但 pipeline 和 trigger 不应通过扫描日志来做机制判断。

### 9.4 RngRuntime 与回放契约

随机数必须中央化管理。

```go
type RngRuntime struct {
    Seed    uint64
    Streams map[RngStreamID]*RngStream
}

type RngDraw struct {
    StreamID RngStreamID
    DrawIndex uint64
    Value     float64
}
```

约束：

- action、item、status、formula 都不能持有私有 RNG。
- 暴击、命中、随机触发由 pipeline 或 trigger runner 向 `RngRuntime` 申请。
- 每次随机消费都应记录 stream、draw index、用途和结果。
- 同一 bundle、run input、seed、事件顺序必须得到相同结果。

### 9.5 子系统边界

TinyGo 第一版不需要做复杂动态插件，但仍应保留模块边界。推荐采用编译期 handler 或明确的 runner，而不是把所有逻辑堆进一个巨大函数。

| 子系统 | 推荐形态 | 状态归属 |
|--------|----------|----------|
| mitigation / penetration | value pipeline stage | actor attrs、effect tags |
| critical / hit | value pipeline stage + RNG | actor counters、RngRuntime |
| shield | status state + damage stage | StatusInstance / ShieldState |
| dot / hot | scheduler tick + effect | StatusInstance、Scheduler |
| crowd control | action gate + execution control | StatusInstance、ExecutionInstance |
| cooldown / charge | action queue subsystem | ActionRuntimeState |
| resource | effect/mutation channel | ActorRuntime.Resources |
| history / counter | runtime state service | ActorRuntime / PairState |

子系统可以读写归属范围内的状态，但跨子系统联动仍要通过 event、effect、mutation 或 command。

### 9.6 Fail-Fast 校验

校验分三层：

| 层级 | 校验内容 |
|------|----------|
| 模板层 | ID 唯一性、必填字段、公式输入声明、action/effect/status 引用 |
| 编译层 | formula 编译、trigger binding、modifier binding、tag 合法性、pipeline phase 合法性 |
| 运行时层 | handle 悬空、事件 payload 非法、状态归属错层、chain depth 超限、command 数量超限 |

一旦发现语义错误，应返回结构化错误，不进入半初始化状态。运行时错误应记录当前 event、chain、source/target、action/effect，方便复现。

### 9.7 TinyGo ABI 与 Payload 边界

内部对象化不应泄露到 Wasm ABI。前端仍输入纯数据，Wasm 内部负责编译和实例化。

推荐边界：

- `init(payload_json)`：编译 bundle、实例化公式对象、构建索引。
- `run(run_input_json)`：创建 battle runtime 并执行。
- `result_json`：输出 summary、snapshot、log 或错误。

约束：

- payload 不传对象行为。
- payload 不传脚本闭包。
- payload 不暴露内部 Go struct。
- 内部从 map/slice 优化到数组或短 ID，不影响前端协议。

---

## 10. 对象化边界

推荐采用组合式对象化，而不是继承式对象化。

| 对象 | 可以做什么 | 不应该做什么 |
|------|------------|--------------|
| `ActorRuntime` | 保存自身状态、loadout、队列管理器 | 直接调用敌方 actor 方法造成伤害 |
| `ItemDefinition` | 贡献 action、trigger、modifier | 自己执行反伤或扣血 |
| `ActionDefinition` | 描述成本、标签、effect 列表 | 内联所有伤害、暴击、减伤逻辑 |
| `FormulaObject` | 根据 `EvalContext` 返回公式结果 | 修改 runtime、消费 RNG、触发事件 |
| `TriggerRule` | 监听事件并生成 command | 直接改 actor HP 或资源 |
| `ValueModifier` | 修改当前数值上下文 | 直接排新 action |
| `EffectResolver` | 统一结算 effect 并输出 mutation | 管理全局时间顺序 |
| `BattleScheduler` | 管理时间、优先级、事件顺序 | 计算具体伤害公式 |

这套边界保证所有状态修改都经过中央通道，便于调试和回放。

---

## 11. 输出流

Wasm 对前端输出建议分三类：

| 输出 | 用途 |
|------|------|
| `LogEntry` | 事件日志，展示 action、damage、status、blocked、trigger chain |
| `ActorSnapshot` | 关键采样点，展示 HP、资源、护盾、主要属性 |
| `BattleResult` | 最终汇总，包含 stopReason、finalTimeMs、processedEvents、胜负状态 |

日志至少应携带：

- `timeMs`
- `eventPhase`
- `sourceActorId`
- `targetActorId`
- `actionId`
- `effectId`
- `sequence`
- `priority`
- `valuePhase`
- `mutationKind`
- `beforeValue`
- `afterValue`
- `sourceKind`
- `sourceId`
- `rngStream`
- `rngDrawIndex`
- `chainId`
- `parentActionId`
- `amount`
- `reason`

---

## 12. 最小落地切片

建议按以下顺序实现：

1. 定义 TinyGo 版静态实体与运行时实体。
2. 实现 `FormulaRegistry`，在 init 阶段实例化所有公式对象。
3. 实现 `BattleScheduler` 单线程事件队列。
4. 实现 actor 实例化与 `ActorLoadout` 合并。
5. 实现 `PairState`、`ActionRuntimeState`、`ExecutionInstance` 的最小结构。
6. 实现 `TriggerIndex` 与 `Command` 调度。
7. 实现 `EffectResolver` 与 `Mutation` 应用。
8. 实现 `ValuePipeline` 的 damage 最小链路。
9. 补齐 heal、resource、attribute 通道。
10. 添加 chain depth、once per event、internal cooldown 防爆规则。
11. 添加 `RngRuntime`、history/counter、fail-fast 校验。
12. 输出稳定日志与 snapshot。

---

## 13. 与现有文档关系

- 本文是 [概要设计-通用战斗引擎V2架构.md](./概要设计-通用战斗引擎V2架构.md) 在 TinyGo 路线上的事件管线补充。
- 本文延续 [概要设计-通用战斗引擎V2对象化建模适配.md](./概要设计-通用战斗引擎V2对象化建模适配.md) 的边界：运行时状态可对象化，执行拓扑仍由中央事件管线控制。
- 本文与 [概要设计-WASM内部事件流.md](./概要设计-WASM内部事件流.md) 的关系是：后者描述通用内部事件流，本文收束 TinyGo 实现中的实体和数据流。
