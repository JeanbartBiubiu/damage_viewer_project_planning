TASK_KEY: wasm-generic-miss-fortune-bullet-time-max-channel-expected
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI - 厄运小姐 R 弹幕时间（Bullet Time）最大完整引导期望伤害 Phase-A 详细设计

关联验证记录：[通用 ABI 厄运小姐 R 弹幕时间最大完整引导期望伤害 Phase-A 验证记录](../../测试记录/wasm/通用ABI-厄运小姐R弹幕时间最大完整引导期望伤害Phase-A验证记录-2026-07-26.md)。本任务将精确候选 `hero_skill|hero_missfortune|R|弹幕时间` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `deterministic_random_crit_sequence`（历史 G8 baseline 亦见 `seeded_random_crit_sequence`）。**仅** Rank-3 最大完整引导单主目标聚合期望物理伤害 Phase-A；**不**宣称完整 Bullet Time / 完整 R / 完整游戏保真。明确排除 channel timing/tick schedule/interruption/cancel、direction/cone/六弹每波/collision/geometry、multitarget/wave-by-wave snapshot/dynamic stats、sight/reveal/spellshield、RNG-on-crit/basic attack、Wiki IE crit ratio 30、other ranks/siblings/loadout/bootstrap/live。Wiki `{{critical damage|130|30}}` = base130 **加** IE ratio（当前适用时 +9%）；Phase-A **实现** formula-local base130 期望因子并**故意排除** IE ratio——**永不**声称 Wiki 省略 IE。Wiki max-total 表为非暴击对照。Jhin P / Yunara P 仍为用户推迟的 `blocked_runtime`，**不是** `out_of_scope`。Aphelios **OOS**。**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV miss-fortune-r-bullet-time-max-channel-expected-phase-a-v3`（DESIGN_READY `run-35c777c6-66cd-4dc0-8901-39aae01602fc`；runDelta0/outside0；1780 parseable event lines；59/59 complete tool groups；无 truncation/mutation。v1/v2 均为 valid REVISE，两 issue 已接受：IE ratio 必须为显式 exclusion；governed `total_ad_ratio` 禁止。Production Wasm / public ABI / Web 变更**不**需要——本切片为 test-only / seed 合同，**未**要求资产重建）。

## 1. 目的与非目标

### 1.1 目的

在通用 ABI 下，对 Miss Fortune R 建立**有界 Phase-A** 证据闭环：Rank-3 最大完整引导（18 波）选定主目标**聚合期望总物理伤害**脚手架（immediate aggregated channel total），使候选进入 `completed/full/generic_runtime`（G8 `migrated`）。

### 1.2 非目标

下列为 **completed-boundary exclusions**（**不是** remaining blockers，亦**不是**已建模近似）：

- channel timing / tick schedule / interruption / cancel
- direction / cone / six projectiles per wave / collision / geometry
- multitarget / wave-by-wave snapshot / dynamic stats
- sight / reveal / spellshield
- RNG-on-crit / basic attack
- Wiki IE crit ratio 30（显式 exclusion；**不**声称 Wiki 省略）
- other ranks / siblings / loadout / bootstrap
- live migration / Admin publish / browser E2E / 完整 Bullet Time / 完整 R / 完整游戏保真

**精确最大完整引导聚合期望有界完成 ≠ 完整 R 保真。**

## 2. 权威来源

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_missfortune\|R\|弹幕时间` |
| Wiki request / resolved | `Template:Data Miss Fortune/R` → `Template:Data Miss Fortune/Bullet Time` |
| Wiki 身份 | pageId `1308257`；revision `3987215`；timestamp `2026-01-25T03:47:11Z`；canonical raw bytes `3021`；SHA256 `354cac88f79defa26369f485743f697bf61b50a814b008a8aa6c308b7e394d8a` |
| normalized | `数据参考/lol-wiki-current-champions/normalized/generic/missfortune-r.json` bytes `3550` / SHA256 `b275bcc7fb13855cf3fb5a7a8ca0cddce4964ed5713dc521eceb573e69b78c49`；pages sibling bytes `743` / SHA256 `43bb41feafeaa7a8416bd91b81f51f4be73d3bf30ff78ccb2190fc317f3084d6` 为权威 |
| local raw caveat | local raw bytes `3021` / SHA256 `19ba845fd99a0da526b34e55c833f9902c0ce9feb55ad486a1d18c12b55a1049`——**local raw materialization caveat only**；**故意不断言**字节等价，亦**不得**表述为源矛盾 |
| crit 合同 | Wiki `{{critical damage\|130\|30}}` = base130 + IE ratio；Phase-A 仅 base130 期望因子 `1+0.30*clamp(p)`；**显式排除** IE ratio 30 |
| sourceCount | **仍为 12**（9 active + 3 generators；无新源） |

