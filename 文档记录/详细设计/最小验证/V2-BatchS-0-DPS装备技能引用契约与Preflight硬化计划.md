TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-06-09

# V2 Batch S-0 DPS 装备技能引用契约与 Preflight 硬化计划

关联概要：[验证里程碑V2.md](../../概要设计/验证里程碑V2.md)

前置真实装备闭环：[V2-BatchP-单攻击方DPS真实装备联动闭环计划.md](./V2-BatchP-单攻击方DPS真实装备联动闭环计划.md)

前置编辑器成熟度：[V2-BatchQ-DPS联动配置编辑与校验成熟度计划.md](./V2-BatchQ-DPS联动配置编辑与校验成熟度计划.md)

前置乘区平台：[V2-BatchR-DPS乘区与属性修饰平台计划.md](./V2-BatchR-DPS乘区与属性修饰平台计划.md)

缺口来源：[V2-ADC随机组合机制头脑风暴与缺口分析.md](./V2-ADC随机组合机制头脑风暴与缺口分析.md)

## 1. 文档边界

本文是 Batch S-0 的详细设计。目标只有一个：先把装备 `skillRefs` 到 item-owned skill 再到 `mechanicsConfig.dpsPassiveEffects` 的引用链变成可验证、可解释、不可静默错算的契约。

本批不是 Batch S 的暴击上下文和斩杀阈值，不处理 `critOnly`、`execute_threshold`、完整 rotation、sustain、生存闭环、多目标或距离模拟。乘区相关能力已经由 Batch R 承接，本批只确保“哪个装备被动会被接入 DPS”这件事可靠。

## 2. 当前事实

以下事实来自 2026-06-09 当前 worktree 定点核对：

1. `web/src/types/api.ts` 中 `Item.skillRefs?: string[]` 保存装备引用的 skill id。
2. `web/src/types/api.ts` 中 `Skill.ownerType`、`Skill.ownerId` 标识 skill 归属。
3. `web/src/engine/tinygoV2DpsAdapter.ts` 中 `itemSkillLinkedByRefs(skillRefs, skillId)` 当前逻辑是：`!skillRefs || skillRefs.size === 0 || skillRefs.has(skillId)`。因此缺失或空 `skillRefs` 会等价于匹配该 item owner 下所有 skill。
4. `resolveDpsItemPassiveEffects` 当前对 attacker 装备有局部差异：它只在 `skillRefs && skillRefs.size > 0 && !skillRefs.has(skill.skillId)` 时跳过，因此空 `skillRefs` 同样会全匹配。
5. `targetPassiveIdsForEquipment`、`resolveDpsTargetItemPassiveEffects`、target equipment option/listing 路径使用 `itemSkillLinkedByRefs`，因此 target 装备同样受空引用全匹配影响。
6. `collectTargetEquipmentPassiveBlockedReasons` 已能提示 target 装备存在 DPS passive 但 `ownerRole` 不是 target 的情况，但它仍建立在当前 skillRefs 匹配语义上。
7. `web/src/pages/admin/resources/items/modal.tsx` 已有结构化 `skillRefs` 选择器，能从 UI 层降低手填错误，但 seed、导入、后端数据或 JSON 仍可能绕过。
8. `web/src/components/skill-editor/skillModels.ts` 对 `ownerRole` 缺失仍按旧兼容默认 attacker 并给 warning；这对 attacker 旧数据可接受，但 target 装备不能继续只靠默认。
9. ADC 随机组合审计已把 `skillRefs=[]` 静默多算、`ownerId` 指错静默少算、`ownerRole` 错误接入列为当前最高优先级假阳性风险。

## 3. 问题定义

装备被动闭环的用户心智是：选中某件装备，系统只接入这件装备明确引用的 item-owned skill 中的 DPS passive。

当前风险是：

1. 空 `skillRefs` 可能被解释成“全匹配”，导致历史、废弃、测试或未公开的 item-owned skill 被一并接入，形成静默多算。
2. `skillRefs` 指向存在的 skill，但 skill 属于其他 item 或 hero 时，adapter 可能静默丢弃，形成静默少算。
3. target 装备如果引用了 attacker ownerRole 的 passive，页面可能只显示被动缺失或 blocked reason 不完整，用户难以判断数据错在哪里。
4. 正确的 stats 仍会生效，因此错误被动链很容易被误判成“装备只是不带被动”。
5. 乘区平台越强，错误引用链造成的结果越难从总 DPS 曲线中反推出来。

