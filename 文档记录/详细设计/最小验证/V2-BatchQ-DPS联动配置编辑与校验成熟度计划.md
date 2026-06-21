TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-06-07

# V2 Batch Q DPS 联动配置编辑与校验成熟度计划

关联概要：[验证里程碑V2.md](../../概要设计/验证里程碑V2.md)

关联总方案：[V2-单攻击方DPS协议与开发计划.md](./V2-单攻击方DPS协议与开发计划.md)

前置机制：[V2-BatchO-单攻击方DPS事件化联动机制计划.md](./V2-BatchO-单攻击方DPS事件化联动机制计划.md)

真实装备闭环前置：[V2-BatchP-单攻击方DPS真实装备联动闭环计划.md](./V2-BatchP-单攻击方DPS真实装备联动闭环计划.md)

## 1. 文档边界

本文是 Batch Q 的执行真源，不是测试记录。本文只描述开发方案、写入范围、Cursor 任务和验收条件；真正执行时必须先按当前 worktree 状态复核，再启动 Cursor。

Batch Q 的目标不是新增某个装备，也不是把 DPS 页升级成完整战斗编辑器。Batch Q 要把 Batch O/P 已经具备的 linked-effect 机制变成可配置、可校验、可发布审计、可页面回归的工程入口，避免后续每补一件装备都依赖 seed 手写和 JSON 盲填。

当前需要成熟化的核心对象是：

```text
skill.mechanicsConfig.dpsPassiveEffects[]
  ownerRole
  sourceCategory/sourceType/sourceId
  trigger.event
  trigger.matcher
  priority
  operations[]
    kind
    targetRole
    valuePhase
    critOnly
    damage/stat/stack/dot/repeat fields
```

Batch Q 只围绕这个对象做编辑可见性、最小校验、发布保真审计和页面验证闭环。它不改变 Batch O/P 的 runtime 机制主轴。

## 2. 当前事实

以下事实来自 2026-06-07 当前 worktree 核对：

1. `C:\project\damage_wasm_dev` 当前分支为 `wasm/dev`，工作区干净。
2. Batch O 已在 `single_attacker_dps` 中引入 owner-aware / event-context-aware linked effect dispatcher，并有 `on_spell_hit` synthetic proof。
3. Batch P 已让 DPS 页支持 target equipment，adapter 能把 target-owned `dpsPassiveEffects` 投影进 Wasm，黑切/反甲真实数据闭环已完成。
4. `web/src/components/skill-editor/SkillMechanicsConfigEditor.tsx` 当前结构化编辑仍主要围绕 `mechanicsConfig.triggers`，没有 `dpsPassiveEffects` 摘要区域。
5. `web/src/pages/admin/resources/skills/modal.tsx` 只有 `mechanicsConfig JSON` 文本域能完整编辑 `dpsPassiveEffects`，但缺少面向 DPS passive 的字段级提示和错误提示。
6. `web/src/components/skill-editor/skillModels.ts` 的 `parseMechanicsConfig` / `stringifyMechanicsConfig` 会保留 `baseRoot` 上的额外字段，但没有解析 `dpsPassiveEffects` 为可展示模型。
7. Backend 主代码对 `mechanicsConfig` 的硬校验仍集中在 object、`version=1`、`triggers` 数组；Batch P 的字段保真主要由 seed/import/publish 测试证明。
8. `on_spell_hit` 目前只证明 dispatcher 可接收 spell-hit 上下文；Web DPS 页面仍以 `resolvedSnapshot.basicAttackActions` 驱动，不提供真实技能命中事件输入。

## 3. 问题定义

Batch P 之后已经能证明“真实装备可以进入 DPS linked-effect runtime”，但还不能算“配置体系成熟”。当前问题是：

```text
现在：
seed/import 或 JSON 文本域手写 dpsPassiveEffects
-> publish 透传
-> DPS 页面投影
-> Wasm 运行

缺口：
Admin 编辑时看不清 dpsPassiveEffects 结构
-> 错 ownerRole / trigger.event / operations.kind 不容易发现
-> Backend 保存/发布侧缺少 schema 级错误保护
-> 后续新增装备或英雄被动容易变成一次性 JSON 手工活
```

