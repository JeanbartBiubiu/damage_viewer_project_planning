TASK_KEY: wasm-generic-xayah-double-daggers-primary-two-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-25

# 通用 ABI - 霞 Q 双刃（Double Daggers）主目标双击机制详细设计

关联验证记录：[通用 ABI 霞 Q 双刃 Double Daggers 主目标双击机制验证记录](../../测试记录/wasm/通用ABI-霞Q双刃DoubleDaggers主目标双击机制验证记录-2026-07-25.md)。本任务将精确候选 `hero_skill|hero_xayah|Q|双刃` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称施放时间/攻速锁/方向射程宽度/弹道飞行拦截/法术护盾/后续目标减伤/羽毛生成与落地/E 耦合/其它 rank，或完整游戏技能保真；**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV xayah-q-double-daggers-primary-two-hit-phase-a-v3`（第三轮 fresh DESIGN_REVIEW_ONLY READY `run-136665fe-8126-4aa8-aa1d-fb65934d2a39`；strict `grok-4.5`；effort high；fast false；runDelta0/diff0；162 tool events / 81 unique calls all terminal；无 truncation / orphans / mutations；无 user decision。较早 v1/v2 **不是**接受门控）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_xayah\|Q\|双刃` |
| Wiki | 请求 `Template:Data Xayah/Q`，解析为 `Template:Data Xayah/Double Daggers`；pageId `1324541`；revision `4008615`；timestamp `2026-04-15T00:26:21Z`；canonical raw bytes `2615`；SHA256 `8010e567d2366730c5eb6cd0a31baec09c7f5137018ab2ca15fd84f167d990fd`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/xayah-q.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| live redirect（仅请求细节） | live redirect page `1324536` / rev `2864045` 仅为 live request detail，**不是** stored sidecar |
| raw caveat | 仓库 local raw materialization 亦为 `2615` bytes / SHA256 `6a1fde0a18de0b6f28e55be7df27e58f99c91d49310e79ae81a9e95384f974de`。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾 |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_primary_champion_two_feather_hits; immediate_impact_scaffold; two_physical_hits_each_105_plus_0_50_bonus_ad; preserve_deadly_plumage_ability_type_listener_isolation; no_cast_time_attack_lockout_direction_range_width_projectile_travel_interception_spellshield_secondary_target_reduction_feather_generation_ground_state_or_other_ranks` |
| governed tags（序） | `ability_cost_cooldown`、`active_physical_damage`、`bonus_ad_ratio`、`immediate_impact_scaffold` |
| Rank-5 active | 35 mana；8000ms cooldown；immediate primary-champion scaffold；每次成功施放恰好两次有序、互不相同的 left/right 非暴击/不可复制物理伤害，各自 `105 + 0.50*(source.attr.ad.resolved-source.attr.ad.base)`（嵌套二元 `add`）；成功施放自动合成恰好一次 `ability_started`（无显式 event op）；**零** Q state / modifier / listener / matcher / repeat / control / projectile / AOE / feather-ground / movement |
| W 隔离共存 | 保留既有 Deadly Plumage ability-type listener isolation：Backend game-local type `62012` `ability/xayah_deadly_plumage`、W ability type relation、listener `ability_id IS NULL`、exact ALL match types `{20205,20212,62012}`；runtime W ability 带该 type，listener matcher 为 `event/ability_started` + `event/source_owner` + ability type，`ListenerDefinition.AbilityRef` 为空。Q 成功/跳过不武装 W、不改 AS baseline；W 成功在 Q 已挂载时仅武装 W、零 Q 伤害。**不**改变 W 分类或 W 数值/公式/state/modifier 合同 |
| 数值交叉 | baseAD60 / resolvedAD60 → 各 105 / 合计 210；armor100 → 各 52.5 / 合计 105。resolvedAD110 → 各 130 / 合计 260；armor100 → 各 65 / 合计 130 |
| 日程交叉 | mana105 / HP1000 / armor100：t0 / t7999 / t8000 → 两次成功 + 恰好一次 cooldown skip、四笔伤害、final mana35 / HP740、两次 `ability_started`；mana34 → resource skip / 不变 |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标（primary champion）结算两次有序物理命中；不代表弹道、几何、多目标减伤、羽毛生成/落地或施放锁。

| 排除（非 remainingGap / 非 blocker；亦非已建模行为的近似） | 说明 |
| --- | --- |
| cast time / attack lockout / effect-at-cast-end | 施放时间与攻速锁全部排除 |
| direction / range / width / geometry | 方向、射程、宽度与几何全部排除 |
| projectile / travel / collision / interception / spellshield | 弹道、飞行、碰撞、拦截与法术护盾全部排除 |
| later-target reduction | 后续目标减伤排除 |
| multitarget / formation / area | 多目标、阵型与区域全部排除 |
| feather generation / ground / E | 羽毛生成、落地与 E 耦合全部排除 |
| ranks 1–4 | 仅 Rank5 |
| other skills / basic / loadout / crit / on-hit | 无其它技能/普攻/负荷/暴击/on-hit 耦合 |
| live migration / Admin publish / browser E2E / full-game / full-skill fidelity | 发布与完整保真不在本闭环 |

## 3. 端到端数据流

```text
Wiki xayah-q.json (page1324541/rev4008615；canonical SHA 8010e567…)
  → Backend seed（lol_generic_xayah_double_daggers_primary_two_hit_seed.sql；
     provider_hero_xayah_q_double_daggers_primary_two_hit；
     两次有序 left/right 嵌套二元物理；W type62012 isolation check-only）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；资产已与当前 build 同步且本轮不变）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 两笔有序 physical damage ops（each nested binary 105+0.50*bonusAD）
    → 自动 ability_started ×1 / 成功施放；保留 W ability-type listener isolation
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_xayah_double_daggers_primary_two_hit_seed.sql` + `LolGenericXayahDoubleDaggersPrimaryTwoHitSeedSqlTest`：独立 `provider_hero_xayah_q_double_daggers_primary_two_hit`；35 mana / 8000ms CD；immediate primary-champion two-hit scaffold；两次嵌套二元物理；W isolation 前置 check-only（type `62012` / relation / listener `ability_id IS NULL` / ALL `{20205,20212,62012}`）。owning `8ace954`（恢复实现 `run-3c2645ea-3900-4646-abdc-e78c27c67e3c`；runDelta0 from dirty recovery baseline；64 tool events / 25 calls complete；focused **18/18**；owning full Maven **813/813**；首轮 `run-b39fb6ca-ce05-41f7-a296-0db9cefd24af` 写后中断，**不是**最终审计）。Wasm 集成 `6bab0b854d919efec2394dbc875cc3402daa84f9`（接受冲突恢复 `run-f84ba8c6-61c6-4727-9d5b-faec7d301fc6`；runDelta0/outside0；74 tool events / 37 calls complete；focused integrated Q/W Backend **17/17**；较早冲突 run `run-32a65624-5617-45da-8e44-5261d2645362` 因在三路径 allowlist 外规范化 Q seed **无效**）。Wasm worktree 全量 Maven **不是**干净全绿：632 tests / 51 既有 legacy seed 失败（`core.autocrlf=true` + 旧测试硬编码 LF）——**环境/legacy CRLF caveat**，非 Xayah 失败，亦**非**全量通过主张；新 Q/W 测试通过。**无** live seed execution |
| Web | **无**本机制 Web 源码或资产写入/commit。当前源资产与标准 build 精确同字节/同 SHA（`1,169,377` / `65A4C6F8…C6A0`）；本轮 test-only Wasm 追加后资产**保持同步且不变**。**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E |
| Wasm | exact `dd7dae6a02cb960d258b10838551e4238e5efa42`（`generic_xayah_double_daggers_primary_two_hit_test.go`）；实现 run `run-8fbe36dd-25b2-4428-a92d-b3bf3f537555`（runDelta2/outside0；1077 parseable events；52 calls complete；无 truncation）。主验证：focused `Xayah(DoubleDaggers\|DeadlyPlumage)` PASS；`XayahDoubleDaggers -count=100` PASS；full `go test -count=1 ./...` PASS；标准 `scripts/build-wasm.ps1` 产物 **1,169,377** bytes，SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`；Node canonical compile/run/release smoke PASS。**无**生产 Wasm 写入/commit；**无** Web 文件变更/拷贝 |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放（mana105；armor100） | 扣 35 mana；两次有序物理命中；CD 武装；一次 `ability_started` |
| t7999（CD 内） | 恰好一次 cooldown skip；不扣 mana、无伤害、无新 `ability_started` |
| t8000 再次成功 | 第二次双击；四笔伤害合计；final mana35；HP1000→740；两次 `ability_started` |
| mana34 | resource skip；不变 |
| 交叉 baseAD60/resolvedAD60 | 各 105 / 合计 210；armor100 → 各 52.5 / 合计 105 |
| 交叉 resolvedAD110 | 各 130 / 合计 260；armor100 → 各 65 / 合计 130 |
| W 共存 | Q 成功/skip → W inactive / AS baseline；W 成功（Q 已挂载）→ 仅武装 W、零 Q 伤害 |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止把 exclusions 写成 remainingGap 或近似实现；禁止改变 W 分类/数值/公式/state/modifier 合同 |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY | `run-136665fe-8126-4aa8-aa1d-fb65934d2a39`；READY；strict `grok-4.5`；effort high；fast false；runDelta0/diff0；162 tool events / 81 unique calls all terminal；无 truncation/orphans/mutations；无 user decision；v1/v2 **非**门控 |
| Backend owning | owning `8ace954`；恢复 `run-3c2645ea-3900-4646-abdc-e78c27c67e3c`（runDelta0；64/25）；focused18/18；owning full Maven **813/813**；首轮 `run-b39fb6ca…` 中断非最终审计 |
| Backend 集成（Wasm worktree） | `6bab0b854d919efec2394dbc875cc3402daa84f9`；接受 `run-f84ba8c6-61c6-4727-9d5b-faec7d301fc6`（runDelta0/outside0；74/37）；focused Q/W **17/17**；无效冲突 run `run-32a65624…`；全量 Maven CRLF caveat（632/51 legacy LF） |
| Wasm exact | `dd7dae6a02cb960d258b10838551e4238e5efa42`；`run-8fbe36dd-25b2-4428-a92d-b3bf3f537555`（runDelta2/outside0；1077 events；52 calls complete；无 truncation） |
| Web | 无本机制写入；资产保持 `1,169,377` / `65A4…C6A0` 同步不变 |
| 审计 commit | `d94d35a2fa0f499578580d28d72e05ed5ff7b5bf`；run `run-aae6eb8d-b707-4458-8085-d643824efae3`（runDelta6/outside0；1028 parseable；80 calls complete；无 truncation；G8/Unified `--check` PASS；**仅** Xayah Q 机制对象变化；Xayah W canonical object hashes 不变：G8 `dd91a84a1e307ab4540b9d0f422c3715334ecdac3ac01580c5cb04859f6d938f`、Unified `b03237eb01927cccdfa38f2abacd12f2cf0a17cf0b5bbcde75f06b7870b45ed4`） |
| 最终清单 | G8 242 = migrated70 / partial4 / blocked99 / OOS69；Unified sourceCount12 / total254；completed80 / partial_actionable0 / ready0 / blocked_runtime93 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full80 / partial3 / none171；actionable0；`implementation_gap_no_unresolved_data_fields=76`；242/254 keys/order 不变，**仅** Xayah Q 语义对象变化。治理 tasks 必须为 93 |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_physical_damage|bonus_ad_ratio|immediate_impact_scaffold`）、空 `remainingGap`。raw upstream 字段按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。

主会话语义比较：ordered keys 242/254 不变；**仅** Xayah Q 记录/机制语义变化（metadata source hash / generatedAt 除外）；Xayah W G8/Unified canonical objects 字节语义不变（hashes 见 §5）。Registry / Batch-G / G8 / Unified checks PASS。

**Web Wasm 资产现状（本机制当前状态）**：本轮为 test-only Wasm 追加，**无**生产 Wasm 或 Web 写入/commit。源资产保持与标准 build 精确一致——size `1,169,377` / SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`。该状态为既有同步结果的延续（artifact parity）；**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。

