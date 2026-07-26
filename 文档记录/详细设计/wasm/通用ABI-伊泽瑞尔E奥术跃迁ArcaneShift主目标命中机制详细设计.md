TASK_KEY: wasm-generic-ezreal-arcane-shift-primary-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-24

# 通用 ABI - 伊泽瑞尔 E 奥术跃迁（Arcane Shift）主目标命中机制详细设计

关联验证记录：[通用 ABI 伊泽瑞尔 E 奥术跃迁 Arcane Shift 主目标命中机制验证记录](../../测试记录/wasm/通用ABI-伊泽瑞尔E奥术跃迁ArcaneShift主目标命中机制验证记录-2026-07-24.md)。本任务将精确候选 `hero_skill|hero_ezreal|E|奥术跃迁` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated` exact override `hero_ezreal|E`；保留 raw classification/tags/auditBaseline provenance）。关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称 blink/homing/nearest-target selection/visibility/Essence Flux priority、projectile/travel/reveal、ranks1–4，或其他 Ezreal 技能/普攻/完整游戏技能保真。冻结方案：`FROZEN_PLAN_REV ezreal-e-arcane-shift-primary-hit-phase-a-v3`（DESIGN_REVIEW READY `run-5b85f4a8-12d0-4bb6-ae0f-bfdaf86ceffb`；runDelta0/diff0；74 tool-call events / 37 unique direct calls all terminal；无 truncation / orphans / mutations；无 user decision。接受非阻塞笔记：G8 override key 为 owner/skill `hero_ezreal|E`，**不是**完整 candidate key。较早 v1 `run-b73bbc17-2469-49a0-a3b8-d94a966e3cb7` 文本 READY 但因一笔 orphaned read **无效**；v2 `run-2a36db44-cd0f-4426-b8b7-f7f59ac24ea4` 文本 READY 但因两笔 orphaned reads **无效**；**均不是**门控）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_ezreal\|E\|奥术跃迁` |
| Wiki | 请求 `Template:Data Ezreal/E`，解析为 `Template:Data Ezreal/Arcane Shift`；pageId `1307111`；revision `3989862`；timestamp `2026-02-03T23:19:20Z`；canonical raw bytes `1661`；SHA256 `7ac83f7eaa237641c478f2e3ffa1a2714f7da0644c8a488ab6a6f47b67e27347`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/ezreal-e.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw materialization 亦为 `1661` bytes / SHA256 `f48a32706234b0c1ef1abab4b7f90e4ee88944623827fb22a41e23bdfac01792`。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾 |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated`（exact override `hero_ezreal\|E`；保留 raw classification/tags/auditBaseline provenance） |
| completedBoundary | `rank5_primary_champion_single_hit; immediate_impact_scaffold; magic_280_plus_0_60_bonus_ad_plus_0_75_ap; preserve_rising_spell_force_one_stack_on_successful_hit; no_blink_homing_target_selection_visibility_essence_flux_priority_projectile_travel_reveal_or_other_ranks` |
| governed tags（序） | `ability_cost_cooldown`、`active_magic_damage`、`bonus_ad_ratio`、`ap_ratio`、`immediate_impact_scaffold`（Unified canonical tags 按 locale 排序，表示同一精确集合） |
| Rank-5 active | 70 mana；14000ms cooldown；immediate primary-champion scaffold；每次成功施放恰好一笔非暴击/不可复制魔法伤害 `add(add(280,0.60*(source.attr.ad.resolved-source.attr.ad.base)),0.75*source.attr.ap.resolved)`（嵌套二元 `add`）；成功命中保留既有 Rising Spell Force **一层** |
| 事件范围 | runtime **可**合成既有 `ability_started`；与既有 Ezreal P 共存：E 成功 t0 + E cooldown skip t100 → 恰好一笔 E 伤害、一次 `ability_started`、一层 Rising Spell Force、AS1.1；**不**改动既有 P/R graphs |
| 数值交叉 | 默认 baseAD60 / resolvedAD110 / AP200 → raw460；MR100 → mitigated230。分支 raw/mitigated：280/140、310/155、430/215、460/230 |
| 日程交叉 | mana210：t0 / t13999 / t14000 → 两次成功 + 恰好一次 cooldown skip（t13999），final mana70；目标 HP1000 → final540；mana69 → resource skip / 不变 / 无事件 |
| Backend 前置 | seed 对 ability/graph **自洽**；对既有 `hero_ezreal` / ad / ap / mana 身份与面板/资源定义为 **check-only**，**不**物化这些值；既有 Ezreal P/R graphs **未触碰** |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标（primary champion）结算单次魔法伤害，并保留既有 Rising Spell Force 一层；不代表 blink、homing、选敌、可见性、Essence Flux 优先或弹道。

| 排除（非 remainingGap / 非 blocker；亦非已建模行为的近似） | 说明 |
| --- | --- |
| blink / homing / nearest-target selection | 位移与选敌全部排除 |
| visibility / Essence Flux priority | 可见性与 W 标记优先全部排除 |
| projectile / travel / reveal | 弹道、飞行与揭示全部排除 |
| ranks 1–4 | 仅 Rank5 |
| other Ezreal skills / basic attacks | 无其它技能/普攻耦合（既有 P 共存为保留行为，非本机制新增） |
| loadout / crit / on-hit | 无负荷/暴击/on-hit 耦合 |
| live migration / Admin publish / browser E2E / full-game / full-skill fidelity | 发布与完整保真不在本闭环 |

## 3. 端到端数据流

```text
Wiki ezreal-e.json (page1307111/rev3989862；canonical SHA 7ac83f7e…)
  → Backend seed（lol_generic_ezreal_arcane_shift_primary_hit_seed.sql；
     provider_hero_ezreal_e_arcane_shift_primary_hit；嵌套二元魔法公式；
     hero_ezreal/ad/ap/mana check-only；不物化身份/面板/资源；不触碰 P/R）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；资产已与当前 build 同步且本轮不变）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 magic damage operation（nested binary 280+0.60*bonusAD+0.75*AP）
    → 成功命中保留既有 Rising Spell Force 一层
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_ezreal_arcane_shift_primary_hit_seed.sql` + `LolGenericEzrealArcaneShiftPrimaryHitSeedSqlTest` + README：独立 `provider_hero_ezreal_e_arcane_shift_primary_hit`；70 mana / 14000ms CD；immediate primary-champion scaffold；一笔嵌套二元魔法伤害；ability/graph 自洽；`hero_ezreal`/ad/ap/mana **check-only**（不物化）。owning `89e66774cd37f3cd49992d884a600a85cebf9cfe` / 集成 `0594b2044f99722b4e8ff07594061e0d78b3d176`；focused JUnit **8/8**；full Maven **805/805**。实现 run `run-7a22587d-d67b-41b8-9180-7750db96f470`（102 tool-call events / 44 unique calls all terminal；delta3/outside0）。**无** live seed execution |
| Web | **无**本机制 Web 源码或资产写入/commit。当前源资产与标准 build 精确同字节/同 SHA（`1,169,377` / `65A4C6F8…C6A0`）；本轮 test-only Wasm 追加后资产**保持同步且不变**。**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E |
| Wasm | exact `065beb1e13f21b92e010500cf493eae444876946`（`generic_ezreal_arcane_shift_primary_hit_test.go`）；接受实现 run `run-2cede25b-a62b-48ab-b6b4-1e41f27ee8eb`（114 tool-call events / 53 unique calls all terminal；delta1/outside0；无 truncation/orphans）。前两次 fresh IMPLEMENTATION `run-ba28be1e-bef0-4dcf-becf-682a8dc49337`（delta0；一笔 orphan；无文件）与 `run-abd75288-3a65-4ad8-99ed-1630adc2c6f1`（status error；delta0；无文件）为 no-op/**未接受**。主验证：focused `go test ./internal/runtime -run EzrealArcaneShift -count=100` PASS；full `go test -count=1 ./...` PASS；标准 `scripts/build-wasm.ps1` 产物 **1,169,377** bytes，SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`；Node canonical compile/run/release smoke PASS。**无**生产 Wasm 写入/commit |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放（mana210；baseAD60/resolvedAD110/AP200） | 扣 70 mana；一笔魔法 raw460 / MR100 → 230；CD 武装；Rising Spell Force +1 |
| t13999（CD 内） | 恰好一次 cooldown skip；不扣 mana、无伤害、无事件 |
| t14000 再次成功 | 第二次命中；final mana70；目标 HP1000 → 540 |
| mana69 | resource skip；不变；无事件 |
| 分支交叉 | raw/mitigated 280/140、310/155、430/215、460/230 |
| P 共存 | E 成功 t0 + E CD skip t100 → 恰好一笔 E 伤害、一次 `ability_started`、一层 P stack、AS1.1 |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止把 exclusions 写成 remainingGap 或近似实现；禁止物化 check-only 身份/面板/资源；禁止触碰既有 P/R graphs |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY | `run-5b85f4a8-12d0-4bb6-ae0f-bfdaf86ceffb`；READY；runDelta0/diff0；74 events / 37 unique direct calls all terminal；无 truncation/orphans/mutations；无 user decision；接受非阻塞：override key=`hero_ezreal\|E`；v1/v2 文本 READY 因 orphaned read(s) **无效**，非门控 |
| Backend owning / 集成 | owning `89e66774cd37f3cd49992d884a600a85cebf9cfe`；集成 `0594b2044f99722b4e8ff07594061e0d78b3d176`；run `run-7a22587d-d67b-41b8-9180-7750db96f470`（102 events / 44 unique calls all terminal；delta3/outside0）；focused8/8；full Maven **805/805**；无 live seed |
| Wasm exact | `065beb1e13f21b92e010500cf493eae444876946`；接受 run `run-2cede25b-a62b-48ab-b6b4-1e41f27ee8eb`（114 events / 53 unique calls all terminal；delta1/outside0；无 truncation/orphans）；前两次 IMPLEMENTATION no-op/非接受 |
| Web | 无本机制写入；资产保持 `1,169,377` / `65A4…C6A0` 同步不变 |
| 审计 commit | `8d7769677285cfde65af3596318137be8651c7ee`；run `run-a183dc38-5a80-4119-9503-bf39a1cb3d65`（strict model；169 events / 79 unique calls all terminal；无 truncation/orphans；runDelta6/outside0；四 generator checks PASS；ordered 242/254 keys 不变；**仅** Ezreal E candidate/mechanism 语义对象变化） |
| 最终清单 | G8 242 = migrated69 / partial4 / blocked100 / OOS69；Unified sourceCount12 / total254；completed79 / partial_actionable0 / ready0 / blocked_runtime94 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full79 / partial3 / none172；actionable0；`implementation_gap_no_unresolved_data_fields=77`；Wiki-only registry check candidate242 / migrated48 / partial5 / blocked120 / OOS69；Batch-G / G8 / Unified checks PASS；242/254 keys/order 不变，**仅** Ezreal E 语义对象变化。治理 tasks 必须为 92 |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_magic_damage|bonus_ad_ratio|ap_ratio|immediate_impact_scaffold`）、空 `remainingGap`。exact override key 为 owner/skill `hero_ezreal|E`；raw classification/tags/auditBaseline 按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。

主会话语义比较：ordered keys 242/254 不变；**仅** Ezreal E 记录/机制语义变化（metadata source hash / generatedAt 除外）。Registry / Batch-G / G8 / Unified checks PASS。Wiki-only registry **不变** candidate242 / migrated48 / partial5 / blocked120 / OOS69。

**Web Wasm 资产现状（本机制当前状态）**：本轮为 test-only Wasm 追加，**无**生产 Wasm 或 Web 写入/commit。源资产保持与标准 build 精确一致——size `1,169,377` / SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`。该状态为既有同步结果的延续（artifact parity）；**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。

