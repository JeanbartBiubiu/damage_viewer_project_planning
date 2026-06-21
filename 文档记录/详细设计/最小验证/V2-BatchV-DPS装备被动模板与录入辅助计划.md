TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-06-14

# V2 Batch V DPS 装备被动模板与录入辅助计划

关联概要：[验证里程碑V2](../../概要设计/验证里程碑V2.md)

前置编辑器：[V2-BatchQ-2-DPS联动结构化编辑器计划](./V2-BatchQ-2-DPS联动结构化编辑器计划.md)

前置乘区：[V2-BatchR-DPS乘区与属性修饰平台计划](./V2-BatchR-DPS乘区与属性修饰平台计划.md)

前置暴击上下文：[V2-BatchT-DPS通用数值边界与暴击上下文计划](./V2-BatchT-DPS通用数值边界与暴击上下文计划.md)

前置装备引用契约：[V2-BatchU-0-DPS装备引用契约与Preflight硬化计划](./V2-BatchU-0-DPS装备引用契约与Preflight硬化计划.md)

前置发布检查：[V2-BatchU-3-Published契约检查与发布前Preflight计划](./V2-BatchU-3-Published契约检查与发布前Preflight计划.md)

来源分析：[V2-ADC随机组合机制头脑风暴与缺口分析](./V2-ADC随机组合机制头脑风暴与缺口分析.md)

## 1. 文档边界

本文是 Batch V 的详细设计和 Cursor 执行真源。目标是在不新增 Wasm runtime 机制、不改后端 DB schema 的前提下，补齐 Admin 录入 DPS 装备被动时最容易出错的模板和辅助能力。

当前 single-attacker DPS 主线的计算能力已经覆盖多类装备被动。下一步瓶颈不是 Wasm 不能算，而是数据录入人员需要手写或半手写 `mechanicsConfig.dpsPassiveEffects[]`，容易写错 `ownerRole`、`trigger.event`、`targetRole`、`critOnly`、`thresholdType`、`internalCooldownMs`、`bucketKey` 等契约字段。

本批只做 authoring 和 preflight 辅助。模板生成的是可编辑草稿形状，不是装备真实数值来源。真实装备数值、版本号、OCR、训练营 baseline 仍归数据录入与测试证据所有。

## 2. 当前事实

以下事实来自 2026-06-14 当前 worktree 核对：

