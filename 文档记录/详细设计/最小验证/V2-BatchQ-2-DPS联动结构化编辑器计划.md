TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-06-07

# V2 Batch Q-2 DPS 联动结构化编辑器计划

关联概要：[验证里程碑V2.md](../../概要设计/验证里程碑V2.md)

前置计划：[V2-BatchQ-DPS联动配置编辑与校验成熟度计划.md](./V2-BatchQ-DPS联动配置编辑与校验成熟度计划.md)

前置机制：[V2-BatchO-单攻击方DPS事件化联动机制计划.md](./V2-BatchO-单攻击方DPS事件化联动机制计划.md)

真实装备闭环前置：[V2-BatchP-单攻击方DPS真实装备联动闭环计划.md](./V2-BatchP-单攻击方DPS真实装备联动闭环计划.md)

## 1. 文档边界

本文是 Batch Q 的补充详细设计，目标是把当前只读的 `DPS Passive 摘要` 推进到可编辑的结构化组件。本文不是测试记录，也不是重新定义 DPS runtime schema。

当前 Batch Q 已经做到两件事：

1. 在 Web skill 编辑页展示 `mechanicsConfig.dpsPassiveEffects` 摘要。
2. 在前端保存前做最小校验，错误会阻断保存。

但这还没有满足“用户不写 JSON 也能维护联动机制”的目标。当前页面仍明确提示“完整编辑请使用 mechanicsConfig JSON”，所以 Q-2 必须补上字段级编辑、装备引用可视化、前端和发布链路回归。

本文写给 Cursor 执行。真正开发仍必须先由 GPT/Codex 收敛范围、生成 Cursor prompt，再由 Cursor 用 `grok-4.5` 执行受限编码。GPT/Codex 负责 diff review、构建、浏览器 smoke 和最终验收。

## 2. 当前事实

以下事实来自 2026-06-07 当前 worktree 核对：

1. `C:\project\damage_wasm_dev` 当前分支为 `wasm/dev`。
2. `C:\project\damage_web_dev` 当前分支为 `web/dev`。
3. `C:\project\damage_backend_dev` 当前分支为 `backend/dev`。
4. `C:\project\damage_web_dev\web\src\components\skill-editor\skillModels.ts` 已有 `SkillDpsPassiveSummaryRow`、`SkillDpsPassiveValidationIssue`、`summarizeDpsPassiveEffects(root)`、`validateDpsPassiveEffects(root)` 和 `hasDpsPassiveValidationErrors(issues)`。
5. `C:\project\damage_web_dev\web\src\components\skill-editor\SkillMechanicsConfigEditor.tsx` 已接收 `root: JsonObject`，并展示 `DPS Passive 摘要`，但组件 props 只有 `onVersionChange`、`onStacksChange`、`onChange`，没有修改 `dpsPassiveEffects` 的写回入口。
6. `C:\project\damage_web_dev\web\src\pages\admin\resources\skills\modal.tsx` 通过 `stringifyMechanicsConfig(mechanicsConfigState.root, version, stacks, rows)` 写回 JSON；该函数会保留 `baseRoot` 额外字段，因此适合扩展为结构化写回 `dpsPassiveEffects`。
7. `C:\project\damage_web_dev\web\src\pages\admin\resources\items\modal.tsx` 已有 `skillRefs structured` 区域，使用 `SkillRefSelector` 选择 `ownerType=item` 的技能，并回写 `skillRefs` 数组。
8. 装备被动的 DPS linked effect 不应该复制到 item 表单里。item 负责引用 item-owned skill，真正的机制字段保存在被引用 skill 的 `mechanicsConfig.dpsPassiveEffects`。
9. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go` 中 `DPSPassiveEffectV2`、`DPSPassiveTriggerMatcherV2`、`DPSPassiveOperationV2` 是当前 schema 真源。
10. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver.go` 已支持 owner-aware trigger、targetRole 默认值、`damage_modifier`、`stat_modifier`、`phantom_hit_on_hit_repeat`、充能类 operation 和 target-side 伤害。

## 3. 目标

Q-2 的目标是让配置者在 Admin 页面完成 DPS linked effect 的常规维护，不再依赖手写 JSON 完成以下动作：

