TASK_KEY: planning-validation-milestones
DOC_TYPE: 测试记录
WORKSTREAM: planning
STATUS: active
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-05-17

# V2 Batch C ADC 成装属性录入测试记录 2026-05-17

关联概要：[文档记录/概要设计/验证里程碑V2.md](../../概要设计/验证里程碑V2.md)

关联详细设计：[文档记录/详细设计/最小验证/V2-单攻击方DPS协议与开发计划.md](../../详细设计/最小验证/V2-单攻击方DPS协议与开发计划.md)

## 1. 本轮范围

本轮只闭环 V2 Batch C 的后端数据录入与发布：

1. 从 [数据参考/item.json](</c:/project/damage_wasm_dev/数据参考/item.json>) 读取装备数据。
2. 只录入召唤师峡谷、可购买、普通 4 位 itemId、成装、非鞋子的 ADC/DPS 相关装备。
3. 只录入面板属性和 `adc_completed_item` type relation，不录入装备被动、主动或攻击特效。
4. 首次发布版本 `v2_batch_c_adc_items_001`；暴击倍率修正后重新发布为 `v2_batch_c_adc_items_002`。

本轮原始范围不验证前端装备选择和 wasm DPS 差异；2026-05-17 已补充运行链路复测，结论见第 6 节。

## 2. 清洗规则

生成脚本：[build-v2-batch-c-adc-items-seed.mjs](</c:/project/damage_backend_dev/最小验证/数据/build-v2-batch-c-adc-items-seed.mjs>)

输出 seed：[V2-Batch-C-adc-items.seed.json](</c:/project/damage_backend_dev/最小验证/V2-Batch-C-adc-items.seed.json>)

清洗规则：

1. `maps["11"] == true`。
2. `gold.purchasable == true` 且 `inStore != false`。
3. `from` 非空且 `into` 为空，判定为成装。
4. 只保留普通 4 位 itemId，排除竞技场/特殊复制 itemId。
5. 排除已知鞋子 itemId：`1001/3005/3006/3008/3009/3010/3020/3047/3111/3117/3158/3172`。
6. 只保留带 ADC/DPS 直接属性的装备：AD、攻速、暴击、暴击伤害、生命偷取、全能吸血、穿甲、百分比护甲穿透，或 on-hit 混合 AP 装。

`item.json` 文件头版本为 `16.9.1`；项目验证版本按发布链记录，当前修正版为 `v2_batch_c_adc_items_002`。

## 3. 录入结果

| 字段 | 结果 |
| --- | --- |
| 生成 seed | 通过 |
| seed versionCode | `v2_batch_c_adc_items_001` |
| 录入 item 数 | `53` |
| `adc_completed_item` typeId | `62002` |
| type relation 数 | `53` |
| type relation category | `equipment` |
| 排除鞋子 relation 命中 | `0` |
| 当前发布版本 | `v2_batch_c_adc_items_002` |

生成脚本输出摘要：

```text
selectedItemCount=53
usedAttrKeys=ability_haste,ad,ap,armor,armor_pen_flat,armor_pen_percent,attack_speed,crit_chance,crit_damage,hp,life_steal,magic_resist,mana,ms_pct,omnivamp,tenacity
```

## 4. 抽查装备

| itemId | 装备 | 关键属性 |
| --- | --- | --- |
| `3031` | 无尽之刃 | `ad=75` / `crit_chance=0.25` / `crit_damage=0.3` |
| `3033` | 凡性的提醒 | `ad=35` / `armor_pen_percent=0.3` / `crit_chance=0.25` |
| `3036` | 多米尼克领主的致意 | `ad=35` / `armor_pen_percent=0.35` / `crit_chance=0.25` |
| `3046` | 幻影之舞 | `attack_speed=0.65` / `crit_chance=0.25` / `ms_pct=0.1` |
| `3072` | 饮血剑 | `ad=80` / `life_steal=0.15` |
| `3085` | 卢安娜的飓风 | `attack_speed=0.4` / `crit_chance=0.25` / `ms_pct=0.04` |
| `3091` | 智慧末刃 | `attack_speed=0.5` / `magic_resist=45` / `tenacity=0.2` |
| `3115` | 纳什之牙 | `ability_haste=15` / `ap=80` / `attack_speed=0.5` |
| `3124` | 鬼索的狂暴之刃 | `ad=30` / `ap=30` / `attack_speed=0.25` |
| `3153` | 破败王者之刃 | `ad=40` / `attack_speed=0.25` / `life_steal=0.1` |
| `3508` | 夺萃之镰 | `ability_haste=20` / `ad=50` / `crit_chance=0.25` |
| `6672` | 海妖杀手 | `ad=45` / `attack_speed=0.4` / `ms_pct=0.04` |
| `6673` | 不朽盾弓 | `ad=55` / `crit_chance=0.25` |
| `6675` | 纳沃利烁刃 | `attack_speed=0.4` / `crit_chance=0.25` / `ms_pct=0.04` |
| `6676` | 收集者 | `ad=50` / `armor_pen_flat=10` / `crit_chance=0.25` |

