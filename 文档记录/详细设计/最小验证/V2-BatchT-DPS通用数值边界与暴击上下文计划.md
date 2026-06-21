TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-06-13

# V2 Batch T DPS 通用数值边界与暴击上下文计划

关联概要：[验证里程碑V2.md](../../概要设计/验证里程碑V2.md)

前置乘区平台：[V2-BatchR-DPS乘区与属性修饰平台计划.md](./V2-BatchR-DPS乘区与属性修饰平台计划.md)

前置引用契约：[V2-BatchS-0-DPS装备技能引用契约与Preflight硬化计划.md](./V2-BatchS-0-DPS装备技能引用契约与Preflight硬化计划.md)

缺口来源：[V2-ADC随机组合机制头脑风暴与缺口分析.md](./V2-ADC随机组合机制头脑风暴与缺口分析.md)

## 1. 文档边界

本文是 Batch T 的详细设计，只处理一个能力：把“数值上下界限定”抽成通用机制，并把 DPS 暴击率、暴击上下文和 `critOnly` 接到这套机制上。

本批不是继续补装备数据，也不是给暴击率写一个 `min(max(chance, 0), 1)` 特例。暴击率超过 100% 要通过通用 bounded numeric pipeline 得到 `rawValue -> boundedValue`，暴击上下文只是第一个强消费者。

本批开发仍按 Cursor 协同流程执行：GPT/Codex 先收敛范围和 prompt，Cursor 使用 `composer-2.5` 且 `fast=false` 在受限范围内编码，GPT/Codex review diff、运行验证并最终验收。

## 2. 当前事实

以下事实来自 2026-06-13 当前 worktree 定点核对：

1. 当前仓库是 `C:\project\damage_wasm_dev`，分支 `wasm/dev`。
2. Batch R 已落地 `coefficientBuckets`，并已有 `bucketConfig.clampMin/hasClampMin/clampMax/hasClampMax`，但这是乘区结果 clamp，不是属性自身边界。
3. `wasm/tinygo_engine_v2/internal/model/types.go` 的 `AttributeDefinitionV2` 已有 `clampMin/hasClampMin/clampMax/hasClampMax` 字段。
4. `wasm/tinygo_engine_v2/internal/compile/compile.go` 会把属性 clamp 字段复制进 `CompiledAttribute`，但当前属性运行时 `attribute.AttributeDefinition` 没有承接这些字段。
5. `wasm/tinygo_engine_v2/internal/attribute/attribute.go` 当前只对 `current` 做 `0..max` 类生命值 clamp，`resolved/base/max` 不使用属性定义的通用边界。
6. DPS 侧还有独立的 `state.attrs` / `state.targetAttrs` map，`stat_modifier` 与 attribute bucket 会直接修改 map 值，因此只改 `attribute.Store` 不足以覆盖 DPS。
7. 普通 runtime 的 `resolveCritApplication` 目前在 chance `<0` 或 `>1` 时返回 `E_NUMERIC`，不会自动 clamp。
8. Single-attacker DPS 的普通攻击和技能伤害在构造 pre-damage context 时设置 `HasCritContext=false`，所以 `critOnly=true` 的 damage modifier 仍会被 block。
9. Web `AttributeDefinition` 类型已有 `valueKind?: 'scalar' | 'ratio' | 'rate' | 'flag'` 与 `rateTargetAttrKey`，但 Admin attribute definition 表单目前没有通用上下界录入字段。
10. Admin skill editor 已对 `damage_modifier.critOnly=true` 做强 warning：当前 DPS 缺少真实 crit context 时会 blocked。

## 3. 问题定义

当前缺口不是“暴击率超过 100% 会出错”这么窄，而是系统缺少一个统一的数值边界层：

1. 暴击率、攻速、冷却缩减、资源比例、当前生命比例等都可能有合法上下界。
2. Batch R 的 bucket clamp 只保护某个乘区输出，不能保证最终属性读数合法。
3. 普通 runtime 读 `crit_chance` 时会因 `>1` 直接 `E_NUMERIC`；DPS runtime 目前又没有把暴击上下文传给 `critOnly`。
4. 如果只在 `resolveCritApplication` 里硬 clamp 暴击率，后续每个 rate 属性都会再写一遍局部规则。
5. 如果 `critOnly` 在 expected DPS 下简单乘总伤害，会把非暴击期望部分也错误减免。正确语义必须能区分 normal portion 和 crit portion。

## 4. 目标

1. 定义并实现通用 `NumericBoundsV2` 语义：支持下界、上界、mode、evidence，第一版 mode 只落 `clamp`。
2. 复用现有 `AttributeDefinitionV2.clampMin/hasClampMin/clampMax/hasClampMax` 作为第一版外部契约，不新开 DB schema。
3. 编译层校验属性边界：`hasClampMin && hasClampMax && clampMin > clampMax` 必须 collect-all 报错。
4. 属性运行时承接属性边界：`base/resolved/max/current` 的读写结果必须在定义边界内，且行为可测试。
5. DPS 独立属性 map 承接同一套边界：`state.attrs`、`state.targetAttrs` 在初始化、stat_modifier、attribute bucket 后都必须应用属性边界。
6. 普通 runtime 暴击率读取使用 bounded numeric resolver：`crit_chance=1.25` 在 `[0,1]` 下得到 effective `1`，不再 `E_NUMERIC`。
7. Single-attacker DPS 构造 `DPSCritContextV2`：记录 raw/effective chance、multiplier、policy、expected normal/crit portions 或 actual crit result。
8. `critOnly` 在 DPS 中不再因为缺少上下文固定 blocked；有 crit context 时按 crit portion 生效，没有上下文时继续 blocked。
9. Web Admin attribute definition 增加上下界录入和前端校验；明显结构错误阻止保存，机制语义风险强提醒。
10. 输出 evidence 让页面能看出 `rawValue`、`boundedValue`、`wasClamped` 和 bound 来源。
11. 为现有暴击样本补齐最小通用 primitive 契约：`critContextModifier`、`onCrit` 条件/触发、`critScalingValueSpec`。本批至少落到 Wasm 合同和代表测试，避免后续为焚天、兰顿、芸阿娜、纳沃利等再改暴击主干。
12. 支持“强制暴击/暴击倍率覆盖”的伤害侧表达：例如焚天第一次攻击、烬第四发、终极第四发、神圣之剑短窗暴击都不能只靠 `crit_chance` clamp 表达。
13. 支持公式读取 bounded crit 属性：`crit_chance`、`crit_damage`、`critChanceEffective` 必须能作为 value spec 输入，并支持局部 cap，用于凯特琳、纳沃利、阿塔玛等“随暴击几率缩放”的机制。

