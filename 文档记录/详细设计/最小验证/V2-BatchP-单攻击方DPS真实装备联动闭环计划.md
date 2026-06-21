TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-06-06

# V2 Batch P 单攻击方 DPS 真实装备联动闭环计划

关联概要：[验证里程碑V2.md](../../概要设计/验证里程碑V2.md)

关联总方案：[V2-单攻击方DPS协议与开发计划.md](./V2-单攻击方DPS协议与开发计划.md)

前置机制：[V2-BatchO-单攻击方DPS事件化联动机制计划.md](./V2-BatchO-单攻击方DPS事件化联动机制计划.md)

## 1. 文档边界

本文是 Batch P 的执行真源，不是测试记录。当前文档编写会话只允许维护本文和任务治理映射，不新增 runtime、backend、web、seed 或 DB 数据改动。

Batch P 的目标不是继续证明 Wasm synthetic case，而是把 Batch O 已经完成的 owner-aware / event-context-aware passive 机制接进真实装备、真实页面输入和 published bundle 验证链路。

Batch O 只能说明 `single_attacker_dps` runtime 能理解以下机制形状：

1. `DPSPassiveEffectV2.ownerRole`
2. `DPSPassiveEffectV2.priority`
3. `DPSPassiveEffectV2.trigger`
4. `DPSPassiveOperationV2.targetRole`
5. `DPSPassiveOperationV2.valuePhase`
6. `DPSPassiveOperationV2.critOnly`
7. `damage_modifier`
8. target-owned `on_damage_taken`
9. attacker-owned `on_damage_dealt`

Batch P 必须证明这些字段能从真实装备配置进入 Web 页面，再进入 Wasm 输入，并在 Wasm 输出中产生可导出的结果。缺少真实装备配置、缺少 target equipment 页面输入、缺少 published bundle 证据或缺少导出 JSON 证据时，只能算 runtime ready，不能算 Batch P 完成。

## 2. 当前事实

以下事实来自 2026-06-06 当前 worktree 核对：

1. `C:\project\damage_wasm_dev` 当前 `wasm/dev` 已有 Batch O runtime 提交，最新本地提交为 `85c9e68 feat: 联动机制调整`。
2. `C:\project\damage_backend_dev` 和 `C:\project\damage_web_dev` 当前没有对应 Batch O 的未提交改动。
3. Wasm `SingleAttackerDPSInputV2` 当前只有全局 `targetSnapshot` 和每条 curve 的攻击者侧 `selection.equipmentSet` / `resolvedSnapshot.equipmentSet`，没有独立 `targetEquipmentSet`。
4. Web `tinygoV2DpsAdapter.ts` 当前会从 `skill.mechanicsConfig.dpsPassiveEffects` 读取 passive，并 cast 成 `V2DpsPassiveEffect` 透传，额外字段不会被主动裁掉。
5. Web `V2DpsPassiveEffect` / `V2DpsPassiveOperation` 类型声明尚未显式列出 Batch O 新字段；这不会立刻破坏透传，但会让后续页面展示、编辑和校验缺少类型约束。
6. Web DPS 页面当前能选择攻击者装备，不能选择目标装备；因此反甲、兰顿等目标侧装备无法从页面真实进入 Wasm。
7. Web admin 技能编辑页当前仍有 `mechanicsConfig JSON` 文本域，结构化编辑区主要围绕 `mechanicsConfig.triggers`，没有面向 `dpsPassiveEffects` 的结构化编辑或字段摘要。
8. Backend `PostgresWriteStore` 对 `mechanicsConfig` 的主校验主要是 object、`version=1` 和 `triggers` 数组；已有 `dpsPassiveEffects` 历史数据能通过发布。后端主代码未发现会裁剪 `ownerRole`、`trigger`、`targetRole` 等新字段的 DTO 白名单。
9. 真实装备配置仍需要通过 seed/import/publish 或后台编辑进入 backend DB，再由 published bundle 给 Web 和 Wasm 使用；不能把 Wasm 单测里的 synthetic passive 当成真实装备已接入。

## 3. 问题定义

Batch O 之后存在两个不同层面的结论：

1. **兼容旧链路**：不改 Web/Backend 时，旧 DPS 页面和旧数据不会因为 Batch O runtime 新字段而坏。
2. **真实装备闭环**：要验证反甲、黑切、兰顿这类装备，必须让真实装备配置、目标装备选择、Web adapter 投影、Wasm 输入和页面导出全部对齐。

Batch P 解决第二个问题。

当前真实链路缺口如下：

