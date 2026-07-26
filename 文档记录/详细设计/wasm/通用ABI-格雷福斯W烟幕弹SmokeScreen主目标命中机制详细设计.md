TASK_KEY: wasm-generic-graves-smoke-screen-primary-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-22

# 通用 ABI - 格雷福斯 W 烟幕弹（Smoke Screen）主目标命中机制详细设计

关联验证记录：[通用 ABI 格雷福斯 W 烟幕弹 Smoke Screen 主目标命中机制验证记录](../../测试记录/wasm/通用ABI-格雷福斯W烟幕弹SmokeScreen主目标命中机制验证记录-2026-07-22.md)。本任务将精确候选 `hero_skill|hero_graves|W|烟幕弹` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称施放延迟/弹道/几何/AOE/减速/烟幕云/致盲/视野削减或完整游戏技能保真。冻结方案：`FROZEN_PLAN_REV graves-w-smoke-screen-primary-hit-phase-a-v2`（DESIGN_REVIEW v2 READY `run-1fee8ffb-73ea-4cbe-bf60-967db51f6db9`；strict `grok-4.5`；effort high；fast false；READY；runDelta0；1856 parseable；无 truncation/mutation。v1 `run-4ab63cc3-f16c-46a8-a449-c9e854a25487`：审查输入；结论吸收进 v2）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_graves\|W\|烟幕弹` |
| Wiki | 请求 `Template:Data Graves/W`，解析为 `Template:Data Graves/Smoke Screen`；pageId `1307368`；revision `3956197`；timestamp `2025-09-26T13:12:00Z`；canonical raw bytes `2441`；SHA256 `20348473fe3441eb32ab656423f577a62a415fadf33fbdc6fcf576bc8b1d210d`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/graves-w.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw 亦为 `2441` bytes，但 SHA256 `fa0bf66135a20fc34e704f2ba4fb12e7e811656dee28f03d1c44b101f35246b2`，CRLF `0`。**sidecar/pages 拥有 canonical 身份**；raw 仅作存在/非空与 governed 字段子串核对；**故意不断言** local raw hash 相等。记录为 **same-length materialization caveat**，**不得**表述为源矛盾 |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_primary_target_single_hit; immediate_impact_scaffold; magic_260_plus_0_60_ap; no_cast_delay_projectile_geometry_aoe_slow_smoke_cloud_nearsight_or_sight_reduction` |
| Rank-5 active | 90 mana；18000ms cooldown；immediate primary-target scaffold；每次成功施放恰好一笔非暴击/不可复制魔法伤害 `260 + 0.60*source.attr.ap.resolved` |
| 数值交叉 | AP200 → raw380；目标 MR100 → mitigated190。t0 / t17999 / t18000：两次命中 + 恰好一次 cooldown skip 且不扣 mana、无伤害；mana325 → final145；目标 HP1000 → final620 |
| governed tags | 仅 `ability_cost_cooldown`、`active_magic_damage`、`ap_ratio`、`immediate_impact_scaffold` |
| 历史 provenance | 旧 G8 raw `classification=out_of_scope_for_single_target_dps` / `mechanismTags=meta_or_non_target_dps` / `auditBaseline.gapCode=blocked_data`（以及旧 `remainingGap=blocked_data` 叙事）为 **历史 provenance**，**不是**最终 disposition。当前 Wiki `gapKind=none` 加上已实现的单主目标伤害切片，在显式 `completedBoundary` 下允许 `migrated` / `completed` |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标结算单次魔法伤害。Wiki cast0.25 与 `Effect at cast time end` **被显式排除**，而非建模或近似；**不**伪造 cast-delay phase。不代表真实弹道飞行、落点几何、AOE、减速、烟幕云、周期性致盲或视野半径削减保真。

| 排除（非 remainingGap / 非 blocker；亦非已建模行为的近似） | 说明 |
| --- | --- |
| cast0.25 / Effect at cast time end | 施放延迟与 cast-end 时序 **排除而非近似** |
| target-location / projectile / travel / collision / range / radius / speed / geometry | 无落点、弹道、碰撞与几何合同 |
| AOE / multitarget | 单主目标单次命中 |
| slow | 减速排除 |
| smoke cloud / field | 烟幕云/场地排除 |
| periodic nearsight / sight-radius reduction | 致盲与视野削减排除 |
| spellshield | 法术护盾排除 |
| ranks 1–4 | 仅 Rank5 |
| P / E / basic / ammo / reload / True Grit / bonus resistance / on-hit / equipment / loadout | 无其它技能/普攻/被动/抗性/装备耦合 |
| live migration / Admin publish / browser E2E / full-game / full-skill fidelity | 发布与完整保真不在本闭环 |

## 3. 端到端数据流

```text
Wiki graves-w.json (page1307368/rev3956197；canonical SHA 20348473…)
  → Backend seed（self-contained；provider_hero_graves_w_smoke_screen_primary_hit）
    → Web 既有 generic 投影（无本机制 Web 源码变更；无生产 Wasm/ABI/runtime 变更）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 magic damage operation（260+0.60*AP；runtime magic 20221 / 无 20220）
```