明确排除：

| itemId | 说明 |
| --- | --- |
| `3172` | 炮铜胫甲，本质为鞋类，已排除 |
| `1001` | 基础鞋，已排除 |
| `3504` | 炽热香炉，不属于本轮 ADC 成装池，已排除 |
| `4646` | 风暴狂涌，纯 AP/法穿，已排除 |

## 5. 命令记录

生成 seed：

```powershell
cd C:\project\damage_backend_dev
node "最小验证\数据\build-v2-batch-c-adc-items-seed.mjs"
```

dry-run：

```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn -DskipTests test-compile org.codehaus.mojo:exec-maven-plugin:3.5.0:java "-Dexec.classpathScope=test" "-Dexec.mainClass=xyz.game.datamanage.tools.KatarinaMvpImportMain" "-Dexec.args=--dryRun --seedFile=C:\project\damage_backend_dev\最小验证\V2-Batch-C-adc-items.seed.json --versionCode=v2_batch_c_adc_items_001"
```

导入并发布：

```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn -DskipTests test-compile org.codehaus.mojo:exec-maven-plugin:3.5.0:java "-Dexec.classpathScope=test" "-Dexec.mainClass=xyz.game.datamanage.tools.KatarinaMvpImportMain" "-Dexec.args=--seedFile=C:\project\damage_backend_dev\最小验证\V2-Batch-C-adc-items.seed.json --versionCode=v2_batch_c_adc_items_001"
```

结果：导入成功，发布成功，工具自带 current + bundle 校验通过。

暴击基础倍率修正后，使用 Batch B 英雄被动 seed 重新发布当前验证版本：

```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn -DskipTests test-compile org.codehaus.mojo:exec-maven-plugin:3.5.0:java "-Dexec.classpathScope=test" "-Dexec.mainClass=xyz.game.datamanage.tools.KatarinaMvpImportMain" "-Dexec.args=--seedFile=C:\project\damage_backend_dev\最小验证\V2-Batch-B-hero-passives.seed.json --versionCode=v2_batch_c_adc_items_002"
```

结果：发布成功，当前版本变为 `v2_batch_c_adc_items_002`，Vayne `baseStats.crit_damage=2.0`。

后端 seed 解析测试：

```powershell
cd C:\project\damage_backend_dev\server\data_manage
mvn -Dtest=KatarinaMvpImportMainTest test
```

结果：通过，`Tests run: 7, Failures: 0, Errors: 0, Skipped: 0`。

空白检查：

```powershell
cd C:\project\damage_backend_dev
git diff --check
```

结果：通过。

## 6. 运行链路复测

复测时间：2026-05-17

复测结论：数据录入和发布通过。2026-05-17 首次复测时，带装备 DPS 运行未通过，原因不是装备数据缺失，而是前端还没有把装备投影到 V2 DPS run input，wasm 也仍然显式拒绝非空 `equipmentSet`。同日已放开 wasm 侧 `equipmentSet` 门禁，允许 `equipmentStats` 合并进 attacker 属性后参与现有 AD / 攻速普攻计算。

### 6.1 Bundle 读回

后端公共接口读回：

```powershell
Invoke-RestMethod http://localhost:8080/api/games/lol/versions/current
Invoke-RestMethod http://localhost:8080/api/games/lol/versions/v2_batch_c_adc_items_002/bundle
```

读回结果：

| 字段 | 结果 |
| --- | --- |
| current version | `v2_batch_c_adc_items_002` |
| bundle meta version | `v2_batch_c_adc_items_002` |
| bundle itemCount | `518` |
| `adc_completed_item` equipment relation | `53` |
| relation 对应装备缺失 statModifiers | `0` |
| 鞋子排除 relation 命中 | `0` |

抽查样例仍包含装备属性：

