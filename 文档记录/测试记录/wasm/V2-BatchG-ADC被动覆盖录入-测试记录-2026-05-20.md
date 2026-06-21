TASK_KEY: planning-validation-milestones
DOC_TYPE: 测试记录
WORKSTREAM: planning
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-05-20

# V2 Batch G ADC 被动覆盖录入测试记录 2026-05-20

关联计划：[V2-BatchG-ADC被动覆盖审计与录入计划.md](../../详细设计/最小验证/V2-BatchG-ADC被动覆盖审计与录入计划.md)

覆盖清单：[V2-BatchG-ADC被动覆盖清单.md](../../详细设计/最小验证/V2-BatchG-ADC被动覆盖清单.md)

机器清单：`最小验证/V2-Batch-G-adc-passive-audit.json`

页面 A/B 证据：`文档记录/测试记录/wasm/artifacts/V2-BatchG-ADC-passive-page-ab-2026-05-20.json`

## 1. 本轮范围

本轮执行 Batch G 的 G0-G3：

1. 生成 ADC/平 A 流英雄与 ADC 成装被动审计脚本、机器 JSON 和覆盖清单。
2. 只录入 `ready_to_encode` 项。
3. 发布 `v2_batch_g_adc_passives_001`。
4. 用页面 A `#/wasm-validation-v2-dps` 和页面 B `#/wasm-validation-v2-dps-multi-hero` 验证新增装备被动、英雄等级变化和技能等级变化。

未做：

1. 未新增英雄被动。审计结果中没有新增 hero_skill 同时满足 runtime 表达、完整 `statsByLevel`、完整 rank gate。
2. 未把 `needs_runtime_extension` 或 `needs_manual_baseline` 项写入 ready seed。
3. 未修改 TinyGo runtime、前端业务代码或后端导入代码。

## 2. G0 审计结果

命令：

```powershell
cd C:\project\damage_wasm_dev
node .\最小验证\数据\build-v2-batch-g-adc-passive-audit.mjs
```

结果：

| 项 | 结果 |
| --- | --- |
| Marksman 英雄池 | `33` |
| ADC 成装池 | `53` |
| 候选条目 | `242` |
| hero_skill 条目 | `165` |
| item_passive 条目 | `77` |
| `ready_to_encode` | `1` |
| `already_covered` | `13` |
| `needs_runtime_extension` | `37` |
| `needs_manual_baseline` | `45` |
| `out_of_scope_for_single_target_dps` | `146` |
| ready gate 违规 | `0` |
| 空 classification | `0` |

新增 ready 项：

| owner | 被动 | 原因 |
| --- | --- | --- |
| `3302` 界弓 | 晦影 | Data Dragon 明确 `攻击造成30额外魔法伤害`，当前 `on_basic_attack_hit + damage` 可表达 |

## 3. G2 录入与发布

写入：

1. `最小验证/V2-Batch-G-adc-passives-ready.seed.json`
2. `item_3302_terminus_shadow_dps_v2`
3. `3302.skillRefs=["item_3302_terminus_shadow_dps_v2"]`

发布前 API 检查：

| 检查项 | 结果 |
| --- | --- |
| current version | `v2_batch_g_adc_level_tables_002` |
| `3302` item | 已存在 |
| `3302.skillRefs` | 空 |
| `item_3302_terminus_shadow_dps_v2` | 不存在 |

Dry-run：

```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn -q -DskipTests test-compile org.codehaus.mojo:exec-maven-plugin:3.5.0:java "-Dexec.classpathScope=test" "-Dexec.mainClass=xyz.game.datamanage.tools.KatarinaMvpImportMain" "-Dexec.args=--dryRun --seedFile=C:\project\damage_wasm_dev\最小验证\V2-Batch-G-adc-passives-ready.seed.json --versionCode=v2_batch_g_adc_passives_001"
```

结果：导入工具识别 `skills=1`、`items=1`、`dryRun=true`，未写库。

实际导入发布：

```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn -q -DskipTests test-compile org.codehaus.mojo:exec-maven-plugin:3.5.0:java "-Dexec.classpathScope=test" "-Dexec.mainClass=xyz.game.datamanage.tools.KatarinaMvpImportMain" "-Dexec.args=--seedFile=C:\project\damage_wasm_dev\最小验证\V2-Batch-G-adc-passives-ready.seed.json --versionCode=v2_batch_g_adc_passives_001"
```

结果：`Published versionCode=v2_batch_g_adc_passives_001`，并通过 `Verified current + bundle`。

发布后 API 检查：

