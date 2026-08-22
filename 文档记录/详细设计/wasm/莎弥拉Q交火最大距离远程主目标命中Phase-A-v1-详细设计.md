TASK_KEY: wasm-generic-samira-flair-max-distance-primary-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 莎弥拉 Q 交火（Flair）最大距离远程主目标命中 Phase-A-v1 详细设计

关联验证记录：[莎弥拉 Q 交火最大距离远程主目标命中 Phase-A-v1 验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务将精确候选 `hero_skill|hero_samira|Q|交火` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `distance_or_ratio_input`（raw provenance 仍可保留 `distance_based_damage_modifier`）。**最大距离仅是假定远程射击分支**；伤害公式本身**无**距离倍率/输入。**不**宣称实际距离/射程/弹道/几何/首个敌人搜索、近战挥砍/锥形、Wild Rush/E 爆炸物、暴击/期望暴击/RNG/150%/IE、吸血、Style、多目标、其他 rank、完整保真；本闭环**恰好是一次 Rank5 最大距离远程选定主目标物理命中量子**，**不是**完整 Q；**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV samira-q-flair-max-distance-primary-hit-phase-a-v1`（DESIGN_READY `run-9d5340c8-cff7-4746-be38-de4f95a0cb3a`；model grok-4.5/high/false；1476 parseable events；zero truncated/mutation；runDelta0。Production Wasm / public ABI / Web 变更**不**需要——本切片为文档/治理；实现证据已由 Backend/Wasm/审计提交）。

## 1. 目的与非目标

### 1.1 目的

在通用 ABI 下，对莎弥拉 Q 交火建立**有界 Phase-A** 证据闭环：Rank5 假定最大距离远程射击分支、选定主目标单次物理命中脚手架（immediate impact）+ 30 mana / 2000ms CD，使候选进入 `completed/full/generic_runtime`（G8 `migrated`）。

### 1.2 非目标

下列为 **completed-boundary exclusions**（**不是** remaining blockers，亦**不是**已建模近似）：

- 实际距离 / 射程 / 方向 / 弹道 / 碰撞 / 几何 / 首个敌人搜索
- 近战挥砍 / 锥形
- Wild Rush / E 爆炸物
- 暴击 / 期望暴击 / RNG / 150% / IE
- 吸血 / Style / 多目标
- other ranks / sibling Samira synthesis / loadout / bootstrap
- live migration / Admin publish / browser E2E / 完整 Flair / 完整游戏保真

**精确最大距离远程主目标有界完成 ≠ 完整 Q 保真。**

## 2. 权威来源

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_samira\|Q\|交火` |
| Wiki request / resolved | `Template:Data Samira/Q` → `Template:Data Samira/Flair` |
| Wiki 身份 | pageId `1459315`；revision `4008027`；timestamp `2026-04-13T03:58:01Z`；canonical raw bytes `3596`；SHA256 `7f65786ccae8186903166195be9151294adef3539fe97f067de4273e162cd203` |
| normalized | `数据参考/lol-wiki-current-champions/normalized/generic/samira-q.json` bytes `3596` / SHA256 `9077cd57cd3f2713d4725a2b3264b987163feb57d97c892669bc35bbde8ecc0d`；pages sibling `pages/samira-q.json` bytes `666` / SHA256 `c572e9baffa2c4ec196fe5a410c3ca89ddfc717e63be43be6428626ef7e93976` 为权威 |
| local raw caveat | `raw/samira-q.wikitext` bytes `3596` / SHA256 `fe7ba68ec41b06ea2592a9f0b751d5970b0d42914886c926b3d90509efca5f8d`——**local raw materialization caveat only**；**故意不断言**字节等价，亦**不得**表述为源矛盾；canonical identity 仍为 sidecar/pages |
| 数值真源 | **仅** Wiki；**无** DDragon / OCR 真理 |
| sourceCount | **仍为 12**（9 active + 3 generators；无新源） |

## 3. 有界 Phase-A 合同

| 环节 | 合同 |
| --- | --- |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_max_distance_ranged_shot_selected_primary_physical_hit; assumed_ranged_shot_branch_maximum_distance_no_distance_multiplier_or_input; immediate_impact_scaffold; physical_20_plus_1_10_total_ad; mana30_cooldown2000ms; exactly_one_immediate_damage_quantum; no_distance_range_direction_projectile_collision_melee_slash_wild_rush_e_explosives_crit_expected_crit_rng_150_percent_lifesteal_style_multitarget_other_ranks_or_full_fidelity` |
| G8 governed tags（序） | `rank5_max_distance_ranged_shot_primary_hit`、`physical_20_plus_1_10_total_ad`、`phase_a_excludes_melee_e_crit_lifesteal_and_geometry` |
| Unified 输出序 | 既有全局 canonical sort 可能发出不同序——**表示层规范化**，**不是**合同丢失；**无** governed `total_ad_ratio` |
| Rank5 | 30 mana / 2000ms CD；immediate selected-primary physical quantum；**最大距离仅假定远程射击分支**；公式本身**无**距离倍率/输入 |
| 伤害公式 | 恰好一笔非暴击/不可复制物理 `20 + 1.10 * source.attr.ad.resolved`（**total AD**；**不得**减 base AD，亦**不得**称为 bonus AD；精确嵌套二元 `add(const 20, mul(const 1.10, read source.attr.ad.resolved))`；伤害类型 **20220** + add 策略 **20170**；**无** 20230） |
| Provider | 独立 `provider_hero_samira_q_flair_max_distance_primary_hit`；ability_key `flair_max_distance_primary_hit`；standalone；**不**合成 Batch-B / sibling Samira |
| 数值交叉 | totalAD100 → raw130；armor100 → mitigated65；HP1000→935；mana300→270 |
| 日程交叉 | mana300/HP1000/AD100/armor100：t0/t1999/t2000 → success/skip/success；两笔 Q damage；两次自动 `ability_started`；final mana240/HP870；mana29 → resource skip 且不变 |
| total-AD 反证 | base0/resolved100 与 base60/resolved100 均为 raw130 |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E；**不**宣称 rebuilt/synced Wasm asset |

## 4. 通用 ABI 图

```text
Wiki Template:Data Samira/Flair (page1459315 / rev4008027；content SHA 7f65786c…；raw3596)
  → Backend seed（lol_generic_samira_flair_max_distance_primary_hit_seed.sql @ c89841a；
     hero_samira/ad/mana = external existing-data/check-only；
     不物化 identity/panel/resource；
     provider_hero_samira_q_flair_max_distance_primary_hit
     + ability flair_max_distance_primary_hit
     + impact phase/sequence
     + damage 20+1.10*ad.resolved）
    → Wasm CompileGeneric → RunGeneric
       mana cost + CD gate → 一笔物理命中量子 + 自动 ability_started
    → 英雄名 _test.go 仅为回归/治理证据（排除生产）
```

## 5. Backend 所有权 / 前置

| 项 | 合同 |
| --- | --- |
| seed | `db/game_manage/seeds/lol_generic_samira_flair_max_distance_primary_hit_seed.sql`（bytes `29454`；SHA256 `8cc40c8f6d9d08bfce0e10c3a58adc01e230b288cea8adc2179a6eb2a39a0314`） |
| JUnit | `LolGenericSamiraFlairMaxDistancePrimaryHitSeedSqlTest`（bytes `52233`；SHA256 `bdbe41df277ef6f71738a3e0bc38e81e6173821f43b9e23bebe054f6bc304bfb`） |
| README | `server/data_manage/README.md`（Backend owning 切片内更新；bytes `283080`；SHA256 `a7ee6f7cbc9849c2790e2ebacf8106446446812a0c4e0f756f81d2f19e30cc88`） |
| owning | `c89841aeecbce5d774ff3e13a43ecab5b9972258`（backend/dev；`run-b30f3551-afda-4cac-a595-54cbf74f3632`；delta3/outside0；events1275/truncated0；focused43/43 + full1090/1090 PASS） |
| 前置 | **external existing-data/check-only**（`hero_samira` / ad / mana）；**不**物化 identity/panel/resource |
| live | **无** live seed execution |

## 6. Wasm 测试-only 证据

| 项 | 合同 |
| --- | --- |
| exact path | `wasm/tinygo_engine_v2/internal/runtime/generic_samira_flair_max_distance_primary_hit_test.go`（**仅** `_test.go`） |
| bytes / SHA（commit blob） | `59216` / SHA256 `064a6f924371f903203923426a9a325ed1c65fc2176a8281418796ca214862a7` |
| commit / run | `d4b55d0f8cd1b821b2c05bfbc0c85316b5a7a20c`；`run-28987be3-ce64-41c8-9339-4728996d52dd`（delta1/outside0；events1123/truncated0；focused PASS） |
| 地位 | 英雄名 `_test.go` **仅为**回归/治理证据，**排除**于生产构建；**无**生产 hero switch |
| 主验证 | focused PASS；post-commit full `go test -count=1 ./...` PASS；bench mean **109.61us** |
| 生产 / Web | **无**生产 Wasm / public ABI / asset / Web 写入；**未**资产重建/同步 |

## 7. Fixtures

| Fixture | 期望 |
| --- | --- |
| totalAD100 / armor0 | raw130 |
| totalAD100 / armor100 | mitigated65；HP1000→935；mana300→270 |
| total-AD 反证 base0 vs base60（resolved100） | 两边均 raw130 |
| mana300 t0/t1999/t2000 | success/skip/success；两笔 Q damage；两次 `ability_started`；final mana240/HP870 |
| mana29 t0 | resource skip；mana/HP 不变；无 Q damage/event |

## 8. 审计迁移与完成语义

| 项 | 合同 |
| --- | --- |
| 审计 commit | `9b8e452106089928a1d86a8c850f203aba204d95` |
| 审计 run | `run-4bb01f1b-5cb6-4bff-9f4d-8c9299e87ac5`（delta8/outside0；events1787/truncated0；五 check PASS） |
| 主验收 | 五审计 check + exact semantics PASS；`git diff --check` PASS |
| 当前计数 | Wiki-only242 不变 migrated48/partial5/blocked120/OOS69；G8 242=migrated99/partial4/blocked70/OOS69；Unified254/source12 completed109/blocked_runtime64/blocked_data3/OOS72/regression5/stale1；full109/partial3/none142；actionable0；`implementation_gap` **仍为 54**；`distance_or_ratio_input` **6**（Samira Q 离开）；provisional67=runtime64/data3；hero66/item1；Samira Q 缺席；剩余 item=`3097\|盈能` |
| 报告口径 | 严格 verified completion **109/254=42.9%**；completed+provisional descriptive coverage **仍为 176/254=69.3%** |
| digests | Unified `69832c2a7e7a473b64fd102771cb8055d63683245d76fdccff54598ef329c018`；Wiki `927d8b5a729fe5a00ce4428cf854cb244dcf78b556afc77e711c9b8cb68126c7`（不变） |
| OOS / 真队列 | `out_of_scope=72` 为**最终跳过分类**：无实现/模板/后续队列。真剩余队列 **仅 67** = blocked_runtime64 + blocked_data3 |
| 完成语义 | Samira Q 完成/`actionableKeyCount=0` **不是**停工条件；总体 Goal **仍活跃**；治理 tasks **123**（docs commit pending driver） |

## 9. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1459315 / rev4008027 / timestamp2026-04-13T03:58:01Z / content SHA `7f65786c…` / raw3596 |
| 边界 | exact `completedBoundary`；最大距离仅假定远程分支；公式无距离倍率/输入；不是完整 Q |
| Backend | owning `c89841a…`；focused43 + full1090；external check-only；无 live |
| Wasm | exact `d4b55d0…`；仅 `_test.go`；无生产/Web/资产重建 |
| 审计 | 接受 `9b8e452…`；counts 与 §8 一致；tasks123 |
| 发布 | 无 live / publish / push / E2E；不宣称 full fidelity / 总体 Goal 完成 / rebuilt Wasm asset |