1. 给 item-owned skill 新增、删除、重排 `dpsPassiveEffects`。
2. 编辑 passive 的身份字段：`passiveId`、`effectId`、`sourceCategory`、`sourceType`、`sourceId`、`ownerRole`、`priority`。
3. 编辑触发字段：`trigger.event` 和 `trigger.matcher`。
4. 编辑 operation 列表，包括新增、删除、重排、切换 `kind` 和填写 kind-specific 字段。
5. 在 item 编辑页看到已选 `skillRefs` 的 DPS passive 摘要，明确装备引用了哪些联动效果。
6. 保留 raw JSON fallback，并保证结构化编辑和 JSON 文本域双向同步。
7. 保留 unknown 字段，不裁剪当前 runtime 或 seed 未来可能扩展的字段。
8. 能用 3071 黑切和 3075 反甲证明“装备引用 -> passive skill 配置 -> 发布 -> DPS 页面 -> Wasm 运行”仍闭环。

## 4. 非目标

1. 不把 `mechanicsConfig` 改成新 schema。
2. 不把 item 表单改成完整机制编辑器。item 表单只做 skill 引用和被引用 passive 摘要。
3. 不新增 Wasm runtime 特例，不为某件装备写 DPS 专用分支。
4. 不在本批次补齐所有 ADC 装备或坦克装备数据。Q-2 做编辑器能力，真实数据补录可以作为后续数据批次。
5. 不实现完整技能 rotation、主动技能释放队列或真实 `on_spell_hit` 页面注入。
6. 不新增后端 DB schema。`mechanicsConfig` 仍按 JSONB 或现有 JSON 字段保真。
7. 不为了 warning 新增后端 API。warning 先由前端展示承担，后端只需 error 级结构保护。

## 5. 写入范围

### 5.1 Web 默认写入范围

1. `C:\project\damage_web_dev\web\src\components\skill-editor\skillModels.ts`
2. `C:\project\damage_web_dev\web\src\components\skill-editor\SkillMechanicsConfigEditor.tsx`
3. `C:\project\damage_web_dev\web\src\pages\admin\resources\skills\modal.tsx`
4. `C:\project\damage_web_dev\web\src\components\item-editor\SkillRefSelector.tsx`
5. `C:\project\damage_web_dev\web\src\pages\admin\resources\items\modal.tsx`

只有保存路径或路由需要时，才允许最小修改：

1. `C:\project\damage_web_dev\web\src\pages\admin\resources\skills\index.tsx`
2. `C:\project\damage_web_dev\web\src\pages\admin\resources\items\index.tsx`
3. `C:\project\damage_web_dev\web\src\types\api.ts`
4. `C:\project\damage_web_dev\web\src\services\apiClient.ts`

### 5.2 Backend 条件写入范围

默认不改后端。只有发现保存或发布链路没有阻断明显结构错误，且现有 Batch Q 后端校验没有覆盖时，才允许最小修改：

1. `C:\project\damage_backend_dev\server\data_manage\src\main\java\xyz\game\datamanage\service\PostgresWriteStore.java`
2. `C:\project\damage_backend_dev\server\data_manage\src\test\java\xyz\game\datamanage\service\PostgresWriteStorePublishTest.java`
3. `C:\project\damage_backend_dev\server\data_manage\src\test\java\xyz\game\datamanage\tools\KatarinaMvpImportMainTest.java`

### 5.3 只读参考

1. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go`
2. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver.go`
3. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go`
4. `C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.ts`
5. `C:\project\damage_web_dev\web\src\pages\WasmValidationV2DpsPage.tsx`
6. 当前 Batch Q 计划和测试记录。

## 6. 数据契约

### 6.1 Passive row

在 `skillModels.ts` 新增结构化 row。命名可以微调，但必须表达以下字段：

```ts
export type SkillDpsPassiveEffectRow = {
  rowId: string;
  index: number;
  passiveId: string;
  effectId: string;
  sourceCategory: string;
  sourceType: string;
  sourceId: string;
  ownerRole: 'attacker' | 'target' | '';
  priority: number | null;
  trigger: SkillDpsPassiveTriggerRow;
  legacy: SkillDpsPassiveLegacyRow;
  operations: SkillDpsPassiveOperationRow[];
  raw: JsonObject;
};
```

`raw` 必须保存 passive 原对象中当前 UI 不编辑的字段。stringify 时以 `raw` 为底，再覆盖 UI 编辑字段。不要先构造白名单对象导致 unknown 字段丢失。

### 6.2 Trigger matcher row

```ts
export type SkillDpsPassiveTriggerRow = {
  event: string;
  matcher: SkillDpsPassiveMatcherRow;
  raw: JsonObject;
};

