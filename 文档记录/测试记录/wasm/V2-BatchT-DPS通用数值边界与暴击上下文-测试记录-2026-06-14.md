TASK_KEY: planning-validation-milestones
DOC_TYPE: 测试记录
WORKSTREAM: planning
STATUS: done
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-06-14

# V2 Batch T DPS 通用数值边界与暴击上下文测试记录 2026-06-14

关联计划：[V2-BatchT-DPS通用数值边界与暴击上下文计划.md](../../详细设计/最小验证/V2-BatchT-DPS通用数值边界与暴击上下文计划.md)

## 1. 当前接手结论

本轮从 `C:\project\damage_wasm_dev` / `wasm/dev` 接手 Batch T，按计划文档和当前代码判断：

1. 后端 `attribute_definitions.minValue/maxValue` 持久化已由上一轮收口，不是本轮主要剩余点。
2. Wasm dirty diff 已落到 T-2 主线：`DPSCritContextV2`、`crit_context_modifier`、expected crit normal/crit portion、`critOnly` 按 crit portion 生效、`onCrit` expected damage 加权、`critScalingValueSpec` 代表测试，以及 passive internal cooldown 证据。
3. Web dirty diff 已落到 T-3 / authoring evidence 主线：skill editor 暴露 `internalCooldownMs`，DPS adapter/page 展示 crit context 与 passive cooldown evidence，并同步了新版 `tinygo_engine_v2.wasm`。
4. Backend dirty diff 只补 `mechanicsConfig.dpsPassiveEffects[].internalCooldownMs` 发布链校验与测试，不扩 DB schema。

当前三个 worktree 都仍有未提交修改，不能把状态视为已合并或已发布。

## 2. 自动化验证

### 2.1 Wasm Go tests

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./...
```

结果：

```text
status=pass
go test -count=1 ./internal/runtime passed
go test -count=1 ./... passed
```

覆盖要点：

1. `crit_chance` raw/effective evidence 与 bounds evidence。
2. expected policy 下 `critOnly` 只作用于 crit portion。
3. 无 crit context 时 `critOnly` 仍 blocked。
4. `crit_context_modifier.forceCrit` / multiplier override / multiplier scale 代表路径。
5. expected onCrit 纯 damage 加权，stateful onCrit blocked。
6. `critScalingValueSpec` 读取 bounded crit chance。
7. passive internal cooldown triggered/skipped evidence。
8. DPS RunContext 同步保留 `crit_chance` pre-clamp evidence，同时不合成 `AttributeView`、不改变 base/current/max 读取语义。

### 2.2 Wasm native bench

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go run ./cmd/bench
```

结果：

```text
status=pass
samples=100 avg_us=301.96 max_us=1120.00
```

