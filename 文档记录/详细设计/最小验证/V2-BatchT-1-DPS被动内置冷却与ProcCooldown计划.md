TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-06-14

# V2 Batch T-1 DPS 被动内置冷却与 ProcCooldown 计划

关联概要：[验证里程碑V2](../../概要设计/验证里程碑V2.md)

前置数值与暴击上下文：[V2-BatchT-DPS通用数值边界与暴击上下文计划](./V2-BatchT-DPS通用数值边界与暴击上下文计划.md)

前置装备引用契约：[V2-BatchU-0-DPS装备引用契约与Preflight硬化计划](./V2-BatchU-0-DPS装备引用契约与Preflight硬化计划.md)

前置斩杀阈值：[V2-BatchU-2-DPS斩杀阈值execute-threshold计划](./V2-BatchU-2-DPS斩杀阈值execute-threshold计划.md)

缺口来源：[V2-ADC随机组合机制头脑风暴与缺口分析](./V2-ADC随机组合机制头脑风暴与缺口分析.md)

## 1. 文档边界

本文是 Batch T 家族的后续子批次，不覆盖既有 Batch T 主计划。既有 Batch T 已用于通用数值边界、暴击上下文和 `critOnly`；本文只处理 `single_attacker_dps` 中的 DPS passive 内置冷却。

本批的核心问题是：某个装备或技能被动已经满足触发条件，但它上一次触发后还在内置冷却内，此时普攻或技能动作本身应继续发生，只跳过该被动效果，并输出可解释 evidence。

本文是详细设计和 Cursor 执行真源。后续编码必须按仓库 Cursor SDK local 流程执行，使用 `composer-2.5` + `fast=false`，由 GPT 在 Cursor 产物后亲自完成最终验证。

## 2. 当前事实

1. 普通 action/skill cooldown 已属于通用 runtime action cadence，不是本批目标。
2. DPS lane 的被动分发在 `processAttackPassives` / `processSkillPassives` 下游，通过 `dispatchDPSLinkedEffects`、incoming modifier 路径、energized 路径和 on-crit 路径触发。
3. `DPSPassiveEffectV2` 当前没有 passive 级 cooldown 字段。
4. `dpsCurveState` 当前已有 stacks、hitCounts、scenario states、energized charge 等 per-curve 状态，但没有 passive cooldown readyAt 状态。
5. `EffectBreakdown` 已经承载 coefficient bucket、numeric bound、crit context 和 execute evidence；本批应继续走结构化 evidence，而不是只追加不可解析字符串。

## 3. 目标

1. 在 `DPSPassiveEffectV2` 上新增 passive 级 `internalCooldownMs` 契约。
2. 对所有 DPS passive 触发路径增加统一 cooldown gate。
3. 冷却未就绪时：
   - 不阻止本次 action。
   - 不改变本次普攻/技能基础伤害。
   - 不记录普通 passive trigger。
   - 不污染 `damageBySource`。
   - 输出 skipped-by-cooldown evidence。
4. 冷却就绪并触发时：
   - 保留现有 passive trigger timeline 行为。
   - 设置该 passive 下一次可触发时间。
   - 对 cooldown 开始输出结构化 evidence。
5. 后端保存/发布前校验 `internalCooldownMs` 必须是非负整数或可安全转换为非负毫秒值。
6. Web authoring / adapter 至少能展示、保真、校验并导出该字段。
7. 增加 synthetic Go/Web/Backend 测试，证明 cooldown gate 与普通 action cooldown 解耦。

## 4. 非目标

1. 不实现完整 rotation authoring。
2. 不实现技能冷却缩短、刷新、返还或自动最优施法。
3. 不改变普通 action cooldown / `actor.actionState[actionId]` 语义。
4. 不实现 operation 级 cooldown；第一版 cooldown 只挂在 passive 上。
5. 不补真实装备数据，不要求用户提供训练营或 OCR baseline。
6. 不实现 unique passive group 或重复装备规则。
7. 不把多目标、弹道、距离、位移和生存闭环纳入 `single_attacker_dps`。

## 5. 语义决定

### 5.1 普通技能 CD 与 passive internal cooldown 的区别

普通技能 CD 决定 action 能否释放。CD 未好时，动作被 blocked，后续伤害和触发都不发生。

Passive internal cooldown 决定已匹配的被动能否生效。冷却未好时，动作照常执行，只跳过该 passive 的 operations。