```text
current user flow:
select attacker hero
-> select attacker equipmentSet
-> web adapter resolves attacker item passives
-> wasm single_attacker_dps
-> page renders damage timeline / export JSON

missing for target-side equipment:
select target equipmentSet
-> target stats merge into targetSnapshot
-> target item skillRefs resolve dpsPassiveEffects
-> target-owned passiveEffects enter resolvedSnapshot
-> ownerRole=target + on_damage_taken / damage_modifier execute
-> page/export show target equipment, target passive, retaliation/mitigation evidence
```

## 4. 目标

Batch P 分成六个 gate。可以分多轮 Cursor 执行，但最终完成必须全部闭环。

| Gate | 目标 | 可单独通过 |
| --- | --- | --- |
| `P-contract-pass` | 固定 target equipment 输入契约、Web 展示/编辑要求、真实装备数据要求、验收命令和 stop condition | 是 |
| `P-wasm-contract-pass` | Wasm DTO 与 validation 支持 `targetEquipmentSet` / `targetEnabledPassiveEffects` / `targetEquipmentStats`，兼容旧输入 | 是 |
| `P-web-target-equipment-pass` | Web DPS 页面能选择目标装备，adapter 能把 target-owned passives 投影进 Wasm，导出 JSON 可见 | 否，依赖 contract |
| `P-attacker-onhit-regression-pass` | 已支持的攻击者侧攻击特效装备继续从真实配置进入页面和 Wasm，新增 target equipment 后不退化 | 否，依赖 web |
| `P-real-data-black-cleaver-thornmail-pass` | 黑切和反甲至少两个真实装备配置通过 seed/import/publish 进入 current bundle，并能在页面触发 | 否，依赖 wasm/web |
| `P-randuin-crit-policy-pass` | 兰顿暴击减伤要么真实通过，要么以明确 blocked 状态记录缺少 crit event context；不得伪造通过 | 否，依赖前序 |
| `P-live-pass` | 当前 backend + web + wasm artifact 上跑通完整页面用户流，导出 JSON 能复核目标装备联动结果 | 否，依赖前序 |

只完成 `P-wasm-contract-pass` 或 synthetic tests 时，不得宣称 Batch P 完成。

## 5. 非目标

1. 不恢复完整 1v1 runtime，不实现敌方主动攻击、敌方 AI、行动队列编辑器或技能 rotation。
2. 不为某件装备写页面或 runtime 特例，例如 `if itemId == 3075`。
3. 不让 Web 计算业务伤害；Web 只负责从 published bundle 投影 Wasm 输入并展示 Wasm 输出。
4. 不把 synthetic passive 测试当成真实装备配置验收。
5. 不直接手改 live DB 作为交付；真实数据必须走 seed/import/publish 或后台编辑加发布，并留下可复核记录。
6. 不把 `mechanicsConfig.triggers` 和 `mechanicsConfig.dpsPassiveEffects` 混成一个临时 schema；DPS passive 仍以 `dpsPassiveEffects` 为当前单攻击者 DPS 入口。
7. 不在本批完整实现所有坦克装备。最小真实装备闭环锁定黑切和反甲；兰顿按暴击上下文成熟度决定真实通过或 blocked。
8. 不要求 admin 页面一次性做完整 nested form builder；但必须能显示、保留、编辑或至少安全校验 `dpsPassiveEffects` JSON，避免配置字段不可见。
9. 不要求本批把所有攻击特效装备都补成真实数据闭环；但已完成的攻击者侧攻击特效装备必须纳入回归，不能因为 target equipment 改造而退化。

## 6. 输入契约

### 6.1 Wasm DTO

优先保持旧输入兼容。新增字段全部 `omitempty`。

```go
type DPSCurveSelectionV2 struct {
    EquipmentSet                 []string `json:"equipmentSet"`
    EnabledPassiveEffects        []string `json:"enabledPassiveEffects"`
    TargetEquipmentSet           []string `json:"targetEquipmentSet,omitempty"`
    TargetEnabledPassiveEffects  []string `json:"targetEnabledPassiveEffects,omitempty"`
}

type DPSResolvedSnapshotV2 struct {
    EquipmentSet                 []string `json:"equipmentSet"`
    EquipmentStats               map[string]float64 `json:"equipmentStats"`
    EnabledPassiveEffects        []string `json:"enabledPassiveEffects"`

    TargetEquipmentSet           []string `json:"targetEquipmentSet,omitempty"`
    TargetEquipmentStats         map[string]float64 `json:"targetEquipmentStats,omitempty"`
    TargetEnabledPassiveEffects  []string `json:"targetEnabledPassiveEffects,omitempty"`

    PassiveEffects               []DPSPassiveEffectV2 `json:"passiveEffects,omitempty"`
}
```

