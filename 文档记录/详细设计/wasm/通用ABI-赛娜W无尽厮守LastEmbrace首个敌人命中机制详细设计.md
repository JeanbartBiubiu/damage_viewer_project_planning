TASK_KEY: wasm-generic-senna-last-embrace-first-enemy-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI - 赛娜 W 无尽厮守（Last Embrace）首个敌人命中机制详细设计

关联验证记录：[通用 ABI 赛娜 W 无尽厮守 Last Embrace 首个敌人命中机制验证记录](../../测试记录/wasm/通用ABI-赛娜W无尽厮守LastEmbrace首个敌人命中机制验证记录-2026-07-26.md)。本任务将精确候选 `hero_skill|hero_senna|W|无尽厮守` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称 cast time / Effect at cast time end / direction / range / width / line geometry / projectile travel / collision / first-enemy acquisition、attachment 1s / target-death early spread / delayed root / root duration / primary or surrounding AOE、untargetable interaction / spellshield、other ranks/siblings/loadout/bootstrap/crit/on-hit、live migration/publish/E2E，或完整 Last Embrace/游戏保真；本闭环**恰好是一次选定主目标首个敌人物理命中**，**不是**完整 W；**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV senna-w-last-embrace-first-enemy-hit-phase-a-v2`（有效 DESIGN_READY `run-96bfe31f-f482-4fef-b6a7-38566d52b85c`；strict model；runDelta0/diff0；1900/1900 parseable events；39/39 complete tool groups；无 truncation / mutation。先前 v1 `run-0ebc4622-b66e-43b9-9d32-f5817c93451f` 返回 READY，但因一个未完成的只读 grep 组而**无效**为正式设计门控；其非阻塞建议已接受进 v2，且该 run **无**写入）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_senna\|W\|无尽厮守` |
| Wiki | 请求 `Template:Data Senna/W`，解析为 `Template:Data Senna/Last Embrace`；pageId `1409576`；revision `4009139`；timestamp `2026-04-15T21:34:10Z`；canonical raw bytes `1656`；SHA256 `48698aa2864b79564b1ea0ed624de8fc7123c3127c1e56deaa002d1aad3c8492`；normalized sidecar `数据参考/lol-wiki-current-champions/normalized/generic/senna-w.json` bytes `2120` / SHA256 `c570469e807dcf9a0713af6bb0da3ab8d3be1bc61f192a307b59e7a10a5fdc8b` plus pages sibling bytes `685` / SHA256 `7f9ffc935d079acb610a07925eccb865b2baf7ecabe16784960d34e2341f41f4` 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw materialization 为 `1651` bytes，SHA256 `737cc69b6ea13da8d61437e3da37a799cc2779bd56516d166af5890dc6090d5e`。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾（local raw materialization caveat only） |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_selected_primary_champion_first_enemy_single_physical_hit; immediate_impact_scaffold; physical_230_plus_0_90_bonus_ad; no_cast_time_effect_at_cast_time_end_direction_range_width_line_geometry_projectile_travel_collision_first_enemy_acquisition_attachment_1s_target_death_early_spread_delayed_root_primary_or_surrounding_aoe_untargetable_interaction_spellshield_other_ranks_or_full_fidelity` |
| governed tags（序） | `ability_cost_cooldown`、`active_physical_damage`、`bonus_ad_ratio`、`immediate_impact_scaffold`（**无** completed salvage tag） |
| Rank-5 active | 70 mana；11000ms cooldown；immediate selected-primary-champion first-enemy single physical hit scaffold；每次成功施放恰好一笔非暴击/不可复制物理命中 `230 + 0.90 * (source.attr.ad.resolved - source.attr.ad.base)`（**精确二元树** `add(const 230, mul(const 0.90, sub(read source.attr.ad.resolved, read source.attr.ad.base)))`；**显式 bonus AD 减法**；不得按 total-AD 直读，亦不得省略 base 相减；伤害类型 **20220** + add 策略 **20170**；**无** 20230；**无**显式 event op）；成功施放自动合成恰好一次 `ability_started`；**零** W state / modifier / listener / matcher / repeat / control / root / secondary-target；**无** W-specific type |
| Phase-A 语义框定 | 将 Rank-5 leveling 数值的一次所选施加应用到所选主冠军，作为**有界选定主目标首个敌人单次物理命中**。Immediate impact 为 Phase-A scaffold；**不**建模 cast/Effect at cast time end/direction/range/width/line/projectile/collision/acquisition、attachment/death spread/delayed root/surrounding AOE，或完整 W 保真 |
| Standalone | Senna W provider **独立**；**仅**挂载本 W；**不**合成 P/Q/E/R/basic；**不**合成 W state/modifier/listener/root/control/secondary-target 结构；**不**合成 Batch-B 或 sibling Senna 机制 |
| Backend 前置 | 仓库**无** repository-owned `hero_senna` / AD / mana materializer；seed/JUnit 仅记录 **external-existing-data/check-only** 前置；**不**写入 identity/panel/resource materialization；**不** live-publish |
| 数值交叉 | base0/resolved0/armor0 → raw/final230；base60/resolved60/armor0 → raw/final230；base60/resolved160/armor0 → raw/final320；base60/resolved160/armor100 → raw320/final160；base60/resolved260/armor100 → raw410/final205；base0/resolved100 与 base60/resolved160 在 armor0 下均 raw/final320（证明 bonus-AD 减法） |
| 日程交叉 | mana210 / baseAD60 / resolvedAD160 / HP1000 / armor100：t0 / t10999 / t11000 → success / skip / success；恰好两笔 W damage；final mana70 / HP680；两次自动 W `ability_started`；mana69 → resource skip / mana/HP 不变 / 无 W damage/event |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标（selected primary champion）结算一次有界首个敌人单次物理命中；不代表完整 Last Embrace 弹道、附着、死亡提前扩散、延迟禁锢、周围 AOE 或完整 W。下列排除为 **completed-boundary exclusions**，**不是** remaining blockers，亦**不是**已建模行为的近似：

| 排除 | 说明 |
| --- | --- |
| cast / Effect at cast time end / direction / range / width / line / geometry | 施法时间、施法结束生效、方向、射程、宽度、直线与几何全部排除 |
| projectile / travel / collision / first-enemy acquisition | 弹道、飞行、碰撞与首敌获取全部排除 |
| attachment 1s / target-death early spread | 1s 附着与目标死亡提前扩散全部排除 |
| delayed root / root duration / primary or surrounding AOE | 延迟禁锢、禁锢时长、主目标或周围 AOE 全部排除 |
| untargetable interaction / spellshield | 不可选中交互与法术护盾全部排除 |
| ranks 1–4 | 仅 Rank5 |
| other Senna abilities / passives / siblings / loadout / bootstrap | 无 P/Q/E/R/basic 耦合；不合成 sibling；无负荷/bootstrap |
| equipment / crit / on-hit | 无装备/暴击/on-hit 耦合 |
| live migration / Admin publish / browser E2E / full Last Embrace / full-game fidelity | 发布与完整保真不在本闭环；**恰好一次选定主目标首个敌人物理命中**，不是完整 W |

## 3. 端到端数据流

```text
Wiki senna-w.json (page1409576/rev4009139；canonical SHA 48698aa2…)
  → Backend seed（lol_generic_senna_last_embrace_first_enemy_hit_seed.sql；
     provider_hero_senna_w_last_embrace_first_enemy_hit；
     一笔物理命中 230+0.90*(ad.resolved-ad.base)；精确二元；type 20220 / add 20170；
     无 20230；无显式 event；无 W-specific type；
     hero_senna/ad/mana external-existing-data/check-only；
     不物化 identity/panel/resource；standalone 无 sibling 合成；仅 W 挂载）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；Built 与独立 Web worktree 资产已与当前 build 同步且本轮不变）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 physical first-enemy damage（精确二元 230+0.90*(ad.resolved-ad.base)；20220/20170）
    → 自动 ability_started ×1 / 成功施放
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_senna_last_embrace_first_enemy_hit_seed.sql`（SHA256 `0327787ad71b6bd75cc595565fa11bcccd5554e9942c9a8b198b0f6faf95efc7`）+ `LolGenericSennaLastEmbraceFirstEnemyHitSeedSqlTest`（SHA256 `9bb02ffd38f3b79d62ff4264d3a55cb5fa41a56bd0a0f2622bc2d5f0d35d75ff`）；README `server/data_manage/README.md` SHA256 `1ad375f745be26dffe0b56500d66d6e4f6718259468f970b7a243fb2d58c55af`：独立 `provider_hero_senna_w_last_embrace_first_enemy_hit`；70 mana / 11000ms CD；immediate selected-primary-champion first-enemy single physical hit scaffold；一笔精确二元物理；`hero_senna`/ad/mana 为 **external-existing-data/check-only**（不物化 identity/panel/resource；不 live-publish；standalone 无 Batch-B/sibling 合成；仅 W 挂载）。owning `c0c309015e36f66d0523c20715ce887a786b252f`（`run-713c4d15-a004-4996-8322-9c0028c5eea3`；runDelta3/outside0；主 focused68 / full954 PASS）。镜像 `b90607b7ab31f5e1527354dccf5af853b6254dc4`（`run-c70b5ca7-f9cb-4efa-bf1d-6cbbae344466`；runDelta3/outside0；精确 parity）。**无** live seed execution |
| Web | **无**本机制 Web 源码或资产写入/commit。Built 与独立 Web worktree 资产均 **1,169,377** bytes / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`；本轮 test-only Wasm 追加后资产**保持同步且不变**。**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E |
| Wasm | exact `ebf77309e1e76f9a38aaeab9166e6d214bbf3847`（`generic_senna_last_embrace_first_enemy_hit_test.go`；test bytes `62703` / SHA256 `4a449fc09248fe7842b909a373edd5353d4fb1eed8831b655f9146bcd5696051`）；实现 run `run-5ba15211-723b-4ced-9ea0-e29152afd34c`（runDelta1/outside0）。主验证：focused / full / bench / build / smoke / benchmark PASS。Built 与独立 Web worktree 均 **1,169,377** / `65a4…c6a0`；**无** Web 文件变更/拷贝；**无**生产 Wasm 写入/commit |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放（mana210；baseAD60；resolvedAD160；armor100） | 扣 70 mana；一笔物理命中（raw320→final160）；CD 武装；一次 `ability_started` |
| t10999（CD 内） | 恰好一次 cooldown skip；不扣 mana、无伤害、无新 `ability_started` |
| t11000 再次成功 | 第二次物理命中；两笔 W damage；final mana70；HP1000→680；两次 `ability_started` |
| mana69 | resource skip；mana/HP 不变；无 W damage/event |
| 交叉 base0/resolved0/armor0 | raw230；final230 |
| 交叉 base60/resolved60/armor0 | raw230；final230 |
| 交叉 base60/resolved160/armor0 | raw320；final320 |
| 交叉 base60/resolved160/armor100 | raw320；final160 |
| 交叉 base60/resolved260/armor100 | raw410；final205 |
| bonus-AD 减法证明 | base0/resolved100 与 base60/resolved160 在 armor0 下均 raw/final320 |
| Standalone isolation | 仅 W 挂载；不合成 P/Q/E/R/basic；无 W state/modifier/listener/root/control/secondary-target |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止把 exclusions 写成 remainingGap 或近似实现；禁止物化 check-only 身份/面板/资源；禁止合成 Batch-B/sibling Senna；禁止引入 W-specific type；禁止把本首个敌人命中误称为完整 W |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY | `run-96bfe31f-f482-4fef-b6a7-38566d52b85c`；READY；strict model；runDelta0/diff0；1900/1900 parseable events / 39/39 complete tool groups；无 truncation/mutation。先前 v1 `run-0ebc4622…` 返回 READY，但因未完成只读 grep 组无效为正式门控；非阻塞建议已接受进 v2；该 run 无写入 |
| Backend owning | owning `c0c309015e36f66d0523c20715ce887a786b252f`；`run-713c4d15-a004-4996-8322-9c0028c5eea3`（runDelta3/outside0）；主 focused68 / full954 PASS；seed SHA `0327787a…95efc7`；JUnit SHA `9bb02ffd…5d75ff`；README SHA `1ad375f7…8c55af` |
| Backend 镜像（Wasm worktree） | `b90607b7ab31f5e1527354dccf5af853b6254dc4`；`run-c70b5ca7-f9cb-4efa-bf1d-6cbbae344466`（runDelta3/outside0；精确 parity） |
| Wasm exact | `ebf77309e1e76f9a38aaeab9166e6d214bbf3847`；`run-5ba15211-723b-4ced-9ea0-e29152afd34c`（runDelta1/outside0）；focused/full/bench/build/smoke/benchmark PASS；test bytes62703 / SHA `4a449fc0…696051`；Built/独立 Web 资产 `1,169,377` / `65a4…c6a0`；无 Web 写入 |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持 `1,169,377` / `65a4…c6a0` |
| 审计接受 | commit `24e2dd3c5261dcba84ad021c3c05aaaa01e590af`；`run-fa34263a-ac06-44b4-a852-3e80417bda88`（strict model；runDelta8/outside0）。主五检查通过；语义比较证明**仅** Senna W G8/Unified 记录变化，且 provisional **仅**移除 Senna W |
| 最终清单 | registry 242 = migrated48 / partial5 / blocked120 / OOS69；G8 242 = migrated85 / partial4 / blocked84 / OOS69；inScope173；Unified sourceCount12 / total254；completed95 / partial_actionable0 / ready0 / blocked_runtime78 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full95 / partial3 / none156；implementation gap61；actionable0；provisional81（runtime78/data3；hero79/item2）。治理 tasks 必须为 109。报告口径：严格 verified completion **95/254=37.4%**；completed + provisional implementation-description coverage **176/254=69.3%**；当前 81 张 template-eligible blocked 键均有 provisional 卡；provisional 仍为 unverified，**不是** completed 主张 |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_physical_damage|bonus_ad_ratio|immediate_impact_scaffold`）、空 `remainingGap`。raw upstream 字段按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。

主会话语义比较：ordered keys 242/254 不变；**仅** Senna W 记录/机制语义变化（metadata source hash / generatedAt 除外）；provisional 仅移除 Senna W（82→81）。Registry / Batch-G / G8 / Unified / provisional checks PASS。先前 completed/migrated 记录保持锁定。稳定 digests 不变。

**Web Wasm 资产现状（本机制当前状态）**：本轮为 test-only Wasm 追加，**无**生产 Wasm 或 Web 写入/commit。Built 与独立 Web worktree 源资产保持与标准 build 精确一致——size `1,169,377` / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`。该状态为既有同步结果的延续（artifact parity）；**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。

非目标（再次强调）：cast/Effect at cast time end/direction/range/width/line/geometry/projectile/travel/collision/first-enemy acquisition、attachment 1s/target-death early spread/delayed root/root duration/primary or surrounding AOE、untargetable/spellshield、ranks1-4、other Senna abilities/passives/siblings/loadout/bootstrap、equipment/crit/on-hit、live migration/Admin publish/browser E2E/full Last Embrace/full-game fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Last Embrace/游戏技能保真；本闭环**恰好是一次选定主目标首个敌人物理命中**，**不是**完整 W；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。Senna W 为 standalone；Backend 无 repository-owned `hero_senna`/AD/mana materializer——仅 external-existing-data/check-only；伤害为 **bonus AD 显式减法**（精确二元）；类型 **20220** / add **20170**；无 20230；无 W-specific type。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1409576 / rev4009139 / timestamp2026-04-15T21:34:10Z / canonical raw1656 / SHA256 `48698aa2…3c8492`；normalized2120 / SHA `c570469e…5fdc8b`；pages685 / SHA `7f9ffc93…1f41f4`；sidecar/pages canonical；local raw1651 / SHA `737cc69b…090d5e` materialization caveat only——非源矛盾主张 |
| 稳定键 | 唯一 `hero_skill\|hero_senna\|W\|无尽厮守` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers；恰好一次选定主目标首个敌人物理命中 |
| 公式 / fixtures | 精确二元 `230+0.90*(ad.resolved-ad.base)`；type 20220 / add 20170；无 20230；无显式 event op；无 W-specific type；数值与 CD/resource 日程；自动 `ability_started`；零 W state/modifier/listener/root/control；standalone；四 tags 序（无 salvage tag）；含 bonus-AD 减法证明 |
| Backend | owning `c0c3090…` / 镜像 `b90607b…`；focused68 + full954；无 live seed |
| Wasm | exact `ebf7730…`；focused/full/bench/build/smoke/benchmark；无生产 Wasm/Web 写入 |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持同字节/同 SHA |
| 审计 | commit `24e2dd3…`；接受 run `run-fa34263a…`；G8 migrated + 空 remainingGap；Unified completed/full；仅 Senna W 语义对象变化；provisional 仅移除 Senna W；counts 与 §5 最终清单一致 |
| 设计门控 | 有效 READY `run-96bfe31f…`；runDelta0/diff0；1900 events / 39/39 complete tool groups；无 truncation/mutation；v1 `run-0ebc4622…` 虽返回 READY 但无效为正式门控 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
