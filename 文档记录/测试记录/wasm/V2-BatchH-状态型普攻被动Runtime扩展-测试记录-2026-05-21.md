TASK_KEY: planning-validation-milestones
DOC_TYPE: 测试记录
WORKSTREAM: planning
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-05-22

# V2 Batch H 状态型普攻被动 Runtime 扩展测试记录 2026-05-21

关联计划：[V2-BatchH-状态型普攻被动Runtime扩展计划.md](../../详细设计/最小验证/V2-BatchH-状态型普攻被动Runtime扩展计划.md)

结论：
1. `H-runtime-pass` 通过：TinyGo runtime 支持 `add_stack + perStack stat_modifier`，并通过 synthetic canonical 覆盖叠层、封顶、过期、非法契约和 passive 级 stack 隔离。
2. `H-real-data-pass` 不通过，当前标记为 `H-real-data-blocked`：本地 Ezreal P 缺少可审计每层攻速和持续时间；`item 3124` 鬼索的狂暴之刃 “沸腾打击” 虽有可审计攻速叠层数值，但 Batch G 清单标明同一被动还需要 `phantom_hit_on_hit_repeat`，因此只能作为已发布子机制/runtime 页面证据，不能替代真实数据 gate。
3. 后端实际发布版本使用 `v2_batch_h_stacking_stat_passives_001`。为满足该版本码长度，后端 `game_versions.version_code` / `published_bundle_snapshots.version_code` 已从 `varchar(32)` 扩到 `varchar(64)`，并补充了可重复执行的显式迁移 SQL。

## 1. Runtime 验证

变更范围：
1. `wasm/tinygo_engine_v2/internal/runtime/dps_driver.go`
2. `wasm/tinygo_engine_v2/internal/runtime/dps_driver_test.go`
3. `wasm/tinygo_engine_v2/dist/tinygo_engine_v2.wasm`

新增/覆盖用例：
1. `TestSingleAttackerDPSStackingStatModifierOnHitAffectsCadenceAndCaps`
2. `TestSingleAttackerDPSStackingStatModifierExpiresBeforeNextHit`
3. `TestSingleAttackerDPSBlocksInvalidStackingStatModifierContracts`
4. `TestSingleAttackerDPSStackingStatModifierStackKeysArePassiveScoped`

验证命令：
```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./internal/runtime -run "Canonical|SingleAttackerDPS" -count=1
go test ./...
go run ./cmd/bench
$env:WASMOPT="C:\project\damage_wasm_dev\.tools\binaryen-version_129\bin\wasm-opt.exe"
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1 -TinyGo "C:\project\damage_wasm_dev\.tools\tinygo0.40.1\tinygo\bin\tinygo.exe"
$env:TINYGO_WASM_EXEC="C:\project\damage_wasm_dev\.tools\tinygo0.40.1\tinygo\targets\wasm_exec.js"
node .\scripts\smoke-node.mjs
```

结果：
| 命令 | 结果 |
| --- | --- |
| `go test ./internal/runtime -run "Canonical|SingleAttackerDPS" -count=1` | 通过，`ok tinygo_engine_v2/internal/runtime 0.293s` |
| `go test ./...` | 通过 |
| `go run ./cmd/bench` | 通过，`samples=100 avg_us=169.31 max_us=565.00` |
| TinyGo build | 通过，`dist/tinygo_engine_v2.wasm` 448637 bytes |
| Node smoke | 通过，导出 ABI 包含 `engine_init` / `engine_step` / `engine_snapshot_initial` 等入口 |

## 2. 子机制 seed 与后端发布

Seed：
```text
C:\project\damage_wasm_dev\最小验证\V2-Batch-H-stacking-stat-passives.seed.json
```