因此本批优先级高于继续补新机制。先保证“接入了正确的被动”，再开发 `crit context`、`execute_threshold` 或更多装备效果。

## 4. 目标

1. 明确新语义：`skillRefs` 缺失或空数组不再表示全匹配。
2. 对每个被选装备生成引用诊断：missing、empty、unknown skill、wrong ownerType、wrong ownerId、duplicate refs、ownerRole mismatch。
3. attacker 装备只接入 `ownerRole` 非 target 的 DPS passive；target 装备只接入 `ownerRole=target` 的 DPS passive。
4. 页面 preflight 能显示具体 item/skill/reason，而不是只剩 stats-only 或空被动。
5. 保留旧数据兼容路径，但兼容必须可见：旧数据如果依赖空 `skillRefs` 全匹配，要显示 legacy warning，并在迁移后消除。
6. 增加 Web adapter 单测，锁住空引用、错 owner、target ownerRole mismatch 和正确引用。
7. 为后续 published-contract checker 预留同一套诊断结构，避免页面和发布检查各写一套规则。

## 5. 非目标

1. 不实现 `crit context`、seeded crit、兰顿减暴伤真实结算。
2. 不实现 `execute_threshold`、收集者或低血斩杀。
3. 不改变 Batch R `coefficientBuckets` / 乘区 resolver。
4. 不实现 unique passive group 或重复装备规则，只在诊断中保留“重复 refs”提示。
5. 不实现完整结构化 `dpsPassiveEffects` 编辑器；item 页面仍只维护 `skillRefs`，机制 authoring 继续在 skill 的 `mechanicsConfig.dpsPassiveEffects`。
6. 不修改后端 DB schema。若后续要在后端保存时强制拒绝错引用，单独拆后端批次。
7. 不做多目标、距离、rotation、sustain 或 survival。

## 6. 契约决策

### 6.1 `skillRefs` 新语义

建议采用以下语义：

| 输入 | 新语义 | 页面表现 | 是否接入 passive |
| --- | --- | --- | --- |
| `skillRefs` 缺失 | 旧数据不完整 | warning：missing skillRefs | 否，除非开启 legacy fallback |
| `skillRefs=[]` | 明确没有引用 | warning 或 info：stats-only item | 否 |
| `skillRefs=["skill_a"]` | 只引用 skill_a | 正常或具体错误 | 仅 skill_a 通过校验后接入 |
| 重复 id | 数据冗余 | warning：duplicate refs | 去重后继续 |
| 不存在 id | 断链 | error/block | 不接入 |
| ownerType 非 item | 错引用 | error/block | 不接入 |
| ownerId 非当前 itemId | 跨装备错引用 | error/block | 不接入 |

核心原则：新数据必须显式引用。全匹配只允许作为一次性迁移工具或 legacy fallback，不应继续作为默认运行时语义。

### 6.2 Legacy fallback

为了避免旧 bundle 一次性全断，第一版可以保留受控 fallback：

1. adapter 内部提供 `legacyMatchAllWhenSkillRefsMissing` 兼容开关，默认值由调用点决定。
2. WasmValidation 页面和新测试默认使用 strict 语义。
3. 如果发现当前发布 bundle 仍依赖空引用全匹配，可在迁移期显示强 warning，并把 fallback 结果标记为 `legacySkillRefsFallback=true`。
4. 迁移完成后删除 fallback 或默认关闭。

如果实现时确认当前 bundle 已全部有显式 `skillRefs`，则不需要 fallback，直接 strict。

### 6.3 ownerRole 规则

1. attacker equipment:
   - `ownerRole=target` 的 passive 不执行。
   - `ownerRole` 缺失按旧兼容 attacker，但给 warning。
   - `ownerRole` 拼写错误给 error/block。
2. target equipment:
   - 必须存在至少一个 `ownerRole=target` 的 DPS passive，才算 target-side 被动接入。
   - `ownerRole` 缺失不允许按 attacker 默认静默处理，应给 target-specific warning/error。
   - 如果 skill 被引用但所有 passive 都不是 target，页面必须显示 item 级 reason。

