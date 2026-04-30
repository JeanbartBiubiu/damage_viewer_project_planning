TASK_KEY: wasm-engine-v2-architecture
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-04-25 16:20:09

# WASM 详细设计

本文是 TinyGo V2 Wasm 计算引擎的详细设计入口。它收束旧散文档中的机制细节，并补充 TypeList 网络设计。

## 1. 工程结构

正式实现位于：

```text
wasm/tinygo_engine_v2
```

目标包结构：

```text
cmd/engine_wasm
internal/abi
internal/model
internal/compile
internal/runtime
internal/scheduler
internal/formula
internal/attribute
internal/resource
internal/pipeline
internal/trigger
internal/command
internal/status
internal/shield
internal/control
internal/cadence
internal/history
internal/counter
internal/mark
internal/crit
internal/augment
internal/testkit
```

## 2. EngineBundleV2

`EngineBundleV2` 是正式输入契约，不继承旧 `BenchmarkBundle`。

建议结构：

```go
type EngineBundleV2 struct {
    SchemaVersion uint16
    TypeCatalog   TypeCatalogV2
    Attributes    []AttributeDefinitionV2
    Resources     []ResourceDefinitionV2
    Actors        []ActorTemplateV2
    Actions       []ActionTemplateV2
    Items         []ItemTemplateV2
    Statuses      []StatusTemplateV2
    Formulas      []FormulaDefinitionV2
    Triggers      []TriggerDefinitionV2
    Augments      []AugmentDefinitionV2
    Settings      BundleSettingsV2
}
```

## 3. TypeList 网络

### 3.1 需求

必须支持：

1. action A 触发所有 B type action。
2. action A 同时触发所有 C type action。
3. B/C type 内存在同一个 action 时只执行一次。
4. trigger 通过 action/item/status/effect/damage type 匹配。
5. 后续 type 继承或别名可以在编译期展开。

### 3.2 DTO 层

每类实体都可以声明 `types` 与 `tags`：

```go
type TypeListV2 []string

type ClassifierV2 struct {
    Types TypeListV2 `json:"types,omitempty"`
    Tags  TypeListV2 `json:"tags,omitempty"`
}
```

挂载位置：

```go
type ActorTemplateV2 struct {
    ID string
    Classifier ClassifierV2
}

type ActionTemplateV2 struct {
    ID string
    Classifier ClassifierV2
}

type ItemTemplateV2 struct {
    ID string
    Classifier ClassifierV2
}

type StatusTemplateV2 struct {
    ID string
    Classifier ClassifierV2
}

type EffectDefV2 struct {
    Type EffectType
    Classifier ClassifierV2
}
```

### 3.3 命名空间

type/tag 不使用全局单命名空间，而是按实体 kind 分命名空间：

1. actor type
2. action type
3. item type
4. status type
5. effect tag
6. damage tag
7. crit tag

原因：`dash` 作为 action type 和 status type 不应天然等价。

### 3.4 编译结构

```go
type TypeID uint16

type TypeRegistry struct {
    ActorTypes  SymbolTable
    ActionTypes SymbolTable
    ItemTypes   SymbolTable
    StatusTypes SymbolTable
    EffectTags  SymbolTable
    DamageTags  SymbolTable
    CritTags    SymbolTable
}

type TypeSet struct {
    Words []uint64
}

type TypeIndex struct {
    ActorsByType  [][]uint16
    ActionsByType [][]uint16
    ItemsByType   [][]uint16
    StatusByType  [][]uint16
}
```

### 3.5 TypeSet 操作

必须支持：

```go
Has(typeID)
Intersects(other)
ContainsAll(other)
ContainsNone(other)
UnionInto(dst)
```

匹配语义：

1. `Any` 非空：至少命中一个。
2. `All` 非空：必须全部命中。
3. `None` 非空：不能命中任何一个。

### 3.6 Trigger Matcher

```go
type TypeMatcherV2 struct {
    Any  []string `json:"any,omitempty"`
    All  []string `json:"all,omitempty"`
    None []string `json:"none,omitempty"`
}

type TriggerMatchV2 struct {
    SourceActorTypes TypeMatcherV2
    TargetActorTypes TypeMatcherV2
    ActionTypes      TypeMatcherV2
    ItemTypes        TypeMatcherV2
    StatusTypes      TypeMatcherV2
    EffectTags       TypeMatcherV2
    DamageTags       TypeMatcherV2
}
```

编译后：

```go
type CompiledTypeMatcher struct {
    Any  TypeSet
    All  TypeSet
    None TypeSet
}
```

### 3.7 反向索引与去重

多个 type 选择 action 时不能重复执行：

```go
type SelectionScratch struct {
    Seen []uint32
    Gen  uint32
    Out  []uint16
}
```

流程：

```text
Gen++
遍历 type B 的 ActionsByType
  未见过则加入 Out
遍历 type C 的 ActionsByType
  已见过则跳过
返回去重后的 action short IDs
```

### 3.8 TypeGraph 继承

P0 不实现运行时递归继承。若需要：

```text
basic_attack -> attack -> action
```

则在 compile 阶段展开到实体 TypeSet。runtime 只看最终 bitset。

## 4. Attribute Runtime

属性槽：

```go
type AttributeSlot struct {
    Base     float64
    Current  float64
    Max      float64
    Resolved float64
    Dirty    bool
}
```

读取视图：