| 层 | 合同 |
| --- | --- |
| Backend | 自包含 seed：baseline hp625 / mana325 / ad66 / ap0 / AS0.475 / armor33 / MR30 / hpregen8 / manaregen8；恰好九条属性定义（含 AP）；保留既有 New Destiny（P）/ Quickdraw（E）providers；仅挂载独立 `provider_hero_graves_w_smoke_screen_primary_hit`；一条 active ability（cost/cooldown）、null-duration impact + on_enter sequence、一笔魔法 `260+0.60*source.attr.ap.resolved` operation。幂等 material-change revision guard；**无** DELETE/DDL/auto-publish/live execution。owning `1238c53` / Wasm 集成 `037bae3`；focused JUnit 30/30；full Maven 714/714 |
| Web | 既有 generic 投影；owning lint/typecheck/Vitest330/build PASS；integrated lint/typecheck/Vitest136/build PASS；**无**本任务 Web 源码变更（零写入）。**不**声称 Web Wasm 资产与当前 build 同步（见 §5 资产现状限制） |
| Wasm | exact `78ab90c`（`wasm/tinygo_engine_v2/internal/runtime/generic_graves_smoke_screen_primary_hit_test.go`）；真实 CompileGeneric / RunGeneric；focused 4/4 与 full `go test -count=1 ./...` PASS；generic bench100 PASS；TinyGo build PASS（1,168,476 bytes；SHA `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`）；Node canonical compile/run/release smoke PASS。**无**生产 Wasm/ABI/runtime 变更 |

## 4. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW v2 READY | run `run-1fee8ffb-73ea-4cbe-bf60-967db51f6db9`；strict `grok-4.5`；effort high；fast false；READY；runDelta0；1856 parseable；无 truncation/mutation |
| DESIGN_REVIEW v1 | run `run-4ab63cc3-f16c-46a8-a449-c9e854a25487`；结论吸收进 v2 |
| Backend owning | `1238c53`；实现 run `run-12e7ea71-f4a4-4001-a8f4-cc46cd1aa24f`（delta3/outside0）；focused 30/30；full Maven 714/714 |
| Backend → Wasm 集成 | `037bae3` |
| README 冲突机械决议 | run `run-683c21d2-410f-4c6d-97e4-0a817fd486bf`（delta1/runDeltaOutside0）：仅保留 W 节；**无**机会性 Kayle/Graves P/E README 同步 |
| Wasm exact | `78ab90c`；实现 run `run-9ab936a2-40bb-4c9f-8975-95bada64cd89`（delta1/outside0） |
| 审计 commit | `6e94e7a`；实现 run `run-ab1d2982-9994-415c-b7eb-62399aef4d48`（delta6/outside0；1182 parseable/无 truncation） |
| 最终清单 | G8 242 = migrated59 / partial4 / blocked110 / OOS69；Unified sourceCount12 / total254；completed69 / partial_actionable0 / ready0 / blocked_runtime104 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full69 / partial3 / none182；actionable0；`implementation_gap_no_unresolved_data_fields=86` |

## 5. 审计 override、语义比较与资产现状限制

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（仅 `ability_cost_cooldown|active_magic_damage|ap_ratio|immediate_impact_scaffold`）、空 `remainingGap`。raw upstream `classification` / `mechanismTags` / `auditBaseline`（含历史 `out_of_scope_for_single_target_dps` / `meta_or_non_target_dps` / `blocked_data` provenance）按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。exact audit override **必须**清掉 governed generic 陈旧状态。

主会话语义比较：ordered keys 不变；全部 241 条非 Graves W G8 行与全部 253 条非 Graves W Unified 行作为解析对象字节等价；**仅** Graves W governed disposition/evidence / 解析对象变化。Registry / Batch-G / G8 / Unified checks PASS。

**Web Wasm 资产现状限制（非 Graves W 机制 blocker）**：冻结 Graves W 计划零生产 Wasm/Web 写入，故未扩大亦未同步既有漂移。当前 build size `1,168,476` SHA256 `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`；owning Web asset size `1,155,992` SHA256 `6A5250835639AD9A1E70F1A9B2A5811F14E307717779FE89A1A3A46B96A4917A`；Wasm integrated Web asset size `1,101,630` SHA256 `2CE1A0DAF10D193567663F28CD2ACD7941EA62EBF4284C307D5C5CC91C0B0BBF`。记录为独立 artifact-currentness 限制，**不得**误读为 Graves W 机制未闭环；**不得**在本切片同步资产。

非目标（再次强调）：cast0.25/`Effect at cast time end`、target-location/projectile/travel/collision/range/radius/speed/geometry、AOE/multitarget、slow、smoke cloud/field、periodic nearsight/sight-radius reduction、spellshield、ranks1–4、P/E/basic/ammo/reload/True Grit/bonus resistance/on-hit/equipment/loadout、live migration/Admin publish/browser E2E/full-game/full-skill fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Smoke Screen/游戏技能保真；**未**声称总体 Goal 完成。

## 6. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1307368 / rev3956197 / timestamp2025-09-26T13:12:00Z / canonical raw2441 / SHA256 `20348473…1d210d`；sidecar/pages canonical；local raw2441 / `fa0bf661…5246b2` same-length caveat 非源矛盾 |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers |
| 公式 / fixtures | Rank5 90 mana / 18000ms；raw380 / mitigated190；t0/t17999/t18000 两命中 + 一 CD skip；mana325→145；HP1000→620 |
| Backend | owning `1238c53` / 集成 `037bae3`；focused30/30；full714/714 |
| Wasm | exact `78ab90c`；focused4/4；full Go / bench100 / TinyGo / Node smoke PASS；产物字节/SHA 不变 |
| 审计 | commit `6e94e7a`；G8 migrated + 空 remainingGap；Unified completed/full + 空 blocker/gap evidence null；counts 与 §4 最终清单一致 |
| Web | 无本机制源码写入；资产漂移仅记录 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成 |