export type SkillDpsPassiveMatcherRow = {
  damageTypes: string[];
  actionTypes: string[];
  effectTypes: string[];
  effectTags: string[];
  sourceTypes: string[];
  sourceCategories: string[];
  procScopes: string[];
  includePhantom: boolean;
  excludePhantom: boolean;
  raw: JsonObject;
};
```

`actionTypes`、`effectTypes`、`effectTags` 在 Go 侧是 `TypeMatcherV2`，前端 MVP 可以用以下兼容策略：

1. 如果原值是数组，按数组编辑。
2. 如果原值是 object，先显示为高级 JSON 子字段，不能丢失。
3. 如果未来要支持 `any/all/none` 这类 matcher object，再扩展组件，不在 Q-2 强行重写。

### 6.3 Legacy and charge row

`DPSPassiveEffectV2` 仍有历史字段和充能字段，必须有一个折叠的“兼容/充能”区：

```ts
export type SkillDpsPassiveLegacyRow = {
  triggerId: string;
  triggerKind: string;
  everyN: number | null;
  requiresScenarioStateId: string;
  chargeKey: string;
  chargeGainPerBasicAttack: number | null;
  chargeThreshold: number | null;
  chargeCap: number | null;
  chargeReadyPolicy: string;
  consumeChargeOnTrigger: boolean;
  procScope: string;
};
```

这个区域覆盖破败、海妖、鬼索、充能类装备和老旧配置的保真需求。默认折叠，但只要存在非空字段，就要显示风险/摘要提示。

### 6.4 Operation row

```ts
export type SkillDpsPassiveOperationRow = {
  rowId: string;
  index: number;
  kind: string;
  source: string;
  targetRole: 'attacker' | 'target' | '';
  damageType: string;
  amount: number | null;
  amountPerStack: number | null;
  targetCurrentHpRatio: number | null;
  targetCurrentHpBasis: string;
  targetMaxHpRatio: number | null;
  targetMissingHpRatio: number | null;
  targetMissingHpBasis: string;
  targetMissingHpAmp: number | null;
  attackerAttr: string;
  attackerAttrRead: string;
  attackerAttrRatio: number | null;
  minAmount: number | null;
  hasMinAmount: boolean;
  stackKey: string;
  maxStacks: number | null;
  triggerStacks: number | null;
  resetStacks: boolean;
  durationMs: number | null;
  tickIntervalMs: number | null;
  refreshMode: string;
  attrKey: string;
  modifierMode: string;
  value: number | null;
  perStack: boolean;
  repeatCount: number | null;
  repeatTag: string;
  repeatScope: string;
  phantomHitCopyable: boolean;
  valuePhase: string;
  critOnly: boolean;
  raw: JsonObject;
};
```

每个 operation stringify 时同样以 `raw` 为底覆盖 UI 字段。空字符串和 `null` 的处理必须遵守现有 JSON 习惯：可选字段为空时不写入，布尔字段只有需要表达 `true` 或原始 raw 已存在时才写入。

## 7. 解析和写回函数

在 `skillModels.ts` 增加纯函数，React 组件只负责渲染和回调。

```ts
export function parseDpsPassiveEffects(root: JsonObject): SkillDpsPassiveEffectRow[];

export function stringifyDpsPassiveEffects(baseRoot: JsonObject, rows: SkillDpsPassiveEffectRow[]): JsonObject;

