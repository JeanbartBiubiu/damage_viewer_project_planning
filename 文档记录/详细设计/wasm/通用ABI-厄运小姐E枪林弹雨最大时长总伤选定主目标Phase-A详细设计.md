TASK_KEY: wasm-generic-miss-fortune-make-it-rain-max-total-selected-primary
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI - 厄运小姐 E 枪林弹雨（Make It Rain）最大时长总伤选定主目标 Phase-A 详细设计

关联验证记录：[通用 ABI 厄运小姐 E 枪林弹雨最大时长总伤选定主目标 Phase-A 验证记录](../../测试记录/wasm/通用ABI-厄运小姐E枪林弹雨最大时长总伤选定主目标Phase-A验证记录-2026-07-26.md)。本任务将精确候选 `hero_skill|hero_missfortune|E|枪林弹雨` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`（raw upstream 仍可保留 `meta_or_non_target_dps` / `out_of_scope_for_single_target_dps` provenance）。**仅** Rank-5 最大时长总伤选定主目标聚合魔法伤害 Phase-A；**不**宣称完整 Make It Rain / 完整 E / 完整游戏保真。明确排除 real 2s duration / eight ticks / 0.25s schedule / tick snapshots / per-tick rounding、location/area/radius/acquisition/geometry/multitarget、sight/visibility、slow/AP-scaled slow/refresh/cleanse、spell effects/persistent-area/interruption/cancel/animation/VFX、other ranks/siblings/P/Q/W/R/basic/loadout/bootstrap/live/full fidelity。Jhin P / Yunara P 仍为用户推迟的 `blocked_runtime`，**不是** `out_of_scope`。Aphelios **OOS**。**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV miss-fortune-e-make-it-rain-max-total-selected-primary-phase-a-v2`。

## 0. 设计审查历史

| 轮次 | Run | 裁决 | 模型 / 元数据 | 吸收要点 |
| --- | --- | --- | --- | --- |
| v1 | `run-9e6e2747-8761-4b07-b87a-942c29f5e695` | **REVISE**（valid） | runDelta0；1967 parseable events；无 truncation/mutation | 接受：AP100 cooldown fixture；`implementation_gap` 降至 **53**；exact docs 路径与 tag/provenance 断言 |
| v2 | `run-41585a84-e405-4a8f-a34a-510be65661ae` | **READY** | top-level grok-4.5 / high / false；runDelta0；1528 parseable events；无 truncation/mutation | 正式最终设计门控 |

Production Wasm / public ABI / Web 变更**不**需要——本切片为文档/治理；实现证据已由 Backend/Wasm/审计提交。

## 1. 目的与非目标

### 1.1 目的

在通用 ABI 下，对 Miss Fortune E 建立**有界 Phase-A** 证据闭环：Rank-5 最大时长总伤选定主目标**聚合魔法伤害**脚手架（immediate aggregated duration total），使候选进入 `completed/full/generic_runtime`（G8 `migrated`）。

### 1.2 非目标

下列为 **completed-boundary exclusions**（**不是** remaining blockers，亦**不是**已建模近似）：

- real two-second duration / eight ticks / 0.25s tick schedule / tick snapshots / dynamic stats / per-tick rounding
- location / area / radius / acquisition / geometry / multitarget
- sight / visibility
- slow / AP-scaled slow / slow refresh / cleanse
- spell effects / persistent-area / interruption / cancel / animation / VFX
- other ranks / siblings / P / Q / W / R / basic / loadout / bootstrap
- live migration / Admin publish / browser E2E / 完整 Make It Rain / 完整 E / 完整游戏保真

**精确最大时长总伤选定主目标聚合有界完成 ≠ 完整 E 保真。**

