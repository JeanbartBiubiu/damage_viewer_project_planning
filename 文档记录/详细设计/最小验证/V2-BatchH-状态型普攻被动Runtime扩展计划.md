TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-05-22

# V2 Batch H 状态型普攻被动 Runtime 扩展计划

关联总方案：[V2-单攻击方DPS协议与开发计划.md](./V2-单攻击方DPS协议与开发计划.md)

前置审计：[V2-BatchG-ADC被动覆盖审计与录入计划.md](./V2-BatchG-ADC被动覆盖审计与录入计划.md)

前置清单：[V2-BatchG-ADC被动覆盖清单.md](./V2-BatchG-ADC被动覆盖清单.md)

前置回归：[V2-BatchF-Canonical回归硬化计划.md](./V2-BatchF-Canonical回归硬化计划.md)

## 1. 本文档边界

本文档是后续 goal 会话的执行计划和提示词，不是本会话的开发记录。

当前会话只允许维护本计划和任务治理映射；不得在本会话新增 Batch H seed、测试记录、runtime 代码、backend 代码、web 页面或发布验证。

后续开发会话必须按跨 worktree goal 执行：

| Worktree | 职责 |
| --- | --- |
| `C:\project\damage_wasm_dev` | Wasm runtime、canonical tests、TinyGo wasm build、Batch H seed 源文件、本文档和测试记录 |
| `C:\project\damage_backend_dev` | seed dry-run/import/publish、current bundle/API 验证 |
| `C:\project\damage_web_dev` | 同步 wasm 产物、Batch H 专门验证页、Playwright 页面证据、web build |

开工第一步必须在三个 worktree 分别执行 `git status --short -uall`，确认脏改来源和写入边界。不得把别的会话或用户改动当成可回滚内容。

## 2. 目标

Batch H 只处理 Batch G backlog 中的 `stacking_stat_modifier_on_hit`。

目标机制是：“触发命中后增加 stack；stack 存续期间，按当前 stack 数修改攻击方属性；stack 过期后不再贡献属性。”

Batch H 交付分成两个 gate：

| Gate | 含义 | 可单独通过 |
| --- | --- | --- |
| `H-runtime-pass` | runtime 支持、synthetic canonical tests、回归、TinyGo wasm build、Node smoke 通过 | 是 |
| `H-real-data-pass` | 至少一个真实 attacker-side stacking stat 被动完成数据、seed、导入发布、专门页面 A/B 验证 | 否，必须建立在 `H-runtime-pass` 上 |
| `H-real-data-blocked` | runtime 已可用，但真实数值、发布或页面证据不足 | 可作为阶段性结论，但不能宣称 Batch H 全完成 |

只有 `H-runtime-pass` 和 `H-real-data-pass` 都成立，Batch H 才能标为整体完成。

## 3. 非目标

1. 不实现 `phantom_hit_on_hit_repeat`；鬼索的 phantom-hit 复制攻击特效留到后续独立批次。
2. 不实现 `spellblade_next_attack_state`。
3. 不实现 `energized_charge_and_consume`。
4. 不实现 `seeded_random_crit_sequence`。
5. 不新增主动技能轮转、移动充能、真实随机暴击序列或完整技能命中调度。
6. 不新增 DTO 字段；若现有 `DPSPassiveOperationV2` 字段不足，必须停止并回到计划修订。
7. 不实现 target-side stacking stat modifier。黑色切割者这类按层削目标护甲的机制需要 target-side modifier 字段或等价协议，留给后续批次。
8. 不在前端写机制计算逻辑；前端只负责选择、运行 wasm、展示和导出证据。

## 4. Runtime 契约

Batch H 复用现有 `DPSPassiveEffectV2` / `DPSPassiveOperationV2` 字段表达，不新增 DTO：

```json
{
  "triggerKind": "stack_on_hit",
  "operations": [
    {
      "kind": "add_stack",
      "stackKey": "example_stack",
      "maxStacks": 5,
      "durationMs": 6000,
      "refreshMode": "refresh"
    },
    {
      "kind": "stat_modifier",
      "stackKey": "example_stack",
      "attrKey": "attack_speed",
      "modifierMode": "percent",
      "value": 0.1,
      "perStack": true
    }
  ]
}
```

必须满足的语义：

