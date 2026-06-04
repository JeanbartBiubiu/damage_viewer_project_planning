TASK_KEY: planning-validation-milestones
DOC_TYPE: 测试记录
WORKSTREAM: planning
STATUS: done
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-06-04

# V2 Batch K 单攻击方 DPS 收口与鬼索幻影命中测试记录 2026-06-04

关联计划：[V2-BatchK-单攻击方DPS收口与鬼索幻影命中计划.md](../../详细设计/最小验证/V2-BatchK-单攻击方DPS收口与鬼索幻影命中计划.md)

结论：

1. `K0-pass`：V2 DPS 页面导出链路可复核 `selection`、`resolvedSnapshot`、`simulationRules`、`curveResults`、`attackIntervalTimeline`、`damageTimeline`、`targetHpTimeline`、`effectBreakdown` 和 `itemPassiveTriggers`；Batch F canonical / expected crit 相关 runtime tests 仍在回归集合内。
2. `K-runtime-pass`：Wasm 支持 `phantom_hit_on_hit_repeat`，并通过 phantom / canonical / single_attacker_dps、全量 Go tests、bench、TinyGo build、Node smoke。
3. `K-real-data-pass`：`3124` 鬼索 published current bundle 为 `v2_batch_k_guinsoo_phantom_hit_001`，同一 merged skill 同时包含 Batch D on-hit damage、Batch H stacking stat modifier、Batch K phantom-hit repeat，页面以 published bundle 跑通真实 3124 case。
4. GPT/Codex review 未发现阻塞项；残留风险见第 8 节。

## 1. 改动范围

Wasm：

1. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go`
2. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver.go`
3. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go`

Backend：

1. `C:\project\damage_backend_dev\最小验证\V2-Batch-K-guinsoo-phantom-hit.seed.json`
2. `C:\project\damage_backend_dev\最小验证\V2-Batch-K-guinsoo-phantom-hit-audit.json`
3. `C:\project\damage_backend_dev\server\data_manage\src\test\java\xyz\game\datamanage\tools\KatarinaMvpImportMainTest.java`
4. `C:\project\damage_backend_dev\server\data_manage\src\main\resources\application.yml` 仅保留用户环境变更：DB host `192.168.5.5`

Web：

1. `C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.ts`
2. `C:\project\damage_web_dev\web\src\pages\WasmValidationV2DpsPage.tsx`
3. `C:\project\damage_web_dev\web\src\engine\wasm\tinygo_engine_v2.wasm`

## 2. DTO 与契约字段

`DPSPassiveOperationV2` 新增字段：

1. `repeatCount`
2. `repeatTag`
3. `repeatScope`
4. `phantomHitCopyable`

输出证据字段：

1. `damageTimeline[].phantomHit`
2. `damageTimeline[].repeatTag`
3. `itemPassiveTriggers[].phantomHit`
4. `itemPassiveTriggers[].repeatTag`
5. `effectBreakdown[].phantomHit`
6. `effectBreakdown[].repeatTag`

最终 published 约定：

```json
{
  "kind": "phantom_hit_on_hit_repeat",
  "source": "guinsoos_phantom_hit",
  "stackKey": "guinsoos_boiling_strike",
  "triggerStacks": 4,
  "repeatCount": 1,
  "repeatTag": "phantom_hit",
  "repeatScope": "copyable_on_hit"
}
```

可复制 on-hit damage：

```json
{
  "kind": "damage",
  "source": "guinsoos_wrath_on_hit",
  "damageType": "magic",
  "amount": 30,
  "phantomHitCopyable": true
}
```

## 3. Runtime 验证

新增/覆盖关键测试：

1. `TestSingleAttackerDPSPhantomHitRepeatsCopyableOnHitDamage`
2. `TestSingleAttackerDPSPhantomHitDoesNotRecurse`
3. `TestSingleAttackerDPSPhantomHitDoesNotIncrementEveryNOrStacks`
4. `TestSingleAttackerDPSBlocksInvalidPhantomHitContracts`
5. `TestSingleAttackerDPSGuinsooPhantomHitFixture`

验证命令与结果：

| 命令 | 结果 |
| --- | --- |
| `go test ./internal/runtime -run "Phantom|Canonical|SingleAttackerDPS" -count=1` | 通过，`ok tinygo_engine_v2/internal/runtime 0.379s` |
| `go test ./...` | 通过 |
| `go run ./cmd/bench` | 通过，`samples=100 avg_us=175.33 max_us=1054.00` |
| `powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1` | 通过，`dist/tinygo_engine_v2.wasm` 472907 bytes |
| `node .\scripts\smoke-node.mjs` | 通过，导出包含 `engine_init`、`engine_begin_run`、`engine_step`、`engine_snapshot_initial` 等 ABI |

回归集合包含 Batch D/H/J 相关测试名：

1. Batch D on-hit：`TestSingleAttackerDPSItemOnHitPassiveRoutesToItemTriggers`、`TestSingleAttackerDPSItemCurrentHPOnHitUsesAttackStartBasis`、`TestSingleAttackerDPSItemEveryThirdHitSupportsMissingHPScaling`
2. Batch H stacking：`TestSingleAttackerDPSStackingStatModifierOnHitAffectsCadenceAndCaps`、`TestSingleAttackerDPSStackingStatModifierExpiresBeforeNextHit`、`TestSingleAttackerDPSBlocksInvalidStackingStatModifierContracts`
3. Batch J expected crit：`TestSingleAttackerDPSExpectedCritDamageForBasicAttacks`、`TestSingleAttackerDPSCanonicalCritPolicyExpectedAndUnsupportedRandom`

## 4. Backend Seed 与发布验证

Seed：

```text
C:\project\damage_backend_dev\最小验证\V2-Batch-K-guinsoo-phantom-hit.seed.json
```

Audit：

```text
C:\project\damage_backend_dev\最小验证\V2-Batch-K-guinsoo-phantom-hit-audit.json
```

关键 seed 设计：

1. `3124.skillRefs` 只包含 `item_3124_guinsoos_boiling_strike_dps_v2`，避免同时引用旧 wrath skill 后重复计算 30 magic on-hit。
2. 同一 `dpsPassiveEffects[0].operations` 包含 `damage`、`add_stack`、`stat_modifier`、`phantom_hit_on_hit_repeat` 四类 operation。
3. Batch H 的 `excludedMechanics=["phantom_hit_on_hit_repeat"]` 不再出现在 Batch K published skill。

验证命令与结果：

| 命令 | 结果 |
| --- | --- |
| `mvn test` | 通过，`Tests run: 59, Failures: 0, Errors: 0, Skipped: 0` |
| Batch K seed dry-run | 通过，`ownerTypes=1`、`skills=1`、`items=1`、无 HTTP/DB 写入 |
| 实际 import/publish | 已执行并发布；current API 复核见下表 |

Live API 复核：

| 项 | 值 |
| --- | --- |
| DB host | `192.168.5.5:5432/test0221` |
| `GET /api/games` | 返回 `lol` |
| `GET /api/games/lol/versions/current` | `v2_batch_k_guinsoo_phantom_hit_001` |
| publishedAt | `2026-06-03T16:06:09.064427Z` |

Bundle 复核：

| 项 | 值 |
| --- | --- |
| item | `3124` / `鬼索的狂暴之刃` |
| `3124.skillRefs` | `["item_3124_guinsoos_boiling_strike_dps_v2"]` |
| operation kinds | `damage`、`add_stack`、`stat_modifier`、`phantom_hit_on_hit_repeat` |
| damage op | `source=guinsoos_wrath_on_hit`、`damageType=magic`、`amount=30`、`phantomHitCopyable=true` |
| stacking ops | `guinsoos_boiling_strike`、`maxStacks=4`、`durationMs=3000`、`attack_speed +0.08 perStack` |
| phantom op | `triggerStacks=4`、`repeatCount=1`、`repeatTag=phantom_hit`、`repeatScope=copyable_on_hit` |
| excludedMechanics | 空 |

证据文件：

```text
C:\project\damage_wasm_dev\.agents\artifacts\batch-k-runtime\bundle-current-rerun-summary.json
```

## 5. Web 与 Playwright 用户流

验证命令：

```powershell
cd C:\project\damage_web_dev\web
npm run build
```

结果：通过；保留既有 Vite large chunk warning。

Playwright 用户流：

1. 打开 `http://127.0.0.1:5173/#/wasm-validation-v2-dps-stacking-passive`
2. 页面加载 current `v2_batch_k_guinsoo_phantom_hit_001`
3. 点击 `运行`
4. 页面显示 `Phantom Hit (3124) pass`
5. 切到 `Batch K / 3124 Guinsoo`
6. 点击 `导出 JSON`，拦截页面实际复制的 export payload 并保存
7. 对导出 JSON 做字段级断言