## 2. 权威来源

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_missfortune\|E\|枪林弹雨` |
| Wiki request / resolved | `Template:Data Miss Fortune/E` → `Template:Data Miss Fortune/Make It Rain` |
| Wiki 身份 | pageId `1308255`；revision `3936384`；timestamp `2025-07-24T15:45:56Z`；canonical raw bytes `1210`；SHA256 `a38b513373be3b0491f7c967af8827dbdc9196452e5feb25614af3b78ab286f7` |
| normalized | `数据参考/lol-wiki-current-champions/normalized/generic/missfortune-e.json` bytes `1972` / SHA256 `d53466f5d4e7e046620820cfd492133bcfac646e2d81d348dfcf544fe8174596`；pages sibling bytes `747` / SHA256 `ac8ffb762ccb1667b7c3f955a60e418cb36553b1c653ebb6a70b613c4bf0a0dc` 为权威 |
| local raw caveat | local raw bytes `1210` / SHA256 `5a8800d1ca721f1583bb3d2c5581977a2e4942d399266ca3c745cd11e6503b7f`——**local raw materialization caveat only**；**故意不断言**字节等价，亦**不得**表述为源矛盾；canonical identity 仍为 sidecar/pages |
| sourceCount | **仍为 12**（9 active + 3 generators；无新源） |

## 3. 有界 Phase-A 合同

| 环节 | 合同 |
| --- | --- |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_selected_primary_champion_max_duration_total_magic_damage; immediate_aggregated_duration_total_scaffold; magic_190_plus_1_20_ap; mana80_cooldown14000ms; exactly_one_aggregated_damage_quantum; no_two_second_duration_eight_ticks_quarter_second_tick_schedule_location_area_geometry_multitarget_sight_slow_dynamic_slow_refresh_or_full_fidelity` |
| G8 governed tags（序） | `ability_cost_cooldown`、`active_magic_damage`、`ap_ratio`、`immediate_aggregated_duration_total_scaffold` |
| 有意不对称 / 缺席 tags | 相对 Miss Fortune R：**故意**使用 duration-total aggregate scaffold，**不是** R 的 channel/expected-crit 族；当前 governed tags **故意缺席** `immediate_impact_scaffold` 与 `meta_or_non_target_dps`（raw/auditBaseline 中的 `meta_or_non_target_dps` 仅为历史 provenance，**不是**最终 disposition） |
| Unified 输出序 | 既有全局 canonical sort 可能发出不同序——**表示层规范化**，**不是**合同丢失 |
| 公式 | `add(const 190, mul(const 1.20, read source.attr.ap.resolved))`（嵌套二元；AP 读 path **恰好一次**）；代数上等于八段 Wiki tick `8*(190/8+(120/8)%AP)=190+1.20*AP`，**无** per-tick rounding；**不**读 AD / crit_chance / crit_damage |
| CritEligible | `false`；CopyableOnHit `false` |
| 事件 | 恰好一笔聚合非暴击/不可复制魔法伤害量子（type **20221** / add **20170**；无 20230；无显式 event op）；成功施放自动一次 `ability_started`；零 E state/modifier/listener；**无** E ability-specific type |
| Provider | 独立 `provider_hero_missfortune_e_make_it_rain_max_total_selected_primary`（standalone E generic graph）；**不**合成 P/Q/W/R/basic；**无** R mutation；**无** legacy MissFortune JSON 真理 |
| 数值交叉 | AP0/MR100：raw190/final95；AP100/MR100：raw310/final155 |
| 日程交叉 | mana240/AP100/HP1000/MR100：t0/t13999/t14000 → success/skip/success；两笔 E damage；final mana80/HP690；两次自动 `ability_started`；mana79 → resource skip 不变 |
| E/R 共存 | standalone E **不** mutate/arm 既有 R；R 仍可独立施放 |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 4. 通用 ABI 图

```text
Wiki missfortune-e.json (page1308255/rev3936384；canonical SHA a38b5133…)
  → Backend seed（lol_generic_miss_fortune_make_it_rain_max_total_selected_primary_seed.sql；
     hero_missfortune/ap/mana = external existing-data/check-only；
     不物化 identity/panel/resource；无 Miss Fortune materializer；
     standalone E 图；无 R mutation；无 legacy MissFortune JSON 真理）
    → Web 既有 generic 投影（无本机制 Web 写入）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → mana80 + CD14000ms → 恰好一笔聚合魔法量子 190+1.20*AP
    → 自动 ability_started ×1 / 成功施放
```

## 5. Backend 所有权 / 前置

| 项 | 合同 |
| --- | --- |
| seed | `db/game_manage/seeds/lol_generic_miss_fortune_make_it_rain_max_total_selected_primary_seed.sql`（bytes `28873`；SHA256 `9949ad23820eb1c77d5b09b53db786c8518b0bdaa0b3ffac18d210215a44b7eb`） |
| JUnit | `LolGenericMissFortuneMakeItRainMaxTotalSelectedPrimarySeedSqlTest`（bytes `50835`；SHA256 `27650b5ceed3a3c49b2de3a498f235cee6d11cbca83d8f86f08d14cee360e4dc`） |
| 前置 | `hero_missfortune` / ap / mana 为 **external existing-data/check-only**；**不**写 identity/panel/resource；**无** Miss Fortune materializer；**无** R mutation；**无** Batch-B / sibling Miss Fortune synthesis |
| seed 拥有 | standalone E provider/ability/formula 图 only |
| owning | `c6c2e7307f435c539600ff9def8f16f2898acc42`（`run-a858d21b-8629-40f1-b8d1-96f85ced3221`；delta3/outside0；events1028/truncated0；focused E12/12、E+R25/25、driver full Maven1113/1113 PASS） |
| live | **无** live seed execution |

## 6. Wasm 测试-only 证据

