TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-06-03

# V2 Batch K 单攻击方 DPS 收口与鬼索幻影命中计划

关联概要：[验证里程碑V2.md](../../概要设计/验证里程碑V2.md)

关联总方案：[V2-单攻击方DPS协议与开发计划.md](./V2-单攻击方DPS协议与开发计划.md)

前置回归：[V2-BatchF-Canonical回归硬化计划.md](./V2-BatchF-Canonical回归硬化计划.md)

前置审计：[V2-BatchG-ADC被动覆盖审计与录入计划.md](./V2-BatchG-ADC被动覆盖审计与录入计划.md)

前置清单：[V2-BatchG-ADC被动覆盖清单.md](./V2-BatchG-ADC被动覆盖清单.md)

前置机制：[V2-BatchH-状态型普攻被动Runtime扩展计划.md](./V2-BatchH-状态型普攻被动Runtime扩展计划.md)

前置底座：[V2-BatchJ-状态资源迁移与1v1伤害闭环计划.md](./V2-BatchJ-状态资源迁移与1v1伤害闭环计划.md)

## 1. 本文档边界

本文档是后续跨 worktree 开发会话的执行真源，不是测试记录。当前会话只维护本文和任务治理映射；不得在本文档编写会话里新增 runtime、backend、web 或 seed 代码。

Batch K 继续服务“单攻击方站桩平 A DPS 展示”主线，不把 Batch J 的 1v1 伤害底座扩成完整 1v1 模拟器。

本批分成两个连续目标：

1. 先把 V2-M6 页面展示与导出证据收稳，并确认 Batch F canonical 回归仍可作为后续机制扩展护栏。
2. 再实现 `phantom_hit_on_hit_repeat`，用于鬼索的狂暴之刃满层后复制 on-hit 攻击特效。

如果第一目标失败，必须先修页面/导出/回归，不得继续实现 phantom-hit。

## 2. 当前事实

1. V2 主线目标是固定攻击方、固定 target dummy、固定时间窗的单攻击方 DPS 展示，不做敌方主动动作、AI、完整技能轮转或自由战斗编辑器。
2. Batch J 已打通状态资源迁移和 1v1 伤害底座，但它对 V2 DPS 页的验收重点只是普攻 expected crit 不回退，不能替代 V2-M6 页面和导出收口。
3. Batch G 清单中 `phantom_hit_on_hit_repeat` 仍是 `needs_runtime_extension` backlog，代表对象是 `3124` 鬼索的狂暴之刃 “沸腾打击”。
4. Batch H 已实现 `stacking_stat_modifier_on_hit`，但鬼索同一真实被动还需要 `phantom_hit_on_hit_repeat`，所以 Batch H 的真实数据 gate 只能标记为阶段性 blocked。
5. 当前 `DPSPassiveOperationV2` 已支持 `damage`、`apply_dot`、`add_stack`、`trigger_damage_at_stacks`、`stat_modifier` 等操作字段；没有可直接表达 phantom-hit 复制的字段。
6. 当前 `single_attacker_dps` 仍只接受 `simulationRules.critPolicy=expected`、`attackSpeedCap=3.0`、`target_dummy` 目标和 0ms 首刀。本批不得放宽这些全局规则。

## 3. 目标

### 3.1 K0：页面和回归收口

K0 目标是把后续机制扩展前的证据门槛固定下来：

1. `#/wasm-validation-v2-dps` 页面展示和导出 JSON 对齐。
2. `#/wasm-validation-v2-dps-multi-hero` 页面展示和导出 JSON 对齐。
3. 导出 JSON 能稳定复核 `selection`、`resolvedSnapshot`、`simulationRules`、`curveResults`、`attackIntervalTimeline`、`damageTimeline`、`targetHpTimeline`、`effectBreakdown`、`itemPassiveTriggers`。
4. Batch F canonical 回归 tests 通过，至少覆盖同刻事件顺序、攻速 cap、DoT 到期、来源顺序、blocked、crit policy 边界。
5. 若页面表格缺少 effect 级 crit 或 passive 证据字段，补导出和展示证据；不得在页面层手算伤害或被动。

### 3.2 K1：phantom-hit runtime 扩展

K1 目标是实现 `phantom_hit_on_hit_repeat`：

