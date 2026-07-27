TASK_KEY: wasm-generic-varus-piercing-arrow-max-charge-primary-first-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-27

# 通用 ABI - 韦鲁斯 Q 穿刺之箭（Piercing Arrow）满蓄力最大距离首个敌人主目标 Phase-A 详细设计

关联验证记录：[通用 ABI 韦鲁斯 Q 穿刺之箭满蓄力最大距离首个敌人主目标 Phase-A 验证记录](../../测试记录/wasm/通用ABI-韦鲁斯Q穿刺之箭满蓄力最大距离首个敌人主目标Phase-A验证记录-2026-07-27.md)。本任务将精确候选 `hero_skill|hero_varus|Q|穿刺之箭` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime`；无 actionable gap。**仅** Rank-5 满蓄力/最大距离、选定主目标解释为第一个敌人命中的单次物理命中 Phase-A；**不**宣称完整 Piercing Arrow / 完整 Q / 完整游戏保真。明确排除 ranks1–4、variable charge/channel/release/cancel/interrupt、post-effect cooldown-start timing、charge-duration input、cooldown reduction while charging、real projectile travel/range/collision/geometry、pierce/falloff/multiple enemies、target selection beyond selected-primary first-enemy scaffold、Blight/W coupling/detonation/empower、Q cooldown refund、animation/VFX、equipment/loadout、live/publish/browser E2E/full fidelity。Jhin P / Yunara P 仍为用户推迟的 `blocked_runtime`，**不是** `out_of_scope`。Aphelios **OOS**。**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV varus-q-piercing-arrow-max-charge-primary-first-hit-phase-a-v1`。

## 0. 设计审查历史

| 轮次 | Run | 裁决 | 模型 / 元数据 | 吸收要点 |
| --- | --- | --- | --- | --- |
| v1 | `run-0d43518f-0708-43c5-a9ab-3e34d3ad9e11` | **READY** | DESIGN_REVIEW_ONLY；strict grok-4.5 / high / false；runDelta0；1811 parseable event lines；无 truncation/mutation | 正式最终设计门控 |

Production Wasm / public ABI / Web 变更**不**需要——本切片为文档/治理；实现证据已由 Backend/Wasm/审计提交。

## 1. 目的与非目标

### 1.1 目的

在通用 ABI 下，对 Varus Q 建立**有界 Phase-A** 证据闭环：Rank-5 满蓄力/最大距离选定主目标（解释为第一个敌人）**单次物理命中**脚手架（immediate impact），使候选进入 `completed/full/generic_runtime`（G8 `migrated`）。

### 1.2 非目标

下列为 **completed-boundary exclusions**（**不是** remaining blockers，亦**不是**已建模近似）：

- ranks 1–4
- variable charge / channel / release / cancel / interrupt
- post-effect cooldown-start timing
- charge-duration input
- cooldown reduction while charging
- real projectile travel / range / collision / geometry
- pierce / falloff / multiple enemies
- target selection beyond selected-primary first-enemy scaffold
- Blight / W coupling / detonation / empower
- Q cooldown refund
- animation / VFX
- equipment / loadout / bootstrap
- live migration / Admin publish / browser E2E / 完整 Piercing Arrow / 完整 Q / 完整游戏保真

**精确满蓄力最大距离选定主目标首个敌人有界完成 ≠ 完整 Q 保真。**