Batch Q 要解决的是配置入口质量，不是机制表达能力本身。机制表达能力继续由 Batch O/P 的 runtime tests 和真实数据 live proof 约束。

## 4. 目标

Batch Q 分成五个 gate。可以分多轮 Cursor 执行，但最终完成必须全部闭环。

| Gate | 目标 | 可单独通过 |
| --- | --- | --- |
| `Q-contract-pass` | 固定 `dpsPassiveEffects` 编辑、摘要、校验和发布审计边界 | 是 |
| `Q-web-admin-summary-pass` | Web admin 技能编辑页展示 DPS passive 摘要，并保留完整 JSON 编辑能力 | 否，依赖 contract |
| `Q-web-admin-validation-pass` | Web 保存前对 `dpsPassiveEffects` 做最小结构校验和可读错误提示 | 否，依赖 summary |
| `Q-backend-schema-audit-pass` | Backend 保存/发布链路对 `dpsPassiveEffects` 做保真审计或最小 schema 校验，测试覆盖坏配置 | 否，依赖 contract |
| `Q-live-regression-pass` | 用 3071/3075 证明好配置仍能发布并触发，用坏配置证明会被提示或阻断 | 否，依赖 web/backend |

只完成 admin 摘要时，不得宣称 Batch Q 完成。必须至少同时证明：好配置不丢字段，坏配置不会静默发布成不可解释的 runtime 输入。

## 5. 非目标

1. 不实现完整 nested form builder。
2. 不把 `mechanicsConfig.triggers` 和 `dpsPassiveEffects` 合并成一个新 schema。
3. 不新增真实卢登用户流，不实现主动技能 rotation，不新增自由 action queue。
4. 不在 Wasm runtime 中新增装备或英雄专用分支。
5. 不让 Web 计算业务伤害；Web 只做配置校验、投影、展示和导出。
6. 不在本批补全所有 ADC/坦克装备数据。
7. 不因为配置校验而拒绝当前已合法发布的旧 `dpsPassiveEffects` 形状；需要兼容旧字段如 `triggerKind`、`everyN`、`procScope`。
8. 不要求后端主代码一定有大改。如果现有 JSONB 透传已足够，后端可以只补最小 schema 校验和测试；但必须有可复核证据。

## 6. 数据契约

### 6.1 Admin 摘要模型

Web admin 不需要把 `dpsPassiveEffects` 完整表单化，但必须能把每个 passive 摘要成稳定行：

```ts
export type SkillDpsPassiveSummaryRow = {
  index: number;
  passiveId: string;
  source: string;
  ownerRole: string;
  triggerEvent: string;
  matcherSummary: string;
  priority: number | null;
  operationKinds: string[];
  targetRoles: string[];
  warnings: string[];
};
```

摘要读取规则：

1. `passiveId` 优先读 `passiveId`，其次 `effectId`，缺失显示 `#<index>`。
2. `source` 用 `sourceCategory/sourceType/sourceId` 拼接，缺失时显示 `unknown`。
3. `ownerRole` 缺失时显示 `attacker(default)`，但 warning 提示“旧兼容默认 attacker”。
4. `triggerEvent` 优先读 `trigger.event`，其次用旧 `triggerKind` 映射展示。
5. `matcherSummary` 至少展示 `damageTypes/actionTypes/effectTypes/effectTags/sourceTypes/sourceCategories/procScopes/includePhantom/excludePhantom` 中存在的字段。
6. `operationKinds` 来自 `operations[].kind`，未知 kind 仍展示原值并 warning，不要丢字段。
7. `targetRoles` 来自 `operations[].targetRole`，缺失按 operation 语义提示默认目标，不主动补写。

### 6.2 前端最小校验

保存前或 JSON 修改后，前端至少检查：