## 5. 非目标

1. 不实现 execute threshold、斩杀、收割者或低血斩杀。
2. 不实现完整 rotation、多目标、距离、射程或生存闭环。
3. 不重写 Batch R coefficient bucket 平台；只在它的输出落到属性后补属性级边界。
4. 不新增后端语义校验；后端仍只负责存储。若发现当前后端无法保存需要的字段，停止并报告，不在本批强行扩 DB。
5. 不做一轮装备/技能全量数据补录；只补必要测试 fixture。
6. 不把 `valueKind=rate` 自动等同所有业务上限。MVP 可以给 `rate` 提供推荐 `[0,1]` warning，但最终是否生效以显式 bounds 为准。
7. 不实现治疗、护盾、溢出治疗转临时生命值、生命偷取或治疗暴击闭环；焚天本批只验收“第一次攻击强制暴击的伤害侧”。
8. 不实现主动技能轮转、冷却缩短收益折算、终极后窗口、持续 3 次攻击窗口或完整 ammo/channel 序列；这些只能消费本批的暴击上下文 primitive。
9. 不实现多目标、弹射传播、地形命中、弹体拦截、飞弹穿透、Swarm/PvE 武器或范围目标选择。
10. 不实现真实随机暴击序列的完整 DPS 闭环；本批保留 expected policy 为主，只有有 actual result 的普通 runtime 或后续 seeded DPS 才能触发真实 stateful on-crit 分支。

## 6. 核心契约

### 6.1 NumericBoundsV2

运行时内部使用统一结构，不要求第一版 JSON 直接改成嵌套对象：

```go
type NumericBoundsV2 struct {
    Mode   string  // clamp | reject | warn；MVP 只实现 clamp
    Min    float64
    HasMin bool
    Max    float64
    HasMax bool
}
```

外部 JSON 第一版继续使用现有平铺字段：

```json
{
  "id": "crit_chance",
  "defaultBase": 0,
  "hasClampMin": true,
  "clampMin": 0,
  "hasClampMax": true,
  "clampMax": 1,
  "boundsMode": "clamp"
}
```

解释规则：

1. 缺省 `boundsMode` 视为 `clamp`，但只有 `hasClampMin/hasClampMax` 至少一个为 true 时才产生边界。
2. `boundsMode=reject|warn` 先只允许前端录入并 strong warning，不进入 runtime 行为。
3. `NaN/Inf` 仍是结构错误或 runtime numeric error，不由 clamp 修复。
4. 属性显式 bounds 优先于 `valueKind` 推断。
5. `valueKind=rate` 且无 bounds 时，前端显示强提醒：建议 `[0,1]`，但不强行保存隐藏字段。

### 6.2 Bounded Value Evidence

Wasm 输出新增可选 evidence，用于 DPS 和普通 runtime 共同表达边界：

```go
type NumericBoundEvidenceV2 struct {
    Key          string  `json:"key,omitempty"`          // attrKey 或 field path
    Source       string  `json:"source,omitempty"`       // attribute_definition | crit_field | value_spec
    Mode         string  `json:"mode,omitempty"`
    RawValue     float64 `json:"rawValue,omitempty"`
    BoundedValue float64 `json:"boundedValue,omitempty"`
    Min          float64 `json:"min,omitempty"`
    HasMin       bool    `json:"hasMin,omitempty"`
    Max          float64 `json:"max,omitempty"`
    HasMax       bool    `json:"hasMax,omitempty"`
    WasClamped   bool    `json:"wasClamped,omitempty"`
}
```

接入建议：

1. `DPSEffectBreakdownV2` 增加 `NumericBound *NumericBoundEvidenceV2`，用于 DPS 属性边界和 crit chance evidence。
2. `ActionEffectResultV2` 与 `StatusTickRunResultV2` 增加 `CritChanceRaw`、`CritChanceEffective`、`HasCritChance`、`CritChanceBound *NumericBoundEvidenceV2`。
3. 不要求第一版给每个属性 snapshot 都挂 evidence；只有发生 clamp 或被暴击上下文消费时必须可见。

## 7. Wasm 设计

### 7.1 编译层

默认写入：

1. `wasm/tinygo_engine_v2/internal/model/types.go`
2. `wasm/tinygo_engine_v2/internal/compile/compile.go`
3. `wasm/tinygo_engine_v2/internal/compile/compile_test.go`

要求：

1. `CompiledAttribute` 增加内部 bounds 表达，或继续保留 flat 字段但提供 `Bounds()` helper。
2. 编译时校验属性 bounds：
   - `hasClampMin=false` 时忽略 `clampMin` 数值。
   - `hasClampMax=false` 时忽略 `clampMax` 数值。
   - 同时存在上下界且 `min > max` 时 collect-all 报错。
3. 不改变无 bounds 属性的现有行为。
4. 不把 coefficient bucket clamp 迁移到属性 bounds；两者保留独立语义。