因此本批不得复用 action cooldown 状态，也不得把 passive cooldown skip 当作 action blocked。

### 5.2 字段归属

建议字段挂在 passive 顶层：

```json
{
  "passiveId": "item_example_proc",
  "ownerRole": "attacker",
  "trigger": {
    "event": "on_basic_attack_hit"
  },
  "internalCooldownMs": 1000,
  "operations": [
    {
      "kind": "damage",
      "source": "item_example_proc",
      "damageType": "magic",
      "amount": 45
    }
  ]
}
```

字段规则：

1. `internalCooldownMs` 缺失或为 `0` 表示无内置冷却，保持旧行为。
2. `internalCooldownMs > 0` 表示该 passive 成功触发后，未来 `internalCooldownMs` 毫秒内不再触发。
3. `internalCooldownMs < 0` 必须被 Web/Backend/Wasm 校验阻断。
4. 第一版不接受字符串、对象、数组、NaN 或 Infinity。

### 5.3 冷却开始时机

只有 passive 通过 trigger/matcher/everyN/scenario/ownerRole 等所有前置条件，且冷却就绪时，才算触发并启动 cooldown。

未满足 trigger 条件时不启动 cooldown。冷却未就绪时也不刷新 cooldown。

### 5.4 与 every-N 的顺序

`every_n_basic_attack_hit` 先推进 hit count，再判断是否到达第 N 下。只有到达第 N 下后，才检查 `internalCooldownMs`。

这能保证“第 N 下本来会触发，但因内置冷却跳过”的 evidence 可见，同时不会让冷却跳过破坏 hit count。

### 5.5 与 next-attack scenario state 的顺序

`next_basic_attack_after_state` 第一版只在 passive 真正触发时消耗 scenario state。冷却未就绪时不消耗 state。

原因：当前 `single_attacker_dps` 主要通过 scenario state 预置“下一击状态”，还没有真实 skill-cast 产生/拒绝 spellblade buff 的 rotation 入口。若后续做完整 spellblade rotation，应在“技能施放时是否成功创建 next-attack state”处建模，不应在本批用 cooldown skip 隐式消耗预置 state。

### 5.6 与 damage_modifier / target-side incoming modifier 的顺序

Target-side incoming `damage_modifier` 如果配置了 `internalCooldownMs`：

1. 本次伤害进入 incoming modifier 阶段。
2. passive matcher 匹配后先检查 cooldown。
3. 冷却未好则该 modifier 不参与本次伤害。
4. 冷却就绪则 modifier 生效，并启动 cooldown。

这类跳过不能阻断基础伤害，否则会把“目标装备特效没触发”误解释成“攻击没发生”。

## 6. 契约设计

### 6.1 Wasm 输入模型

在 `DPSPassiveEffectV2` 增加：

```go
InternalCooldownMs int64 `json:"internalCooldownMs,omitempty"`
```

不要放在 `DPSPassiveOperationV2` 上；本批只定义 passive 级 gate。

### 6.2 Wasm 运行状态

在 `dpsCurveState` 增加 per-curve 状态：

```go
passiveCooldownReadyAt map[string]int64
```

key 使用现有 `passiveRuntimeKey(passive)`，保证与 stacks / hitCounts 等 passive 级状态一致。

初始化位置应与 `stacks`、`hitCounts`、`energizedCharge` 同级，在每条 curve 内独立，不能跨 curve 共享。

### 6.3 Wasm evidence

建议新增结构化 evidence：

```go
type DPSPassiveCooldownEvidenceV2 struct {
    PassiveKey         string `json:"passiveKey,omitempty"`
    InternalCooldownMs int64  `json:"internalCooldownMs,omitempty"`
    ReadyAtMs          int64  `json:"readyAtMs,omitempty"`
    NextReadyAtMs      int64  `json:"nextReadyAtMs,omitempty"`
    Triggered          bool   `json:"triggered,omitempty"`
    Skipped            bool   `json:"skipped,omitempty"`
}
```

并在 `DPSEffectBreakdownV2` 上增加：

```go
PassiveCooldown *DPSPassiveCooldownEvidenceV2 `json:"passiveCooldown,omitempty"`
```

`EffectBreakdown.Kind` 建议使用：

```text
passive_cooldown
```

Successful trigger evidence：