## 3. 有界 Phase-A 合同

| 环节 | 合同 |
| --- | --- |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank3_max_full_channel_selected_primary_champion_expected_total_physical_damage; immediate_aggregated_channel_total_scaffold; eighteen_waves; per_wave_40_plus_0_60_total_ad_plus_0_25_ap; base_wave_crit_multiplier_1_30; expected_factor_one_plus_0_30_times_formula_clamped_crit_chance; mana100_cooldown100000ms; exactly_one_aggregated_damage_quantum; phase_a_excludes_wiki_ie_crit_ratio_30; no_channel_timing_tick_schedule_interruption_cancel_direction_cone_six_projectiles_per_wave_collision_geometry_multitarget_wave_by_wave_snapshot_dynamic_stats_sight_reveal_spellshield_rng_on_crit_basic_attack_other_ranks_or_full_fidelity` |
| G8 governed tags（序） | `ability_cost_cooldown`、`active_physical_damage`、`ap_ratio`、`crit_scaling`、`max_full_channel_aggregate`、`expected_crit_formula`、`phase_a_excludes_wiki_ie_crit_ratio_30`、`immediate_impact_scaffold` |
| Unified 输出序 | 既有全局 canonical sort 发出 `ability_cost_cooldown`、`active_physical_damage`、`ap_ratio`、`crit_scaling`、`expected_crit_formula`、`immediate_impact_scaffold`、`max_full_channel_aggregate`、`phase_a_excludes_wiki_ie_crit_ratio_30`——**表示层规范化**，**不是**合同丢失；**无** governed `total_ad_ratio` |
| 公式 | `18*(40+0.60*AD+0.25*AP)*(1+0.30*clamp01(p))`；total AD = `ad.resolved`（**永不**减 `ad.base` / **永不**称 bonus AD）；formula-local crit clamp；嵌套二元；每条 read path 恰好一次 |
| CritEligible | `false`；**不**读 `crit_damage`；**不**走 CritEligible `settleExpectedCrit` |
| 事件 | 恰好一笔聚合非暴击/不可复制物理伤害量子（type **20220** / add **20170**；无 20230；无显式 event op）；成功施放自动一次 `ability_started`；零 R state/modifier/listener |
| Provider | 独立 `provider_hero_missfortune_r_bullet_time_max_channel_expected`；standalone；**不**合成 P/Q/W/E/basic；**无** legacy MissFortune JSON 真理 |
| 数值交叉 | AD100/AP0/armor0：p0→1800；p0.5→2070；p1→2340；armor100/p0.5 raw2070→final1035；AP100/p0.5→2587.5；clamp p=-0.5→1800 / p=1.5→2340；`crit_damage` 1.3/2.0/2.3 不变（IE-exclusion 反证，非 IE 支持） |
| 日程交叉 | mana300/AD100/AP0/crit0.5/HP10000：t0/t99999/t100000 → success/skip/success；两笔 R damage；final mana100/HP5860；两次自动 `ability_started`；mana99 → resource skip 不变 |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 4. 通用 ABI 图

```text
Wiki missfortune-r.json (page1308257/rev3987215；canonical SHA 354cac88…)
  → Backend seed（lol_generic_miss_fortune_bullet_time_max_channel_expected_seed.sql；
     hero_missfortune/ad/ap/crit_chance/mana = external existing-data/check-only；
     不物化 identity/panel/resource；无 Miss Fortune materializer；
     standalone R 图；无 legacy MissFortune JSON 真理）
    → Web 既有 generic 投影（无本机制 Web 写入）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → mana100 + CD100000ms → 恰好一笔聚合期望物理量子
    → 自动 ability_started ×1 / 成功施放