### 7.2 属性运行时

默认写入：

1. `wasm/tinygo_engine_v2/internal/attribute/attribute.go`
2. `wasm/tinygo_engine_v2/internal/attribute/attribute_test.go`
3. `wasm/tinygo_engine_v2/internal/runtime/runtime.go`

要求：

1. `attribute.AttributeDefinition` 承接 `NumericBoundsV2` 或等价 flat 字段。
2. `actorFrom` 从 `bundle.Attrs` 把 bounds 带入 `attribute.NewStore`。
3. `Slot.Resolve()` 在计算 `Resolved` 和 `Max` 后应用 bounds。
4. `SetBase`、`SetCurrent`、`NewSlot` 初始化后应用 bounds，`Current` 仍不得超过 `Max`。
5. `ReadAttr(Resolved/Base/Current/Max)` 返回的都是已 bounded 的值。
6. `crit_chance Base=1.25 + max=1` 时，普通 runtime 读到 `1`，不是 `1.25`。

### 7.3 DPS 属性 map

默认写入：

1. `wasm/tinygo_engine_v2/internal/runtime/dps_state.go`
2. `wasm/tinygo_engine_v2/internal/runtime/dps_operation_handlers.go`
3. `wasm/tinygo_engine_v2/internal/runtime/dps_attribute_modifier_adapter.go`
4. `wasm/tinygo_engine_v2/internal/runtime/dps_coefficient_bucket.go`

要求：

1. 新增 `boundDPSAttrValue(attrKey string, value float64) (bounded float64, evidence, ok)` helper。
2. `newDPSCurveState` 初始化 `baseAttrs/attrs/targetBaseAttrs/targetAttrs` 后应用属性 bounds。
3. `applyStatModifier` 修改单个属性后立即应用对应 attr bounds。
4. `applyAttributeStageBuckets` 在 attribute bucket 得到 `modified` 后，先应用 bucket clamp，再应用属性 bounds。两者 evidence 分开。
5. `refreshActiveStatModifiers` 每轮重建 map 后也做一次全量 bounds，避免旧 fixture 或直接输入绕过。
6. 如果属性不存在于 `bundle.AttrIndex`，保持当前 block 行为，不尝试猜测边界。

## 8. 暴击上下文设计

### 8.1 通用 crit chance 读取

默认写入：

1. `wasm/tinygo_engine_v2/internal/runtime/runtime_effects.go`
2. `wasm/tinygo_engine_v2/internal/crit/crit.go`
3. `wasm/tinygo_engine_v2/internal/runtime/runtime_test.go`

要求：

1. `resolveCritChance` 返回 raw/effective/evidence，而不只返回 `float64`。
2. `chanceSource=attacker_crit_chance` 读取属性 resolved 后应用属性 bounds。
3. `chanceSource=fixed` 走同一个 bounded helper，使用 probability profile `[0,1]`；这是字段类型边界，不是暴击函数内硬编码。
4. `crit.Resolve` 只消费已 bounded chance，不再负责修正非法输入。
5. `chance < 0 || chance > 1` 不再直接 `E_NUMERIC`；只有 NaN/Inf 或无 bounds 且无法安全归一时才 `E_NUMERIC`。
6. 输出 effect evidence：
   - `critChanceRaw=1.25`
   - `critChanceEffective=1`
   - `critChanceBound.wasClamped=true`

### 8.2 DPSCritContextV2

默认写入：

1. `wasm/tinygo_engine_v2/internal/runtime/dps_contract.go`
2. `wasm/tinygo_engine_v2/internal/runtime/dps_basic_attack.go`
3. `wasm/tinygo_engine_v2/internal/runtime/dps_passive_dispatcher.go`
4. `wasm/tinygo_engine_v2/internal/runtime/dps_hp_change_modifier_adapter.go`
5. `wasm/tinygo_engine_v2/internal/runtime/dps_modifier_condition.go`
6. `wasm/tinygo_engine_v2/internal/runtime/dps_driver_test.go`

建议结构：

```go
type DPSCritContextV2 struct {
    HasContext          bool
    Policy              string
    ChanceRaw           float64
    ChanceEffective     float64
    Multiplier          float64
    IsCrit              bool
    HasActualResult     bool
    ExpectedNormalPart  float64
    ExpectedCritPart    float64
    BoundEvidence       *model.NumericBoundEvidenceV2
}
```

构造规则：

1. 没有暴击字段或 `critPolicy=never`：`HasContext=false`，`critOnly` 继续 blocked。
2. `critPolicy=expected`：
   - `ExpectedNormalPart = rawDamage * (1 - chanceEffective)`
   - `ExpectedCritPart = rawDamage * chanceEffective * multiplier`
   - `RawDamage` 对后续普通伤害流程仍可表示总期望：`normal + crit`
   - `IsCrit=false`，`HasActualResult=false`
3. `critPolicy=deterministic|seeded_random`：
   - 有实际结果时 `HasActualResult=true`
   - crit 时 `ExpectedCritPart = rawDamage * multiplier`
   - non-crit 时 `ExpectedNormalPart = rawDamage`
4. 当前 DPS 只支持 `simulationRules.critPolicy=expected` 时，先实现 expected path；其它 policy 可保留普通 runtime 已有能力，不扩大 DPS 支持面。

### 8.3 `critOnly` 语义

`critOnly` 不再表示“当前事件是不是暴击就整段伤害乘上 modifier”。它表示 modifier 只作用于暴击伤害部分：

1. expected policy：
   - 非 `critOnly` percent/factor modifier 同时作用于 normal part 和 crit part。
   - `critOnly` percent/factor modifier 只作用于 crit part。
   - 合并结果为 `normalPart + critPart`。
