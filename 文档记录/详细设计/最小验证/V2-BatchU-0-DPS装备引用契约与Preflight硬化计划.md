TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-06-13

# V2 Batch U-0 DPS 装备引用契约与 Preflight 硬化计划

关联概要：[验证里程碑V2](../../概要设计/验证里程碑V2.md)

前置问题来源：[V2-BatchS-0-DPS装备技能引用契约与Preflight硬化计划](./V2-BatchS-0-DPS装备技能引用契约与Preflight硬化计划.md)

前置数值与暴击上下文：[V2-BatchT-DPS通用数值边界与暴击上下文计划](./V2-BatchT-DPS通用数值边界与暴击上下文计划.md)

## 1. 文档边界

本文是 Batch U-0 的详细设计和 Cursor 执行真源。它把 Batch S-0 中识别出的装备 `skillRefs`、`ownerType/ownerId`、`ownerRole` 风险收口成一个可开发批次。

Batch U-0 不新增装备机制，也不补真实装备数据。它只解决一个工程安全问题：DPS 装备被动不能因为空引用、错 owner 或错 ownerRole 而静默多算或少算。

Batch S-0 保留为前置问题分析；后续编码会话以本文的写入范围、测试矩阵和 Cursor prompt 为准。

## 2. 当前风险

当前 DPS 装备链路的高风险点是：

1. `skillRefs` 缺失或空数组可能被旧逻辑解释为“匹配该 item owner 下所有 skill”。
2. `skillRefs` 指向不存在的 skill 时，用户很难从 DPS 曲线判断是数据断链。
3. `skillRefs` 指向其他 item 或 hero 的 skill 时，可能形成静默少算。
4. target 装备如果引用了 `ownerRole=attacker` 或缺失 ownerRole 的 passive，页面可能只表现为被动未生效，而不是定位到数据归属错误。
5. Batch T 已经提升了暴击和数值边界能力；继续新增真实装备前，必须先保证“接入的是正确被动”。

## 3. 目标

1. `skillRefs` 缺失或空数组不再默认全匹配 item-owned skills。
2. item 引用 skill 时必须校验：
   - skill 存在。
   - `ownerType === "item"`。
   - `ownerId === item.itemId`。
   - 重复 refs 可诊断且不会重复接入。
3. attacker 装备不执行 `ownerRole=target` 的 passive。
4. target 装备只接受 `ownerRole=target` 的 passive。
5. V2 DPS 页面显示装备引用诊断，至少包含 `itemId`、`itemName`、`skillId`、`skillName`、`code`、`severity` 和可读 message。
6. Adapter 单测覆盖空引用、缺失引用、错 owner、target ownerRole mismatch 和正常引用。
7. 为后续 published-contract checker 预留同一套诊断结构。

## 4. 非目标

1. 不实现兰顿真实暴击减伤闭环。
2. 不实现 `execute_threshold`。
3. 不改 Wasm runtime。
4. 不改 backend DB/API。
5. 不做完整 `dpsPassiveEffects` 结构化编辑器。
6. 不定义 unique passive group 或重复装备规则。
7. 不补真实装备数值，不要求用户提供 OCR 或训练营数据。

## 5. 写入范围

默认允许写入：

1. `C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.ts`
2. `C:\project\damage_web_dev\web\src\pages\WasmValidationV2DpsPage.tsx`
3. `C:\project\damage_web_dev\web\src\pages\admin\resources\items\modal.tsx`
4. `C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.test.ts` 或当前 repo 中现有 adapter 测试文件

只读参考：

1. `C:\project\damage_web_dev\web\src\types\api.ts`
2. `C:\project\damage_web_dev\web\src\components\skill-editor\skillModels.ts`
3. `C:\project\damage_web_dev\web\AGENTS.md`
4. `C:\project\damage_web_dev\web\README.md`
5. 本文档和 Batch S-0 / Batch T 相关计划

禁止写入：

1. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2/**`
2. `C:\project\damage_backend_dev/**`
3. `db/**`
4. 与 V2 DPS 页面无关的通用 UI 大重构

## 6. 诊断契约

新增或等价实现以下诊断类型：

```ts
type EquipmentSkillRefSeverity = 'info' | 'warning' | 'error';
type EquipmentSkillRefAudience = 'attacker' | 'target';

type EquipmentSkillRefDiagnosticCode =
  | 'skillRefs_missing'
  | 'skillRefs_empty'
  | 'skillRefs_duplicate'
  | 'skillRef_unknown_skill'
  | 'skillRef_ownerType_mismatch'
  | 'skillRef_ownerId_mismatch'
  | 'skillRef_ownerRole_mismatch';

interface EquipmentSkillRefDiagnostic {
  itemId: string;
  itemName?: string;
  skillId?: string;
  skillName?: string;
  audience: EquipmentSkillRefAudience;
  severity: EquipmentSkillRefSeverity;
  code: EquipmentSkillRefDiagnosticCode;
  message: string;
}
```

页面只能格式化这些 diagnostics，不能在页面层重新推导业务规则。

## 7. Helper 设计

新增统一 helper，替代散落的宽松匹配：

```ts
function resolveItemSkillRefs(
  bundle: GameDataBundle,
  item: Item,
  audience: 'attacker' | 'target'
): {
  linkedSkillIds: Set<string>;
  diagnostics: EquipmentSkillRefDiagnostic[];
};
```

行为要求：

1. `item.skillRefs` 不是数组或缺失：返回空 `linkedSkillIds`，输出 `skillRefs_missing`。
2. `item.skillRefs.length === 0`：返回空 `linkedSkillIds`，输出 `skillRefs_empty`。
3. 重复 id：去重后继续，输出 `skillRefs_duplicate`。
4. ref 找不到 skill：不接入，输出 `skillRef_unknown_skill`。
5. skill `ownerType !== "item"`：不接入，输出 `skillRef_ownerType_mismatch`。
6. skill `ownerId !== item.itemId`：不接入，输出 `skillRef_ownerId_mismatch`。
7. 基础校验通过后进入 `linkedSkillIds`。
8. `ownerRole` 由后续 passive 解析阶段校验，因为一个 skill 下可能有多个 `dpsPassiveEffects`。

旧的宽松判断不得继续存在于关键路径中：

```ts
!skillRefs || skillRefs.size === 0 || skillRefs.has(skillId)
```

如果需要保留旧 helper，必须改为 strict：

```ts
function itemSkillLinkedByRefs(skillRefs: Set<string> | undefined, skillId: string): boolean {
  return Boolean(skillRefs && skillRefs.has(skillId));
}
```

## 8. Adapter 接入规则

需要检查并调整以下路径，名称以当前代码为准：

1. attacker equipment passive 解析路径。
2. target equipment passive 解析路径。
3. target equipment option/listing 路径。
4. target passive blocked/skipped reason 生成路径。
5. resolved snapshot / prepared result 中用于页面展示 preflight 的结构。

规则：

1. attacker 装备只接入 linked skill 中 `ownerRole` 为空或不是 target 的 passive。
2. attacker 装备遇到 `ownerRole=target` 时，不执行并输出 `skillRef_ownerRole_mismatch`。
3. target 装备只接入 linked skill 中 `ownerRole=target` 的 passive。
4. target 装备遇到 `ownerRole` 缺失或非 target 时，不执行并输出 `skillRef_ownerRole_mismatch`。
5. diagnostics 应随 adapter 结果进入页面 preflight 或等价展示结构。
6. 正确引用的现有 attacker 装备被动不能退化。

## 9. 页面展示

在 `WasmValidationV2DpsPage` 做最小展示：

1. Preflight 或 Passive summary 区域显示 equipment skill ref diagnostics。
2. `severity=error` 使用错误状态，`warning` 使用警告状态，`info` 使用普通说明状态。
3. 每条诊断必须能定位到 item 和 skill；skill 不存在时至少显示 ref id。
4. 页面展示不阻塞所有运行；是否阻塞由 adapter / existing preflight 状态决定。U0 第一版至少必须可见。

Admin item 页可选增强：

1. `skillRefs` 选择器继续只列 item-owned skills。
2. 空 `skillRefs` 明示为“不接入被动”，不是自动匹配。
3. 如果实现成本超过最小展示，Admin 文案可留到后续，不能扩大成完整机制编辑器。

## 10. 测试矩阵

Adapter 单测至少覆盖：

| 用例 | 输入 | 预期 |
| --- | --- | --- |
| 空 refs | `skillRefs=[]`，item 下有 DPS passive skill | 不接入 passive；输出 `skillRefs_empty` |
| 缺失 refs | item 无 `skillRefs` | 不全匹配；输出 `skillRefs_missing` |
| unknown ref | `skillRefs=["missing"]` | 不接入；输出 `skillRef_unknown_skill` error |
| ownerType 错 | item 引用 hero skill | 不接入；输出 `skillRef_ownerType_mismatch` error |
| ownerId 错 | item A 引用 item B skill | 不接入；输出 `skillRef_ownerId_mismatch` error |
| duplicate refs | `["skill_a", "skill_a"]` | 只接入一次；输出 duplicate warning |
| attacker 正确引用 | item 引用 ownerRole 缺失或 attacker passive | 正常接入；如旧兼容需要 warning，则 message 可见 |
| attacker 引用 target passive | `ownerRole=target` | 不执行；输出 ownerRole mismatch |
| target 正确引用 | target item 引用 `ownerRole=target` passive | 正常接入 target passive |
| target 引用 attacker/missing ownerRole | target item 引用非 target passive | 不执行；输出 ownerRole mismatch |

页面 smoke：

1. 打开 V2 DPS 页面。
2. 使用正常装备路径确认原有 passive summary 不退化。
3. 使用测试 fixture 或构造 bundle 触发至少一个引用诊断。
4. 页面能显示 item/skill/reason。

## 11. 验证命令

进入 Web worktree 后先确认脚本：

```powershell
cd C:\project\damage_web_dev\web
Get-Content -Raw package.json
```

优先执行：

```powershell
npm test -- --run tinygoV2DpsAdapter
npm run build
```

如果测试脚本名不同，按 `package.json` 中实际脚本替代，并在回报中说明。

页面展示有改动时，GPT/Codex 最终必须启动或复用 dev server，并用浏览器 smoke V2 DPS 页面。

## 12. Cursor 执行提示词

开发时使用 Cursor SDK，本批固定 `composer-2.5` 且 `fast=false`。

```text
目标：实现 V2 Batch U-0 DPS 装备 skillRefs / ownerRole 契约硬化，防止装备被动因空 skillRefs、错 ownerType/ownerId、ownerRole mismatch 而静默多算或少算。

执行模型：Cursor composer-2.5，fast=false。

允许写入范围：
- C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.ts
- C:\project\damage_web_dev\web\src\pages\WasmValidationV2DpsPage.tsx
- C:\project\damage_web_dev\web\src\pages\admin\resources\items\modal.tsx
- C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.test.ts 或当前 repo 中现有 adapter 测试文件

只读参考：
- C:\project\damage_web_dev\web\src\types\api.ts
- C:\project\damage_web_dev\web\src\components\skill-editor\skillModels.ts
- C:\project\damage_web_dev\web\AGENTS.md
- C:\project\damage_web_dev\web\README.md
- C:\project\damage_viewer_project_planning\文档记录\详细设计\最小验证\V2-BatchU-0-DPS装备引用契约与Preflight硬化计划.md
- C:\project\damage_viewer_project_planning\文档记录\详细设计\最小验证\V2-BatchS-0-DPS装备技能引用契约与Preflight硬化计划.md

非目标：
- 不修改 wasm/tinygo_engine_v2/**
- 不修改 backend/server/db
- 不实现兰顿真实暴击减伤闭环
- 不实现 execute_threshold、rotation、sustain、multi-target、distance
- 不实现完整 dpsPassiveEffects 表单编辑器
- 不定义 unique passive 或重复装备规则

实现要求：
1. 新增 EquipmentSkillRefDiagnostic 及 code/severity/audience 类型，或等价结构。
2. 新增 resolveItemSkillRefs(bundle, item, audience) helper。
3. skillRefs 缺失或空数组在 strict 语义下不得全匹配。
4. 校验引用 skill 存在、ownerType=item、ownerId=itemId。
5. 重复 refs 去重并输出 diagnostic。
6. attacker 装备不得执行 ownerRole=target 的 passive。
7. target 装备只接入 ownerRole=target 的 passive；缺失或 attacker ownerRole 必须输出 diagnostic。
8. WasmValidation V2 DPS 页面展示 diagnostics，包含 itemId/skillId/code/severity/message。
9. 页面只展示 adapter 输出，不重新推导业务规则。
10. 添加 adapter 单测覆盖空引用、缺失引用、不存在 skill、ownerType 错、ownerId 错、ownerRole mismatch、正确 attacker/target 引用、重复 refs。

停止条件：
- 如果发现当前真实 published bundle 或 fixture 大量依赖“空 skillRefs 全匹配”，停止并报告需要迁移或短期 legacy fallback，不要直接让所有装备被动消失。
- 如果需要改 Wasm runtime，停止并报告。
- 如果需要改 backend DB/API，停止并报告。
- 如果需要实现完整 dpsPassiveEffects 表单编辑器，停止并报告。
- 如果需要定义 unique passive 或重复装备规则，停止并报告。

验证命令：
- 先读取 C:\project\damage_web_dev\web\package.json 确认脚本。
- 优先运行 npm test -- --run tinygoV2DpsAdapter。
- 运行 npm run build。
```

## 13. Cursor Runner 草案

GPT/Codex 启动开发前应先把上面的提示词写入 artifact，再执行类似命令：

```powershell
node C:\project\damage_wasm_dev\.agents\skills\cursor-local-agent\scripts\cursor_local_agent_run.mjs `
  --cwd C:\project\damage_web_dev `
  --prompt-file C:\project\damage_wasm_dev\.agents\artifacts\batch-u0-skillrefs-contract\prompt.txt `
  --allowed-path web\src\engine `
  --allowed-path web\src\pages\WasmValidationV2DpsPage.tsx `
  --allowed-path web\src\pages\admin\resources\items `
  --out-dir C:\project\damage_wasm_dev\.agents\artifacts\batch-u0-skillrefs-contract\run-001 `
  --timeout-ms 600000
```

Cursor 返回后，GPT/Codex 必须检查：

1. `summary.json`
2. `events.jsonl`
3. `diff.patch`
4. `git diff`
5. 本文验证命令结果

## 14. 完成定义

1. 空 `skillRefs` 不再静默全匹配。
2. 错 ownerType/ownerId 不再静默少算，页面可见原因。
3. target ownerRole mismatch 可见。
4. 正确引用的装备被动仍能进入 resolved snapshot。
5. Adapter 单测覆盖 P0 引用链风险。
6. Web build 通过。
7. 页面展示变更经过浏览器 smoke。
8. GPT/Codex review Cursor diff 后确认没有触碰非目标范围。

## 15. 后续批次

U0 完成后，建议继续：

1. [Batch U-1：兰顿 + 暴击减伤真实装备闭环](./V2-BatchU-1-兰顿暴击减伤真实装备闭环计划.md)，消费 Batch T 的 crit context。
2. [Batch U-2：`execute_threshold`](./V2-BatchU-2-DPS斩杀阈值execute-threshold计划.md)，覆盖收集者和低血量斩杀类机制。
3. [Batch U-3：published-contract checker](./V2-BatchU-3-Published契约检查与发布前Preflight计划.md)，把 U0 diagnostics 前移到发布检查。