| 检查项 | 结果 |
| --- | --- |
| current version | `v2_batch_g_adc_passives_001` |
| `3302.skillRefs` | `item_3302_terminus_shadow_dps_v2` |
| skill owner | `3302` |
| triggerKind | `on_basic_attack_hit` |
| operation | `damage / magic / amount=30` |

## 4. 页面 A/B 验证

命令：

```powershell
cd C:\project\damage_web_dev\web
$env:NODE_PATH="$env:LOCALAPPDATA\npm-cache\_npx\420ff84f11983ee5\node_modules"
npx --yes --package @playwright/test playwright test output/playwright/batch-g-adc-passive-verify.spec.cjs --reporter=line --workers=1
```

结果：`2 passed (5.6s)`。

页面 A `#/wasm-validation-v2-dps`：

| 场景 | 关键值 |
| --- | --- |
| 薇恩 Lv18 / W5 / `3302` | `attackerAd=129.95`，`attackCount=14`，`totalDamage=2342.9833333333313`，`itemTriggerCount=14` |
| 薇恩 Lv1 / W1 / `3302` | `attackerAd=90`，`attackCount=11`，`totalDamage=1218.3333333333323`，`itemTriggerCount=11` |
| `resolvedSnapshot` | `equipmentSet` 包含 `3302`，`enabledPassiveEffects` 包含 `item_3302_terminus_shadow_dps_v2` |
| 被动操作 | `operations[0].amount=30` |

页面 B `#/wasm-validation-v2-dps-multi-hero`：

| 场景 | 关键值 |
| --- | --- |
| 克格莫 Q5/W5 / `3302` | `kogmawWTargetMaxHpRatio=0.06`，`attackCount=10`，`killTimeMs=3483` |
| 克格莫 Q1/W1 / `3302` | `kogmawWTargetMaxHpRatio=0.03`，`attackCount=12`，`killTimeMs=5060` |
| 结论 | 技能等级变化改变 `resolvedSnapshot.passiveEffects[].operations`，并改变曲线结果 |

## 5. Wasm 与 Web 回归

Wasm：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./internal/runtime -run "Canonical|SingleAttackerDPS" -count=1
go test ./...
go run ./cmd/bench
```

结果：

| 命令 | 结果 |
| --- | --- |
| `go test ./internal/runtime -run "Canonical|SingleAttackerDPS" -count=1` | `ok tinygo_engine_v2/internal/runtime 0.414s` |
| `go test ./...` | 通过 |
| `go run ./cmd/bench` | `samples=100 avg_us=651.78 max_us=6201.00` |

Web：

```powershell
cd C:\project\damage_web_dev\web
npm run build
```

结果：通过。Vite 保留既有 chunk size warning，未阻塞构建。

## 6. 阻塞清单

`needs_runtime_extension=37`：

| 机制 | 数量 |
| --- | ---: |
| `distance_based_damage_modifier` | 11 |
| `spellblade_next_attack_state` | 6 |
| `energized_charge_and_consume` | 6 |
| `seeded_random_crit_sequence` | 5 |
| `stacking_stat_modifier_on_hit` | 5 |
| `damage_multiplier_or_health_ratio` | 2 |
| `execute_threshold` | 2 |
| `phantom_hit_on_hit_repeat` | 1 |

`needs_manual_baseline=45`：

| 类型 | 数量 | 需要用户数据 |
| --- | ---: | --- |
| `dps_relevant_manual_review` | 41 | 完整 tooltip 数值或训练营截图 |
| `on_hit` | 3 | 完整 tooltip 数值或训练营截图 |
| `every_n_hit` | 1 | 完整 tooltip 数值或训练营截图 |

重点待补字段：

1. 缺完整 tooltip 数值或训练营截图：厄斐琉斯 P/W、凯特琳 E、库奇 P/E、德莱文 E、格雷福斯 P/R、卡莉丝塔 Q、卢锡安 Q/R、厄运小姐 P、奎因 P、希维尔 P/Q、斯莫德 P/W/E、崔丝塔娜 Q、崔斯特 Q、薇恩 E、霞 P/Q/E 等。
2. 缺 `statsByLevel`：崔斯特 E 等候选即使机制可能可表达，也不能进入 ready seed，需补 1-18 级 `hp/mana/ad/armor/magic_resist/hp_regen/mana_regen/attack_speed`。
3. 装备缺数值：智慧末刃、纳什之牙等 on-hit 文本缺本地可审计数值，需 tooltip 或训练营截图。

完整阻塞项以 `最小验证/V2-Batch-G-adc-passive-audit.json` 和覆盖清单为准。