语义：

1. `equipmentSet` 继续表示攻击者装备。
2. `targetEquipmentSet` 表示目标装备，只影响 `targetSnapshot`、target-side passive 解析和页面导出。
3. `enabledPassiveEffects` 继续表示攻击者侧启用 passive。
4. `targetEnabledPassiveEffects` 表示目标装备带来的 target-owned passive。
5. `resolvedSnapshot.passiveEffects` 仍是统一 passive 列表；每个 passive 通过 `ownerRole` 区分攻击者或目标。
6. 如果 `targetEnabledPassiveEffects` 非空，validation 必须要求对应 passive 存在于 `resolvedSnapshot.passiveEffects`。
7. 如果 `selection.targetEquipmentSet` 非空，`resolvedSnapshot.targetEquipmentSet` 必须同值；`targetEquipmentStats` 必须存在，允许为空 object。
8. 旧输入不带 `targetEquipmentSet` 时行为必须保持完全兼容。

### 6.2 Web 类型

`web/src/engine/tinygoV2DpsAdapter.ts` 必须显式补齐 Batch O / Batch P 字段，至少包括：

```ts
export type V2DpsPassiveTrigger = {
  event?: string;
  matcher?: {
    damageType?: string | string[];
    actionTypes?: string[];
    effectTags?: string[];
    sourceType?: string | string[];
    procScope?: string;
  };
};

export type V2DpsPassiveEffect = {
  passiveId?: string;
  effectId?: string;
  sourceCategory?: string;
  sourceId?: string;
  sourceType?: string;
  ownerRole?: 'attacker' | 'target' | (string & {});
  priority?: number;
  trigger?: V2DpsPassiveTrigger;
  triggerKind?: string;
  procScope?: string;
  operations?: V2DpsPassiveOperation[];
};

export type V2DpsPassiveOperation = {
  kind: string;
  targetRole?: 'attacker' | 'target' | (string & {});
  valuePhase?: 'raw' | 'final' | (string & {});
  critOnly?: boolean;
  // keep existing damage / stack / stat / dot / phantom fields
};
```

类型声明不是单独为了编译好看。它承担三件事：

1. 防止后续页面展示和导出遗漏新字段。
2. 让 target-owned passive 在 adapter 中有明确语义。
3. 给 admin JSON 编辑/摘要组件提供字段名来源。

### 6.3 真实装备配置形状

真实装备技能仍挂在 item-owned skill 上，item 通过 `skillRefs` 指向该 skill。

黑切最小配置：

```json
{
  "skillId": "item_3071_black_cleaver_carve_dps_v2",
  "ownerType": "item",
  "ownerId": "3071",
  "mechanicsConfig": {
    "version": 1,
    "triggers": [],
    "dpsPassiveEffects": [
      {
        "passiveId": "item_3071_black_cleaver_carve_dps_v2",
        "sourceCategory": "item_passive",
        "sourceType": "item",
        "sourceId": "3071",
        "ownerRole": "attacker",
        "trigger": {
          "event": "on_damage_dealt",
          "matcher": {
            "damageType": "physical"
          }
        },
        "priority": 0,
        "operations": [
          {
            "kind": "add_stack",
            "targetRole": "target",
            "stackKey": "black_cleaver_carve",
            "maxStacks": 5,
            "durationMs": 6000,
            "refreshMode": "refresh"
          },
          {
            "kind": "stat_modifier",
            "targetRole": "target",
            "attrKey": "armor",
            "modifierMode": "percent_add",
            "value": -0.04,
            "perStack": true,
            "stackKey": "black_cleaver_carve"
          }
        ]
      }
    ]
  }
}
```

反甲最小配置：

```json
{
  "skillId": "item_3075_thornmail_thorns_dps_v2",
  "ownerType": "item",
  "ownerId": "3075",
  "mechanicsConfig": {
    "version": 1,
    "triggers": [],
    "dpsPassiveEffects": [
      {
        "passiveId": "item_3075_thornmail_thorns_dps_v2",
        "sourceCategory": "item_passive",
        "sourceType": "item",
        "sourceId": "3075",
        "ownerRole": "target",
        "trigger": {
          "event": "on_damage_taken",
          "matcher": {
            "procScope": "real_basic_attack_only"
          }
        },
        "priority": 0,
        "operations": [
          {
            "kind": "damage",
            "targetRole": "attacker",
            "source": "thornmail_thorns",
            "damageType": "magic",
            "amount": 0
          }
        ]
      }
    ]
  }
}
```