2. deterministic / seeded actual crit：
   - `IsCrit=true` 时 `critOnly` 正常作用于整段当前伤害。
   - `IsCrit=false` 时 `critOnly` 跳过并输出 skipped evidence。
3. 无 crit context：
   - 保持当前 block：`critOnly requires crit context`。
4. MVP 暂不支持 `critOnly` flat_delta；遇到 flat crit-only 先 blocked，并在方案执行回报中说明需要单独定义“暴击部分固定减伤”语义。

示例：raw `100`，crit chance raw `1.25`，bounded `1`，crit multiplier `2`，`critOnly -20%`：

1. bounded chance = `1`
2. normal part = `0`
3. crit part = `200`
4. critOnly modifier 后 crit part = `160`
5. final expected damage = `160`

示例：raw `100`，crit chance `0.5`，crit multiplier `2`，`critOnly -20%`：

1. normal part = `50`
2. crit part = `100`
3. critOnly modifier 后 crit part = `80`
4. final expected damage = `130`

### 8.4 现有暴击样本覆盖矩阵

以下矩阵来自当前 `V2-Batch-G-adc-passive-audit.json`、`V2-Batch-C-adc-items.seed.json`、`数据/item.json`、`数据/item_panel_upserts.json`、`V2-Batch-P-target-equipment-linked-effects-audit.json` 与旧手工 `装备关联技能.json` 的定点核对。结论按“本批实现后能否不改暴击主干适配”判定，而不是按单个数据是否已经录完判定。

当前正式 `mechanicsConfig.dpsPassiveEffects` 里还没有任何 crit 字段或 `critOnly=true` 正向条目；兰顿在 Batch P 审计里仍是 blocked。因此 Batch T 不能只改读取层，还必须提供代表 fixture，把暴击主干语义先固化。

`V2-Batch-C-adc-items.seed.json` 已录入的暴击属性装备包括 `2512`、`2523`、`3031`、`3032`、`3033`、`3036`、`3046`、`3085`、`3094`、`3097`、`3508`、`6673`、`6675`、`6676`；`item_panel_upserts.json` 还覆盖 `1018`、`3086`、`3095`、`3430`、`4403`、`6670`、`6671`、`223031`、`223032`、`223033`、`223036`、`223039`、`223046`、`223085`、`223094`、`223095`、`223508`、`224403`、`226671`、`226673`、`226675`、`226676`、`228003`、`228008`、`443060`、`443061`、`443069`、`446671` 等属性面板。属性部分由 Batch T bounds 直接托底，具体被动机制仍按下表分类。

| 样本 | 暴击机制 | Batch T 后适配结论 | 必须落入本批的能力 | 仍然不是本批目标 |
| --- | --- | --- | --- | --- |
| `2512` 猎魔人弩箭、`2523` 海克斯镜片、`3031` 无尽之刃、`3033` 凡性的提醒、`3036` 多米尼克、`3046` 幻影之舞、`3085` 卢安娜、`3094/3095/3097` 疾射/岚切、`3508` 夺萃、`6673` 盾弓、`6675` 纳沃利、`6676` 收集者、`1018` 灵巧披风等 | 只提供 `crit_chance` / `crit_damage` 静态属性 | 可直接适配 | attr bounds、`crit_damage` 作为普通属性进入公式 | 装备被动另行处理 |
| `3143` / `223143` 兰顿之兆 | 受到的暴击伤害降低 | 可直接适配，必须作为验收样本 | target-side `damage_modifier.critOnly=true` 按 crit portion 生效 | 主动减速不处理 |
| `6610` / `226610` 焚天 | 对英雄第一次攻击必定暴击，并治疗/溢出临时生命 | 伤害侧可适配；完整被动不可适配 | `critContextModifier.forceCrit`、`scope=next_basic_attack_against_champion`、倍率覆盖 evidence | 治疗、溢出治疗、目标冷却/每目标首次窗口 |
| `3131` 神圣之剑 | 主动后 3 秒或 3 次普攻 100% 暴击率 | 暴击上下文可适配，完整主动窗口不可适配 | buff 内把 effective chance 覆盖到 `1` 或 `forceCrit` | active input、窗口计数、持续时间 |
| `2512` 猎魔人弩箭 | 终极后 3 次攻击强制暴击；若本应暴击则改为额外真实伤害 | 暴击主干需本批预留，完整机制不可适配 | `forceCrit`、`wouldHaveCrit` 分支字段、crit multiplier override | 终极后窗口、3 次攻击计数、额外真实伤害分支 |
| 烬 P `低语`、烬 R `完美谢幕` | 第四发/第四颗子弹必定暴击，伴随斩杀和移速/减速 | 暴击强制部分可适配；完整技能不可适配 | `forceCrit`、per-hit crit evidence | ammo/cadence、channel shots、missing HP amp、移速/减速 |
| 厄运小姐 Q `一箭双雕` | 第二段可暴击；若第一段击杀则第二段必暴击 | 暴击字段可适配，完整机制不可适配 | per-segment crit context、conditional `forceCrit` | 双目标、击杀分支、弹跳 |
| 厄运小姐 R `弹幕时间`、莎弥拉 R `炼狱扳机` | 每波/每 hit 可以暴击 | 单 hit 语义可适配，完整技能不可适配 | per-hit/per-segment crit context | channel、多 hit 聚合、范围、多目标、生命偷取 |
| 芸阿娜 P `初生之誓` | 暴击造成额外魔法伤害 | 必须能适配，建议作为 onCrit 代表样本 | `onCrit` damage proc；expected policy 下按 crit portion 加权，actual policy 下按 `IsCrit` 触发 | 若后续存在真实随机 stateful 叠层，另走 seeded DPS |
| `3032` / `223032` 育恩塔尔荒野箭 | 暴击攻击造成持续伤害，或攻击永久获得暴击几率至 cap | 暴击 DoT 需 onCrit 才能适配；永久成长只部分适配 | `onCrit` status/dot proc、bounded stack cap | 永久成长数据补录、DoT 叠层刷新细节、冷却交互 |
| 艾希 P `冰霜射击` | 暴击不增伤，改为强化减速 | 暴击结果可表达，DPS 价值不可完整适配 | `onCrit` condition、可输出 skipped/status evidence | 减速/控制收益、真实随机序列 |
| 凯特琳 P `爆头`、凯特琳 R `让子弹飞` | 伤害随暴击几率/暴击伤害增长 | 暴击缩放部分必须可适配；完整技能视上下文 | `critScalingValueSpec` 读取 bounded `crit_chance/crit_damage` | 爆头计数、陷阱/绳网目标状态、引导/拦截 |
| `6675` 纳沃利烁刃 | 技能伤害基于暴击几率提升；攻击缩短冷却 | 伤害缩放可适配；冷却收益不可适配 | `critScalingValueSpec` | 技能轮转、剩余冷却缩短 |
| `4645` / `224645` 影焰 | 魔法/真实伤害暴击低生命值敌人 | 暴击上下文可适配；完整条件需后续 | non-physical damage canCrit、conditional force/effective crit context | 低血条件统一、目标类型判断 |
| `3085` / `223085` 卢安娜、希维尔 W `弹射` | 弹射/弩箭继承或可以暴击 | 暴击主干可消费，完整机制不可适配 | crit propagation evidence 预留字段即可 | 多目标、弹射、on-hit 传播 |
| 泽丽 Q/W/E/R | Q 视作攻击可暴击；W 地形暴击；E 暴击缩短冷却；R 暴击额外叠层 | 单段伤害可消费 crit context；完整机制不可适配 | canCrit action、`onCrit` condition | 多弹体、地形、穿刺、冷却、叠层、连锁 |
| `443069` 断筋者 | 暴击施加流血和减速 | onCrit 可表达；完整收益不可适配 | `onCrit` status proc | 流血叠层、减速价值 |
| `443060` 竞技场神圣之剑 | 每次暴击随机额外暴击伤害，最多受益于 50% 暴击率 | 需要预留，MVP 不验收 | `critScalingValueSpec` 支持 cap；crit damage modifier 可读取随机/区间来源 | 随机额外暴击伤害分布 |
| `443061` 熵之力、`3430` 毁坏仪式 | 控制/护盾/施法叠暴击率与暴击率等概率护盾 | 只适配属性边界，不适配收益闭环 | bounded crit chance 可被读取 | 控制时长、护盾、生存闭环、on-cast stack |
| `9174..9408` Swarm/PvE 武器 | 暴击率作为武器成长、飞弹暴击/穿透 | 不纳入当前 LoL 单攻击方 DPS | 无 | Swarm 模式、飞弹系统、PvE 目标系统 |

