TASK_KEY: planning-validation-milestones
DOC_TYPE: 测试记录
WORKSTREAM: planning
STATUS: active
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-05-17

# V2 Batch D ADC 装备被动测试记录 2026-05-17

关联概要：[验证里程碑V2.md](../../概要设计/验证里程碑V2.md)

关联详细设计：[V2-单攻击方DPS协议与开发计划.md](../../详细设计/最小验证/V2-单攻击方DPS协议与开发计划.md)

## 1. 本轮范围

本轮验证 V2 Batch D：在 Batch C 成装属性已经录入并可被 V2 DPS 页面消费的基础上，接入 3 个 ADC 常见装备被动：

| itemId | 装备 | 本轮机制 | 数据口径 |
| --- | --- | --- | --- |
| `3124` | 鬼索的狂暴之刃 | 每次普攻命中附加 `30` 魔法伤害 | 本地 `item.json` 可读到固定值，游戏侧人工确认固定多 `30` |
| `3153` | 破败王者之刃 | 每次普攻命中附加目标当前生命值比例物理伤害 | 远程英雄按 `6%` 当前生命值，游戏侧截图已确认 |
| `6672` | 海妖杀手 | 每 3 次普攻命中附加物理伤害，并按目标已损生命值放大 | `120 * (1 + targetMissingHpPct * 0.75)`，游戏侧截图已确认 |

本轮还补充了 `targetCurrentHpRatio` / `targetCurrentHpBasis` / `targetMissingHpAmp` 输出契约，用于表达破败这类按当前生命值结算的装备被动，以及海妖这类按已损生命值比例放大的装备被动。

## 2. 数据与发布

后端 seed：[V2-Batch-D-adc-item-passives.seed.json](</c:/project/damage_backend_dev/最小验证/V2-Batch-D-adc-item-passives.seed.json>)

依赖说明：Batch D seed 不是干净库全量 seed，它要求 Batch C 的 ADC 装备主数据已经存在。原因是当前导入工具先写 skill 再写 item，而 item-owned skill 在写入时会校验 `ownerId` 对应 item 已存在；本轮实际发布环境已先完成 Batch C。

发布版本：

| 字段 | 值 |
| --- | --- |
| current version | `v2_batch_d_item_passives_002` |
| bundle version | `v2_batch_d_item_passives_002` |
| bundle itemCount | `518` |
| bundle skillCount | `41` |
| `3124.skillRefs` | `item_3124_guinsoos_rageblade_wrath_dps_v2` |
| `3153.skillRefs` | `item_3153_blade_of_the_ruined_king_mists_edge_dps_v2` |
| `6672.skillRefs` | `item_6672_kraken_slayer_bring_it_down_dps_v2` |

发布命令：

```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn -DskipTests test-compile org.codehaus.mojo:exec-maven-plugin:3.5.0:java "-Dexec.classpathScope=test" "-Dexec.mainClass=xyz.game.datamanage.tools.KatarinaMvpImportMain" "-Dexec.args=--seedFile=C:\project\damage_backend_dev\最小验证\V2-Batch-D-adc-item-passives.seed.json"
```

结果：发布成功，`lol` current 指向 `v2_batch_d_item_passives_002`；本轮通过 `GET /api/games/lol/versions/current` 和对应 bundle API 复核 current/bundle 均为 `v2_batch_d_item_passives_002`，`itemCount=518`，`skillCount=41`。

## 3. Wasm 回归

新增/调整点：

1. `DPSPassiveOperationV2` 支持 `targetCurrentHpRatio` 和 `targetCurrentHpBasis`。
2. `targetCurrentHpBasis` 支持 `current` 和 `attack_start`。
3. `DPSPassiveOperationV2` 支持 `targetMissingHpAmp`，按 `amount * (1 + missingRatio * targetMissingHpAmp)` 计算放大。
4. `itemPassiveTriggers` 和 `effectBreakdown` 的 `timeMs` 改为显式输出，0ms 触发不再被省略。
5. 回归覆盖鬼索 item trigger、破败 attack-start 当前生命值、海妖每 3 次攻击和 missing HP 放大。