注意：上述数值只固定字段形状，不固定真实 LoL 数值。Cursor 执行真实数据 gate 时必须从当前项目认可的数据源确认 3071、3075、3143 的版本、文本和数值；不能直接把本文示例数值当成最终数据。

### 6.4 其他攻击特效装备覆盖策略

Batch P 对“其他有攻击特效的装备”采用三层口径：

1. **机制覆盖**：只要装备能表达为 `ownerRole=attacker`、`on_basic_attack_hit`、`on_damage_dealt`、`on_hit`、`repeat_on_hit`、`apply_dot`、`add_stack`、`damage` 或 `damage_modifier`，都必须走 Batch O/P 的统一 linked-effect 机制，不允许另写装备专用分支。
2. **回归必测**：Batch D/K/N/M 已经覆盖或发布过的攻击者侧攻击特效装备，本批必须作为 regression，不得因 target equipment 字段、passive 合并顺序或页面导出改造而退化。
3. **真实数据新增**：本批新增真实数据闭环不追求全量 attack-effect item。最小新增锁定黑切和反甲；其他攻击特效装备按后续数据批次扩展，但必须复用同一 contract。

本批 regression 至少覆盖以下类别：

| 类别 | 代表机制 | Batch P 要求 |
| --- | --- | --- |
| 固定 on-hit 伤害 | Recurve Bow 类、旧 Batch D ADC item passive | 仍从真实 item skillRefs / dpsPassiveEffects 进入 resolvedSnapshot |
| 当前生命值/最大生命值 on-hit | 破败等 | 结果不因 target equipment 字段引入而变化；目标装备护甲/魔抗变化应自然影响最终伤害 |
| 每 N 次/叠层触发 | 海妖、薇恩 W 类 | passive 顺序和 trigger count 不退化 |
| 鬼索幻影命中 | `phantom_hit_on_hit_repeat` | 只复制 copyable attacker on-hit，不复制 target retaliation / modifier |
| 充能攻击特效 | 电刀/火炮/岚切类 Batch N 语义 | charge / consume / proc 证据仍能导出 |
| 咒刃/下一次普攻 | Batch L 语义 | target equipment 合入后不改变 ready state 消费顺序 |

如果真实 published bundle 当前缺少某个攻击特效装备配置，本批不需要为了它临时补数据；但测试记录必须区分：

1. `regression_pass_existing_real_data`：当前已有真实配置并通过页面 + Wasm 证明。
2. `not_in_current_bundle`：当前 published bundle 没有该真实装备配置，不能作为通过或失败。
3. `runtime_supported_synthetic_only`：runtime 支持，但真实数据未发布，不能算真实装备闭环。

## 7. Wasm 实现要求

### 7.1 写入范围

允许写入：

1. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go`
2. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver.go`
3. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go`
4. 必要时补充同目录 test helper。

不允许写入：

1. Web 页面或 adapter。
2. Backend 代码或 DB。
3. seed/import/publish 数据。
4. 旧 Rust/Katarina crate。

### 7.2 DTO 与 validation

1. 在 `DPSCurveSelectionV2` 和 `DPSResolvedSnapshotV2` 增加 target equipment 字段。
2. `validateDPSCurve` 必须检查：
   - `selection.targetEquipmentSet` 与 `resolvedSnapshot.targetEquipmentSet` 一致。
   - `targetEquipmentSet` 非空时 `targetEquipmentStats` 存在。
   - `targetEnabledPassiveEffects` 中的 id 必须能在 `resolvedSnapshot.passiveEffects` 中通过 `passiveId/effectId/sourceId` 找到。
   - `targetEnabledPassiveEffects` 对应 passive 的 `ownerRole` 为空或 `attacker` 时必须 blocked，避免目标装备被误当攻击者装备执行。
3. `enabledDPSPassives` 必须合并攻击者侧和目标侧 enabled passive，并保持稳定顺序：
   - 先按 `resolvedSnapshot.passiveEffects` 原始顺序收集。
   - 只启用出现在 `enabledPassiveEffects` 或 `targetEnabledPassiveEffects` 的 passive。
   - 同一个 passive 不能重复启用。
4. 旧输入只用 `enabledPassiveEffects` 时结果不得变化。

### 7.3 Target stats 与 target modifiers

1. `targetSnapshot` 是 Wasm 计算目标属性的最终输入；如果 Web 已把目标装备属性并入 `targetSnapshot`，Wasm 不再重复按 itemId 加属性。
2. `targetEquipmentStats` 只作为导出、校验和可解释信息，不作为 runtime 重新加属性的来源。
3. 黑切这类 target-side armor shred 必须通过 `targetRole=target` 的 stack/status/modifier 改变后续伤害结算，不允许直接改 `damageTimeline` 或硬编码 item source。
4. 同一 hit 内如果黑切由物理伤害触发，栈对“当前造成这次物理伤害”是否生效必须在测试中固定。推荐：on_damage_dealt 后添加的 shred 从下一次 damage event 生效，避免 retroactive 修改当前 damage。

### 7.4 Retaliation 与 attacker damage evidence

1. 反甲 target-owned `on_damage_taken` 必须对 attacker 造成 damage operation。
2. Wasm 输出必须有可复核证据，至少包含：
   - `damageBySource["thornmail_thorns"]`
   - attacker 侧受到伤害的 timeline 或 source map
   - passive trigger timeline 中记录 target-owned passive
3. 反伤不得减少 target HP。
4. phantom-hit 不得复制反甲反伤。

### 7.5 Randuin / critOnly

兰顿不能靠假字段通过。只有满足以下条件才允许进入 `P-randuin-crit-policy-pass`：

1. DPS damage event context 能明确标记当前 damage 是否暴击。
2. `damage_modifier` 支持 `critOnly=true` 且只作用于暴击 damage event。
3. Web export 能看到 crit policy、crit result 或 expected crit contribution 的解释字段。

如果当前实现无法满足，Batch P 必须把兰顿记录为 `blocked_by_missing_crit_event_context`，并在测试记录里说明原因。不得把普通 incoming percent modifier 当作兰顿通过。

## 8. Web 实现要求

### 8.1 写入范围

允许写入：

1. `C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.ts`
2. `C:\project\damage_web_dev\web\src\pages\WasmValidationV2DpsPage.tsx`
3. 与该页面直接相关的类型、测试或样式文件。
4. 如需 admin mechanicsConfig 可视化，允许最小写入 `web\src\pages\admin\resources\skills\**`。

不允许写入：

1. 与 DPS 页面无关的通用 UI 大重构。
2. Backend API 契约，除非实际发现字段被裁剪。
3. Wasm runtime。

### 8.2 Target equipment 页面输入

1. DPS 页面必须增加目标装备选择控件，默认空。
2. 目标装备选择应独立于攻击者装备曲线。推荐作为全局 target setup，应用到当前页面所有 curve。
3. 页面必须显示当前 target equipment set，至少展示 item id 和名称。
4. 目标装备变化后，`targetSnapshot` 和每条 curve 的 `resolvedSnapshot.targetSnapshot` 必须更新。
5. 目标装备属性必须来自 published bundle 的 item stats，不允许页面写固定数值。

### 8.3 Adapter 投影

1. 新增 `listV2DpsTargetEquipmentOptions(bundle)`，最小包含 3075 反甲、3143 兰顿，以及后续 tank defensive item 候选；不应复用只面向 ADC 成装的过滤器。
2. 新增 `targetPassiveIdsForEquipment(bundle, targetItemIds)` 或复用 item skillRefs 逻辑，但必须区分 target side。
3. 新增 `resolveDpsTargetItemPassiveEffects(bundle, targetItemIds, passiveIds)`：
   - 只读取 ownerType=`item` 且 ownerId 属于 `targetEquipmentSet` 的 skill。
   - 只接受 `ownerRole=target` 的 passive。
   - 如果 target item skill 没有 `ownerRole=target`，页面应给 preflight blocked reason，不应偷偷当 attacker passive。
4. `resolvedSnapshot.passiveEffects` 合并攻击者 passive 与目标 passive。
5. `selection.targetEnabledPassiveEffects` 和 `resolvedSnapshot.targetEnabledPassiveEffects` 必须写入对应 passive id。
6. 导出 JSON 必须保留 target equipment、target enabled passives、target passive trigger/operation 原文。

### 8.4 页面展示与导出

页面必须新增或扩展以下可视化信息：

1. Target setup：目标英雄/假人、目标装备、目标基础属性、目标装备属性。
2. Passive summary：按 ownerRole 分组展示 attacker passives 和 target passives。
3. Trigger evidence：展示 target-owned passive 触发次数、source、ownerRole、event。
4. Damage evidence：展示 target damage 与 attacker retaliation damage 的区别。
5. Export JSON：不得只导出攻击者装备；必须导出 `targetEquipmentSet`、`targetEnabledPassiveEffects` 和 target-owned passive detail。

### 8.5 Admin mechanicsConfig 编辑

Batch P 不要求完整 nested form builder，但不能继续让 `dpsPassiveEffects` 完全不可见。最小要求：

1. 技能编辑弹窗的 mechanicsConfig 区域必须能保留 `dpsPassiveEffects` 原文。
2. 当 mechanicsConfig 中存在 `dpsPassiveEffects` 时，页面应显示一个 DPS passive 摘要，列出 `passiveId`、`ownerRole`、`trigger.event`、operation kinds。
3. JSON 文本域必须仍可编辑完整 `dpsPassiveEffects`。
4. 如果做结构化编辑，只允许做 `dpsPassiveEffects` 的局部 JSON 编辑器，不要在 Batch P 里扩成完整机制编辑器。
5. 保存前至少检查 JSON object、`version=1`、`triggers` 数组存在；如果 `dpsPassiveEffects` 存在但不是数组，应在前端给出错误。

## 9. Backend 与数据发布要求

### 9.1 Backend 代码

Backend 主代码只有在实际发现以下问题时才允许改：

1. `mechanicsConfig.dpsPassiveEffects` 新字段被保存、读取或发布时裁掉。
2. `mechanicsConfig` 校验阻止 `ownerRole`、`trigger`、`targetRole` 等字段通过。
3. published bundle 缺少 item skillRefs 或 item-owned skill 数据。

如果没有这些问题，backend 只需要补测试或记录，不要为了“看起来跨仓都有改动”而改代码。

### 9.2 Backend 测试

建议补一个最小保留测试：

1. 创建或导入 item-owned skill，`mechanicsConfig.dpsPassiveEffects[0].ownerRole=target`。
2. 发布 bundle。
3. 断言 published skill 中仍存在：
   - `dpsPassiveEffects[0].ownerRole`
   - `dpsPassiveEffects[0].trigger.event`
   - `dpsPassiveEffects[0].operations[0].targetRole`

如果现有 integration test 已能覆盖相同事实，可只更新测试记录，不强制新增重复测试。

### 9.3 数据配置

Batch P 最小真实数据：

1. 黑切 `3071`：攻击者装备，物理伤害后给目标叠 armor shred。
2. 反甲 `3075`：目标装备，受击后反向对攻击者造成 magic retaliation。
3. 兰顿 `3143`：目标装备，暴击减伤；如果 crit event context 未准备好，必须发布为 blocked/gap，不进入 ok 验收。

数据写入要求：

1. 每个装备 item 必须有 `skillRefs` 指向对应 item-owned skill。
2. 每个 item-owned skill 必须有 `mechanicsConfig.version=1` 和 `triggers=[]`。
3. DPS 专用联动必须写入 `mechanicsConfig.dpsPassiveEffects`。
4. seed dry-run 必须先通过，再 import/publish。
5. current bundle 必须能在 Web 页面拉到这些 item skill 和 mechanicsConfig。

## 10. 验收矩阵

### 10.1 Wasm 单元与构建

在 `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2` 运行：

```powershell
go test ./internal/runtime -run "TargetEquipment|TargetOwned|Thornmail|BlackCleaver|Randuin|LinkedEffect|DamageModifier|SingleAttackerDPS" -count=1
go test ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
node .\scripts\smoke-node.mjs
node .\scripts\bench-node.mjs --iterations 10 --warmup 2
```

最低测试断言：

1. 旧输入不带 target equipment 时输出不变。
2. `targetEnabledPassiveEffects` 缺失对应 passive 时 blocked。
3. target equipment passive ownerRole 不是 `target` 时 blocked。
4. 黑切物理伤害后叠 target armor shred，后续 hit 伤害变化。
5. 反甲在目标受击后对 attacker 造成 retaliation damage。
6. phantom-hit 不复制反甲 retaliation。
7. 兰顿如果未实现 crit context，测试必须证明 blocked reason，而不是假通过。
8. 已有攻击者侧 on-hit / every-N / phantom-hit / energized / next-basic-attack regression 不退化。

### 10.2 Web 构建与页面验证

在 `C:\project\damage_web_dev\web` 运行：

```powershell
npm run build
```

页面自动化验证必须覆盖：

1. 打开 V2 DPS 验证页。
2. 选择或确认当前游戏为 `lol`，版本为 current。
3. 选择一个攻击者英雄和可触发物理普攻的装备曲线。
4. 选择攻击者装备黑切。
5. 选择目标装备反甲。
6. 运行 Wasm DPS。
7. 导出 JSON，确认：
   - `selection.equipmentSet` 包含 `3071`。
   - `selection.targetEquipmentSet` 或等价字段包含 `3075`。
   - `resolvedSnapshot.passiveEffects` 中同时存在 `ownerRole=attacker` 的黑切 passive 和 `ownerRole=target` 的反甲 passive。
   - `curveResults` 中存在黑切叠层或 armor shred 证据。
   - `curveResults` 中存在 `thornmail_thorns` 反伤证据。
8. 页面上能看到 target equipment 和 target passive 摘要。
9. 对当前 published bundle 中已存在的攻击者侧攻击特效装备，至少复测破败、海妖、鬼索、充能类之一的页面导出，确认仍从真实配置进入 Wasm，而不是页面临时构造。

如果页面导出仍是剪贴板逻辑，继续使用 Playwright 拦截 `navigator.clipboard.writeText` 获取 JSON。

### 10.3 Backend / 发布验证

在 `C:\project\damage_backend_dev\server\data_manage` 运行：

```powershell
mvn test
```

发布验证必须证明：

1. item `3071` / `3075` 的 `skillRefs` 在 current bundle 中存在。
2. 对应 item-owned skills 在 current bundle 中存在。
3. `mechanicsConfig.dpsPassiveEffects` 保留 Batch P 新字段。
4. Web 从 `/api/games/lol/versions/current` 读取到的是包含这些配置的 current bundle。

### 10.4 Governance

在 `C:\project\damage_wasm_dev` 运行：

```powershell
node tools/task-governance/cli.mjs rebuild
node tools/task-governance/cli.mjs docs planning-validation-milestones
git diff --check
```

新计划和后续测试记录必须归属 `planning-validation-milestones`，`unassigned_docs` 必须为 0。

## 11. Cursor 执行约束

所有代码、脚本、配置和数据改动必须走 Cursor 协同流程。GPT/Codex 负责收敛范围、写 prompt、审 diff、跑测试和最终验收。

Cursor 通用停止条件：

1. 发现本文字段契约与当前源码冲突且无法小改兼容时，停止并回报。
2. 需要修改本文未列出的跨仓写入范围时，停止并回报。
3. 发现真实装备数值来源不明确时，停止并回报；不要猜数值。
4. 发现 backend publish 裁字段时，可以最小修 backend；如果修复范围超过保存/读取/发布 JSONB 保留，停止并回报。
5. 发现页面无法自动化验证导出 JSON 时，先尝试拦截 clipboard；仍失败再回报。

### 11.1 Cursor Prompt：Wasm Gate

```text
目标：实现 Batch P 的 Wasm DTO/validation/runtime 最小支持，让 target equipment passives 能进入 single_attacker_dps，并保持旧输入兼容。