### 8.5 本批必须补入的三类通用 primitive

如果 Batch T 只做 `crit_chance` clamp 与 `critOnly`，会导致焚天、芸阿娜、凯特琳/纳沃利后续继续改暴击主干。因此本批需要把下面三类 primitive 纳入合同，哪怕部分消费者只落代表测试。

1. `critContextModifier`
   - 用途：在当前 action、当前 hit、下一次普攻、持续 N 次攻击等范围内覆盖暴击上下文。
   - MVP 字段建议：`forceCrit?: boolean`、`chanceOverride?: number`、`multiplierOverride?: number`、`wouldHaveCritPolicy?: "ignore" | "preserve_for_branch"`、`sourceId`、`scope`。
   - 验收代表：焚天第一次普攻伤害侧必须变成强制暴击；`critChanceRaw/effective` 与 `forceCrit=true` evidence 同时可见。

2. `onCrit` 条件/触发
   - 用途：表达“只有暴击部分触发”的额外 damage、status、stack 或 cooldown operation。
   - expected policy 规则：纯 damage 可按 `crit portion` 加权；会改变状态、叠层、冷却、控制的 operation 必须 blocked 或降级为 evidence，不能假装真实触发序列已经存在。
   - actual/seeded policy 规则：只有 `HasActualResult=true && IsCrit=true` 时触发。
   - 验收代表：芸阿娜 on-crit 额外魔法伤害按 expected crit portion 加权；育恩塔尔/艾希/Zeri 这类 stateful onCrit 给出明确 blocked reason。

3. `critScalingValueSpec`
   - 用途：公式可以读取 bounded 暴击属性，而不是每个技能自己读 `crit_chance`。
   - MVP 输入：`crit_chance_raw`、`crit_chance_effective`、`crit_damage`、`crit_multiplier_effective`，并支持 `capMin/capMax` 局部 cap。
   - 验收代表：纳沃利或凯特琳式“随暴击几率提升伤害”的 fixture 读取 `crit_chance=1.25 -> 1` 后按 capped value 计算。

### 8.6 适配判定口径

1. “可直接适配”表示本批完成后无需再改暴击上下文主干，只需要录数据或接已有 operation。
2. “伤害侧可适配”表示 DPS 输出能正确计算伤害，但治疗、护盾、冷却、移速、控制、金币等非伤害收益仍是后续批次。
3. “暴击主干可消费，完整机制不可适配”表示本批需要预留合同和 evidence，后续实现多目标、轮转、真实随机、状态收益时不再改变本批字段。
4. “不可适配”只针对当前 LoL 单攻击方 DPS 目标，不代表未来 Swarm/PvE 或完整战斗模拟不能支持。

## 9. Web 设计

### 9.1 Attribute Definitions Admin

默认写入：