```json
{
  "timeMs": 0,
  "source": "item_example_proc",
  "kind": "passive_cooldown",
  "message": "passive cooldown started",
  "passiveCooldown": {
    "passiveKey": "item_example_proc",
    "internalCooldownMs": 1000,
    "nextReadyAtMs": 1000,
    "triggered": true
  }
}
```

Skipped evidence：

```json
{
  "timeMs": 500,
  "source": "item_example_proc",
  "kind": "passive_cooldown",
  "message": "passive cooldown skipped",
  "passiveCooldown": {
    "passiveKey": "item_example_proc",
    "internalCooldownMs": 1000,
    "readyAtMs": 1000,
    "skipped": true
  }
}
```

### 6.4 Web 类型与导出

Web adapter 应保留 `internalCooldownMs`，并在导出 JSON 中保留 `effectBreakdown[].passiveCooldown`。

如果当前页面已有 generic effectBreakdown 展示，可以只增加摘要字段；如果没有，应在 V2 DPS 页增加最小可读信息：

```text
passive cooldown: triggered=<n>, skipped=<n>, sources=<source list>
```

### 6.5 Backend 保存与发布校验

Backend 需要在 `validateDpsPassiveEffect` 中校验：

1. 缺失允许。
2. `null` 等价缺失。
3. 必须为整数或可安全转为毫秒整数。
4. 必须 `>= 0`。
5. 非数字、负数、溢出值发布前必须失败，并带 `path=/mechanicsConfig/dpsPassiveEffects/<index>/internalCooldownMs`。

## 7. 写入范围

### 7.1 Wasm Gate

允许写入：

1. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go`
2. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_contract.go`
3. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver.go`
4. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_state.go`
5. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_passive_dispatcher.go`
6. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_energized.go`
7. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_damage.go`
8. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_hp_change_modifier_adapter.go`
9. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_operation_handlers.go`
10. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_validation.go`
11. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go`

只读参考：

1. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\AGENTS.md`
2. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\README.md`
3. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\ARCHITECTURE.md`

### 7.2 Web Gate

允许写入：

1. `C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.ts`
2. `C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.test.ts`
3. `C:\project\damage_web_dev\web\src\components\skill-editor\skillModels.ts`
4. `C:\project\damage_web_dev\web\src\components\skill-editor\SkillMechanicsConfigEditor.tsx`
5. 必要时最小修改 `C:\project\damage_web_dev\web\src\pages\WasmValidationV2DpsPage.tsx`

只读参考：

1. `C:\project\damage_web_dev\web\AGENTS.md`
2. `C:\project\damage_web_dev\web\README.md`
3. `C:\project\damage_web_dev\web\src\types\api.ts`

### 7.3 Backend Gate

允许写入：

1. `C:\project\damage_backend_dev\server\data_manage\src\main\java\xyz\game\datamanage\service\PostgresWriteStore.java`
2. `C:\project\damage_backend_dev\server\data_manage\src\test\java\xyz\game\datamanage\service\PostgresWriteStorePublishTest.java`
3. 必要时最小修改 `C:\project\damage_backend_dev\server\data_manage\src\test\java\xyz\game\datamanage\tools\KatarinaMvpImportMainTest.java`

只读参考：

1. `C:\project\damage_backend_dev\server\data_manage\AGENTS.md`
2. `C:\project\damage_backend_dev\server\data_manage\README.md`

### 7.4 Planning Gate

允许写入：

1. 本文档。
2. `C:\project\damage_viewer_project_planning\db\task_doc_governance\task_rules.json`
3. 后续实现完成后的测试记录，路径建议：
   `C:\project\damage_viewer_project_planning\文档记录\测试记录\wasm\V2-BatchT-1-DPS被动内置冷却-测试记录-2026-06-14.md`

## 8. 实现步骤

### 8.1 Wasm

1. 在 `DPSPassiveEffectV2` 增加 `InternalCooldownMs`。
2. 在 `dpsCurveState` 增加 `passiveCooldownReadyAt`，并在 curve 初始化时创建空 map。
3. 增加 helper：
   - `passiveInternalCooldownMs(passive) int64`
   - `passiveCooldownReady(passive, timeMs) (ready bool, readyAt int64)`
   - `recordPassiveCooldownSkipped(timeMs, passive, readyAt)`
   - `recordPassiveCooldownStarted(timeMs, passive, nextReadyAt)`
   - `markPassiveCooldownTriggered(timeMs, passive)`