| itemId | 关键属性 |
| --- | --- |
| `3031` | `ad=75` / `crit_chance=0.25` / `crit_damage=0.3` |
| `3046` | `attack_speed=0.65` / `crit_chance=0.25` / `ms_pct=0.1` |
| `3085` | `attack_speed=0.4` / `crit_chance=0.25` / `ms_pct=0.04` |
| `3124` | `ad=30` / `ap=30` / `attack_speed=0.25` |
| `6673` | `ad=55` / `crit_chance=0.25` |

补充读回：重新读取 `current` 与 `bundle`，结果为 `currentVersion=v2_batch_c_adc_items_002`、`itemCount=518`、`adc_completed_item` 装备挂载 `53` 条；Vayne `crit_damage=2.0`，`3031` 仍有 `ad=75` / `crit_chance=0.25` / `crit_damage=0.3`，`3046` 仍有 `attack_speed=0.65` / `crit_chance=0.25` / `ms_pct=0.1`。

### 6.2 Wasm 运行探针

无装备基线仍可运行：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./internal/runtime -run TestSingleAttackerDPSBasicAttackTimelineStopsOnTargetDeath -count=1
```

结果：通过。

放开前，临时探针把 `3031` 写入 `selection.equipmentSet` 和 `resolvedSnapshot.equipmentSet`，并写入 `equipmentStats={ad:75, crit_chance:0.25, crit_damage:0.3}` 后调用 `RunSingleAttackerDPS`。

探针结果：

```text
status=blocked
stopReason=blocked
blockedReasons=[single_attacker_dps does not support equipmentSet yet]
totalDamage=0.00
```

对应源码门禁当时存在于 `dps_driver.go`：非空 `curve.ResolvedSnapshot.EquipmentSet` 或 `curve.Selection.EquipmentSet` 会被直接阻断。该门禁已在 6.2.1 移除。

放开前补充探针：如果不传 `equipmentSet`，而是把装备属性手工折进 `attackerSnapshot.attributes`，wasm 能按合并后的 AD / 攻速计算普攻。

```text
输入：ad=135, attack_speed=1.308, target armor=100, durationMs=10000
输出：status=ok, attackCount=14, totalDamage=945.00
首段间隔：rawAttackSpeed=1.308, attackIntervalMs=765
```

这说明 wasm 普攻核心可以消费“已经合并后的属性”；6.2.1 放开后，正式 `equipmentSet/equipmentStats` 接入沿用该合并策略，并保留装备证据字段。

暴击属性补充探针：

```text
输入：ad=100, attack_speed=1, crit_chance=1, crit_damage=2, target armor=0, durationMs=1000
输出：status=ok, attackCount=1, totalDamage=100.00
```

当前 DPS runtime 尚未把 `crit_chance` / `crit_damage` 纳入普攻伤害公式；录入的暴击类装备属性虽然能出现在 bundle，但还不会影响 wasm DPS。

### 6.2.1 Wasm 放开记录

放开原因：早期阻塞是保守门禁。V2 DPS 第一阶段只接受“已经解析好的无装备普攻输入”，避免页面传入装备 ID 但 wasm 未合并属性时，证据 JSON 看起来像“装备已生效”。Batch C 装备数据和 `equipmentSet/equipmentStats` 字段契约落地后，可以把该门禁改成真实校验。

本次放开内容：

1. 移除 `single_attacker_dps does not support equipmentSet yet` 的硬阻塞。
2. 要求 `selection.equipmentSet` 与 `resolvedSnapshot.equipmentSet` 一致。
3. 非空 `equipmentSet` 必须提供 `resolvedSnapshot.equipmentStats`。
4. `equipmentStats` attrKey 必须非空，数值必须有限。
5. wasm 在创建 DPS curve state 前，将 `equipmentStats` 加到 `attackerSnapshot.attributes`，并在输出 `resolvedSnapshot` 中保留合并后的属性与原始 `equipmentStats` 证据。

新增回归：

| 用例 | 结果 |
| --- | --- |
| `TestSingleAttackerDPSEquipmentStatsAreMergedIntoAttackerAttributes` | 通过，`3031+3046` 合并后 `ad=135` / `attack_speed=1.308`，`attackCount=14`，`totalDamage=945.00` |
| `TestSingleAttackerDPSBlocksEquipmentSetWithoutResolvedStats` | 通过，非空装备但缺少 `equipmentStats` 会 blocked |
| `TestSingleAttackerDPSBlocksMismatchedEquipmentSet` | 通过，选择装备与 resolved 装备不一致会 blocked |
| `TestSessionBeginRunJSONDispatchesEquipmentSetDPSDoneFrame` | 通过，浏览器同款 `BeginRunJSON` 路径可返回带装备 `done` |

验证命令：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./...
go run ./cmd/bench
$env:WASMOPT='C:\project\damage_wasm_dev\.tools\binaryen-version_129\bin\wasm-opt.exe'
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1 -TinyGo 'C:\project\damage_wasm_dev\.tools\tinygo0.40.1\tinygo\bin\tinygo.exe'
$env:TINYGO_WASM_EXEC='C:\project\damage_wasm_dev\.tools\tinygo0.40.1\tinygo\targets\wasm_exec.js'
node .\scripts\smoke-node.mjs
```