### 2.3 Wasm Node smoke

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
node .\scripts\smoke-node.mjs
```

结果：

```text
status=pass
dist\tinygo_engine_v2.wasm size_bytes=731928
sha256=329E83A8B95DD9C988981359E8B2F53ECFB3C06D37FB30C4017C8CD6371E5C9F
exports include engine_init, engine_begin_run, engine_outbox_ptr, engine_outbox_len, engine_outbox_clear
```

### 2.4 Backend test

```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn test
```

结果：

```text
status=pass
Tests run: 71
Failures: 0
Errors: 0
Skipped: 0
```

说明：输出中包含既有 Mockito dynamic agent warning，以及 `AdminEditLogHelperTest` 预期 fail-open 日志，不影响测试结果。

### 2.5 Web build

```powershell
cd C:\project\damage_web_dev\web
npm run build
```

结果：

```text
status=pass
tsc -b passed
vite build passed
wasm asset=tinygo_engine_v2-LwncFO5A.wasm 731.93 kB
web wasm sha256=329E83A8B95DD9C988981359E8B2F53ECFB3C06D37FB30C4017C8CD6371E5C9F
known warning=Some chunks are larger than 500 kB after minification
```

说明：chunk size warning 是既有 Vite 构建提示，不是 Batch T 新失败。

### 2.6 Browser smoke

```powershell
cd C:\project\damage_web_dev\web
npx --yes --package @playwright/cli playwright-cli -s=batch-t-v2 open http://127.0.0.1:5173/#/wasm-validation-v2-dps
npx --yes --package @playwright/cli playwright-cli -s=batch-t-v2 click "运行"
npx --yes --package @playwright/cli playwright-cli -s=batch-t-v2 snapshot
npx --yes --package @playwright/cli playwright-cli -s=batch-t-v2 console
npx --yes --package @playwright/cli playwright-cli -s=batch-t-v2 requests
```

结果：

```text
status=pass
fresh session default game: lol
page rendered: V2 DPS 单英雄多曲线工作台
current version: v2_batch_u_real_equipment_passives_003
case: V2-BatchE-1-single-hero-multicurve-001
curves: 6
preflightBlockedReasons: []
wasmSha256: 2ff2ce7f67bb30f109f5e504bbaf2d4a928d1593d4a95acb351a59251e902091
curve statuses: 6 ok
damageTimeline: 172
effectBreakdown: 246
damageTimeline critContext: 68
effectBreakdown critContext: 0
critContext with chanceRaw/chanceEffective: 0
boundEvidence: 0
console errors: 0
network: /api/games 200, /api/games/lol/versions/current 200, /api/games/lol/versions/v2_batch_u_real_equipment_passives_003/bundle 200, /src/engine/wasm/tinygo_engine_v2.wasm 200
```

证据文件：

```text
C:\project\damage_web_dev\output\playwright\batch-t-v2-dps-lol-fullflow-2026-06-14.png
C:\project\damage_web_dev\output\playwright\batch-t-v2-dps-lol-fullflow-2026-06-14-snapshot.json
C:\project\damage_web_dev\output\playwright\batch-t-v2-dps-lol-fullflow-2026-06-14-requests.json
C:\project\damage_web_dev\output\playwright\batch-t-v2-dps-lol-fullflow-2026-06-14-console.json
C:\project\damage_web_dev\output\playwright\batch-t-v2-dps-lol-fullflow-2026-06-14-export.json
C:\project\damage_web_dev\output\playwright\batch-t-v2-dps-lol-fullflow-2026-06-14-proof.json
```

说明：本节为本轮早些时候的 fresh session 默认 `lol` full-flow 证据；后续已通过 Admin API 将本地 `lol` current 推到带 `crit_chance.maxValue=1` 的 `v2_batch_t_crit_bounds_live_20260614_001`，并在 2.7 补齐 live 非 0 暴击率与边界裁剪证据。

### 2.7 Browser live Vayne crit equipment and bounds proof

```powershell
cd C:\project\damage_web_dev\web
npx --yes --package @playwright/cli playwright-cli -s=batch-t-bound-fixed open http://127.0.0.1:5173/#/wasm-validation-v2-dps
```

页面操作：

1. fresh session 打开 V2 DPS 页面，默认游戏显示 `GameId lol`。
2. 重新加载 current bundle，确认版本为 `v2_batch_t_crit_bounds_live_20260614_001`。
3. 在第一条 Vayne curve 通过 UI 选择 `3031`、`3046`、`3085`、`3094`、`3508`。
4. 点击运行，展开 `调试明细 -> 导出预览`，从 DOM 抽取 export JSON。

结果：

```text
status=pass
default game: lol
versionCode: v2_batch_t_crit_bounds_live_20260614_001
wasmSha256: 329e83a8b95dd9c988981359e8b2f53ecfb3c06d37fb30c4017c8cd6371e5c9f
first curve status: ok
first curve equipmentSet: 3031,3046,3085,3094,3508
equipmentStats.crit_chance: 1.25
totalDamage: 3000.00
attackCount: 11
killTimeMs: 4450
critContextWithChanceCount: 11
boundEvidenceCount: 11
chanceRaw: 1.25
chanceEffective: 1
boundEvidence.rawValue: 1.25
boundEvidence.boundedValue: 1
boundEvidence.max: 1
boundEvidence.wasClamped: true
```

证据文件：

```text
C:\project\damage_web_dev\output\playwright\batch-t-v2-dps-lol-crit-bound-published-fixed-2026-06-14-export.json
C:\project\damage_web_dev\output\playwright\batch-t-v2-dps-lol-crit-bound-published-fixed-2026-06-14-proof.json
C:\project\damage_web_dev\output\playwright\batch-t-v2-dps-lol-crit-bound-published-fixed-2026-06-14.png
```

说明：薇恩可以也应该用暴击装备验证这条链路。先前 live proof 缺口不是装备不可选，而是 DPS `syncRunContextFromDPSState` 用已 clamp 的 `state.attrs` 覆盖 RunContext，擦掉了 `AttributeStore` 的 pre-clamp 证据。修复后 DPS 计算仍使用 clamp 后 `crit_chance=1`，但 `critContext` 同时保留 `raw=1.25`、`effective=1` 与 `boundEvidence`。

### 2.8 Diff hygiene

```powershell
cd C:\project\damage_wasm_dev
git diff --check

cd C:\project\damage_backend_dev
git diff --check

cd C:\project\damage_web_dev
git diff --check
```

结果：

```text
status=pass
all three worktrees reported no whitespace errors
```

## 3. 当前未提交变更范围

Wasm：

```text
wasm/tinygo_engine_v2/internal/model/types.go
wasm/tinygo_engine_v2/internal/runtime/dps_contract.go
wasm/tinygo_engine_v2/internal/runtime/dps_damage.go
wasm/tinygo_engine_v2/internal/runtime/dps_driver_test.go
wasm/tinygo_engine_v2/internal/runtime/dps_energized.go
wasm/tinygo_engine_v2/internal/runtime/dps_hp_change_modifier_adapter.go
wasm/tinygo_engine_v2/internal/runtime/dps_passive_dispatcher.go
wasm/tinygo_engine_v2/internal/runtime/dps_state.go
wasm/tinygo_engine_v2/internal/runtime/dps_validation.go
```

Backend：

```text
server/data_manage/src/main/java/xyz/game/datamanage/service/PostgresWriteStore.java
server/data_manage/src/test/java/xyz/game/datamanage/service/PostgresWriteStorePublishTest.java
```

Web：

```text
web/src/App.tsx
web/src/components/skill-editor/SkillMechanicsConfigEditor.tsx
web/src/components/skill-editor/skillModels.ts
web/src/engine/tinygoV2DpsAdapter.test.ts
web/src/engine/tinygoV2DpsAdapter.ts
web/src/engine/wasm/tinygo_engine_v2.wasm
web/src/pages/WasmValidationV2DpsPage.tsx
```

## 4. 剩余风险与下轮建议

1. 页面级真实 published bundle 已补齐 Vayne 5 暴击装 live proof；注意该 proof 依赖本地开发库 current version `v2_batch_t_crit_bounds_live_20260614_001`，其它环境需要同步发布相同 `crit_chance.maxValue=1` 的 bundle 后复验。
2. `internalCooldownMs` 已跨 Wasm/Web/Backend 接上最小校验和 evidence，但它不是 Batch T 计划的主标题能力；合并前应确认是否接受把该字段作为 Batch T 的附带 primitive，或拆出后续批次。
3. 当前三个 worktree 都是 `ahead 6` 且有未提交修改；交付前需要决定是否分 worktree 分别提交，避免把 Batch T 与其它本地历史混在一个不可审查提交里。