4. 所有触发路径在调用 `recordPassiveTrigger` 前统一检查 cooldown。
5. `dispatchDPSLinkedEffects` 的标准 operation 路径必须覆盖。
6. `processEnergizedChargePassive` 必须覆盖；冷却未就绪时不能 consume charge。
7. `applyIncomingDamageModifiers` 和 HP bucket modifier adapter 必须覆盖；冷却未就绪时 modifier 不生效。
8. `processOnCritPassives` 必须覆盖；expected crit 下被 cooldown 跳过时不输出 onCrit damage。
9. `processPhantomHits` 必须覆盖；phantom copy 不应绕过 cooldown。
10. `dps_validation.go` 校验 `InternalCooldownMs >= 0`。

### 8.2 Web

1. 在 `tinygoV2DpsAdapter.ts` 类型中保留 `internalCooldownMs`。
2. 如果 adapter 目前 pass-through `dpsPassiveEffects`，新增测试证明该字段不会被丢弃。
3. 在 `skillModels.ts` 的 summary 中展示 cooldown，例如 `cooldown=1000ms`。
4. 在 `validateDpsPassiveEffects` 中对 `internalCooldownMs` 做 error 级校验。
5. 在 `SkillMechanicsConfigEditor.tsx` 中展示或编辑 `internalCooldownMs`；第一版可只做数字输入，不必做复杂模板。
6. 如页面没有 passive cooldown 汇总，在 V2 DPS 页从 `effectBreakdown[].passiveCooldown` 生成最小摘要。

### 8.3 Backend

1. `PostgresWriteStore.validateDpsPassiveEffect` 增加 `internalCooldownMs` 校验。
2. 发布前 `validateDpsPassiveEffects(..., forPublish=true)` 应以 semantic error 返回。
3. 保存草稿时应以 bad request 返回。
4. 测试覆盖合法缺失、合法 `0`、合法正数、负数、非数字和发布路径。

### 8.4 数据

本批默认不改真实装备数据。验证只使用 synthetic fixture。

如果后续需要真实装备闭环，另起小批次，只做数据录入和 Playwright 页面证明。

## 9. 测试矩阵

### 9.1 Go runtime tests

必须新增或更新：

1. `TestSingleAttackerDPSPassiveInternalCooldownSkipsUntilReady`
   - 攻速 2.0，普攻间隔 500ms。
   - 一个 on-basic-hit passive 追加 10 magic damage。
   - `internalCooldownMs=1000`。
   - 期望 t=0 和 t=1000 触发，t=500 跳过。
   - `AttackCount` 不因 cooldown skip 减少。
   - `DamageBySource` 只累计实际触发的 passive damage。
   - `EffectBreakdown` 有 `passive_cooldown` triggered/skipped 证据。
2. `TestSingleAttackerDPSPassiveInternalCooldownDoesNotBlockBaseAttack`
   - 冷却未就绪时基础普攻仍造成伤害。
3. `TestSingleAttackerDPSEveryNPassiveCooldownOrder`
   - every-N 先计数，再检查 cooldown。
4. `TestSingleAttackerDPSIncomingModifierInternalCooldown`
   - target-side `damage_modifier` 首次生效，冷却内第二次不生效。
5. `TestSingleAttackerDPSEnergizedInternalCooldownDoesNotConsumeWhenSkipped`
   - 冷却未就绪时不 consume charge。
6. `TestSingleAttackerDPSRejectsNegativeInternalCooldownMs`
   - 负数触发 blocked reason。

### 9.2 Web tests

必须新增或更新：

1. `tinygoV2DpsAdapter.test.ts`
   - preserve `internalCooldownMs` operation/passive shape。
   - parse or summarize `effectBreakdown[].passiveCooldown`。
2. `skillModels.ts` 相关测试若无现成 runner，则通过 `npm run build` 和页面 smoke 覆盖类型。
3. 若 `SkillMechanicsConfigEditor` 增加输入控件，Playwright smoke 需要确认输入后 JSON 同步。

### 9.3 Backend tests

必须新增或更新：

1. `PostgresWriteStorePublishTest`
   - `internalCooldownMs=-1` 在发布前失败。
   - `internalCooldownMs=1000` 发布前通过。
   - 错误 path 指向 `/skills/mechanicsConfig/dpsPassiveEffects/0/internalCooldownMs`。
