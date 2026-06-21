TASK_KEY: planning-validation-milestones
DOC_TYPE: 测试记录
WORKSTREAM: planning
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-06-05

# V2 Batch M Wasm 属性读取语义与三相基础 AD 修正测试记录 2026-06-05

关联计划：[V2-BatchM-Wasm属性读取语义与三相基础AD修正计划.md](../../详细设计/最小验证/V2-BatchM-Wasm属性读取语义与三相基础AD修正计划.md)

结论：
1. `M-contract-pass`：DPS passive operation 已支持 `attackerAttrRead`，空值和 `total` 归一为 `resolved`，`base/current/max` 读取 `attributeViews`。
2. `M-wasm-pass`：Wasm 的 `resolved` 读取当前 `state.attrs`，`base/current/max` 读取显式视图；显式视图缺失时 curve blocked，不回退到总值。
3. `M-web-pass`：Web adapter 已投影 `attackerSnapshot.attributeViews`；装备属性只合并进 resolved/current/max，不污染 base。
4. `M-trinity-data-pass`：三相之力咒刃 operation 使用 `attackerAttr=ad`、`attackerAttrRead=base`、`attackerAttrRatio=2`，不是临时 `base_ad` key。
5. `M-live-pass`：live 页面使用 current `v2_batch_m_attr_read_trinity_base_ad_001` 跑通 Trinity Force 曲线；导出 JSON 证明装备 `ad +36` 没进入 `2 * base AD` contribution。

## 1. 改动范围

Wasm：
1. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\model\types.go`
2. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver.go`
3. `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\internal\runtime\dps_driver_test.go`

Web：
1. `C:\project\damage_web_dev\web\src\engine\tinygoV2DpsAdapter.ts`
2. `C:\project\damage_web_dev\web\src\engine\wasm\tinygo_engine_v2.wasm`
3. `C:\project\damage_web_dev\web\src\pages\WasmValidationV2DpsPage.tsx` 保留既有 Batch L/时间线页面改动，本批未回滚。

Backend：
1. `C:\project\damage_backend_dev\最小验证\V2-Batch-M-attr-read-trinity-base-ad.seed.json`
2. `C:\project\damage_backend_dev\最小验证\V2-Batch-M-attr-read-trinity-base-ad-audit.json`

Planning：
1. `C:\project\damage_viewer_project_planning\文档记录\详细设计\最小验证\V2-BatchM-Wasm属性读取语义与三相基础AD修正计划.md`
2. 本测试记录。

## 2. 命令级验证矩阵

以下结果来自本次任务前序开发验证轮；本记录阶段没有重复执行长耗时构建命令。

| Worktree | 命令 | 结果 |
| --- | --- | --- |
| Wasm | `go test ./internal/runtime -run "AttrRead|AttackerAttr|Spellblade|SingleAttackerDPS|Canonical" -count=1` | 通过 |
| Wasm | `go test ./...` | 通过 |
| Wasm | `go run ./cmd/bench` | 通过，`samples=100 avg_us=159.12 max_us=1051.00` |
| Wasm | `powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1` | 通过，wasm artifact `477854` bytes |
| Wasm | `node .\scripts\smoke-node.mjs` | 通过，导出包含 `engine_init`、`engine_begin_run`、`engine_step` 等 ABI |
| Web | `npm run build` | 通过；同步新 wasm 后再次通过，构建 wasm asset `477.85 kB` |
| Backend | Batch M seed dry-run import | 通过，1 skill、1 item，无写入 |
| Backend | Batch M import/publish | 通过，`Published versionCode=v2_batch_m_attr_read_trinity_base_ad_001`，并验证 current + bundle |

## 3. Live API 与发布状态

| 项 | 值 |
| --- | --- |
| 后端 API | `http://localhost:8080` |
| DB host | `192.168.5.5:5432/test0221` |
| gameId | `lol` |
| current version | `v2_batch_m_attr_read_trinity_base_ad_001` |
| 上一版 current | `v2_batch_l_spellblade_next_attack_001` |
| 三相 item | `3078 / Trinity Force` |
| 三相 item stat | `ad=36` 保留 |
| 三相 operation | `damage,trinity_force_spellblade,ad,base,2.0` |

## 4. Playwright 用户流

验证工具：`npx --yes --package @playwright/cli playwright-cli -s=batch-m ...`