## 7. 设计方案

### 7.1 新增诊断类型

在 `web/src/engine/tinygoV2DpsAdapter.ts` 增加内部诊断结构，先不暴露到后端 API：

```ts
type EquipmentSkillRefSeverity = 'info' | 'warning' | 'error';
type EquipmentSkillRefAudience = 'attacker' | 'target';

interface EquipmentSkillRefDiagnostic {
  itemId: string;
  itemName?: string;
  skillId?: string;
  skillName?: string;
  audience: EquipmentSkillRefAudience;
  severity: EquipmentSkillRefSeverity;
  code:
    | 'skillRefs_missing'
    | 'skillRefs_empty'
    | 'skillRefs_duplicate'
    | 'skillRef_unknown_skill'
    | 'skillRef_ownerType_mismatch'
    | 'skillRef_ownerId_mismatch'
    | 'skillRef_ownerRole_mismatch'
    | 'skillRef_legacy_match_all';
  message: string;
}
```

诊断必须能被页面直接格式化，不要求页面再推断原因。

### 7.2 新增引用解析 helper

建议替换当前松散的 `itemSkillLinkedByRefs` 用法，新增一组 helper：

```ts
function resolveItemSkillRefs(
  bundle: GameDataBundle,
  item: Item,
  audience: 'attacker' | 'target',
  options?: { legacyMatchAllWhenSkillRefsMissing?: boolean }
): {
  linkedSkillIds: Set<string>;
  diagnostics: EquipmentSkillRefDiagnostic[];
};
```

行为：

1. `item.skillRefs` 不是数组：返回空 `linkedSkillIds`，诊断 `skillRefs_missing`。
2. `item.skillRefs.length === 0`：返回空 `linkedSkillIds`，诊断 `skillRefs_empty`。
3. 重复 id：去重，诊断 `skillRefs_duplicate`。
4. 每个 ref 必须能在 `bundle.skills` 找到。
5. skill 必须满足 `ownerType === 'item'`。
6. skill 必须满足 `ownerId === item.itemId`。
7. 通过基础校验后，进入 `linkedSkillIds`。
8. audience 为 target 时，后续再校验该 skill 的 DPS passive 是否含 `ownerRole=target`。

不再让 `itemSkillLinkedByRefs` 在空集合时返回 true。可以删除该 helper，或改成 strict：

```ts
function itemSkillLinkedByRefs(skillRefs: Set<string> | undefined, skillId: string): boolean {
  return Boolean(skillRefs && skillRefs.has(skillId));
}
```

### 7.3 adapter 接入点

需要调整这些函数：

1. `itemHasTargetOwnedDpsPassive`
2. `listV2DpsTargetEquipmentOptions`
3. `targetPassiveIdsForEquipment`
4. `resolveDpsItemPassiveEffects`
5. `resolveDpsTargetItemPassiveEffects`
6. `collectTargetEquipmentPassiveBlockedReasons`
7. 与 target skipped / blocked summary 相关的 helper

要求：

1. 所有装备 skill 过滤统一走 `resolveItemSkillRefs` 的 `linkedSkillIds`。
2. attacker 和 target 分别收集诊断。
3. target equipment option/listing 不因空 `skillRefs` 自动把该 item 下所有 target passive 视为候选。
4. resolved snapshot 或 prepared result 中应能带出诊断；如果现有类型不方便，先并入 `targetPassiveBlockedReasons` / skipped summary，但 message 必须包含 itemId、skillId 和 code。

### 7.4 页面展示

在 `web/src/pages/WasmValidationV2DpsPage.tsx` 中只做最小展示：

1. target equipment 区域显示 target-side 引用诊断。
2. DPS Passive 摘要或 preflight 区域显示 attacker-side 引用诊断。
3. severity=error 使用红色/阻断提示；warning 使用黄色提示。
4. 信息要可定位：`itemId / itemName / skillId / reason`。
5. 不在 item 页面直接编辑 `dpsPassiveEffects`。

示例文案：

