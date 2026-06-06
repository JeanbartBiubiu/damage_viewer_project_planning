TASK_KEY: planning-validation-milestones
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-06-06

# V2 Batch N 单攻击方 DPS 普攻充能阈值触发计划

关联概要：[验证里程碑V2.md](../../概要设计/验证里程碑V2.md)

关联总方案：[V2-单攻击方DPS协议与开发计划.md](./V2-单攻击方DPS协议与开发计划.md)

前置审计：[V2-BatchG-ADC被动覆盖审计与录入计划.md](./V2-BatchG-ADC被动覆盖审计与录入计划.md)

前置清单：[V2-BatchG-ADC被动覆盖清单.md](./V2-BatchG-ADC被动覆盖清单.md)

前置机制：[V2-BatchL-单攻击方DPS咒刃下一次普攻状态计划.md](./V2-BatchL-单攻击方DPS咒刃下一次普攻状态计划.md)

前置机制：[V2-BatchM-Wasm属性读取语义与三相基础AD修正计划.md](./V2-BatchM-Wasm属性读取语义与三相基础AD修正计划.md)

## 1. 本文档边界

本文档是后续跨 worktree 开发会话的执行真源，不是测试记录。当前会话只维护本文、总方案索引和任务治理映射；不得在本文档编写会话里新增 runtime、backend、web、seed 或 DB 数据改动。

Batch N 继续服务 `single_attacker_dps` 主线，只扩展 Batch G backlog 里的 `energized_charge_and_consume` 机制。这里的“盈能”按用户确认后的简化语义处理：不模拟移动充能，只允许真实普攻增加充能；充能达到 100 后，下一次真实普攻消耗充能并触发额外攻击特效。

本批不追求完整 LoL 盈能系统。移动、距离、连锁弹射、减速、射程、可见性、主动技能和完整 rotation 都不进入本批自然触发证明。

## 2. 当前事实

1. Batch G 清单中 `energized_charge_and_consume` 仍属于高价值 runtime extension，样例包含电刀、疾射火炮、岚切、电震涡流剑等条目。
2. Batch L 已经固定“一次性下一次普攻状态”的消费语义，证明了 `single_attacker_dps` 可以在普攻命中后的 passive 阶段消费一个 ready state。
3. Batch M 已经固定 Wasm 属性读取语义，后续 damage operation 如需读 AD/AP/HP 等属性，必须通过 `attackerAttrRead=resolved|base|current|max` 这类视图表达，不能临时发明 `base_ad` 等兼容 key。
4. 当前 V2 DPS 主循环仍只有攻击方持续平 A fixed dummy；目标不行动，页面不做 DPS 业务结算。
5. `scenarioStates` 只能表达用户显式假定的开局状态。对于 Batch N，自然充能必须来自 runtime 中的真实普攻事件，不能由 Web 每次伪造 ready state 来替代。
6. 鬼索幻影命中已经进入回归护栏；Batch N 不能让 phantom-hit 复制、消耗或增加盈能充能，否则会引入递归和不真实的“额外普攻”语义。

## 3. 目标

Batch N 分成五个连续 gate：

| Gate | 目标 | 可单独通过 |
| --- | --- | --- |
| `N-contract-pass` | 固定普攻充能、阈值 ready、下一次普攻消费、输出证据和 Cursor prompt | 是 |
| `N-runtime-pass` | Wasm `single_attacker_dps` 支持 `energized_charge_and_consume`，synthetic tests、全量 Go tests、bench、TinyGo build、Node smoke 通过 | 是 |
| `N-web-pass` | Web adapter/page 能把 published bundle 的盈能 passive 投影进 Wasm 输入，并展示/导出 charge/proc 证据，不在页面手算 | 否，依赖 runtime |
| `N-real-data-pass` | 至少一个真实装备 seed dry-run/import/publish 通过，current bundle 能跑出盈能充能与触发证据 | 否，依赖 runtime/web |
| `N-live-pass` | V2 DPS 页面从最新 current bundle 和最新 wasm artifact 跑通完整用户流，导出 JSON 可复核 | 否，依赖前三项 |

如果 runtime 已闭环但真实装备公式、seed 或页面证据不足，只能报告 `N-runtime-pass` 和 `N-real-data-blocked`，不能宣称 Batch N 完成。

## 4. 非目标