2. 如保存草稿路径已有测试，补保存失败断言。

### 9.4 Full flow

最终 GPT 验收必须包含：

1. Wasm Go tests。
2. Wasm bench。
3. Wasm build + Node smoke。
4. Web adapter test。
5. Web build。
6. Backend relevant tests。
7. Playwright 打开 `#/wasm-validation-v2-dps`，使用 synthetic 或 published 测试 bundle 证明页面可展示 passive cooldown evidence。

## 10. 验证命令

Wasm：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test -count=1 ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
node .\scripts\smoke-node.mjs
```

Web：

```powershell
cd C:\project\damage_web_dev\web
npx --yes tsx src/engine/tinygoV2DpsAdapter.test.ts
npm run build
```

Backend：

```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn test -Dtest=PostgresWriteStorePublishTest
```

Planning：

```powershell
cd C:\project\damage_viewer_project_planning
node tools/task-governance/cli.mjs rebuild
node tools/task-governance/cli.mjs docs planning-validation-milestones
```

## 11. 完成定义

1. Synthetic runtime 能证明 passive cooldown 不等同于 action cooldown。
2. Cooldown skipped 只跳过 passive，不跳过 action。
3. Cooldown started / skipped 有结构化 evidence。
4. 标准 on-hit、incoming modifier、energized、on-crit 和 phantom 触发路径不绕过 cooldown gate。
5. Web authoring 不丢 `internalCooldownMs`，并能提示非法值。
6. Backend 保存/发布前阻断非法 `internalCooldownMs`。
7. 原有 Batch U 真实装备验证不回退。
8. `planning-validation-milestones` 映射包含本计划和后续测试记录。

## 12. 风险与取舍

1. `next_basic_attack_after_state` 的真实游戏语义依赖 rotation 入口。本批只保证预置 state 不在 cooldown skip 时被误消费；完整 spellblade arming 另批处理。
2. 对所有 passive trigger path 做统一 gate 比只改 `dispatchDPSLinkedEffects` 更重要；否则 target-side modifier 或 energized 可能绕过 cooldown。
3. 结构化 evidence 会增加输出体积，但只在配置了 `internalCooldownMs > 0` 的 passive 上输出，成本可控。
4. 如果未来需要 operation 级 cooldown，应另起批次，不应在本批混入字段语义。

## 13. 待确认问题

当前没有阻塞开发的问题。默认采用以下产品语义：

1. 字段名用 `internalCooldownMs`。
2. cooldown 挂 passive，不挂 operation。
3. cooldown skip 不阻塞 action。
4. cooldown skip 不消耗预置 next-attack scenario state。
5. 本批不补真实装备数据。

如果后续发现某个真实装备要求“冷却中也消耗状态”或“冷却从施法时开始而不是命中时开始”，应另拆 rotation / spellblade 子批次。

## 14. Cursor Prompt A: Wasm Gate

```text
目标：实现 V2 Batch T-1 DPS passive internal cooldown。只改 single_attacker_dps lane，不改普通 action cooldown 语义。

目标仓库和分支：
- C:\project\damage_wasm_dev
- branch: wasm/dev

必须先读：
- C:\project\damage_wasm_dev\AGENTS.md
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\AGENTS.md
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\README.md
- C:\project\damage_viewer_project_planning\文档记录\详细设计\最小验证\V2-BatchT-1-DPS被动内置冷却与ProcCooldown计划.md

允许写入：
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_contract.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_state.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_passive_dispatcher.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_energized.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_damage.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_hp_change_modifier_adapter.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_operation_handlers.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_validation.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go

非目标：
- 不实现 rotation authoring。
- 不实现 skill cooldown refund/reduce/reset。
- 不改普通 action cooldown。
- 不补真实装备数据。
- 不实现 operation 级 cooldown。

实现要求：
1. 在 DPSPassiveEffectV2 增加 internalCooldownMs。
2. 在 dpsCurveState 中增加 passiveCooldownReadyAt map，per curve 隔离。
3. 使用 passiveRuntimeKey(passive) 作为 cooldown key。
4. 增加结构化 DPSPassiveCooldownEvidenceV2，并挂到 DPSEffectBreakdownV2.passiveCooldown。
5. cooldown 未就绪时只跳过 passive，不 block action，不写 damageBySource，不记录普通 passive trigger。
6. 覆盖 dispatchDPSLinkedEffects、incoming damage_modifier、HP bucket modifier、energized、onCrit、phantom hit 触发路径。
7. internalCooldownMs < 0 必须 blocked。