1. `mechanicsConfig` 必须是 JSON object。
2. `version` 必须为 `1`。
3. `triggers` 必须存在且为数组；允许空数组。
4. 如果存在 `dpsPassiveEffects`，必须是数组。
5. 每个 passive 必须是 object。
6. `ownerRole` 如存在，必须是 `attacker` 或 `target`；缺失允许但提示默认 attacker。
7. `trigger.event` 如存在，必须属于：
   - `on_basic_attack_hit`
   - `on_spell_hit`
   - `on_hit`
   - `on_damage_dealt`
   - `on_damage_taken`
   - `dot_tick`
8. `operations` 如存在，必须是数组；空数组给 warning。
9. `operations[].kind` 如存在，必须属于当前 DPS 支持集合或被标记为 unknown warning：
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
10. `operations[].targetRole` 如存在，必须是 `attacker` 或 `target`。
11. `damage_modifier.critOnly=true` 必须显示 warning：当前 DPS 缺少真实 crit context 时会 blocked，不得在页面宣称兰顿已通过。

校验分两级：

```text
error: 不能保存，JSON 或核心结构错误
warning: 可以保存，但摘要区必须展示风险
```

### 6.3 后端最小校验

Backend 应在保存或发布前至少能发现结构性错误。推荐实现位置：

1. Admin skill 保存：`PostgresWriteStore.validateMechanicsConfig(...)`
2. 发布语义校验：`PostgresWriteStore` 中 skill mechanicsConfig 校验分支
3. Batch seed/import/publish 测试：`KatarinaMvpImportMainTest` 和已有 publish flow tests

后端 error 级规则：

1. `mechanicsConfig.dpsPassiveEffects` 存在但不是数组。
2. passive 不是 object。
3. `ownerRole` 存在但不是 `attacker|target`。
4. `trigger` 存在但不是 object。
5. `trigger.event` 存在但不是受支持事件。
6. `operations` 存在但不是数组。
7. operation 不是 object。
8. `targetRole` 存在但不是 `attacker|target`。

后端 warning 级规则不一定要落主代码；如果没有统一 warning 机制，先用测试记录和前端 warning 承担。不要为了 warning 发明新 API。

## 7. Web 实现方案

### 7.1 写入范围

默认允许写入：

1. `C:\project\damage_web_dev\web\src\components\skill-editor\skillModels.ts`
2. `C:\project\damage_web_dev\web\src\components\skill-editor\SkillMechanicsConfigEditor.tsx`
3. `C:\project\damage_web_dev\web\src\pages\admin\resources\skills\modal.tsx`
4. 必要时最小修改 `C:\project\damage_web_dev\web\src\pages\admin\resources\skills\index.tsx`

只读参考：

1. `C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.ts`
2. `C:\project\damage_web_dev\web\src\pages\WasmValidationV2DpsPage.tsx`
3. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go`
4. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver.go`

### 7.2 `skillModels.ts`

新增纯解析和校验函数，避免在 React 组件里写复杂 JSON 判断：

```ts
export type SkillDpsPassiveSummaryRow = { ... };
export type SkillDpsPassiveValidationIssue = {
  severity: 'error' | 'warning';
  path: string;
  message: string;
};

export function summarizeDpsPassiveEffects(root: JsonObject): SkillDpsPassiveSummaryRow[];
export function validateDpsPassiveEffects(root: JsonObject): SkillDpsPassiveValidationIssue[];
```

实现要求：

1. 不修改原始 JSON，只读解析。
2. 不把 unknown 字段丢掉。
3. 与 `stringifyMechanicsConfig(baseRoot, ...)` 保持兼容，确保 `dpsPassiveEffects` 随 `baseRoot` 保留。
4. 新增测试如果当前 web 没有 test runner，可先通过 TypeScript build 覆盖类型，手动在页面 smoke 中验证。

### 7.3 `SkillMechanicsConfigEditor.tsx`

在结构化 mechanicsConfig 区域增加 “DPS Passive 摘要” 面板：