页面证据：

| 项 | 值 |
| --- | --- |
| route | `#/wasm-validation-v2-dps-stacking-passive` |
| current version | `v2_batch_k_guinsoo_phantom_hit_001` |
| page wasm hash | `d3d562944af35e81d4dad56092808ab6529d6550665d38a8f325d676d4861e85` |
| wasm dist hash | `D3D562944AF35E81D4DAD56092808AB6529D6550665D38A8F325D676D4861E85` |
| web wasm hash | `D3D562944AF35E81D4DAD56092808AB6529D6550665D38A8F325D676D4861E85` |
| hash match | true |
| console error | `/favicon.ico` 404；非业务错误 |

导出 JSON 断言：

| 项 | 值 |
| --- | --- |
| `activeCurveId` | `vayne-batch-h-guinsoo-3124` |
| curve status | `ok` |
| totalDamage | `1121.8416666666656` |
| attackCount | `15` |
| `damageTimeline` count | `42` |
| original on-hit damage count | `15` |
| phantom damage count | `12` |
| itemPassiveTriggers count | `27` |
| phantom item trigger count | `12` |
| effectBreakdown count | `71` |
| phantom effect breakdown count | `12` |
| `damageBySource.guinsoos_wrath_on_hit` | `449.99999999999704` |
| resolved passive operation kinds | `damage`、`add_stack`、`stat_modifier`、`phantom_hit_on_hit_repeat` |

导出证据文件：

```text
C:\project\damage_wasm_dev\.agents\artifacts\batch-k-runtime\stacking-page-export-rerun.json
C:\project\damage_wasm_dev\.agents\artifacts\batch-k-runtime\stacking-page-export-rerun-summary.json
C:\project\damage_wasm_dev\.agents\artifacts\batch-k-runtime\stacking-page-rerun-after-active-guinsoo.png
C:\project\damage_wasm_dev\.agents\artifacts\batch-k-runtime\wasm-hash-rerun.json
```

## 6. Cursor 工作流证据

Cursor 后端 seed 任务：

```text
C:\project\damage_wasm_dev\.agents\artifacts\cursor-batch-k-backend-seed\summary.json
```

Cursor Web K2 任务：

```text
C:\project\damage_wasm_dev\.agents\artifacts\cursor-batch-k-web-k2\summary.json
```

两轮均记录：

1. `model.id = composer-2.5`
2. `fast = false`
3. SDK runtime used
4. 写入范围受限
5. GPT/Codex 已复核 diff、命令和页面行为

## 7. 收口状态

| Gate | 状态 | 依据 |
| --- | --- | --- |
| `K0-pass` | 通过 | 页面导出 payload 含 `selection`、`resolvedSnapshot`、`simulationRules`、`curveResults`、timeline、trigger、breakdown；canonical/crit 回归在 runtime tests 中通过 |
| `K-runtime-pass` | 通过 | phantom/canonical/single DPS tests、全量 Go tests、bench、TinyGo build、Node smoke 均通过 |
| `K-real-data-pass` | 通过 | seed dry-run/current bundle/page published 3124 case/导出 JSON 字段断言均通过 |

## 8. 残留风险

1. `application.yml` 的 DB host 已按用户环境改为 `192.168.5.5`；该改动是本机联调配置，不应在后续 Batch K review 中被误回退。
2. 本轮没有重复执行实际 import/publish，以避免对已经 current 的 `v2_batch_k_guinsoo_phantom_hit_001` 做无意义重发；真实发布状态由 current API、publishedAt 和 bundle 内容证明。
3. Web build 仍有既有 large chunk warning；不影响本批 Batch K 行为验收。
4. Playwright console 中存在 `/favicon.ico` 404；非业务路径，不影响 DPS 验收。