非目标（再次强调）：blink/homing/nearest-target selection/visibility/Essence Flux priority、projectile/travel/reveal、ranks1–4、other Ezreal skills/basic attacks、loadout/crit/on-hit、live migration/Admin publish/browser E2E/full-game/full-skill fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Arcane Shift/游戏技能保真；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1307111 / rev3989862 / timestamp2026-02-03T23:19:20Z / canonical raw1661 / SHA256 `7ac83f7e…27347`；sidecar/pages canonical；local raw1661 / SHA `f48a3270…01792` materialization caveat 非源矛盾、非字节等价主张 |
| 稳定键 | 唯一 `hero_skill\|hero_ezreal\|E\|奥术跃迁` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers |
| 公式 / fixtures | 嵌套二元 `280+0.60*bonusAD+0.75*AP`；默认与分支交叉；CD/resource 日程；成功命中保留 Rising Spell Force 一层；P 共存契约；check-only 前置；不触碰 P/R |
| Backend | owning `89e6677` / 集成 `0594b20`；focused8/8；full805/805；无 live seed |
| Wasm | exact `065beb1`；focused `-run EzrealArcaneShift -count=100`；full Go；标准脚本 TinyGo 1,169,377 / `65A4…C6A0`；Node smoke PASS；无生产 Wasm 写入；前两次 IMPLEMENTATION 非接受 |
| Web | 无本机制写入；资产保持同字节/同 SHA 同步不变 |
| 审计 | commit `8d776967…`；G8 migrated + 空 remainingGap；Unified completed/full；counts 与 §5 最终清单一致 |
| 设计门控 | READY `run-5b85f4a8…`（v3）；v1/v2 因 orphaned read(s) 无效；override key 非阻塞已接受 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
