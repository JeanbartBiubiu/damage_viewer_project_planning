TASK_KEY: planning-validation-milestones
DOC_TYPE: 测试记录
WORKSTREAM: planning
STATUS: active
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-05-19

# V2 Batch F Canonical 回归硬化测试记录 2026-05-19

关联概要：[验证里程碑V2.md](../../概要设计/验证里程碑V2.md)

关联详细设计：[V2-单攻击方DPS协议与开发计划.md](../../详细设计/最小验证/V2-单攻击方DPS协议与开发计划.md)

关联计划：[V2-BatchF-Canonical回归硬化计划.md](../../详细设计/最小验证/V2-BatchF-Canonical回归硬化计划.md)

## 1. 本轮范围

本轮按 Batch F 计划做 canonical 回归硬化，不扩新英雄或新装备覆盖。

已完成：

1. 在 wasm runtime 层固化 F1-F6 canonical case。
2. 修复 `pre_enabled_state_modifier` / `stat_modifier_always_on` 在 scenario state 到期后不会回落的问题。
3. 回归页面 A `#/wasm-validation-v2-dps` 和页面 B `#/wasm-validation-v2-dps-multi-hero` 的默认运行与导出字段。

不需要用户补充游戏截图；F1-F6 是 synthetic runtime 语义回归，不是新数值人工验收。

## 2. Runtime 修复摘要

文件：

| 文件 | 变更 |
| --- | --- |
| `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver.go` | 新增 `baseAttrs` 和攻击前 `refreshActiveStatModifiers(timeMs)`；状态类 stat modifier 按当前时间重算，scenario state 到期后恢复基础属性。 |
| `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go` | 新增 F1-F6 canonical tests 和局部测试 fixture/helper。 |

## 3. Canonical Case 结果

命令：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./internal/runtime -run "Canonical|SingleAttackerDPS" -count=1
```

结果：通过。

| Case | 测试名 | 结果 | 证明点 |
| --- | --- | --- | --- |
| F1 | `TestSingleAttackerDPSCanonicalBuffExpiresAtNextAttackBoundary` | 通过 | 攻速 buff 在第二次攻击时刻到期，第二次攻击后的排程使用基础攻速；`attackIntervalTimeline` 保留 raw/effective/interval。 |
| F2 | `TestSingleAttackerDPSCanonicalAttackSpeedCapBoundary` | 通过 | `2.99 / 3.0 / 3.01` 同批运行；`3.01` raw 保留、effective 被 cap 到 `3.0`、overflow 为 `0.01`。 |
| F3 | `TestSingleAttackerDPSCanonicalDotTicksAtExpireBoundary` | 通过 | DoT tick 包含 `expireAt=4000ms`，tick 时间为 `1000/2000/3000/4000`。 |
| F4 | `TestSingleAttackerDPSCanonicalSourceOrderForAttackPassivesAndDot` | 通过 | 同次普攻顺序为 basic attack、hero on-hit、item on-hit、DoT apply，后续 DoT tick；runtime 顺序不依赖前端排序。 |
| F5 | `TestSingleAttackerDPSCanonicalBlockedCurveDoesNotPoisonBatch` | 通过 | 同批 ok + blocked 共存；blocked curve 保留 `blockedReasons`，不合成伤害或 timeline。 |
| F6 | `TestSingleAttackerDPSCanonicalCritPolicyExpectedAndUnsupportedRandom` | 通过 | `expected` 暴击策略产生期望伤害并导出；`seeded_random` 明确 blocked。 |

Deferred：无。

## 4. 自动化回归

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./...
```

结果：通过。

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go run ./cmd/bench
```

结果：通过。

本轮 bench 输出：

```text
samples=100 avg_us=159.38 max_us=819.00
```

```powershell
cd C:\project\damage_web_dev\web
npm run build
```

结果：通过。保留既有 Vite large chunk warning，不作为本轮阻塞。

## 5. 页面 Smoke

前置：

1. 后端：`http://localhost:8080`
2. 前端：`http://127.0.0.1:5174`
3. 页面内选择 `gameId=lol`
4. published version：`v2_batch_d_item_passives_002`

### 页面 A

入口：

```text
http://127.0.0.1:5174/#/wasm-validation-v2-dps
```

结果：通过。

导出字段抽查：

| 字段 | 结果 |
| --- | --- |
| `caseId` | `V2-BatchE-1-single-hero-multicurve-001` |
| `versionCode` | `v2_batch_d_item_passives_002` |
| `wasmOutput.simulationRules.critPolicy` | `expected` |
| `wasmOutput.curveResults.length` | `4` |
| `curveResults[0].attackIntervalTimeline` | 存在 |
| `curveResults[0].damageTimeline` | 存在 |
| `curveResults[0].targetHpTimeline` | 存在 |
| `curveResults[0].blockedReasons` | 存在 |
| `curveResults[0].effectBreakdown` | 存在 |

### 页面 B

入口：

```text
http://127.0.0.1:5174/#/wasm-validation-v2-dps-multi-hero
```

结果：通过。

导出字段抽查：

| 字段 | 结果 |
| --- | --- |
| `caseId` | `V2-BatchE-B-multi-hero-same-equipment-001` |
| `versionCode` | `v2_batch_d_item_passives_002` |
| `wasmOutput.simulationRules.critPolicy` | `expected` |
| `wasmOutput.curveResults.length` | `3` |
| `curveResults[].status` | `ok, ok, ok` |
| `curveResults[0].attackIntervalTimeline` | 存在 |
| `curveResults[0].damageTimeline` | 存在 |
| `curveResults[0].targetHpTimeline` | 存在 |
| `curveResults[0].blockedReasons` | 存在 |
| `curveResults[0].effectBreakdown` | 存在 |

## 6. 治理与收尾

```powershell
cd C:\project\damage_wasm_dev
node tools/task-governance/cli.mjs rebuild
```

结果：通过。

关键输出：

```text
unassigned_docs: 0
planning-validation-milestones (23 docs)
```

```powershell
cd C:\project\damage_wasm_dev
git -c safe.directory=C:/project/damage_wasm_dev diff --check
```

结果：通过。

```powershell
cd C:\project\damage_web_dev
git -c safe.directory=C:/project/damage_web_dev diff --check
```

结果：通过。