```

## 5. Backend 所有权 / 前置

| 项 | 合同 |
| --- | --- |
| seed | `db/game_manage/seeds/lol_generic_miss_fortune_bullet_time_max_channel_expected_seed.sql`（bytes `33539`；SHA256 `0cc6ff2a…`） |
| JUnit | `LolGenericMissFortuneBulletTimeMaxChannelExpectedSeedSqlTest`（bytes `66012`；SHA256 `aef51ab2…`） |
| 前置 | `hero_missfortune` / ad / ap / crit_chance / mana 为 **external existing-data/check-only**；**不**写 identity/panel/resource；**无** Miss Fortune materializer；**无** legacy MissFortune JSON 真理 |
| seed 拥有 | standalone R provider/ability/formula 图 only |
| owning | `45259a60f76e72e230eaa36ff520ebccbcfb0bbc`（`run-630c81b0-946d-4303-828d-2de79ebb0482`；exact 3 paths；runDelta3/outside0；854 parseable；44/44 complete；无 truncation） |
| 主验证 | Driver focused **30** PASS；full Maven **1069** tests PASS |
| live | **无** live seed execution |

## 6. Wasm 测试-only 证据

| 项 | 合同 |
| --- | --- |
| exact path | `wasm/tinygo_engine_v2/internal/runtime/generic_miss_fortune_bullet_time_max_channel_expected_test.go` |
| bytes / SHA | `56552` / SHA256 `6bcaf93a0ff086193afaf85e9fd6b890c9d7da76d2ebbc2664f4d8cd77b8c37f` |
| commit / run | `72eb8072c2fa31a88b05e85d48819e7aafa24b2d`；`run-7bc76691-b27e-4e5e-a696-5f087eaa894a`（exact one new `_test.go`；runDelta1/outside0；980 parseable；67/67 complete；无 truncation） |
| 地位 | 英雄名 `_test.go` **仅为**测试/治理证据，**排除**于生产构建；**无**生产英雄 switch / generic-runtime specialization |
| 主验证 | Driver focused/full Go + bench PASS |
| 生产 / Web | **无**生产 Wasm / public ABI / Web 写入；本 test-only 切片**未**要求资产重建 |

## 7. Fixtures

| Fixture | 期望 |
| --- | --- |
| AD100/AP0/armor0；p0 | raw/final 1800 |
| AD100/AP0/armor0；p0.5 | raw/final 2070 |
| AD100/AP0/armor0；p1 | raw/final 2340 |
| armor100；p0.5 | raw2070 / final1035 |
| AP100；p0.5 | raw/final 2587.5 |
| clamp p=-0.5 / p=1.5 | 1800 / 2340 |
| crit_damage 1.3/2.0/2.3 | 伤害不变（IE-exclusion 反证） |
| mana300；t0/t99999/t100000 | success/skip/success；mana100/HP5860；两笔 R damage；两次 `ability_started` |
| mana99 | resource skip；mana/HP 不变 |

## 8. 审计迁移与完成语义

| 项 | 合同 |
| --- | --- |
| 审计 commit | `0d0c8a8114ca253cd071752c7d604ec67fa4805b` |
| 审计 run | `run-1103244f-4782-483c-9799-bf30eb80c68d`（exact 8 paths；runDelta8/outside0；1429 parseable；122/122 complete；无 truncation） |
| 主验收 | Driver 五审计 check + custom record/diff + `git diff --check` PASS |
| 当前计数 | Wiki-only242 不变 migrated48/partial5/blocked120/OOS69；G8 242=migrated96/partial4/blocked73/OOS69；Unified254/source12 completed106/blocked_runtime67/blocked_data3/OOS72/regression5/stale1；full106/partial3/none145；actionable0；`implementation_gap` **仍 54**；`deterministic_random_crit_sequence` **降至 2**（Miss Fortune R 离开；Jhin P / Yunara P 仍 deferred `blocked_runtime`）；provisional70=runtime67/data3；hero68/item2 |
| 报告口径 | 严格 verified completion **106/254=41.7%**；completed+provisional descriptive coverage **仍为 176/254=69.3%** |
| digests | Unified `69832c2a7e7a473b64fd102771cb8055d63683245d76fdccff54598ef329c018`；Wiki `927d8b5a729fe5a00ce4428cf854cb244dcf78b556afc77e711c9b8cb68126c7`（不变） |
| OOS / 真队列 | `out_of_scope=72` 为**最终跳过分类**：无实现/模板/后续队列。真剩余队列 **仅 70** = blocked_runtime67 + blocked_data3 |
| 完成语义 | Miss Fortune R 完成/`actionableKeyCount=0` **不是**停工条件；总体 Goal **仍活跃**；治理 tasks **120** |

## 9. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1308257 / rev3987215 / timestamp2026-01-25T03:47:11Z / canonical3021 / SHA `354cac88…394d8a`；normalized3550 / SHA `b275bcc7…b78c49`；local raw3021 / SHA `19ba845f…55a1049` materialization caveat only |
| 边界 | exact `completedBoundary`；最大完整引导单主目标聚合期望，不是完整 R |
| 公式 / fixtures | `18*(40+0.60*AD+0.25*AP)*(1+0.30*clamp01(p))`；base130；显式 IE exclusion；CritEligible false；无 `total_ad_ratio`；§7 fixtures |
| Backend | owning `45259a6…`；focused30 + full1069；external check-only；standalone；无 live |
| Wasm | exact `72eb807…`；英雄名 `_test.go` 仅测试/治理；无生产/Web 写入；无资产重建 |
| 审计 | 接受 `0d0c8a8…`；counts 与 §8 一致；crit-sequence2；tasks120 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成 |
