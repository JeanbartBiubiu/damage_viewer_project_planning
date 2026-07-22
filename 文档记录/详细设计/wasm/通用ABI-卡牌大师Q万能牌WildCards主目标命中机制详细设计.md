TASK_KEY: wasm-generic-twisted-fate-wild-cards-primary-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-22

# 通用 ABI - 卡牌大师 Q 万能牌（Wild Cards）主目标命中机制详细设计

关联验证记录：[通用 ABI 卡牌大师 Q 万能牌 Wild Cards 主目标命中机制验证记录](../../测试记录/wasm/通用ABI-卡牌大师Q万能牌WildCards主目标命中机制验证记录-2026-07-22.md)。本任务将精确候选 `hero_skill|hero_twistedfate|Q|万能牌` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称施放延迟/扇形三牌锥形/弹道/几何/碰撞/pass/多目标或完整游戏技能保真。冻结方案：`FROZEN_PLAN_REV twisted-fate-q-wild-cards-primary-hit-phase-a-v2`（DESIGN_REVIEW v2 READY `run-16802cbb-4260-4c94-ae5d-558bc87f9f25`；agent `agent-2cb881b9-d728-408b-af3b-a2cafb514f0a`；strict model；runDelta0；582 parseable；无 truncation/mutation；无 issues。v1 `run-bbf86b5a-17cd-46bb-ab3c-aec082987b65` / agent `agent-1c8201b0-6a9a-4669-aa5e-f2b4b50581f2`：READY，strict model，runDelta0，715 parseable，无 truncation/mutation；三条非阻塞笔记已吸收进 v2）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_twistedfate\|Q\|万能牌` |
| Wiki | 请求 `Template:Data Twisted Fate/Q`，解析为 `Template:Data Twisted Fate/Wild Cards`；pageId `1309741`；revision `3950864`；timestamp `2025-08-31T01:31:17Z`；canonical raw bytes `1237`；SHA256 `9cdd62cc18d41a4bbe1e42ac8202b40a776f7da51c67c6f2fea37f9ed1f0d597`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/twistedfate-q.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 本地 raw 物化为 `1235` bytes / SHA256 `dd26f599619f0597426137b819bdfa36699e48449234a4adeae35dbad7e4dbc4`（换行/物化差异）；**sidecar 拥有 canonical 身份**，raw 仅作存在/非空证明。**不得**表述为源矛盾 |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_primary_target_single_hit; immediate_impact_scaffold; magic_240_plus_0_50_bonus_ad_plus_0_85_ap; no_cast_delay_fan_three_card_cone_projectile_geometry_collision_or_multitarget` |
| Rank-5 active | 100 mana；5000ms cooldown；immediate primary-target scaffold；每次成功施放恰好一笔非暴击/不可复制魔法伤害 `240 + 0.50*(source.attr.ad.resolved-source.attr.ad.base) + 0.85*source.attr.ap.resolved` |
| 数值交叉 | baseAD52 / resolvedAD100 / AP100 → raw349；目标 MR100 → mitigated174.5。t0 / t4999 / t5000：两次命中 + 恰好一次 cooldown skip 且不扣 mana、无伤害；mana333 → final133；目标 HP1000 → final651 |
| governed tags | 集合恰好为 `ability_cost_cooldown`、`active_magic_damage`、`bonus_ad_ratio`、`ap_ratio`、`immediate_impact_scaffold`。G8 保留 override 写入序；Unified 全局以 `localeCompare` 规范 tags，序列化时 `ap_ratio` 可先于 `bonus_ad_ratio`——集合相同，不得误读为两套 tags |
| once-per-pass | Wiki “once per pass” **仅**正当化单次直击主目标；**不是** runtime pass/projectile/collision 保真合同 |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标结算单次魔法伤害。Wiki cast0.25 与 `Effect at cast time end` **被显式排除**，而非建模或近似；**不**伪造 cast-delay phase。不代表真实扇形三牌锥形、弹道飞行、路径几何、碰撞、pass 或完整 Wild Cards 保真。

