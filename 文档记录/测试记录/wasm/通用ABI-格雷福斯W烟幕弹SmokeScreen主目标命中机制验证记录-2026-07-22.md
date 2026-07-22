TASK_KEY: wasm-generic-graves-smoke-screen-primary-hit
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: pass
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-22

# 通用 ABI 格雷福斯 W 烟幕弹 Smoke Screen 主目标命中机制验证记录

详细设计：[通用 ABI - 格雷福斯 W 烟幕弹（Smoke Screen）主目标命中机制详细设计](../../详细设计/wasm/通用ABI-格雷福斯W烟幕弹SmokeScreen主目标命中机制详细设计.md)。

## 1. 范围与证据边界

已闭环候选 `hero_skill|hero_graves|W|烟幕弹`：`completed/full/generic_runtime`（G8 governed `migrated`）。Wiki：请求 `Template:Data Graves/W`，解析 `Template:Data Graves/Smoke Screen`；page `1307368` / rev `3956197` / timestamp `2025-09-26T13:12:00Z`；canonical raw bytes `2441`；SHA256 `20348473fe3441eb32ab656423f577a62a415fadf33fbdc6fcf576bc8b1d210d`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/graves-w.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源）。本地 raw 亦为 `2441` bytes / SHA256 `fa0bf66135a20fc34e704f2ba4fb12e7e811656dee28f03d1c44b101f35246b2`（CRLF `0`）；sidecar/pages 拥有 canonical 身份；raw 仅存在/非空与 governed 字段子串核对，**故意不断言** local raw hash 相等——**same-length materialization caveat**，**不是**源矛盾。边界：`rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_60_ap; no_cast_delay_projectile_geometry_aoe_slow_smoke_cloud_nearsight_or_sight_reduction`。合同：Rank5 active 90 mana / 18000ms CD；immediate primary-target scaffold（Wiki cast0.25 与 `Effect at cast time end` **显式排除**而非近似）；恰好一笔非暴击/不可复制魔法 `260 + 0.60*source.attr.ap.resolved`。交叉：AP200 → raw380；MR100 → mitigated190；t0/t17999/t18000 两次命中 + 恰好一次 cooldown skip 且无 mana/伤害；mana325 → final145；目标 HP1000 → final620。governed tags 仅 `ability_cost_cooldown`、`active_magic_damage`、`ap_ratio`、`immediate_impact_scaffold`。旧 G8 `out_of_scope_for_single_target_dps` / `meta_or_non_target_dps` / `blocked_data` 为历史 provenance；当前 Wiki `gapKind=none` + 已实现单主目标伤害切片允许 `migrated`/`completed`。**不**宣称施放延迟/弹道/几何/AOE/减速/烟幕云/致盲/视野削减或完整 Smoke Screen/游戏保真；**未**声称总体 Goal 完成。

本文件由 **Cursor 文档/治理切片**（`FROZEN_PLAN_REV: graves-w-smoke-screen-primary-hit-phase-a-v2`；DESIGN_REVIEW v2 READY `run-1fee8ffb-73ea-4cbe-bf60-967db51f6db9`，strict `grok-4.5`，effort high，fast false，runDelta0，1856 parseable，无 truncation/mutation；v1 `run-4ab63cc3-f16c-46a8-a449-c9e854a25487`；运行时/审计已提交）创建。下列验证结果按实现与驱动复验记录抄录；**未**在本切片重跑实现测试。记录日期权威为 **2026-07-22**（驱动环境 Asia/Shanghai），即使构建工具打印更晚墙钟时间亦以本日期为准。

本轮**未**执行 live migration、Admin publish、push 或 browser E2E。**无**生产 Wasm/ABI/runtime 变更，**无** Web 源码变更。本切片**未** rebuild SQLite / **未** `--fix-headers`。

| Worktree / 阶段 | Commit / Run | 内容 |
| --- | --- | --- |
| DESIGN_REVIEW v2 | `run-1fee8ffb-73ea-4cbe-bf60-967db51f6db9` | READY；strict `grok-4.5`；effort high；fast false；runDelta0；1856 parseable |
| DESIGN_REVIEW v1 | `run-4ab63cc3-f16c-46a8-a449-c9e854a25487` | 审查输入；结论吸收进 v2 |
| Backend owning | `1238c53`；`run-12e7ea71-f4a4-4001-a8f4-cc46cd1aa24f` | seed + focused 30/30；full 714/714；delta3/outside0 |
| Backend → Wasm 集成 | `037bae3` | Backend 合入 Wasm 分支 |
| README 冲突机械决议 | `run-683c21d2-410f-4c6d-97e4-0a817fd486bf` | delta1/runDeltaOutside0；仅保留 W 节；无 Kayle/Graves P/E README 机会性同步 |
| Wasm exact | `78ab90c`；`run-9ab936a2-40bb-4c9f-8975-95bada64cd89` | `generic_graves_smoke_screen_primary_hit_test.go`；CompileGeneric→RunGeneric；focused 4/4；delta1/outside0 |
| 审计 commit | `6e94e7a`；`run-ab1d2982-9994-415c-b7eb-62399aef4d48` | G8/Unified/registry/Batch-G；delta6/outside0；1182 parseable；ordered keys 不变，仅 Graves W 解析对象变化 |
| Web | 无本机制源码变更 | owning/integrated 验证 PASS；资产现状见 §2.4 |

## 2. 验证结果（实现轮抄录）

### 2.1 Wiki 身份