## 2. 权威来源

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_varus\|Q\|穿刺之箭` |
| Wiki request / resolved | `Template:Data Varus/Q` → `Template:Data Varus/Piercing Arrow` |
| Wiki 身份 | pageId `1309981`；revision `4026469`；timestamp `2026-06-09T22:00:25Z`；canonical raw bytes `3888`；SHA256 `bdbbe064008b969e153800f7d5cdb305f84eca1ef043d8e6f8ce41c5db2659dd` |
| normalized | `数据参考/lol-wiki-current-champions/normalized/generic/varus-q.json` bytes `4131` / SHA256 `bb5af7baaf053d1266a3702664c2df09e89f67c6125e8cf6da15f28f5b0c1f8e`；pages sibling bytes `689` / SHA256 `85975963850f79395fbeec142049176aa945a3728bcecc55ca01a7863d849f61` 为权威 |
| local raw caveat | local raw bytes `3888` / SHA256 `5a350cecb53d37bd2640f7de3398c1be0a798a75f88c42eb327933920d487962`——**local raw materialization caveat only**；**故意不断言**字节等价，亦**不得**表述为源矛盾；canonical identity 仍为 sidecar/pages |
| sourceCount | **仍为 12**（9 active + 3 generators；无新源） |

## 3. 有界 Phase-A 合同

| 环节 | 合同 |
| --- | --- |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_max_charge_max_range_selected_primary_first_enemy_physical_hit; immediate_impact_scaffold; physical_360_plus_1_20_bonus_ad; mana70_listed_cooldown12000ms_scaffold; no_real_charge_channel_post_effect_cooldown_start_charge_duration_cooldown_reduction_pierce_falloff_projectile_geometry_blight_or_full_fidelity` |
| G8 governed tags（序） | `ability_cost_cooldown`、`active_physical_damage`、`bonus_ad_ratio`、`max_charge_max_range_selected_primary_first_hit_scaffold` |
| 公式 | `add(const 360, mul(const 1.20, sub(read source.attr.ad.resolved, read source.attr.ad.base)))`（精确嵌套二元；每条 AD path **恰好一次**；**不**读 AP / crit_chance / crit_damage） |
| CritEligible | `false`；CopyableOnHit `false` |
| 事件 | 恰好一笔非暴击/不可复制物理伤害量子（type **20220** / add **20170**；无 20230；无显式 event op；无 Q ability-specific type）；成功施放自动一次 `ability_started` |
| Provider | 独立 standalone Q provider；可与既有 W blight ordering scaffold **共存**（Q 仅发 Q 伤害且不触碰 W state；W carrier 仍可独立调用）；**无**生产英雄 switch / generic-runtime specialization |
| 数值交叉 | baseAD60/resolved60/armor0：raw360/final360；baseAD60/resolved160/armor100：raw480/final240；无关 AP/crit/crit_damage 变化不影响本量子 |
| 日程交叉 | mana210/HP1000/armor100：t0/t11999/t12000 → success/skip/success；两笔 Q damage；final mana70/HP520；两次自动 `ability_started`；mana69 → resource skip 不变 |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 4. 通用 ABI 图

```text
Wiki varus-q.json (page1309981/rev4026469；canonical SHA bdbbe064…)
  → Backend seed（lol_generic_varus_piercing_arrow_max_charge_primary_first_hit_seed.sql；
     hero_varus/ad/mana = external existing-data/check-only；
     standalone Q 图；与既有 W provider 共存；无生产 runtime 特化）
    → Web 既有 generic 投影（无本机制 Web 写入）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → mana70 + listed CD scaffold 12000ms
    → 恰好一笔物理量子 360+1.20*(ad.resolved-ad.base)
    → 自动 ability_started ×1 / 成功施放
```

## 5. Backend 所有权 / 前置

| 项 | 合同 |
| --- | --- |
| seed | `db/game_manage/seeds/lol_generic_varus_piercing_arrow_max_charge_primary_first_hit_seed.sql`（bytes `29472`；SHA256 `7cef83293d4fe27faa889c22e11008cfadc920b0c35ce598931c825a23579929`） |
| JUnit | `LolGenericVarusPiercingArrowMaxChargePrimaryFirstHitSeedSqlTest`（bytes `50874`；SHA256 `ebb54d0c3991f7927b7fb56cda2af3aca99e0c758820eb402c2f2f82469e6919`） |
| 前置 | `hero_varus` / ad / mana 为 **external existing-data/check-only**；standalone Q；与 W 共存；**无** live |
| owning | `d4937812733e819e34fd6328240295848c75d17b`（`run-9a1fea38-a17f-4d9b-b4a1-a4229316933c`；runDelta3/outside0；events927；focused sibling JUnit 38/38 PASS；driver full Maven 1123/1123 PASS） |
| live | **无** live seed execution |

## 6. Wasm 测试-only 证据

| 项 | 合同 |
| --- | --- |
| exact path | `wasm/tinygo_engine_v2/internal/runtime/generic_varus_piercing_arrow_max_charge_primary_first_hit_test.go` |
| bytes / SHA | `63048` / SHA256 `a52e2f4156ae79d40aa34b59ebf98705f06f3136bafcb380eb361143c1c3fa5a`（post-format） |
| 中断 run（诚实） | `run-177243d7-bbee-4f36-9485-9c9e82c6a14b`：1095 parseable events；in-scope edits 存在，但被 driver 在正常完成前终止——**不是**接受完成 run |
| 无增量复验 | `run-c277c097-4b20-49c1-927c-fafc114e02a9`：finished；events698；runDelta0/outside0；focused Q 与 Q+W 及 bench PASS；precommit full 仅因既有 dirty-test 策略失败 |
| 格式修复 | `run-74661f4a-2dc6-489d-ab18-2391736e383e`：runDelta1/outside0/events291；仅 exact test；driver `gofmt -d` clean 后提交 |
| 接受 commit | `df617949ffe39ee4733a2fbb300444833f612849`；提交后 full `go test -count=1 ./...` PASS 与 `go run ./cmd/bench` PASS |
| 地位 | 英雄名 `_test.go` **仅为**测试/治理证据，**排除**于生产构建；**无**生产英雄 switch / generic-runtime specialization |
| 生产 / Web | **无**生产 Wasm / public ABI / Web / asset 写入；**未**资产重建 |