流程：
1. 打开 `http://127.0.0.1:5173/#/wasm-validation-v2-dps`。
2. 页面加载 current `v2_batch_m_attr_read_trinity_base_ad_001`。
3. 编辑第一条 curve，选择 `3078 / Trinity Force`。
4. 页面自动选择 scenario state `item_3078_spellblade_ready`，label 为 `Trinity Force / Trinity Force Spellblade DPS passive`。
5. 点击 `运行`，页面 Active Status 为 `ok`。
6. 拦截 `navigator.clipboard.writeText`，点击 `导出 JSON` 并解析导出内容。
7. 打开 `#/wasm-validation-v2-dps-stacking-passive`，点击 `运行`，复核 Batch H/K stacking + phantom-hit 页面断言。

页面证据：

| 项 | 值 |
| --- | --- |
| DPS page wasm hash | `6beb888095b3a3f551f304801a97147f5fbfd86921ed84c5334508793a5f7eae` |
| DPS page active curve | `vayne-no-items`，已选择 Trinity Force |
| DPS page status | `ok` |
| attackCount | `12` |
| totalDamage | `1578.09` |
| damageBySource.trinity_force_spellblade | `80.6210000000001` |
| effectBreakdown length | `6` |
| export JSON length | `619682` chars |

导出 JSON 关键断言全部通过：

| 断言 | 结果 | 证据 |
| --- | --- | --- |
| versionCode 是 Batch M current | pass | `v2_batch_m_attr_read_trinity_base_ad_001` |
| curve status ok | pass | `curveResults[0].status=ok` |
| 装备 AD 保留 | pass | `resolvedSnapshot.equipmentStats.ad=36` |
| resolved AD 包含装备 AD | pass | `attributes.ad=116.621 = 80.621 + 36` |
| base AD 排除装备 AD | pass | `attributeViews.ad.base=80.621` |
| current/max/resolved 包含装备 AD | pass | `attributeViews.ad.current/max/resolved=116.621` |
| 三相 operation 读取 base | pass | `attackerAttr=ad`、`attackerAttrRead=base`、`attackerAttrRatio=2` |
| 三相 effect 读取 base | pass | message 包含 `attackerAttrRead=base attrValue=80.621` |
| contribution 是 2 * base | pass | `contribution=161.242` |
| 护甲后伤害源不按 resolved AD | pass | `damageBySource.trinity_force_spellblade=80.6210000000001`，不是 `116.621` |

对应 effectBreakdown：

```json
{
  "timeMs": 0,
  "source": "trinity_force_spellblade",
  "kind": "damage",
  "amount": 161.242,
  "message": "physical attackerAttr=ad attackerAttrRead=base attrValue=80.621 attackerAttrRatio=2 contribution=161.242"
}
```

## 5. Batch H/K 回归

路线：`http://127.0.0.1:5173/#/wasm-validation-v2-dps-stacking-passive`

| 项 | 值 |
| --- | --- |
| current version | `v2_batch_m_attr_read_trinity_base_ad_001` |
| wasm hash | `6beb888095b3` |
| Stack Applies | pass |
| Cap | pass |
| Expiry | pass |
| Invalid Contract | pass |
| Phantom Hit (3124) | pass |
| Batch K / 3124 Guinsoo status | `ok` |
| Batch K / 3124 Guinsoo attackCount | `15` |
| Batch K / 3124 Guinsoo totalDamage | `1121.84` |
| Batch K damageBySource | `guinsoos_wrath_on_hit:450.00 / skill_lol_basic_attack_default:671.84` |

## 6. 已知风险与后续建议

1. `effectBreakdown` 当前 DTO 仍以 `message` 承载 `attackerAttrRead/attrValue/contribution` 证据，字段没有结构化拆出；当前批次可验收，但后续如果详情图表要做 hover 明细，建议另开小任务把这些证据字段结构化。
2. Web adapter 本批同时扩展了 item scenario state 合流逻辑；本记录已用 Batch H/K 页面回归覆盖 3124 主要风险，但 hero-only scenario 可继续补 adapter 单测。
3. Planning Batch M 计划文档与 Backend Batch M seed/audit 在本轮记录时仍是未跟踪文件；提交前必须纳入版本控制，否则四个 worktree 的同步闭环在 Git 层面不完整。
4. Playwright console 存在 1 条既有非业务错误；本轮未见其影响 V2 DPS 运行、导出或断言。
