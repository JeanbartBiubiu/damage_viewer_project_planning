TASK_KEY: wasm-generic-kogmaw-living-artillery
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-24

# 通用 ABI - 克格莫 R 活体大炮（Living Artillery）缺失生命倍率与叠层耗蓝机制详细设计

关联验证记录：[通用 ABI 克格莫 R 活体大炮 Living Artillery 缺失生命倍率与叠层耗蓝机制验证记录](../../测试记录/wasm/通用ABI-克格莫R活体大炮LivingArtillery缺失生命倍率与叠层耗蓝机制验证记录-2026-07-24.md)。本任务将精确候选 `hero_skill|hero_kogmaw|R|活体大炮` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称 0.6s 落地延迟、落点/几何/弹道/多目标、视野/揭示/潜行，或完整游戏技能保真。冻结方案：`FROZEN_PLAN_REV kogmaw-r-living-artillery-phase-a-v2`（唯一接受的设计门控：DESIGN_REVIEW v2 READY `run-723a2309-4a41-45ef-ad37-288f052cef50`；strict `grok-4.5`；effort high；fast false；runDelta0/diff0；1628 JSONL events parseable；73 unique tool calls completed；无 truncation / mutation / unfinished calls。DESIGN v1 `run-aa3c9386-69f2-4396-8305-c93dcb2c0c1e` 为 `REVISE`——发现 `resourceGate` 缺 provider context / lazy expiry；虽 runDelta0/diff0，但有一笔 orphaned grep/read-only 事件，**不是**有效干净门控，**不是** READY 门控）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_kogmaw\|R\|活体大炮` |
| Wiki | 请求 `Template:Data Kog'Maw/R`，解析为 `Template:Data Kog'Maw/Living Artillery`；pageId `1307963`；revision `4007636`；timestamp `2026-04-12T08:34:32Z`；canonical raw bytes `2453`；SHA256 `32f8dd8d875aaf95cec2be9cfe4a5a5526881b956f2f23e06ab87dc331ca8641`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/kogmaw-r.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw 为非规范 `2452` bytes / SHA256 `11db6c16391dcbfa2c091e81399bff4b2a0abffcd468f71ea5e9d89759d5e447`。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾 |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank3_primary_target_living_artillery; immediate_impact_scaffold; magic_180_plus_0_75_bonus_ad_plus_0_45_ap_with_missing_health_multiplier; escalating_mana_40_plus_40_per_stack_max9_for_8000ms; no_delay_location_geometry_multitarget_sight_reveal_or_stealth` |
| governed tags（序） | `ability_cost_cooldown`、`active_magic_damage`、`bonus_ad_and_ap_ratio`、`missing_health_damage_multiplier`、`stack_escalating_mana_cost`、`timed_provider_state` |
| Rank-3 active | cooldown `1000ms`；cost `40*(1+provider.state.living_artillery_stacks)` **在 operations 之前**结算；timed provider state `living_artillery_stacks`（default0 / max9 / 8000ms / refresh-on-write）；恰好两条有序 operations：op0 一笔非暴击/不可复制主目标魔法伤害，op1 direct provider-scope add1；**零** listener / ability-start 依赖 |
| 伤害公式 | 基底 `add(add(180, 0.75*(resolvedAD-baseAD)), 0.45*AP)`（**嵌套二元** `add`；**永不**背书编译器不消费的三元 `add`）；缺失生命倍率：当前 HP ≥40% 最大生命时 `1+min(0.5,(5/6)*missingFraction)`；当前 HP <40% 时倍率恰好 `2` |
| 数值交叉 | fixture baseAD61 / resolvedAD141 / AP100 → base285。maxHP1000 / MR100：current1000 → raw/mitigated `285/142.5`；current400（精确阈值）→ `427.5/213.75`；current399（阈值下）→ `570/285` |
| 日程交叉 | t0/t999/t1000、mana500：两次成功 + 一次 cooldown skip，costs `40` 然后 `80`，final mana380 / state2；mana119：首次 cost40 后 resource skip，final mana79 / state1 / 无第二次伤害或写栈；十次成功施放 cost `40..400` 合计 `2200`、cap9；8000ms 精确 lazy expiry 与 refresh-on-write 已覆盖 |
| 结构约束 | 恰好两条有序 operations；**零** listener；**零** ability-start 依赖 |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A 架构与排除

本机制是 **immediate primary-target scaffold + 叠层耗蓝 provider-state**：成功施放先按当前 `living_artillery_stacks` 扣动态 mana，再对主目标结算带缺失生命倍率的魔法伤害，最后 provider-scope 叠层 +1（8000ms / refresh-on-write）。**不是** 0.6s 落地延迟、落点几何、多目标溅射、视野揭示或潜行交互的部分建模。