1. `add_stack` 与 `stat_modifier.perStack=true` 必须在同一个 `DPSPassiveEffectV2.operations[]` 内通过相同 `stackKey` 关联。
2. 不允许跨 passive 共享 stack；runtime 内部状态 key 必须按 `passiveId/effectId + stackKey` 隔离。seed 侧也应使用唯一、可读的 `stackKey`，例如 `ezreal_rising_spell_force`。
3. `add_stack.maxStacks` 必须大于 0。
4. `add_stack.refreshMode` 只支持空值或 `refresh`；`extend`、`ignore`、`replace` 等模式必须 blocked。
5. `stat_modifier.perStack=true` 时必须提供 `stackKey`，且同 passive 内必须存在匹配 `add_stack`。
6. 命中后先结算本次命中，再增加 stack；新 stack 只影响下一次普攻节奏和后续属性，不回改本次普攻。
7. stack 到期只在下一次 DPS 事件处理前懒清理；本批不新增独立到期事件，也不重排已经排定的下一次普攻。
8. 属性重算必须从基础属性重新投影：基础属性 + 装备/常驻 modifier + 预开启 scenario modifier + 当前未过期 stack modifier。不得在当前 snapshot 上增量叠加或扣减。
9. 当前批只支持修改攻击方属性，例如 `attack_speed`。如果真实对象需要修改目标护甲、魔抗或承伤倍率，应保持 blocked。
10. `effectBreakdown` 必须能看到 `add_stack` 和 `stat_modifier` 两类证据，至少包含 stack key、层数变化、应用层数、`attrKey`、`modifierMode`、每层 value 和应用后属性值。

## 5. 真实数据策略

真实数据不能由开发会话私造。

Batch H 首选真实对象是 `hero_ezreal` P “咒能高涨”，因为它是 attacker-side 攻速叠层机制。但当前本地 `数据参考/champion/Ezreal.json` 只给出“技能命中后提升攻击速度，最多 5 层”的描述，没有可审计的每层攻速值和持续时间。

因此真实数据 gate 如下：

1. 如果用户提供 Ezreal P tooltip、训练营截图或项目认可的数据源，且能确认每层攻速、最大层数、duration、刷新规则，则可录入 Ezreal P。
2. 如果 Ezreal P 数据不足，可以改用另一个已有可审计数值的 attacker-side stacking stat 对象，例如 `hero_ashe` Q 或 `hero_graves` E，前提是它不需要主动技能轮转、phantom-hit、target-side modifier、seeded random、energized 或 spellblade。
3. 如果没有任何真实对象满足数据 gate，只能交付 `H-runtime-pass`，并把 `H-real-data-pass` 标为 `H-real-data-blocked`。
4. 不得从网络、wiki、记忆或猜测中默默补数值。若使用外部版本资料，必须标明来源和版本，并经用户确认后再写入 seed。
5. Ezreal P 如果临时用“普攻命中触发叠层”来验证 runtime，只能标为 Batch H runtime 验证口径，不得宣称完整还原真实“技能命中触发”。
6. 如果某个真实对象的同一被动条目同时需要 Batch H 之外的机制，例如 `3124` 鬼索“沸腾打击”同时需要 `stacking_stat_modifier_on_hit` 和 `phantom_hit_on_hit_repeat`，则只能把其中可编码部分作为 published sub-mechanism/runtime 页面证据；不得据此判定 `H-real-data-pass`。

真实 seed 建议路径：

```text
C:\project\damage_wasm_dev\最小验证\V2-Batch-H-stacking-stat-passives.seed.json
```

建议发布版本：

```text
v2_batch_h_stacking_stat_passives_001
```

## 6. 写入范围

### Wasm Worktree

默认写入：

1. `wasm/tinygo_engine_v2/internal/runtime/dps_driver.go`
2. `wasm/tinygo_engine_v2/internal/runtime/dps_driver_test.go`
3. `wasm/tinygo_engine_v2/dist/tinygo_engine_v2.wasm`
4. `最小验证/V2-Batch-H-stacking-stat-passives.seed.json`，仅在真实数据 gate 满足后创建；若只记录真实对象的可编码子机制，必须在 seed 和测试记录中标明它不能替代 `H-real-data-pass`
5. `文档记录/测试记录/wasm/V2-BatchH-状态型普攻被动Runtime扩展-测试记录-2026-05-xx.md`
6. `文档记录/详细设计/最小验证/V2-BatchH-状态型普攻被动Runtime扩展计划.md`
7. `db/task_doc_governance/task_rules.json`

### Backend Worktree

默认不改业务代码。只有当 seed schema 或导入发布链无法支持现有字段时，才允许按最小范围修改并补测试。

必须执行 dry-run/import/publish/API 验证，证明 published current bundle 包含 Batch H seed。

