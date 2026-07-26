TASK_KEY: wasm-generic-vayne-tumble-next-basic-attack-bonus
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI - 薇恩 Q 闪避突袭（Tumble）下一次普攻加伤 Phase-A-v2 详细设计

关联验证记录：[通用 ABI 薇恩 Q 闪避突袭 Tumble 下一次普攻加伤 Phase-A-v2 验证记录](../../测试记录/wasm/通用ABI-薇恩Q闪避突袭Tumble下一次普攻加伤Phase-A-v2-验证记录-2026-07-26.md)。本任务将精确候选 `hero_skill|hero_vayne|Q|闪避突袭` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `distance_or_ratio_input`（raw provenance 仍可保留 `distance_based_damage_modifier`）。**不**宣称 dash/位移/距离/地形/几何、普攻重置/windup/节奏、隐身/R、吸血/治疗、暴击/RNG/miss/dodge/完整 on-hit、多目标/建筑、其他 rank/完整 Tumble、live migration/publish/E2E/完整保真。本闭环**恰好是 Rank5 施放武装后、下一次 source-owner 普攻命中的一笔非暴击/不可复制物理加伤**，**不是**完整 Q。冻结方案：`FROZEN_PLAN_REV vayne-q-tumble-next-basic-attack-bonus-phase-a-v2`。

## 0. 设计审查历史

| 轮次 | Run | 裁决 | 模型 / 元数据 | 吸收要点 |
| --- | --- | --- | --- | --- |
| v1 | `run-48281305-6e7f-4783-99cd-61184e0bdcf7` | **REVISE** | top-level grok-4.5 / high / false；runDelta0；无 mutation/truncation | 接受修正：状态作用域为 `state_scope/provider`；listener matcher 恰好 `event/basic_attack_hit` + `event/source_owner`；AP 为 Batch-B external/check-only |
| v2 | `run-d7e5282c-818a-47ae-8126-ff50b5ed7853` | **READY** | top-level grok-4.5 / high / false；runDelta0；无 mutation/truncation | 正式最终设计门控 |

Production Wasm / public ABI / Web 变更**不**需要——本切片为文档/治理；实现证据已由 Backend/Wasm/审计提交。

## 1. 目的与非目标

### 1.1 目的

在通用 ABI 下，对薇恩 Q 闪避突袭建立**有界 Phase-A v2** 证据闭环：Rank5 施放耗蓝 30 / CD 2000ms，武装 provider-scope 状态 3000ms；下一次 source-owner `basic_attack_hit` 结算一笔非暴击/不可复制物理加伤 `1.15 * total AD + 0.50 * AP` 后消费状态，使候选进入 `completed/full/generic_runtime`（G8 `migrated`）。

### 1.2 非目标（completed-boundary exclusions）

下列为 **completed-boundary exclusions**（**不是** remaining blockers，亦**不是**已建模近似）：

- dash / movement / distance / terrain / geometry
- BA reset / windup / cadence
- invisibility / R
- lifesteal / healing
- crit / RNG / miss / dodge / full on-hit
- multi-target / structures
- other ranks / full Tumble
- live migration / Admin publish / browser E2E / full fidelity

**精确下一次普攻加伤有界完成 ≠ 完整 Q 保真。**

