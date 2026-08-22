TASK_KEY: wasm-generic-graves-collateral-damage-primary-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-22

# 通用 ABI - 格雷福斯 R 终极爆弹（Collateral Damage）主目标命中机制详细设计

关联验证记录：[通用 ABI 格雷福斯 R 终极爆弹 Collateral Damage 主目标命中机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务将精确候选 `hero_skill|hero_graves|R|终极爆弹` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称施放延迟/后坐力位移/弹道几何/直线多目标/爆炸锥形或附加敌人减伤，或完整游戏技能保真。冻结方案：`FROZEN_PLAN_REV graves-r-collateral-damage-primary-hit-phase-a-v2`（第三轮新鲜 DESIGN_REVIEW_ONLY READY `run-51a3bb00-fc6b-4d01-9f66-d7fb0f3f47d7`；strict `grok-4.5`；effort high；fast false；结构化事件 `VERDICT=READY` / `REVIEWED_PLAN_REV=graves-r-collateral-damage-primary-hit-phase-a-v2`；runDeltaCount 0；792/792 JSONL 可解析；无 truncation/mutation。runner 最终散文省略 verdict，以完整结构化 `createPlan` 事件为权威 verdict 证据。冻结 CD 时序 t0/t59999/t60000；忽略审查散文颠倒后两时间戳的笔误）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_graves\|R\|终极爆弹` |
| Wiki | 请求 `Template:Data Graves/R`，解析为 `Template:Data Graves/Collateral Damage`；pageId `1307373`；revision `4007499`；timestamp `2026-04-11T22:21:36Z`；canonical raw bytes `2722`；SHA256 `834843a7722fc9463e21e8d636b8adc644c220928b90f7bb4afedbaa08f85dd1`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/graves-r.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw 为 `2723` bytes，恰含 **一个** 终端 LF；**修剪该唯一终端 LF** 后得到 canonical `2722` bytes / SHA256 `834843a7…f85dd1`。记录为 **terminal-LF materialization caveat**，**不得**表述为源矛盾 |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank3_primary_target_single_hit; immediate_impact_scaffold; physical_575_plus_1_50_bonus_ad; no_cast_delay_recoil_projectile_geometry_line_multitarget_explosion_cone_or_reduced_damage` |
| Rank-3 active | 100 mana；60000ms cooldown；immediate primary-target scaffold；每次成功施放恰好一笔非暴击/不可复制物理伤害 `575 + 1.50 * bonus AD`（`bonus AD = source.attr.ad.resolved - source.attr.ad.base`） |
| 数值交叉 | baseAD66 / resolvedAD120 / bonusAD54 → raw656；目标 armor100 → mitigated328。t0 / t59999 / t60000：两次命中 + 恰好一次 cooldown skip 且不扣 mana、无伤害；mana325 → final125；目标 HP1000 → final344 |
| governed tags（序） | `ability_cost_cooldown`、`active_physical_damage`、`bonus_ad_ratio`、`immediate_impact_scaffold` |
| 直击主目标 vs 附加敌人 | 本切片仅建模 **直击主目标炮弹**。Wiki 附加敌人减伤爆炸锥公式 `440 + 1.20 bonus AD` **仅**适用于额外敌人；对本主目标切片为 **显式排除**（非否认、亦未建模） |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标结算单次物理伤害。Wiki cast delay 与 recoil/位移、弹道/几何、直线多目标、爆炸锥形 **被显式排除**，而非建模或近似；**不**伪造 cast-delay / recoil / explosion phase。不代表真实弹道飞行、直线碰撞、多目标、爆炸锥或附加敌人减伤保真。

| 排除（非 remainingGap / 非 blocker；亦非已建模行为的近似） | 说明 |
| --- | --- |
| cast delay / Effect at cast time end | 施放延迟与 cast-end 时序 **排除而非近似** |
| recoil / displacement / dash | 后坐力位移排除 |
| projectile / travel / collision / range / speed / geometry | 无弹道、碰撞与几何合同 |
| line / multitarget | 直线多目标排除；单主目标单次命中 |
| explosion / cone | 爆炸锥形排除 |
| additional-enemy reduced formula `440 + 1.20 bonus AD` | 附加敌人减伤 **排除而非否认/建模** |
| ranks 1–2 | 仅 Rank3 |
| P / E / W / basic / ammo / reload / True Grit / bonus resistance / on-hit / equipment / loadout | 无其它技能/普攻/被动/抗性/装备耦合 |
| live migration / Admin publish / browser E2E / full-game / full-skill fidelity | 发布与完整保真不在本闭环 |

## 3. 端到端数据流

```text
Wiki graves-r.json (page1307373/rev4007499；canonical SHA 834843a7…)
  → Backend seed（self-contained；provider_hero_graves_r_collateral_damage_primary_hit）
    → Web 既有 generic 投影（无本机制 Web 源码变更；无生产 Wasm/ABI/runtime 变更）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 physical damage operation（575+1.50*bonusAD；runtime physical 20220 / 无 20221）
```

| 层 | 合同 |
| --- | --- |
| Backend | 自包含 seed：baseline hp625 / mana325 / ad66 / ap0 / AS0.475 / armor33 / MR30 / hpregen8 / manaregen8；恰好九条属性定义；保留既有 New Destiny（P）/ Quickdraw（E）/ Smoke Screen（W）providers；仅挂载独立 `provider_hero_graves_r_collateral_damage_primary_hit`；一条 active ability（cost/cooldown）、null-duration impact + on_enter sequence、一笔物理 `575+1.50*(ad.resolved-ad.base)` operation。幂等 material-change revision guard；**无** DELETE/DDL/auto-publish/live execution。owning `9c1087b` / Wasm 集成 `c2a8a97`；focused JUnit 39/39；full Maven 723/723 |
| Web | 既有 generic 投影；owning lint/typecheck/Vitest330/build PASS；integrated lint/typecheck/Vitest136/build PASS；**无**本任务 Web 源码变更（零写入）。**不**声称 Web Wasm 资产与当前 build 同步（见 §5 资产现状限制） |
| Wasm | exact `4abadf1`（`wasm/tinygo_engine_v2/internal/runtime/generic_graves_collateral_damage_primary_hit_test.go`）；真实 CompileGeneric / RunGeneric；focused 4/4 与 full `go test -count=1 ./...` PASS；generic bench100 PASS；TinyGo build PASS（1,168,476 bytes；SHA `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`）；Node canonical compile/run/release smoke PASS。gofmt 机械轮 `run-3834b0bb-42c8-4c6e-8640-ef3ccf925284`（delta1/outside0）。**无**生产 Wasm/ABI/runtime 变更 |

## 4. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW_ONLY READY | run `run-51a3bb00-fc6b-4d01-9f66-d7fb0f3f47d7`；strict `grok-4.5`；effort high；fast false；结构化 `VERDICT=READY` / `REVIEWED_PLAN_REV=graves-r-collateral-damage-primary-hit-phase-a-v2`；runDeltaCount 0；792/792 parseable；无 truncation/mutation；权威 verdict = 完整 `createPlan` 事件（非 runner 最终散文） |
| Backend owning | `9c1087b`；实现 run `run-bbfa015b-6d80-4349-8192-b5eb83108070`（delta3/outside0）；focused 39/39；full Maven 723/723 |
| Backend → Wasm 集成 | `c2a8a97` |
| Wasm exact | `4abadf1`；实现 run `run-68881a1d-f746-4c95-add5-976e4ca9ee5c`（delta1/outside0）；gofmt `run-3834b0bb-42c8-4c6e-8640-ef3ccf925284`（delta1/outside0） |
| 审计 commit | `2f83a06`；实现 run `run-c71831ba-5fd7-4b61-8863-86c9e4551d0f`（final runDelta6/outside0） |
| 最终清单 | G8 242 = migrated60 / partial4 / blocked109 / OOS69；Unified sourceCount12 / total254；completed70 / partial_actionable0 / ready0 / blocked_runtime103 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full70 / partial3 / none181；actionable0；`implementation_gap_no_unresolved_data_fields=85` |

## 5. 审计 override、语义比较与资产现状限制

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_physical_damage|bonus_ad_ratio|immediate_impact_scaffold`）、空 `remainingGap`。raw upstream 字段按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。exact audit override **必须**清掉 governed generic 陈旧状态。

主会话语义比较：ordered keys 242/254 不变；**仅** Graves R 解析行语义变化（除生成时间戳外）。Registry / Batch-G / G8 / Unified checks PASS。

**Web Wasm 资产现状限制（非 Graves R 机制 blocker）**：冻结 Graves R 计划零生产 Wasm/Web 写入，故未扩大亦未同步既有漂移。当前 build size `1,168,476` SHA256 `84977E884BA81B4D19C54A36B454C0D8620FB66ADB14C12F07D2824CCACF0666`；owning Web asset size `1,155,992` SHA256 `6A5250835639AD9A1E70F1A9B2A5811F14E307717779FE89A1A3A46B96A4917A`；Wasm integrated Web asset size `1,101,630` SHA256 `2CE1A0DAF10D193567663F28CD2ACD7941EA62EBF4284C307D5C5CC91C0B0BBF`。记录为独立 artifact-currentness 限制，**不得**误读为 Graves R 机制未闭环；**不得**在本切片同步资产。

非目标（再次强调）：cast delay、recoil/displacement、projectile/travel/collision/range/speed/geometry、line/multitarget、explosion/cone、附加敌人 `440+1.20 bonus AD`、ranks1–2、P/E/W/basic/ammo/reload/True Grit/bonus resistance/on-hit/equipment/loadout、live migration/Admin publish/browser E2E/full-game/full-skill fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Collateral Damage/游戏技能保真；**未**声称总体 Goal 完成。

## 6. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1307373 / rev4007499 / timestamp2026-04-11T22:21:36Z / canonical raw2722 / SHA256 `834843a7…f85dd1`；sidecar/pages canonical；local raw2723 终端 LF caveat 非源矛盾 |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers |
| 公式 / fixtures | Rank3 100 mana / 60000ms；raw656 / mitigated328；t0/t59999/t60000 两命中 + 一 CD skip；mana325→125；HP1000→344 |
| Backend | owning `9c1087b` / 集成 `c2a8a97`；focused39/39；full723/723 |
| Wasm | exact `4abadf1`；focused4/4；full Go / bench100 / TinyGo / Node smoke PASS；产物字节/SHA 不变 |
| 审计 | commit `2f83a06`；G8 migrated + 空 remainingGap；Unified completed/full + 空 blocker/gap evidence null；counts 与 §4 最终清单一致 |
| Web | 无本机制源码写入；资产漂移仅记录 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成 |