1. 当一个 passive 满足指定 stack 条件后，在同一次普攻命中流程里额外复制一次可复制 on-hit 效果。
2. 被复制的效果只包括明确标记为可复制的 on-hit passive operation。
3. phantom-hit 不能递归触发自身，不能再次触发 phantom-hit，也不能增加普攻次数。
4. phantom-hit 的复制伤害和原始 on-hit 伤害都必须进入 `damageTimeline`、`damageBySource`、`itemPassiveTriggers` 和 `effectBreakdown`。
5. 复制效果必须保留 `procSourceCategory/sourceId/sourceType/triggerId`，并额外标明 `phantomHit=true` 或等价证据字段。

### 3.3 K2：真实鬼索 published 证据

K2 目标是让 `3124` 鬼索 published seed 同时包含：

1. Batch D 已有的 on-hit 额外魔法伤害子机制。
2. Batch H 已有的沸腾打击叠攻速子机制。
3. Batch K 新增的满层 phantom-hit 复制 on-hit 子机制。

只有 runtime tests、seed dry-run/import/publish、V2 DPS 页面 published bundle 验证全部通过，才能声明 `K-real-data-pass`。

## 4. 非目标

1. 不实现完整 1v1、敌方动作、敌方 AI 或主动技能轮转。
2. 不实现 `spellblade_next_attack_state`、`energized_charge_and_consume`、`seeded_random_crit_sequence`、距离增伤或 target-side stacking stat modifier。
3. 不扩展 V2 DPS 全局规则，例如 `seeded_random` 暴击、非 3.0 攻速 cap、非 0ms 首刀或非 target dummy。
4. 不在 TypeScript 页面或 adapter 中计算 phantom-hit 伤害、触发次数或层数。
5. 不把所有装备被动改成 phantom-hit 可复制；必须显式标记可复制对象。
6. 不用近似逻辑把不具备 published 数据的机制标成 ok。
7. 不在本批引入通用完整战斗调度或 action queue editor。

## 5. 契约建议

### 5.1 DTO 字段

优先在 `DPSPassiveOperationV2` 上新增最小字段：

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

字段语义：

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `kind` | 是 | 固定为 `phantom_hit_on_hit_repeat` |
| `source` | 是 | 证据来源，进入 `effectBreakdown` |
| `stackKey` | 是 | 读取同 passive 内的 stack；鬼索使用 `guinsoos_boiling_strike` |
| `triggerStacks` | 是 | 达到该层数后触发 phantom-hit；必须 `> 0` |
| `repeatCount` | 是 | 复制次数；本批只允许 `1` |
| `repeatTag` | 是 | 导出证据标签，建议 `phantom_hit` |
| `repeatScope` | 是 | 本批只允许 `copyable_on_hit` |

在可复制的 on-hit operation 上新增：

```json
{
  "kind": "damage",
  "source": "guinsoos_wrath_on_hit",
  "damageType": "magic",
  "amount": 30,
  "phantomHitCopyable": true
}
```

如果实现方认为字段名应更短，可以用 `copyableOnHit`，但必须在 web/wasm/backend 三端一致，且测试记录中写清最终字段名。不得用 `extend` 或字符串标签隐式表达。

### 5.2 运行时顺序

同一次普攻命中后的顺序固定为：

1. basic attack direct damage。
2. 普通 hero passive on-hit。
3. 普通 item passive on-hit。
4. stack 增减与 stat modifier 刷新。
5. 满足条件时执行 phantom-hit，复制当前 passive 中 `phantomHitCopyable=true` 的 on-hit operation。
6. HP 与击杀汇总。
7. 用最新属性排下一次普攻。

如果当前 runtime 已有 canonical 来源顺序不同，开发前必须先回到 Batch F 语义确认，不得由 Batch K 自行改写全局顺序。

### 5.3 防递归规则

1. phantom-hit 执行期间设置内部 guard，例如 `phantomDepth=1`。
2. `phantomDepth>0` 时禁止再次执行 `phantom_hit_on_hit_repeat`。
3. phantom-hit 不增加 `attackCount`，不追加 `attackTimeline`。
4. phantom-hit 可以追加 `damageTimeline` 和 `effectBreakdown`。
5. phantom-hit 复制不触发 `every_n_basic_attack_hit` 计数；如果未来要支持，必须单独开批。
6. phantom-hit 复制不刷新 `add_stack`，避免同一次攻击重复加层。

### 5.4 Blocked 规则

以下情况 curve 必须 `status=blocked`：

1. `phantom_hit_on_hit_repeat` 缺 `stackKey`。
2. `triggerStacks <= 0`。
3. `repeatCount != 1`。
4. `repeatScope` 不是 `copyable_on_hit`。
5. 同 passive 内找不到匹配 `add_stack.stackKey`。
6. 同 passive 内没有任何 `phantomHitCopyable=true` 的 on-hit operation。
7. `phantomHitCopyable=true` 标在 `apply_dot`、`stat_modifier`、`add_stack` 或其它非 damage operation 上。
8. published bundle 中鬼索缺少任一必要子机制时，真实 case blocked，但 synthetic runtime case 仍可运行。

## 6. 写入范围

### 6.1 Wasm Worktree

默认写入：

1. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go`
2. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver.go`
3. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go`
4. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\dist\tinygo_engine_v2.wasm`
5. `C:\project\damage_wasm_dev\文档记录\测试记录\wasm\V2-BatchK-单攻击方DPS收口与鬼索幻影命中-测试记录-2026-xx-xx.md`

只读参考：

1. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\AGENTS.md`
2. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\README.md`
3. `C:\project\damage_wasm_dev\文档记录\详细设计\最小验证\V2-BatchF-Canonical回归硬化计划.md`
4. `C:\project\damage_wasm_dev\文档记录\详细设计\最小验证\V2-BatchH-状态型普攻被动Runtime扩展计划.md`

### 6.2 Backend Worktree

默认写入：

1. `C:\project\damage_backend_dev\最小验证\V2-Batch-K-guinsoo-phantom-hit.seed.json`
2. `C:\project\damage_backend_dev\最小验证\V2-Batch-K-guinsoo-phantom-hit-audit.json`
3. `C:\project\damage_backend_dev\最小验证\数据\build-v2-batch-k-guinsoo-phantom-hit-audit.mjs`

只有 seed schema、import 或 publish validation 无法透传新增字段时，才允许最小化修改：

1. `C:\project\damage_backend_dev\server\data_manage\src\test\java\xyz\game\datamanage\tools\KatarinaMvpImportMain.java`
2. `C:\project\damage_backend_dev\server\data_manage\src\test\java\xyz\game\datamanage\tools\KatarinaMvpImportMainTest.java`
3. publish flow 相关 DTO/校验文件。

### 6.3 Web Worktree

默认写入：

1. `C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.ts`
2. `C:\project\damage_web_dev\web\src\pages\WasmValidationV2DpsPage.tsx`
3. `C:\project\damage_web_dev\web\src\config\navigation.ts`
4. `C:\project\damage_web_dev\web\src\engine\wasm\tinygo_engine_v2.wasm`

如 Batch H 专门页仍是更合适入口，可复用现有 stacking passive 页面并改成 Batch K 证据模式；不得新增功能重复、证据分散的第四套 DPS 页面，除非 GPT/Codex review 明确接受。

### 6.4 Planning / Governance

默认写入：

1. `C:\project\damage_viewer_project_planning\文档记录\详细设计\最小验证\V2-BatchK-单攻击方DPS收口与鬼索幻影命中计划.md`
2. `C:\project\damage_viewer_project_planning\db\task_doc_governance\task_rules.json`

## 7. Canonical Tests

Wasm 至少新增以下测试：

1. `TestSingleAttackerDPSPhantomHitRepeatsCopyableOnHitDamage`
   - 构造一个 passive，包含 `add_stack`、copyable on-hit damage、phantom-hit repeat。
   - 让第 4 次命中达到 `triggerStacks=4`。
   - 断言同次命中输出原始 on-hit damage 和 phantom-hit damage。
   - 断言 `attackCount` 不因 phantom-hit 增加。
2. `TestSingleAttackerDPSPhantomHitDoesNotRecurse`
   - 构造会触发 phantom-hit 的 passive。
   - 断言同一次命中最多追加一次复制结果。
   - 断言不会复制 `phantom_hit_on_hit_repeat` operation 自身。
3. `TestSingleAttackerDPSPhantomHitDoesNotIncrementEveryNOrStacks`
   - 断言 phantom-hit 不增加 `every_n_basic_attack_hit` 计数。
   - 断言 phantom-hit 不重复执行 `add_stack`。