```text
item 3124 skillRefs is empty; DPS passive links are treated as stats-only under strict mode.
item A references skill X, but skill ownerId is item B.
target item 3075 references skill Y, but no dpsPassiveEffects have ownerRole=target.
```

### 7.5 Admin item 页面

`web/src/pages/admin/resources/items/modal.tsx` 当前已有 structured `skillRefs` selector。本批只做两个小增强，避免扩大范围：

1. selector option 继续只列 item-owned skills。
2. 保存前或表单内提示空 `skillRefs` 的语义：空表示不接入被动，不表示自动匹配。

如果实现成本高，可以只在 WasmValidation preflight 做第一版，Admin item 文案留到下一批。

## 8. 写入范围

默认允许写入：

1. `web/src/engine/tinygoV2DpsAdapter.ts`
2. `web/src/pages/WasmValidationV2DpsPage.tsx`
3. `web/src/pages/admin/resources/items/modal.tsx`
4. `web/src/engine/tinygoV2DpsAdapter.test.ts` 或同目录现有测试文件

如当前 repo 中测试文件命名不同，以现有 adapter 测试文件为准。

只读参考：

1. `web/src/types/api.ts`
2. `web/src/components/skill-editor/skillModels.ts`
3. `文档记录/详细设计/最小验证/V2-ADC随机组合机制头脑风暴与缺口分析.md`
4. `文档记录/详细设计/最小验证/V2-BatchP-单攻击方DPS真实装备联动闭环计划.md`
5. `文档记录/详细设计/最小验证/V2-BatchQ-DPS联动配置编辑与校验成熟度计划.md`

禁止写入：

1. `wasm/tinygo_engine_v2/**`
2. `server/**`
3. `db/**`，除非只是后续为本文档维护治理映射
4. 乘区 Batch R 相关 runtime 文件

## 9. 实施步骤

1. 在 adapter 中实现 `EquipmentSkillRefDiagnostic` 和 `resolveItemSkillRefs`。
2. 将 attacker equipment passive 解析改为 strict skillRefs。
3. 将 target equipment passive 解析改为 strict skillRefs。
4. 调整 target blocked/skipped reason，包含 skillRefs 诊断。
5. 在 WasmValidation 页面展示诊断。
6. 如成本可控，在 Admin item 表单补空 `skillRefs` 语义提示。
7. 添加 adapter 单测。
8. 运行 Web 测试/构建和必要的页面 smoke。

## 10. 测试设计

### 10.1 Adapter 单测

至少覆盖：

1. `skillRefs=[]`：
   - item 有两个 item-owned skills，其中一个含 DPS passive。
   - strict 模式下不接入 passive。
   - 输出 `skillRefs_empty` warning。
2. `skillRefs` 缺失：
   - 不全匹配。
   - 输出 `skillRefs_missing` warning。
3. 引用不存在：
   - 输出 `skillRef_unknown_skill` error。
   - 不接入 passive。
4. ownerType 错：
   - item 引用 hero skill。
   - 输出 `skillRef_ownerType_mismatch` error。
5. ownerId 错：
   - item A 引用 item B 的 skill。
   - 输出 `skillRef_ownerId_mismatch` error。
6. target ownerRole 错：
   - target item 引用 skill，但 passive 只有 `ownerRole=attacker` 或缺失。
   - 输出 `skillRef_ownerRole_mismatch` warning/error。
7. attacker 正确引用：
   - `ownerRole` 缺失或 attacker 的旧数据仍可接入，并给兼容 warning。
8. target 正确引用：
   - `ownerRole=target` 的 passive 能进入 target passive effects。
9. duplicate refs：
   - 去重后只接入一次。
   - 输出 duplicate warning。

### 10.2 页面验收

使用现有 WasmValidation V2 DPS 页面：

1. 选择正常 ADC 装备，DPS passive 摘要不退化。
2. 选择构造的空 `skillRefs` 装备，页面显示 stats-only / warning，不显示该装备被动。
3. 选择构造的 target ownerRole 错误装备，页面显示具体 item reason。
4. target 反伤 / 减伤类正确引用时，target passive summary 仍出现。

页面 smoke 不要求新增真实数据库数据；可用测试 bundle 或 seed fixture。

### 10.3 回归关注

