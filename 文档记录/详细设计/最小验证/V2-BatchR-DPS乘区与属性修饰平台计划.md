TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-06-09

# V2 Batch R DPS 乘区与属性修饰平台计划

关联概要：[验证里程碑V2.md](../../概要设计/验证里程碑V2.md)

前置计划：[V2-BatchQ-2-DPS联动结构化编辑器计划.md](./V2-BatchQ-2-DPS联动结构化编辑器计划.md)

前置机制：[V2-BatchO-单攻击方DPS事件化联动机制计划.md](./V2-BatchO-单攻击方DPS事件化联动机制计划.md)

真实装备闭环前置：[V2-BatchP-单攻击方DPS真实装备联动闭环计划.md](./V2-BatchP-单攻击方DPS真实装备联动闭环计划.md)

## 1. 文档边界

本文是 Batch R 的详细设计，目标是把单攻击方 DPS 里的属性修饰、伤害增减和减伤逻辑收口到统一的乘区解析平台。本文不是测试记录，不直接落代码，也不替代 Batch Q-2 的编辑器计划。

Batch R 只处理“数值修饰属于哪个乘区、如何聚合、在什么阶段生效、需要什么条件”这条主线。它要覆盖以下三类能力：

1. `coefficientBuckets` 契约进入 TinyGo V2。
2. 属性修饰进入 `attribute` 域乘区。
3. HP 变更修饰进入 `hp_change` 域乘区。

本文写给 GPT/Codex 和 Cursor 执行。真正开发仍必须先由 GPT/Codex 收敛范围、生成 Cursor prompt，再由 Cursor 用 `composer-2.5` 且 `fast=false` 执行受限编码。GPT/Codex 负责 diff review、构建、Wasm smoke、Web 页面 Playwright 验收和最终结论。

## 2. 当前事实

以下事实来自 2026-06-09 当前 worktree 定点核对：