验证命令：

| 命令 | 结果 |
| --- | --- |
| `go test ./...` in `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2` | 通过 |
| `go run ./cmd/bench` | 通过，`samples=100 avg_us=160.85 max_us=1005.00` |
| `build-wasm.ps1` with explicit TinyGo and `WASMOPT` | 通过，`tinygo_engine_v2.wasm` `442777` bytes |
| `node .\scripts\smoke-node.mjs` with `TINYGO_WASM_EXEC` | 通过，ABI exports 正常 |

## 4. Backend / Web 回归

| 模块 | 命令 | 结果 |
| --- | --- | --- |
| Backend | `mvn -Dtest=KatarinaMvpImportMainTest test` | 通过，`Tests run: 8, Failures: 0, Errors: 0, Skipped: 0` |
| Web | `npm run build` in `C:\project\damage_web_dev\web` | 通过，wasm asset `442.78 kB`；保留既有 large chunk warning |

前端 wasm 已同步到：

```text
C:\project\damage_web_dev\web\src\engine\wasm\tinygo_engine_v2.wasm
```

## 5. Playwright 页面复测

入口：

```text
http://127.0.0.1:5173/#/wasm-validation-v2-dps
```

操作：

1. 在系统总览切换 game 到 `lol`。
2. 打开 V2 DPS 页面。
3. 固定攻击方 `hero_vayne`，标靶 `target_dummy_fighter`。
4. 关闭默认薇恩 W 被动。
5. 选择装备 `3153` + `6672`，不启用薇恩 W，隔离验证装备被动。
6. 点击运行并导出 JSON。

页面结果：

| 字段 | 值 |
| --- | --- |
| caseId | `V2-BatchD-item-passives-001` |
| versionCode | `v2_batch_d_item_passives_002` |
| wasmSha256 | `28e24c5d38328bc30202fe50dce8da6d56536cded019748e4c7e83bba46aa40c` |
| activeCurveId | `hero_vayne-selected-passives` |
| equipmentSet | `["3153", "6672"]` |
| enabledPassiveEffects | 破败 + 海妖 |
| target | `target_dummy_fighter`，`hp=3000` / `armor=100` / `magic_resist=80` |
| attackCount | `14` |
| totalDamage | `2132.634630741927` |
| timeWindowDps | `213.26346307419272` |
| killTimeMs | `null` |
| itemPassiveTriggers | `18` |
| skillPassiveTriggers | `0` |

关键输出：

| 证据字段 | 结果 |
| --- | --- |
| `itemPassiveTriggers[0].timeMs` | `0` |
| 破败首段 | `timeMs=0` / `amount=180` / `message=physical`，来自页面默认标靶 `3000 * 6%` |
| 海妖首段 | `timeMs=1530` / `amount=129.60375` / `message=physical`，来自 `120 * (1 + missingHpPct * 0.75)` |
| `damageBySource.blade_of_the_ruined_king_current_hp_on_hit` | `815.0659714253925` |
| `damageBySource.kraken_slayer_bring_it_down` | `302.5686593165344` |

证据文件：

- [V2-BatchD-DPS-page-3153-6672-2026-05-17.png](artifacts/V2-BatchD-DPS-page-3153-6672-2026-05-17.png)
- [V2-BatchD-DPS-export-3153-6672-2026-05-17.json](artifacts/V2-BatchD-DPS-export-3153-6672-2026-05-17.json)

页面 console 仍保留同一浏览器会话里早前 IT game 没有 current version 的 404 记录。切换到 `lol` 后当前页面状态为 `success`，本轮 V2 DPS 运行结果为 `ok / duration_elapsed`，不作为 Batch D 阻塞。

## 6. 游戏侧截图与 OCR 复测

截图目录：

```text
C:\project\ocr_data\薇恩
```

OCR 命令：

