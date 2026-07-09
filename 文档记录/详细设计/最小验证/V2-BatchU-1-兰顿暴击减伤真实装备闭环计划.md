TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-06-13

# V2 Batch U-1 兰顿暴击减伤真实装备闭环计划

关联概要：[验证里程碑V2](../../概要设计/验证里程碑V2.md)

前置引用契约：[V2-BatchU-0-DPS装备引用契约与Preflight硬化计划](./V2-BatchU-0-DPS装备引用契约与Preflight硬化计划.md)

前置暴击上下文：[V2-BatchT-DPS通用数值边界与暴击上下文计划](./V2-BatchT-DPS通用数值边界与暴击上下文计划.md)

关联真实装备链路：[V2-BatchP-单攻击方DPS真实装备联动闭环计划](./V2-BatchP-单攻击方DPS真实装备联动闭环计划.md)

## 1. 文档边界

本文是 Batch U-1 的详细设计和 Cursor 执行真源。目标是让兰顿之兆这类 target-side 暴击减伤，从真实装备配置进入 published bundle、Web V2 DPS 页面、Wasm 输入和 Wasm 输出 evidence。

本批不是新增暴击上下文主干；它消费 Batch T 的 `DPSCritContextV2`、`critOnly` 和 numeric bound evidence。若实际代码尚未具备这些前置能力，U-1 必须停止并回报前置缺口。

## 2. 数据前提

U-1 需要真实数据证据，至少包括：

1. 游戏版本号和模式。
2. 兰顿之兆当前版本 tooltip / OCR 截图。
3. 训练营对照数据：
   - 无兰顿时的暴击普攻伤害。
   - 有兰顿时的暴击普攻伤害。
   - 攻击方英雄、等级、装备、面板 AD、暴击率、暴击伤害。
   - 目标护甲、血量、装备。
4. 如果缺少训练营数据，可先做 synthetic pass，但不得宣称 real-data live pass。

## 3. 目标

1. 让 item `3143` 或当前数据源中的兰顿之兆有明确 `skillRefs` 指向 item-owned skill。
2. 让该 item-owned skill 的 `mechanicsConfig.dpsPassiveEffects[]` 包含 target-side 暴击减伤 passive。
3. Web adapter 只在 `ownerRole=target` 且 U-0 引用契约通过时接入该 passive。
4. Wasm DPS 中 `damage_modifier.critOnly=true` 只作用于暴击 portion。
5. 页面和导出 JSON 能看到：
   - target equipment set 包含兰顿。
   - target-owned passive 被接入。
   - crit chance raw/effective。
   - normal/crit portion 或等价 crit context evidence。
   - 兰顿减伤只影响 crit portion。
6. 若真实数值尚未确认，允许配置结构和 synthetic 测试先通过，但必须在测试记录中标记 `pending_manual_baseline`。

## 4. 非目标

1. 不实现兰顿主动减速。
2. 不实现完整 target 生存闭环。
3. 不实现 seeded_random 暴击序列；U-1 第一版只要求 expected policy。
4. 不实现 unique passive / 重复装备规则。
5. 不猜测装备真实数值。
6. 不把普通 incoming percent damage modifier 当作兰顿通过；必须有 crit context。

## 5. 写入范围

按实际缺口分三段 Cursor 执行，不建议一次跨仓混改。

### 5.1 Wasm Gate

允许写入：

1. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_contract.go`
2. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_basic_attack.go`
3. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_hp_change_modifier_adapter.go`
4. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_modifier_condition.go`
5. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go`

禁止写入 Web / Backend / DB。

### 5.2 Web Gate

允许写入：

1. `C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.ts`
2. `C:\project\damage_web_dev\web\src\pages\WasmValidationV2DpsPage.tsx`
3. 与 V2 DPS 页面直接相关的类型或测试文件。

禁止写入 Wasm / Backend / DB。

### 5.3 Data / Backend Gate

允许写入：

1. 真实数据 seed/import/publish 相关文件。
2. 后端测试文件，仅用于证明 `mechanicsConfig.dpsPassiveEffects` 字段保真。
3. 本批测试记录。

只有发现后端会裁剪字段时，才允许最小修改后端保存/读取/发布链路；不得新增后端语义校验。

## 6. 机制契约

兰顿 passive 建议形状：

```json
{
  "passiveId": "item_3143_randuin_crit_reduction_dps_v2",
  "sourceCategory": "item_passive",
  "sourceType": "item",
  "sourceId": "3143",
  "ownerRole": "target",
  "trigger": {
    "event": "incoming_damage",
    "matcher": {
      "damageType": "physical",
      "sourceType": "basic_attack"
    }
  },
  "priority": 0,
  "operations": [
    {
      "kind": "damage_modifier",
      "targetRole": "target",
      "valuePhase": "final",
      "mode": "percent",
      "value": -0.3,
      "critOnly": true
    }
  ]
}
```

字段解释：

1. `value` 必须来自确认后的真实数据；上面的 `-0.3` 只是形状示例。
2. `critOnly=true` 必须消费 DPS crit context。
3. `ownerRole=target` 是强契约，不能靠页面推断。
4. expected policy 下只修改 `ExpectedCritPart`，不影响 `ExpectedNormalPart`。

## 7. 测试矩阵

| 用例 | 输入 | 预期 |
| --- | --- | --- |
| 无兰顿 baseline | raw 100, crit chance 0.5, multiplier 2 | final 150 |
| 兰顿 critOnly | raw 100, crit chance 0.5, multiplier 2, critOnly -30% | final 120：normal 50 + crit 70 |
| 满暴击 | raw 100, crit chance 1, multiplier 2, critOnly -30% | final 140 |
| 非暴击上下文缺失 | critOnly modifier 但无 crit context | blocked，不能静默近似 |
| target ownerRole 错 | 兰顿 passive 写成 attacker | U-0 diagnostic 或 Wasm validation blocked |
| 页面导出 | target 装备含兰顿 | JSON 含 targetEquipmentSet、target passive、crit evidence、modifier evidence |

## 8. 验证命令

Wasm：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./internal/runtime -run "Randuin|CritOnly|CritContext|DamageModifier|SingleAttackerDPS" -count=1
go test ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
node .\scripts\smoke-node.mjs
```