| 排除（非 remainingGap / 非 blocker；亦非已建模行为的近似） | 说明 |
| --- | --- |
| 0.6s delay | 落地延迟全部排除 |
| location / range / radius / projectile / arc / collision / travel / area / multitarget | 落点、几何、弹道与多目标全部排除 |
| sight / reveal / stealth | 视野、揭示与潜行全部排除 |
| ranks 1–2 | 仅 Rank3 |
| P / Q / W / E / basic / combo | 无其它技能/普攻/连招耦合 |
| equipment / runes / loadout | 无装备/符文/负荷耦合 |
| spell shield | 法术护盾交互排除 |
| animation | 动画保真排除 |
| live migration / Admin publish / browser E2E / full-game / full-skill fidelity | 发布与完整保真不在本闭环 |

## 3. 端到端数据流

```text
Wiki kogmaw-r.json (page1307963/rev4007636；canonical SHA 32f8dd8d…)
  → Backend seed（lol_generic_kogmaw_living_artillery_seed.sql；
     provider_hero_kogmaw_r_living_artillery；嵌套二元伤害公式）
    → Web 既有 generic 投影 + 本轮 Wasm 资产同步（artifact parity only）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → provider-aware dynamic cost gate（40*(1+stacks)；lazy expiry）
    → null-duration impact + on_enter sequence
    → op0 magic damage（nested binary base × missing-HP multiplier）
    → op1 provider-scope stacks add1（8000ms；refresh_on_write）
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_kogmaw_living_artillery_seed.sql` + `LolGenericKogmawLivingArtillerySeedSqlTest`：独立 `provider_hero_kogmaw_r_living_artillery`；动态 cost / 1000ms CD；timed stacks；两条有序 operations；伤害公式必须为嵌套二元 `add(add(180,0.75*bonusAD),0.45*AP)`。初始 owning `100679a` / 集成 `175b03a`（run `run-4f56303d-52bf-4d85-8cf3-dfaba1308a41`；focused10/10）。主审检出不兼容三元 `add` 后纠正 owning `473bd50` / 集成 `d563b67`（run `run-41587930-8f62-4b77-abb6-703a499ab83b`；递归二元 arity JUnit；focused10/10；full Maven **770/770**）。**永不**背书不兼容公式；**无** live seed execution |
| Web | 资产同步 run `run-bbd076d3-9f3c-4527-a9d8-5f7567853dc2`（delta1/outside0）；commit `38b9229`：源资产由既有陈旧 `1,155,992` / SHA256 `6A5250835639AD9A1E70F1A9B2A5811F14E307717779FE89A1A3A46B96A4917A` 更新为与当前 build 精确一致的 `1,169,377` / SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`（artifact parity only；**不是** bilateral runtime 替代）。Main `npm run lint`、typecheck、Vitest 21 files / 330 tests、build 均 PASS。**无** Playwright / live E2E |
| Wasm | exact `d58370a`（`generic_kogmaw_living_artillery_test.go` + provider-state cost gate）；实现 run `run-d4d07603-abc6-4386-9a92-a5e7c5f0a9c5`（runDelta3/outside0；含一笔 orphaned read-running——allowlisted diff/主张已独立核验，**不得**当作干净设计门控）；测试纠正 `run-674066df-a9fe-48bb-9ca7-8e2f24f889ea`（delta1/outside0；嵌套二元 seed 断言）。主验证：provider-state cost gate + Kog'Maw focused PASS；Kog'Maw `-count=100` PASS；full `go test -count=1 ./...` PASS；标准 `scripts/build-wasm.ps1` 产物 **1,169,377** bytes，SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`；Node canonical compile/run/release smoke PASS |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放（stacks=0，mana500） | cost40；op0 伤害；op1 stacks→1；CD 武装 |
| t999（CD 内） | 恰好一次 cooldown skip；不扣 mana、无伤害、不写栈 |
| t1000 再次成功 | cost80；stacks→2；mana500→380 |
| mana119 第二次尝试 | 首次成功后 resource skip；final mana79 / state1；无第二次伤害或写栈 |
| 十次成功 | costs `40..400` 合计 `2200`；stacks cap9 |
| 8000ms | lazy expiry 精确到期；后续施放 refresh-on-write |
| currentHP 阈值 | ≥40%：正常倍率分支；`<40%`：倍率恰好 2 |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止三元 `add`；禁止把 exclusions 写成 remainingGap 或近似实现 |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW v2 READY（唯一有效门控） | `run-723a2309-4a41-45ef-ad37-288f052cef50`；strict `grok-4.5`；effort high；fast false；READY；runDelta0/diff0；1628 parseable；73 unique tool calls completed；无 truncation/mutation/unfinished |
| DESIGN_REVIEW v1（无效） | `run-aa3c9386-69f2-4396-8305-c93dcb2c0c1e`；`REVISE`（resourceGate 缺 provider context/lazy expiry）；runDelta0/diff0 但 orphaned grep/read-only；**不是**干净门控，**不是** READY |
| Backend 初始 owning / 集成 | owning `100679a`；集成 `175b03a`；run `run-4f56303d-52bf-4d85-8cf3-dfaba1308a41`；seed/JUnit/README；focused10/10 |
| Backend 公式纠正 | 主审检出不兼容三元 `add`；纠正 run `run-41587930-8f62-4b77-abb6-703a499ab83b`；owning `473bd50`；集成 `d563b67`；嵌套二元 + 递归 arity JUnit；focused10/10；full Maven **770/770** |
| Wasm exact | `d58370a`；实现 `run-d4d07603-abc6-4386-9a92-a5e7c5f0a9c5`（delta3/outside0；orphaned read-running 非干净设计门控）；测试纠正 `run-674066df-a9fe-48bb-9ca7-8e2f24f889ea`（delta1/outside0） |
| Web 资产同步 | `38b9229`；run `run-bbd076d3-9f3c-4527-a9d8-5f7567853dc2`（delta1/outside0）；资产现已与当前 build 同步 |
| 审计 commit | `e81b5b6`；run `run-6d79d49c-b8ee-4103-83b7-80a0f8112730`（delta6/outside0；一笔 orphaned read-running；无 truncation；独立 generator checks 与语义比较 PASS） |
| 最终清单 | G8 242 = migrated65 / partial4 / blocked104 / OOS69；Unified sourceCount12 / total254；completed75 / partial_actionable0 / ready0 / blocked_runtime98 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full75 / partial3 / none176；actionable0；`implementation_gap_no_unresolved_data_fields=80`；Wiki-only registry check candidate242 / migrated48 / partial5 / blocked120 / OOS69；Batch-G / G8 / Unified checks PASS；242/254 keys/order 不变，**仅** Kog'Maw R 语义对象变化。Unified evidence task-key count=61 为不同度量；治理 tasks 必须为 88 |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_magic_damage|bonus_ad_and_ap_ratio|missing_health_damage_multiplier|stack_escalating_mana_cost|timed_provider_state`）、空 `remainingGap`。raw upstream 字段按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。exact audit override **必须**清掉 governed generic 陈旧状态。