已发布子机制对象：
| 项 | 值 |
| --- | --- |
| item | `3124` 鬼索的狂暴之刃 |
| passive skill | `item_3124_guinsoos_boiling_strike_dps_v2` |
| skillKey | `p_boiling` |
| stackKey | `guinsoos_boiling_strike` |
| 每层攻速 | `0.08` |
| 最大层数 | `4` |
| 持续时间 | `3000ms` |
| refreshMode | `refresh` |
| 排除机制 | `phantom_hit_on_hit_repeat` |
| gate 口径 | 仅作为 published sub-mechanism 证据；因同一被动还需要 `phantom_hit_on_hit_repeat`，不满足 `H-real-data-pass` |

后端命令：
```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn -q -DskipTests test-compile org.codehaus.mojo:exec-maven-plugin:3.5.0:java "-Dexec.classpathScope=test" "-Dexec.mainClass=xyz.game.datamanage.tools.KatarinaMvpImportMain" "-Dexec.args=--dryRun --seedFile=C:\project\damage_wasm_dev\最小验证\V2-Batch-H-stacking-stat-passives.seed.json --versionCode=v2_batch_h_stacking_stat_passives_001"
mvn -q -DskipTests test-compile org.codehaus.mojo:exec-maven-plugin:3.5.0:java "-Dexec.classpathScope=test" "-Dexec.mainClass=xyz.game.datamanage.tools.KatarinaMvpImportMain" "-Dexec.args=--seedFile=C:\project\damage_wasm_dev\最小验证\V2-Batch-H-stacking-stat-passives.seed.json --versionCode=v2_batch_h_stacking_stat_passives_001"
```

结果：
1. dry-run 通过，识别 `ownerTypes=1`、`skills=1`、`items=1`。
2. 实际导入发布通过：`Published versionCode=v2_batch_h_stacking_stat_passives_001`，并通过 `Verified current + bundle`。
3. DB 目标为 `test0221 / postgres`，凭据未记录；版本行 `version_id=113`，`current=true`，`published=true`，`snapshot=true`，两张发布链表的 `version_code` 均为 `varchar(64)`。
4. Public bundle 验证通过：current 和 bundle meta 均为 `v2_batch_h_stacking_stat_passives_001`，item `3124.skillRefs` 同时包含既有 `item_3124_guinsoos_rageblade_wrath_dps_v2` 与新增 `item_3124_guinsoos_boiling_strike_dps_v2`。
5. 后端 schema/test schema 变更后，`mvn test` 通过：`Tests run: 48, Failures: 0, Errors: 0, Skipped: 0`。
6. 可重复迁移 SQL 已补充：`C:\project\damage_backend_dev\db\game_manage\migrations\compatibility\version_code_varchar64_compatibility_migration.sql`，用于已有 DB 从 `varchar(32)` 显式扩到 `varchar(64)`。
7. `ControllerPublishFlowIT` 增加了超过 32 字符 `versionCode` 的 current/bundle 断言；该 IT 需要 `IT_DB_URL` / `IT_DB_USERNAME` 环境变量才会执行，普通 `mvn test` 只验证编译和非 IT 单测。

Bundle 中 Batch H operations：
```json
[
  {
    "kind": "add_stack",
    "stackKey": "guinsoos_boiling_strike",
    "maxStacks": 4,
    "durationMs": 3000,
    "refreshMode": "refresh"
  },
  {
    "kind": "stat_modifier",
    "stackKey": "guinsoos_boiling_strike",
    "attrKey": "attack_speed",
    "modifierMode": "percent",
    "value": 0.08,
    "perStack": true
  }
]
```

## 3. Web 页面验证

变更范围：
1. `C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.ts`
2. `C:\project\damage_web_dev\web\src\pages\WasmValidationV2DpsPage.tsx`
3. `C:\project\damage_web_dev\web\src\App.tsx`
4. `C:\project\damage_web_dev\web\src\config\navigation.ts`
5. `C:\project\damage_web_dev\web\src\engine\wasm\tinygo_engine_v2.wasm`
6. `C:\project\damage_web_dev\web\output\playwright\v2-batch-h-stacking-passive-verify.spec.cjs`

页面入口：
```text
http://127.0.0.1:5173/#/wasm-validation-v2-dps-stacking-passive
```

