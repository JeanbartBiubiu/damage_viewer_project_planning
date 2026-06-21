TASK_KEY: planning-validation-milestones
DOC_TYPE: 测试记录
WORKSTREAM: planning
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-06-06

# V2 Batch N 单攻击方 DPS 普攻充能阈值触发测试记录 2026-06-06

关联计划：[V2-BatchN-单攻击方DPS普攻充能阈值触发计划.md](../../详细设计/最小验证/V2-BatchN-单攻击方DPS普攻充能阈值触发计划.md)

结论：
1. `N-contract-pass`：`energized_charge_and_consume` 公开契约固定为真实普攻加 charge、达到阈值后下一次真实普攻触发、触发时必须 `consumeChargeOnTrigger=true`。
2. `N-runtime-pass`：Wasm `single_attacker_dps` 已支持自然充能、初始满充假定、触发消费、消费后下一轮重新充能、phantom-hit 不参与，并通过 targeted/all Go tests、bench、TinyGo build、Node smoke。
3. `N-web-pass`：Web 只从 published bundle 投影 energized passive，并只基于 Wasm 输出的 `effectBreakdown`、`damageTimeline`、`itemPassiveTriggers` 做断言展示；默认 Batch N 曲线只在 6699 published contract ready 时出现。
4. `N-real-data-pass`：后端 seed dry-run/import/publish 通过，current version 切到 `v2_batch_n_energized_charge_001`，bundle 保留 6699 skillRef、charge 字段和 100 physical damage operation。
5. `N-live-pass`：V2 DPS 页面跑通 Batch N 两条真实装备曲线并导出 JSON；Batch H/K stacking + phantom-hit 回归页面通过。

## 1. 改动范围

Wasm：
1. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go`
2. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver.go`
3. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go`

Backend：
1. `C:\project\damage_backend_dev\最小验证\V2-Batch-N-energized-charge-and-consume.seed.json`
2. `C:\project\damage_backend_dev\最小验证\V2-Batch-N-energized-charge-and-consume-audit.json`
3. `C:\project\damage_backend_dev\server\data_manage\src\test\java\xyz\game\datamanage\tools\KatarinaMvpImportMainTest.java`

Web：
1. `C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.ts`
2. `C:\project\damage_web_dev\web\src\pages\WasmValidationV2DpsPage.tsx`
3. `C:\project\damage_web_dev\web\src\engine\wasm\tinygo_engine_v2.wasm`

Planning：
1. 本测试记录。
2. `C:\project\damage_viewer_project_planning\db\task_doc_governance\task_rules.json`

## 2. 命令级验证矩阵

| Worktree | 命令 | 结果 |
| --- | --- | --- |
| Wasm | `go test ./internal/runtime -run "Energized\|Charge\|SingleAttackerDPS\|Canonical\|Phantom" -count=1` | 通过，`ok tinygo_engine_v2/internal/runtime 0.430s` |
| Wasm | `go test ./...` | 通过 |
| Wasm | `go run ./cmd/bench` | 通过，`samples=100 avg_us=187.11 max_us=1096.00` |
| Wasm | `powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1` | 通过，`dist/tinygo_engine_v2.wasm` 489162 bytes |
| Wasm | `node .\scripts\smoke-node.mjs` | 通过，导出包含 `engine_init`、`engine_begin_run`、`engine_step`、`engine_snapshot_initial` 等 ABI |
| Backend | `mvn test` | 通过，`Tests run: 60, Failures: 0, Errors: 0, Skipped: 0` |
| Backend | Batch N seed dry-run | 通过，`ownerTypes=1`、`skills=1`、`items=1`，无 HTTP/DB 写入 |
| Backend | Batch N import/publish | 通过，`Published versionCode=v2_batch_n_energized_charge_001`，并验证 current + bundle |
| Web | `npm run build` | 通过；同步最终 wasm 后再次通过，Vite wasm asset `489.16 kB` |
| Planning | `node tools/task-governance/cli.mjs rebuild` | 通过 |
| Planning | `node tools/task-governance/cli.mjs docs planning-validation-milestones` | 通过 |

最终 Wasm SHA256：
```text
1f82de057dddeb13335ef538cc3f3844987ae168c430fb958ca5852f3edcfe64
```

## 3. Runtime 关键断言

新增/覆盖关键测试：
1. 自然普攻充能。
2. 当前 hit 达到 threshold 不同 hit 触发。
3. ready 后下一次真实普攻消费并触发。
4. 消费后同一 hit 可以为下一轮重新增加 charge。
5. `scenarioStates.activation=assumed_charge_before_start` 作为初始满充输入。
6. phantom-hit 不增加 charge。
7. phantom-hit 不触发、不复制 energized proc。
8. 无效 charge 配置 blocked。
9. `consumeChargeOnTrigger=false` 或省略时 blocked。
10. `effectBreakdown` 记录 `energized_charge_check`、`energized_charge_consume`、`energized_charge_gain`。

关键修正：
1. `energized_charge_and_consume` 现在要求 `consumeChargeOnTrigger=true`，避免满充后每次普攻重复触发且缺少 consume 证据。
2. 运行时保留防御性阻断，即使绕过预校验也不会执行不消费 charge 的 energized passive。

## 4. Backend Seed 与 Live Bundle

Live API：

| 项 | 值 |
| --- | --- |
| API | `http://localhost:8080` |
| DB target | `192.168.5.5:5432/test0221`，user `postgres`，凭据未记录 |
| gameId | `lol` |
| previous current | `v2_batch_m_attr_read_trinity_base_ad_001` |
| current version | `v2_batch_n_energized_charge_001` |

