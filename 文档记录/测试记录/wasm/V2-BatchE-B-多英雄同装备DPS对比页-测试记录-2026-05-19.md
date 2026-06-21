TASK_KEY: planning-validation-milestones
DOC_TYPE: 测试记录
WORKSTREAM: planning
STATUS: active
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-05-19

# V2 Batch E-B 多英雄同装备 DPS 对比页测试记录 2026-05-19

关联概要：[验证里程碑V2.md](../../概要设计/验证里程碑V2.md)

关联详细设计：[V2-单攻击方DPS协议与开发计划.md](../../详细设计/最小验证/V2-单攻击方DPS协议与开发计划.md)

## 1. 本轮范围

本轮补齐 Batch E 的页面 B：多英雄同装备 DPS 对比页。

已完成：
1. 新增独立入口 `#/wasm-validation-v2-dps-multi-hero`，导航文案为 `V2 DPS 多英雄`。
2. 页面 B 复用既有 `published bundle -> tinygoV2DpsAdapter -> TinyGoV2Bridge -> single_attacker_dps` 链路。
3. 全局配置包含 target actor、durationMs、attackSpeedCap=3.0、critPolicy=expected、装备多选、符文/属性调整和可选全局场景预设。
4. 每行英雄独立配置包含英雄、英雄等级、P/Q/W/E/R 技能等级、启用技能被动。
5. 页面 A `#/wasm-validation-v2-dps` 保留并回归。

未做：
1. 未新增后端 DB、seed 或发布链。
2. 未修改 wasm runtime 或 TinyGo ABI。
3. 未把新英雄数值写成游戏人工验收通过；本记录只证明开发侧页面和 wasm 链路通过。

## 2. 实现摘要

Web 改动文件：

| 文件 | 变更 |
| --- | --- |
| `C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.ts` | 在不破坏页面 A 的前提下支持 per-curve `attackerHeroId` 和 Batch E-B caseId；新增页面 B 默认 selection、默认多英雄行和用户可读 label。 |
| `C:\project\damage_web_dev\web\src\pages\WasmValidationV2DpsPage.tsx` | 将 V2 DPS 页面抽成 singleHero / multiHero workbench；页面 B 使用全局装备/符文/目标/规则，每行只配置英雄、等级、技能和技能被动；复用图表、汇总、active curve、触发明细和导出 JSON。 |
| `C:\project\damage_web_dev\web\src\App.tsx` | 新增 `wasm-validation-v2-dps-multi-hero` 路由。 |
| `C:\project\damage_web_dev\web\src\config\navigation.ts` | 新增 `V2 DPS 多英雄` 导航项。 |
| `C:\project\damage_web_dev\web\src\index.css` | 增加页面 B 全局配置行的间距样式。 |

默认配置：

| 字段 | 值 |
| --- | --- |
| target | `target_dummy_fighter` |
| durationMs | `10000` |
| attackSpeedCap | `3` |
| critPolicy | `expected` |
| equipmentSet | `3153, 6672, 3124` |
| 默认英雄行 | `hero_vayne`, `hero_teemo`, `hero_kogmaw`；bundle 缺失时跳过 |

## 3. 构建验证

命令：

```powershell
cd C:\project\damage_web_dev\web
npm run build
```

结果：通过。

关键输出：

| 项 | 结果 |
| --- | --- |
| TypeScript | 通过 |
| Vite build | 通过 |
| wasm asset | `assets/tinygo_engine_v2-DUJcB86Z.wasm` / `442.78 kB` |
| 已知 warning | 保留既有 Vite large chunk warning，不作为本轮阻塞 |

## 4. Playwright 页面 B 验证

入口：

```text
http://127.0.0.1:5173/#/wasm-validation-v2-dps-multi-hero
```