## 7. Fixtures

| Fixture | 期望 |
| --- | --- |
| baseAD60 / resolved60 / armor0 | raw360 / final360 |
| baseAD60 / resolved160 / armor100 | raw480 / final240 |
| mana210；t0/t11999/t12000 | success/skip/success；mana70/HP520；两笔 Q damage；两次 `ability_started` |
| mana69 | resource skip；mana/HP 不变；无 Q damage/event |
| Q/W coexistence | 两 provider 同编同挂；Q 仅发 Q 伤害且不改 W state；W carrier 仍可独立调用 |

## 8. 审计迁移与完成语义

| 项 | 合同 |
| --- | --- |
| 审计首轮（拒绝） | `run-ff3cae8e-aed8-44cd-839e-76894a07985c`：900000ms 超时；events 显示临时 create/delete `_debug_varusq.mjs`（outside allowlist），尽管最终 outside0——**拒绝** |
| 接受续跑 | `run-993a88d4-3ac4-4f0f-9471-f4ec5ebf5341`：finished；runDelta3/outside0；events762；无 truncation；无 temp/outside mutation；driver 五 check + unique override/single-record drift/order checks PASS |
| 接受审计 commit | `3a1e11d5db6218da8e4a68b33eb8646e1a304320` |
| 当前计数 | Wiki-only242 不变 migrated48/partial5/blocked120/OOS69；G8 242=migrated102/partial4/blocked67/OOS69；Unified254/source12 completed112/blocked_runtime61/blocked_data3/OOS72/regression5/stale1；full112/partial3/none139；actionable0；`implementation_gap_no_unresolved_data_fields` **仍为 53**；status=`blocked_runtime` 且 blocker=`blocked_data` 的家族行 **仍为 1**（勿与 impl-gap 混淆）；provisional64=runtime61/data3；hero63/item1；**Varus Q 缺席** |
| 报告口径 | 严格 verified completion **112/254=44.1%**；completed+provisional descriptive coverage **仍为 176/254=69.3%** |
| digests | Unified `69832c2a7e7a473b64fd102771cb8055d63683245d76fdccff54598ef329c018`；Wiki `927d8b5a729fe5a00ce4428cf854cb244dcf78b556afc77e711c9b8cb68126c7`（不变） |
| OOS / 真队列 | `out_of_scope=72` 为**最终跳过分类**：无实现/模板/后续队列。真剩余队列 **仅 64** = blocked_runtime61 + blocked_data3 |
| 完成语义 | Varus Q 完成/`actionableKeyCount=0` **不是**停工条件；总体 Goal **仍活跃**；治理 tasks **126**（docs commit pending driver） |

## 9. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1309981 / rev4026469 / timestamp2026-06-09T22:00:25Z / canonical3888 / SHA `bdbbe064…db2659dd`；normalized4131 / SHA `bb5af7ba…0c1f8e`；local raw3888 / SHA `5a350cec…487962` materialization caveat only |
| 边界 | exact `completedBoundary`；满蓄力最大距离选定主目标首个敌人，不是完整 Q |
| tags | exact 四 tags 序：`ability_cost_cooldown` / `active_physical_damage` / `bonus_ad_ratio` / `max_charge_max_range_selected_primary_first_hit_scaffold` |
| 公式 / fixtures | `360+1.20*(ad.resolved-ad.base)`；CritEligible false；§7 fixtures |
| Backend | owning `d493781…`；focused sibling 38/38 + full1123；external check-only；standalone；无 live |
| Wasm | exact `df61794…`；中断/复验/gofmt 历史诚实记录；英雄名 `_test.go` 仅测试/治理；无生产/Web 写入 |
| 审计 | 接受 `3a1e11d…`（首轮 timeout/outside temp 已拒绝）；counts 与 §8 一致；tasks126 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成 |