export function stringifyMechanicsConfig(
  baseRoot: JsonObject,
  version: number,
  stacks: SkillStackRow[],
  rows: SkillTriggerRow[],
  dpsPassiveRows?: SkillDpsPassiveEffectRow[]
): string;
```

实现要求：

1. `parseDpsPassiveEffects` 不抛业务错误。非数组时返回空数组，错误由 `validateDpsPassiveEffects` 负责。
2. `rowId` 必须稳定，优先使用 `passiveId/effectId/index` 组合，新增时生成本地 id。
3. `stringifyDpsPassiveEffects` 返回新的 root object，不原地修改 `baseRoot`。
4. 如果传入 `dpsPassiveRows`，`stringifyMechanicsConfig` 必须写回 `dpsPassiveEffects`。
5. 如果没有传入 `dpsPassiveRows`，`stringifyMechanicsConfig` 保持当前行为，只改 `version/stacks/triggers`，不动 `dpsPassiveEffects`。
6. 删除所有 passive 时，写回 `dpsPassiveEffects: []`，不要隐式删除字段。这样用户能明确知道自己清空了联动配置。
7. 高级 JSON 文本域变更后，modal 重新 parse，结构化编辑器必须反映最新 JSON。
8. 结构化编辑器变更后，modal 必须更新 `mechanicsConfigText`，高级 JSON 文本域立即同步。

## 8. Skill 编辑器 UI

### 8.1 Props 调整

`SkillMechanicsConfigEditorProps` 增加：

```ts
dpsPassiveRows: SkillDpsPassiveEffectRow[];
onDpsPassiveEffectsChange: (rows: SkillDpsPassiveEffectRow[]) => void;
```

不要让 `SkillMechanicsConfigEditor` 自己持有长期 JSON 状态。状态仍由 `modal.tsx` 从 `mechanicsConfigText` 派生，所有编辑都通过回调写回 JSON 文本。

### 8.2 总体布局

把当前 `DPS Passive 摘要` 改成 `DPS 联动效果` 编辑区：

1. 顶部展示 passive 数量、error/warning 数量。
2. 保留摘要行，但每行可展开编辑。
3. 提供 `新增 passive`、`上移`、`下移`、`复制`、`删除`。
4. 每个 passive 内提供 `新增 operation`、operation 上移/下移/删除。
5. 所有按钮和输入在 `disabled` 或 `readOnly` 时不可编辑。
6. 不用嵌套大卡片堆叠。采用紧凑边框区、折叠面板、网格字段和已有 Arco 表单控件。

### 8.3 Passive 字段

每个 passive 展开后至少提供：

1. `passiveId` text input。
2. `effectId` text input。
3. `sourceCategory` select，选项：`skill_passive`、`item_passive`、`external_passive`，允许自定义输入保留未知值。
4. `sourceType` text input。
5. `sourceId` text input。
6. `ownerRole` segmented/select，选项：`attacker`、`target`。空值显示 `attacker(default)` 提示，但不强制写入。
7. `priority` number input。
8. `trigger.event` select，选项：`on_basic_attack_hit`、`on_spell_hit`、`on_hit`、`on_damage_dealt`、`on_damage_taken`、`dot_tick`。

### 8.4 Matcher 字段

matcher 区默认折叠，存在字段时自动显示摘要。字段编辑规则：

1. `damageTypes` 用多选或 tag input。
2. `sourceTypes`、`sourceCategories`、`procScopes` 用 tag input。
3. `includePhantom`、`excludePhantom` 用 switch。
4. `actionTypes`、`effectTypes`、`effectTags` 如果是数组，用 tag input。
5. 如果 matcher 子字段是 object，显示只读摘要和“高级 JSON 中编辑”的提示，本批不做 object matcher builder，但必须保留 raw。

### 8.5 Operation 字段

operation 顶部公共字段：

1. `kind` select，覆盖当前 runtime 支持集合：
   - `damage`
   - `apply_dot`
   - `add_stack`
   - `trigger_damage_at_stacks`
   - `stat_modifier`
   - `damage_modifier`
   - `phantom_hit_on_hit_repeat`
   - `energized_charge_check`
   - `energized_charge_consume`
   - `energized_charge_gain`
   - `next_attack_state_consume`
2. `source` text input。
3. `targetRole` select。按 runtime 默认值显示 placeholder：
   - `damage`、`apply_dot`、`trigger_damage_at_stacks`、`damage_modifier` 默认 `target`。
   - 其他 operation 默认 `attacker` 或不支持 targetRole 时显示提示。

kind-specific 字段：

1. `damage`：`damageType`、`amount`、HP ratio 字段、`attackerAttr`、`attackerAttrRead`、`attackerAttrRatio`、`minAmount`、`hasMinAmount`、`phantomHitCopyable`。
2. `apply_dot`：damage 字段、`durationMs`、`tickIntervalMs`、`refreshMode`。
3. `add_stack`：`stackKey`、`maxStacks`、`durationMs`、`refreshMode`。
4. `trigger_damage_at_stacks`：damage 字段、`stackKey`、`triggerStacks`、`resetStacks`。
5. `stat_modifier`：`attrKey`、`modifierMode`、`value`、`perStack`、`stackKey`、`targetRole`。`attrKey` 优先复用现有 `AttributeKeySelector`。
6. `damage_modifier`：`valuePhase`、`modifierMode`、`value`、`critOnly`、`targetRole`。默认提示 `valuePhase=incoming`、`modifierMode=percent`、`targetRole=target`。`critOnly=true` 必须显示 warning。
7. `phantom_hit_on_hit_repeat`：`stackKey`、`triggerStacks`、`repeatCount`、`repeatTag`、`repeatScope`。提示 `repeatScope=copyable_on_hit`。
8. `energized_*` 和 `next_attack_state_consume`：operation 区显示 `kind/source`，关联字段主要放在 passive 的“兼容/充能”区。未知 raw 字段继续保留。

## 9. 装备页联动

装备配置不直接存 `dpsPassiveEffects`，但必须让用户在装备页确认自己选中的技能是否包含 DPS linked effect。

### 9.1 SkillRefSelector

`SkillRefSelector` 当前只把 `ownerType=item` 的 skill 作为 options。Q-2 增强为：

1. option label 保持 `name · skillId`，不要塞过多文本导致选择器难读。
2. option 搜索文本追加 `ownerId`、`sourceId`、`dpsPassiveEffects.passiveId`、`trigger.event`、operation kinds。
3. selected refs 下方展示 compact summary：
   - skillId/name
   - passive 数量
   - ownerRole 分组
   - trigger.event 列表
   - operation kinds 列表
   - error/warning badge
4. 如果选中的 skill 没有 `dpsPassiveEffects`，显示“无 DPS 联动效果”，不阻断保存。
5. 不在 item modal 里直接编辑 passive 字段。需要编辑时提示去技能编辑页，并保留 skillId 便于搜索。

### 9.2 数据审计

Q-2 验收时必须检查代表性装备：

1. 3071 黑切的 `skillRefs` 指向 item-owned skill，且该 skill 有 attacker-side 或 source item 的 linked effect，用于物理伤害后叠加目标护甲削减。
2. 3075 反甲的 `skillRefs` 指向 item-owned skill，且该 skill 有 `ownerRole=target`、`trigger.event=on_damage_taken`、damage operation 指向 attacker。
3. 如果 3143 兰顿已有数据，页面必须能展示 `damage_modifier` 和 `critOnly` warning。如果没有真实数据，本批不强行补录，但编辑器必须支持这种字段。

## 10. 校验规则

继续复用 `validateDpsPassiveEffects(root)`，但要为结构化编辑补齐字段级提示。

error 规则：

1. `dpsPassiveEffects` 存在但不是数组。
2. passive 不是 object。
3. `ownerRole` 存在但不是 `attacker|target`。
4. `trigger` 存在但不是 object。
5. `trigger.event` 存在但不是支持事件。
6. `operations` 存在但不是数组。
7. operation 不是 object。
8. `targetRole` 存在但不是 `attacker|target`。
9. runtime 已明确不支持的 targetRole 组合，例如 `damage_modifier targetRole=attacker`、`apply_dot targetRole=attacker`。

warning 规则：

1. passive 缺少 `ownerRole`，提示默认 attacker。
2. passive 缺少 `trigger.event`。
3. passive 没有 operations 或 operations 为空。
4. operation 缺少 `kind`。
5. operation kind 不在当前前端识别集合，但不删除 raw。
6. `damage_modifier.critOnly=true`，提示当前 DPS 缺少真实 crit context 时 runtime 会 block。
7. matcher object 当前仅 raw 保真，不能结构化编辑。

保存阻断：

1. error 必须阻断保存。
2. warning 不阻断保存，但必须在编辑区可见。
3. 高级 JSON 解析失败继续阻断保存。

## 11. Cursor 执行拆分

### 11.1 Cursor Prompt A: 模型和写回函数

```text
目标：在 Web skill editor model 层增加 mechanicsConfig.dpsPassiveEffects 的结构化 parse/stringify row，不改 UI。