Bundle 字段复核：

| 项 | 值 |
| --- | --- |
| item | `6699` |
| item selectable | true，bundle 中存在 `typeId=62002,targetCategory=equipment,targetId=6699` |
| skillRef | `item_6699_voltaic_cyclosword_energized_dps_v2` |
| scenario state | `item_6699_energized / assumed_charge_before_start / stacks=100` |
| triggerKind | `energized_charge_and_consume` |
| chargeKey | `item_6699_energized` |
| chargeGainPerBasicAttack | `25` |
| chargeThreshold | `100` |
| chargeCap | `100` |
| chargeReadyPolicy | `next_basic_attack_after_threshold_reached` |
| consumeChargeOnTrigger | true |
| procScope | `real_basic_attack_only` |
| damage operation | `source=voltaic_cyclosword_energized, damageType=physical, amount=100` |

## 5. Web 与 Playwright 用户流

验证工具：临时 Playwright 1.60.0 运行环境，未写入仓库。

### V2 DPS Batch N 页面

流程：
1. 打开 `http://127.0.0.1:5173/#/wasm-validation-v2-dps`。
2. 页面自动选中 `lol`，加载 current `v2_batch_n_energized_charge_001`。
3. 页面出现 6 条默认曲线，其中包含：
   - `Batch N / 6699 Voltaic natural charge`
   - `Batch N / 6699 Voltaic initial full charge`
4. 点击 `运行`。
5. Batch N Assertions 全部 pass。
6. 拦截 `navigator.clipboard.writeText`，点击 `导出 JSON`，解析导出 payload。

页面断言：

| 断言 | 结果 | 证据 |
| --- | --- | --- |
| Natural Status | pass | `status=ok, attacks=9` |
| Charge Breakdown | pass | `check=9, gain=9, consume=2` |
| Gain Ready | pass | `gainReady=2` |
| Natural Proc | pass | `procHits=2, firstAt=4712ms` |
| Full Charge t=0 | pass | `t0Hits=1` |
| Item Passive Triggers | pass | `curves=2, triggers=2+3` |

导出 JSON 关键证据：

| 曲线 | status | procTimes | trigger count | charge evidence |
| --- | --- | --- | --- | --- |
| `vayne-batch-n-voltaic-6699` | ok | `4712, 9424` | 2 | `check=9,gain=9,consume=2` |
| `vayne-batch-n-voltaic-6699-full-charge` | ok | `0, 4712, 9424` | 3 | `check=9,gain=9,consume=3` |

自然充能到阈值但当前 hit 不触发的证据：
```text
chargeKey=item_6699_energized preCharge=75 postCharge=100 chargeGain=25 chargeThreshold=100 readyBeforeHit=false readyAfterHit=true consumed=false triggered=false
```

下一次真实普攻触发并消费的证据：
```text
chargeKey=item_6699_energized preCharge=100 postCharge=0 chargeGain=0 chargeThreshold=100 readyBeforeHit=true readyAfterHit=false consumed=true triggered=true
```

初始满充假定证据：
```text
item_6699_energized:assumed_charge_before_start:100
```

### Batch H/K 回归页面

流程：
1. 打开 `http://127.0.0.1:5173/#/wasm-validation-v2-dps-stacking-passive`。
2. 页面加载 current `v2_batch_n_energized_charge_001`。
3. 点击 `运行`。
4. 点击 `导出 JSON` 并解析 payload。

页面断言：

| 断言 | 结果 |
| --- | --- |
| Stack Applies | pass |
| Cap | pass |
| Expiry | pass |
| Invalid Contract | pass |
| Phantom Hit (3124) | pass |

3124 曲线导出证据：

| 项 | 值 |
| --- | --- |
| curveId | `vayne-batch-h-guinsoo-3124` |
| status | `ok` |
| attackCount | `15` |
| itemPassiveTriggers | `27` |
| phantom evidence | `repeatTag=phantom_hit magic` |

## 6. 收口状态

| Gate | 状态 | 依据 |
| --- | --- | --- |
| `N-contract-pass` | 通过 | plan/seed/runtime validation 均固定 charge、ready、consume、procScope 字段 |
| `N-runtime-pass` | 通过 | targeted Go tests、all Go tests、bench、TinyGo build、Node smoke |
| `N-web-pass` | 通过 | Web build、Batch N 页面断言、导出 JSON 证据 |
| `N-real-data-pass` | 通过 | seed dry-run/import/publish、current/bundle 字段复核 |
| `N-live-pass` | 通过 | V2 DPS 页面 Batch N 完整用户流和 Batch H/K 回归均通过 |

## 7. 残余风险

1. 当前盈能语义仍是简化版：不模拟移动、距离、可见性、减速、连锁弹射或主动技能 rotation。
2. 多个 energized passive 的共享充能池或唯一冲突规则尚未定义；本批按独立 `chargeKey` 处理。
3. `effectBreakdown` 的 charge 证据仍主要在 `message` 字符串内，后续如果要优化 hover 明细，可再做结构化字段扩展。