如果发布版本码长度超过既有 DB 的 `varchar(32)`，必须同时提供可重复执行的显式迁移 SQL；只修改 `CREATE TABLE` DDL 不足以覆盖已创建数据库。

### Web Worktree

默认写入：

1. 同步 `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\dist\tinygo_engine_v2.wasm` 到 `C:\project\damage_web_dev\web\src\engine\wasm\tinygo_engine_v2.wasm`
2. 新增或接入 Batch H 专门验证页，建议路由：`#/wasm-validation-v2-dps-stacking-passive`
3. 必要的路由、页面入口、Playwright smoke 和导出证据文件

页面可以做 UI、选择、证据整理和 JSON 导出；不得在 TypeScript 中手算 stack、攻速、伤害或层数。

## 7. 专门验证页要求

Batch H 专门页是 `H-real-data-pass` 的必需交付，不是可选增强。

页面至少支持两个模式：

| 模式 | 用途 | 是否能替代真实验收 |
| --- | --- | --- |
| synthetic/preset case | 验证 runtime stack 生效、封顶、过期、非法契约 blocked | 否 |
| published real case | 从 backend current bundle 读取真实 seed 对象并运行 wasm | 是 |

synthetic/preset case 必须能在 published real case 不满足 readiness 时独立运行；published real case 缺失只能影响真实数据 gate，不得阻塞 runtime 页面证据。

页面证据必须能导出：

1. `selection.enabledPassiveEffects`
2. `resolvedSnapshot.passiveEffects`
3. `attackIntervalTimeline`
4. `effectBreakdown`
5. `skillPassiveTriggers` 或对应 passive trigger 证据
6. stack 层数增长、封顶、过期清理的可读摘要
7. raw attack speed、attack interval、攻击次数、总伤害或 kill time 的 A/B 差异

页面 A/B 最少要证明：

1. 关闭 passive 与开启 passive 的曲线不同。
2. `resolvedSnapshot.passiveEffects` 中出现 Batch H passive。
3. stack 层数随命中增长并受 `maxStacks` 限制。
4. `rawAttackSpeed` 或攻击间隔随层数变化。
5. 到期场景能显示懒清理后层数不继续累加。
6. 非法契约场景能显示 runtime blocked reason，例如 `perStack stat_modifier requires matching add_stack`。

## 8. Canonical Tests

Wasm 至少新增或更新以下测试：

1. `TestSingleAttackerDPSStackingStatModifierOnHitAffectsCadenceAndCaps`
   - 命中后加层只影响下一次普攻。
   - `attackIntervalTimeline.rawAttackSpeed` 随 stack 增长。
   - 达到 `maxStacks` 后不继续增长。
   - `effectBreakdown` 同时记录 `add_stack` 和 `stat_modifier`。
2. `TestSingleAttackerDPSStackingStatModifierExpiresBeforeNextHit`
   - stack 在下一次 DPS 事件前懒清理。
   - 过期后后续命中只重新获得 1 层 modifier。
   - 不新增独立到期事件，不重排已排定攻击。
3. `TestSingleAttackerDPSBlocksInvalidStackingStatModifierContracts`
   - `perStack=true` 缺 `stackKey` 时 blocked。
   - `stat_modifier.stackKey` 缺同 passive 匹配 `add_stack` 时 blocked。
   - `add_stack.refreshMode=extend` 等 unsupported 模式时 blocked。
   - 跨 passive 同名 `stackKey` 不互相污染。

如果真实数据 gate 已满足，可以额外补一个真实 fixture 测试，但不能用它替代 synthetic 边界测试。

## 9. 执行顺序

### H0 Preflight

1. 在三个 worktree 跑 `git status --short -uall`。
2. 读取最近层 `AGENTS.md` / `README.md`。
3. 确认 Batch G 清单中 `stacking_stat_modifier_on_hit` 仍为需要扩展的 backlog。
4. 确认真实数据来源是否已满足。如果未满足，先记录 `H-real-data-blocked` 前置状态。

### H1 Runtime

1. 在 wasm worktree 实现 `add_stack + perStack stat_modifier` runtime 语义。
2. 保持 Batch A-G 现有 DPS、DoT、every-N、常驻属性 modifier 和 blocked 语义不退化。
3. 补 canonical tests。
4. 通过 wasm 测试、bench、TinyGo wasm build 和 Node smoke。

### H2 Real Data Gate

1. 确认可用真实对象。
2. 若数据不足，向用户要 tooltip、训练营截图或项目认可数据源。
3. 数据满足后创建 `最小验证/V2-Batch-H-stacking-stat-passives.seed.json`。
4. 不满足时不得创建伪真实 seed；如果创建的是可编码子机制 fixture，必须记录 `H-real-data-blocked`，并说明该 fixture 不能替代真实数据验收。

