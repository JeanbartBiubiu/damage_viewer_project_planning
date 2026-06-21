TASK_KEY: planning-validation-milestones
DOC_TYPE: 测试记录
WORKSTREAM: planning
STATUS: active
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-05-17

# V2 Batch A 单攻击方 DPS 测试记录 2026-05-17

关联概要：`文档记录/概要设计/验证里程碑V2.md`

关联详细设计：`文档记录/详细设计/最小验证/V2-单攻击方DPS协议与开发计划.md`

## 1. 本轮范围

本轮只验证 V2 Batch A：单攻击方站桩普攻 DPS 骨架、固定 target dummy、published bundle 到前端页面再到 wasm `single_attacker_dps` 的证据链。

不在本轮验收：

1. 英雄技能被动效果、装备属性、装备被动、符文页、预开启状态。
2. 多英雄同装备、多曲线图表、ECharts 正式展示。
3. 游戏客户端真实截图。Batch A 的 target dummy 是项目内固定标靶，不需要游戏内训练营截图作为验收前置。

## 2. 环境

| 项 | 值 |
| --- | --- |
| Wasm worktree | `C:\project\damage_wasm_dev` / `wasm/dev` |
| TinyGo module | `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2` |
| Web worktree | `C:\project\damage_web_dev` / `web/dev` |
| Web dev server | `http://127.0.0.1:5173` |
| Backend worktree | `C:\project\damage_backend_dev` / `backend/dev` |
| Backend API | `http://localhost:8080` |
| 当前游戏 | `lol` |
| 当前发布版本 | `v2_batch_a_target_dummies_001` |

## 3. 自动化命令结果

| 模块 | 命令 | 结果 |
| --- | --- | --- |
| Wasm | `go test ./...` | 通过 |
| Wasm | `go run ./cmd/bench` | 通过，`samples=100 avg_us=262.92 max_us=3504.00` |
| Wasm | `$env:TINYGO_WASM_EXEC='C:\project\damage_wasm_dev\.tools\tinygo0.40.1\tinygo\targets\wasm_exec.js'; node .\scripts\smoke-node.mjs` | 通过，wasm size `400438`，导出包含 `engine_begin_run` / `engine_outbox_*` |
| Web | `npm run build` | 通过；保留既有 Vite chunk size warning |
| Backend | `mvn -Dtest=KatarinaMvpImportMainTest test` | 通过，5 tests |
| Backend | `mvn -Dtest=ControllerPublishFlowIT test` | 构建成功但 13 tests skipped；原因是未设置 `IT_DB_URL` / `IT_DB_USERNAME`，不计入通过证据 |

Wasm 单测覆盖的 Batch A 重点：

1. 普攻时间线、目标死亡停止、击杀时间、护甲减免、overkill clipping。
2. 攻速上限只约束 cadence，`attack_speed=3.5` 在 `attackSpeedCap=3.0` 下产生 `333ms` 间隔。
3. 缺少 published snapshot 字段、非 `target_dummy`、selection target 与 resolved target 不一致时返回 `blocked`。
4. Batch A 不支持的规则会返回 `blocked`，包括 warmup、sample interval、非固定 event window、非 1000ms DoT tick、随机暴击、非 3.0 攻速上限、非 0ms 首刀、非 `basic_attack` 自动普攻等。

## 4. 后端发布数据证据

接口：

```powershell
Invoke-RestMethod -Uri 'http://localhost:8080/api/games/lol/versions/current'
Invoke-RestMethod -Uri 'http://localhost:8080/api/games/lol/versions/v2_batch_a_target_dummies_001/bundle'
```

结果摘要：

| 字段 | 值 |
| --- | --- |
| `current.versionCode` | `v2_batch_a_target_dummies_001` |
| `target_dummy.typeId` | `62001` |
| `target_dummy.description` | `V2 Batch A fixed DPS target actor` |

发布 bundle 内 3 个标靶：

| actor | HP | 护甲 | 魔抗 |
| --- | ---: | ---: | ---: |
| `target_dummy_squishy` | 2000 | 50 | 50 |
| `target_dummy_fighter` | 3000 | 100 | 80 |
| `target_dummy_tank` | 5000 | 200 | 150 |

`typeRelations` 已包含三条 `targetCategory=character` 到上述标靶的挂载，`extend.role=target_dummy`。

## 5. Playwright 页面证据

操作路径：

1. 打开 `http://127.0.0.1:5173/#/overview`。
2. 选择 `lol / lol`。
3. 进入 `http://127.0.0.1:5173/#/wasm-validation-v2-dps`。
4. 点击 `运行`。

页面运行结果：

| 字段 | 值 |
| --- | --- |
| `caseId` | `V2-BatchA-basic-aa-001` |
| `versionCode` | `v2_batch_a_target_dummies_001` |
| `wasmSha256` | `bf9016331a151c33b5638daeccb8c594f01c36b16888b34f1590382ef2905de2` |
| 攻击方 | `hero_vayne / 薇恩` |
| 标靶 | `target_dummy_fighter / Target Dummy Fighter` |
| 标靶 type | `target_dummy` |
| 标靶属性 | HP `3000` / armor `100` / magic_resist `80` |
| `durationMs` | `10000` |
| `attackSpeedCap` | `3.0` |
| `status` | `ok` |
| `stopReason` | `duration_elapsed` |
| `attackCount` | `7` |
| `attackIntervalMs` | `1520` |
| `totalDamage` | `210` |
| `timeWindowDps` | `21` |
| `damageByType` | `{ physical: 210 }` |
| `damageBySource` | `{ basic_attack: 210 }` |
| 首次伤害 | `timeMs=0`，raw physical `60`，final `30`，HP `3000 -> 2970` |
| 最后一次普攻 | `timeMs=9120` |
| 最终 HP | `2790 / 3000` |

证据文件：

1. 页面截图：`文档记录/测试记录/wasm/artifacts/V2-BatchA-DPS-page-2026-05-17.png`
2. 页面导出 JSON：`文档记录/测试记录/wasm/artifacts/V2-BatchA-DPS-export-2026-05-17.json`

说明：Playwright console 内有 3 条 `it_20260516164829_2431` 的 current version 404 和 1 条 favicon 404，来自页面最初默认选中 IT game 的加载过程。切换到 `lol` 后本轮 V2 DPS 运行成功，不作为 Batch A 阻塞。

## 6. 用户补充项

当前 Batch A 不需要用户补充游戏截图或游戏内数据。

后续进入技能被动、装备联动、符文页、预开启状态时，需要另起用例清单，再逐项列出训练营截图和人工字段。例如面板攻击力、攻速、暴击、装备属性、被动触发次数、目标 HP 前后值等；这些不在本轮 Batch A 验收内。

## 7. 结论

开发侧结论：V2 Batch A 通过。

通过依据：

1. Wasm `single_attacker_dps` 自动化测试和 smoke 通过。
2. Web build 通过，V2 DPS 页面能从 published bundle 读取 `lol` 当前版本并运行 wasm。
3. Backend 当前发布版本包含 `target_dummy` type、3 个固定标靶和 type relation。
4. 页面导出 JSON 能证明 `hero_vayne -> target_dummy_fighter` 在 10 秒窗口内产生 7 次普攻、总伤害 210、时间窗 DPS 21。

保留测试缺口：

1. `ControllerPublishFlowIT` 需要 IT DB 环境变量才会真正执行，本轮用线上 API bundle 回读替代其通过证据。
2. 多 curve 同批运行、V2 DPS 专用页面自动化测试、`Session.BeginRunJSON -> done frame` 的专门 ABI 回归仍建议后续补齐。