允许写入：
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go

只读参考：
- C:\project\damage_wasm_dev\文档记录\详细设计\最小验证\V2-BatchP-单攻击方DPS真实装备联动闭环计划.md
- C:\project\damage_wasm_dev\文档记录\详细设计\最小验证\V2-BatchO-单攻击方DPS事件化联动机制计划.md

非目标：
- 不改 web/backend/seed/DB。
- 不实现完整 1v1 或技能 rotation。
- 不硬编码 itemId。

必须实现：
- targetEquipmentSet / targetEnabledPassiveEffects / targetEquipmentStats DTO。
- validation 规则。
- enabled passive 合并规则。
- target-owned passive execution 与旧输入兼容测试。
- 黑切/反甲 synthetic runtime tests。
- 兰顿 crit context 如果不足，必须 blocked，不准假通过。

验证：
- go test ./internal/runtime -run "TargetEquipment|TargetOwned|Thornmail|BlackCleaver|Randuin|LinkedEffect|DamageModifier|SingleAttackerDPS" -count=1
- go test ./...
- go run ./cmd/bench
```

### 11.2 Cursor Prompt：Web Gate

```text
目标：让 V2 DPS 页面支持 target equipment，并把 target-owned dpsPassiveEffects 从 published bundle 投影进 Wasm 输入、页面展示和导出 JSON。