1. 不模拟移动充能、距离充能、路径、可见性或位移。
2. 不实现主动技能 rotation、自动施法、action queue editor 或完整 1v1 战斗。
3. 不实现多目标连锁、弹射、范围伤害、减速、控制、射程改变或普攻距离收益。
4. 不实现 seeded random crit、on-crit 真实随机序列或 execute threshold。
5. 不让 phantom-hit 触发、消耗或增加盈能。
6. 不把 Web、backend seed 或 DB 当作 DPS 结果计算来源；充能、消费、额外伤害和证据必须由 Wasm 输出。
7. 不直接手改 live DB 作为交付；真实数据必须通过 seed dry-run/import/publish 路径发布。
8. 不把缺少数值来源、缺少 published 数据或缺少页面证据的装备伪装成 `ok`。

## 5. Contract 设计

### 5.1 Trigger 命名

新增 DPS triggerKind：

```json
{
  "triggerKind": "energized_charge_and_consume",
  "chargeKey": "item_6699_energized",
  "chargeGainPerBasicAttack": 25,
  "chargeThreshold": 100,
  "chargeCap": 100,
  "chargeReadyPolicy": "next_basic_attack_after_threshold_reached",
  "consumeChargeOnTrigger": true,
  "procScope": "real_basic_attack_only",
  "operations": [
    {
      "kind": "damage",
      "source": "voltaic_cyclosword_energized",
      "damageType": "physical",
      "amount": 100
    }
  ]
}
```

规则：

1. `triggerKind=energized_charge_and_consume` 是公开数据契约；runtime 内部可以复用 Batch L 的 next-attack consume helper，但不能要求 Web 为每次充能阈值手动制造 scenario state。
2. `chargeKey` 是 curve 内部充能状态键，必须在同一 curve 内唯一；不同装备或来源不得共享同一 key，除非后续单独定义共享盈能池。
3. `chargeGainPerBasicAttack` 只由真实 `basic_attack_hit` 增加；phantom-hit、DoT、on-hit extra damage、状态 tick 和主动技能不增加充能。
4. `chargeThreshold` 本批固定按 100 语义验收，但 runtime 字段保留数值配置，方便 synthetic test 覆盖 2/3/4 次攻击到阈值。
5. `chargeCap` 缺省等于 `chargeThreshold`；超过阈值时输出应保留 capped 后数值，不允许无限累加。
6. `chargeReadyPolicy=next_basic_attack_after_threshold_reached` 表示“当前攻击把充能从 90 推到 100 时，当前攻击不触发；下一次真实普攻才触发”。
7. `consumeChargeOnTrigger=true` 时，触发前的 ready charge 被清零，然后本次真实普攻可按规则为下一轮重新增加 `chargeGainPerBasicAttack`。
8. `operations[]` 沿用现有 DPS passive operation，包含 `attackerAttrRead` 时必须遵守 Batch M 属性读取语义。

### 5.2 初始充能假定

允许通过 `scenarioStates` 表达“开局已充能”的对比曲线，但它只能作为初始状态，不得替代自然充能过程：

```json
{
  "stateId": "item_6699_energized",
  "sourceType": "item_passive",
  "sourceId": "6699",
  "activation": "assumed_charge_before_start",
  "stacks": 100,
  "startTimeMs": 0,
  "durationMs": 0
}
```

规则：

1. `stateId` 必须等于 `chargeKey` 才能作为初始充能输入。
2. `stacks` 表示初始 charge 值；缺省为 0，超过 `chargeCap` 时 capped。
3. `activation=assumed_charge_before_start` 必须进入导出 JSON，页面文案要能区分“自然跑满”和“用户假定开局已满”。
4. `durationMs=0` 表示该初始假定不因时间自然过期，只在触发消费时清零。
5. 没有自然充能测试时，即使初始满充曲线跑通，也不能算 `N-runtime-pass`。

### 5.3 阻塞规则

以下情况 curve 必须 `blocked`：

1. `triggerKind=energized_charge_and_consume` 但缺少 `chargeKey`、`chargeGainPerBasicAttack` 或 `chargeThreshold`。
2. `chargeGainPerBasicAttack <= 0`、`chargeThreshold <= 0`、`chargeCap < chargeThreshold`。
3. operation 请求 `attackerAttrRead=base|current|max` 但输入没有对应 `attributeViews`。
4. 真实装备需要多目标、距离、移动、可见性或主动技能才能解释主要 DPS 效果，且无法拆出单目标可审计伤害。
5. Web 投影阶段发现 enabled passive 在 published bundle 里缺少对应 passive definition。

## 6. Runtime 顺序

每次真实普攻命中时，Batch N 的处理顺序固定为：