操作：
1. 打开用户已启动的前端。
2. 在总览页切换 game 到 `lol`。
3. 进入 `#/wasm-validation-v2-dps-multi-hero`。
4. 使用默认 3 个英雄行和全局装备运行。
5. 验证累计伤害图 canvas 非空。
6. 切换到目标 HP 图，验证 canvas 非空。
7. 验证导出 JSON 的 curve 数量、labels、statuses、equipmentSet 和 evidence 字段。
8. 点击 `添加英雄行`，验证行数从 3 变为 4；连续删除到 1 行，验证最后一行删除按钮禁用。

页面 B 运行结果：

| 项 | 结果 |
| --- | --- |
| gameId | `lol` |
| versionCode | `v2_batch_d_item_passives_002` |
| caseId | `V2-BatchE-B-multi-hero-same-equipment-001` |
| curveCount | `3` |
| labels | `薇恩 / 破败王者之刃 + 海妖杀手 + 鬼索的狂暴之刃`; `提莫 / 破败王者之刃 + 海妖杀手 + 鬼索的狂暴之刃`; `克格莫 / 破败王者之刃 + 海妖杀手 + 鬼索的狂暴之刃` |
| statuses | `ok, ok, ok` |
| blockedReasons | 均为空；本轮默认数据没有 blocked curve |
| equipmentSet | 3 条 curve 均为 `3153,6672,3124` |
| export `selection.equipmentSet` | `["3153","6672","3124"]` |
| 导出字段完整性 | 每条 curve 均包含 `damageTimeline`、`targetHpTimeline`、`damageByType`、`damageBySource`、`skillPassiveTriggers`、`itemPassiveTriggers`、`effectBreakdown` |

图表验证：

| 图 | canvas | 非透明像素 |
| --- | --- | --- |
| 累计伤害 | `848 x 360` | `20636` |
| 目标 HP | `848 x 360` | `20489` |

增删行验证：

| 操作 | 结果 |
| --- | --- |
| 默认行数 | `3` |
| 点击 `添加英雄行` | 行数变为 `4` |
| 删除到最后一行 | 行数为 `1`，删除按钮 `disabled=true` |

Playwright console 非阻塞项：
1. `favicon.ico` 404。
2. 切换到 `lol` 前默认 IT game 的 current version 404。
3. canvas 像素读取产生的浏览器性能 warning。

## 5. 页面 A 回归

入口：

```text
http://127.0.0.1:5173/#/wasm-validation-v2-dps
```

回归结果：

| 项 | 结果 |
| --- | --- |
| 标题 | `V2 DPS 单英雄多曲线` |
| caseId | `V2-BatchE-1-single-hero-multicurve-001` |
| 默认 curveCount | `4` |
| labels | `无装备`; `破败王者之刃`; `破败王者之刃 + 海妖杀手`; `破败王者之刃 + 海妖杀手 + 鬼索的狂暴之刃` |
| statuses | `ok, ok, ok, ok` |
| 导出 JSON | 可用 |
| 折叠/编辑入口 | 默认仍为折叠行，保留 `编辑配置` |

结论：页面 A 未因页面 B 改造而回退。

## 6. 导出 JSON 复核

页面 B 导出 JSON 包含：
1. `selection`：全局 target、duration、attackSpeedCap、critPolicy、equipmentSet，以及每条 curve 的 `heroId`、`heroLevel`、`skillLevels`、`equipmentSet`、`enabledPassiveEffects`、`scenarioStates`。
2. `resolvedSnapshot`：全局 targetSnapshot 和每条 curve 的 attacker/equipment/passive/scenario/rune 投影。
3. `simulationRules`：`durationMs=10000`、`attackSpeedCap=3`、`critPolicy=expected` 等规则。
4. `targetSnapshot`：`target_dummy_fighter`。
5. `wasmOutput`：完整 `curveResults`，每条 curve 均保留 timeline、伤害构成、触发明细和 effect breakdown。

页面显示值与导出值均来自同一份 `preparedInput` / `wasmOutput` 状态；修改 selection 后会清空旧导出，避免展示与导出不一致。

## 7. 结论与残余边界

结论：V2 Batch E-B 页面 B 通过开发侧自动化验证；页面 A 回归通过。按 Batch E 整体口径，页面 A+B 现在都有开发侧自动化证据。