1. `C:\project\damage_wasm_dev` 当前分支为 `wasm/dev`。
2. `C:\project\damage_web_dev\web\src\types\api.ts` 已有 `CoefficientBucket`：`bucketKey`、`resolutionDomain`、`stageKey`、`targetAttrKey`、`aggregationMode`、`editorHint`、`bucketConfig`。
3. `C:\project\damage_backend_dev\server\data_manage\src\main\java\xyz\game\datamanage\service\PostgresWriteStore.java` 已校验 `resolutionDomain=attribute|hp_change`，以及 `aggregationMode=add|multiply|pick_max|set_final`。
4. 后端 `coefficient_buckets` 表当前通过 `bucket_config` 保留扩展配置；没有独立 `priority` 列。Batch R 如需 bucket 级优先级，第一选择应是 `bucketConfig.priority`，不是先改 DB schema。
5. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go` 的 `EngineBundleV2` 目前没有 `CoefficientBuckets` 字段。
6. `DPSPassiveOperationV2` 目前只有旧字段：`Value`、HP ratio、`ModifierMode`、`ValuePhase`、`CritOnly` 等；没有 `bucketKey`、`valueSpec`、`conditions`、`priority`。
7. 当前 DPS `damage_modifier` 在 `dps_passive_dispatcher.go` 中只支持 `valuePhase=incoming`、`modifierMode=percent`、`targetRole=target`，并按顺序直接做 `current * (1 + value)`。
8. 当前普攻 pre-damage context 设置 `HasCritContext=false`，所以 `critOnly=true` 的 modifier 会被 block。
9. 现有测试 `TestSingleAttackerDPSIncomingDamageModifierAppliesBeforeTimeline` 已锁住 `100 -> 80` 的 incoming percent modifier 行为，可作为 Batch R 兼容回归基线。

## 3. 问题定义

当前 `damage_modifier` 和 `stat_modifier` 是局部操作，不是乘区平台。继续沿这个方向补装备会出现三个问题：

1. 同乘区相加和跨乘区相乘无法稳定表达。例如 `-20%` 与 `-10%` 同桶应得到 `70`，跨桶则可能是 `100 -> 90 -> 45`。
2. 属性修饰和伤害修饰会各写一套聚合逻辑。帽子、狂徒、歌利亚、巨人杀手、砍倒、布甲鞋、卡萨丁被动、小兰顿、小鱼人被动会散落在不同分支。
3. 后续验证会被迫靠装备 ID 特例。用户录入一个新天赋、装备或海克斯时，应该只选择 bucket、valueSpec 和 condition，不应让 Wasm 再新增 `if itemId == ...`。

Batch R 的问题不是“再支持一个装备效果”，而是建立一个足够稳定的数值修饰平台。

## 4. 目标

1. TinyGo V2 bundle 接收并编译 `coefficientBuckets`。
2. 新增 `CoefficientBucketResolver`，统一处理 bucket 查找、候选收集、条件判断、动态值解析、聚合、阶段排序和 evidence 输出。
3. 新增 `AttributeModifierAdapter`，把属性类修饰接入同一 resolver，覆盖帽子 AP、歌利亚生命值/适应之力、狂徒生命值/回复类属性修饰。
4. 新增 `HPChangeModifierAdapter`，把伤害增幅、伤害减免、固定减伤、按血量差/已损生命值条件生效的修饰接入同一 resolver。
5. 保持旧 `stat_modifier` / `damage_modifier` 配置可运行；旧数据没有 `bucketKey` 时走兼容映射，不破坏 Batch N/O/P/Q 已验证路径。
6. 为 Web 结构化编辑器预留可编辑字段：`bucketKey`、`valueSpec`、`conditions`、`priority`、`evidenceKey`。
7. 让验证可以覆盖数据源类型：`item`、`rune`、`augment`、`status`、`skill_passive`，但 runtime 不因来源类型写不同分支。

## 5. 非目标

1. 不实现物理转魔法、魔法转物理、伤害类型重写、伤害复制或伤害拆分。
2. 不实现复杂海克斯规则改写机制，例如把整个技能机制替换成另一套逻辑。
3. 不实现多技能 rotation、连招队列、谁 CD 好就放谁的主动技能调度。
4. 不补真实暴击上下文。Batch R 可以保持当前 `critPolicy=expected`，但要把 `critOnly` 的后续接入点留清楚。
5. 不扩展射程、距离、移动相关规则。射程增伤可先由初始 BUFF 或数据侧 modifier 表达。
6. 不补齐所有装备、天赋、海克斯数据。Batch R 做平台和代表性样例，数据补录应独立成后续批次。
7. 不新增后端 DB schema，除非当前 `bucket_config` 无法保真必要配置；若要改 DB，必须单独停下来确认。

## 6. 设计原则与模式边界

Batch R 使用设计模式只命名真实变化点，不做装饰性抽象。

| 角色 | 采用模式 | 责任 |
| --- | --- | --- |
| `CoefficientBucketResolver` | Strategy + Pipeline | 按 domain/stage/bucket 选择聚合策略，执行条件和值解析，输出结果和 evidence。 |
| `AttributeModifierAdapter` | Adapter | 把 DPS passive/status/augment 中的属性修饰转换为 resolver candidate，不拥有聚合规则。 |
| `HPChangeModifierAdapter` | Adapter | 把 incoming/outgoing/final damage modifier、flat reduction、HP 条件修饰转换为 resolver candidate，不直接写乘法链。 |
| `DPSModifierValueSpecV2` | Strategy input | 描述 literal、属性读取、HP 读取、公式引用等动态值来源。 |
| `DPSModifierConditionV2` | Chain gate | 描述 HP、属性、伤害上下文、来源上下文等条件，条件不通过则不产出 candidate。 |
| Evidence builder | Memento | 记录每个 bucket 的 raw、candidates、aggregation、result，供页面和测试追踪。 |

核心原则：

1. Resolver 拥有 `bucketKey`、`resolutionDomain`、`stageKey`、`aggregationMode`、`priority`、condition、valueSpec 和 evidence。
2. Adapter 只负责翻译来源，不决定同桶相加还是跨桶相乘。
3. Runtime 只认识 domain/stage/bucket，不认识具体装备名、天赋名或海克斯名。
4. `attribute` 与 `hp_change` 共享 resolver，但各自 adapter 决定聚合结果如何应用到属性或 HP 变更。
5. TinyGo 热路径使用编译后的短 ID、slice 和枚举；JSON 字符串解释只允许停留在 compile / setup 阶段。

## 7. 数据契约

### 7.1 CoefficientBucketV2

TinyGo V2 需要补齐与 Web/Backend 对齐的 DTO：

```go
type CoefficientBucketV2 struct {
    BucketKey        string                    `json:"bucketKey"`
    ResolutionDomain string                    `json:"resolutionDomain"` // attribute | hp_change
    StageKey         string                    `json:"stageKey"`
    TargetAttrKey    string                    `json:"targetAttrKey,omitempty"`
    AggregationMode  string                    `json:"aggregationMode"` // add | multiply | pick_max | set_final
    Provisional      bool                      `json:"provisional,omitempty"`
    Name             string                    `json:"name,omitempty"`
    Description      string                    `json:"description,omitempty"`
    EditorHint       CoefficientBucketHintV2   `json:"editorHint,omitempty"`
    BucketConfig     CoefficientBucketConfigV2 `json:"bucketConfig,omitempty"`
}
```

`bucketConfig` 第一版需要稳定以下字段：

```go
type CoefficientBucketConfigV2 struct {
    Priority        int     `json:"priority,omitempty"`
    ValueUnit       string  `json:"valueUnit,omitempty"` // percent_delta | factor | flat_delta | final_value
    ClampMin        float64 `json:"clampMin,omitempty"`
    HasClampMin     bool    `json:"hasClampMin,omitempty"`
    ClampMax        float64 `json:"clampMax,omitempty"`
    HasClampMax     bool    `json:"hasClampMax,omitempty"`
    EvidenceLabel   string  `json:"evidenceLabel,omitempty"`
    LegacyBucketKey string  `json:"legacyBucketKey,omitempty"`
}
```

解释规则：

1. `resolutionDomain=attribute` 时必须有 `targetAttrKey`。
2. `resolutionDomain=hp_change` 时不得有 `targetAttrKey`。
3. `stageKey` 是执行阶段，不是 UI 分组。Wasm 必须按 stage 顺序执行。
4. `aggregationMode=add` 且 `valueUnit=percent_delta` 时，候选值先求和，再应用为 `amount * (1 + sum)`。
5. `aggregationMode=multiply` 且 `valueUnit=factor` 时，候选值按因子连乘。
6. `aggregationMode=pick_max` 用于同类效果取最大值，不能和 `set_final` 混用。
7. `aggregationMode=set_final` 只允许明确标注 `valueUnit=final_value`，并应带 warning；它是保底能力，不是常规增减伤路径。

### 7.2 DPSModifierValueSpecV2

旧字段 `Value`、`TargetMaxHPRatio`、`AttackerAttrRatio` 可以继续兼容，但新能力应走 `valueSpec`：

```go
type DPSModifierValueSpecV2 struct {
    Kind             string            `json:"kind"` // literal | attr_ratio | hp_ratio | hp_diff_ratio | formula
    Value            float64           `json:"value,omitempty"`
    OwnerRole        string            `json:"ownerRole,omitempty"` // attacker | target
    CompareRole      string            `json:"compareRole,omitempty"`
    AttrKey          string            `json:"attrKey,omitempty"`
    AttrRead         AttributeReadKind `json:"attrRead,omitempty"`
    HPMeter          string            `json:"hpMeter,omitempty"` // current | max | missing | current_pct | missing_pct
    Ratio            float64           `json:"ratio,omitempty"`
    FormulaID        string            `json:"formulaId,omitempty"`
    ClampMin         float64           `json:"clampMin,omitempty"`
    HasClampMin      bool              `json:"hasClampMin,omitempty"`
    ClampMax         float64           `json:"clampMax,omitempty"`
    HasClampMax      bool              `json:"hasClampMax,omitempty"`
}
```

覆盖关系：

1. 固定增减伤：`kind=literal`。
2. 帽子 AP：`kind=literal` 或 `kind=formula`，bucket 指向 AP final multiplier。
3. 歌利亚生命值加成：`kind=literal`，bucket 指向生命值属性乘区，`sourceType=augment`。
4. 歌利亚适应之力：`kind=literal` 或 `kind=formula`，bucket 指向 AD/AP/Adaptive Force 属性乘区。
5. 狂徒生命值/回复属性：`kind=literal` 或 `kind=attr_ratio`，bucket 指向生命值/生命回复属性乘区。
6. 砍倒/巨人杀手：`kind=hp_diff_ratio` 或 `kind=formula`，condition 读取 attacker/target 最大生命值差。
7. 自身已损生命值天赋：`kind=hp_ratio`，`ownerRole=attacker`，`hpMeter=missing_pct`。

如果 `valueSpec` 无法自然表达某个数值曲线，但它仍然是“计算一个修饰值”，优先使用 `kind=formula`。不要为单个装备新增 Go 分支。

### 7.3 DPSModifierConditionV2

condition 是 candidate 的门，不是新的触发系统。触发时机仍由 `trigger.event` 和 `trigger.matcher` 决定，condition 只决定当前候选是否参与 bucket。

```go
type DPSModifierConditionV2 struct {
    SubjectRole string  `json:"subjectRole,omitempty"` // attacker | target
    CompareRole string  `json:"compareRole,omitempty"`
    Metric      string  `json:"metric"` // max_hp | current_hp_pct | missing_hp_pct | attr | damage_type | action_type | crit
    AttrKey     string  `json:"attrKey,omitempty"`
    Operator    string  `json:"operator"` // eq | neq | gt | gte | lt | lte | between | in
    Value       float64 `json:"value,omitempty"`
    MaxValue    float64 `json:"maxValue,omitempty"`
    TextValue   string  `json:"textValue,omitempty"`
    TextValues  []string `json:"textValues,omitempty"`
}
```

第一版必须支持：

1. target max HP 大于 attacker max HP。
2. target max HP 达到阈值。
3. attacker missing HP percent 达到阈值。
4. damageType 为 physical/magic/true。
5. actionType 或 procScope 为 basic attack / on-hit。
6. crit context 存在且为 crit。当前没有真实 crit context 时，`crit` 条件应输出 blocked/warning evidence，而不是静默生效。

### 7.4 DPSPassiveOperationV2 增量字段

在当前 `DPSPassiveOperationV2` 上新增字段，保留旧字段兼容：

```go
BucketKey   string                   `json:"bucketKey,omitempty"`
ValueSpec   DPSModifierValueSpecV2   `json:"valueSpec,omitempty"`
Conditions  []DPSModifierConditionV2 `json:"conditions,omitempty"`
Priority    int                      `json:"priority,omitempty"`
EvidenceKey string                   `json:"evidenceKey,omitempty"`
```

推荐语义：

1. `kind=stat_modifier` 且有 `bucketKey`：由 `AttributeModifierAdapter` 接管。
2. `kind=damage_modifier` 且有 `bucketKey`：由 `HPChangeModifierAdapter` 接管。
3. `kind=coefficient_modifier`：由 `bucketKey` 的 `resolutionDomain` 决定 adapter，适合未来 Web 统一编辑。
4. 无 `bucketKey` 的旧 operation 继续走 legacy adapter，映射到兼容 bucket，保证旧数据不退化。
5. `priority` 是 candidate 级 tie-break；bucket 级默认优先级放在 `bucketConfig.priority`。

## 8. 核心模块边界

### 8.1 TinyGo 写入范围

默认写入：

1. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go`
2. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\compile\compile.go`
3. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_coefficient_bucket.go`
4. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_modifier_value.go`
5. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_modifier_condition.go`
6. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_attribute_modifier_adapter.go`
7. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_hp_change_modifier_adapter.go`
8. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go`

允许为拆分调整现有文件：

1. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_passive_dispatcher.go`
2. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_basic_attack.go`
3. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_state.go`