允许写入：
- C:\project\damage_web_dev\web\src\components\skill-editor\skillModels.ts

只读参考：
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver.go
- C:\project\damage_wasm_dev\文档记录\详细设计\最小验证\V2-BatchQ-2-DPS联动结构化编辑器计划.md

实现要求：
1. 新增 SkillDpsPassiveEffectRow、SkillDpsPassiveTriggerRow、SkillDpsPassiveMatcherRow、SkillDpsPassiveLegacyRow、SkillDpsPassiveOperationRow。
2. 新增 parseDpsPassiveEffects(root)。
3. 新增 stringifyDpsPassiveEffects(baseRoot, rows)。
4. 扩展 stringifyMechanicsConfig(..., dpsPassiveRows?)，未传 dpsPassiveRows 时保持旧行为。
5. 解析和写回必须保留 passive/trigger/matcher/operation raw unknown 字段。
6. 不改变现有 triggers/stacks 行为。
7. 继续复用并必要增强 validateDpsPassiveEffects(root)。

验证：
cd C:\project\damage_web_dev\web
npm run build

停止条件：
- 如果必须修改后端 API 才能完成模型函数，停止并报告。
- 如果需要重写 mechanicsConfig schema，停止并报告。
```

### 11.2 Cursor Prompt B: Skill 编辑器结构化 UI

```text
目标：把 SkillMechanicsConfigEditor 中当前只读的 DPS Passive 摘要升级为可编辑的 DPS 联动效果区域，并与 mechanicsConfig JSON 文本域双向同步。