| 验证 | 结果 |
| --- | --- |
| request / resolved template / page / rev / timestamp / canonical bytes / SHA | PASS；`Template:Data Graves/W` → `Template:Data Graves/Smoke Screen` / 1307368 / 3956197 / 2025-09-26T13:12:00Z / 2441 / `20348473…1d210d` |
| sidecar | `数据参考/lol-wiki-current-champions/normalized/generic/graves-w.json` |
| local raw caveat | 2441 / `fa0bf661…5246b2`（CRLF0；same-length materialization）；sidecar/pages canonical；非源矛盾；故意不断言 local raw hash 相等 |
| sourceCount | 仍为 12（9 active + 3 generators）；无新源 |
| only-one-row invariant | G8/Unified 对该 candidateKey 仅一行；ordered keys 不变 |

### 2.2 Wasm / Go

| 验证 | 结果 |
| --- | --- |
| focused `generic_graves_smoke_screen_primary_hit_test.go` | PASS（4/4） |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS（generic 100 samples） |
| TinyGo / Wasm build | PASS；产物 1,168,476 bytes；SHA `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`（相对既有 build **未变**） |
| Node canonical compile/run/release smoke | PASS |
| 生产 Wasm/ABI/runtime 变更 | 无 |
| runtime 伤害类型 | magic `20221`；无 physical `20220` |

### 2.3 Backend

| 验证 | 结果 |
| --- | --- |
| owning focused JUnit | PASS（30/30） |
| owning full `mvn test` | PASS（714/714） |
| integrated | PASS（合入 `037bae3`） |
| seed 合同 | 自包含；baseline hp625/mana325/ad66/ap0/AS0.475/armor33/MR30/hpregen8/manaregen8；恰好九条属性（含 AP）；保留 P New Destiny / E Quickdraw；独立 `provider_hero_graves_w_smoke_screen_primary_hit`；幂等 revision guard；无 DELETE/DDL/auto-publish/live execution |

### 2.4 Web

| 验证 | 结果 |
| --- | --- |
| owning lint / typecheck / Vitest / build | PASS；Vitest 330 |
| integrated lint / typecheck / Vitest / build | PASS；Vitest 136 |
| 本机制 Web 源码变更 | 无（零写入） |
| Web Wasm 资产现状（独立限制，非机制 blocker） | 当前 build size `1,168,476` SHA256 `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`；owning Web asset size `1,155,992` SHA256 `6A5250835639AD9A1E70F1A9B2A5811F14E307717779FE89A1A3A46B96A4917A`；Wasm integrated Web asset size `1,101,630` SHA256 `2CE1A0DAF10D193567663F28CD2ACD7941EA62EBF4284C307D5C5CC91C0B0BBF`；冻结计划零生产 Wasm/Web 写入，漂移未扩大亦未同步；报告为既有 artifact-currentness drift |

### 2.5 G8 / Unified

| 验证 | 结果 |
| --- | --- |
| G8 / Unified / registry / Batch-G checks | PASS；ordered keys 不变；241 非 Graves W G8 与 253 非 Graves W Unified 解析对象字节等价；仅 Graves W governed disposition/evidence 变化 |
| G8 governed 最终字段 | `genericClassification=migrated`；exact 四 tags（集合同上）；空 `remainingGap`；raw upstream `classification`/`mechanismTags`/`auditBaseline`（含 `meta_or_non_target_dps`/`blocked_data`）为历史 provenance |
| Unified 254 | sourceCount 12；completed 69 / partial_actionable 0 / ready_to_implement 0 / blocked_runtime 104 / blocked_data 3 / out_of_scope 72 / regression_only 5 / stale_or_duplicate 1 |
| coverage | full 69 / partial 3 / none 182 |
| actionable | 0 |
| G8 242 | migrated 59 / partial 4 / blocked 110 / OOS 69 |
| `implementation_gap_no_unresolved_data_fields` | 86 |
| `actionableKeyCount=0` | 当前事实；**不是**停工条件 |

### 2.6 审计切片

| 验证 | 结果 |
| --- | --- |
| 审计 commit | `6e94e7a` |
| 审计 run | `run-ab1d2982-9994-415c-b7eb-62399aef4d48`；delta6 / outside0；1182 parseable；无 truncation |
| live migration / Admin publish / push / browser E2E | 未执行 |

## 3. 本 Cursor 切片执行的治理命令

| 验证 | 结果 |
| --- | --- |
| `node tools/task-governance/cli.mjs check` | PASS（tasks=82；只读；**未** rebuild SQLite；**未** `--fix-headers`） |
| `git diff --check` | PASS |
| `node tools/agent-governance/cli.mjs check`（只读；如触发） | 既有 peer drift 若存在则仅报告；**不** sync |

## 4. 已实现边界

已实现：Rank-5 active cost/cooldown；immediate primary-target impact scaffold（cast0.25 / `Effect at cast time end` **排除**）；单次非暴击/不可复制魔法 `260+0.60*AP`；CD/mana/HP 探针（t0/t18000 命中，t17999 阻挡；mana325→145；HP1000→620）。排除（completed-boundary exclusions；**非** remaining data/runtime blockers；**非**已建模近似）：cast0.25/`Effect at cast time end`、target-location/projectile/travel/collision/range/radius/speed/geometry、AOE/multitarget、slow、smoke cloud/field、periodic nearsight/sight-radius reduction、spellshield、ranks1–4、P/E/basic/ammo/reload/True Grit/bonus resistance/on-hit/equipment/loadout、live/E2E/full-game/full-skill fidelity。`actionableKeyCount=0` **不是**停工条件；**未**声称总体 Goal 完成；**未**声称排除行为已实现或完整 Smoke Screen 保真。