只读参考：

1. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\attribute\`
2. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\formula\`
3. `C:\project\damage_web_dev\web\src\types\api.ts`
4. `C:\project\damage_backend_dev\server\data_manage\src\main\java\xyz\game\datamanage\service\PostgresWriteStore.java`

### 8.2 Resolver API 草案

```go
type CoefficientBucketResolver struct {
    buckets []compiledCoefficientBucket
}

type CoefficientCandidate struct {
    BucketID   int
    Source     string
    SourceType string
    SourceID   string
    Value      float64
    Priority   int
    EvidenceKey string
}

type CoefficientResolveContext struct {
    TimeMs       int64
    Domain       string
    StageKey     string
    DamageType   string
    ActionType   string
    ProcScope    string
    HasCritContext bool
    IsCrit       bool
    Attacker     dpsActorValueReader
    Target       dpsActorValueReader
}

func (r *CoefficientBucketResolver) Resolve(
    ctx CoefficientResolveContext,
    candidates []CoefficientCandidate,
) CoefficientResolveResult
```

`Resolve` 的职责：

1. 按 `Domain + StageKey + BucketKey` 过滤 bucket。
2. 评估 conditions，不通过则记录 skipped evidence。
3. 解析 valueSpec，得到 candidate value。
4. 按 bucket 内 `priority` 和 candidate `priority` 排序。
5. 执行 `add`、`multiply`、`pick_max`、`set_final`。
6. 应用 clamp。
7. 输出 `CoefficientResolveResult`，由 adapter 应用到属性或 HP 变更。

### 8.3 AttributeModifierAdapter

输入来源：

1. `stat_modifier` passive operation。
2. 未来 status attribute modifier。
3. 未来 augment attribute modifier。
4. 未来装备基础属性之外的属性被动。

输出目标：

1. 攻击方属性：AD、AP、AS、生命值、生命回复、适应之力。
2. 目标属性：护甲、魔抗、伤害减免属性等。

规则：

1. Attribute adapter 不直接决定乘区相加/相乘。
2. 同一个 attrKey 可以有多个 stage，例如 `attribute/base_bonus`、`attribute/flat_bonus`、`attribute/final_multiplier`。
3. 属性 resolved 后必须能被后续公式、HP change valueSpec 和 DPS timeline 读取。
4. Warmog 的“周期治疗”不是 attribute modifier；但 Warmog 的生命值、生命回复、治疗增幅等属性修饰必须能由本 adapter 表达。

### 8.4 HPChangeModifierAdapter

输入来源：

1. `damage_modifier` passive operation。
2. 未来 status incoming/outgoing modifier。
3. 未来 rune/augment 条件型增减伤。
4. 未来 flat damage reduction。

输出目标：

1. 原始伤害 pre-mitigation 增减。
2. 护甲/魔抗计算后的 final damage 增减。
3. 固定减伤或固定增伤。
4. clamp 到 `>= 0`。

规则：

1. HP change adapter 统一处理增伤和减伤，正值是增伤，负值是减伤。
2. 同 stage 同 bucket 先聚合，再进入下一 bucket 或下一 stage。
3. 物理/魔法/真实伤害只作为 condition/matcher，不做伤害类型转换。
4. 布甲鞋、卡萨丁被动、小兰顿、小鱼人被动都应是数据驱动 candidate，不允许装备 ID 分支。

### 8.5 Evidence 输出

新增 evidence 需要能被测试和页面断言：

```json
{
  "kind": "coefficient_bucket",
  "domain": "hp_change",
  "stageKey": "hp_change/incoming/pre_mitigation",
  "bucketKey": "lol.basic_attack.reduction",
  "aggregationMode": "add",
  "valueUnit": "percent_delta",
  "raw": 100,
  "candidates": [
    { "source": "plated_steelcaps", "value": -0.12, "applied": true }
  ],
  "result": 88
}
```

不要只输出最终总伤害。Batch R 的验收依赖每个 bucket 的输入、跳过原因、聚合模式和结果。

## 9. 运行时阶段

第一版稳定以下 stageKey，后续可新增但不能改语义：

| Domain | StageKey | 用途 |
| --- | --- | --- |
| `attribute` | `attribute/base_bonus` | 基础属性外的固定加成。 |
| `attribute` | `attribute/flat_bonus` | 状态、装备、海克斯给的 flat 属性。 |
| `attribute` | `attribute/final_multiplier` | 帽子、歌利亚、百分比生命值、百分比回复等最终属性乘区。 |
| `hp_change` | `hp_change/outgoing/pre_mitigation` | 攻击方造成伤害提高/降低，防御公式前。 |
| `hp_change` | `hp_change/incoming/pre_mitigation` | 承伤方受到伤害提高/降低，防御公式前。 |
| `hp_change` | `hp_change/final/post_mitigation` | 防御公式后最终伤害百分比修饰。 |
| `hp_change` | `hp_change/flat/post_percent` | 百分比修饰后固定增减，最后 clamp 到 0。 |

执行顺序：

1. Attribute stages 先在 DPS curve 初始化和状态变化后 resolve。
2. Basic attack raw damage 读取 resolved attribute。
3. `hp_change/outgoing/pre_mitigation`。
4. `hp_change/incoming/pre_mitigation`。
5. 护甲/魔抗/真实伤害防御公式。
6. `hp_change/final/post_mitigation`。
7. `hp_change/flat/post_percent`。
8. 写入 timeline、breakdown、trigger evidence。

如果实现时发现当前 DPS damage flow 没有明确 raw/final 分界，必须先小范围拆出 `dps_damage.go` 或等价 helper，再接 resolver；不要把新 stage 塞进 `dps_basic_attack.go` 的局部变量链里。

## 10. 机制覆盖矩阵

| 机制 | Domain | Stage / Bucket | valueSpec / condition | 备注 |
| --- | --- | --- | --- | --- |
| 砍倒 | `hp_change` | outgoing or final percent bucket | target max HP 大于 attacker max HP，按差值公式给正值 | 天赋来源 `sourceType=rune`。 |
| 巨人杀手 | `hp_change` | outgoing or final percent bucket | target max HP 阈值或差值公式 | 装备来源 `sourceType=item`。 |
| 自身已损生命值增伤 | `hp_change` | outgoing or final percent bucket | attacker missing HP percent | 也可表达减伤，符号由 value 决定。 |
| 布甲鞋 | `hp_change` | incoming / basic attack reduction | actionType/basic attack + physical/on-hit matcher | 负值 percent_delta。 |
| 卡萨丁被动 | `hp_change` | incoming magic reduction | damageType=magic | 负值 percent_delta。 |
| 小兰顿 | `hp_change` | final or incoming reduction | crit condition，当前无 crit context 时 warning/block | 后续接真实 crit。 |
| 小鱼人被动 | `hp_change` | flat post_percent | flat_delta + clampMin=0 | 固定减伤。 |
| 灭世者的死亡之帽 | `attribute` | AP final multiplier | literal or formula | `targetAttrKey=ability_power`。 |
| 歌利亚巨人 | `attribute` | HP / adaptive force final multiplier or flat bonus | sourceType=augment | 海克斯来源不改变 adapter。 |
| 狂徒 | `attribute` | HP / regen final multiplier or flat bonus | literal / attr_ratio | 周期治疗本身不是本批目标。 |

## 11. Gate 拆分

### 11.1 R-contract-pass

本文档落地并进入治理映射。验收：

```powershell
node tools/task-governance/cli.mjs rebuild
node tools/task-governance/cli.mjs docs planning-validation-milestones
git diff --check -- "文档记录/详细设计/最小验证/V2-BatchR-DPS乘区与属性修饰平台计划.md" db/task_doc_governance/task_rules.json
```

### 11.2 R-wasm-bucket-contract-pass

目标：

1. TinyGo `EngineBundleV2` 增加 `CoefficientBuckets []CoefficientBucketV2`。
2. compile 层校验 domain、stage、targetAttrKey、aggregationMode、bucketConfig。
3. 编译出短 ID bucket registry。
4. 旧 bundle 没有 `coefficientBuckets` 时仍可运行。

验证：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./...
go run ./cmd/bench
```

### 11.3 R-wasm-hp-change-pass

目标：

1. 新增 `CoefficientBucketResolver` 和 `HPChangeModifierAdapter`。
2. 现有 `applyIncomingDamageModifiers` 改为调用 resolver。
3. 兼容旧 `damage_modifier` 行为。
4. 新增同桶相加、跨桶相乘、flat clamp、pre/post mitigation 测试。

验证：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./...
go run ./cmd/bench
```

### 11.4 R-wasm-attribute-pass

目标：

1. 新增 `AttributeModifierAdapter`。
2. 将有 `bucketKey` 的 `stat_modifier` 接入 resolver。
3. 代表性测试覆盖 AP final multiplier、HP/adaptive force augment、regen/HP 属性 bucket。
4. 确认 resolved attribute 被公式和 DPS damage 读取。

验证：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./...
go run ./cmd/bench
```

### 11.5 R-web-adapter-pass

目标：

1. Web 类型与结构化编辑器暴露 `bucketKey`、`valueSpec`、`conditions`、`priority`。
2. Skill DPS linked-effect 编辑器支持选择 `coefficientBuckets`。
3. 不改变 item `skillRefs` 的职责：item 只引用 skill，不直接编辑机制。

验证：

```powershell
cd C:\project\damage_web_dev\web
npm run build
```