1. `web/src/types/api.ts`
2. `web/src/pages/admin/resources/attribute-definitions/types.ts`
3. `web/src/pages/admin/resources/attribute-definitions/constants.ts`
4. `web/src/pages/admin/resources/attribute-definitions/modal.tsx`
5. `web/src/pages/admin/resources/attribute-definitions/index.tsx`
6. `web/src/pages/admin/resources/attribute-definitions/columns.tsx`

要求：

1. 增加 `hasClampMin/clampMin/hasClampMax/clampMax/boundsMode` 表单字段。
2. 明显结构错误阻止保存：
   - min/max 不是有限数字。
   - 同时启用上下界且 `min > max`。
   - `boundsMode` 不是允许值。
3. 机制语义风险强提醒但允许保存：
   - `valueKind=rate` 且没有 `[0,1]` bounds。
   - `crit_chance` / `critChance` 没有上界 `1`。
   - `crit_damage` 上界被设为 `1` 以下。
4. 不在前端自动补 hidden bounds；用户确认保存什么，payload 就是什么。
5. 后端若丢弃新字段，停止并报告需要后端存储字段补齐；不在本批加后端语义逻辑。

### 9.2 Bundle Adapter

默认写入：

1. `web/src/engine/tinygoV2BundleAdapter.ts`
2. `web/src/services/attributeDefinitions.ts`

要求：

1. 把 Admin/bundle 的 attr definition bounds 映射进 TinyGo `AttributeDefinitionV2`。
2. 如果 attr definition 来自旧 bundle 且缺少 bounds，不制造默认运行时行为，只在页面/preflight 显示 warning。
3. `crit_chance` 测试 fixture 可以显式设置 `[0,1]`，用于验证超过 100% 的 clamp。

### 9.3 页面展示

默认写入：

1. `web/src/pages/WasmValidationV2DpsPage.tsx`
2. 如普通 runtime M3/M4 验证页受影响，最小修改 `web/src/pages/WasmValidationM3Page.tsx` 或 `web/src/pages/WasmValidationM4ClosurePage.tsx`

要求：

1. DPS breakdown 显示 numeric bound evidence：`crit_chance 1.25 -> 1`。
2. `critOnly` 不再一律显示“当前 DPS 缺少真实 crit context” warning；应根据 Wasm 输出或 preflight 判断是否已有 context。
3. 普通 runtime effect evidence 显示 `critChanceRaw/effective`。
4. 页面只展示结构化 evidence，不重新推导业务含义。

## 10. 实施 Gate

### T-1 attribute-bound-pass

目标：

1. Wasm compile 层校验属性 bounds。
2. attribute.Store 承接 bounds。
3. DPS 属性 map 同步应用 bounds。
4. 不改 `critOnly` 行为。

验证：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./...
go run ./cmd/bench
```

通过标准：

1. `crit_chance` raw `1.25` 的属性 resolved 为 `1`。
2. `crit_chance` raw `-0.2` 的属性 resolved 为 `0`。
3. 非暴击属性如 `attack_speed` 也能通过显式 bounds 被 clamp，证明不是 crit special-case。
4. 无 bounds 的旧属性行为不变。

### T-2 crit-context-pass

目标：

1. 普通 runtime crit chance 输出 raw/effective evidence。
2. DPS 生成 `DPSCritContextV2`。
3. `critOnly` expected policy 按 crit portion 生效。
4. 补入 `critContextModifier`、`onCrit`、`critScalingValueSpec` 的 Wasm 合同与代表测试。
5. 焚天伤害侧、兰顿暴击减伤、芸阿娜 onCrit 额外伤害、纳沃利/凯特琳式 crit scaling 必须能通过本批合同表达。

验证：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
node .\scripts\smoke-node.mjs
```

通过标准：

1. 普通 runtime `crit_chance=1.25` 不再 `E_NUMERIC`。
2. DPS `critOnly` 在有 context 时不再 blocked。
3. expected `0.5` 暴击率、`2.0` 暴击伤害、`critOnly -20%` 得到 `130`，不是 `120`。
4. 无 crit context 的旧 `critOnly` block 测试仍存在。
5. `forceCrit=true` 的代表 fixture 可让一次普攻按暴击伤害结算，并输出 override evidence。
6. `onCrit` 纯 damage 在 expected policy 下按 crit portion 加权；stateful onCrit 在 expected policy 下必须 blocked。
7. crit scaling formula 读取 bounded `crit_chance=1.25 -> 1`，不得读取 raw `1.25` 参与计算。

### T-3 web-authoring-pass

目标：

1. Attribute Definitions Admin 可录入 bounds。
2. Bundle adapter 发布到 TinyGo `AttributeDefinitionV2`。
3. WasmValidation 页面展示 bound/crit evidence。

验证：

```powershell
cd C:\project\damage_wasm_dev\web
npm run build
```

涉及页面展示时，GPT/Codex 最终还要启动或复用前端服务，用浏览器 smoke 一次 WasmValidation V2 DPS 页面。

## 11. 测试矩阵