验证命令：
```powershell
cd C:\project\damage_web_dev\web
npm run build
$env:NODE_PATH="$env:LOCALAPPDATA\npm-cache\_npx\420ff84f11983ee5\node_modules"
npx --yes --package @playwright/test playwright test output/playwright/v2-batch-h-stacking-passive-verify.spec.cjs --reporter=line --workers=1
```

结果：
1. `npm run build` 通过；保留既有 Vite large chunk warning。
2. Playwright 通过：`2 passed (2.3s)`。用 API route mock 覆盖 published bundle ready 和 forced unavailable fallback 两条路径，确认 synthetic preset 不依赖真实 3124 readiness。
3. Wasm SHA256：`d96571b47595d6e0ad5145c0bd235fa1c71c2ac7a8a5d8bb4efb1de06e5b8f63`，与 wasm worktree 构建产物一致。
4. 页面证据 JSON：`C:\project\damage_web_dev\web\output\playwright\v2-batch-h-stacking-passive-evidence.json`
5. 页面截图：`C:\project\damage_web_dev\web\output\playwright\v2-batch-h-stacking-passive-after-run.png`
6. 当 `current/bundle` 被 Playwright mock 为不可用时，页面使用 `synthetic_batch_h_runtime_preset` 最小 bundle 运行 synthetic cap / expiry / invalid 三类 runtime 证据；该 fallback 只证明 `H-runtime-pass` 页面证据，不改变 `H-real-data-blocked`。

页面 A/B 关键证据（Playwright route-mocked published 3124 sub-mechanism fixture）：
| 项 | baseline | published 3124 sub-mechanism |
| --- | ---: | ---: |
| attackCount | `10` | `17` |
| totalDamage | `700` | `1700` |
| `rawAttackSpeed` range | 未启用 Batch H | `1.35 -> 1.6500000000000001` |
| `attackIntervalMs` range | 未启用 Batch H | `741 -> 606` |
| `add_stack` count | `0` | `17` |
| `stat_modifier` count | `0` | `33` |
| max stack | `0` | `4` |

Synthetic expiry preset 只用于 runtime 页面证据，不替代真实数据 gate：
1. passive：`synthetic_batch_h_expiring_stack_dps_v2`
2. `durationMs=500`，`maxStacks=4`
3. 观察到多次 `add_stack` 均为 `before=0 after=1`
4. 观察到 `stat_modifier` 最大 `stacks=1`
5. 说明 lazy expiry 在下一次 DPS 事件前清理，页面没有在 TypeScript 中计算 stack 或攻速。

Synthetic cap preset 只用于 runtime 页面证据，不替代真实数据 gate：
1. passive：`synthetic_batch_h_capped_stack_dps_v2`
2. `durationMs=6000`，`maxStacks=4`
3. 页面导出证据要求 `maxStackAfter=4`、`maxStatModifierStacks=4`，且 `rawAttackSpeed` 随 stack 增长。

Synthetic invalid preset 只用于 runtime 页面证据，不替代真实数据 gate：
1. passive：`synthetic_batch_h_invalid_stack_dps_v2`
2. `stat_modifier.stackKey` 故意不匹配同 passive 的 `add_stack.stackKey`
3. 页面导出证据要求该 curve 为 `blocked`，blocked reason 包含 `requires matching add_stack`。

## 4. 收口状态

| Gate | 状态 | 依据 |
| --- | --- | --- |
| `H-runtime-pass` | 通过 | runtime tests、全量 Go tests、bench、TinyGo build、Node smoke |
| `H-real-data-pass` | 未通过 | Ezreal P 缺本地可审计每层攻速和持续时间；3124 沸腾打击同一被动还需要 `phantom_hit_on_hit_repeat` |
| `H-real-data-blocked` | 适用 | 3124 seed 和页面 A/B 仅证明可编码子机制可发布、可运行，不能替代完整真实对象验收 |

后续独立 backlog 不在本批实现：
1. `phantom_hit_on_hit_repeat`
2. `target_side_stacking_stat_modifier`
3. `spellblade_next_attack_state`
4. `energized_charge_and_consume`
5. `seeded_random_crit_sequence`