### 11.6 R-live-pass

目标：

1. 构建新 Wasm。
2. 发布或复用包含 Batch R 样例的 current bundle。
3. Web 端使用新 Wasm，在 DPS 页面用 Playwright 确认页面结果与 bucket evidence。

验证：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
node .\scripts\smoke-node.mjs
```

Web/Backend 验证按实际改动补充 `npm run build`、`mvn test` 和浏览器 Playwright。

## 12. Cursor Prompt A: Wasm bucket contract

```text
目标：在 TinyGo V2 接入 coefficientBuckets DTO 与编译期校验，不改变 DPS 数值行为。

执行模型：Cursor composer-2.5，fast=false。

允许写入：
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\compile\compile.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\compile\*.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\*.go（仅当需要新增只读 registry 类型）
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\*_test.go

只读参考：
- C:\project\damage_web_dev\web\src\types\api.ts
- C:\project\damage_backend_dev\server\data_manage\src\main\java\xyz\game\datamanage\service\PostgresWriteStore.java
- C:\project\damage_wasm_dev\文档记录\详细设计\最小验证\V2-BatchR-DPS乘区与属性修饰平台计划.md

实现要求：
1. EngineBundleV2 增加 coefficientBuckets。
2. 新增 CoefficientBucketV2 / CoefficientBucketConfigV2 DTO。
3. compile 层校验 resolutionDomain=attribute|hp_change。
4. compile 层校验 aggregationMode=add|multiply|pick_max|set_final。
5. attribute bucket 必须引用存在的 targetAttrKey；hp_change bucket 不允许 targetAttrKey。
6. 编译产物使用短 ID / slice，不在热路径按 string map 查 bucket。
7. 不修改现有 damage_modifier / stat_modifier 行为。