1. 结算基础普攻伤害。
2. 进入 passive 阶段，读取该 hit 开始前的 charge 快照。
3. 如果 `charge >= chargeThreshold` 且该状态是 hit 前 ready，执行 `operations[]`，记录 proc 证据，然后按 `consumeChargeOnTrigger` 清零。
4. 本次 hit 的 proc 检查结束后，再给真实普攻增加 `chargeGainPerBasicAttack`。
5. 如果新增后达到 `chargeThreshold`，只把状态标记为下一次真实普攻 ready，不在当前 hit 触发。
6. 处理 HP、击杀和下一次普攻排程。

边界：

1. 攻击 A 把 charge 从 75 加到 100 时，攻击 A 只输出 `readyAfterHit=true`，不输出 charged proc damage。
2. 攻击 B 开始时看到 ready，攻击 B 触发额外效果并消费，然后攻击 B 可为下一轮增加 charge。
3. 如果初始 charge 已经是 100，第一次真实普攻会触发，之后按同一轮次规则重新充能。
4. phantom-hit 不读取、不消费、不增加 charge，也不能复制 energized proc。
5. 同一 hit 内多个 energized passive 按 `resolvedSnapshot.passiveEffects[]` 顺序独立处理；本批不定义共享盈能池或唯一冲突规则。

## 7. 输出证据

Wasm 输出必须让 Web 和 Playwright 不靠推测也能复核充能链路：

1. `itemPassiveTriggers` / `skillPassiveTriggers` / `externalPassiveTriggers` 按 `sourceCategory` 记录 charged proc，包含 `sourceId`、`triggerId`、`chargeKey` 和本次 damage/effect 结果。
2. `damageTimeline` 包含 charged proc 的 damage source、damageType、timeMs 和 target HP 变化。
3. `damageBySource`、`damageByType`、`totalDamage` 和 `timeWindowDps` 必须计入 charged proc damage。
4. `effectBreakdown` 至少记录三类条目：`energized_charge_check`、`energized_charge_consume`、`energized_charge_gain`。
5. 每条 charge 证据至少包含 `chargeKey`、`preCharge`、`postCharge`、`chargeGain`、`chargeThreshold`、`readyBeforeHit`、`readyAfterHit`、`consumed`、`triggered`。
6. 如果 operation 使用属性读取，`effectBreakdown` 继续记录 Batch M 约定的 `attackerAttr`、`attackerAttrRead`、`attrValue`、`attackerAttrRatio` 和 `contribution`。
7. 导出 JSON 必须保留 `selection`、`resolvedSnapshot`、`scenarioStates`、`passiveEffects` 和完整 `curveResults`，以区分自然充能和开局满充假定。

## 8. 真实数据范围

真实装备 gate 按 seed/audit 实际可用数值确定，优先级如下：

| itemId | 建议处理 | 原因 |
| --- | --- | --- |
| `6699` | 首选候选；如果 source/audit 有单目标额外伤害数值，则作为 `N-real-data-pass` 首验 | 更适合作为“充能后下一次普攻额外伤害”的单目标验证 |
| `3097` | 第二候选；如果保留单目标 charged damage，可作为首验或补充曲线 | 机制标签接近简化盈能语义 |
| `3087` | 仅拆出主目标可审计伤害；连锁/弹射部分记录为 `recorded_not_simulated` | 电刀通常带多目标连锁，不能让单目标 DPS 伪装成完整效果 |
| `3094` | 不作为首个 damage gate；若只有射程收益则记录为不参与当前 DPS | 射程改变不是当前 fixed dummy DPS 输出 |

真实 seed 必须满足：

1. damage operation 的 `amount`、`attackerAttr`、`attackerAttrRead`、ratio 或其他公式字段有可审计来源。
2. 多目标、射程、减速、可见性等非目标效果保留来源说明，但不计入本批 DPS。
3. 如果本地 Data Dragon 缺少数值，先保留 synthetic runtime pass，并把真实数据标记为 `N-real-data-blocked`。
4. versionCode 建议使用 `v2_batch_n_energized_charge_001` 或最终约定的 Batch N 版本号。

## 9. 写入范围

后续开发会话允许写入：

