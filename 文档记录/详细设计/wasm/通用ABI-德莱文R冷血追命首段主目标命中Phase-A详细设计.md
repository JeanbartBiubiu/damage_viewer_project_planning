TASK_KEY: wasm-generic-draven-whirling-death-primary-outbound-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI - 德莱文 R 冷血追命（Whirling Death）首段主目标命中 Phase-A 详细设计

关联验证记录：[通用 ABI 德莱文 R 冷血追命首段主目标命中 Phase-A 验证记录](../../测试记录/wasm/通用ABI-德莱文R冷血追命首段主目标命中Phase-A验证记录-2026-07-26.md)。本任务将精确候选 `hero_skill|hero_draven|R|冷血追命` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称 cast timing、direction/projectile/travel/collision/sight、recast/reversal/return/homing/second pass、execute/Adoration、multi-target/falloff/reset/map edge/once-per-pass geometry、ranks1–2、siblings/basic/loadout、live/full fidelity；本闭环**恰好是一次选定主目标首段出站物理命中**，**不是**完整 R；**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV draven-r-whirling-death-primary-outbound-hit-phase-a-v2`（正式最终 DESIGN_READY `run-08960edd-4b96-45fc-91d1-97d96a10c14c`；runDelta0；1707/1707 parseable events；61/61 complete tool groups；无 truncation/mutation/blockers。先前 v1 `run-816b8669-982b-4bd6-9334-8dc865200c7f` 为 **valid REVISE**：runDelta0；2236/2236 parseable events；74/74 complete tool groups；无 truncation/mutation；接受 issues——impl-gap 期望 56→55；one-case shared table 非最小，故改用英雄名 `_test.go` 作为 test-only 证据。**v2 为正式最终 READY 门控**。Production Wasm / public ABI / Web 变更**不**需要）。

## 1. 目的与非目标

### 1.1 目的

在通用 ABI 下，对 Draven R 建立**有界 Phase-A** 证据闭环：Rank-3 选定主目标**首段出站**单次物理命中脚手架（immediate impact），使候选进入 `completed/full/generic_runtime`（G8 `migrated`），并诚实记录 Wiki 身份、公式、fixtures、Backend 自包含种子、Wasm 测试-only 证据与审计计数迁移。

### 1.2 非目标

下列为 **completed-boundary exclusions**（**不是** remaining blockers，亦**不是**已建模近似；排除**不**等于否认游戏行为存在）：

- cast timing / Effect-at-cast 时序
- direction / projectile / travel / collision / sight
- recast / reversal / return / homing / second pass
- execute / Adoration 阈值
- multi-target / damage falloff / reset / map edge / once-per-pass geometry
- ranks 1–2
- sibling skills / basic / loadout / bootstrap 合成依赖
- live migration / Admin publish / browser E2E / 完整 Whirling Death / 完整游戏保真

**精确首段出站有界完成 ≠ 完整 R 保真。**

## 2. 权威来源

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_draven\|R\|冷血追命` |
| Wiki request / resolved | `Template:Data Draven/R` → `Template:Data Draven/Whirling Death` |
| Wiki 身份 | pageId `1307072`；revision `4040576`；timestamp `2026-07-06T14:27:37Z`；canonical raw bytes `3079`；SHA256 `e38551b6eeefa0306cd40a3e15473c8983075f88edbe007915e3d9213a08adce` |
| normalized | `数据参考/lol-wiki-current-champions/normalized/generic/draven-r.json` bytes `3361` / SHA256 `74e8f95ca03c86a5c809255d6309e4639e949337f4f36ee4fcfd4e8403416754`；pages sibling `pages/draven-r.json` bytes `698` / SHA256 `d8f5a8856951ec09e60e0aacb38cd3d90e767bd2d347b74eee50282b29c96863` 为权威 |
| local raw caveat | `raw/draven-r.wikitext` bytes `3079` / SHA256 `1110179b1771c03c8ff67b428d6fa7a5b0ba42caf19e241ce512a199ef812059`——**local raw materialization caveat only**；sidecar/pages 拥有 canonical 身份；**故意不断言**字节等价，亦**不得**表述为源矛盾 |
| sourceCount | **仍为 12**（9 active + 3 generators；无新源） |

## 3. 有界 Phase-A 合同