验证：
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./...
go run ./cmd/bench

停止条件：
- 如果需要修改后端 DB schema，停止并报告。
- 如果必须改 Web 类型才能让 Wasm 测试通过，停止并报告。
- 如果旧 fixture 因缺少 coefficientBuckets 无法运行，停止并先实现向后兼容。
```

## 13. Cursor Prompt B: Wasm hp_change resolver

```text
目标：新增 CoefficientBucketResolver 和 HPChangeModifierAdapter，把 DPS damage_modifier 接入 hp_change bucket，同时兼容旧 damage_modifier。

执行模型：Cursor composer-2.5，fast=false。

允许写入：
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_coefficient_bucket.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_modifier_value.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_modifier_condition.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_hp_change_modifier_adapter.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_passive_dispatcher.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_basic_attack.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go

只读参考：
- C:\project\damage_wasm_dev\文档记录\详细设计\最小验证\V2-BatchR-DPS乘区与属性修饰平台计划.md

实现要求：
1. DPSPassiveOperationV2 增加 bucketKey、valueSpec、conditions、priority、evidenceKey。
2. Resolver 支持 add/multiply/pick_max/set_final。
3. Resolver 支持 valueUnit=percent_delta/factor/flat_delta/final_value。
4. HPChangeModifierAdapter 支持 hp_change/outgoing/pre_mitigation、hp_change/incoming/pre_mitigation、hp_change/final/post_mitigation、hp_change/flat/post_percent。
5. 无 bucketKey 的旧 damage_modifier 继续得到当前结果，现有 incoming 100 -> 80 测试不能退化。
6. 新增同桶相加、跨桶相乘、flat clamp、pre/post mitigation 数值锁。
7. 输出 bucket evidence，至少包含 domain、stageKey、bucketKey、aggregationMode、raw、candidates、result。