1. 显示 passive 数量。
2. 按 `ownerRole` 分组显示 attacker / target / other。
3. 每行显示：
   - `passiveId`
   - `source`
   - `triggerEvent`
   - `matcherSummary`
   - `operationKinds`
   - `targetRoles`
4. warning 以 `Alert` 或轻量标签展示。
5. error 以 `Alert type="error"` 展示。
6. 如果没有 `dpsPassiveEffects`，显示空态，不要让用户误以为必须配置。

组件入参需要拿到完整 `mechanicsConfig.root`：

```ts
root: JsonObject;
```

不要把 `dpsPassiveEffects` 拆成独立状态写回，当前批次仍由 JSON 文本域编辑完整对象。

### 7.4 `modal.tsx` / 保存前校验

保存前必须阻断 error 级问题。可选实现：

1. 在 `mechanicsConfigState` 中派生 `dpsPassiveIssues`。
2. 当存在 error 时：
   - 结构化编辑区显示 error。
   - 保存按钮或保存流程阻断。
3. warning 不阻断保存，但必须可见。

如果当前保存逻辑集中在 `index.tsx`，则把 `validateDpsPassiveEffects` 放到 payload 构造处调用。

## 8. Backend 实现方案

### 8.1 写入范围

默认允许写入：

1. `C:\project\damage_backend_dev\server\data_manage\src\main\java\xyz\game\datamanage\service\PostgresWriteStore.java`
2. `C:\project\damage_backend_dev\server\data_manage\src\test\java\xyz\game\datamanage\tools\KatarinaMvpImportMainTest.java`
3. 必要时最小修改相关 integration test。

只读参考：

1. `C:\project\damage_backend_dev\server\data_manage\src\main\java\xyz\game\datamanage\service\PostgresReadStore.java`
2. `C:\project\damage_backend_dev\server\data_manage\src\test\java\xyz\game\datamanage\integration\ControllerPublishFlowIT.java`
3. `C:\project\damage_backend_dev\最小验证\V2-Batch-P-target-equipment-linked-effects.seed.json`

### 8.2 `PostgresWriteStore` 校验

在现有 `validateMechanicsConfig` 基础上追加 `validateDpsPassiveEffects`，保持 collect-all 风格优先。

建议 helper：

```java
private void validateDpsPassiveEffects(ObjectNode mechanicsConfig)
private void validateDpsPassiveEffect(JsonNode passive, int passiveIndex)
private void validateDpsPassiveOperation(JsonNode operation, int passiveIndex, int operationIndex)
```

如果现有校验工具链只能单点抛错，先保持现有风格，不为 Batch Q 重构全局错误收集。

错误路径建议：

```text
/mechanicsConfig/dpsPassiveEffects
/mechanicsConfig/dpsPassiveEffects/0/ownerRole
/mechanicsConfig/dpsPassiveEffects/0/trigger/event
/mechanicsConfig/dpsPassiveEffects/0/operations/0/targetRole
```

### 8.3 后端测试

至少新增或扩展以下 tests：

1. `mechanicsConfig.dpsPassiveEffects` 为 object 时保存失败。
2. `ownerRole=ally` 保存或发布失败。
3. `trigger.event=on_unknown_event` 保存或发布失败。
4. `operations` 为 object 时失败。
5. `targetRole=source` 失败。
6. Batch P 的 3071/3075 seed publish passthrough 仍通过。

如果当前测试入口更适合工具类 seed 校验，不强制新增 controller IT；但最终必须有至少一个测试证明主保存/发布链不会静默接受坏结构。

## 9. Wasm 范围

Batch Q 默认不修改 Wasm runtime。

允许只读核对：

1. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go`
2. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver.go`
3. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go`

只有发现 Web/Backend 校验规则与 Wasm 当前 DTO 或 validation 明显冲突时，才允许停止并回报，不直接改 Wasm。

## 10. 卢登与 spell-hit 边界

Batch Q 必须明确保留以下结论：

1. `on_spell_hit` 目前是 Wasm synthetic dispatcher proof。
2. 用户页面真实触发卢登需要显式 spell-hit 输入或受限技能事件 preset。
3. 这不是 Batch Q 的范围。

后续如果要做卢登，推荐另开 Batch R：

```text
Batch R: DPS explicit spell-hit event preset
目标：不做完整 rotation，只允许用户选择一个已发布技能，按固定时间点注入一次 spell-hit event，让 on_spell_hit 装备 passive 可从真实页面触发。
非目标：不做技能循环、不做 QWER 自动施放、不做敌方行动。
```

Batch Q 的 admin 摘要可以显示 `on_spell_hit`，但不得在页面文案中暗示真实卢登已自然触发。

## 11. 页面与 live 验证

### 11.1 自动化命令

Wasm 文档映射：

```powershell
cd C:\project\damage_wasm_dev
node tools/task-governance/cli.mjs rebuild
node tools/task-governance/cli.mjs docs planning-validation-milestones
```

Web：

```powershell
cd C:\project\damage_web_dev\web
npm run build
```

Backend：

```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn -Dtest=KatarinaMvpImportMainTest test
mvn test
```

如果实际改到发布主链路或 controller，需要补 live 接口回归：

```text
GET /api/games
GET /api/games/lol/versions/current
GET /api/games/lol/versions/{versionCode}/bundle
Admin skill 保存一条含 dpsPassiveEffects 的测试配置
```

### 11.2 浏览器 smoke

必须验证：

1. Admin skills 编辑已有 item-owned skill 时，能看到 DPS passive 摘要。
2. 3071 黑切 passive 显示 attacker / on_damage_dealt / add_stack + stat_modifier / targetRole=target。
3. 3075 反甲 passive 显示 target / on_damage_taken / damage / targetRole=attacker。
4. 把 `ownerRole` 临时改成非法值时，页面给 error 并阻断保存。
5. 把 `critOnly=true` 的 damage_modifier 配置展示为 warning，不宣称可通过。
6. DPS 页面仍能选择 3071 attacker + 3075 target，并导出包含 target passive 的 JSON。

如果没有可用 admin token、登录权限或 live DB，必须说明已完成自动化验证，剩余项交给用户或后续授权验证。

## 12. Cursor 执行约束

Cursor 必须使用 `composer-2.5` + `fast=false`。GPT/Codex 负责 prompt 编写、diff review、验证和最终验收。

### 12.1 Cursor Prompt: Q1 Web Admin Summary

```text
目标：
在 Web admin skill editor 中为 mechanicsConfig.dpsPassiveEffects 增加只读摘要和最小前端校验。保持 mechanicsConfig JSON 文本域完整可编辑，不实现完整 nested form builder。

允许写入：
- C:\project\damage_web_dev\web\src\components\skill-editor\skillModels.ts
- C:\project\damage_web_dev\web\src\components\skill-editor\SkillMechanicsConfigEditor.tsx
- C:\project\damage_web_dev\web\src\pages\admin\resources\skills\modal.tsx
- 必要时 C:\project\damage_web_dev\web\src\pages\admin\resources\skills\index.tsx

只读参考：
- C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.ts
- C:\project\damage_web_dev\web\src\pages\WasmValidationV2DpsPage.tsx
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver.go

实现要求：
1. 在 skillModels.ts 增加 summarizeDpsPassiveEffects(root) 和 validateDpsPassiveEffects(root)。
2. 摘要展示 passiveId/source/ownerRole/trigger.event/matcher/operation kinds/targetRoles。
3. error 级问题阻断保存；warning 级问题只展示。
4. 保留 stringifyMechanicsConfig(baseRoot, ...) 对额外字段的保留行为。
5. mechanicsConfig JSON 文本域仍是完整编辑入口。
6. 不新增业务伤害计算，不新增装备特例，不新增卢登真实触发。

验证：
cd C:\project\damage_web_dev\web
npm run build