```powershell
cd C:\project\ocr_tools
.\.venv\Scripts\ocr-tool.exe run --engine paddle --input C:\project\ocr_data\薇恩 --profile C:\project\ocr_tools\configs\common_2560x1440.json --output C:\project\ocr_tools\out\vayne_ocr_20260517.json --debug-crops C:\project\ocr_tools\out\vayne_ocr_20260517_crops
```

OCR 输出：

- `C:\project\ocr_tools\out\vayne_ocr_20260517.json`
- `C:\project\ocr_tools\out\vayne_ocr_20260517_crops`

OCR 可确认字段：

| 截图 | 口径 | OCR 结果 |
| --- | --- | --- |
| `Screen11.png` - `Screen13.png` | 破败组 HUD | 等级 `1`，AD `100`，攻速 `0.82`，暴击 `0%` |
| `Screen14.png` - `Screen16.png` | 海妖组 HUD | 等级 `1`，AD `105`，攻速 `0.92`，暴击 `0%` |

当前通用 ROI 未稳定覆盖标靶头顶 HP 文本，因此目标 HP 变化以人工读数为主证据，OCR 只作为英雄面板与装备 tooltip 辅证。

人工游戏基线：

| 装备 | 环境 | 人工读数 | 公式复核 |
| --- | --- | --- | --- |
| `3124` 鬼索 | ADC 普攻命中目标 | 用户人工确认装备被动固定多 `30` | 本轮 seed 为每次普攻命中附加 `30` 魔法伤害；0 魔抗目标下应表现为每下额外 `30` |
| `3153` 破败 | 薇恩 1 级，目标 `1000 HP / 0 armor / 0 MR`，AD `100` | 第 1 下后 HP `840`，第 2 下后 HP `690` | 第 1 下 `100 + 1000 * 0.06 = 160`；第 2 下 `100 + 840 * 0.06 = 150.4`，目标 HP `689.6`，游戏展示约 `690` |
| `6672` 海妖 | 薇恩 1 级，目标 `1000 HP / 0 armor / 0 MR`，AD `105` | 第 1 下后 HP `895`，第 2 下后 HP `790`，第 3 下后 HP `547` | 前两下各 `105`；第 3 下海妖 `120 * (1 + 0.21 * 0.75) = 138.9`，合计 `243.9`，目标 HP `546.1`，游戏展示约 `547` |

结论：鬼索固定 `+30`、破败远程 `6% 当前生命值`、海妖 `120 * (1 + targetMissingHpPct * 0.75)` 与游戏侧人工确认/截图读数一致。标靶 HP 仍未由 OCR 自动抽取，后续如果要减少人工读数，需要单独扩展目标 HP ROI。

## 7. 结论

开发侧通过：

1. DB seed 可以把装备被动作为 item-owned skill 发布到 bundle。
2. 前端可以从 `item.skillRefs` 自动启用 item passive，并写入 `enabledPassiveEffects`。
3. Wasm 可以执行固定 on-hit、当前生命值比例 on-hit、每 N 次攻击触发和 missing HP 倍率放大。
4. V2 DPS 页面能展示并导出 `itemPassiveTriggers`、`effectBreakdown`、伤害构成和 HP 时间线。

游戏侧通过：

1. `3124` 鬼索的狂暴之刃：固定每次普攻命中多 `30` 已由人工确认。
2. `3153` 破败王者之刃：薇恩作为远程英雄时按 `6% 当前生命值` 结算，与训练营截图人工读数一致。
3. `6672` 海妖杀手：第 3 次攻击按 `120 * (1 + targetMissingHpPct * 0.75)` 结算，与训练营截图人工读数一致。

遗留限制：

1. OCR 当前能确认英雄 HUD 和部分 tooltip，但不能稳定自动抽取标靶 HP；本轮标靶 HP 仍使用人工读数。
2. Batch D 本轮只证明已录入装备被动的机制与公式链路，不代表所有 ADC 成装被动都已完成游戏侧验收。