验证：
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./...
go run ./cmd/bench

停止条件：
- 如果需要实现物理/魔法转换或伤害复制才能通过测试，停止并报告，这不属于 Batch R。
- 如果 stage 顺序无法从现有 DPS damage flow 中安全插入，停止并报告需要先拆 dps_damage 边界。
- 如果 critOnly 需要真实 crit context，先保留 blocked/warning，不要临时伪造 crit。
```

## 14. Cursor Prompt C: Wasm attribute resolver

```text
目标：把有 bucketKey 的 DPS stat_modifier 接入 attribute bucket，覆盖 AP final multiplier、HP/adaptive force augment 和 HP/regen 属性修饰。

执行模型：Cursor composer-2.5，fast=false。

允许写入：
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_attribute_modifier_adapter.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_coefficient_bucket.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_modifier_value.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_modifier_condition.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_passive_dispatcher.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go

只读参考：
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\attribute\
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\formula\
- C:\project\damage_wasm_dev\文档记录\详细设计\最小验证\V2-BatchR-DPS乘区与属性修饰平台计划.md

实现要求：
1. 有 bucketKey 的 stat_modifier 由 AttributeModifierAdapter 转为 coefficient candidate。
2. attribute bucket 的 targetAttrKey 必须决定写入/resolve 的属性。
3. 支持 attribute/base_bonus、attribute/flat_bonus、attribute/final_multiplier。
4. Rabadon/AP bucket 测试必须证明 resolved AP 被后续 damage formula 读取。
5. Goliath/sourceType=augment 测试必须证明来源类型不影响 resolver，只影响 evidence。
6. Warmog 类 HP/regen 属性 bucket 需要能 resolve；周期治疗不在本 prompt 内实现。
7. 无 bucketKey 的旧 stat_modifier 保持当前行为。

验证：
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./...
go run ./cmd/bench

停止条件：
- 如果需要重写 attribute.Store 才能完成，停止并报告。
- 如果实现会改变旧 Guinsoo / stack stat_modifier 数值，停止并报告。
- 如果 adaptive force 的属性落点需要产品定义，先用 test fixture 中明确 attrKey，不自行猜测全局规则。
```

## 15. Cursor Prompt D: Web 编辑与选择器

```text
目标：让 Web 结构化编辑器能维护 DPS modifier 的 bucketKey、valueSpec、conditions 和 priority，并能选择已有 coefficientBuckets。

执行模型：Cursor composer-2.5，fast=false。

允许写入：
- C:\project\damage_web_dev\web\src\components\skill-editor\skillModels.ts
- C:\project\damage_web_dev\web\src\components\skill-editor\SkillMechanicsConfigEditor.tsx
- C:\project\damage_web_dev\web\src\pages\admin\resources\skills\modal.tsx
- 必要时最小修改 C:\project\damage_web_dev\web\src\types\api.ts
- 必要时最小修改 C:\project\damage_web_dev\web\src\services\apiClient.ts

只读参考：
- C:\project\damage_web_dev\web\src\pages\admin\resources\coefficient-buckets\
- C:\project\damage_wasm_dev\文档记录\详细设计\最小验证\V2-BatchR-DPS乘区与属性修饰平台计划.md

实现要求：
1. SkillDpsPassiveOperationRow 增加 bucketKey、valueSpec、conditions、priority、evidenceKey。
2. 结构化编辑器可选择 coefficientBuckets，并按 resolutionDomain 过滤 attribute/hp_change。
3. valueSpec 支持 literal、attr_ratio、hp_ratio、hp_diff_ratio、formula 的 MVP 字段。
4. conditions 支持 HP、属性、damageType、actionType、crit 的 MVP 字段。
5. 保存时保留 unknown 字段，不裁剪旧 mechanicsConfig。
6. item skillRefs 仍只做引用和摘要，不在 item 表单直接编辑 dpsPassiveEffects。