结果：

| 命令 | 结果 |
| --- | --- |
| `go test ./...` | 通过 |
| `go run ./cmd/bench` | 通过，`samples=100 avg_us=637.40 max_us=10732.00` |
| `build-wasm.ps1` | 通过，`tinygo_engine_v2.wasm` `439893` bytes |
| `smoke-node.mjs` | 通过，ABI exports 正常 |
| `npm run build` in `C:\project\damage_web_dev\web` | 通过，新 wasm 产物进入前端构建 |

### 6.2.2 Wasm 暴击与穿透修复复测

2026-05-17 补充修复后，DPS runtime 不再只消费 AD / 攻速。普攻伤害已纳入期望暴击，物理伤害已纳入正抗性下的百分比穿透与固定穿透。

新增/更新回归：

| 用例 | 结果 |
| --- | --- |
| `TestSingleAttackerDPSExpectedCritDamageForBasicAttacks` | 通过，`crit_chance=0.25` / `crit_damage=2.0` 时单次 raw damage 为 `125`，满暴击 `crit_damage=2` 时为 `200` |
| `TestSingleAttackerDPSArmorPenetrationAppliesToPhysicalDamage` | 通过，目标护甲 `100`，`armor_pen_percent=0.3` + `armor_pen_flat=10` 后有效护甲 `60`，`100` 物理 raw damage 结算为 `62.5` |
| `TestSingleAttackerDPSEquipmentCritStatsAffectBasicAttackDamage` | 通过，`3031+3046` 合并后 `ad=135` / `attack_speed=1.308` / `crit_chance=0.5` / `crit_damage=2.3`，首段 `rawDamage=222.75` / `finalDamage=111.375`，`attackCount=14`，无被动基线 `totalDamage=1559.25` |

复测命令：

```powershell
cd C:\project\damage_wasm_dev\wasm\tinygo_engine_v2
go test ./...
go run ./cmd/bench
$env:TINYGO_WASM_EXEC='C:\project\damage_wasm_dev\.tools\tinygo0.40.1\tinygo\targets\wasm_exec.js'
node .\scripts\smoke-node.mjs
```

结果：

| 命令 | 结果 |
| --- | --- |
| `go test ./...` | 通过 |
| `go run ./cmd/bench` | 通过，`samples=100 avg_us=1043.33 max_us=21431.00` |
| `smoke-node.mjs` | 通过，`tinygo_engine_v2.wasm` `440937` bytes，ABI exports 正常 |
| `npm run build` in `C:\project\damage_web_dev\web` | 通过，Vite 构建引用 wasm asset `440.94 kB` |

补充修正：游戏当前暴击基础倍率已从旧口径 `1.75` 改为 `2.0`；无尽之刃 `crit_damage=0.3` 按加法合入后，总暴击倍率为 `2.3`，不是 `2.05`。

结论：当前 wasm runtime 已支持本轮装备属性对普攻 DPS 的核心影响：AD、攻速、期望暴击、暴击伤害、物理百分比穿透、物理固定穿透。穿透当前只对正抗性生效，顺序为百分比穿透后固定穿透，最低压到 `0`。

### 6.3 前端页面复测

Playwright 页面：

```text
http://127.0.0.1:5173/#/wasm-validation-v2-dps
```

操作：切换 gameId 到 `lol`，加载 V2 DPS 页面，选择 `3031` 无尽之刃 + `3046` 幻影之舞，点击运行。

页面结果：