Web：

```powershell
cd C:\project\damage_web_dev\web
npm run build
```

Backend：

```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn test
```

页面 smoke 必须打开 V2 DPS 页面，选择或构造含兰顿 target equipment 的 case，导出 JSON 并检查 target passive 与 crit evidence。

## 9. Cursor Prompt：Wasm Gate

```text
目标：实现或补齐 U-1 兰顿暴击减伤所需的 Wasm DPS critOnly target-side modifier 行为。消费 Batch T 的 DPSCritContextV2，不新增新的暴击主干。

执行模型：Cursor grok-4.5。

允许写入：
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_contract.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_basic_attack.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_hp_change_modifier_adapter.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_modifier_condition.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go

只读参考：
- C:\project\damage_viewer_project_planning\文档记录\详细设计\最小验证\V2-BatchU-1-兰顿暴击减伤真实装备闭环计划.md
- C:\project\damage_viewer_project_planning\文档记录\详细设计\最小验证\V2-BatchT-DPS通用数值边界与暴击上下文计划.md

非目标：
- 不改 Web/Backend/DB。
- 不实现兰顿主动减速。
- 不实现 seeded_random DPS。
- 不实现完整 target survival。

实现要求：
1. expected policy 下 target-side damage_modifier.critOnly=true 只作用于 crit portion。
2. 无 crit context 时保持 blocked。
3. 输出 evidence 足够证明 normal portion 未被修改。
4. 增加 Randuin/critOnly 代表测试。

停止条件：
- 如果 Batch T crit context 尚不存在或不足以消费，停止并报告前置缺口。
- 如果必须重写整个 DPS damage flow，停止并报告拆分方案。
```

## 10. Cursor Prompt：Web/Data Gate

```text
目标：让兰顿 target equipment 从 published bundle 进入 V2 DPS 页面、Wasm 输入和导出 JSON。只做真实装备闭环，不猜测真实数值。

执行模型：Cursor grok-4.5。

允许写入：
- C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.ts
- C:\project\damage_web_dev\web\src\pages\WasmValidationV2DpsPage.tsx
- 与 V2 DPS 页面直接相关的类型或测试文件
- 必要时真实 seed/import/publish 数据文件和后端保真测试

只读参考：
- C:\project\damage_viewer_project_planning\文档记录\详细设计\最小验证\V2-BatchU-1-兰顿暴击减伤真实装备闭环计划.md
- C:\project\damage_viewer_project_planning\文档记录\详细设计\最小验证\V2-BatchU-0-DPS装备引用契约与Preflight硬化计划.md

非目标：
- 不改 Wasm runtime。
- 不新增后端语义校验。
- 不猜测兰顿数值。

实现要求：
1. target equipment 选择和导出保留 3143。
2. adapter 只接入 ownerRole=target 的兰顿 passive。
3. 导出 JSON 包含 targetEquipmentSet、targetEnabledPassiveEffects、passive 原文和 Wasm 输出 evidence。
4. 如果真实数据缺失，输出 pending/manual baseline 状态，不宣称 real pass。

停止条件：
- 如果 U-0 strict 引用契约导致兰顿 passive 无法接入，停止并报告数据迁移需求。
- 如果缺少真实数值来源，停止在 synthetic/config pass，不要写假数值。
```

## 11. 完成定义

1. Wasm synthetic 兰顿 critOnly 测试通过。
2. 页面能展示兰顿 target equipment 和 target passive。
3. 导出 JSON 能复核兰顿来源和 crit evidence。
4. 真实数据数值有 OCR/训练营证据，或明确标记 `pending_manual_baseline`。
5. 后端发布链不裁剪 `ownerRole`、`trigger`、`critOnly`、`targetRole`。
6. 无 crit context 时仍 blocked，不允许静默近似。