允许写入：
- C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.ts
- C:\project\damage_web_dev\web\src\pages\WasmValidationV2DpsPage.tsx
- 与该页面直接相关的类型/测试/样式文件
- 如需 mechanicsConfig 摘要，最小写入 web\src\pages\admin\resources\skills\**

只读参考：
- C:\project\damage_wasm_dev\文档记录\详细设计\最小验证\V2-BatchP-单攻击方DPS真实装备联动闭环计划.md

非目标：
- 不改 Wasm runtime。
- 不改 backend API。
- 不让页面计算伤害。
- 不做完整 nested mechanicsConfig form builder。

必须实现：
- 显式补齐 V2DpsPassiveEffect / V2DpsPassiveOperation 新字段类型。
- 新增 target equipment 选择。
- target equipment stats 合入 targetSnapshot。
- target item-owned dpsPassiveEffects 解析，并只接受 ownerRole=target。
- 导出 JSON 包含 targetEquipmentSet、targetEnabledPassiveEffects、target passives。
- 页面显示 target equipment 和 ownerRole 分组 passive summary。
- admin mechanicsConfig 至少显示 dpsPassiveEffects 摘要并保留 JSON 可编辑。

验证：
- npm run build
- 使用 Playwright 跑 V2 DPS 页面，导出 JSON，确认 3075 target equipment 与 target-owned passive 进入 Wasm 输入。
```

### 11.3 Cursor Prompt：Data / Backend Gate

```text
目标：让黑切 3071 和反甲 3075 真实装备配置进入 current published bundle，并证明 backend 保存/发布不裁剪 Batch P 新字段。