1. `C:\project\damage_wasm_dev` 分支为 `wasm/dev`，本地 ahead 6，工作区干净。
2. `C:\project\damage_web_dev` 分支为 `web/dev`，本地 ahead 6，工作区干净。
3. `C:\project\damage_backend_dev` 分支为 `backend/dev`，本地 ahead 6，工作区干净。
4. `C:\project\damage_web_dev\web\src\components\skill-editor\SkillMechanicsConfigEditor.tsx` 已有 `onDpsPassiveEffectsChange`，能把修改后的 `dpsPassiveEffects` 写回 `mechanicsConfig`。
5. `SkillMechanicsConfigEditor.tsx` 已能编辑 `internalCooldownMs`，以及 operation 级 `bucketKey`、`priority`、`evidenceKey`、`valueSpec`、`conditions`。
6. `C:\project\damage_web_dev\web\src\components\skill-editor\skillModels.ts` 已有 `summarizeDpsPassiveEffects(root)`、`validateDpsPassiveEffects(root)` 和 `SkillDpsPassiveSummaryRow`。
7. `skillModels.ts` 的 `DPS_PASSIVE_OPERATION_KINDS` 当前未覆盖已由 Wasm 支持的 `execute_threshold` 和 `crit_context_modifier`，会造成 authoring 层误报 unknown operation。
8. `C:\project\damage_web_dev\web\src\pages\admin\resources\skills\modal.tsx` 已在技能表单里接入 `onDpsPassiveEffectsChange`。
9. `C:\project\damage_web_dev\web\src\pages\admin\resources\items\modal.tsx` 已有 `skillRefs structured`、`SkillRefSelector` 和已选 `skillRefs` 摘要。
10. `C:\project\damage_web_dev\web\src\pages\admin\resources\items\itemSkillRefsValidation.ts` 已能检查 referenced skill 的 `dpsPassiveEffects` 结构、`ownerRole` 分布和摘要。
11. `C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.ts` 已有 `buildPublishedContractDiagnostics(...)` 和 `execute_threshold` evidence projection。
12. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go` 的 `DPSPassiveOperationV2` 已包含 `critOnly`、`bucketKey`、`valueSpec`、`conditions`、`thresholdType`、`thresholdValue`、`checkTiming`、`internalCooldownMs` 等字段。
13. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_contract.go` 已定义 `damage_modifier`、`crit_context_modifier`、`phantom_hit_on_hit_repeat`、`execute_threshold` 等 operation kind。
14. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_validation.go` 已对 `execute_threshold` 的 `thresholdType`、`thresholdValue`、`checkTiming` 做 Wasm 侧 blocked 校验。

## 3. 目标

1. 在 Admin skill 编辑器中提供 DPS 装备被动模板库，支持一键新增常见 `dpsPassiveEffects[]` 草稿。
2. 支持对已有 passive 追加 operation 模板，避免为小改动复制整段 JSON。
3. 模板输出必须优先使用当前 Wasm/Web 已支持的字段，不发明新 runtime schema。
4. 模板输出必须保留 unknown JSON 字段，不破坏现有手写配置和未来扩展字段。
5. 修正 authoring 层 operation kind 白名单，使 `execute_threshold` 和 `crit_context_modifier` 不再被误报为 unknown。
6. 装备 item 页保持“引用 skill + 摘要 + 校验”的边界，不在 item 表单直接编辑 `dpsPassiveEffects`。
7. 为 target-side 装备模板强提示 `ownerRole=target`，为 attacker-side 装备模板默认 `ownerRole=attacker`。
8. 模板中出现的数值字段必须可编辑，并在 UI/校验里标记为草稿值或待真实数据确认。
9. 与 U3 发布前 preflight 一致：模板生成的结构错误必须能在保存前或发布前暴露，不允许静默进入 current bundle。

## 4. 非目标

1. 不新增 Wasm runtime operation。
2. 不修改 `DPSPassiveEffectV2` 或 `DPSPassiveOperationV2` schema。
3. 不新增后端 DB 表或字段。
4. 不录入兰顿、收集者或其他装备的真实数值。
5. 不把装备页面改成完整机制编辑器。
6. 不实现完整自由战斗编辑器、技能 rotation、敌方动作或多目标模拟。
7. 不把模板默认值当成真实装备结论。
8. 不绕过 U0/U3 的 `skillRefs`、`ownerRole` 和 published contract 检查。

## 5. 所有权边界

数据侧拥有：

1. 装备真实数值。
2. `item.skillRefs` 指向哪些 item-owned skill。
3. `ownerRole`、`targetRole`、`trigger.event`、阈值、冷却、乘区、证据 ID。
4. OCR、训练营 baseline、版本号和测试记录。

Wasm 侧拥有：

1. `single_attacker_dps` 执行语义。
2. operation 校验和 blocked reason。
3. runtime evidence 输出。
4. 不为模板新增装备专属分支。

Web 侧拥有：

1. 模板库。
2. 模板参数表单。
3. `dpsPassiveEffects` 写回、保留 unknown 字段、保存前校验。
4. item `skillRefs` 摘要和发布前 preflight 展示。

Backend 侧拥有：

1. JSONB 保真保存。
2. 结构错误的最小后端兜底校验。
3. 发布链不裁剪 `dpsPassiveEffects`。

Planning 侧拥有：

1. 本详细设计。
2. Cursor prompt、验证矩阵和测试记录归档。

## 6. 写入范围

### 6.1 Web 默认写入

允许写入：

1. `C:\project\damage_web_dev\web\src\components\skill-editor\skillModels.ts`
2. `C:\project\damage_web_dev\web\src\components\skill-editor\SkillMechanicsConfigEditor.tsx`
3. `C:\project\damage_web_dev\web\src\pages\admin\resources\skills\modal.tsx`
4. `C:\project\damage_web_dev\web\src\pages\admin\resources\items\modal.tsx`
5. `C:\project\damage_web_dev\web\src\pages\admin\resources\items\itemSkillRefsValidation.ts`
6. 如模板代码较多，可新增 `C:\project\damage_web_dev\web\src\components\skill-editor\dpsPassiveTemplates.ts`

条件允许写入：

1. `C:\project\damage_web_dev\web\src\components\item-editor\SkillRefSelector.tsx`
2. `C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.ts`
3. `C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.test.ts`

只有当类型或服务契约阻塞时，才允许最小写入：

1. `C:\project\damage_web_dev\web\src\types\api.ts`
2. `C:\project\damage_web_dev\web\src\services\apiClient.ts`

### 6.2 Wasm 只读

默认不写入 Wasm。只读参考：

1. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go`
2. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_contract.go`
3. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_validation.go`
4. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go`

如果实现模板时发现必须新增 Wasm 字段，立即停止，另拆 Wasm batch。

### 6.3 Backend 默认不写

默认不改 backend。只有发现当前保存或发布链会裁剪模板生成字段，且已有测试不能覆盖时，另拆 Backend gate。

## 7. 模板契约

### 7.1 模板定义

建议新增纯函数模板层：

```ts
export type DpsPassiveTemplateId =
  | 'attacker_on_hit_damage'
  | 'attacker_every_n_damage'
  | 'attacker_stack_trigger_damage'
  | 'attacker_energized_damage'
  | 'attacker_phantom_hit_repeat'
  | 'attacker_execute_threshold'
  | 'attacker_crit_context_modifier'
  | 'target_retaliation_damage'
  | 'target_incoming_damage_modifier'
  | 'target_incoming_crit_only_modifier'
  | 'bucket_damage_modifier';

