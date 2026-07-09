TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-06-06

# V2 Batch O 单攻击方 DPS 事件化联动机制计划

关联概要：[验证里程碑V2.md](../../概要设计/验证里程碑V2.md)

关联总方案：[V2-单攻击方DPS协议与开发计划.md](./V2-单攻击方DPS协议与开发计划.md)

前置机制：[V2-BatchK-单攻击方DPS收口与鬼索幻影命中计划.md](./V2-BatchK-单攻击方DPS收口与鬼索幻影命中计划.md)

前置机制：[V2-BatchL-单攻击方DPS咒刃下一次普攻状态计划.md](./V2-BatchL-单攻击方DPS咒刃下一次普攻状态计划.md)

前置机制：[V2-BatchM-Wasm属性读取语义与三相基础AD修正计划.md](./V2-BatchM-Wasm属性读取语义与三相基础AD修正计划.md)

前置机制：[V2-BatchN-单攻击方DPS普攻充能阈值触发计划.md](./V2-BatchN-单攻击方DPS普攻充能阈值触发计划.md)

## 1. 本文档边界

本文档是把 `single_attacker_dps` 从“普攻后专线 passive 处理”掰回机制事件模型的执行真源，不是测试记录。当前文档编写会话只维护本文和任务治理映射；不得在本文档编写会话里新增 runtime、backend、web、seed 或 DB 数据改动。

Batch O 的重点不是补某个装备，而是固定后续机制扩展的运行方式：

1. DPS 仍然是单攻击者、单目标、固定时间窗的用户可用场景。
2. DPS 场景内的技能、装备、被动联动必须进入统一事件链，不能继续为卢登、黑切、反甲、兰顿或某个页面单独写临时逻辑。
3. `type` 只能作为 matcher 条件，例如 `action/basic_attack`、`action/cast_skill`、`skill_tag/*`；不能把联动主轴改成“按 type 管理技能效果”。
4. Cursor 只能按本文收敛后的阶段执行。若发现本文不足以约束实现，必须停止回报 GPT/Codex，不得自行扩写成完整 1v1 或技能 rotation。

## 2. 当前代码事实

以下事实来自当前 `C:\project\damage_wasm_dev` 的 `wasm/dev` 分支源码：

1. `DPSPassiveEffectV2` 目前只有 `PassiveID`、`EffectID`、`SourceCategory`、`SourceID`、`SourceType`、`TriggerID`、`TriggerKind`、`EveryN`、`RequiresScenarioStateID`、charge 字段、`ProcScope` 和 `Operations`，没有 `OwnerRole`、`Priority`、`Trigger.Event` 或 matcher 字段。
2. `DPSPassiveOperationV2` 目前支持 damage 公式、目标 HP ratio、攻击者属性读取、stack、DoT、`stat_modifier`、`phantom_hit_on_hit_repeat` 等字段，没有 `damage_modifier`，也没有 target-side attr modifier 语义。
3. `processBasicAttack` 先调用通用 runtime 的 `PerformCastAt`，随后把 target HP 回滚到 DPS 自己的状态，再由 DPS 自己的 `applyDamage` 写入伤害 timeline。
4. `processAttackPassives` 只在基础普攻伤害存在时运行，默认空 `TriggerKind` 为 `on_basic_attack_hit`，并按 `state.passives` 输入顺序逐个执行 operations。
5. DPS 自己的 `applyDamage` 只做抗性、HP 扣减、`damageTimeline`、`damageBySource`、`damageByType`、击杀标记；它不调用通用 runtime 的 `fireTriggers`。
6. 通用 runtime 已有 `on_damage_dealt` / `on_damage_taken` 和 owner match，但 DPS 专线没有接入。
7. 当前 `stat_modifier` 修改的是 DPS 攻击者属性 map；目标侧护甲、魔抗主要是 `state.armor` / `state.magicResist` 快照，不支持黑切这类 target armor shred stack。
8. 当前 phantom-hit 是专门的普攻 on-hit 复制语义，不应默认复制技能触发装备特效、反击、DoT tick 或 target-side trigger。

## 3. 问题定义

现在已有“真实普攻命中后触发攻击特效”的链路，但它不能无缝变成“技能命中触发装备特效”，原因不是字段名不够，而是触发入口和事件上下文不通用：

```text
current:
basic attack action damage
-> processAttackPassives(timeMs)
-> enabled passiveEffects in input order
-> operations in JSON order
-> phantom hit / dot tick special handling
```

后续需要转成：

```text
expected:
action / damage event
-> build DPSCombatEventContext
-> owner-aware passive matcher
-> phase + priority + originalIndex sort
-> execute operations
-> produced damage / stack / attr modifier / damage modifier / dot / repeat events
```

