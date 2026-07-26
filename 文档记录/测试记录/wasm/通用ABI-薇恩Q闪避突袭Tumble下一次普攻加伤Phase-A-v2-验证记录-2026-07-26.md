TASK_KEY: wasm-generic-vayne-tumble-next-basic-attack-bonus
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI 薇恩 Q 闪避突袭 Tumble 下一次普攻加伤 Phase-A-v2 验证记录

详细设计：[通用 ABI - 薇恩 Q 闪避突袭（Tumble）下一次普攻加伤 Phase-A-v2 详细设计](../../详细设计/wasm/通用ABI-薇恩Q闪避突袭Tumble下一次普攻加伤Phase-A-v2-详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_vayne|Q|闪避突袭`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki 当前权威：请求 `Template:Data Vayne/Q` → 解析 `Template:Data Vayne/Tumble`；page `1309988` / rev `4015566` / timestamp `2026-05-05T15:55:50Z`；content SHA `5ae387c07aa6c510a9da57df976b6e6ba9d3b52490fa91ce59e1221813fe9dad`；canonical raw `1735`；normalized/generic + pages sibling 为权威。local raw caveat bytes `1733` / SHA `5723bf5ffbc6449f756aa33a8387c40a20039886b3665eddcb11ac1cac5914ca`——**故意不断言**字节等价。**无** DDragon/OCR 真理。边界：`rank5_next_basic_attack_bonus; cast_arm_provider_state; physical_1_15_ad_plus_0_50_ap; mana30_cooldown2000ms; no_dash_ba_reset_invisibility_lifesteal_crit_rng_or_full_tumble`。G8 tags 序：`rank5_next_basic_attack_bonus_within_3s`、`physical_1_15_total_ad_plus_0_50_ap`、`phase_a_excludes_dash_geometry_attack_reset_and_lifesteal`。Rank5：mana30 / CD2000ms；provider-scope 武装 3000ms；下一次 source-owner `basic_attack_hit` 一笔物理 `1.15*totalAD+0.50*AP` 后消费。enrich 既有 Tumble 身份；与 Silver Bolts / Spellblade 兼容。英雄名 `_test.go` 仅为回归/治理证据并排除生产；**无**生产 hero switch。Jhin P / Yunara P 仍 deferred `blocked_runtime`；Aphelios **OOS**；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: vayne-q-tumble-next-basic-attack-bonus-phase-a-v2`；DESIGN_READY v2 `run-d7e5282c-818a-47ae-8126-ff50b5ed7853`；实现/审计已提交）填写。下列验证结果按实现与主会话/Driver 复验记录抄录；**未**在本切片重跑 Backend/Wasm 实现测试。记录日期权威为 **2026-07-26**。**本切片未发明 docs commit**（docs commit pending driver）。

本轮**未**执行 live migration、Admin publish、push、browser E2E、production TinyGo runtime、public ABI、asset 或 Web 变更。本切片**未** rebuild SQLite / **未** `--fix-headers`。**未**要求、亦**未**执行生产 Wasm/Web 资产重建或同步。

| Worktree / 阶段 | Commit / Run | 内容 | 证据地位 |
| --- | --- | --- | --- |
| DESIGN_REVIEW v1 | `run-48281305-6e7f-4783-99cd-61184e0bdcf7` | REVISE；grok-4.5/high/false；runDelta0；无 mutation/truncation；接受 provider scope / listener matchers / AP check-only | 历史审查（已吸收） |
| DESIGN_READY v2 | `run-d7e5282c-818a-47ae-8126-ff50b5ed7853` | READY；grok-4.5/high/false；runDelta0；无 mutation/truncation | **接受门控** |
| Backend owning | `e88e172b9627ee2e98447f576fba3549be8d8153` | seed/JUnit/README；`run-91329062-2c72-47d5-85b2-4e79eca8ee15` delta3/outside0/events1353/truncated0；focused51/51 PASS；首轮全量无关瞬时 KogMaw StackOverflow；隔离 KogMaw10/10 PASS；第二轮 full Maven1101/1101 PASS；seed40100/`54c82b47…`；JUnit33286/`959085a0…`；无 live | 接受（Driver/实现） |
| Wasm exact | `36d5a49c7b7e2eb36d9444fd30a70e6efa927b64` | 仅 `generic_vayne_tumble_next_basic_attack_bonus_test.go`；`run-d97df9f8-9e07-4dc9-970b-73df0a904ebd` delta1/outside0/events1338/truncated0；focused PASS；post-commit full `go test -count=1 ./...` PASS；bench mean111.39us；生产 runtime/ABI/asset/Web 不变 | 接受（Driver/实现） |
| 审计 | `1bb07218ab08e0a6eabe9b999786e5afe9d0636f` | `run-0493e9ef-ccb6-4d1b-8fe1-4d75133ffe10` delta8/outside0/events1249/truncated0；五 check PASS | 接受（Driver） |
| Web / 资产 | 无本机制写入 | **无** Web / 生产 Wasm / public ABI 变更；**未**资产重建/同步；**无** live migration/publish/push | 接受 |

## 2. 验证结果（实现轮与 Driver 抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| Template Tumble / page / rev / timestamp | PASS；1309988 / 4015566 / 2026-05-05T15:55:50Z |
| content SHA / raw | `5ae387c0…1813fe9dad` / 1735 |
| 权威 sidecar | `vayne-q.json`（normalized + pages）；local raw caveat `5723bf5f…`；无等价主张；无 DDragon/OCR 真理 |
| sourceCount | 仍为 12；无新源 |

### 2.2 Backend（Driver / 实现轮）

| 验证 | 结果 |
| --- | --- |
| focused Maven | PASS 51/51（`run-91329062-…`） |
| full Maven | 首轮全量曾遇无关瞬时 KogMaw StackOverflow；隔离 KogMaw10/10 PASS；第二轮 PASS 1101/1101 |
| owning commit | `e88e172b9627ee2e98447f576fba3549be8d8153` |
| run 元数据 | delta3/outside0；events1353；truncated0 |
| seed / JUnit | 40100/`54c82b47…5f6b5154`；33286/`959085a0…df153b72` |
| 合同 | external existing-data/check-only（hero_vayne/ad/ap/mana/Batch-B BA/existing Tumble）；不物化 identity/panel/resource/basic/mount；enrich 既有 tumble；无第二 Q 身份 |
| live seed execution | **未**执行 |

### 2.3 Wasm / Go（Driver / 实现轮）

| 验证 | 结果 |
| --- | --- |
| focused / full Go / bench | PASS；full `go test -count=1 ./...` PASS；bench mean **111.39us**（`run-d97df9f8-…`） |
| exact commit | `36d5a49c7b7e2eb36d9444fd30a70e6efa927b64` |
| run 元数据 | delta1/outside0；events1338；truncated0 |
| exact path / bytes / SHA（commit blob） | `generic_vayne_tumble_next_basic_attack_bonus_test.go`；60827 / `74c6560e…118d65b2f` |
| 英雄名 `_test.go` 地位 | 回归/治理证据 only；排除生产构建；无生产 hero switch |
| 生产 Wasm / Web / 资产重建 | **无** |

### 2.4 Web / 资产 / 发布

| 验证 | 结果 |
| --- | --- |
| 本机制 Web 源码 / 资产写入 / commit | **无** |
| 生产 Wasm / public ABI | **无**变更；**未**资产重建/同步 |
| live migration / Admin publish / push | **未**执行 |
| Playwright / live E2E | **未**执行 |

### 2.5 G8 / Unified / provisional（审计 / Driver）

| 验证 | 结果 |
| --- | --- |
| 五审计 `--check` + exact semantics | PASS（Driver；审计 commit `1bb0721…`；`run-0493e9ef-…` delta8/outside0/events1249/truncated0） |
| G8 governed | `migrated`；三 tags；空 `remainingGap` |
| Unified 254 | sourceCount12；completed110 / actionable0 / blocked_runtime63 / blocked_data3 / OOS72 / regression5 / stale1 |
| coverage | full110 / partial3 / none141 |
| registry 242 | migrated48 / partial5 / blocked120 / OOS69（不变） |
| G8 242 | migrated100 / partial4 / blocked69 / OOS69 |
| provisional | 66 = runtime63 / data3；hero65 / item1；Vayne Q 缺席（剩余 item=`3097|盈能`） |
| distance 家族 | `distance_or_ratio_input` **5**（Vayne Q 离开；非 impl-gap） |
| 报告口径 | 严格 verified completion **110/254=43.3%**；completed+provisional coverage **176/254=69.3%** |
| OOS / 真队列 | `out_of_scope=72` 最终跳过；真剩余队列 **仅 66** = runtime63 + data3 |
| digests | Unified `69832c2a…c018`；Wiki `927d8b5a…26c7`（不变） |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件；总体 Goal 仍活跃 |

### 2.6 设计门控

| 验证 | 结果 |
| --- | --- |
| v1 | REVISE `run-48281305-6e7f-4783-99cd-61184e0bdcf7`（grok-4.5/high/false；runDelta0；无 mutation/truncation；修正已吸收） |
| 有效设计门控 | READY `run-d7e5282c-818a-47ae-8126-ff50b5ed7853`（grok-4.5/high/false；runDelta0；无 mutation/truncation） |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `task_rules.json` JSON / tasks | PASS（tasks=124；unique key；exact 两新 docs） |
| `node tools/task-governance/cli.mjs check` | PASS（invalid_rules/duplicates/missing/invalid_headers/unassigned 均为 0） |
| `node tools/task-governance/cli.mjs tasks` / `docs …` | 只读 SQLite 查询；本切片**未** rebuild，故可能尚未列出本新 task（预期；由主会话 rebuild 后复验） |
| `git diff --check` | PASS；仅四条 allowlist 路径变更 |
| `rebuild` / `--fix-headers` | **未**执行（本切片禁止；driver 将显式 rebuild/check） |
| SQLite | **未**触碰 |
| commit / push | **未**执行；**未**发明 docs commit（pending driver） |

## 4. 已实现边界

已实现：Rank5 cast mana30/CD2000ms；provider-scope `tumble_empowered_attack_ready` 武装 3000ms；下一次 source-owner `basic_attack_hit` 一笔非暴击/不可复制物理 `1.15*totalAD+0.50*AP` 后消费；enrich 既有 Tumble 身份；listener 恰好 hit+source_owner；与 Silver Bolts/Spellblade 兼容；Backend seed + Wasm `_test.go` 证据；external existing-data/check-only 前置。排除（completed-boundary exclusions；**非** remaining blockers）：dash/movement/distance/terrain/geometry、BA reset/windup/cadence、invisibility/R、lifesteal/healing、crit/RNG/miss/dodge/full on-hit、multi-target/structures、other ranks/full Tumble、live migration/publish/E2E/full fidelity。本闭环**恰好是下一次普攻加伤 Phase-A**，**不是**完整 Q。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称 live/Admin/E2E 或 rebuilt Wasm asset；**无** live migration/publish/push/Web/production runtime 或 asset 变更。