允许写入：
- C:\project\damage_web_dev\web\src\components\skill-editor\SkillMechanicsConfigEditor.tsx
- C:\project\damage_web_dev\web\src\pages\admin\resources\skills\modal.tsx
- 必要时最小修改 C:\project\damage_web_dev\web\src\components\skill-editor\skillModels.ts

只读参考：
- C:\project\damage_web_dev\web\src\components\skill-editor\skillModels.ts
- C:\project\damage_wasm_dev\文档记录\详细设计\最小验证\V2-BatchQ-2-DPS联动结构化编辑器计划.md

实现要求：
1. SkillMechanicsConfigEditor 增加 dpsPassiveRows 和 onDpsPassiveEffectsChange props。
2. modal.tsx 从 mechanicsConfigState.root 派生 dpsPassiveRows。
3. 结构化编辑任意 passive/operation 字段后，立即调用 stringifyMechanicsConfig 写回 mechanicsConfigText。
4. 支持 passive 新增、删除、复制、上移、下移。
5. 支持 operation 新增、删除、上移、下移。
6. 提供 passive、trigger.matcher、legacy/charge、operation kind-specific 字段。
7. 保留 error/warning 展示和保存阻断。
8. 高级 JSON 文本域继续完整可用。
9. 修复当前改动范围内可见的中文乱码文案，不扩大到无关页面。

验证：
cd C:\project\damage_web_dev\web
npm run build

停止条件：
- 如果 UI 编辑会丢失 unknown 字段，停止并报告。
- 如果保存旧技能会因为无 dpsPassiveEffects 被阻断，停止并报告。
- 如果需要新增全局状态管理或重写 admin resource 框架，停止并报告。
```

### 11.3 Cursor Prompt C: 装备 skillRefs 摘要

```text
目标：在 item 编辑页的 skillRefs structured 区域展示已选 item-owned skill 的 DPS passive 摘要，帮助用户确认装备配置是否关联了 linked effect。

允许写入：
- C:\project\damage_web_dev\web\src\components\item-editor\SkillRefSelector.tsx
- C:\project\damage_web_dev\web\src\pages\admin\resources\items\modal.tsx
- 必要时最小修改 C:\project\damage_web_dev\web\src\components\skill-editor\skillModels.ts

只读参考：
- C:\project\damage_web_dev\web\src\components\skill-editor\skillModels.ts
- C:\project\damage_web_dev\web\src\pages\admin\resources\skills\modal.tsx

实现要求：
1. 复用 summarizeDpsPassiveEffects 和 validateDpsPassiveEffects，不复制校验逻辑。
2. selected skillRefs 下方展示每个已选 skill 的 passive 数量、ownerRole、trigger.event、operation kinds、error/warning。
3. 搜索文本追加 passiveId、trigger.event、operation kind，便于按联动机制搜索 skill。
4. 不在 item modal 里编辑 mechanicsConfig。
5. 没有 dpsPassiveEffects 的 skill 不阻断 item 保存。