残余边界：
1. 本轮没有新增游戏人工基线截图，不能把提莫、克格莫等新英雄数值声明为最终人工验收通过。
2. 当前默认 B 运行没有 blocked curve；blocked 展示路径由汇总表 `Blocked Reasons` 列保留，并沿用 wasm 对缺失 passive/equipment/effect 的 blocked 输出。
3. 当前后端 current version 仍为 `v2_batch_d_item_passives_002`；本轮页面验证只证明现有 published bundle 下的链路和页面行为。

## 8. 主会话复测

2026-05-19 追加主会话复测，验证页面 B 和页面 A 回归。

命令：

```powershell
cd C:\project\damage_web_dev\web
npm run build

cd C:\project\damage_wasm_dev
node tools/task-governance/cli.mjs rebuild

cd C:\project\damage_web_dev\web
npx --package @playwright/cli playwright-cli open http://127.0.0.1:5173/#/overview
npx --package @playwright/cli playwright-cli run-code --filename output\playwright\v2-batch-eb-full-test.js
```

环境：

| 项 | 结果 |
| --- | --- |
| 前端 | `http://127.0.0.1:5173` |
| 后端 current version | `v2_batch_d_item_passives_002` |
| `npm run build` | 通过；保留既有 Vite large chunk warning |
| `node tools/task-governance/cli.mjs rebuild` | 通过；`unassigned_docs: 0` |

页面 B 复测结果：

| 项 | 结果 |
| --- | --- |
| 标题 | `V2 DPS 多英雄同装备` |
| 默认行数 | `3` |
| 默认折叠状态 | `.v2-dps-curve-editor input` 数量为 `0` |
| caseId | `V2-BatchE-B-multi-hero-same-equipment-001` |
| versionCode | `v2_batch_d_item_passives_002` |
| labels | `薇恩 / 破败王者之刃 + 海妖杀手 + 鬼索的狂暴之刃`; `提莫 / 破败王者之刃 + 海妖杀手 + 鬼索的狂暴之刃`; `克格莫 / 破败王者之刃 + 海妖杀手 + 鬼索的狂暴之刃` |
| heroIds | `hero_vayne`, `hero_teemo`, `hero_kogmaw` |
| resolvedHeroIds | `hero_vayne`, `hero_teemo`, `hero_kogmaw` |
| equipmentSet | 3 条 curve 均为 `3153,6672,3124` |
| allSameEquipment | `true` |
| statuses | `ok, ok, ok` |
| blockedReasons | `[], [], []` |
| totalDamage | `3000`, `2864.40192425308`, `2999.9999999999995` |
| 导出字段完整性 | 每条 curve 均包含 `damageTimeline`、`targetHpTimeline`、`damageByType`、`damageBySource`、`skillPassiveTriggers`、`itemPassiveTriggers`、`effectBreakdown` |
| 累计伤害图 | `848 x 360`，`nonEmptyPixels=20636` |
| 目标 HP 图 | `848 x 360`，`nonEmptyPixels=20489` |
| 增删英雄行 | `3 -> 4 -> 1`，最后一行删除按钮禁用 |

页面 A 回归：

| 项 | 结果 |
| --- | --- |
| 标题 | `V2 DPS 单英雄多曲线` |
| caseId | `V2-BatchE-1-single-hero-multicurve-001` |
| curveCount | `4` |
| labels | `无装备`; `破败王者之刃`; `破败王者之刃 + 海妖杀手`; `破败王者之刃 + 海妖杀手 + 鬼索的狂暴之刃` |
| statuses | `ok, ok, ok, ok` |
| 截图 | `C:\project\damage_web_dev\web\output\playwright\v2-batch-eb-full-test-page-a-after-run.png` |

Playwright console 非阻塞项：

1. `favicon.ico` 404。
2. 切换到 `lol` 前默认 IT game 的 current version 404。
3. canvas 像素读取产生的浏览器性能 warning。