export type DpsPassiveTemplateContext = {
  itemId?: string;
  skillId?: string;
  passiveIdPrefix?: string;
  sourceId?: string;
  sourceCategory?: string;
  sourceType?: string;
  ownerRole?: 'attacker' | 'target';
};

export type DpsPassiveTemplate = {
  id: DpsPassiveTemplateId;
  label: string;
  description: string;
  ownerRole: 'attacker' | 'target';
  supported: 'runtime' | 'authoring_only';
  requiresRealData: boolean;
  create: (context: DpsPassiveTemplateContext) => JsonObject;
};
```

模板层只返回 plain JSON object。它不读取后端、不调用 Wasm、不产生真实装备结论。

### 7.2 字段默认策略

1. `passiveId`、`effectId`、`sourceId` 默认从 `skillId` 或 `itemId` 派生，但必须允许用户覆盖。
2. `sourceCategory` 默认 `item`。
3. `sourceType` 默认 `item`。
4. attacker 模板默认 `ownerRole=attacker`。
5. target 模板默认 `ownerRole=target`。
6. 业务数值默认不自动填写；模板参数面板允许空值，但保存或发布前必须按字段规则阻断或 warning。
7. `operations[].source` 和 `evidenceKey` 应稳定可读，便于后续 DPS 页面 evidence 追踪。
8. 模板不能删除已有 passive 中的未知字段。

## 8. 第一批模板

### 8.1 Attacker on-hit damage

用途：普通攻击命中附带额外伤害，如简单攻击特效。

```json
{
  "passiveId": "item_x_on_hit_damage",
  "effectId": "item_x_on_hit_damage",
  "sourceCategory": "item",
  "sourceType": "item",
  "sourceId": "item_x",
  "ownerRole": "attacker",
  "trigger": {
    "event": "on_basic_attack_hit",
    "matcher": {
      "sourceRole": "attacker",
      "targetRole": "target"
    }
  },
  "operations": [
    {
      "kind": "damage",
      "source": "item_x_on_hit_damage",
      "targetRole": "target",
      "damageType": "physical",
      "amount": 0,
      "evidenceKey": "item_x_on_hit_damage"
    }
  ]
}
```

验收：可保存；DPS adapter 保留 operation；Wasm 不 blocked，除非数值或上下文缺失。

### 8.2 Attacker every-N damage

用途：每 N 次普攻触发，如三环、周期性攻击特效。

```json
{
  "passiveId": "item_x_every_3_damage",
  "effectId": "item_x_every_3_damage",
  "sourceCategory": "item",
  "sourceType": "item",
  "sourceId": "item_x",
  "ownerRole": "attacker",
  "triggerKind": "every_n_basic_attack_hit",
  "everyN": 3,
  "operations": [
    {
      "kind": "damage",
      "source": "item_x_every_3_damage",
      "targetRole": "target",
      "damageType": "physical",
      "amount": 0,
      "evidenceKey": "item_x_every_3_damage"
    }
  ]
}
```

验收：`everyN` 必须是正整数；模板 UI 必须允许改 N。

### 8.3 Attacker stack trigger damage

用途：先叠层，再在达到阈值时造成伤害。

```json
{
  "passiveId": "item_x_stack_trigger",
  "effectId": "item_x_stack_trigger",
  "sourceCategory": "item",
  "sourceType": "item",
  "sourceId": "item_x",
  "ownerRole": "attacker",
  "trigger": {
    "event": "on_basic_attack_hit",
    "matcher": {
      "sourceRole": "attacker",
      "targetRole": "target"
    }
  },
  "operations": [
    {
      "kind": "add_stack",
      "stackKey": "item_x_stack",
      "maxStacks": 3
    },
    {
      "kind": "trigger_damage_at_stacks",
      "source": "item_x_stack_trigger",
      "stackKey": "item_x_stack",
      "triggerStacks": 3,
      "resetStacks": true,
      "targetRole": "target",
      "damageType": "true",
      "amount": 0,
      "evidenceKey": "item_x_stack_trigger"
    }
  ]
}
```

验收：`stackKey` 在两个 operation 中一致；`triggerStacks <= maxStacks`。

### 8.4 Target incoming damage modifier

用途：目标侧受击减伤、增伤、暴击限定减伤，例如兰顿类结构。

```json
{
  "passiveId": "item_x_incoming_modifier",
  "effectId": "item_x_incoming_modifier",
  "sourceCategory": "item",
  "sourceType": "item",
  "sourceId": "item_x",
  "ownerRole": "target",
  "trigger": {
    "event": "on_damage_taken",
    "matcher": {
      "sourceRole": "attacker",
      "targetRole": "target"
    }
  },
  "operations": [
    {
      "kind": "damage_modifier",
      "source": "item_x_incoming_modifier",
      "targetRole": "target",
      "valuePhase": "incoming",
      "modifierMode": "percent",
      "value": 0,
      "critOnly": false,
      "evidenceKey": "item_x_incoming_modifier"
    }
  ]
}
```

兰顿类模板只是在该形状上设置 `critOnly=true`。真实 `value` 仍需数据证据确认。

### 8.5 Attacker execute threshold

用途：收集者、低血量斩杀类机制。

```json
{
  "passiveId": "item_x_execute_threshold",
  "effectId": "item_x_execute_threshold",
  "sourceCategory": "item",
  "sourceType": "item",
  "sourceId": "item_x",
  "ownerRole": "attacker",
  "trigger": {
    "event": "on_damage_dealt",
    "matcher": {
      "sourceRole": "attacker",
      "targetRole": "target"
    }
  },
  "operations": [
    {
      "kind": "execute_threshold",
      "source": "item_x_execute_threshold",
      "targetRole": "target",
      "thresholdType": "current_hp_ratio",
      "checkTiming": "after_damage",
      "evidenceKey": "item_x_execute_threshold"
    }
  ]
}
```

模板不得自动写入 `thresholdValue`。推荐插入前要求录入者填写阈值；如果允许先插入草稿，保存前必须对缺失 `thresholdValue` 报 error，避免缺省 0 或旧约定值静默进入 published bundle。

### 8.6 Attacker crit context modifier

用途：暴击上下文调整，例如强制暴击、暴击倍率覆盖或倍率缩放。

```json
{
  "passiveId": "item_x_crit_context",
  "effectId": "item_x_crit_context",
  "sourceCategory": "item",
  "sourceType": "item",
  "sourceId": "item_x",
  "ownerRole": "attacker",
  "trigger": {
    "event": "on_basic_attack_hit",
    "matcher": {
      "sourceRole": "attacker",
      "targetRole": "target"
    }
  },
  "operations": [
    {
      "kind": "crit_context_modifier",
      "source": "item_x_crit_context",
      "forceCrit": false,
      "critMultiplierScale": 1,
      "evidenceKey": "item_x_crit_context"
    }
  ]
}
```

验收：`forceCrit`、`critMultiplierOverride`、`critMultiplierScale` 三者至少一个有效；覆盖和缩放不可同时有效。

### 8.7 Bucket damage modifier

用途：走 Batch R 乘区平台的伤害增减。

```json
{
  "passiveId": "item_x_bucket_modifier",
  "effectId": "item_x_bucket_modifier",
  "sourceCategory": "item",
  "sourceType": "item",
  "sourceId": "item_x",
  "ownerRole": "attacker",
  "trigger": {
    "event": "on_damage_dealt",
    "matcher": {
      "sourceRole": "attacker",
      "targetRole": "target"
    }
  },
  "operations": [
    {
      "kind": "damage_modifier",
      "source": "item_x_bucket_modifier",
      "targetRole": "target",
      "bucketKey": "",
      "valueSpec": {
        "kind": "literal",
        "value": 0
      },
      "conditions": [],
      "evidenceKey": "item_x_bucket_modifier"
    }
  ]
}
```

验收：`bucketKey` 为空时保存前必须 error 或显式 warning；如果选择 bucket，应按 bucket domain 过滤或提示。

### 8.8 Advanced templates

以下模板作为 P1，不阻塞第一批上线：

1. `energized_charge_and_consume`
2. `phantom_hit_on_hit_repeat`
3. `target_retaliation_damage`
4. `apply_dot`
5. `stat_modifier_always_on`

这些模板字段更多，容易把 authoring UI 做重。第一批先保证常见装备录入不再手写整段 JSON。

## 9. UI 方案

### 9.1 Skill DPS Passive 工具条

在 `SkillMechanicsConfigEditor.tsx` 的 DPS Passive 区顶部新增：

1. 模板选择下拉。
2. `新增 passive` 按钮。
3. `仅插入 operation` 模式，用于给当前 passive 追加 operation。
4. 模板说明文本，显示：
   - ownerRole
   - runtime 支持状态
   - 是否需要真实数据
   - 关键字段

当前 `dpsPassiveEffects` 不存在时，点击新增模板应创建数组并插入第一个 passive。

### 9.2 Passive 卡片操作

每个 passive 卡片提供：

1. 复制。
2. 删除。
3. 上移。
4. 下移。
5. 追加 operation 模板。

复制时必须生成新的 `passiveId/effectId/evidenceKey` 建议值，避免直接重复 ID；如果无法安全生成，保留原值但给 warning。

### 9.3 模板参数表单

模板插入前弹出轻量参数区或内联面板：

1. `sourceId`
2. `ownerRole`
3. `damageType`
4. `amount/value/thresholdValue`
5. `everyN`
6. `internalCooldownMs`
7. `bucketKey`
8. `evidenceKey`

数值字段旁必须显示“草稿值，需按数据来源确认”。

### 9.4 Item 页辅助

item 页仍只维护 `skillRefs`，但已有摘要应增强：

1. 明确显示每个 referenced skill 的 passive 数量、ownerRole 分布、trigger 分类。
2. 对 `ownerRole=target` 的 passive 使用明显提示，避免攻击方装备误接入。
3. 对空 `skillRefs` 保持当前说明：空数组表示不接入装备被动，不自动匹配。
4. 可选增加 `复制 skillId` 或跳转提示；不在本批强制做路由跳转。

## 10. 保存与兼容

1. 继续通过 `onDpsPassiveEffectsChange` 写回 `mechanicsConfig.dpsPassiveEffects`。
2. `stringifyMechanicsConfig(...)` 必须保留 `baseRoot` 中未被结构化编辑器理解的字段。
3. 新增模板时只 append，不重排已有数组，除非用户点击上移/下移。
4. 删除 passive 只能删除用户选择的 index，不做“按 ID 删除”推断。
5. operation 模板只修改当前 passive 的 `operations` 数组，不改 sibling passive。
6. 对非对象 passive 或非数组 operations，结构化编辑器不应强行修复；保持 error，引导用户回 JSON 修正。

## 11. 校验规则

### 11.1 Operation kind 同步

`skillModels.ts` 的 `DPS_PASSIVE_OPERATION_KINDS` 必须补齐当前 Wasm 支持的：

1. `crit_context_modifier`
2. `execute_threshold`

同时复核是否仍遗漏：

1. `coefficient_modifier`
2. `phantom_hit_on_hit_repeat`
3. `energized_charge_check`
4. `energized_charge_consume`
5. `energized_charge_gain`
6. `next_attack_state_consume`

### 11.2 模板输出校验

每个 P0 模板必须有本地校验：

1. `passiveId` 非空。
2. `ownerRole` 为 `attacker` 或 `target`。
3. `operations` 为非空数组。
4. 每个 operation 为对象。
5. `execute_threshold.thresholdType` 只能是 `current_hp_ratio` 或 `current_hp_value`。
6. `execute_threshold.thresholdValue` 必须由录入者显式填写为有限非负数；缺失、`null` 或空字符串均为 error。
7. `execute_threshold.checkTiming` 为空或 `after_damage`。
8. `damage_modifier.valuePhase` 为空或 `incoming`。
9. `damage_modifier.modifierMode` 为空或 `percent`。
10. `crit_context_modifier` 至少有一个有效 crit 字段。
11. `internalCooldownMs` 必须是非负整数。

### 11.3 Warning 策略

以下情况 warning，不阻止保存：

1. 模板数值仍为 `0`。
2. `critOnly=true` 但当前数据缺少可复核 crit baseline。
3. `execute_threshold` 草稿缺少 `thresholdValue` 时保存前必须 error，不降级为 warning。
4. target-side passive 被 attacker item 引用。
5. attacker-side passive 被 target item 引用。

U3 发布前 preflight 可继续把部分 warning 升级为 error，Batch V 不改发布策略。

## 12. 实施步骤

1. 在 `skillModels.ts` 或新增 `dpsPassiveTemplates.ts` 定义模板 ID、模板元数据和 `createDpsPassiveTemplate(...)`。
2. 补齐 `DPS_PASSIVE_OPERATION_KINDS`，至少加入 `execute_threshold` 和 `crit_context_modifier`。
3. 为 P0 模板实现生成函数。
4. 在 `SkillMechanicsConfigEditor.tsx` DPS Passive 区增加模板工具条。
5. 支持创建第一个 `dpsPassiveEffects` 数组。
6. 支持复制、删除、上移、下移 passive。
7. 支持给当前 passive 追加 operation 模板。
8. 在 item `skillRefs` 摘要中补足 ownerRole、trigger、operation kind 的可扫描展示；如果现有展示已经足够，只做文案和 warning 补强。
9. 确认技能保存后 raw JSON 保持格式正确，unknown 字段不丢。
10. 确认版本发布页 U3 preflight 可以看到模板生成结构的问题。

## 13. 验证命令

Web 最小验证：

```powershell
cd C:\project\damage_web_dev\web
npm run build
```

页面 smoke：

1. 打开 Admin skills。
2. 新建或编辑一个 item-owned skill。
3. 插入 `attacker_execute_threshold` 模板。
4. 确认 `mechanicsConfig` JSON 出现 `dpsPassiveEffects[0].operations[0].kind=execute_threshold`。
5. 插入 `target_incoming_crit_only_modifier` 模板。
6. 确认 `ownerRole=target`、`critOnly=true`、`valuePhase=incoming`。
7. 保存技能，重新打开后结构化区仍能显示。
8. 打开 Admin items，选择该 skill 到 `skillRefs`。
9. 确认 item 页摘要能显示 passive 数量、ownerRole 和 trigger/operation。
10. 打开版本发布页，确认 U3 preflight 不因合法模板结构报 error。

如果实际实现触碰 `tinygoV2DpsAdapter.ts` 或新增 contract helper，可补充运行已有 adapter contract test 的当前项目惯用方式；若本地没有可用 TS runner，不为此引入新测试框架，至少用 `npm run build` 覆盖类型。

## 14. 验收标准

1. 不手写整段 JSON，也能新增至少 5 类 P0 DPS passive 草稿。
2. `execute_threshold` 和 `crit_context_modifier` 不再被 authoring 层当 unknown operation。
3. 模板生成内容通过前端结构校验；非法字段能在保存前暴露。
4. item 页仍只维护 `skillRefs`，不复制 passive 编辑能力。
5. 保存后重新打开，模板生成的 `dpsPassiveEffects` 不丢字段。
6. U3 发布前 preflight 仍能阻止 error 级 published contract 问题。
7. 没有 Wasm runtime 改动。
8. `npm run build` 通过。

## 15. 风险与止损

1. 如果模板 UI 开始变成完整 DSL 编辑器，停止并拆成 Batch V-2。
2. 如果需要新增 Wasm 字段，停止并拆 Wasm batch。
3. 如果后端保存裁剪字段，停止并拆 Backend 保真 gate。
4. 如果模板默认数值被误当真实数据，必须把默认值改成空值/待确认状态，并在保存或发布前 warning。
5. 如果 item 页需要复杂跳转或跨资源创建 skill，先只做摘要和复制 skillId，不在本批做跨资源工作流。

## 16. Cursor Prompt：Web Gate

```text
目标：实现 Batch V 的 DPS 装备被动模板与录入辅助。重点是 Admin skill 的 dpsPassiveEffects 模板生成、operation 追加、passive 复制/删除/排序，以及 item skillRefs 摘要补强。