验证：
- go test -count=1 ./...
- go run ./cmd/bench
- powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
- node .\scripts\smoke-node.mjs

停止条件：
- 如果需要大改普通 runtime action cooldown 或 RunContext cadence，停止并报告。
- 如果无法集中覆盖 incoming modifier / energized / onCrit / phantom trigger path，停止并列出遗漏路径。
- 如果 passiveRuntimeKey 不足以作为稳定 cooldown key，停止并报告替代方案。
```

## 15. Cursor Prompt B: Web + Backend Gate

```text
目标：接入 Batch T-1 DPS passive internal cooldown 的 Web authoring/adapter 与 Backend 保存/发布校验。

目标仓库和分支：
- C:\project\damage_web_dev branch: web/dev
- C:\project\damage_backend_dev branch: backend/dev

必须先读：
- C:\project\damage_web_dev\web\AGENTS.md
- C:\project\damage_web_dev\web\README.md
- C:\project\damage_backend_dev\server\data_manage\AGENTS.md
- C:\project\damage_backend_dev\server\data_manage\README.md
- C:\project\damage_viewer_project_planning\文档记录\详细设计\最小验证\V2-BatchT-1-DPS被动内置冷却与ProcCooldown计划.md

允许写入 Web：
- C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.ts
- C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.test.ts
- C:\project\damage_web_dev\web\src\components\skill-editor\skillModels.ts
- C:\project\damage_web_dev\web\src\components\skill-editor\SkillMechanicsConfigEditor.tsx
- 必要时最小修改 C:\project\damage_web_dev\web\src\pages\WasmValidationV2DpsPage.tsx

允许写入 Backend：
- C:\project\damage_backend_dev\server\data_manage\src\main\java\xyz\game\datamanage\service\PostgresWriteStore.java
- C:\project\damage_backend_dev\server\data_manage\src\test\java\xyz\game\datamanage\service\PostgresWriteStorePublishTest.java
- 必要时最小修改 C:\project\damage_backend_dev\server\data_manage\src\test\java\xyz\game\datamanage\tools\KatarinaMvpImportMainTest.java

非目标：
- 不新增真实装备数据。
- 不新增 DB schema 字段。
- 不重写 skill editor。
- 不实现完整 dpsPassiveEffects 模板库。

实现要求：
1. Web 保留 internalCooldownMs，并在 adapter test 中证明不会丢。
2. Web validateDpsPassiveEffects 对 internalCooldownMs 非负数字做 error 级校验。
3. SkillMechanicsConfigEditor 展示或编辑 internalCooldownMs。
4. Web 能从 effectBreakdown[].passiveCooldown 生成最小摘要或导出保真。
5. Backend validateDpsPassiveEffect 校验 internalCooldownMs，发布路径和保存路径都覆盖。
6. 错误 path 指向 /mechanicsConfig/dpsPassiveEffects/<index>/internalCooldownMs 或 /skills/mechanicsConfig/dpsPassiveEffects/<index>/internalCooldownMs。

验证：
Web:
- npx --yes tsx src/engine/tinygoV2DpsAdapter.test.ts
- npm run build

Backend:
- mvn test -Dtest=PostgresWriteStorePublishTest

停止条件：
- 如果需要新增 DB schema 字段，停止并报告。
- 如果 Web 必须大改 admin resource 框架才能显示该字段，停止并报告。
- 如果 Backend 当前 JSONB 透传路径不能在保存/发布前校验该字段，停止并报告。
```

## 16. GPT 最终验收清单

1. 检查 Cursor 事件日志和全部 `git diff`。
2. 运行 Wasm / Web / Backend 验证命令。
3. 必要时重建并同步 Wasm artifact 到 Web。
4. 启动后端和前端。
5. 用 Playwright 打开 `http://127.0.0.1:5173/#/wasm-validation-v2-dps`。
6. 运行包含 `internalCooldownMs` 的 synthetic 或 current bundle 场景。
7. 导出 JSON，确认：
   - action 没有被 cooldown skip 阻断。
   - `effectBreakdown[].passiveCooldown.triggered` 和 `skipped` 都存在。
   - `damageBySource` 不包含 skipped passive。
8. 新增测试记录并纳入 `planning-validation-milestones`。