| 排除（非 remainingGap / 非 blocker） | 说明 |
| --- | --- |
| cast0.25 / Effect at cast time end | 施放延迟与 cast-end 时序 **排除而非近似** |
| fan / three cards / cone / angles / direction | 扇形三牌锥形与方向几何全部排除 |
| projectile / travel / collision / pass | 无弹道、碰撞与 pass 合同；once-per-pass 非 runtime 保真 |
| range1450 / width80 / speed1000 / geometry | 无射程、宽度、速度与几何合同 |
| AOE / multitarget / repeat | 单主目标单次命中 |
| spellshield | 法术护盾排除 |
| ranks 1–4 | 仅 Rank5 |
| W / E / basic / Stacked Deck / on-hit / equipment / loadout | 无其它技能/普攻/被动/装备耦合 |
| live migration / Admin publish / browser E2E / full-game fidelity | 发布与完整保真不在本闭环 |

## 3. 端到端数据流

```text
Wiki twistedfate-q.json (page1309741/rev3950864；canonical SHA 9cdd62cc…)
  → Backend seed（self-contained；provider_hero_twistedfate_q_wild_cards_primary_hit）
    → Web 既有 generic 投影（无本机制 Web 源码变更；无生产 Wasm/ABI/runtime 变更）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 magic damage operation（240+0.50*(ad.resolved-ad.base)+0.85*AP；runtime magic 20221 / 无 20220）
```

| 层 | 合同 |
| --- | --- |
| Backend | 自包含 seed：baseline hp604 / mana333 / ad52 / ap0 / AS0.625 / armor24 / MR30 / hpregen1.1 / manaregen1.6；恰好九条属性定义（含 AP）；保留既有 basic / Stacked Deck providers；仅挂载独立 `provider_hero_twistedfate_q_wild_cards_primary_hit`；一条 active ability（cost/cooldown）、null-duration impact + on_enter sequence、一笔魔法 `240+0.50*(source.attr.ad.resolved-source.attr.ad.base)+0.85*source.attr.ap.resolved` operation。幂等 material-change revision guard；**无** DELETE/DDL/auto-publish/live execution。owning `18b959e` / 集成 `a0da4f8`；focused JUnit 20/20；full Maven 705/705 |
| Web | 既有 generic 投影；owning lint/typecheck/Vitest330/build PASS；integrated lint/typecheck/Vitest136/build PASS；**无**本任务 Web 源码变更（零写入）。**不**声称 Web Wasm 资产与当前 build 同步（见 §5 资产现状限制） |
| Wasm | exact `589db93`（`wasm/tinygo_engine_v2/internal/runtime/generic_twisted_fate_wild_cards_primary_hit_test.go`）；真实 CompileGeneric / RunGeneric；focused 4/4 与 full `go test -count=1 ./...` PASS；bench100 PASS；TinyGo build PASS（1,168,476 bytes；SHA `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`）；Node canonical compile/run/release smoke PASS。**无**生产 Wasm/ABI/runtime 变更 |

## 4. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW v2 READY | agent `agent-2cb881b9-d728-408b-af3b-a2cafb514f0a`；run `run-16802cbb-4260-4c94-ae5d-558bc87f9f25`；strict model；runDelta0；582 parseable；无 truncation/mutation；无 issues |
| DESIGN_REVIEW v1 | agent `agent-1c8201b0-6a9a-4669-aa5e-f2b4b50581f2`；run `run-bbf86b5a-17cd-46bb-ab3c-aec082987b65`；READY；strict model；runDelta0；715 parseable；无 truncation/mutation；三条非阻塞笔记已吸收进 v2 |
| Backend owning | `18b959e`；实现 run `run-66075a3a-2320-4863-a74f-fb9fafdf8070`（agent `agent-3e8d3bfc-5cbf-401f-92c8-d9723be49ef1`；runDelta3/outside0；784 parseable/无 truncation） |
| Backend 集成 | `a0da4f8` |
| Wasm exact | `589db93`；实现 run `run-36abdca4-a9ae-4e59-a160-ee207c80d307`（agent `agent-6b408df5-2d3d-4829-b8a0-e343c22eabca`；runDelta1/outside0；800 parseable/无 truncation） |
| 审计 commit | `906951f`；实现 run `run-b053aa53-4c8d-49eb-96df-2ba72e274910`（agent `agent-5a633c14-fe06-45a7-af0e-fced8db5300c`；runDelta6/outside0；1233 parseable/无 truncation） |
| 最终清单 | G8 242 = migrated58 / partial4 / blocked111 / OOS69；Unified sourceCount12 / total254；completed68 / partial_actionable0 / ready0 / blocked_runtime105 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full68 / partial3 / none183；actionable0；`implementation_gap_no_unresolved_data_fields=87` |