4. `TestSingleAttackerDPSBlocksInvalidPhantomHitContracts`
   - 覆盖缺 `stackKey`、`triggerStacks<=0`、`repeatCount!=1`、无 copyable on-hit operation、copyable 标到非 damage operation。
5. `TestSingleAttackerDPSGuinsooPhantomHitFixture`
   - 使用鬼索式 fixture：30 magic on-hit、4 层攻速、满层 phantom-hit。
   - 断言开启鬼索曲线的 `itemPassiveTriggers`、`effectBreakdown` 和总伤害均包含 phantom-hit 证据。

K0 还必须确保 Batch F tests 仍通过；如果 Batch F tests 尚未落地，则本批第一步就是补齐或重跑 Batch F，而不是直接写 phantom-hit。

## 8. Backend Seed 与 Published Bundle

建议版本：

```text
v2_batch_k_guinsoo_phantom_hit_001
```

seed 必须写清：

1. `source.auditJson` 指向 Batch G audit。
2. `source.priorSeeds` 指向 Batch D on-hit seed 和 Batch H stacking seed。
3. `source.rule` 写明本批只补 `phantom_hit_on_hit_repeat`，不新增主动技能轮转。
4. `item_3124_guinsoos_boiling_strike_dps_v2` 或等价 skill 同时包含三类 operation：on-hit damage、add_stack/stat_modifier、phantom-hit repeat。
5. 如果保留 Batch H 旧 seed 中的 `excludedMechanics=["phantom_hit_on_hit_repeat"]`，必须在 Batch K seed 或导入逻辑中移除或覆盖，不能让 current bundle 同时声明已支持和 excluded。

发布验证必须证明：

1. current bundle 中 `item 3124` 可选。
2. `3124` skillRefs 或等价 skill 归属能找到鬼索 passive skill。
3. `dpsPassiveEffects.operations[]` 中存在 `phantom_hit_on_hit_repeat`。
4. 至少一个 on-hit damage operation 标记为 `phantomHitCopyable=true` 或最终约定字段。
5. Batch D / H 既有操作未丢失。

## 9. Web 页面与导出

页面最少提供两个证据入口：

1. 默认 V2 DPS 页面中的鬼索曲线。
2. Batch H/Batch K 专门验证入口，展示 baseline、stacking only、stacking + phantom-hit 三组对比。

导出 JSON 必须能复核：

1. `selection.equipmentIds` 包含 `3124`。
2. `resolvedSnapshot.passiveEffects` 中出现鬼索 passive。
3. `resolvedSnapshot.passiveEffects[].operations[]` 中出现 `phantom_hit_on_hit_repeat` 和 copyable on-hit operation。
4. `curveResults[].itemPassiveTriggers` 中能区分原始 on-hit 与 phantom-hit。
5. `curveResults[].effectBreakdown` 中能看到 stack 层数、phantom-hit 触发时间、复制来源和复制次数。
6. `damageTimeline` 中同一 `timeMs` 可以出现原始 on-hit 和 phantom-hit 两条 damage 证据。
7. 页面展示值与导出 JSON 的 `totalDamage`、`timeWindowDps`、`killTimeMs` 一致。

页面不得自行补算 phantom-hit；如果 wasm output 缺证据，页面只能显示缺失或 blocked。

## 10. 执行顺序

严格按以下顺序执行：

1. GPT/Codex：在三个 worktree 分别检查 `git status --short -uall`，读取最近层 `AGENTS.md` / README。
2. GPT/Codex：确认 Batch J live current bundle 和 wasm asset 不再 stale。
3. Wasm：补齐或重跑 Batch F canonical tests，确认后续机制扩展护栏可用。
4. Web：完成 K0 页面展示与导出字段收口，至少跑 `npm run build`。
5. Wasm：实现 `DPSPassiveOperationV2` phantom-hit 字段和 runtime 语义，补 canonical tests。
6. Wasm：跑 `go test ./internal/runtime -run "Phantom|Canonical|SingleAttackerDPS" -count=1`、`go test ./...`、`go run ./cmd/bench`、TinyGo build、Node smoke。
7. Backend：生成 Batch K audit/seed，dry-run、import、publish，确认 current bundle 包含鬼索 phantom-hit。
8. Web：同步新 wasm，接入或更新页面证据，跑 `npm run build`。
9. GPT/Codex：集中启动 backend + web，跑页面 smoke、API current bundle 校验和导出 JSON 复核。
10. GPT/Codex：写测试记录，明确 `K0-pass`、`K-runtime-pass`、`K-real-data-pass` 或 blocked 状态。