| Worktree | 允许写入 |
| --- | --- |
| `C:\project\damage_wasm_dev` | `wasm/tinygo_engine_v2/internal/model/types.go`、`wasm/tinygo_engine_v2/internal/runtime/dps_driver.go`、`wasm/tinygo_engine_v2/internal/runtime/dps_driver_test.go`、必要的测试记录 |
| `C:\project\damage_web_dev` | `web/src/engine/tinygoV2DpsAdapter.ts`、`web/src/pages/WasmValidationV2DpsPage.tsx`、同步后的 `web/src/engine/wasm/tinygo_engine_v2.wasm` |
| `C:\project\damage_backend_dev` | `最小验证/V2-Batch-N-*.seed.json`、`最小验证/V2-Batch-N-*.audit.json`、必要的 import/publish 测试 |
| `C:\project\damage_viewer_project_planning` | 本计划、测试记录、任务治理映射 |

禁止写入：

1. V2 DPS 无关的 admin 页面。
2. 完整 1v1 rotation 或主动技能调度入口。
3. 本机 datasource 凭据、密钥或临时服务日志。
4. `.codegraph/*.db*`、Playwright 临时截图以外的生成噪音。

## 10. 执行顺序

1. GPT/Codex 检查四个 worktree 的 `git status --short -uall`，确认已有脏改归属。
2. GPT/Codex 读取最近层 `AGENTS.md`、README 和本计划，收敛 Cursor prompt。
3. Cursor 先只实现 Wasm contract 和 runtime tests，不改 web/backend/seed。
4. GPT/Codex review Cursor diff 和事件日志，运行 Wasm targeted tests、全量 Go tests 和 bench。
5. Cursor 或 GPT/Codex 按流程实现 Web adapter/page 证据展示，不在页面层计算充能或伤害。
6. GPT/Codex build web，并用 Playwright 复核导出 JSON 中的 charge/proc 证据。
7. 通过后再更新 backend seed/audit，选择一个真实装备做 dry-run/import/publish。
8. backend current bundle 验证新 passive definition、charge 字段和 formula 字段被保留。
9. 同步 Wasm artifact 到 web，跑完整页面用户流。
10. 写测试记录，明确 `N-contract-pass`、`N-runtime-pass`、`N-web-pass`、`N-real-data-pass`、`N-live-pass` 状态。

## 11. 验证命令

### Wasm

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./internal/runtime -run "Energized|Charge|SingleAttackerDPS|Canonical|Phantom" -count=1
go test ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
node .\scripts\smoke-node.mjs
```

必须新增或覆盖的测试：

1. `TestSingleAttackerDPSEnergizedChargesAfterRealBasicAttack`
2. `TestSingleAttackerDPSEnergizedThresholdDoesNotProcSameHit`
3. `TestSingleAttackerDPSEnergizedReadyConsumesOnNextHit`
4. `TestSingleAttackerDPSEnergizedConsumeStartsNextCycle`
5. `TestSingleAttackerDPSEnergizedInitialChargeScenarioTriggersFirstHit`
6. `TestSingleAttackerDPSEnergizedDoesNotChargeFromPhantomHit`
7. `TestSingleAttackerDPSEnergizedDoesNotProcFromPhantomHit`
8. `TestSingleAttackerDPSEnergizedBlocksInvalidChargeConfig`
9. `TestSingleAttackerDPSEnergizedRecordsChargeBreakdown`

### Web

```powershell
cd C:\project\damage_web_dev\web
npm run build
```

Playwright 至少验证：

1. `#/wasm-validation-v2-dps` 可运行 Batch N 真实装备曲线。
2. 同一装备能对比“自然从 0 充能”和“开局已满充”两类曲线。
3. 导出 JSON 能看到 `chargeKey`、`preCharge`、`postCharge`、`readyBeforeHit`、`readyAfterHit`、`consumed`、`triggered`。
4. 攻击达到阈值的那一刀不触发，下一刀才触发。
5. `#/wasm-validation-v2-dps-stacking-passive` 中 Batch H/K 鬼索/phantom-hit 证据不回退。

### Backend

```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn test
mvn -q -DskipTests test-compile org.codehaus.mojo:exec-maven-plugin:3.5.0:java "-Dexec.classpathScope=test" "-Dexec.mainClass=xyz.game.datamanage.tools.KatarinaMvpImportMain" "-Dexec.args=--dryRun --seedFile=C:\project\damage_backend_dev\最小验证\V2-Batch-N-energized-charge.seed.json --versionCode=v2_batch_n_energized_charge_001 --gameId=lol"
```

发布后至少核对：

1. current version 为本批 versionCode。
2. bundle 中目标 item 的 `skillRefs` 能找到 Batch N passive skill。
3. `mechanicsConfig.dpsPassiveEffects[].triggerKind` 包含 `energized_charge_and_consume`。
4. 对应 passive 保留 `chargeKey`、`chargeGainPerBasicAttack`、`chargeThreshold`、`chargeCap`。
5. damage operation 的公式字段和 source 可审计。