Batch O 不把 `single_attacker_dps` 直接扩成完整通用 runtime，也不恢复完整 1v1。它只把单攻击者 DPS 内的机制触发方式改成事件化，使后续技能命中、装备特效、目标侧装备和减伤都接同一套 dispatcher。

## 4. 目标

Batch O 分四个 gate，允许分多次 Cursor 执行。

| Gate | 目标 | 可单独通过 |
| --- | --- | --- |
| `O-contract-pass` | 固定 DPS event context、owner-aware passive trigger、兼容映射、排序和停止条件 | 是 |
| `O-runtime-compat-pass` | Wasm 内部引入 event dispatcher，现有破败/海妖/鬼索、薇恩/卡莎/老鼠、充能、phantom-hit 回归不退化 | 是 |
| `O-target-side-pass` | 支持 `ownerRole=target` 的 `on_damage_taken` / retaliation，以及 target-side stack/attr modifier 最小样例 | 否，依赖 runtime compat |
| `O-modifier-spell-pass` | 支持 `damage_modifier` 和 `on_spell_hit` / `on_damage_dealt` matcher 的 synthetic proof，为兰顿、卢登接入铺路 | 否，依赖前两项 |

本批若只完成 `O-runtime-compat-pass`，只能声明“DPS 已抽出事件 dispatcher，旧 on-hit 兼容通过”；不能宣称反甲、黑切、兰顿、卢登真实数据闭环。

## 5. 非目标

1. 不实现完整 1v1、敌方主动动作、敌方 AI、主动技能自动轮转或自由 action queue editor。
2. 不恢复旧 Rust/Katarina crate，不新建 parallel runtime。
3. 不把 Web 页面作为机制计算来源；Web 只能投影 published bundle 并展示 Wasm 输出。
4. 不为单个装备写专用分支，例如 `if item == thornmail`、`if source == luden`。
5. 不用 `type` 作为联动主调度。`type` 只参与 matcher。
6. 不让 phantom-hit 默认复制 spell proc、retaliation、damage modifier、DoT tick 或 target-side trigger。
7. 不在 `O-runtime-compat-pass` 同时改 backend seed、web 页面和 live publish。
8. 不把缺少公式、缺少 published 数据或缺少页面证据的真实装备伪装成 `ok`。

## 6. Contract 设计

### 6.1 新增 DTO 字段

优先在 `DPSPassiveEffectV2` 上新增以下字段，保留旧字段兼容：

```go
type DPSPassiveEffectV2 struct {
    PassiveID      string
    EffectID       string
    SourceCategory string
    SourceID       string
    SourceType     string

    OwnerRole string `json:"ownerRole,omitempty"` // attacker | target; empty maps to attacker
    Priority  int    `json:"priority,omitempty"`
    Trigger   DPSPassiveTriggerSpecV2 `json:"trigger,omitempty"`

    TriggerID   string
    TriggerKind string
    EveryN      int
    ProcScope   string
    Operations  []DPSPassiveOperationV2
}
```

不要复用输出 DTO `DPSPassiveTriggerV2` 作为输入 trigger 类型，避免输入定义和输出证据混在一起。建议新增：

```go
type DPSPassiveTriggerSpecV2 struct {
    Event   string                    `json:"event,omitempty"`
    Matcher DPSPassiveTriggerMatcherV2 `json:"matcher,omitempty"`
}

type DPSPassiveTriggerMatcherV2 struct {
    DamageTypes      []string      `json:"damageTypes,omitempty"`
    ActionTypes      TypeMatcherV2 `json:"actionTypes,omitempty"`
    EffectTypes      TypeMatcherV2 `json:"effectTypes,omitempty"`
    EffectTags       TypeMatcherV2 `json:"effectTags,omitempty"`
    SourceTypes      []string      `json:"sourceTypes,omitempty"`
    SourceCategories []string      `json:"sourceCategories,omitempty"`
    ProcScopes       []string      `json:"procScopes,omitempty"`
    IncludePhantom   bool          `json:"includePhantom,omitempty"`
    ExcludePhantom   bool          `json:"excludePhantom,omitempty"`
}
```

规则：

1. `ownerRole` 空值等价于 `attacker`，保证旧输入不需要立刻迁移。
2. `priority` 空值等价于 `0`；同 priority 下按 `resolvedSnapshot.passiveEffects[]` 原始顺序稳定排序。
3. `trigger.event` 空值时，按旧 `TriggerKind` 映射。
4. `ActionTypes`、`EffectTypes`、`EffectTags` 使用现有 `TypeMatcherV2`，不要发明新的 type matcher 语法。
5. `DamageTypes`、`SourceTypes`、`SourceCategories` 用小型字符串集合即可；如果后续需要 `Any/All/None`，再单独扩展。

### 6.2 旧字段兼容映射

Cursor 实现时必须先写兼容层，不允许把旧 fixtures 全量改成新字段后掩盖回归。

| 旧字段 | 新语义 |
| --- | --- |
| `TriggerKind=""` | `ownerRole=attacker`, `event=on_basic_attack_hit` |
| `TriggerKind=on_basic_attack_hit` | `ownerRole=attacker`, `event=on_basic_attack_hit` |
| `TriggerKind=every_n_basic_attack_hit` | `ownerRole=attacker`, `event=on_basic_attack_hit`, plus every-N gate |
| `TriggerKind=stack_on_hit` | `ownerRole=attacker`, `event=on_basic_attack_hit` |
| `TriggerKind=stat_modifier_always_on` | `event=stat_modifier_always_on`，仍走初始化/refresh 路径 |
| `TriggerKind=pre_enabled_state_modifier` | `event=pre_enabled_state_modifier`，仍走初始化/refresh 路径 |
| `TriggerKind=next_basic_attack_after_state` | `event=on_basic_attack_hit`，plus scenario state ready gate |
| `TriggerKind=energized_charge_and_consume` | `event=on_basic_attack_hit`，`procScope=real_basic_attack_only` |

### 6.3 Event 命名

Batch O 允许以下 event：

```text
on_basic_attack_hit
on_spell_hit
on_hit
on_damage_dealt
on_damage_taken
stat_modifier_always_on
pre_enabled_state_modifier
dot_tick
```

含义：

1. `on_basic_attack_hit`：真实普攻命中后，基础 action damage 已处理。
2. `on_spell_hit`：技能造成命中类 damage 后。Batch O 不新增主动技能 rotation，但 dispatcher 必须能接收该事件。
3. `on_hit`：可同时匹配 basic attack 和未来明确允许的 hit 类事件。默认不含 DoT tick。
4. `on_damage_dealt`：owner 作为 damage source 造成 final damage 后。
5. `on_damage_taken`：owner 作为 damage target 承受 final damage 后。
6. `dot_tick`：DPS DoT tick 事件。除非 matcher 显式允许，否则不要触发 on-hit。

## 7. Internal Event Context

在 `dps_driver.go` 内新增内部上下文，不要求第一步暴露到 JSON 输出：

```go
type dpsCombatEventContext struct {
    Event string

    TimeMs int64
    SourceRole string // attacker | target
    TargetRole string // attacker | target

    ActionID string
    ActionTypes []string
    EffectTypes []string
    EffectTags []string
    SourceType string
    SourceCategory string
    SourceID string

    DamageType string
    RawDamage float64
    FinalDamage float64
    TargetHPBefore float64
    TargetHPAfter float64

    IsBasicAttack bool
    IsSpell bool
    IsOnHit bool
    IsDotTick bool
    IsPhantomHit bool
    ProcScope string
}
```

实现要求：

1. 基础普攻 damage 调用 `applyDamage` 后，要生成 `on_basic_attack_hit`、`on_hit`、`on_damage_dealt`、`on_damage_taken` 可消费的上下文。
2. 旧 `processAttackPassives(timeMs)` 应收敛成包装器，内部调用新的 `dispatchDPSLinkedEffects(ctx)`；不要继续扩大旧函数。
3. `applyDamage` 应返回结构化 damage application，而不是只返回 `bool`。建议形状：

```go
type dpsDamageApplication struct {
    Applied bool
    RawDamage float64
    FinalDamage float64
    TargetHPBefore float64
    TargetHPAfter float64
}
```

4. DoT tick、phantom-hit copy、operation damage 都应能生成 damage application；但不是所有 damage application 都自动触发全部 passives，必须由 dispatcher 的 phase/proc guard 控制。
5. `chainDepth` 或等价 guard 必须防止反甲/卢登/phantom-hit 递归无限触发。

## 8. Dispatcher 规则

建议新增：

```go
func (state *dpsCurveState) dispatchDPSLinkedEffects(ctx dpsCombatEventContext, phase string)
```

或等价函数。其职责：

1. 从 `state.passives` 中筛选 enabled passive。
2. 用 `ownerRole` 判断该 passive 当前是否归属事件 source/target。
3. 用 `trigger.event` 和 matcher 判断是否触发。
4. 对旧 trigger kind 执行 every-N、scenario state、energized、always-on 等额外 gate。
5. 按 `phase`、`priority`、原始 passive index、operation index 稳定执行。
6. 把 operation 产生的新 damage、stack、modifier、dot、repeat 记录到 timeline 和 breakdown。

### 8.1 Owner Role 匹配

事件中的 source/target 角色固定为 `attacker` / `target`：