1. 鬼索、海妖、破败等已验证真实装备不能因为 strict 语义丢失被动。
2. target equipment selection 不能因为空引用全匹配而出现额外 target options。
3. `passiveIds` 列表不能包含重复 id。
4. 错误引用不能造成 runtime blocked reason 难以定位；应在 adapter/preflight 层先解释。

## 11. 验证命令

具体命令以 `web/README.md` 和 package scripts 为准。Cursor 执行前必须先读取最近层规则。

最低验证：

```powershell
npm test -- --run tinygoV2DpsAdapter
npm run build
```

如果 repo 使用 pnpm/yarn 或测试脚本不同，执行者必须先用 `Get-Content web/package.json` 确认实际脚本，并在回报中说明替代命令。

页面涉及 WasmValidation 时，GPT/Codex 最终验收应启动/复用前端并用浏览器走一次页面 smoke；Cursor 不负责最终验收。

## 12. Cursor 执行提示词

开发时使用以下提示词，必须固定 `grok-4.5`：

```text
目标：实现 Batch S-0 DPS 装备 skillRefs 引用契约与 preflight 硬化，防止装备被动因空 skillRefs、错 ownerType/ownerId、ownerRole mismatch 而静默多算或少算。

允许写入范围：
- web/src/engine/tinygoV2DpsAdapter.ts
- web/src/pages/WasmValidationV2DpsPage.tsx
- web/src/pages/admin/resources/items/modal.tsx
- web/src/engine/tinygoV2DpsAdapter.test.ts 或现有 adapter 测试文件

只读参考：
- web/src/types/api.ts
- web/src/components/skill-editor/skillModels.ts
- 文档记录/详细设计/最小验证/V2-BatchS-0-DPS装备技能引用契约与Preflight硬化计划.md
- 文档记录/详细设计/最小验证/V2-ADC随机组合机制头脑风暴与缺口分析.md

非目标：
- 不修改 wasm/tinygo_engine_v2/**
- 不修改 server/**
- 不实现 crit context、execute_threshold、rotation、sustain、multi-target、distance
- 不改乘区 Batch R 运行时逻辑
- 不在 item 表单编辑 dpsPassiveEffects

实现要求：
1. 新增 EquipmentSkillRefDiagnostic 与统一 resolveItemSkillRefs helper。
2. 缺失或空 skillRefs 在 strict 语义下不得全匹配。
3. 校验引用 skill 存在、ownerType=item、ownerId=itemId。
4. attacker 装备不执行 ownerRole=target 的 passive。
5. target 装备必须显示 ownerRole=target 相关诊断。
6. WasmValidation 页面展示 itemId/skillId/reason。
7. 添加 adapter 单测覆盖空引用、缺失引用、不存在 skill、ownerType 错、ownerId 错、ownerRole mismatch、正确 attacker/target 引用、重复 refs。

停止条件：
- 如果发现当前 published bundle 大量依赖空 skillRefs 全匹配，停止并报告需要迁移或 legacy fallback，不要直接让所有装备被动消失。
- 如果需要修改后端 DB schema 或 Wasm runtime，停止并报告。
- 如果测试脚本不明确，先读取 web/package.json 再选择命令。

验证命令：
- 先确认 web/package.json 的实际 scripts。
- 运行 adapter 相关单测。
- 运行 web build。
```

## 13. 完成定义

1. 空 `skillRefs` 不再静默全匹配。
2. 错 ownerType/ownerId 不再静默少算，页面可见原因。
3. target ownerRole mismatch 可见。
4. 正确引用的装备被动仍正常进入 resolved snapshot。
5. 测试覆盖 P0 引用链风险。
6. GPT/Codex review Cursor diff 后确认没有触碰非目标范围。

## 14. 剩余风险

1. 如果旧发布数据依赖空引用全匹配，需要先迁移数据或保留短期 fallback。
2. unique passive group 和重复装备仍未解决；本批只避免错引用，不定义重复装备收益。
3. 后端保存时是否强制拒绝错引用尚未纳入本批；第一版可以在 Web adapter/preflight 层阻断，后续再把同规则前移到发布检查。
4. Admin skill 的 `ownerRole` 缺失兼容仍存在；target 装备场景需要页面诊断兜底。