### H3 Backend Publish

1. backend worktree dry-run 导入 Batch H seed。
2. 实际导入并发布 `v2_batch_h_stacking_stat_passives_001`。
3. API 验证 current bundle 中存在真实 Batch H passive、owner、operations 和 item/hero refs。
4. 如需扩展 `version_code` 列宽，运行或至少提交 `db/game_manage/migrations/compatibility/version_code_varchar64_compatibility_migration.sql` 这类显式迁移，并复核 live DB 列宽。

### H4 Web Page

1. 同步 TinyGo wasm 到 web worktree。
2. 新增 `#/wasm-validation-v2-dps-stacking-passive` 或等价专门验证页。
3. 页面同时支持 synthetic/preset 和 published real case。
4. synthetic/preset 覆盖 stack 生效、封顶、过期和非法契约 blocked，并且不依赖 published real readiness。
5. 如果 published current/bundle 读取失败，Batch H 页面仍必须能用 adapter 提供的最小 synthetic bundle 运行 synthetic/preset；该 fallback 不得伪装成 published real case。
6. Playwright 或人工页面 smoke 导出 JSON 证据。
7. `npm run build` 通过。

### H5 Docs And Governance

1. 写 Batch H 测试记录，分别记录 `H-runtime-pass`、`H-real-data-pass` 或 `H-real-data-blocked`。
2. 更新 `task_rules.json`，纳入计划与测试记录。
3. 运行 governance rebuild，要求 `unassigned_docs: 0`。
4. 三个 worktree 分别运行 `git diff --check`。

## 10. 验证命令

Wasm：

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

Backend：

```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn -q -DskipTests test-compile org.codehaus.mojo:exec-maven-plugin:3.5.0:java "-Dexec.classpathScope=test" "-Dexec.mainClass=xyz.game.datamanage.tools.KatarinaMvpImportMain" "-Dexec.args=--dryRun --seedFile=C:\project\damage_wasm_dev\最小验证\V2-Batch-H-stacking-stat-passives.seed.json --versionCode=v2_batch_h_stacking_stat_passives_001"
mvn -q -DskipTests test-compile org.codehaus.mojo:exec-maven-plugin:3.5.0:java "-Dexec.classpathScope=test" "-Dexec.mainClass=xyz.game.datamanage.tools.KatarinaMvpImportMain" "-Dexec.args=--seedFile=C:\project\damage_wasm_dev\最小验证\V2-Batch-H-stacking-stat-passives.seed.json --versionCode=v2_batch_h_stacking_stat_passives_001"
```

Web：

```powershell
cd C:\project\damage_web_dev\web
npm run build
```

Docs：

```powershell
cd C:\project\damage_wasm_dev
node tools/task-governance/cli.mjs rebuild
git diff --check

cd C:\project\damage_backend_dev
git diff --check

cd C:\project\damage_web_dev
git diff --check
```

## 11. 通过标准

`H-runtime-pass`：

1. Batch H canonical tests 通过。
2. Batch F canonical tests 仍通过。
3. `go test ./...` 和 `go run ./cmd/bench` 通过。
4. TinyGo wasm rebuild 和 Node smoke 通过。
5. `git diff --check` 在 wasm worktree 通过。

`H-real-data-pass`：

1. 至少一个真实 attacker-side stacking stat 对象有完整数值来源。
2. Batch H seed 创建、dry-run、导入和发布通过。
3. current bundle/API 验证通过。
4. Batch H 专门页面能从 published bundle 读取该对象。
5. 页面 A/B 和导出 JSON 证明 stack、modifier、attack cadence 和曲线结果变化。
6. web wasm 已同步，`npm run build` 通过。
7. 测试记录和治理映射完成，`unassigned_docs: 0`。

`H-real-data-blocked`：

1. 明确写出缺少哪些真实数值或截图。
2. 不创建伪真实 seed；可编码子机制 fixture 必须明确标注为不满足真实数据 gate。
3. 不把 synthetic/preset 页面证据或真实对象子机制证据写成真实数据验收通过。

## 12. 后续独立批次

Batch H 完成后，以下机制仍保持独立 backlog：

1. `target_side_stacking_stat_modifier`，用于黑色切割者等目标护甲/魔抗削减。
2. `phantom_hit_on_hit_repeat`，用于鬼索复制 on-hit。
3. `spellblade_next_attack_state`。
4. `energized_charge_and_consume`。
5. `seeded_random_crit_sequence`。