验证：
cd C:\project\damage_web_dev\web
npm run build

停止条件：
- 如果 getSkills 返回数据不足以做摘要，停止并报告缺失字段。
- 如果需要新增 item schema 字段，停止并报告。
```

## 12. GPT 验收流程

Cursor 返回后，GPT/Codex 必须执行：

1. 检查 Cursor 事件日志和 `git diff`。
2. 确认没有回滚用户或其他 agent 的既有脏改。
3. 确认没有修改 Wasm runtime，除非 Cursor 已按停止条件报告并得到新指令。
4. 在 `C:\project\damage_web_dev\web` 运行 `npm run build`。
5. 在相关 worktree 运行 `git diff --check`。
6. 如后端有改动，在 `C:\project\damage_backend_dev\server\data_manage` 运行对应 `mvn` 测试。
7. 启动或复用后端和前端服务，用浏览器 smoke 覆盖 Admin skills、Admin items、DPS 页面。
8. 更新测试记录，不把测试证据塞回本详细设计。

## 13. 浏览器 smoke

有可用 Admin token 和本地服务时，必须验证：

1. 打开 Admin skills，定位 3071 黑切关联的 item-owned skill。
2. 不编辑 JSON，直接在结构化区域修改一个非破坏性字段，例如 `priority` 或 matcher tag，确认 JSON 文本域同步变化。
3. 撤回修改或恢复原值，保存成功。
4. 临时把 `ownerRole` 改成非法值，确认页面出现 error 并阻断保存。
5. 新增一个 operation 后删除，确认 JSON 回到等价状态，unknown 字段未丢。
6. 打开 3075 反甲关联 skill，确认可见 `ownerRole=target`、`trigger.event=on_damage_taken`、damage operation 和 `targetRole=attacker`。
7. 打开 Admin items，定位 3071 和 3075，确认 `skillRefs structured` 下能看到被引用 skill 的 DPS passive 摘要。
8. 发布或复用 current version 后，打开 DPS 页面，选择 attacker equipment 3071 和 target equipment 3075，确认 Wasm 输出仍可运行且 passive summary/trigger timeline 没有退化。

如果没有 Admin token、后端服务或 live DB 权限，GPT/Codex 必须说明已完成的自动化验证和剩余人工验证点，不得把可自动化项直接甩给用户。

## 14. 验收标准

Q-2 完成必须同时满足：

1. 用户能在 skill 编辑页不写 raw JSON 完成 `dpsPassiveEffects` passive 字段编辑。
2. 用户能新增、删除、重排 passive。
3. 用户能新增、删除、重排 operation。
4. 用户能编辑 `damage`、`apply_dot`、`add_stack`、`trigger_damage_at_stacks`、`stat_modifier`、`damage_modifier`、`phantom_hit_on_hit_repeat`、`energized_*`、`next_attack_state_consume` 的核心字段。
5. 结构化编辑和 `mechanicsConfig JSON` 文本域双向同步。
6. unknown 字段在 passive、trigger、matcher、operation 层都被保留。
7. error 级校验阻断保存，warning 级校验可见但不阻断。
8. item 编辑页能看见已选 `skillRefs` 的 DPS passive 摘要。
9. 3071 黑切、3075 反甲可作为 web + wasm 验收样例。
10. `npm run build` 通过。
11. 如后端有改动，相关 `mvn` 测试通过。
12. 治理映射包含本文档，`node tools/task-governance/cli.mjs rebuild` 通过。

## 15. 残余风险

1. Q-2 不补真实 `on_spell_hit` 用户流。卢登这类技能命中触发装备仍需要后续 Batch R 或等价页面事件注入。
2. Q-2 不补齐所有装备数据。编辑器支持字段，不代表所有 ADC 装备和坦克装备都已录入完整真实配置。
3. `TypeMatcherV2` object 形态在本批只做 raw 保真，复杂 matcher builder 后续再做。
4. 兰顿的真实暴击上下文仍依赖 DPS runtime 是否提供 crit context。本批只让 `damage_modifier.critOnly` 可见并给 warning。
5. 当前 web 没有独立前端单测脚本时，自动化主要依赖 `npm run build` 和浏览器 smoke。