| passive.ownerRole | on_damage_dealt | on_damage_taken |
| --- | --- | --- |
| `attacker` | 匹配攻击者造成的 damage | 匹配攻击者受到的 damage |
| `target` | 匹配目标造成的 damage | 匹配目标受到的 damage |

在单攻击方 DPS 中，基础普攻 damage 的 source 是 `attacker`，target 是 `target`。因此：

1. 破败、海妖、鬼索、卢登：`ownerRole=attacker`。
2. 反甲、兰顿：`ownerRole=target`。
3. 黑切通常是攻击者装备对目标叠 debuff：`ownerRole=attacker`，operation 的 `targetRole=target`。

### 8.2 阶段顺序

同一次基础 action damage 后，Batch O 固定阶段：

```text
1. base_action_damage
2. attacker_on_hit_and_damage_dealt
3. target_damage_taken_mitigation_or_retaliation
4. repeat_or_phantom_hit_copyable
5. dot_or_delayed_events_by_event_time
```

具体规则：

1. 基础 action damage 仍先于 passive damage。
2. attacker on-hit / on-damage-dealt 先于 target retaliation，避免反甲先于破败/海妖改变同一次普攻攻击者侧解释。
3. mitigation 类 `damage_modifier` 如果影响 incoming damage，必须在 final damage 计算前应用；因此 `damage_modifier` 不应复用已完成的 `on_damage_taken` 后置阶段。
4. phantom-hit 仍在专门 repeat 阶段处理，只复制明确 `PhantomHitCopyable=true` 且 matcher 允许的 copyable on-hit damage。
5. DoT tick 按事件时间进入队列，不能在同一普攻阶段立即补算未来 tick。

### 8.3 排序

同阶段排序：

```text
priority ASC
resolvedSnapshot.passiveEffects originalIndex ASC
operationIndex ASC
```

禁止依赖 map 遍历顺序。若新增 sort helper，测试必须证明同 priority 下输入顺序稳定。

## 9. Operation 扩展

### 9.1 targetRole

在 `DPSPassiveOperationV2` 上新增：

```go
TargetRole string `json:"targetRole,omitempty"` // attacker | target; empty default depends on kind
```

默认规则：

| kind | TargetRole 空值默认 |
| --- | --- |
| `damage` | `target` |
| `apply_dot` | `target` |
| `add_stack` | owner-scoped state，不直接指 actor |
| `stat_modifier` | `attacker`，兼容旧语义 |
| `modify_attr` | 必填或默认 `attacker` |
| `damage_modifier` | 作用于当前 damage context 的 target |

### 9.2 target-side attr state

为黑切这类效果，DPS 需要从“只有攻击者 attrs + 目标 armor/mr 快照”升级到同时维护：

```text
attackerAttrs / attackerAttributeViews
targetAttrs / targetAttributeViews
```

最小实现可以先复用现有 `state.attrs` 作为 attacker attrs，同时新增 `state.targetAttrs`。`state.armor` 和 `state.magicResist` 应从 target attrs 读取或刷新，不能与 target-side modifier 脱节。

### 9.3 modify_attr / stat_modifier

可以先复用 `stat_modifier`，但必须补 `TargetRole`。如果为了语义清晰新增 `modify_attr`，需要保持旧 `stat_modifier` 兼容。

黑切最小表达：

```json
{
  "ownerRole": "attacker",
  "trigger": {
    "event": "on_damage_dealt",
    "matcher": {
      "damageTypes": ["physical"],
      "excludePhantom": true
    }
  },
  "operations": [
    {
      "kind": "add_stack",
      "source": "black_cleaver_carve_stack",
      "stackKey": "black_cleaver_carve",
      "maxStacks": 5,
      "durationMs": 6000,
      "refreshMode": "refresh"
    },
    {
      "kind": "stat_modifier",
      "source": "black_cleaver_armor_shred",
      "targetRole": "target",
      "stackKey": "black_cleaver_carve",
      "attrKey": "armor",
      "modifierMode": "percent",
      "value": -0.04,
      "perStack": true
    }
  ]
}
```

### 9.4 damage_modifier

新增 `damage_modifier` 时，必须先确定它作用于哪个 value phase。建议字段：

```json
{
  "kind": "damage_modifier",
  "source": "randuins_crit_damage_reduction",
  "targetRole": "target",
  "damageType": "physical",
  "modifierMode": "percent",
  "value": -0.20,
  "valuePhase": "incoming",
  "critOnly": true
}
```

规则：

1. `valuePhase=incoming` 在 target final damage 前应用。
2. `critOnly=true` 只能匹配 event context 中明确标记为 crit 或 expected crit contribution 的 damage；如果当前 DPS 只有 expected crit 而没有 per-event crit flag，必须停止并先补 crit context。
3. 不允许在 `on_damage_taken` 后置阶段再修改已经写入 timeline 的 final damage。