### Governance

```powershell
cd C:\project\damage_viewer_project_planning
node tools/task-governance/cli.mjs rebuild
node tools/task-governance/cli.mjs docs planning-validation-milestones
```

## 12. Cursor Prompt 模板

后续进入编码会话时，GPT/Codex 应先按实际代码状态修订本模板，再启动 Cursor。

```text
目标：实现 V2 single_attacker_dps 的 Batch N 普攻充能阈值触发机制。新增 triggerKind=energized_charge_and_consume，使真实 basic_attack_hit 增加 charge；charge 达到 threshold 后只标记下一次真实普攻 ready；下一次真实普攻消费 charge 并执行 operations；phantom-hit 不增加、不消费、不触发该机制。

允许写入范围：
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver.go
- C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go

非目标：
- 不实现移动充能、距离充能、主动技能 rotation、action queue editor 或完整 1v1。
- 不实现多目标连锁、射程、减速、可见性、seeded random crit、execute。
- 不改 web/backend/seed，不同步 wasm artifact。
- 不让 phantom-hit 触发、复制、消耗或增加 energized。

实现要求：
- DPS passive validation 支持 energized_charge_and_consume，并校验 chargeKey、chargeGainPerBasicAttack、chargeThreshold、chargeCap。
- runtime 为每条 curve 维护 chargeKey 对应的 curve-local charge state。
- 真实普攻命中时，先检查 hit 前 ready 并执行/消费，再为本次真实普攻增加 charge。
- 当前 hit 达到 threshold 只能让下一次真实普攻 ready，不能同 hit 触发。
- 初始 scenarioStates 中 stateId=chargeKey 且 activation=assumed_charge_before_start 时，可作为初始 charge 输入。
- effectBreakdown 记录 charge check/consume/gain，字段至少包含 chargeKey、preCharge、postCharge、chargeGain、chargeThreshold、readyBeforeHit、readyAfterHit、consumed、triggered。
- damageTimeline、damageBySource、damageByType、passiveTriggers 和 totalDamage 必须包含 charged proc damage。
- operation 属性读取继续遵守 Batch M attackerAttrRead 语义。

验证命令：
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./internal/runtime -run "Energized|Charge|SingleAttackerDPS|Canonical|Phantom" -count=1
go test ./...
go run ./cmd/bench

停止条件：
- 如果需要 Web 伪造每次 ready state 才能跑通，自行停止并报告，不能继续扩大范围。
- 如果需要完整 movement/distance/rotation 才能表达机制，自行停止并报告。
- 如果现有 output DTO 无法记录 charge evidence，先给最小 DTO 字段建议，不要私自改三端。
```

## 13. 完成标准

Batch N 完成必须同时满足：

1. Wasm runtime 支持 `energized_charge_and_consume`，旧数据不回退。
2. synthetic tests 覆盖自然充能、阈值不当刀触发、下一刀消费、消费后重启下一轮、开局满充假定、phantom-hit 不参与。
3. Web 从 published bundle 投影 energized passive，不手算 DPS，并能导出完整 charge/proc 证据。
4. 至少一个真实装备 seed dry-run/import/publish 通过，current bundle 保留 Batch N 字段。
5. live page current version、wasm hash、导出 payload 与本批产物一致，不复用 stale bundle 或 stale wasm。
6. Batch H/K/L/M 相关页面和 tests 不回退。
7. 测试记录写明 live DB target、current version、wasm hash、导出 JSON 证据和剩余人工确认项。

## 14. 残余风险

1. 真实装备文本可能把单目标伤害、连锁、多目标、减速或射程混在同一个 passive 中；本批只能拆出可审计的单目标 DPS 部分。
2. 简化版不模拟移动充能，因此和真实 LoL 盈能频率会有差异；页面和测试记录必须写明当前只验证“普攻充能阈值触发”。
3. 多个 energized passive 同时存在时，真实游戏可能有共享充能池或唯一冲突规则；本批按独立 `chargeKey` 处理，后续如需共享池另开 gate。
4. 如果 first real-data 候选缺少公式数值，不能为赶进度伪造；只能保留 synthetic pass 并报告 `N-real-data-blocked`。
5. 如果 Web 仍加载 stale wasm 或 backend current bundle 未刷新，页面结果会误判；必须做 version/hash/freshness 证明。