验证：
cd C:\project\damage_web_dev\web
npm run build

停止条件：
- 如果 getCoefficientBuckets 当前页面无法复用，停止并报告需要先补 API 数据流。
- 如果必须新增后端接口才能保存 mechanicsConfig，停止并报告。
- 如果 UI 会丢失 unknown 字段，停止并报告。
```

## 16. 数值验证矩阵

| 用例 | 输入 | 预期 |
| --- | --- | --- |
| 同桶相加 | raw `100`，同 bucket `-20%` 与 `-10%`，`add + percent_delta` | final `70`。 |
| 跨桶相乘 | raw `100`，bucket A 后 `90`，bucket B factor `0.5` | final `45`。 |
| 固定减伤 clamp | percent 后 `70`，flat reduction `-80`，`clampMin=0` | final `0`。 |
| 旧 incoming 兼容 | 旧 `damage_modifier value=-0.2`，无 bucketKey | raw/final `100 -> 80`，旧测试继续通过。 |
| critOnly 当前保护 | `critOnly=true`，无 crit context | blocked 或 warning evidence，不静默生效。 |
| crit context 后续锁 | raw crit expected `200`，critOnly `-20%` | final `160`，此项等真实 crit context 接入后启用。 |
| magic pre-mitigation | magic raw `100`，incoming pre `-20%`，100 MR | `100 -> 80 -> 40`。 |
| post-mitigation | magic raw `100`，100 MR，post final `-20%` | `100 -> 50 -> 40`。 |
| Rabadon AP | AP resolved 前 `300`，AP final multiplier `+30%` | resolved AP `390`，后续公式读取 `390`。 |
| Goliath augment | sourceType=`augment`，HP/adaptive force bucket | resolved attribute 改变，evidence 保留 augment 来源。 |
| self missing HP | attacker missing HP percent 达阈值 | condition 通过并产出 hp_change candidate。 |
| target HP diff | target max HP 高于 attacker | condition/valueSpec 计算增伤，低于阈值时 skipped evidence。 |

## 17. 全流程验收

实现完成后，GPT/Codex 必须执行：

1. 检查 Cursor 事件日志和 `git diff`。
2. 确认没有回滚用户或其他 agent 的既有脏改。
3. Wasm：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
node .\scripts\smoke-node.mjs
```

4. Web 如有改动：

```powershell
cd C:\project\damage_web_dev\web
npm run build
```

5. Backend 如有改动：

```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn test
```

6. 启动或复用 backend/web 服务，确认 `/api/games`、`/api/games/lol/versions/current` 指向包含新 Wasm 的 current bundle。
7. 用 Playwright 打开 DPS 页面，选择 Batch R 样例，断言页面运行成功、总伤害符合数值锁、breakdown/evidence 展示 bucket 信息。
8. 如 Web 编辑器改动，补充 Admin skill 页面 smoke：选择 bucket、修改 valueSpec/condition、保存、发布或验证 current。
9. 更新测试记录，不把命令输出和浏览器证据塞回本文档。

如果缺 Admin token、DB 权限或本地服务权限，GPT/Codex 必须明确说明已完成的自动化验证和剩余人工验证点；可自动化的 Wasm/Web 本地构建与页面 smoke 不能直接交给用户。

## 18. 停止条件和残余风险

停止条件：

1. 发现当前 `coefficientBuckets` 后端契约不能表达必要配置，并且 `bucketConfig` 无法承载。
2. 需要新增 DB schema 或迁移。
3. Cursor 试图修改非允许范围文件，或扩大到多技能 rotation、伤害类型转换、装备数据大补录。
4. 新 resolver 导致旧 Batch N/O/P/Q 数值回归。
5. 只有 synthetic Go tests 通过，但 Web current bundle 或页面 evidence 无法证明新 Wasm 被使用。

残余风险：

1. `critOnly` 需要真实 crit context 才能完整覆盖兰顿类效果；Batch R 只保留可验证接入点。
2. `formula` valueSpec 可能让数据表达力很强，但也可能让编辑器复杂化；Web 第一版应先支持只读/选择公式 ID，不要重写公式编辑器。
3. Attribute modifier 和 generic runtime 的属性系统边界需要小心。Batch R 先服务 `single_attacker_dps`，但 DTO 和 bucket 语义不能封死未来通用 runtime 接入。
4. 海克斯中超出“属性或 HP change 修饰”的规则仍需后续机制平台处理，不应挤进 Batch R。