主会话语义比较：ordered keys 242/254 不变；**仅** Kog'Maw R 记录/机制语义变化（metadata source hash / generatedAt 除外）。Registry / Batch-G / G8 / Unified checks PASS。

**Web Wasm 资产现状（本机制当前状态）**：本轮 Web sync 已将资产同步到当前 build——size `1,169,377` / SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`。**不得**把更早机制切片中的陈旧资产漂移（`1,155,992` / `6A525083…`）表述为 Kog'Maw R 的当前状态；历史记录可保留为历史。该同步为 artifact parity only，**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。

非目标（再次强调）：0.6s delay、location/range/radius/projectile/arc/collision/travel/area/multitarget、sight/reveal/stealth、ranks1–2、P/Q/W/E/basic/combo、equipment/runes/loadout、spell shield、animation、live migration/Admin publish/browser E2E/full-game/full-skill fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Living Artillery/游戏技能保真；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。**永不**背书不兼容三元 `add` 公式。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1307963 / rev4007636 / timestamp2026-04-12T08:34:32Z / canonical raw2453 / SHA256 `32f8dd8d…1ca8641`；sidecar/pages canonical；local raw2452 materialization caveat 非源矛盾、非字节等价主张 |
| 稳定键 | 唯一 `hero_skill\|hero_kogmaw\|R\|活体大炮` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers |
| 公式 / fixtures | 嵌套二元 base285；倍率分支与阈值交叉；动态 cost / stacks / CD / resource skip / cap9 / 8000ms lazy expiry；零 listener / ability-start |
| Backend | 初始 `100679a`/`175b03a` + 纠正 `473bd50`/`d563b67`；focused10/10；full770/770；无三元 `add` |
| Wasm | exact `d58370a`；focused + cost-gate；`-count=100`；full Go；标准脚本 TinyGo 1,169,377 / `65A4…C6A0`；Node smoke PASS |
| Web | 资产已同步至同字节/同 SHA；lint/typecheck/Vitest330/build PASS；无 Playwright/E2E |
| 审计 | commit `e81b5b6`；G8 migrated + 空 remainingGap；Unified completed/full；counts 与 §5 最终清单一致 |
| 设计门控 | 仅 v2 READY `run-723a2309…` 有效；v1 REVISE 无效 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