停止条件：
- 如果必须改后端 API 才能完成摘要展示，停止并报告。
- 如果需要把 dpsPassiveEffects 改写成全新 schema，停止并报告。
- 如果保存阻断会影响无 dpsPassiveEffects 的旧技能，停止并报告。
```

### 12.2 Cursor Prompt: Q2 Backend Schema Audit

```text
目标：
在 Backend 保存/发布链路中为 mechanicsConfig.dpsPassiveEffects 增加最小结构校验或审计测试，防止 ownerRole/trigger.event/operations/targetRole 等字段错误时静默进入 published bundle。

允许写入：
- C:\project\damage_backend_dev\server\data_manage\src\main\java\xyz\game\datamanage\service\PostgresWriteStore.java
- C:\project\damage_backend_dev\server\data_manage\src\test\java\xyz\game\datamanage\tools\KatarinaMvpImportMainTest.java
- 必要时最小修改相关 publish integration test

只读参考：
- C:\project\damage_backend_dev\server\data_manage\src\main\java\xyz\game\datamanage\service\PostgresReadStore.java
- C:\project\damage_backend_dev\最小验证\V2-Batch-P-target-equipment-linked-effects.seed.json
- C:\project\damage_wasm_dev\文档记录\详细设计\最小验证\V2-BatchP-单攻击方DPS真实装备联动闭环计划.md

实现要求：
1. dpsPassiveEffects 存在时必须是数组。
2. passive 必须是 object。
3. ownerRole 存在时只允许 attacker/target。
4. trigger 存在时必须是 object。
5. trigger.event 存在时只允许当前 DPS 事件集合。
6. operations 存在时必须是数组。
7. operation 必须是 object。
8. targetRole 存在时只允许 attacker/target。
9. 3071/3075 Batch P seed passthrough 测试继续通过。
10. 不改 DB schema，不裁剪 unknown 字段。

验证：
cd C:\project\damage_backend_dev\server\data_manage
mvn -Dtest=KatarinaMvpImportMainTest test
mvn test

停止条件：
- 如果现有接口没有 warning 机制，不要为 warning 新增 API；只做 error 级校验。
- 如果校验会拒绝当前已发布合法数据，停止并报告具体字段。
- 如果需要修改数据库结构，停止并报告。
```

### 12.3 GPT 验收任务

Cursor 返回后，GPT/Codex 必须：

1. 检查 Cursor 事件日志和 `git diff`。
2. 核对未越权修改 Wasm runtime 或无关页面。
3. 运行 Web/Backend 自动化验证。
4. 必要时启动 backend + web，用浏览器走 Admin skills 和 DPS 页面 smoke。
5. 补测试记录：
   - `文档记录/测试记录/wasm/V2-BatchQ-DPS联动配置编辑与校验成熟度-测试记录-2026-06-07.md`
6. 更新 `db/task_doc_governance/task_rules.json` 并 rebuild。

## 13. 验收标准

Batch Q 完成必须满足：

1. Admin skill editor 能显示 `dpsPassiveEffects` 摘要。
2. 3071/3075 的 ownerRole、trigger.event、operations 和 targetRole 在摘要中可读。
3. `dpsPassiveEffects` 非数组、非法 ownerRole、非法 trigger.event、非法 targetRole 至少在 Web 或 Backend 中被 error 阻断；最终不能静默发布。
4. Warning 级风险可见，尤其是 `critOnly=true`。
5. mechanicsConfig JSON 完整编辑能力保留。
6. 旧技能无 `dpsPassiveEffects` 时不受影响。
7. Batch P live DPS 页面回归不退化。
8. `npm run build`、`mvn test` 通过。
9. 治理映射中新增 Batch Q 计划和后续测试记录，`unassigned_docs` 为 0。

## 14. 残余风险

1. Batch Q 不解决真实 `on_spell_hit` 用户流；卢登仍需另开 Batch R。
2. Batch Q 不解决兰顿的真实 crit damage context；只能让 `critOnly` 风险可见。
3. 当前 Web 若没有单元测试框架，前端校验只能靠 build + browser smoke 证明。
4. 后端如果只做 error 级校验，warning 仍主要由 Web 展示承担。
5. 完整 nested form builder 后续仍可能需要，但必须等字段和真实数据批次稳定后再做。