任何一步失败，只修当前步，不允许跨步补救。例如 backend current bundle 没有 phantom-hit 时，web 不得从本地 synthetic 数据伪装 published real case；wasm 没有输出 phantom-hit evidence 时，web 不得自己补证据。

## 11. 验证命令

### Wasm

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./internal/runtime -run "Phantom|Canonical|SingleAttackerDPS" -count=1
go test ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
node .\scripts\smoke-node.mjs
```

如 TinyGo 不在 PATH，优先使用仓内 `.tools` 路径，按 `AGENTS.md` / README 指定方式传 `-TinyGo`、`WASMOPT` 和 `TINYGO_WASM_EXEC`。

### Backend

```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn test
mvn -q -DskipTests test-compile org.codehaus.mojo:exec-maven-plugin:3.5.0:java "-Dexec.classpathScope=test" "-Dexec.mainClass=xyz.game.datamanage.tools.KatarinaMvpImportMain" "-Dexec.args=--dryRun --seedFile=C:\project\damage_backend_dev\最小验证\V2-Batch-K-guinsoo-phantom-hit.seed.json --versionCode=v2_batch_k_guinsoo_phantom_hit_001 --gameId=lol"
```

dry-run 通过后再执行真实 import/publish。

### Web

```powershell
cd C:\project\damage_web_dev\web
npm run build
```

页面 smoke 至少覆盖：

1. `#/wasm-validation-v2-dps`
2. `#/wasm-validation-v2-dps-multi-hero`
3. Batch H/Batch K stacking/phantom 专门入口，如果保留该入口。

### Governance

```powershell
cd C:\project\damage_viewer_project_planning
node tools/task-governance/cli.mjs rebuild
node tools/task-governance/cli.mjs docs planning-validation-milestones
```

## 12. 停止条件

遇到以下情况必须停止并回报 GPT/Codex：

1. `DPSPassiveOperationV2` 新字段会破坏既有 Batch B/D/H/J 输入或输出。
2. phantom-hit 需要复制的不只是 on-hit damage，还需要复制 DoT、stat modifier、stack、主动技能或 every-N 计数。
3. 鬼索真实文本与当前 seed 数值冲突，且没有可审计版本来源。
4. Batch F canonical 回归暴露现有来源顺序不稳定。
5. Web 需要在页面层手算 phantom-hit 才能展示结果。
6. Backend seed/import/publish 无法透传新增字段，且修复范围超过 seed schema 或 publish DTO。
7. current bundle 或 wasm asset 出现 stale，导致页面证据无法判断真实行为。

## 13. 完成标准

本批只有同时满足以下条件，才能标记完成：

1. `K0-pass`：V2 DPS 页面展示与导出证据收口，Batch F canonical 回归通过或明确补齐。
2. `K-runtime-pass`：wasm 支持 `phantom_hit_on_hit_repeat`，canonical tests、全量 Go tests、bench、TinyGo build、Node smoke 全通过。
3. `K-real-data-pass`：鬼索 Batch K seed dry-run/import/publish 通过，current bundle 含 on-hit、stacking、phantom-hit 三类子机制。
4. Web build 通过，页面能从 published bundle 运行鬼索 phantom-hit case。
5. 导出 JSON 能复核 phantom-hit 复制来源、触发时刻、复制次数和伤害贡献。
6. Batch D 破败/海妖/鬼索 on-hit、Batch H stacking passive、Batch J expected crit 不回退。
7. GPT/Codex review 无阻塞 findings。

如果只完成 runtime synthetic tests，报告 `K-runtime-pass`，不得宣称真实鬼索闭环。如果只完成 seed 发布但页面无法证明 published real case，报告“发布通过，页面验收未完成”。

## 14. 回报格式

每个开发会话必须返回：

1. 改动文件列表。
2. 新增 DTO 字段和最终字段名。
3. 是否修改 seed/import/publish schema。
4. 新增 tests 及通过情况。
5. 执行过的验证命令和结果。
6. 页面 smoke 的路由、current version、wasm hash、导出 JSON 关键字段。
7. blocked / residual risk。