| 环节 | 合同 |
| --- | --- |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank3_selected_primary_champion_single_first_outbound_pass_hit; immediate_impact_scaffold; physical_400_plus_1_50_bonus_ad; no_cast_time_direction_projectile_travel_collision_sight_recast_reversal_return_homing_second_pass_execute_adoration_threshold_multitarget_damage_falloff_reset_map_edge_once_per_pass_geometry_or_full_fidelity` |
| governed tags（序） | `ability_cost_cooldown`、`active_physical_damage`、`bonus_ad_ratio`、`immediate_impact_scaffold` |
| Rank-3 active | 100 mana；80000ms cooldown；immediate selected-primary-champion first-outbound-pass single physical hit scaffold；每次成功施放恰好一笔非暴击/不可复制物理命中 `400 + 1.50 * (ad.resolved - ad.base)`（**精确嵌套二元** `add(const 400, mul(const 1.50, sub(read source.attr.ad.resolved, read source.attr.ad.base)))`；**显式 bonus AD 减法**；不得按 total-AD 直读，亦不得省略 base 相减；伤害类型 **20220** + add 策略 **20170**；**无** 20230；**无**显式 event op；**无** R-specific type）；成功施放自动合成恰好一次 `ability_started`；**零** R state / listener / matcher / repeat / control / projectile |
| Phase-A 语义框定 | 将 Rank-3 leveling 数值的一次所选施加应用到所选主冠军，作为**有界选定主目标首段出站单次物理命中**。Immediate impact 为 Phase-A scaffold；**不**建模 cast/direction/projectile/return/execute/Adoration/multitarget/once-per-pass，或完整 R 保真 |
| Provider | 独立 `provider_hero_draven_r_whirling_death_primary_outbound_hit`；仅当前 generic provider/ability/operation；**无**生产 runtime 变更；可与既有 Q/W/E/basic **共存**，**不**要求 sibling 发布，**不**合成 Batch-B / sibling Draven |
| 数值交叉 | baseAD62/resolved162 → raw550；armor100 → mitigated275；zero-bonus raw400 / mitigated200；另含 base62/resolved62/armor0=400、base0/resolved100 vs base62/resolved162 反证 |
| 日程交叉 | mana361 / HP1000 / armor100：t0 / t79999 / t80000 → success / skip / success；恰好两笔 R damage；两次自动 R `ability_started`；final mana161 / HP450；mana99 → resource skip |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 4. 通用 ABI 图

```text
Wiki draven-r.json (page1307072/rev4040576；canonical SHA e38551b6…)
  → Backend seed（lol_generic_draven_whirling_death_primary_outbound_hit_seed.sql；
     self-contained ensure hero_draven + level-1 eight-key panel + mana361；
     provider_hero_draven_r_whirling_death_primary_outbound_hit；
     一笔物理命中 400+1.50*(ad.resolved-ad.base)；
     type 20220 / add 20170；无 20230；无显式 event；无 R-specific type；
     无 AP 要求；可与 Q/W/E/basic 共存；不依赖 sibling 发布）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；Built 与独立 Web 资产当前 hash 校验一致且本切片未写 Web）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 physical first-outbound-pass damage（嵌套 bonus-AD 公式；20220/20170）
    → 自动 ability_started ×1 / 成功施放
```

## 5. Backend 种子 / 幂等 / 共存

| 项 | 合同 |
| --- | --- |
| seed | `db/game_manage/seeds/lol_generic_draven_whirling_death_primary_outbound_hit_seed.sql`（bytes `28256`；SHA256 `b94b456855f07eef71834cffbb9188e9819fa830c70908dde974c43e4acefcb8`） |
| JUnit | `LolGenericDravenWhirlingDeathPrimaryOutboundHitSeedSqlTest`（bytes `40185`；SHA256 `a1103baf63527243ef50d30d2b381cc074b07f5ac907e21b960439371ecd3b35`） |
| README | owning 处 `server/data_manage/README.md` bytes `310636` / SHA256 `96dfcc24fdc50ffc08cbd2cf9da8d48f65e390ca022a38e1a62c91f1ea031b32` |
| 自包含 | ensure `hero_draven` + level-1 八属性面板 + mana361/361；**无** AP 要求；**不** DDL / DELETE / live / publish |
| 共存 | 独立 R provider 与既有 Q/W/E/basic **共存**；**不**要求 sibling 发布；**不**合成 Batch-B |
| 幂等 | material-change revision guard；重复应用不破坏既有 Draven 面板/sibling providers |
| owning | `0aa03bc6d0d98e5c21c8e29d6ebbd9f66e950532`（`run-63aff27e-36b5-4463-bde8-87ea2e3df5c7`；exact 3 paths；runDelta3/outside0；740 parseable events；43/43 complete tool groups；无 truncation） |
| 主验证 | 定向 Draven/Graves matrix 51 tests PASS；full `mvn test` 1043 tests PASS |
| live | **无** live seed execution |

## 6. Wasm 测试-only 证据

| 项 | 合同 |
| --- | --- |
| exact path | `wasm/tinygo_engine_v2/internal/runtime/generic_draven_whirling_death_primary_outbound_hit_test.go` |
| bytes / SHA | `42169` / SHA256 `78796042ebd79f7337fd77de552150f9198d7ae5ec2348a6009f29bc5ae219de` |
| commit / run | `5b1f661283cb0ddcc5f7649992ce18934eb41ccb`；`run-2dc1d10e-cb71-4905-b523-53af6eb45193`（exact one `_test.go`；runDelta1/outside0；726 parseable events；40/40 complete tool groups；无 truncation） |
| 地位 | 英雄名 `_test.go` **仅为**验收/治理证据，**排除**于生产构建；仅构造 generic provider/ability/operation/formula 合同；**无**英雄专用生产 runtime 分支 |
| harness | v1 指出 one-case shared table 非最小；本切片**有意**采用英雄名 test-only 文件。共享 harness **故意推迟**，直至多个同质新用例足以证明单独重构合理 |
| 主验证 | 定向 Draven R PASS；`go test -count=1 ./...` PASS；`go run ./cmd/bench` PASS（最新 main 跑 mean_us 97.90） |
| 生产 / Web | **无**生产 Wasm 写入；**无** Web 写入。当前 Built 与独立 Web 资产均为 **1,169,377** bytes / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`——此为**当前 hash 校验**，**不是**本 test-only 切片重建或变更了生产 Wasm |