非目标（再次强调）：cast time/attack lockout/effect-at-cast-end、direction/range/width/geometry、projectile/travel/collision/interception/spellshield、later-target reduction、multitarget/formation/area、feather generation/ground/E、ranks1–4、other skills/basic/loadout/crit/on-hit、live migration/Admin publish/browser E2E/full-game/full-skill fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Double Daggers/游戏技能保真；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。W isolation 纠正仅为 ability-type listener 隔离，**不**重分类 W，**不**改变 W 的 40 mana / 14000ms / 4000ms / +55% / ×1.25 pipeline 合同。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1324541 / rev4008615 / timestamp2026-04-15T00:26:21Z / canonical raw2615 / SHA256 `8010e567…990fd`；sidecar/pages canonical；live redirect 1324536/2864045 仅 live request；local raw2615 / SHA `6a1fde0a…974de` materialization caveat 非源矛盾、非字节等价主张 |
| 稳定键 | 唯一 `hero_skill\|hero_xayah\|Q\|双刃` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers |
| 公式 / fixtures | 两次有序 left/right 嵌套二元 `105+0.50*bonusAD`；数值与 CD/resource 日程；自动 `ability_started`；零 Q state/modifier/listener；W isolation 共存 |
| Backend | owning `8ace954` / 集成 `6bab0b8`；focused18/18 与 integrated Q/W 17/17；owning full813/813；Wasm worktree full Maven CRLF caveat；无 live seed |
| Wasm | exact `dd7dae6`；focused DoubleDaggers/DeadlyPlumage + `-count=100`；full Go；标准脚本 TinyGo 1,169,377 / `65A4…C6A0`；Node smoke PASS；无生产 Wasm/Web 写入 |
| Web | 无本机制写入；资产保持同字节/同 SHA 同步不变 |
| 审计 | commit `d94d35a`；G8 migrated + 空 remainingGap；Unified completed/full；W hashes 不变；counts 与 §5 最终清单一致 |
| 设计门控 | READY `run-136665fe…`（v3）；v1/v2 非接受门控 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
