TASK_KEY: wasm-generic-tristana-buster-shot-primary-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-25

# 通用 ABI - 崔丝塔娜 R 毁灭射击（Buster Shot）主目标命中机制详细设计

关联验证记录：[通用 ABI 崔丝塔娜 R 毁灭射击主目标命中机制验证记录](../../测试记录/wasm/通用ABI-崔丝塔娜R-毁灭射击主目标命中机制验证记录-2026-07-25.md)。本任务将精确候选 `hero_skill|hero_tristana|R|毁灭射击` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称 cast time、knockback/airborne/stun/reveal、displacement/terrain/immunity、secondary zero damage/turret aggro、unit-target cancel、post-cast basic attack、Explosive Charge、ranks1-2、其它崔丝塔娜技能/被动、装备/负荷/暴击/on-hit、live migration/publish/E2E，或完整 Buster Shot/游戏保真；本闭环**恰好是一次选定目标魔法命中**，**不是**完整 R；**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV tristana-r-buster-shot-primary-hit-phase-a-v1`（有效 DESIGN_READY `run-1aebb169-e25c-4e63-ba3b-6c6a509097bb`；strict model；runDelta0/diff0；1278 parseable event lines / 57/57 complete tool groups；无 truncation / mutation；三条非阻塞笔记已接受，**不是** blockers）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_tristana\|R\|毁灭射击` |
| Wiki | 请求 `Template:Data Tristana/R`，解析为 `Template:Data Tristana/Buster Shot`；pageId `1308525`；revision `4008205`；timestamp `2026-04-14T05:37:16Z`；canonical raw bytes `2385`；SHA256 `2dff322949f442acc00a7074458fd5ed9bc542d6fd143b818a9a7151e117c058`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/tristana-r.json` plus pages sibling 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw materialization 为 `2382` bytes，SHA256 `42e07f07f3188aada86d18d782c05d291f031dbbf92171e4a1120e828ebf8c7b`。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾（local raw materialization caveat only） |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank3_selected_primary_champion_single_magic_hit; immediate_impact_scaffold; magic_325_plus_0_70_bonus_ad_plus_1_00_ap; no_cast_time_knockback_stun_reveal_secondary_zero_damage_terrain_geometry_displacement_immunity_unit_target_cancel_post_basic_attack_explosive_charge_other_ranks_or_full_fidelity` |
| governed tags（序） | `ability_cost_cooldown`、`active_magic_damage`、`bonus_ad_ratio`、`ap_ratio`、`immediate_impact_scaffold`（G8 override 写入序；Unified 全局 `localeCompare` 序列化时 `ap_ratio` 可先于 `bonus_ad_ratio`——集合相同，不得误读为两套 tags） |
| Rank-3 active | 100 mana；100000ms cooldown；immediate selected-primary-champion single magic hit scaffold；每次成功施放恰好一笔非暴击/不可复制魔法命中 `325 + 0.70 * (source.attr.ad.resolved - source.attr.ad.base) + 1.00 * source.attr.ap.resolved`（**精确嵌套二元树** `add(add(325,0.70*(ad.resolved-ad.base)),1.00*ap.resolved)`；**显式 bonus AD 减法**；不得按 total-AD 直读，亦不得省略 base 相减；伤害类型 **20221** + add 策略 **20170**）；无显式 event op；成功施放自动合成恰好一次 `ability_started`；**零** R state / modifier / listener / matcher / repeat / control / knockback / stun / reveal / displacement / terrain / geometry / Explosive Charge 行为 |
| Phase-A 语义框定 | 将 Rank-3 leveling 数值的一次所选施加应用到所选主冠军，作为**有界选定目标单次魔法命中**。Immediate impact 为 Phase-A scaffold；**不**建模 cast time、击退/击飞/眩晕/揭示、位移/地形/免疫、次级零伤、单位取消、普攻后续或 Explosive Charge |
| Standalone | Tristana R provider **独立**；**不**依赖 Tristana P/Q/W/E/Explosive Charge；**不**合成 Batch-B 或 sibling Tristana 机制 |
| Backend 前置 | 仓库**无** repository-owned `hero_tristana` / AD / AP / mana materializer；seed/JUnit 仅记录 **external-existing-data/check-only** 前置；**不**写入 identity/panel/resource materialization；**不** live-publish |
| 数值交叉 | base0/resolved0/AP0/MR0 → raw/final325；base60/resolved60/AP0/MR0 → raw/final325；base60/resolved160/AP0/MR0 → raw/final395；base60/resolved160/AP100/MR0 → raw/final495；base60/resolved160/AP100/MR100 → raw495/final247.5；base60/resolved260/AP200/MR100 → raw665/final332.5；base0/resolved100 与 base60/resolved160 在 AP100/MR0 下均 raw/final495（证明 bonus-AD 减法） |
| 日程交叉 | mana300 / baseAD60 / resolvedAD160 / AP100 / HP1000 / MR100：t0 / t99999 / t100000 → success / skip / success；恰好两笔 R damage；final mana100 / HP505；两次自动 R `ability_started`；mana99 → resource skip / mana/HP 不变 / 无 R damage/event |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标（selected primary champion）结算一次有界单次魔法命中；不代表完整 Buster Shot cast、击退、眩晕、揭示、次级零伤或 Explosive Charge。下列排除为 **completed-boundary exclusions**，**不是** remaining blockers，亦**不是**已建模行为的近似：

| 排除 | 说明 |
| --- | --- |
| cast time | 施法时间全部排除 |
| knockback / airborne / stun / reveal | 击退、击飞、眩晕与揭示全部排除 |
| displacement / terrain / geometry / immunity | 位移、地形、几何与免疫全部排除 |
| secondary zero damage / turret aggro | 次级目标零伤与防御塔嘲讽全部排除 |
| unit-target cancel | 单位目标取消条件全部排除 |
| post-cast basic attack | 施放后普攻尝试全部排除 |
| Explosive Charge | E 爆炸火花叠层/耦合全部排除 |
| ranks 1–2 | 仅 Rank3 |
| other Tristana abilities / passives | 无 P/Q/W/E/basic 耦合；不合成 sibling |
| equipment / loadout / crit / on-hit | 无装备/负荷/暴击/on-hit 耦合 |
| live migration / Admin publish / browser E2E / full Buster Shot / full-game fidelity | 发布与完整保真不在本闭环；**恰好一次选定目标魔法命中**，不是完整 R |

## 3. 端到端数据流

```text
Wiki tristana-r.json (page1308525/rev4008205；canonical SHA 2dff3229…)
  → Backend seed（lol_generic_tristana_buster_shot_primary_hit_seed.sql；
     provider_hero_tristana_r_buster_shot_primary_hit；
     一笔魔法命中 325+0.70*(ad.resolved-ad.base)+1.00*ap.resolved；嵌套二元；type 20221 / add 20170；
     hero_tristana/ad/ap/mana external-existing-data/check-only；
     不物化 identity/panel/resource；standalone 无 sibling 合成）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；Built 与独立 Web worktree 资产已与当前 build 同步且本轮不变）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 magic primary-hit damage（嵌套二元 325+0.70*(ad.resolved-ad.base)+1.00*ap.resolved；20221/20170）
    → 自动 ability_started ×1 / 成功施放
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_tristana_buster_shot_primary_hit_seed.sql`（SHA256 `4481b2ac143d0b610b5a6aa416c3c32a9ceba323501c21cdbb100c8206589558`）+ `LolGenericTristanaBusterShotPrimaryHitSeedSqlTest`（SHA256 `1d929006d1aefb0eccd2bfd9476d7ef6fef0afe26c1a5f81efb1d330fbeb70d9`）；README `server/data_manage/README.md` SHA256 `17729acf726c8660a84999278f7163a017683a323da84e0385fd713b68302519`：独立 `provider_hero_tristana_r_buster_shot_primary_hit`；100 mana / 100000ms CD；immediate selected-primary-champion single magic hit scaffold；一笔嵌套二元魔法；`hero_tristana`/ad/ap/mana 为 **external-existing-data/check-only**（不物化 identity/panel/resource；不 live-publish；standalone 无 Batch-B/sibling 合成）。owning `8b98bcb7a44ded7e2a793de9765a6157caed547f`（`run-7b7557fb-14df-4db7-be59-86812b776361`；runDelta3/outside0；938 parseable events；无 truncation；Cursor/主 focused9 / adjacent53 / full911 PASS）。镜像 `30209c4ca8b1a447ba5403140b9462a4e6552dca`（`run-34e8effd-480b-4591-8bd6-030eee2c0085`；runDelta3/outside0；476 parseable events；无 truncation；精确 parity）。**无** live seed execution |
| Web | **无**本机制 Web 源码或资产写入/commit。Built 与独立 Web worktree 资产均 **1,169,377** bytes / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`；本轮 test-only Wasm 追加后资产**保持同步且不变**。**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E |
| Wasm | exact `b4d10e4ca1ad40811fc543682e2ee36a8b5750e6`（`generic_tristana_buster_shot_primary_hit_test.go`）；实现 run `run-3b606ac5-f1a1-4a88-b9a3-1c38ed257062`（runDelta1/outside0；986 parseable events；无 truncation）。主验证：`gofmt` clean；focused7 / full / bench / build / smoke / benchmark PASS。Built 与独立 Web worktree 均 **1,169,377** / `65a4…c6a0`；**无** Web 文件变更/拷贝；**无**生产 Wasm 写入/commit |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放（mana300；baseAD60；resolvedAD160；AP100；MR100） | 扣 100 mana；一笔魔法命中（raw495→final247.5）；CD 武装；一次 `ability_started` |
| t99999（CD 内） | 恰好一次 cooldown skip；不扣 mana、无伤害、无新 `ability_started` |
| t100000 再次成功 | 第二次魔法命中；两笔 R damage；final mana100；HP1000→505；两次 `ability_started` |
| mana99 | resource skip；mana/HP 不变；无 R damage/event |
| 交叉 base0/resolved0/AP0/MR0 | raw325；final325 |
| 交叉 base60/resolved60/AP0/MR0 | raw325；final325 |
| 交叉 base60/resolved160/AP0/MR0 | raw395；final395 |
| 交叉 base60/resolved160/AP100/MR0 | raw495；final495 |
| 交叉 base60/resolved160/AP100/MR100 | raw495；final247.5 |
| 交叉 base60/resolved260/AP200/MR100 | raw665；final332.5 |
| bonus-AD 减法证明 | base0/resolved100 与 base60/resolved160 在 AP100/MR0 下均 raw/final495 |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止把 exclusions 写成 remainingGap 或近似实现；禁止物化 check-only 身份/面板/资源；禁止合成 Batch-B/sibling Tristana；禁止把本命中误称为完整 R |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY | `run-1aebb169-e25c-4e63-ba3b-6c6a509097bb`；READY；strict model；runDelta0/diff0；1278 parseable events / 57/57 complete tool groups；无 truncation/mutation；三条非阻塞笔记已接受（非 blockers） |
| Backend owning | owning `8b98bcb7a44ded7e2a793de9765a6157caed547f`；`run-7b7557fb-14df-4db7-be59-86812b776361`（runDelta3/outside0；938 events；无 truncation）；Cursor/主 focused9 / adjacent53 / full911 PASS；seed SHA `4481b2ac…9558`；JUnit SHA `1d929006…70d9`；README SHA `17729acf…2519` |
| Backend 镜像（Wasm worktree） | `30209c4ca8b1a447ba5403140b9462a4e6552dca`；`run-34e8effd-480b-4591-8bd6-030eee2c0085`（runDelta3/outside0；476 events；无 truncation）；精确 parity |
| Wasm exact | `b4d10e4ca1ad40811fc543682e2ee36a8b5750e6`；`run-3b606ac5-f1a1-4a88-b9a3-1c38ed257062`（runDelta1/outside0；986 events；无 truncation）；gofmt clean；focused7/full/bench/build/smoke/benchmark PASS；Built/独立 Web 资产 `1,169,377` / `65a4…c6a0`；无 Web 写入 |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持 `1,169,377` / `65a4…c6a0` |
| 审计接受 | commit `c078ae71f9f6dd0c4e3dbe768870884d3c2d2e26`；`run-d543c652-0714-4f0b-8247-6730accbacee`（runDelta8/outside0；1410 parseable；135 complete tool groups；零 truncation）。主五检查通过；首次语义比较 helper 在 checks/G8 比较**之后**命中本地 Node `ENOBUFS`——**nonblocking local tooling caveat**；随后以更大 read buffer 重跑证明**仅** Tristana R 语义变化/移除。provisional **仅**移除该键 |
| 最终清单 | registry 242 = migrated48 / partial5 / blocked120 / OOS69；G8 242 = migrated81 / partial4 / blocked88 / OOS69；inScope173；Unified sourceCount12 / total254；completed91 / partial_actionable0 / ready0 / blocked_runtime82 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full91 / partial3 / none160；implementation gap65；actionable0；provisional85（runtime82/data3；hero83/item2）。治理 tasks 必须为 105 |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_magic_damage|bonus_ad_ratio|ap_ratio|immediate_impact_scaffold`）、空 `remainingGap`。raw upstream 字段按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。

主会话语义比较：ordered keys 242/254 不变；**仅** Tristana R 记录/机制语义变化（metadata source hash / generatedAt 除外）；provisional 仅移除 Tristana R（86→85）。Registry / Batch-G / G8 / Unified / provisional checks PASS。先前 completed/migrated 记录保持锁定。审计首次语义比较 helper 的本地 Node `ENOBUFS` 发生在五检查/G8 比较之后，**不是**检查失败；更大 buffer 重跑确认仅 Tristana R 语义变化。

**Web Wasm 资产现状（本机制当前状态）**：本轮为 test-only Wasm 追加，**无**生产 Wasm 或 Web 写入/commit。Built 与独立 Web worktree 源资产保持与标准 build 精确一致——size `1,169,377` / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`。该状态为既有同步结果的延续（artifact parity）；**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。

非目标（再次强调）：cast time、knockback/airborne/stun/reveal、displacement/terrain/immunity、secondary zero damage/turret aggro、unit-target cancel、post-cast basic attack、Explosive Charge、ranks1-2、other Tristana abilities/passives、equipment/loadout/crit/on-hit、live migration/Admin publish/browser E2E/full Buster Shot/full-game fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Buster Shot/游戏技能保真；本闭环**恰好是一次选定目标魔法命中**，**不是**完整 R；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。Tristana R 为 standalone；Backend 无 repository-owned `hero_tristana`/AD/AP/mana materializer——仅 external-existing-data/check-only；伤害为 **bonus AD 显式减法 + AP**（嵌套二元）；类型 **20221** / add **20170**。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1308525 / rev4008205 / timestamp2026-04-14T05:37:16Z / canonical raw2385 / SHA256 `2dff3229…c058`；sidecar/pages canonical；local raw2382 / SHA `42e07f07…8c7b` materialization caveat only——非源矛盾主张 |
| 稳定键 | 唯一 `hero_skill\|hero_tristana\|R\|毁灭射击` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers；恰好一次选定目标魔法命中 |
| 公式 / fixtures | 嵌套二元 `325+0.70*(ad.resolved-ad.base)+1.00*ap.resolved`；type 20221 / add 20170；无显式 event op；数值与 CD/resource 日程；自动 `ability_started`；零 R state/modifier/listener/matcher/repeat/control/knockback/stun/reveal/displacement/terrain/geometry/Explosive Charge；standalone；五 tags 序含 `bonus_ad_ratio` 与 `ap_ratio`；含 bonus-AD 减法证明 |
| Backend | owning `8b98bcb…` / 镜像 `30209c4…`；focused9 + adjacent53 + full911；无 live seed |
| Wasm | exact `b4d10e4…`；gofmt + focused7/full/bench/build/smoke/benchmark；无生产 Wasm/Web 写入 |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持同字节/同 SHA |
| 审计 | commit `c078ae7…`；接受 run `run-d543c652…`；G8 migrated + 空 remainingGap；Unified completed/full；仅 Tristana R 语义对象变化；provisional 仅移除 Tristana R；ENOBUFS 为 checks 后 local tooling caveat；counts 与 §5 最终清单一致 |
| 设计门控 | 有效 READY `run-1aebb169…`；runDelta0/diff0；1278 events / 57/57 complete tool groups；无 truncation/mutation；三条非阻塞笔记已接受 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