## 7. Fixtures

| Fixture | 期望 |
| --- | --- |
| baseAD62 / resolvedAD162 / armor100 | raw550 / mitigated275 |
| zero bonus（resolved=base）/ armor100 | raw400 / mitigated200 |
| mana361 / HP1000；t0 / t79999 / t80000 | success / skip / success；mana361→161；HP1000→450；两笔 R damage；两次 `ability_started` |
| mana99 | resource skip；mana/HP 不变；无 R damage/event |
| 反证 | base62/resolved62/armor0 → 400；base0/resolved100 vs base62/resolved162 同 raw（显式 bonus 减法） |

## 8. 审计迁移与完成语义

| 项 | 合同 |
| --- | --- |
| 审计 commit | `5a6ba206dfd1c95649a3003f9b79898461010087` |
| 审计 run | `run-5399d7f1-fb57-48c1-93b2-9aa2d5088178`（exact 8 paths；runDelta8/outside0；1374 parseable events；77/78 complete tool groups；无 truncation） |
| 不完整组 | 唯一 incomplete 为只读 grep（`overrideLookup|exactKey...`）仅有 running 事件；**无** mutating 事件不完整。主会话因此**独立重跑并接受**全部 generator check 与 exact record/count 断言 |
| G8 | governed `migrated`；exact 四 tags；空 `remainingGap`；raw upstream 仅 provenance |
| Unified | `completed/full`；空 blocker / gap evidence |
| provisional | Draven R **缺席**（已从 template 移除） |
| 当前计数 | registry242 不变 migrated48/partial5/blocked120/OOS69；G8 242=migrated93/partial4/blocked76/OOS69；Unified254/source12 completed103/partial_actionable0/ready0/blocked_runtime70/blocked_data3/OOS72/regression5/stale1；completionMode full103/partial3/none148；`implementation_gap_no_unresolved_data_fields` **恰好 55**；provisional73=runtime70/data3；hero_skill71/item2；排除 completed103/OOS72/regression5/stale1 |
| 报告口径 | 严格 verified completion **103/254=40.6%**；completed+provisional descriptive coverage **仍为 176/254=69.3%** |
| digests | Unified254 `69832c2a7e7a473b64fd102771cb8055d63683245d76fdccff54598ef329c018`；Wiki242 `927d8b5a729fe5a00ce4428cf854cb244dcf78b556afc77e711c9b8cb68126c7`（不变） |
| 完成语义 | `actionableKeyCount=0` 与 Draven R 完成**不是**停工条件；总体 254-key Goal **仍活跃**；闭环后应对剩余 73 张 provisional **重新排序**选择下一机制 |

## 9. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1307072 / rev4040576 / timestamp2026-07-06T14:27:37Z / canonical3079 / SHA `e38551b6…08adce`；normalized3361 / SHA `74e8f95c…416754`；local raw3079 / SHA `1110179b…812059` materialization caveat only |
| 边界 | exact `completedBoundary`；排除项为 completed-boundary exclusions；**恰好一次选定主目标首段出站物理命中**，不是完整 R |
| 公式 / fixtures | `400+1.50*(ad.resolved-ad.base)`；20220/20170；无 20230；无 R type；数值与 CD/resource 日程；自动 `ability_started` |
| Backend | owning `0aa03bc…`；focused51 + full1043；self-contained；无 live |
| Wasm | exact `5b1f661…`；英雄名 `_test.go` 仅测试/治理；共享 harness 故意推迟；无生产/Web 写入 |
| 审计 | 接受 `5a6ba20…`；incomplete 只读 grep 诚实记录；主独立验收；counts 与 §8 一致；impl-gap55；Draven R 不在 provisional |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