## 10. 代表机制样例

### 10.1 破败/海妖/鬼索

旧 fixture 不必迁移到新 JSON，但 runtime 必须把它们映射成：

```text
ownerRole=attacker
event=on_basic_attack_hit
matcher.sourceTypes includes basic_attack
```

验收重点：现有 damageBySource、itemPassiveTriggers、effectBreakdown、phantom-hit copyable 不退化。

### 10.2 反甲

最小 synthetic 反甲：

```json
{
  "passiveId": "item_thornmail_retaliation_test",
  "sourceCategory": "item_passive",
  "sourceId": "item_thornmail",
  "sourceType": "item",
  "ownerRole": "target",
  "trigger": {
    "event": "on_damage_taken",
    "matcher": {
      "damageTypes": ["physical"],
      "actionTypes": { "any": ["action/basic_attack"] },
      "excludePhantom": true
    }
  },
  "operations": [
    {
      "kind": "damage",
      "source": "thornmail_reflect",
      "targetRole": "attacker",
      "damageType": "magic",
      "amount": 20
    }
  ]
}
```

验收重点：

1. 反甲 damage 写入攻击者 HP 或等价 evidence；如果当前 DPS 输出不记录 attacker HP，必须先补最小 attacker damage evidence，不得把反伤错误计入 target total damage。
2. 反甲不能递归触发攻击者 on_damage_taken 后再次触发 target 反击。
3. 反甲不应被 phantom-hit 默认复制。

### 10.3 黑切

最小 synthetic 黑切：

```text
physical damage dealt
-> attacker-owned passive matches on_damage_dealt
-> add_stack on black_cleaver_carve
-> targetRole=target stat_modifier reduces armor
-> next physical damage uses reduced armor
```

验收重点：

1. 第一刀先按原 armor 结算，再叠层。
2. 第二刀开始使用降低后的 armor。
3. stack 过期在下一次 DPS 事件前懒清理，符合现有 stack 语义。

### 10.4 兰顿

最小 synthetic 兰顿只证明 `damage_modifier`，不需要真实装备数据：

```text
target-owned passive
matcher: incoming physical crit damage
operation: damage_modifier percent -0.20 valuePhase=incoming
```

验收重点：

1. 修改发生在 final damage 写 timeline 前。
2. effectBreakdown 能解释 raw、crit scalar、modifier、final damage。
3. 如果当前 expected crit 无法区分 crit contribution，必须 blocked，并把 `crit event context` 作为前置任务。

### 10.5 卢登

Batch O 不新增主动技能 rotation，但 dispatcher 必须能接收 spell event。最小 synthetic 卢登：

```json
{
  "ownerRole": "attacker",
  "trigger": {
    "event": "on_spell_hit",
    "matcher": {
      "actionTypes": { "any": ["action/cast_skill"] },
      "effectTags": { "any": ["skill_tag/spell_damage"] },
      "damageTypes": ["magic"]
    }
  },
  "operations": [
    {
      "kind": "damage",
      "source": "luden_spell_hit_proc",
      "targetRole": "target",
      "damageType": "magic",
      "amount": 40
    }
  ]
}
```

验收重点：

1. 该测试只证明 dispatcher 可由 spell hit 上下文触发。
2. 不允许为了卢登在 Batch O 中实现自动技能 rotation。
3. 后续若要用户页面自然触发卢登，需要另开 batch 接入显式技能事件或技能轮转边界。

## 11. Wasm 写入范围

`O-runtime-compat-pass` 允许写入：

1. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go`
2. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver.go`
3. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go`

`O-target-side-pass` 仍限制在上述三个文件，除非 target HP / attacker HP evidence 需要输出 DTO 字段，才允许最小改 `types.go` 中的 DPS output DTO。

禁止写入：

1. `web/**`
2. `backend/**`
3. seed/audit/publish 文件
4. `dist/tinygo_engine_v2.wasm`
5. `.codegraph/*.db*`
6. 与 `single_attacker_dps` 无关的 runtime 子系统

## 12. 后续跨端写入范围

只有 `O-runtime-compat-pass` 和 `O-target-side-pass` 通过后，才允许进入跨端执行。

| Worktree | 允许写入 |
| --- | --- |
| `C:\project\damage_web_dev` | `web/src/engine/tinygoV2DpsAdapter.ts`、相关 V2 DPS 验证页展示和导出证据 |
| `C:\project\damage_backend_dev` | 最小验证 seed/audit、必要的 import/publish DTO 透传测试 |
| `C:\project\damage_wasm_dev` | 同步后的 wasm artifact、测试记录 |

跨端阶段仍禁止页面手算机制结果。Web 只能把 published bundle 中的 owner-aware passive 投影到 Wasm input，并展示 Wasm output。

## 13. 执行顺序

### 13.1 O0 合同确认

1. GPT/Codex 检查 worktree 根目录、分支和 `git status --short`。
2. GPT/Codex 读取最近层 `AGENTS.md`、README、本计划和当前代码。
3. GPT/Codex 收敛 Cursor prompt；Cursor 使用 `grok-4.5`。
4. 若实现需要改变本文的 owner、event、phase 或停止条件，先改本文并由 GPT/Codex review，不能直接编码。

### 13.2 O1 Wasm runtime compat

1. 新增 `ownerRole`、`priority`、`trigger`、matcher DTO 字段。
2. 新增 internal `dpsCombatEventContext` 和 `dpsDamageApplication`。
3. 修改 `applyDamage` 返回 damage application。
4. 把旧 `processAttackPassives` 收敛到 event dispatcher，但保持旧行为。
5. 保持 every-N、next attack state、energized、stat always-on、phantom-hit 原测试通过。
6. 新增 tests 证明旧 fixture 可以不迁移 JSON 即通过。

### 13.3 O2 target-side linked effects

1. 支持 `ownerRole=target` 的 `on_damage_taken` matcher。
2. 支持 operation `targetRole=attacker` 的 retaliation damage evidence。
3. 新增 target attrs 或目标抗性刷新，支持 targetRole=target stat modifier。
4. 新增黑切 synthetic stack armor shred 测试。
5. 新增反甲 synthetic retaliation 测试。

### 13.4 O3 damage modifier and spell dispatch proof

1. 新增 `damage_modifier`，先只支持 `valuePhase=incoming`、`modifierMode=percent`、可选 `critOnly`。
2. 若 `critOnly` 缺少上下文，先 blocked 并补 crit context，不允许静默近似。
3. 新增 synthetic `on_spell_hit` dispatch 测试，证明卢登这类机制未来可接同一 dispatcher。
4. 不新增技能 rotation。真实卢登页面接入另开 batch。

## 14. Wasm 测试要求

`O-runtime-compat-pass` 必须新增或更新：

1. `TestSingleAttackerDPSLinkedEffectDispatcherKeepsLegacyOnHitPassives`
2. `TestSingleAttackerDPSLinkedEffectDispatcherKeepsEveryNAndStacks`
3. `TestSingleAttackerDPSLinkedEffectDispatcherKeepsPhantomHitCopyRules`
4. `TestSingleAttackerDPSLinkedEffectPriorityStableByInputOrder`
5. `TestSingleAttackerDPSBlocksUnsupportedLinkedEffectTrigger`

`O-target-side-pass` 必须新增：

1. `TestSingleAttackerDPSTargetOwnedOnDamageTakenRetaliates`
2. `TestSingleAttackerDPSTargetOwnedRetaliationDoesNotRecurse`
3. `TestSingleAttackerDPSAttackerOwnedPhysicalDamageAddsTargetArmorShredStack`
4. `TestSingleAttackerDPSTargetArmorShredAffectsNextPhysicalHit`
5. `TestSingleAttackerDPSBlocksInvalidOwnerRoleOrTargetRole`

`O-modifier-spell-pass` 必须新增：

1. `TestSingleAttackerDPSIncomingDamageModifierAppliesBeforeTimeline`
2. `TestSingleAttackerDPSIncomingCritOnlyModifierRequiresCritContext`
3. `TestSingleAttackerDPSLinkedEffectCanDispatchSyntheticSpellHit`
4. `TestSingleAttackerDPSPhantomHitDoesNotCopySpellProc`

回归 tests 至少覆盖名称包含：

```text
SingleAttackerDPS
Canonical
Phantom
Energized
Charge
```

## 15. 验证命令

### Wasm targeted

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./internal/runtime -run "LinkedEffect|OwnerRole|DamageModifier|SpellHit|SingleAttackerDPS|Canonical|Phantom|Energized|Charge" -count=1
```

### Wasm full

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./...
go run ./cmd/bench
```

### TinyGo / Node smoke

只在 runtime compat 和 target-side tests 通过后运行：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
node .\scripts\smoke-node.mjs
```

如 TinyGo 不在 PATH，优先使用仓内 `.tools` 路径，不要把问题直接归因到本机缺工具。

### Governance

本文新增或任务映射调整后，在 `C:\project\damage_wasm_dev` 运行：

```powershell
node tools/task-governance/cli.mjs rebuild
node tools/task-governance/cli.mjs docs planning-validation-milestones
```

## 16. Cursor Prompt：O1 Wasm Runtime Compat

后续进入编码会话时，GPT/Codex 应先按实际代码状态修订本模板，再启动 Cursor。Cursor 只负责编码，GPT/Codex 负责 diff review 和最终验证。

```text
目标：
在 V2 single_attacker_dps 中引入 owner-aware / event-context-aware linked effect dispatcher 的第一阶段兼容实现。保持现有 ADC on-hit、every-N、stack、DoT、energized、phantom-hit 行为不退化，同时把旧 processAttackPassives 收敛为基于 dpsCombatEventContext 的 dispatcher。不要实现 target-side 反甲/黑切、damage_modifier、真实卢登或 web/backend 接入。

允许写入范围：
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go

只读参考：
- C:\project\damage_wasm_dev\文档记录\详细设计\最小验证\V2-BatchO-单攻击方DPS事件化联动机制计划.md
- C:\project\damage_wasm_dev\文档记录\详细设计\最小验证\V2-BatchK-单攻击方DPS收口与鬼索幻影命中计划.md
- C:\project\damage_wasm_dev\文档记录\详细设计\最小验证\V2-BatchN-单攻击方DPS普攻充能阈值触发计划.md

非目标：
- 不实现完整 1v1、主动技能 rotation、Web 页面、Backend seed、真实装备发布或 wasm artifact 同步。
- 不把联动主轴改成 type 管理；type 只作为 matcher 条件。
- 不为卢登、黑切、反甲、兰顿写装备专用 if 分支。
- 不让 phantom-hit 复制 spell proc、retaliation、damage_modifier 或 DoT tick。

实现要求：
1. 在 model/types.go 中为 DPSPassiveEffectV2 增加 ownerRole、priority、trigger 字段；新增 DPSPassiveTriggerSpecV2 / DPSPassiveTriggerMatcherV2，避免复用输出 DTO DPSPassiveTriggerV2。
2. 保留旧 TriggerKind 字段和旧 JSON 兼容。旧 TriggerKind 空值或 on_basic_attack_hit 必须等价于 ownerRole=attacker + event=on_basic_attack_hit。
3. 在 dps_driver.go 中新增 internal dpsCombatEventContext 和 dpsDamageApplication。
4. 修改 DPS applyDamage，使它返回 damage application，同时保持现有 damageTimeline、damageBySource、damageByType、targetHpTimeline 和 kill 标记语义。
5. 新增 dispatchDPSLinkedEffects 或等价函数，负责 owner/event/matcher/priority/originalIndex 过滤和排序。
6. processAttackPassives 只能作为旧入口包装器存在，内部要构造 on_basic_attack_hit context 并调用 dispatcher。
7. every-N、next_basic_attack_after_state、energized_charge_and_consume、stat_modifier_always_on、pre_enabled_state_modifier、phantom_hit_on_hit_repeat 必须保持旧语义。
8. 同 priority 下必须按 resolvedSnapshot.passiveEffects 原始顺序稳定执行。
9. 新增 tests 证明 legacy on-hit passives 不迁移 JSON 也能通过，并证明 priority/input-order 稳定。

验证命令：
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./internal/runtime -run "LinkedEffect|SingleAttackerDPS|Canonical|Phantom|Energized|Charge" -count=1
go test ./...
go run ./cmd/bench

停止条件：
- 如果为了通过旧 tests 需要删除或弱化现有 blocked 校验，停止并报告。
- 如果 target-side ownerRole、damage_modifier 或 spell rotation 成为 O1 必需项，停止并报告，不要扩大范围。
- 如果 output DTO 必须新增字段才能解释 O1 结果，先给字段建议并停止，等待 GPT/Codex review。
- 如果 CodeGraph 或 tests 暴露 dps_driver 与 generic runtime 触发链语义冲突，保留 diff 并报告，不要继续堆补丁。

回报格式：
- 改动文件列表。
- 新增字段和兼容映射。
- dispatcher 调用路径摘要。
- 新增/更新 tests。
- 已执行命令和结果。
- blocked 或 residual risk。
```

## 17. Cursor Prompt：O2 Target-Side Effects

只有 O1 通过后才允许执行。

```text
目标：
在 V2 single_attacker_dps linked effect dispatcher 上实现 target-side ownerRole 和 targetRole operation 的最小机制证明。覆盖反甲式 target-owned on_damage_taken retaliation，以及黑切式 attacker-owned physical on_damage_dealt 后给 target 叠 armor shred stack。不要实现 damage_modifier、真实装备 seed、web/backend 接入或完整技能 rotation。

允许写入范围：
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go

实现要求：
1. ownerRole=target 的 passive 可以匹配基础普攻 damage 后的 on_damage_taken event。
2. operation targetRole=attacker 的 damage 能记录为对 attacker 的 retaliation evidence；若当前 DPS 输出没有 attacker HP timeline，至少新增清晰的 retaliation/effect evidence，不能把反伤计入 target damage total。
3. operation targetRole=target 的 stat_modifier 可以修改 target armor/magic_resist，并影响后续 damage mitigation。
4. 黑切 synthetic case 第一刀先按原 armor 结算，叠层后第二刀使用降低后 armor。
5. 加入 recursion guard，retaliation 不得无限触发 on_damage_taken/on_damage_dealt。

验证命令：
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./internal/runtime -run "OwnerRole|TargetOwned|Retaliation|ArmorShred|SingleAttackerDPS|Canonical|Phantom" -count=1
go test ./...
go run ./cmd/bench

停止条件：
- 如果必须重写 DPS 输出总伤害口径才能表示 attacker 受伤，停止并报告。
- 如果 target attr modifier 需要大范围改 attribute subsystem，停止并报告。
- 如果反伤或 armor shred 只能通过装备名特例实现，停止并报告。
```

## 18. Cursor Prompt：O3 Damage Modifier And Spell Dispatch

只有 O1/O2 通过后才允许执行。

```text
目标：
在 V2 single_attacker_dps linked effect dispatcher 上实现 damage_modifier 的最小 incoming percent modifier，并新增 synthetic on_spell_hit dispatch proof。该阶段只证明兰顿/卢登所需机制入口，不实现真实装备发布、不实现主动技能 rotation。

允许写入范围：
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go

实现要求：
1. 新增 operation kind=damage_modifier，支持 valuePhase=incoming、modifierMode=percent、targetRole=target。
2. damage_modifier 必须在 final damage 写 timeline 前生效，并在 effectBreakdown 中记录 modifier source、value、phase、raw/final 关系。
3. critOnly=true 若缺少 crit context，curve 必须 blocked 或 test 明确证明上下文可用，不允许用 expected crit 静默近似。
4. 新增 synthetic on_spell_hit event，matcher 可按 actionTypes/effectTags/damageTypes 匹配，并触发装备 passive damage。
5. phantom-hit 不复制 synthetic spell proc。

验证命令：
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./internal/runtime -run "DamageModifier|SpellHit|LinkedEffect|SingleAttackerDPS|Canonical|Phantom" -count=1
go test ./...
go run ./cmd/bench

停止条件：
- 如果必须新增主动技能 rotation 才能证明 on_spell_hit，停止并报告，保留 synthetic dispatcher proof。
- 如果 damage_modifier 需要改通用 runtime pipeline，停止并报告。
- 如果 critOnly 无法解释 expected crit 事件，停止并报告，不要近似实现兰顿。
```

## 19. 完成标准

Batch O 全部完成必须同时满足：

1. `O-contract-pass`：本文字段、event、owner、phase、排序、停止条件被执行会话采用。
2. `O-runtime-compat-pass`：旧 ADC attacker-side on-hit、stack、DoT、energized、phantom-hit tests 不退化；新的 dispatcher tests 通过。
3. `O-target-side-pass`：反甲 synthetic target-owned retaliation 和黑切 synthetic target armor shred 通过。
4. `O-modifier-spell-pass`：兰顿式 incoming damage_modifier synthetic proof 和卢登式 on_spell_hit dispatch proof 通过。
5. `go test ./...` 和 `go run ./cmd/bench` 通过。
6. 若构建 wasm artifact，TinyGo build 和 Node smoke 通过。
7. 测试记录明确哪些是真实数据闭环，哪些只是 synthetic mechanism proof。

如果只完成 O1，不得宣称 DPS 已完整支持 target-side 装备或技能触发装备。若 O3 只完成 synthetic spell dispatch，不得宣称页面已经支持卢登真实技能命中。

## 20. 残余风险

1. DPS 目前没有主动技能 rotation；`on_spell_hit` 的真实用户流需要后续单独定义显式技能事件或 rotation 边界。
2. target-side retaliation 如果要真实影响攻击者存活，需要扩展输出口径；本批可先证明 evidence，但不能混入 target damage total。
3. 兰顿这类 crit damage modifier 依赖 crit context；当前 expected crit 语义可能不足以表达“只降低暴击部分”。
4. 黑切 armor shred 会让 target attrs 与 `state.armor` / `state.magicResist` 快照脱节，必须通过 tests 防止只改 evidence 不改实际 mitigation。
5. owner-aware dispatcher 会增加同一 damage event 的触发面，必须用 recursion guard 和 `procScope` 防止无限链。
6. 后续 backend/web 投影若不能保留新字段，Wasm synthetic pass 不能等价为 live pass。