| 字段 | 结果 |
| --- | --- |
| caseId | `V2-BatchC-adc-items-001` |
| versionCode | `v2_batch_c_adc_items_002` |
| wasmSha256 | `1e03795de2fd2ee35fdf4a2c924ce4bec3f4687d6fc9ea2be10792f944a88bf3` |
| equipmentSet | `["3031", "3046"]` |
| equipmentStats | `ad=75` / `attack_speed=0.65` / `crit_chance=0.5` / `crit_damage=0.3` / `ms_pct=0.1` |
| attacker 合并后属性 | `ad=135` / `attack_speed=1.308` / `crit_chance=0.5` / `crit_damage=2.3` |
| target | `target_dummy_fighter`，`hp=3000` / `armor=100` / `magic_resist=80` |
| attackCount | `14` |
| 首段 attackIntervalMs | `765` |
| 首段普攻伤害 | `rawDamage=222.75` / `finalDamage=111.375` |
| baseline totalDamage | `1559.25` |
| baseline timeWindowDps | `155.925` |
| passive totalDamage | `2279.25` |
| passive timeWindowDps | `227.925` |
| passive damageByType | `physical=1559.25` / `true=720` |
| passive skillPassiveTriggers | `4` |

截图证据：[V2-BatchC-DPS-page-3031-3046-2026-05-17.png](artifacts/V2-BatchC-DPS-page-3031-3046-2026-05-17.png)

结论：前端已能按 `adc_completed_item` type relation 列出 ADC 成装，把选中装备的 `statModifiers` 汇总进 `equipmentStats`，并把 `equipmentSet/equipmentStats` 同步写入 `selection`、`resolvedSnapshot`、`runInput` 和 wasm 输出证据。`3031+3046` 的 AD、攻速、暴击、暴击伤害已实际影响页面 DPS 曲线；页面快照已证明暴击基础倍率修正为 `2.0` 后，合并属性为 `crit_damage=2.3`。

### 6.4 游戏内人工证据：护甲 100 与暴击倍率修正

用户补充截图与手工读数，OCR 输出路径为 [vayne_ocr_20260517.json](</c:/project/ocr_tools/out/vayne_ocr_20260517.json>)，浮动伤害数字以人工读数为准。

| 场景 | 游戏内读数 | 公式对齐 |
| --- | --- | --- |
| 薇恩 1 级无装备，目标护甲 `100` | 普攻伤害 `30` | `60 * 100 / (100 + 100) = 30` |
| `3031+3046`，未暴击 | `67~68` | `135 * 100 / 200 = 67.5` |
| `3031+3046`，暴击 | `155` | `135 * 2.3 * 100 / 200 = 155.25` |
| `3033`，未暴击 | `55` | `95 * 100 / (100 + 70) = 55.882`，游戏面板/浮字存在取整展示 |
| `3033`，暴击 | `112` | `95 * 2.0 * 100 / (100 + 70) = 111.765` |

结论：人工证据支持三个口径：当前基础暴击倍率为 `2.0`；无尽之刃额外 `0.3` 暴击伤害按倍率加法合入；百分比护甲穿透在正护甲上先把 `100` 护甲折为 `70` 后再结算减伤。

### 6.5 本次修正复测命令

| 命令 | 结果 |
| --- | --- |
| `go test ./...` in `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2` | 通过 |
| `go run ./cmd/bench` in `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2` | 通过，`samples=100 avg_us=195.61 max_us=1037.00` |
| `node .\scripts\smoke-node.mjs` with `TINYGO_WASM_EXEC` | 通过，`tinygo_engine_v2.wasm` `440937` bytes，ABI exports 正常 |
| `mvn -Dtest=KatarinaMvpImportMainTest test` in `C:\project\damage_backend_dev\server\data_manage` | 通过，`Tests run: 7, Failures: 0, Errors: 0, Skipped: 0` |
| `npm run build` in `C:\project\damage_web_dev\web` | 通过，Vite 构建引用 wasm asset `440.94 kB` |
| Playwright `#/wasm-validation-v2-dps` | 通过，当前版本 `v2_batch_c_adc_items_002`，`3031+3046` 输出 `crit_damage=2.3`、首段 `finalDamage=111.375` |
| `node tools/task-governance/cli.mjs rebuild` | 通过，`unassigned_docs: 0` |

## 7. 后续待验证

1. 如果要把 `3033`/`3036` 的穿透页面曲线也做成截图证据，需要再取对应装备组合的 V2 DPS 页面快照。
2. 装备被动、攻击特效、每 N 次攻击触发、海妖/破败/羊刀等真实 item passive 仍未在本轮实现，进入后续 Batch D。
3. 吸血、全能吸血、移速、韧性、魔抗、生命值等已作为装备属性保留在证据中；其中不直接影响“对目标造成 DPS”的属性暂不改动目标 HP 曲线。
4. 暴击当前采用 `critPolicy=expected`，不是 seeded random；涉及 on-crit 分支的后续机制不能只用期望值混过。