| 用例 | 输入 | 预期 |
| --- | --- | --- |
| 属性上界 | `crit_chance=1.25`，bounds `[0,1]` | resolved/effective `1`，evidence `wasClamped=true` |
| 属性下界 | `crit_chance=-0.2`，bounds `[0,1]` | resolved/effective `0`，evidence `wasClamped=true` |
| 非暴击属性 | `attack_speed=9`，bounds `[0,5]` | resolved `5`，证明通用 bounds 生效 |
| 无 bounds 兼容 | `attack_damage=100` | 行为不变，无 extra evidence |
| invalid bounds | `min=2,max=1` | compile collect-all 报错 |
| 普通 runtime crit | `attacker_crit_chance=1.25`，expected，multiplier `2` | scalar `2`，不报 `E_NUMERIC` |
| DPS critOnly full crit | raw `100`，chance `1.25 -> 1`，multiplier `2`，critOnly `-20%` | final `160` |
| DPS critOnly expected half crit | raw `100`，chance `0.5`，multiplier `2`，critOnly `-20%` | final `130` |
| DPS no crit context | `critOnly=true` 但 action 无 crit context | 保持 blocked |
| 兰顿 critOnly 减伤 | target-side `critOnly -30%`，chance `0.5`，multiplier `2` | 只减暴击 portion，normal portion 不受影响 |
| 焚天伤害侧 | next basic attack `forceCrit=true`，raw `100`，multiplier `2` | final `200`，evidence 标明 forced crit；治疗/溢出不验收 |
| 芸阿娜 onCrit damage | raw attack `100`，chance `0.5`，onCrit magic `20` | expected 额外魔法伤害为 `10`，actual policy 下只在 `IsCrit=true` 触发 |
| stateful onCrit blocked | onCrit 操作为 cooldown/stack/status 且 policy=expected | blocked reason 说明需要 actual/seeded crit result |
| crit scaling formula | `crit_chance=1.25 -> 1`，formula 读取 `crit_chance_effective` | 使用 bounded value `1`，不使用 raw `1.25` |
| Web 结构错误 | Admin bounds min > max | 阻止保存 |
| Web 语义风险 | `valueKind=rate` 未配置 bounds | 强提醒，允许保存 |

## 12. Cursor Prompt A：Wasm 通用属性边界

```text
目标：实现 Batch T 的通用属性数值边界第一段，只接 compile/attribute/DPS attr map，不实现 DPS critOnly 语义。
执行模型：Cursor composer-2.5，fast=false。

允许写入范围：
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\compile\compile.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\compile\compile_test.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\attribute\attribute.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\attribute\attribute_test.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\runtime.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_state.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_operation_handlers.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_attribute_modifier_adapter.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go

只读参考：
- C:\project\damage_wasm_dev\文档记录\详细设计\最小验证\V2-BatchT-DPS通用数值边界与暴击上下文计划.md
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\AGENTS.md
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\README.md

实现要求：
1. 复用 AttributeDefinitionV2 现有 clampMin/hasClampMin/clampMax/hasClampMax 字段。
2. compile 层校验属性 bounds，min > max collect-all 报错。
3. attribute.AttributeDefinition 承接 bounds，Slot Resolve/SetBase/SetCurrent/NewSlot 后应用 bounds。
4. DPS state.attrs/targetAttrs 初始化、stat_modifier、attribute bucket 后都应用同一套属性 bounds。
5. 新增测试：crit_chance 上下界、attack_speed 通用 bounds、无 bounds 兼容、invalid bounds。

验证命令：
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./...
go run ./cmd/bench

停止条件：
- 如果需要新增后端 DB schema，停止并报告。
- 如果必须重写 attribute.Store 才能完成，停止并报告更小拆分方案。
- 如果修改会改变无 bounds 旧 fixture 的数值，停止并报告。
```

## 13. Cursor Prompt B：Wasm 暴击上下文与 critOnly

```text
目标：在 Batch T 属性边界已完成的基础上，接入普通 runtime crit chance raw/effective evidence，并让 single-attacker DPS 生成 crit context，使 critOnly 在 expected policy 下只作用于暴击期望部分。
执行模型：Cursor composer-2.5，fast=false。

允许写入范围：
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\crit\crit.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\runtime_effects.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\runtime_test.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_contract.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_basic_attack.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_operation_handlers.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_passive_dispatcher.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_hp_change_modifier_adapter.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_modifier_condition.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go

只读参考：
- C:\project\damage_wasm_dev\文档记录\详细设计\最小验证\V2-BatchT-DPS通用数值边界与暴击上下文计划.md
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_coefficient_bucket.go

实现要求：
1. resolveCritChance 返回 raw/effective/evidence。
2. chanceSource=attacker_crit_chance 使用属性 bounds；fixed chance 使用同一 bounded numeric helper 的 probability profile [0,1]。
3. ActionEffectResultV2/StatusTickRunResultV2 输出 critChanceRaw/critChanceEffective/critChanceBound。
4. DPS pre-damage context 填充 DPSCritContextV2。
5. expected policy 下维护 normalPart/critPart；critOnly percent/factor 只作用于 critPart。
6. 无 crit context 时 critOnly 继续 blocked。
7. MVP 遇到 critOnly flat_delta 先 blocked，并在 blocked reason 中说明。
8. 增加 `critContextModifier` 合同并实现最小 `forceCrit`/`multiplierOverride` 伤害侧路径；焚天代表 fixture 必须能表达“下一次普攻强制暴击”，但不要实现治疗/溢出生命。
9. 增加 `onCrit` 条件/触发合同：expected policy 下只允许纯 damage 按 crit portion 加权；cooldown、stack、status、slow、heal、shield 这类 stateful onCrit 必须 blocked 并输出原因。
10. 增加 `critScalingValueSpec`，公式读取 bounded `crit_chance_effective`、`crit_damage`、`crit_multiplier_effective`，支持局部 cap。新增纳沃利或凯特琳式代表测试。
11. 兰顿代表测试必须证明 target-side `critOnly` 只作用于 crit portion。

验证命令：
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
node .\scripts\smoke-node.mjs

停止条件：
- 如果 expected critOnly 无法在不重写整个 DPS damage flow 的情况下安全实现，停止并报告最小前置拆分。
- 如果 seeded/deterministic DPS policy 必须一起扩展才能通过测试，停止并只保留 expected MVP。
- 如果需要改变 Batch R bucket 聚合语义，停止并报告。
- 如果 `onCrit` stateful 分支无法安全阻断，停止并报告，不允许在 expected policy 下伪造真实暴击序列。
- 如果焚天完整治疗/溢出生命被迫一起实现，停止并把它拆成生存闭环后续批次。
```

