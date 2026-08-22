TASK_KEY: wasm-generic-ezreal-mystic-shot-primary-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI - 伊泽瑞尔 Q 秘术射击（Mystic Shot）主目标命中机制详细设计

关联验证记录：[通用 ABI 伊泽瑞尔 Q 秘术射击 Mystic Shot 主目标命中机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务将精确候选 `hero_skill|hero_ezreal|Q|秘术射击` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime`。**不**宣称 direction / range / cast timing、projectile / travel / collision / first-enemy acquisition / miss、on-hit / on-attack、1.5s current cooldown reduction、basic+spell dual tags、lifesteal / vamp、spellshield / buffering、multitarget / nonchampions、ranks 1–4、other Ezreal abilities beyond coexistence、live migration/publish/E2E，或完整 Mystic Shot/游戏保真；本闭环**恰好是一次选定主目标敌方英雄单次物理命中**，**不是**完整 Q；**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV ezreal-q-mystic-shot-primary-hit-phase-a-v2`（有效 DESIGN_READY `run-619e5122-3fae-49bc-b291-054a6ac63836`；1639/1639 parseable events；45/45 complete tool groups；runDelta0；无 truncation / mutation；user decision none。先前 v1 `run-aeadbd2b-d92f-40ac-824f-86730635f0ad` 为 **valid REVISE**（2072/2072 parseable；36/36 groups；delta0）——针对 `total_ad` tag 与 impl-gap-family 校正，两项均已接受；**v2 为正式 READY 门控**）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_ezreal\|Q\|秘术射击` |
| Wiki | 请求 `Template:Data Ezreal/Q`，解析为 `Template:Data Ezreal/Mystic Shot`；pageId `1307107`；revision `4013233`；timestamp `2026-04-28T21:19:30Z`；canonical raw bytes `2054`；SHA256 `be5a24861dc53970c19378fe8bea17b242b5b406a588cebb32b0d59a4af4b533`；normalized sidecar `数据参考/lol-wiki-current-champions/normalized/generic/ezreal-q.json` bytes `2527` / SHA256 `b7e8639d6fd82df4c66c4f883078b54274b4a1708fdca6bf2703d70a0518ab47` plus pages sibling bytes `692` / SHA256 `f5f133eef00f3dd4cdc95c0513d3371851b71d890a61b9e8de93716ccd107060` 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw materialization 为 `2052` bytes，SHA256 `d8348b3b9eb4a076af5a87b714dd4de109643252f6b18fd2873f5a5bf7b05dbd`。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾（local raw materialization caveat only） |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_selected_primary_enemy_champion_single_physical_hit; immediate_impact_scaffold; physical_120_plus_1_30_total_ad_plus_0_40_ap; preserve_rising_spell_force_one_stack_on_successful_hit; no_direction_range_projectile_travel_collision_first_enemy_acquisition_on_hit_on_attack_cooldown_reduction_basic_damage_spell_damage_dual_tag_lifesteal_vamp_spellshield_buffering_other_ranks_or_full_fidelity` |
| governed tags（序） | `ability_cost_cooldown`、`active_physical_damage`、`ap_ratio`、`immediate_impact_scaffold`（**无** `total_ad_ratio`；**无** stale `cooldown_or_haste_without_rotation`；**无** salvage/meta tag） |
| Rank-5 active | 40 mana；4500ms cooldown；immediate selected-primary enemy champion single physical hit scaffold；每次成功施放恰好一笔非暴击/不可复制物理命中 `120 + 1.30 * source.attr.ad.resolved + 0.40 * source.attr.ap.resolved`（**精确嵌套二元树** `add(add(const 120, mul(const 1.30, read source.attr.ad.resolved)), mul(const 0.40, read source.attr.ap.resolved))`；**total AD 直接读取**；**不得**减 base AD；伤害类型 **20220** + add 策略 **20170**；**无** 20230 executable；**无**显式 event op；**无** Q-specific type）；成功施放自动合成恰好一次 `ability_started`；成功命中保留既有 Rising Spell Force **一层**；**零** Q state / modifier / listener / matcher / repeat / control / projectile |
| Phase-A 语义框定 | 将 Rank-5 leveling 数值的一次所选施加应用到所选主敌方英雄，作为**有界选定主目标敌方英雄单次物理命中**。Immediate impact 为 Phase-A scaffold；**不**建模 direction/range/cast timing/projectile/travel/collision/first-enemy acquisition/on-hit/CD reduction/dual tags/lifesteal/spellshield，或完整 Q 保真 |
| Standalone | Ezreal Q provider **独立**；**保留**既有 Ezreal P / E / R；与既有 P 共存（成功命中一层 Rising Spell Force）；**不**合成 siblings / loadout / bootstrap |
| Backend 前置 | 仓库对 `hero_ezreal` / AD / AP / mana 为 **external-existing-data/check-only**；seed/JUnit **不**写入 identity/panel/resource materialization；**不** live-publish |
| 数值交叉 | raw/final（armor100）：198/99、328/164、238/119、368/184；base 反证两路径均 328/164（total AD 直读，不随 base 变化） |
| 日程交叉 | mana120：t0 / t4499 / t4500 → success / skip / success；恰好两笔 Q damage；两次自动 Q `ability_started`；final mana40 / HP632；mana39 → resource skip；P 共存：一层 stack AS1.0→1.1，随后 cooldown skip 无变化 |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对所选主敌方英雄结算一次有界单次物理命中，并保留既有 Rising Spell Force 一层；不代表完整 Mystic Shot 施法、弹道、碰撞、首敌获取、on-hit 或 CD 缩减。下列排除为 **completed-boundary exclusions**，**不是** remaining blockers，亦**不是**已建模行为的近似：

| 排除 | 说明 |
| --- | --- |
| direction / range / cast timing | 方向、射程与施法时序全部排除 |
| projectile / travel / collision / first-enemy acquisition / miss | 弹道、飞行、碰撞、首敌获取与未命中全部排除 |
| on-hit / on-attack | 命中/攻击触发全部排除 |
| 1.5s current cooldown reduction | 当前技能冷却缩减排除 |
| basic + spell dual tags | 普攻+技能双标签排除 |
| lifesteal / vamp | 吸血/全能吸血排除 |
| spellshield / buffering | 法术护盾与缓冲排除 |
| multitarget / nonchampions | 多目标与非英雄排除 |
| ranks 1–4 | 仅 Rank5 |
| other Ezreal abilities beyond coexistence | 除保留既有 P/E/R 与 P 共存外，无其它技能合成 |
| live migration / Admin publish / browser E2E / full Mystic Shot / full-game fidelity | 发布与完整保真不在本闭环；**恰好一次选定主目标敌方英雄物理命中**，不是完整 Q |

## 3. 端到端数据流

```text
Wiki ezreal-q.json (page1307107/rev4013233；canonical SHA be5a2486…)
  → Backend seed（lol_generic_ezreal_mystic_shot_primary_hit_seed.sql；
     provider_hero_ezreal_q_mystic_shot_primary_hit；
     一笔物理命中 120+1.30*ad.resolved+0.40*ap.resolved；精确嵌套二元；total AD 直读；
     type 20220 / add 20170；无 20230；无显式 event；无 Q-specific type；
     hero_ezreal/ad/ap/mana external-existing-data/check-only；
     不物化 identity/panel/resource；standalone Q；保留既有 P/E/R）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；Built 与独立 Web worktree 资产已与当前 build 同步且本轮不变）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 physical primary-hit damage（精确嵌套二元 120+1.30*totalAD+0.40*AP；20220/20170）
    → 成功命中保留 Rising Spell Force 一层
    → 自动 ability_started ×1 / 成功施放
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_ezreal_mystic_shot_primary_hit_seed.sql`（bytes `29100`；SHA256 `13e78f715b0320a79c9a57c02bfa64fa72dd05aff0de2e8b2d5f4eb74b265574`）+ `LolGenericEzrealMysticShotPrimaryHitSeedSqlTest`（bytes `58894`；SHA256 `17025b1541d9775c5133f38f82bd8e0d87d36a126112349197dfc4cbf550dc3e`）；README `server/data_manage/README.md` bytes `284316` / SHA256 `7d442658db53672367d75659518cd965e981b939d6cda96fc428bc9afb63aa3f`：独立 `provider_hero_ezreal_q_mystic_shot_primary_hit`；40 mana / 4500ms CD；immediate selected-primary enemy champion single physical hit scaffold；一笔精确嵌套二元物理（total AD 直读）；成功命中保留 Rising Spell Force 一层；`hero_ezreal`/ad/ap/mana 为 **external-existing-data/check-only**（不物化 identity/panel/resource；不 live-publish；standalone Q；保留既有 P/E/R）。owning `41fce6a3c0585ab7c425ebdfb251e7775c83ad37`（`run-679d546c-1e89-40e1-b085-f259a8ba528b`；runDelta3/outside0；主 focused11 / full998 PASS）。镜像 `ae66c5644357d36c96a0a6e84bc30906935b92ed`（`run-e67ff0d6-acf7-49c9-a73a-c502cc3028cd`；runDelta3/outside0；精确 parity）。**无** live seed execution |
| Web | **无**本机制 Web 源码或资产写入/commit。Built 与独立 Web worktree 资产均 **1,169,377** bytes / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`；本轮不变。**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E |
| Wasm | exact `000e253f5a6d744f7209d9ebd417ea1d91684bbb`（`generic_ezreal_mystic_shot_primary_hit_test.go`；test bytes `68455` / SHA256 `6e8ceb7929feda298a91cfcdf51a51db60b665d8ae029813ec07f6ae90196032`）；实现 run `run-0d56a32e-d0f3-43fa-8574-10311a72810d`（runDelta1/outside0）。主验证：focused / count=100 / full / build / smoke / bench PASS。Built 与独立 Web worktree 均 **1,169,377** / `65a4…c6a0`；英雄名 `_test.go` **仅为**机制级回归/治理证据，**排除**于 normal/TinyGo 生产构建；**无**生产 runtime 或 ABI 实现变更；**无** Web 文件变更/拷贝；**无**生产 Wasm 写入/commit |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放（mana120；交叉 raw368/final184 路径） | 扣 40 mana；一笔物理命中；CD 武装；一次 `ability_started`；Rising Spell Force +1（若探针启用 P） |
| t4499（CD 内） | 恰好一次 cooldown skip；不扣 mana、无伤害、无新 `ability_started` |
| t4500 再次成功 | 第二次物理命中；两笔 Q damage；两次 `ability_started`；final mana40；HP→632 |
| mana39 | resource skip；mana/HP 不变；无 Q damage/event |
| 交叉 raw/final | 198/99、328/164、238/119、368/184 |
| base 反证 | 两路径均 raw/final 328/164（total AD 直读） |
| P 共存 | 成功命中一层 stack AS1.0→1.1；随后 cooldown skip 无变化 |
| Standalone / 保留 P/E/R | 仅挂载本 Q（standalone 探针）；不触碰既有 P/E/R graphs 合同语义（除保留共存） |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止把 exclusions 写成 remainingGap 或近似实现；禁止物化 check-only 身份/面板/资源；禁止引入 `total_ad_ratio` / stale haste / salvage governed tags；禁止把本主目标命中误称为完整 Q |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY | `run-619e5122-3fae-49bc-b291-054a6ac63836`；READY；1639/1639 parseable events / 45/45 complete tool groups；runDelta0；无 truncation/mutation；user decision none。先前 v1 `run-aeadbd2b-d92f-40ac-824f-86730635f0ad` 为 valid REVISE（2072/2072；36/36；delta0；`total_ad` tag + impl-gap-family 校正均已接受）；**v2 为正式门控** |
| Backend owning | owning `41fce6a3c0585ab7c425ebdfb251e7775c83ad37`；`run-679d546c-1e89-40e1-b085-f259a8ba528b`（runDelta3/outside0）；主 focused11 / full998 PASS；seed bytes29100 / SHA `13e78f71…b265574`；JUnit bytes58894 / SHA `17025b15…550dc3e`；README bytes284316 / SHA `7d442658…b63aa3f` |
| Backend 镜像（Wasm worktree） | `ae66c5644357d36c96a0a6e84bc30906935b92ed`；`run-e67ff0d6-acf7-49c9-a73a-c502cc3028cd`（runDelta3/outside0；精确 parity） |
| Wasm exact | `000e253f5a6d744f7209d9ebd417ea1d91684bbb`；`run-0d56a32e-d0f3-43fa-8574-10311a72810d`（runDelta1/outside0）；focused/count=100/full/build/smoke/bench PASS；test bytes68455 / SHA `6e8ceb79…0196032`；Built/独立 Web 资产 `1,169,377` / `65a4…c6a0`；无 Web 写入；英雄名 `_test.go` 仅机制级回归/治理证据（排除生产构建） |
| Web | 无本机制写入；Built/独立 Web worktree 资产 `1,169,377` / `65a4…c6a0` |
| 审计接受 | commit `b3cbd6bdd7d9fba472994659495d884e74c14774`；审计 run `run-4272960b-8e68-4893-aa9b-38f443cb1a82`（runDelta8/outside0）。主五检查通过；语义比较证明**仅** Ezreal Q G8/Unified 记录变化，且 provisional **仅**移除 Ezreal Q |
| 最终清单 | registry 242 = migrated48 / partial5 / blocked120 / OOS69；G8 242 = migrated89 / partial4 / blocked80 / OOS69；inScope173；Unified sourceCount12 / total254；completed99 / partial_actionable0 / ready0 / blocked_runtime74 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full99 / partial3 / none152；implementation gap **仍为 58**（Ezreal Q **不在**该家族，故未减）；actionable0；provisional77（runtime74/data3；hero75/item2）。治理 tasks 必须为 113。报告口径：严格 verified completion **99/254=39.0%**；completed + provisional implementation-description coverage **176/254=69.3%**；当前 77 张 template-eligible blocked 键均有 provisional 卡；provisional 仍为 unverified，**不是** completed 主张。稳定 digests：Unified `69832c2a7e7a473b64fd102771cb8055d63683245d76fdccff54598ef329c018`；Wiki registry `927d8b5a729fe5a00ce4428cf854cb244dcf78b556afc77e711c9b8cb68126c7` |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_physical_damage|ap_ratio|immediate_impact_scaffold`）、空 `remainingGap`。raw upstream 字段按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。**禁止** governed `total_ad_ratio`、stale `cooldown_or_haste_without_rotation`、salvage/meta tag。

主会话语义比较：ordered keys 242/254 不变；**仅** Ezreal Q 记录/机制语义变化（metadata source hash / generatedAt 除外）；provisional 仅移除 Ezreal Q（78→77）。Registry / Batch-G / G8 / Unified / provisional checks PASS。先前 completed/migrated 记录保持锁定。稳定 digests 不变。`implementation_gap_no_unresolved_data_fields` **仍为 58**，因为 Q **不在**该家族。

**Web Wasm 资产现状（本机制当前状态）**：本轮为 test-only / 机制级回归证据追加，**无**生产 Wasm 或 Web 写入/commit。Built 与独立 Web worktree 源资产保持与标准 build 精确一致——size `1,169,377` / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`。该状态为既有同步结果的延续（artifact parity）；**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。

非目标（再次强调）：direction/range/cast timing、projectile/travel/collision/first-enemy acquisition/miss、on-hit/on-attack、1.5s current cooldown reduction、basic+spell dual tags、lifesteal/vamp、spellshield/buffering、multitarget/nonchampions、ranks1-4、other Ezreal abilities beyond coexistence、live migration/Admin publish/browser E2E/full Mystic Shot/full-game fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Mystic Shot/游戏技能保真；本闭环**恰好是一次选定主目标敌方英雄物理命中**，**不是**完整 Q；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。Ezreal Q 为 standalone；保留既有 P/E/R；Backend external-existing-data/check-only；伤害为 **total AD 直读 + AP**（精确嵌套二元；不减 base）；类型 **20220** / add **20170**；无 20230；无 Q-specific type；英雄名 `_test.go` 排除于生产构建且不改变生产 runtime/ABI。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1307107 / rev4013233 / timestamp2026-04-28T21:19:30Z / canonical raw2054 / SHA256 `be5a2486…4b533`；normalized2527 / SHA `b7e8639d…18ab47`；pages692 / SHA `f5f133ee…107060`；sidecar/pages canonical；local raw2052 / SHA `d8348b3b…b05dbd` materialization caveat only——非源矛盾主张 |
| 稳定键 | 唯一 `hero_skill\|hero_ezreal\|Q\|秘术射击` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers；恰好一次选定主目标敌方英雄物理命中 |
| 公式 / fixtures | 精确嵌套二元 `120+1.30*ad.resolved+0.40*ap.resolved`；total AD 直读/不减 base；type 20220 / add 20170；无 20230；无显式 event op；无 Q-specific type；数值与 CD/resource 日程；自动 `ability_started`；保留 Rising Spell Force 一层；P 共存；四 tags 序；禁止 `total_ad_ratio`/stale haste/salvage |
| Backend | owning `41fce6a…` / 镜像 `ae66c56…`；focused11 + full998；无 live seed |
| Wasm | exact `000e253…`；focused/count=100/full/build/smoke/bench；英雄名 `_test.go` 仅机制级回归/治理证据；无生产 Wasm/Web/ABI 写入 |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持同字节/同 SHA |
| 审计 | commit `b3cbd6b…`；接受 run `run-4272960b…`；G8 migrated + 空 remainingGap；Unified completed/full；仅 Ezreal Q 语义对象变化；provisional 仅移除 Ezreal Q；counts 与 §5 最终清单一致；implementation_gap 仍 58 |
| 设计门控 | 有效 READY `run-619e5122…`；runDelta0；1639 events / 45/45 complete tool groups；无 truncation/mutation；v1 valid REVISE 校正已接受，非正式 READY 门控 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