## 2. 权威来源

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_vayne\|Q\|闪避突袭` |
| Wiki request / resolved | `Template:Data Vayne/Q` → `Template:Data Vayne/Tumble` |
| Wiki 身份 | pageId `1309988`；revision `4015566`；timestamp `2026-05-05T15:55:50Z`；canonical raw bytes `1735`；SHA256 `5ae387c07aa6c510a9da57df976b6e6ba9d3b52490fa91ce59e1221813fe9dad` |
| normalized | `数据参考/lol-wiki-current-champions/normalized/generic/vayne-q.json` 与 pages sibling 为权威 |
| local raw caveat | bytes `1733` / SHA256 `5723bf5ffbc6449f756aa33a8387c40a20039886b3665eddcb11ac1cac5914ca`——**local raw materialization caveat only**；**故意不断言**字节等价，亦**不得**表述为源矛盾；canonical identity 仍为 sidecar/pages |
| 数值真源 | **仅** Wiki；**无** DDragon / OCR 真理 |
| sourceCount | **仍为 12**（9 active + 3 generators；无新源） |

## 3. 有界 Phase-A 合同

| 环节 | 合同 |
| --- | --- |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_next_basic_attack_bonus; cast_arm_provider_state; physical_1_15_ad_plus_0_50_ap; mana30_cooldown2000ms; no_dash_ba_reset_invisibility_lifesteal_crit_rng_or_full_tumble` |
| G8 governed tags（序） | `rank5_next_basic_attack_bonus_within_3s`、`physical_1_15_total_ad_plus_0_50_ap`、`phase_a_excludes_dash_geometry_attack_reset_and_lifesteal` |
| Unified tags（表示层） | 既有全局 canonical sort 可能发出不同序——**表示层规范化**，**不是**合同丢失；**无** governed `distance_or_ratio_modifier` |
| Rank5 | cast 耗蓝 30 / CD 2000ms；武装 provider-scope 状态 3000ms；下一次 source-owner 普攻命中一笔物理加伤后消费 |
| 状态 | enrich 既有 Tumble 身份：`provider_hero_vayne_tumble` / `ability_hero_vayne_tumble`（`ability_key=tumble`；**不**新建第二 Q 身份）；provider-scope `tumble_empowered_attack_ready` max1 / duration3000ms / refresh_on_write / default0 |
| 施放 | 恰好一次 provider-scope override `ready=1`、**无**伤害；成功施放自然发出一次 `ability_started` |
| Listener | ability_id NULL；ALL 恰好 `event/basic_attack_hit` + `event/source_owner`（**不得** `ability/basic_attack`）；门控 `ready≥1` 后加伤再 override `ready=0`；无 emit_event |
| 伤害公式 | 恰好一笔非暴击/不可复制物理 `add(mul(const 1.15, read source.attr.ad.resolved), mul(const 0.50, read source.attr.ap.resolved))`（total AD + AP；嵌套二元） |
| 兼容 | 与既有 Silver Bolts、Spellblade 共存：Silver Bolts **无**额外叠层；Spellblade 至多一次武装；Batch-B BA 普通伤害仍独立 |
| 数值交叉 | AD100/AP40/armor100 → raw135 / mitigated67.5；t2999 仍 proc、t3000 过期无加成；下一次 source BA 消费后第二次无 Q bonus；t0/t1999/t2000 CD success/skip/success；mana29 跳过不武装；opponent hit / unrelated spell 不消费 |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E；**不**宣称 rebuilt/synced Wasm asset |

## 4. 通用 ABI 图

```text
Wiki Template:Data Vayne/Tumble (page1309988 / rev4015566；content SHA 5ae387c0…；raw1735)
  → Backend seed（lol_generic_vayne_tumble_next_basic_attack_bonus_seed.sql @ e88e172；
     hero_vayne/ad/ap/mana + Batch-B BA + existing Tumble = external existing-data/check-only；
     不物化 identity/panel/resource/basic/mount values；
     enrich provider_hero_vayne_tumble / ability_hero_vayne_tumble
     + provider-scope state + cost/CD + impact arm + listener/damage graph）
    → Wasm CompileGeneric → RunGeneric
       mana cost + CD gate → arm ready=1 → next source-owner BA hit
       → physical bonus 1.15*AD+0.50*AP → consume ready=0
    → 英雄名 _test.go 仅为回归/治理证据（排除生产）
```

## 5. Backend 所有权 / 前置

| 项 | 合同 |
| --- | --- |
| seed | `db/game_manage/seeds/lol_generic_vayne_tumble_next_basic_attack_bonus_seed.sql`（bytes `40100`；SHA256 `54c82b474d1be9863cce8bf8866f77c40cca01b9608de61c0e78d7db5f6b5154`） |
| JUnit | `LolGenericVayneTumbleNextBasicAttackBonusSeedSqlTest`（bytes `33286`；SHA256 `959085a0e09c86ce16d25ea76c5c97d842eb7e6e54b18a7bf48e05e0df153b72`） |
| README | `server/data_manage/README.md`（Backend owning 切片内更新） |
| owning | `e88e172b9627ee2e98447f576fba3549be8d8153`（`run-91329062-2c72-47d5-85b2-4e79eca8ee15`；delta3/outside0；events1353/truncated0；focused51/51 PASS；首轮全量曾遇无关瞬时 KogMaw StackOverflow；隔离 KogMaw10/10 PASS；第二轮全量 Maven1101/1101 PASS） |
| 前置 | **external existing-data/check-only**（`hero_vayne` / ad / ap / mana / Batch-B BA / existing Tumble）；**不**物化 identity/panel/resource/basic/mount；**不**重建 Batch-B；**不**新建第二 Q 身份 |
| live | **无** live seed execution |