## 14. Cursor Prompt C：Web bounds 录入与 evidence 展示

```text
目标：让前端可录入 attribute bounds，并把 bounds 传进 TinyGo bundle；WasmValidation 页面展示 crit chance raw/effective 和 numeric bound evidence。
执行模型：Cursor composer-2.5，fast=false。

允许写入范围：
- C:\project\damage_wasm_dev\web\src\types\api.ts
- C:\project\damage_wasm_dev\web\src\services\attributeDefinitions.ts
- C:\project\damage_wasm_dev\web\src\engine\tinygoV2BundleAdapter.ts
- C:\project\damage_wasm_dev\web\src\pages\admin\resources\attribute-definitions\types.ts
- C:\project\damage_wasm_dev\web\src\pages\admin\resources\attribute-definitions\constants.ts
- C:\project\damage_wasm_dev\web\src\pages\admin\resources\attribute-definitions\modal.tsx
- C:\project\damage_wasm_dev\web\src\pages\admin\resources\attribute-definitions\index.tsx
- C:\project\damage_wasm_dev\web\src\pages\admin\resources\attribute-definitions\columns.tsx
- C:\project\damage_wasm_dev\web\src\pages\WasmValidationV2DpsPage.tsx
- 必要时最小修改 C:\project\damage_wasm_dev\web\src\pages\WasmValidationM3Page.tsx
- 必要时最小修改 C:\project\damage_wasm_dev\web\src\pages\WasmValidationM4ClosurePage.tsx

只读参考：
- C:\project\damage_wasm_dev\web\AGENTS.md
- C:\project\damage_wasm_dev\web\README.md
- C:\project\damage_wasm_dev\文档记录\详细设计\最小验证\V2-BatchT-DPS通用数值边界与暴击上下文计划.md

实现要求：
1. AttributeDefinition 类型补充 hasClampMin/clampMin/hasClampMax/clampMax/boundsMode。
2. Admin attribute definitions 表单可录入上下界。
3. min > max、非有限数字、非法 mode 阻止保存。
4. valueKind=rate 无 bounds、crit_chance 无 max=1 给强提醒但允许保存。
5. tinygoV2BundleAdapter 把 bounds 映射到 AttributeDefinitionV2。
6. 页面展示 Wasm 输出的 numericBound 和 critChance raw/effective。
7. 不在前端隐藏自动补 bounds。

验证命令：
cd C:\project\damage_wasm_dev\web
npm run build

停止条件：
- 如果后端 API 丢弃新增字段，停止并报告需要后端存储能力补齐，不要改后端语义校验。
- 如果页面展示需要新增大型通用工具，停止并先做最小 evidence 展示。
```

## 15. 全流程验收

实现全部 gate 后，GPT/Codex 必须执行：

1. 检查 Cursor 日志和 `git diff`，确认没有越权改动。
2. Wasm：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
node .\scripts\smoke-node.mjs
```

3. Web：

```powershell
cd C:\project\damage_wasm_dev\web
npm run build
```

4. 浏览器 smoke：
   - 打开 WasmValidation V2 DPS 页面。
   - 使用带 `crit_chance=1.25` 且 bounds `[0,1]` 的 fixture。
   - 确认页面显示 raw/effective chance。
   - 确认 `critOnly` 不再因缺少 context blocked。
5. 如果 Web bounds 字段保存失败，停止并把“后端仅存储字段缺口”列为下一批，不在本批强扩语义校验。

## 16. 完成定义

1. `crit_chance > 1` 通过通用 bounds 得到 effective `1`。
2. `crit_chance < 0` 通过通用 bounds 得到 effective `0`。
3. 至少一个非暴击属性证明同一机制可复用。
4. 普通 runtime 不再因 bounded crit chance 返回 `E_NUMERIC`。
5. DPS `critOnly` 在 expected crit context 下作用于 crit portion。
6. 无 context 的 `critOnly` 仍有明确 block。
7. Web 可以录入 bounds，结构错误阻止保存，语义风险强提醒。
8. 输出 evidence 足够定位 raw/effective 差异。
9. 焚天代表 fixture 的伤害侧可通过 `forceCrit` 计算；文档和测试明确治疗/溢出生命不在本批。
10. 兰顿代表 fixture 证明 target-side `critOnly` 可以消费 DPS crit context。
11. 至少一个 onCrit 纯 damage 样本在 expected policy 下按 crit portion 加权，至少一个 stateful onCrit 样本在 expected policy 下明确 blocked。
12. 至少一个 crit scaling formula 样本读取 bounded crit 属性，证明凯特琳/纳沃利类机制后续不需要再改暴击主干。

## 17. 残余风险

1. `critOnly` flat_delta 的数学语义未定义，本批先不支持。
2. 如果发布链的 AttributeDefinition 来源无法保存 bounds，需要单独做后端存储字段补齐，但仍不引入后端语义判断。
3. `valueKind=rate` 是否默认 `[0,1]` 需要后续数据治理确认；本批只做显式 bounds 与 warning。
4. 普通 runtime 与 DPS runtime 的 crit evidence 字段可能需要前端类型同步，不能只改 Wasm。
5. 如果后续引入 seeded_random DPS，`DPSCritContextV2` 已预留 actual result，但本批验收只要求 expected policy。
6. 焚天完整被动仍缺治疗、溢出治疗和每目标首次攻击窗口；本批只保证伤害侧不会返工。
7. 艾希、育恩塔尔、泽丽、断筋者这类 stateful onCrit 需要 actual/seeded crit result、状态/冷却/控制系统后才能完整验收。
8. 多目标暴击传播仍是后续批次：卢安娜、希维尔、厄运小姐 Q/R、莎弥拉 R 不应在 Batch T 假装支持完整目标集合。