允许写入：
- C:\project\damage_backend_dev 中与 seed/import/publish 或保留测试直接相关的文件
- C:\project\damage_wasm_dev\最小验证\** 中本批 seed/audit 文件
- C:\project\damage_wasm_dev\文档记录\测试记录\wasm\** 中本批测试记录
- 必要时 C:\project\damage_wasm_dev\db\task_doc_governance\task_rules.json

非目标：
- 不直接手改 live DB 作为交付。
- 不猜装备真实数值。
- 不为了跨仓有 diff 而改 backend 主代码。

必须实现：
- item 3071 skillRefs 指向黑切 DPS passive skill。
- item 3075 skillRefs 指向反甲 DPS passive skill。
- 两个 item-owned skill 的 mechanicsConfig.dpsPassiveEffects 包含 ownerRole/trigger/operations 新字段。
- seed dry-run/import/publish 或等价发布流程通过。
- current bundle 可查询到完整字段。
- 若兰顿 3143 不能真实通过，记录 blocked_by_missing_crit_event_context。

验证：
- mvn test
- 发布 current bundle 后从 Web 使用 /api/games/lol/versions/current 证明字段存在。
- 在 V2 DPS 页面导出 JSON 证明真实装备 passive 进入 Wasm 输入并产生结果。
```

## 12. 完成定义

Batch P 全部完成必须同时满足：

1. Wasm DTO、validation、runtime、tests 通过。
2. Web 页面能选择 target equipment。
3. Web adapter 能把 target-owned item passive 从 published bundle 投影进 `resolvedSnapshot.passiveEffects`。
4. 黑切真实装备配置从攻击者装备进入 Wasm 并产生 target armor shred 证据。
5. 反甲真实装备配置从目标装备进入 Wasm 并产生 attacker retaliation damage 证据。
6. 当前已存在真实配置的攻击者侧攻击特效装备完成 regression，至少覆盖破败、海妖、鬼索、充能类中的可用项。
7. 兰顿要么真实暴击减伤通过，要么明确 blocked，不能混入 ok。
8. Backend publish/current bundle 证明没有裁剪新字段。
9. 页面导出 JSON 可复核所有关键字段和结果。
10. 全流程验证命令记录到测试记录。
11. `planning-validation-milestones` 治理映射包含 Batch P 计划和测试记录，`unassigned_docs: 0`。

## 13. 风险与决策

1. **target equipment 是否每条 curve 独立**：本批推荐先做全局 target setup，应用到所有 curve。后续如需比较不同目标装备，再扩展成 per-curve target loadout。
2. **targetEquipmentStats 是否参与计算**：不直接参与。计算使用 `targetSnapshot`，`targetEquipmentStats` 用于解释和校验。
3. **黑切当前 hit 是否吃本次 shred**：推荐不吃，本次物理伤害后叠层，下一次 damage event 生效。
4. **反甲是否被 phantom-hit 复制**：不得复制。phantom-hit 只复制 copyable attacker on-hit。
5. **兰顿是否必须本批真实通过**：不是。兰顿必须被考虑，但如果 crit context 不足，应明确 blocked，不得伪造。
6. **Web admin 是否必须完整结构化编辑**：不是。Batch P 最小要求是可见、可保留、可 JSON 编辑、可摘要校验；完整表单另起批次。
7. **Backend 是否必须有代码 diff**：不是。真实要求是保存/发布不裁字段。如果现有 JSONB 透传已满足，backend 可只有测试或数据发布记录。