## 6. Wasm 测试-only 证据

| 项 | 合同 |
| --- | --- |
| exact path | `wasm/tinygo_engine_v2/internal/runtime/generic_vayne_tumble_next_basic_attack_bonus_test.go`（**仅** `_test.go`） |
| bytes / SHA（commit blob） | `60827` / SHA256 `74c6560e9da5c8c5fe2c1ce1f9d8d5ae6f064f71ae6ff622014162c118d65b2f` |
| commit / run | `36d5a49c7b7e2eb36d9444fd30a70e6efa927b64`；`run-d97df9f8-9e07-4dc9-970b-73df0a904ebd`（delta1/outside0；events1338/truncated0；focused PASS） |
| 地位 | 英雄名 `_test.go` **仅为**回归/治理证据，**排除**于生产构建；**无**生产 hero switch |
| 主验证 | focused PASS；post-commit full `go test -count=1 ./...` PASS；bench mean **111.39us** |
| 生产 / Web | **无**生产 Wasm / public ABI / asset / Web 写入；**未**资产重建/同步 |

## 7. 审计迁移与完成语义

| 项 | 合同 |
| --- | --- |
| 审计 commit | `1bb07218ab08e0a6eabe9b999786e5afe9d0636f` |
| 审计 run | `run-0493e9ef-ccb6-4d1b-8fe1-4d75133ffe10`（delta8/outside0；events1249/truncated0；五 check PASS） |
| 主验收 | 五审计 check + exact semantics PASS；`git diff --check` PASS |
| 当前计数 | Wiki-only242 不变 migrated48/partial5/blocked120/OOS69；G8 242=migrated100/partial4/blocked69/OOS69；Unified254/source12 completed110/blocked_runtime63/blocked_data3/OOS72/regression5/stale1；full110/partial3/none141；actionable0；`distance_or_ratio_input` **5**（Vayne Q 离开）；`implementation_gap` **仍为 54**；provisional66=runtime63/data3；hero65/item1；Vayne Q 缺席；剩余 item=`3097\|盈能` |
| 报告口径 | 严格 verified completion **110/254=43.3%**；completed+provisional descriptive coverage **仍为 176/254=69.3%** |
| digests | Unified `69832c2a7e7a473b64fd102771cb8055d63683245d76fdccff54598ef329c018`；Wiki `927d8b5a729fe5a00ce4428cf854cb244dcf78b556afc77e711c9b8cb68126c7`（不变） |
| OOS / 真队列 | `out_of_scope=72` 为**最终跳过分类**：无实现/模板/后续队列。真剩余队列 **仅 66** = blocked_runtime63 + blocked_data3 |
| 完成语义 | Vayne Q 完成/`actionableKeyCount=0` **不是**停工条件；总体 Goal **仍活跃**；治理 tasks **124**（docs commit pending driver） |

## 8. 停止条件与验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1309988 / rev4015566 / timestamp2026-05-05T15:55:50Z / content SHA `5ae387c0…` / raw1735；local raw caveat 无等价主张 |
| 边界 | exact `completedBoundary`；provider-scope arm + next BA bonus；不是完整 Q |
| 设计审查 | v1 REVISE 已吸收；v2 READY 为正式门控 |
| Backend | owning `e88e172…`；focused51 + full1101；external check-only；无 live |
| Wasm | exact `36d5a49…`；仅 `_test.go`；无生产/Web/资产重建 |
| 审计 | 接受 `1bb0721…`；counts 与 §7 一致；tasks124 |
| 发布 | 无 live / publish / push / E2E；不宣称 full fidelity / 总体 Goal 完成 / rebuilt Wasm asset |