执行模型：Cursor composer-2.5，fast=false。

目标 repo：
- C:\project\damage_web_dev

只读参考：
- C:\project\damage_wasm_dev\文档记录\详细设计\最小验证\V2-BatchV-DPS装备被动模板与录入辅助计划.md
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_contract.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_validation.go
- C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.ts
- C:\project\damage_web_dev\web\src\pages\admin\resources\items\itemSkillRefsValidation.ts

允许写入：
- C:\project\damage_web_dev\web\src\components\skill-editor\skillModels.ts
- C:\project\damage_web_dev\web\src\components\skill-editor\SkillMechanicsConfigEditor.tsx
- C:\project\damage_web_dev\web\src\components\skill-editor\dpsPassiveTemplates.ts（可新增）
- C:\project\damage_web_dev\web\src\pages\admin\resources\skills\modal.tsx
- C:\project\damage_web_dev\web\src\pages\admin\resources\items\modal.tsx
- C:\project\damage_web_dev\web\src\pages\admin\resources\items\itemSkillRefsValidation.ts
- 必要时最小修改 C:\project\damage_web_dev\web\src\components\item-editor\SkillRefSelector.tsx

非目标：
- 不改 Wasm runtime。
- 不改 backend / DB schema。
- 不录入真实装备数值。
- 不实现完整自由战斗编辑器。
- 不把 item 页改成 dpsPassiveEffects 编辑器。