| 项 | 合同 |
| --- | --- |
| exact path | `wasm/tinygo_engine_v2/internal/runtime/generic_miss_fortune_make_it_rain_max_total_selected_primary_test.go` |
| bytes / SHA | `59725` / SHA256 `7aa8b7104e4b70cf8249449364176d6f9ac5c879ecf17e20d8d42edff0a1abb6` |
| commit / run | `1693a3435d7f252299c12863c4cd1aa3b1ff4983`；`run-99972a69-3d14-49a3-a2e3-32a553cf0923`（delta1/outside0；events1181/truncated0；focused/bench mean106.84us PASS） |
| 诚实记录 | precommit full 曾因既有 Xayah dirty-test 结构规则、且新允许 `_test.go` 未提交而**诚实 blocked**；提交后 driver full `go test -count=1 ./...` PASS |
| 地位 | 英雄名 `_test.go` **仅为**测试/治理证据，**排除**于生产构建；**无**生产英雄 switch / generic-runtime specialization |
| 生产 / Web | **无**生产 Wasm / public ABI / Web / asset 写入；**未**资产重建 |

## 7. Fixtures

| Fixture | 期望 |
| --- | --- |
| AP0 / MR100 | raw190 / final95 |
| AP100 / MR100 | raw310 / final155 |
| mana240；t0/t13999/t14000 | success/skip/success；mana80/HP690；两笔 E damage；两次 `ability_started` |
| mana79 | resource skip；mana/HP 不变；无 E damage/event |
| E/R coexistence | E standalone 不 mutate R；R 仍可独立施放 |

## 8. 审计迁移与完成语义

| 项 | 合同 |
| --- | --- |
| 审计首轮 | `run-44f9f632-13af-4274-be93-b3414488af68`（delta8/outside0；events1214/truncated0）；Driver 五 check 表面 PASS，但发现 **同一 key 的 Unified Map 重复 STATUS_OVERRIDES 条目**——**不是**可接受完成 |
| 审计修复 | `run-e68e52ba-74e7-4ed9-8198-ca2f9a953347`（delta3/outside0；events1270/truncated0）；移除重复并证明 **恰好一枚** STATUS_OVERRIDES 条目；Driver 重跑五 check **全部 PASS** |
| 接受审计 commit | `07afcd719f87844d48b86872144db73bd370e4b2` |
| 当前计数 | Wiki-only242 不变 migrated48/partial5/blocked120/OOS69；G8 242=migrated101/partial4/blocked68/OOS69；Unified254/source12 completed111/blocked_runtime62/blocked_data3/OOS72/regression5/stale1；full111/partial3/none140；actionable0；`implementation_gap` **降至 53**（Miss Fortune E 离开）；provisional65=runtime62/data3；hero64/item1 |
| 报告口径 | 严格 verified completion **111/254=43.7%**；completed+provisional descriptive coverage **仍为 176/254=69.3%** |
| digests | Unified `69832c2a7e7a473b64fd102771cb8055d63683245d76fdccff54598ef329c018`；Wiki `927d8b5a729fe5a00ce4428cf854cb244dcf78b556afc77e711c9b8cb68126c7`（不变） |
| OOS / 真队列 | `out_of_scope=72` 为**最终跳过分类**：无实现/模板/后续队列。真剩余队列 **仅 65** = blocked_runtime62 + blocked_data3 |
| 完成语义 | Miss Fortune E 完成/`actionableKeyCount=0` **不是**停工条件；总体 Goal **仍活跃**；治理 tasks **125**（docs commit pending driver） |

## 9. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1308255 / rev3936384 / timestamp2025-07-24T15:45:56Z / canonical1210 / SHA `a38b5133…ab286f7`；normalized1972 / SHA `d53466f5…8174596`；pages747 / SHA `ac8ffb76…bf0a0dc`；local raw1210 / SHA `5a8800d1…6503b7f` materialization caveat only |
| 边界 | exact `completedBoundary`；最大时长总伤选定主目标聚合，不是完整 E |
| tags | exact 四 tags 序；故意缺席 `immediate_impact_scaffold` / `meta_or_non_target_dps`；相对 MF R 有意不对称 |
| 公式 / fixtures | `190+1.20*AP`；代数八 tick 无 per-tick rounding；CritEligible false；§7 fixtures |
| Backend | owning `c6c2e73…`；focused E12 + E+R25 + full1113；external check-only；standalone；无 live；无 R mutation |
| Wasm | exact `1693a34…`；英雄名 `_test.go` 仅测试/治理；无生产/Web 写入；无资产重建；Xayah dirty-test honesty 已记录 |
| 审计 | 接受 `07afcd7…`（含 duplicate STATUS_OVERRIDES 修复）；counts 与 §8 一致；tasks125 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成 |