## 5. 审计 override、语义比较与资产现状限制

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（集合 `ability_cost_cooldown|active_magic_damage|bonus_ad_ratio|ap_ratio|immediate_impact_scaffold`）、空 `remainingGap`。raw upstream `classification` / `mechanismTags` / `auditBaseline`（含历史 `needs_manual_baseline` / `blocked_data` provenance）按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。exact audit override **必须**清掉 governed generic 陈旧状态。Unified 行：`completed/full/generic_runtime`；空 `blocker`；`dataGapEvidence` / `runtimeGapEvidence` / `outOfScopeEvidence` 均为 null。

主会话语义比较：ordered keys 不变；全部 241 条非 Twisted Fate Q G8 行与全部 253 条非 Twisted Fate Q Unified 行作为解析对象字节等价；**仅** Twisted Fate Q governed disposition/evidence / 解析对象变化。Registry / Batch-G / G8 / Unified checks PASS。

**Web Wasm 资产现状限制（非 Twisted Fate Q 机制 blocker）**：冻结 Twisted Fate Q 计划零生产 Wasm/Web 写入，故未扩大亦未同步既有漂移。当前 build size `1,168,476` SHA256 `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`；owning Web asset size `1,155,992` SHA256 `6A5250835639AD9A1E70F1A9B2A5811F14E307717779FE89A1A3A46B96A4917A`；Wasm integrated Web asset size `1,101,630` SHA256 `2CE1A0DAF10D193567663F28CD2ACD7941EA62EBF4284C307D5C5CC91C0B0BBF`。记录为独立 artifact-currentness 限制，**不得**误读为 Twisted Fate Q 机制未闭环；**不得**在本切片同步资产。

非目标（再次强调）：cast0.25/`Effect at cast time end`、fan/three cards/cone/angles/direction、projectile/travel/collision/pass、range1450/width80/speed1000/geometry、AOE/multitarget/repeat、spellshield、ranks1–4、W/E/basic/Stacked Deck/on-hit/equipment/loadout、live migration/Admin publish/browser E2E/full-game fidelity。不得误称排除行为已实现或完整 Wild Cards/游戏技能保真。

## 6. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1309741 / rev3950864 / timestamp2025-08-31T01:31:17Z / canonical raw1237 / SHA256 `9cdd62cc…d597`；sidecar 拥有 canonical；local raw1235 caveat 非源矛盾 |
| 边界 | exact `completedBoundary` 字符串；once-per-pass 仅正当化单次直击 |
| 公式 / fixtures | Rank5 100 mana / 5000ms；raw349 / mitigated174.5；t0/t4999/t5000 两命中 + 一 CD skip；mana333→133；HP1000→651 |
| Backend | owning `18b959e` / 集成 `a0da4f8`；focused20/20；full705/705 |
| Wasm | exact `589db93`；focused4/4；full Go / bench100 / TinyGo / Node smoke PASS；产物字节/SHA 不变 |
| 审计 | commit `906951f`；G8 migrated + 空 remainingGap；Unified completed/full + 空 blocker/gap evidence null；counts 与 §4 最终清单一致 |
| Web | 无本机制源码写入；资产漂移仅记录 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity |
