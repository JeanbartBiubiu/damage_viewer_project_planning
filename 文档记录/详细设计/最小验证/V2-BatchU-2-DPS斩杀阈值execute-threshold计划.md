TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-06-13

# V2 Batch U-2 DPS 斩杀阈值 execute_threshold 计划

关联概要：[验证里程碑V2](../../概要设计/验证里程碑V2.md)

前置真实装备链路：[V2-BatchP-单攻击方DPS真实装备联动闭环计划](./V2-BatchP-单攻击方DPS真实装备联动闭环计划.md)

前置 U0 引用契约：[V2-BatchU-0-DPS装备引用契约与Preflight硬化计划](./V2-BatchU-0-DPS装备引用契约与Preflight硬化计划.md)

## 1. 文档边界

本文是 Batch U-2 的详细设计和 Cursor 执行真源。目标是为 single-attacker DPS 增加最小 `execute_threshold` operation，用于表达收集者、低血量斩杀类装备或被动。

本批只处理“本次伤害结算后，目标当前 HP / 最大 HP 满足阈值时，追加 execute evidence 并终止目标”的单目标语义。不实现完整击杀参与、金币收益、重置、目标选择或多目标传播。

## 2. 目标

1. 新增 `execute_threshold` DPS passive operation。
2. 支持按目标当前生命比例或当前生命值判断。
3. 明确执行顺序：先应用本次普通伤害、抗性、modifier 和 HP 变化，再检查 execute。
4. Execute 不污染普通 `damageBySource`；应有单独 evidence 或 sourceCategory。
5. 页面和导出 JSON 能区分“普通伤害击杀”和“execute 触发击杀”。
6. 增加 synthetic tests，必要时接入收集者代表配置。

## 3. 非目标

1. 不实现击杀/参与击杀触发。
2. 不实现金币、移速、冷却刷新或其他击杀收益。
3. 不实现多目标 execute。
4. 不实现英雄特例。
5. 不猜测收集者真实数值；真实数值需要 OCR/训练营数据。
6. 不改变现有普通伤害结算顺序。

## 4. Operation 契约

建议形状：

```json
{
  "kind": "execute_threshold",
  "targetRole": "target",
  "thresholdType": "current_hp_ratio",
  "thresholdValue": 0.05,
  "checkTiming": "after_damage",
  "source": "collector_execute"
}
```

字段说明：

1. `thresholdType` 第一版支持：
   - `current_hp_ratio`
   - `current_hp_value`
2. `thresholdValue` 必须是有限非负数。
3. `checkTiming` 第一版只支持 `after_damage`。
4. `source` 用于 evidence，不应混入普通 damage source。

## 5. 写入范围

### 5.1 Wasm Gate

允许写入：

1. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go`
2. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_operation_handlers.go`
3. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_passive_dispatcher.go`
4. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_validation.go`
5. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go`

禁止写入 Web/Backend/DB。

### 5.2 Web Gate

允许写入：

1. `C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.ts`
2. `C:\project\damage_web_dev\web\src\pages\WasmValidationV2DpsPage.tsx`
3. `C:\project\damage_web_dev\web\src\components\skill-editor\skillModels.ts`，仅限最小校验/摘要。

禁止实现完整结构化编辑器。

## 6. 运行时语义

一次 basic attack 的相关顺序：

1. 读取攻击方和目标属性快照。
2. 计算基础伤害、暴击、抗性、incoming modifier。
3. 应用本次 HP 变化。
4. 触发 after-damage passives。
5. 如果 `execute_threshold` 条件满足：
   - target HP 置为 0。
   - `killTimeMs` 设置为当前事件时间。
   - stop reason 或 effect evidence 标记 execute。
   - 不再排后续攻击/DoT。
6. 如果 execute 未触发，继续现有事件调度。

关键约束：

1. threshold 检查使用 damage 后的目标 HP。
2. 如果普通伤害已经击杀，execute 不重复触发。
3. execute 不是额外伤害，不应增加普通 damageTimeline 数值。
4. execute evidence 必须记录 threshold、hpBeforeCheck、maxHp、triggered。

## 7. 测试矩阵

| 用例 | 输入 | 预期 |
| --- | --- | --- |
| 未达阈值 | damage 后 HP ratio 0.06，threshold 0.05 | 不触发 |
| 达阈值 | damage 后 HP ratio 0.04，threshold 0.05 | 触发 execute，HP=0 |
| 普通伤害已击杀 | damage 后 HP <= 0 | 不重复 execute |
| value threshold | damage 后 HP=40，threshold value=50 | 触发 |
| invalid threshold | thresholdValue < 0 或非有限数 | validation blocked |
| 页面导出 | 收集者 synthetic passive | JSON 有 execute evidence |

## 8. 验证命令

Wasm：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./internal/runtime -run "Execute|Threshold|Collector|SingleAttackerDPS" -count=1
go test ./...
go run ./cmd/bench
```

Web：

```powershell
cd C:\project\damage_web_dev\web
npm run build
```

页面 smoke 需要确认 execute evidence 出现在 V2 DPS 页面和导出 JSON。

## 9. Cursor Prompt：Wasm Gate

```text
目标：实现 Batch U-2 的 execute_threshold DPS passive operation，支持单目标 after_damage 斩杀阈值。

执行模型：Cursor composer-2.5，fast=false。

允许写入：
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_operation_handlers.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_passive_dispatcher.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_validation.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go

只读参考：
- C:\project\damage_viewer_project_planning\文档记录\详细设计\最小验证\V2-BatchU-2-DPS斩杀阈值execute-threshold计划.md

非目标：
- 不改 Web/Backend/DB。
- 不实现击杀收益、金币、刷新、多目标。
- 不硬编码收集者 itemId。

实现要求：
1. 新增 execute_threshold operation schema。
2. validation 校验 thresholdType、thresholdValue、checkTiming。
3. after_damage 时检查目标 damage 后 HP。
4. 触发时 target HP 置 0，输出 execute evidence，不把 execute 当普通 damage。
5. 增加未触发、触发、普通伤害已击杀、非法参数测试。

停止条件：
- 如果当前 DPS timeline 没有合适的 after-damage hook，停止并报告最小前置改造。
- 如果必须改完整事件调度器，停止并拆分。
```

## 10. Cursor Prompt：Web Gate

```text
目标：让 V2 DPS 页面和 adapter 保留 execute_threshold operation，并展示 Wasm 输出的 execute evidence。

执行模型：Cursor composer-2.5，fast=false。

允许写入：
- C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.ts
- C:\project\damage_web_dev\web\src\pages\WasmValidationV2DpsPage.tsx
- C:\project\damage_web_dev\web\src\components\skill-editor\skillModels.ts

非目标：
- 不改 Wasm runtime。
- 不实现完整结构化编辑器。
- 不猜测真实装备数值。

实现要求：
1. 类型/摘要保留 execute_threshold operation 字段。
2. 页面显示 execute evidence，不把它混成普通伤害来源。
3. build 通过。

停止条件：
- 如果 Wasm 尚未输出结构化 execute evidence，停止并报告前置缺口。
```

## 11. 完成定义

1. Wasm execute synthetic tests 通过。
2. 非触发、触发、普通伤害击杀、非法参数路径均有覆盖。
3. 页面和导出 JSON 能看到 execute evidence。
4. Execute 不污染普通 damageBySource。
5. 如接入收集者真实数据，必须有数值来源；否则标记 pending manual baseline。