实现要求：
1. 新增或扩展模板层，支持 P0 模板：attacker_on_hit_damage、attacker_every_n_damage、attacker_stack_trigger_damage、target_incoming_damage_modifier、target_incoming_crit_only_modifier、attacker_execute_threshold、attacker_crit_context_modifier、bucket_damage_modifier。
2. 补齐 authoring 层 operation kind：execute_threshold、crit_context_modifier。
3. Skill DPS Passive 区支持新增模板、复制、删除、上移、下移 passive。
4. 支持给已有 passive 追加 operation 模板。
5. 模板默认值必须可编辑，并对待确认数值给 warning。
6. 保存路径继续通过 onDpsPassiveEffectsChange -> stringifyMechanicsConfig，保留 unknown 字段。
7. item skillRefs 摘要只做展示和警告，不直接编辑 passive。

验证命令：
cd C:\project\damage_web_dev\web
npm run build

页面 smoke：
1. Admin skill 插入 execute_threshold 模板，确认 JSON 和摘要正确。
2. Admin skill 插入 target incoming critOnly modifier 模板，确认 ownerRole=target 和 critOnly=true。
3. 保存后重新打开，模板字段不丢。
4. Admin item 选择该 skillRef，确认摘要显示 ownerRole/trigger/operation。
5. 版本发布页 preflight 可见且不因合法模板结构误报 error。

停止条件：
- 如果需要新增 Wasm 字段或 runtime 分支，停止并报告。
- 如果 backend 保存裁剪字段，停止并报告 Backend gate。
- 如果模板 UI 需要发展成完整 DSL 编辑器，停止并拆 Batch V-2。
```

## 17. 后续批次

1. Batch V-1：模板上线和 item 摘要补强。
2. Batch V-2：高级模板，覆盖 energized、phantom hit、retaliation、DoT。
3. Batch V-3：跨资源辅助创建 item-owned skill，并自动回填 item.skillRefs。
4. Batch U-1：在有真实 OCR/训练营数据后，用模板录入兰顿并做 real pass。
5. Batch U-2 数据闭环：用模板录入收集者真实数据并做 page/live proof。