1. `base`
2. `current`
3. `max`
4. `resolved`
5. `missing`
6. `current_ratio`
7. `missing_ratio`
8. `bonus`

`bonus` 必须声明基准：

```go
type BonusBaseline string

const (
    BonusFromBase        BonusBaseline = "base"
    BonusFromBaseMax     BonusBaseline = "base_max"
    BonusFromInitialMax  BonusBaseline = "initial_max"
    BonusFromChampionBase BonusBaseline = "champion_base"
)
```

modifier 聚合至少支持：

1. flat
2. percent
3. override
4. clamp
5. temporary max

temporary max 不自动治疗；max 降低时 clamp current。

## 5. Formula Runtime

公式 DTO 编译为 bytecode。P0 opcode：

1. const
2. input
3. attr read
4. resource read
5. counter read
6. history sum
7. history snapshot
8. add/sub/mul/div
9. min/max
10. sign

公式不直接调用 RNG。随机相关由 crit、trigger runner 或 pipeline 在外层分配随机输入。

## 6. Scheduler

事件排序键：

```text
(timeMs, priority, seq)
```

要求：

1. 同时刻事件按 priority 稳定排序。
2. 同 priority 事件按 seq 稳定排序。
3. 实例事件保存 generation handle。
4. 旧事件出队时 lazy drop。
5. cancel 只在 step boundary 生效。

## 7. Trigger / Command

trigger 不直接改 runtime state，只产 command：

```go
type Command struct {
    Kind   CommandKind
    Source ActorID
    Target ActorID
    Payload CommandPayload
}
```

命令类型：

1. queue action
2. apply effect
3. apply status
4. remove status
5. grant shield
6. modify resource
7. modify attribute
8. interrupt execution
9. add mark
10. consume mark

限制：

1. `maxCommandsPerEvent`
2. `maxChainDepth`
3. once-per-event
4. internal cooldown

## 8. ValuePipeline

### 8.1 Damage

输出字段：

1. attempted
2. raw
3. postCrit
4. postOutgoing
5. postIncoming
6. postMitigation
7. shieldAbsorbed
8. hpLoss
9. actualDamageDealt
10. deathCandidate

### 8.2 Heal

输出字段：

1. attempted
2. applied
3. overheal

### 8.3 Shield

输出字段：

1. shieldID
2. before
3. after
4. absorbed
5. expired

### 8.4 Resource

输出字段：

1. resourceID
2. before
3. delta
4. after
5. blockedReason

### 8.5 Attribute

输出字段：

1. attrID
2. before
3. modifier
4. after
5. dirtyRefresh

## 9. 状态、控制、执行实例

必须分离：

1. `StatusInstance`
2. `ControlDirectiveInstance`
3. `ExecutionInstance`
4. `PendingIntent`

action gate 读取控制状态；scheduler 不因控制暂停。

interrupt 取消 execution 后续事件，靠 generation handle lazy drop。

## 10. Cadence

ActionRuntimeState：

```go
type ActionRuntimeState struct {
    ReadyAtMs int64
    MaxCharges uint8
    CurrentCharges uint8
    RechargeEndTimes []int64
    AutoRepeat bool
}
```

支持：

1. cooldown blocks repeat cast
2. consume charge
3. recharge timer
4. reduce/reset/refund cooldown
5. grant charge
6. auto-repeat blocked/requeue

## 11. History / Counter / Mark

HistoryWindow 使用固定 ring：

1. `AtOrBefore`
2. `Sum`
3. `Range`

CounterState scope：

1. actor
2. pair
3. global

MarkState：

1. source-target directed key
2. expireAt
3. consume
4. remove
5. lockout

## 12. Crit

暴击结果在 execution 级产生：

```go
type CritResult struct {
    DidCrit bool
    Scalar float64
    PolicyID uint16
}
```

P0 策略：

1. deterministic
2. expected

P1 策略：

1. seeded random
2. counter cadence crit

target reactive damage 不继承 source crit。

## 13. Augment

Augment 编译成 active policies：

1. `activeDerivedRules`
2. `activeDamagePolicies`
3. `activeCritPolicies`
4. `activeAttributePolicies`

首批支持：

1. fixed attack speed
2. overflow attack speed to AD
3. spell can crit
4. DoT can crit

## 14. 测试计划

### 14.1 单元测试

1. frame
2. outbox
3. heap order
4. stale handle
5. formula bytecode
6. attribute aggregation
7. resource clamp
8. type set matcher
9. type inverted index dedupe
10. history ring
11. counter threshold
12. mark consume

### 14.2 子系统测试

1. damage pipeline
2. shield refresh
3. control gate
4. cadence recharge
5. trigger fanout
6. crit scalar reuse

### 14.3 集成测试

1. Thornmail
2. Sett W
3. Akali E
4. Arena CC threshold
5. Counter Proc
6. AttackSpeed Buff
7. Benchmark Battle

### 14.4 宿主测试

1. browser instantiate
2. Worker init/run/cancel/outbox
3. same input/seed replay
4. wasm size report
5. allocation audit

## 15. 开发顺序

1. 契约与 ABI 底座。
2. TypeList / TypeRegistry / TypeSet / InvertedIndex。
3. runtime 与 scheduler。
4. attribute/resource/formula。
5. trigger/command/pipeline。
6. damage 主链。
7. shield/heal/lifesteal。
8. status/control/interrupt。
9. cadence。
10. history/counter/mark。
11. crit。
12. action 端到端样例。
13. augment。
14. browser Worker 与性能门禁。
