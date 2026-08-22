TASK_KEY: wasm-generic-ashe-frost-shot-expected-basic-attack
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI - 艾希 P 冰霜射击（Frost Shot）期望普攻 Phase-A 详细设计

关联验证记录：[通用 ABI 艾希 P 冰霜射击期望普攻 Phase-A 验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务将精确候选 `hero_skill|hero_ashe|P|冰霜射击` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `deterministic_random_crit_sequence`。**仅** expectation-only Phase-A 边界 completed/full；**不**宣称完整 Frost Shot 保真。明确排除 RNG crit 序列、on-crit event、Frost slow、Critical Slow、duration decay、Randuin-specific acceptance、Runaan、Cheap Shot、Q Flurry/P 伤害集成、projectile/travel、attack cadence、其它能力、full fidelity。Jhin P / Yunara P 仍为用户推迟的 `blocked_runtime`，**不是** `out_of_scope`。共享 P/Q seed **不**扩张 Ashe Q 已完成边界对 Frost Shot 保真的排除声明。**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV ashe-p-frost-shot-expected-basic-attack-phase-a-v3`（DESIGN_REVIEW_ONLY READY `run-b733503b-157d-47a8-b0db-cda8f53d768b`；runDelta0/outside0；2095 parseable event lines；84/84 complete tool groups；无 truncation/mutation。Production Wasm / public ABI / Web 变更**不**需要——本切片为 test-only / seed 合同，**未**要求资产重建）。

## 1. 目的与非目标

### 1.1 目的

在通用 ABI 下，对 Ashe P 建立**有界 expectation-only Phase-A** 证据闭环：Flurry 未激活时的普通普攻期望物理伤害，经既有 generic expected-crit settlement，使候选进入 `completed/full/generic_runtime`（G8 `migrated`）。

### 1.2 非目标

下列为 **completed-boundary exclusions**（**不是** remaining blockers，亦**不是**已建模近似）：

- RNG crit sequence / on-crit event
- Frost slow / Critical Slow / duration decay
- Randuin-specific acceptance / Runaan / Cheap Shot
- Q Flurry ↔ P damage integration
- projectile / travel / attack cadence
- other abilities / full Frost Shot / full-game fidelity
- live migration / Admin publish / browser E2E
- production hero switch / generic-runtime specialization

**精确 expectation-only 有界完成 ≠ 完整 Frost Shot 保真。**

## 2. 权威来源

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_ashe\|P\|冰霜射击` |
| Wiki request / resolved | `Template:Data Ashe/I` → `Template:Data Ashe/Frost Shot` |
| Wiki 身份 | pageId `1306803`；revision `4038216`；timestamp `2026-06-30T07:27:41Z`；canonical raw bytes `1880`；SHA256 `def2547f895e1533754e9265fd36f995a30258f11ca947cd737a70ea17df51da` |
| normalized | `数据参考/lol-wiki-current-champions/normalized/generic/ashe-p.json` bytes `2485` / SHA256 `575de3e4c99f9a92d3edd4076d33586d4f96b4e4a8511ff5925617e526ff2e2a`；pages sibling bytes `672` / SHA256 `a8e2f81d77f85ad8d7a346ba9a3a3a354e675aa8cc9953765d5c6495f8bbd7ce` 为权威 |
| local raw caveat | local raw bytes `1880` / SHA256 `5da5112e02a1c3aed266df1a424a33e8c4806c15d94991ec14c3bbaed2ca8378`——**local raw materialization caveat only**；**故意不断言**字节等价，亦**不得**表述为源矛盾 |
| crit 基线 | 当前 total base crit multiplier **2.0**；runtime `crit_damage` 为总倍率；generic additive 可至 **2.3** |
| sourceCount | **仍为 12**（9 active + 3 generators；无新源） |

## 3. 有界 Phase-A 合同

| 环节 | 合同 |
| --- | --- |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `normal_basic_attack_expected_physical_damage; separate_ability_basic_attack; total_ad_times_one_plus_clamped_crit_chance_times_total_crit_multiplier_minus_one; generic_expected_crit_settlement; q_flurry_inactive_normal_attack_branch_only; exactly_one_basic_attack_hit_event; no_rng_crit_sequence_on_crit_event_frost_slow_critical_slow_duration_decay_randuins_specific_acceptance_runaans_cheap_shot_q_flurry_damage_integration_projectile_travel_attack_cadence_other_abilities_or_full_fidelity` |
| G8 governed tags（序） | `expected_crit`、`separate_ability_basic_attack`、`generic_expected_crit_settlement`、`q_flurry_inactive_normal_attack_branch_only` |
| 公式 | `AD * ((1-p)+p*m) = AD * (1+p*(m-1))`，使用既有 generic expected-crit settlement |
| 分支 | **仅** `q_flurry_inactive` 普通普攻；Q Flurry 箭矢保持 `crit_eligible=false`；Q 既有 completedBoundary **不变** |
| 事件 | 恰好一笔 normal damage + 恰好一次 `basic_attack_hit`；零 `ability_started`；保留 Focus 叠层 |
| 数值交叉（total AD100） | p0/m2 → raw/final100；p0.5/m2 →150；p1/m2 →200；armor100 p0.5/m2 → raw150/final75；p0.5/m2.3 →165 |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 4. 通用 ABI 图

```text
Wiki ashe-p.json (page1306803/rev4038216；canonical SHA def2547f…)
  → Backend 共享 P/Q seed（lol_generic_ashe_rangers_focus_seed.sql）
     hero_ashe 基线 crit_chance=0 / crit_damage=2.0
     normal BA damage crit_eligible=true；11 条 Q Flurry 箭矢 false
     fail-closed ensure type 62003 ability/basic_attack + type_relations
     → Web 既有 generic 投影（无本机制 Web 写入；缺 relation 则 fail-closed，不按 key 猜测）
     → Wasm CompileGeneric → RunGeneric（既有 settleExpectedCrit）
     → 恰好 1× normal damage + 1× basic_attack_hit；Focus 继续叠层
```

## 5. Backend 所有权 / 前置

| 项 | 合同 |
| --- | --- |
| 共享 seed | `db/game_manage/seeds/lol_generic_ashe_rangers_focus_seed.sql`（共享 P/Q；既有 separate `ability/basic_attack` 图） |
| JUnit | `LolGenericAsheRangersFocusSeedSqlTest` |
| README | `server/data_manage/README.md` |
| 基线 | Backend seed 拥有 Ashe `crit_chance=0`、`crit_damage=2.0`；普通伤害 `crit_eligible=true`；全部 11 条 Q Flurry 行 `false` |
| relation | 补齐缺失的 game-local `ability/basic_attack`（type_id=62003，`reserved_type_id=NULL`）及 `type_relations` → `ability_hero_ashe_basic_attack`，使 Web generic 投影 fail-closed，**不**按 key 猜测 |
| owning | `0d8fcd44c1152e9e320134730b3d0da1f8d143e3`（`run-7fdd23e2-7a4c-4f3d-a38a-7c78534c9e53`；exact 3 paths；runDelta3/outside0；1006 parseable event lines；57/57 complete tool groups；无 truncation） |
| 主验证 | focused **36** PASS；full Maven **1056** tests，零 failures/errors/skips |
| live | **无** live seed execution |

## 6. Wasm 测试-only 证据

| 项 | 合同 |
| --- | --- |
| exact path | 既有 `wasm/tinygo_engine_v2/internal/runtime/generic_ashe_rangers_focus_test.go`（**仅** `_test.go` fixture 变更） |
| commit / run | `25b34ccda1f6a35b294dbf567cd3632e6bc8f7fa`；`run-97ee013f-a560-4645-9301-e814f879c03a`（exact existing test path；runDelta1/outside0；714 parseable event lines；40/40 complete tool groups；无 truncation） |
| 地位 | 英雄名 `_test.go` **仅为**测试/治理证据，**排除**于生产构建；**无**生产英雄 switch / generic-runtime specialization |
| 主验证 | Driver focused Ashe、full `go test -count=1 ./...`、bench PASS |
| 生产 / Web | **无**生产 Wasm / public ABI / Web 写入；本 test-only 切片**未**要求资产重建 |

## 7. Fixtures

| Fixture（total AD100） | 期望 |
| --- | --- |
| p0 / m2 | raw/final 100 |
| p0.5 / m2 | raw/final 150 |
| p1 / m2 | raw/final 200 |
| armor100；p0.5 / m2 | raw150 / final75 |
| p0.5 / m2.3 | raw/final 165 |
| 事件 / Focus | 各 fixture：1× normal damage、1× `basic_attack_hit`、0× `ability_started`；Focus 继续叠层 |

## 8. 审计迁移与完成语义

| 项 | 合同 |
| --- | --- |
| 审计 commit | `5f5442d768ef28714e91ec8b64d655142580f99a` |
| 审计 run | `run-1034ade7-693b-4dc4-a490-5a692f9f0f0c`（exact 8 paths；runDelta8/outside0；1204 parseable event lines；83/83 complete tool groups；无 truncation） |
| 主验收 | Driver 独立重跑 G8 / Unified / provisional / Wiki-only / Batch-G `--check` 全部 PASS；`git diff --check` PASS（仅行尾警告） |
| 当前计数 | Wiki-only242 不变 migrated48/partial5/blocked120/OOS69；G8 242=migrated95/partial4/blocked74/OOS69；Unified254/source12 completed105/blocked_runtime68/blocked_data3/OOS72/regression5/stale1；full105/partial3/none146；actionable0；`implementation_gap` **仍 54**；`deterministic_random_crit_sequence` **降至 3**（Ashe P 离开；Jhin P / Yunara P 仍为 deferred `blocked_runtime`）；provisional71=runtime68/data3；hero69/item2 |
| 报告口径 | 严格 verified completion **105/254=41.3%**；completed+provisional descriptive coverage **仍为 176/254=69.3%** |
| digests | Unified `69832c2a7e7a473b64fd102771cb8055d63683245d76fdccff54598ef329c018`；Wiki `927d8b5a729fe5a00ce4428cf854cb244dcf78b556afc77e711c9b8cb68126c7`（不变） |
| OOS / 真队列 | `out_of_scope=72` 为**最终跳过分类**：无实现/模板/后续队列。真剩余队列 **仅 71** = blocked_runtime68 + blocked_data3 |
| 完成语义 | Ashe P 完成/`actionableKeyCount=0` **不是**停工条件；总体 Goal **仍活跃**；治理 tasks **119** |

## 9. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1306803 / rev4038216 / timestamp2026-06-30T07:27:41Z / canonical1880 / SHA `def2547f…df51da`；normalized2485 / SHA `575de3e4…ff2e2a`；local raw1880 / SHA `5da5112e…ca8378` materialization caveat only |
| 边界 | exact `completedBoundary`；expectation-only 普通期望普攻，不是完整 Frost Shot |
| 公式 / fixtures | `AD*(1+p*(m-1))`；§7 fixtures；Flurry 箭矢 crit-ineligible；Focus 保留 |
| Backend | owning `0d8fcd4…`；focused36 + full1056；共享 P/Q seed；`ability/basic_attack` relation；无 live |
| Wasm | exact `25b34cc…`；英雄名 `_test.go` 仅测试/治理；无生产/Web 写入；无资产重建 |
| 审计 | 接受 `5f5442d…`；counts 与 §8 一致；crit-sequence3；tasks119 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成 |
