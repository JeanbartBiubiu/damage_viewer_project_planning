TASK_KEY: wasm-generic-lucian-piercing-light-selected-target-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-25

# 通用 ABI - 卢锡安 Q 透体圣光（Piercing Light）选定目标命中机制详细设计

关联验证记录：[通用 ABI 卢锡安 Q 透体圣光选定目标命中机制验证记录](../../测试记录/wasm/通用ABI-卢锡安Q-透体圣光选定目标命中机制验证记录-2026-07-25.md)。本任务将精确候选 `hero_skill|hero_lucian|Q|透体圣光` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称施法时序、目标领先/闪避、方向、目标射程、射程/宽度/线几何、多目标/AOE、法术护盾、缓冲 W 或 R、E lockout、初始目标死亡提前结束、其它 rank，或其他卢锡安技能/被动/完整游戏技能保真；**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV lucian-q-piercing-light-selected-target-hit-phase-a-v1`（有效 DESIGN_READY `run-198e699d-c358-4417-91c5-014c9aa4fe5f`；strict `grok-4.5` / high / fast=false；runDelta0/diff0；1117 parseable event lines / 58 complete tool groups；无 truncation / blocker / nonblocking / user decision）。首次设计尝试 `run-2f6f3f3c-13eb-41d1-aa1c-e2564c6a0a07`（SDK ETIMEDOUT；仅 52 parseable event lines；runDelta0；无 verdict）**不是**有效门控。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_lucian\|Q\|透体圣光` |
| Wiki | 请求 `Template:Data Lucian/Q`，解析为 `Template:Data Lucian/Piercing Light`；pageId `1308176`；revision `3982579`；timestamp `2026-01-09T09:22:29Z`；canonical raw bytes `1608`；SHA256 `d7b03d15af48312a0ea5a06fa147b43c46d2a7ee6e1491dd121d796a2e452981`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/lucian-q.json` plus pages sibling 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw materialization **亦为** `1608` bytes，但 SHA256 `cd65b80f0580f0e4833028791bba2331a321366307b8c35f7fc28fe06c1f06c1`。**sidecar/pages 拥有 canonical 身份**；相等 size **不是**字节等价；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾（local raw materialization caveat only） |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_primary_champion_selected_target_single_physical_hit; immediate_impact_scaffold; physical_220_plus_1_00_bonus_ad; no_cast_timing_target_lead_or_dodge_direction_target_range_range_width_line_geometry_multitarget_aoe_spell_shield_buffered_w_or_r_e_lockout_initial_target_death_early_end_other_ranks_or_full_fidelity` |
| governed tags（序） | `ability_cost_cooldown`、`active_physical_damage`、`bonus_ad_ratio`、`immediate_impact_scaffold` |
| Rank-5 active | 80 mana；5000ms cooldown；immediate selected-target single physical hit scaffold；每次成功施放恰好一笔非暴击/不可复制物理伤害 `220 + 1.00 * (source.attr.ad.resolved - source.attr.ad.base)`（**显式 bonus AD 减法**，**永不**直接读取 total AD；伤害类型 **20220** + add 策略 **20170**）；成功施放自动合成恰好一次 `ability_started`（无显式 event op）；**零** Q state / modifier / listener |
| Phase-A 语义框定 | 将 Rank-5 leveling 数值的一次所选施加应用到所选主冠军，作为**有界选定目标单次物理命中**。Immediate impact 为 Phase-A scaffold；**不**建模施法时序、目标领先/闪避、方向、射程/宽度/线几何、多目标/AOE、法术护盾、缓冲 W/R、E lockout、初始目标死亡提前结束 |
| Standalone | Lucian Q provider **独立**；**不**合成 Batch-B 或 sibling Lucian 机制（P/W/E/R/basic） |
| Backend 前置 | 仓库**无** repository-owned `hero_lucian` / AD / mana materializer；seed/JUnit 仅记录 **external-existing-data/check-only** 前置；**不**写入 identity/panel/resource materialization；**不** live-publish |
| 数值交叉 | base60/resolved60/armor0 → raw/final220；base60/resolved160/armor0 → raw/final320；base60/resolved160/armor100 → raw320/final160；base60/resolved260/armor100 → raw420/final210；runtime 测试含显式 total-AD 反证 |
| 日程交叉 | mana240 / baseAD60 / resolvedAD160 / HP1000 / armor100：t0 / t4999 / t5000 → success / skip / success；恰好两笔 Q damage；final mana80 / HP680；两次自动 Q `ability_started`；mana79 → resource skip / mana/HP 不变 / 无 Q damage/event |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对选定主目标结算一次有界单次物理命中；不代表完整 Piercing Light 施法时序、线几何、多目标/AOE、缓冲动作或 E lockout。

| 排除（非 remainingGap / 非 blocker；亦非已建模行为的近似） | 说明 |
| --- | --- |
| cast timing | 施法时序全部排除 |
| target lead / dodge | 目标领先与闪避全部排除 |
| direction / target range / range / width / line geometry | 方向、目标射程、射程、宽度与线几何全部排除 |
| multitarget / AOE | 多目标与 AOE 全部排除 |
| spell shield | 法术护盾全部排除 |
| buffered W or R / E lockout | 缓冲 W/R 与 E lockout 全部排除 |
| initial-target-death early end | 初始目标死亡提前结束全部排除 |
| other ranks | 仅 Rank5 |
| other Lucian abilities / passives / basic | 无 P/W/E/R/basic 耦合；不合成 sibling |
| equipment / loadout / crit / on-hit | 无装备/负荷/暴击/on-hit 耦合 |
| live migration / Admin publish / browser E2E / full-game / full Piercing Light / full-skill fidelity | 发布与完整保真不在本闭环 |

## 3. 端到端数据流

```text
Wiki lucian-q.json (page1308176/rev3982579；canonical SHA d7b03d15…)
  → Backend seed（lol_generic_lucian_piercing_light_selected_target_hit_seed.sql；
     provider_hero_lucian_q_piercing_light_selected_target_hit；
     一笔物理伤害 220+1.00*(resolvedAD-baseAD)；type 20220 / add 20170；
     hero_lucian/ad/mana external-existing-data/check-only；
     不物化 identity/panel/resource；standalone 无 sibling 合成）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；Built 与独立 Web worktree 资产已与当前 build 同步且本轮不变）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 physical damage（220+1.00*(ad.resolved-ad.base)；20220/20170）
    → 自动 ability_started ×1 / 成功施放
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_lucian_piercing_light_selected_target_hit_seed.sql`（SHA256 `7ca13108a29471a72bf81e7acd69dd24adbc4b06c32c9583f2554f8cd2b48717`）+ `LolGenericLucianPiercingLightSelectedTargetHitSeedSqlTest`（SHA256 `b4b2d2091cc6dabf5eb746dce5857bc85cccc60f84e564c8fe9cdfca9a46e78b`）：独立 `provider_hero_lucian_q_piercing_light_selected_target_hit`；80 mana / 5000ms CD；immediate selected-target single physical hit scaffold；一笔物理；`hero_lucian`/ad/mana 为 **external-existing-data/check-only**（不物化 identity/panel/resource；不 live-publish；standalone 无 Batch-B/sibling 合成）。owning `bfc9d54e03d3eab3996210e3db3ded8b386189c1`（`run-8c1bb9bc-f8b9-475c-a67a-0e8fedd58ca6`；runDelta3/outside0；858 parseable events / 43 complete tool groups；无 truncation；Cursor focused9 / adjacent38；主 focused+adjacent **47/47** 与 full **875/875**）。镜像 `826cdada7c969a9f2b3aff404e0fe4d780ab3963`（`run-67e686b6-fcc6-4188-967e-afb5aecdb9f2`；runDelta3/outside0；483 parseable events / 5 complete tool groups；无 truncation；三文件精确 parity）。**无** live seed execution |
| Web | **无**本机制 Web 源码或资产写入/commit。Built 与独立 Web worktree 资产均 **1,169,377** bytes / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`；本轮 test-only Wasm 追加后资产**保持同步且不变**。**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E |
| Wasm | exact `aaca3591d338f11012cd915039537aee325ed6ba`（`generic_lucian_piercing_light_selected_target_hit_test.go`）；实现 run `run-688cced5-0836-41f7-a483-84d6353d48ef`（runDelta1/outside0；923 parseable events / 38 complete tool groups；无 truncation）。主验证：focused runtime PASS；full `go test -count=1 ./...` PASS；`go run ./cmd/bench` PASS；标准 TinyGo build PASS；Node smoke PASS；generic benchmark PASS。Built 与独立 Web worktree 均 **1,169,377** / `65a4…c6a0`；**无** Web 文件变更/拷贝；**无**生产 Wasm 写入/commit |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放（mana240；baseAD60；resolvedAD160；armor100） | 扣 80 mana；一笔物理伤害（raw320→final160）；CD 武装；一次 `ability_started` |
| t4999（CD 内） | 恰好一次 cooldown skip；不扣 mana、无伤害、无新 `ability_started` |
| t5000 再次成功 | 第二次命中；两笔 Q damage；final mana80；HP1000→680；两次 `ability_started` |
| mana79 | resource skip；mana/HP 不变；无 Q damage/event |
| 交叉 base60/resolved60/armor0 | raw220；final220 |
| 交叉 base60/resolved160/armor0 | raw320；final320 |
| 交叉 base60/resolved160/armor100 | raw320；final160 |
| 交叉 base60/resolved260/armor100 | raw420；final210 |
| total-AD 反证 | runtime 测试显式证明不得直接读取 total AD |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止把 exclusions 写成 remainingGap 或近似实现；禁止物化 check-only 身份/面板/资源；禁止合成 Batch-B/sibling Lucian；禁止把 bonus AD 误写为 total AD 直接读取 |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN 首次无效 | `run-2f6f3f3c-13eb-41d1-aa1c-e2564c6a0a07`；SDK ETIMEDOUT；仅 52 parseable event lines；runDelta0；无 verdict——**不是**有效门控 |
| DESIGN_REVIEW READY | `run-198e699d-c358-4417-91c5-014c9aa4fe5f`；READY；strict `grok-4.5`/high/fast=false；runDelta0/diff0；1117 parseable events / 58 complete tool groups；无 truncation；无 blocker/nonblocking/user decision |
| Backend owning | owning `bfc9d54e03d3eab3996210e3db3ded8b386189c1`；`run-8c1bb9bc-f8b9-475c-a67a-0e8fedd58ca6`（runDelta3/outside0；858 events / 43 complete tool groups；无 truncation）；Cursor focused9 / adjacent38；主 focused+adjacent **47/47** / full **875/875**；seed SHA `7ca13108…8717`；JUnit SHA `b4b2d209…e78b` |
| Backend 镜像（Wasm worktree） | `826cdada7c969a9f2b3aff404e0fe4d780ab3963`；`run-67e686b6-fcc6-4188-967e-afb5aecdb9f2`（runDelta3/outside0；483 events / 5 complete tool groups；无 truncation）；三文件精确 parity |
| Wasm exact | `aaca3591d338f11012cd915039537aee325ed6ba`；`run-688cced5-0836-41f7-a483-84d6353d48ef`（runDelta1/outside0；923 events / 38 complete tool groups）；focused + full Go + bench + TinyGo + Node smoke + generic benchmark PASS；Built/独立 Web 资产 `1,169,377` / `65a4…c6a0`；无 Web 写入 |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持 `1,169,377` / `65a4…c6a0` |
| 审计初始（非接受） | `run-2bbf3928-e833-4010-8dde-2f51715bba22`；runDelta0——因执行提示两处转录 SHA 矛盾正确停止；主验证冻结 v1 设计提示与仓库权威哈希已正确，仅纠正被忽略的执行提示，**未**改冻结计划 |
| 审计接受 | commit `f4c758e4dd5678dc57bfe653a65786c52a50727b`；fresh retry `run-0994e769-180b-49ec-bef8-a1f1c146348f`（strict `grok-4.5`/high/fast=false；runDelta6/outside0；1219 parseable event lines / 66 complete tool groups；零 truncation）。其 `summary.json` 因 SDK 返回路径字符串含未转义反斜杠而**不可解析**；独立 events JSONL、before/after path signatures、git status/diff 与 runner exit 可用。主会话独立解析全部 1219 events、确立 66/66 complete groups 与零 truncation、解析两份 signature 产物、重跑两生成器 checks 加 registry 与 Batch-G checks，并确认 HEAD 语义 delta/key order。Registry/Batch-G/G8/Unified checks PASS；242/254 keys/order 稳定；**仅** Lucian Q 语义对象变化 |
| 最终清单 | registry 242 = migrated48 / partial5 / blocked120 / OOS69；G8 242 = migrated77 / partial4 / blocked92 / OOS69；inScope173；Unified sourceCount12 / total254；completed87 / partial_actionable0 / ready0 / blocked_runtime86 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full87 / partial3 / none164；implementation gap69；actionable0。治理 tasks 必须为 100 |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_physical_damage|bonus_ad_ratio|immediate_impact_scaffold`）、空 `remainingGap`。raw upstream 字段按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。

主会话语义比较：ordered keys 242/254 不变；**仅** Lucian Q 记录/机制语义变化（metadata source hash / generatedAt 除外）。Registry / Batch-G / G8 / Unified checks PASS。先前 completed/migrated 记录保持锁定。

**Web Wasm 资产现状（本机制当前状态）**：本轮为 test-only Wasm 追加，**无**生产 Wasm 或 Web 写入/commit。Built 与独立 Web worktree 源资产保持与标准 build 精确一致——size `1,169,377` / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`。该状态为既有同步结果的延续（artifact parity）；**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。

非目标（再次强调）：cast timing、target lead/dodge、direction、target range、range/width/line geometry、multitarget/AOE、spell shield、buffered W or R、E lockout、initial-target-death early end、other ranks、other Lucian abilities/passives、equipment/loadout/crit/on-hit、live migration/Admin publish/browser E2E/full-game/full Piercing Light/full-skill fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Piercing Light/游戏技能保真；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。Lucian Q 为 standalone；Backend 无 repository-owned `hero_lucian`/AD/mana materializer——仅 external-existing-data/check-only；伤害为 **显式 bonus AD 减法**（永不 total-AD 直接读取）；类型 **20220** / add **20170**。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1308176 / rev3982579 / timestamp2026-01-09T09:22:29Z / canonical raw1608 / SHA256 `d7b03d15…2981`；sidecar/pages canonical；local raw1608 / SHA `cd65b80f…06c1` materialization caveat——相等 size 非字节等价、非源矛盾主张 |
| 稳定键 | 唯一 `hero_skill\|hero_lucian\|Q\|透体圣光` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers |
| 公式 / fixtures | 一笔 `220+1.00*(resolved-base)`；type 20220 / add 20170；无显式 event op；数值与 CD/resource 日程；自动 `ability_started`；零 Q state/modifier/listener；standalone；含 total-AD 反证；四 tags 序含 `bonus_ad_ratio` |
| Backend | owning `bfc9d54…` / 镜像 `826cdada…`；focused+adjacent 47/47；full 875/875；无 live seed |
| Wasm | exact `aaca3591…`；focused + full Go + bench + TinyGo + Node smoke + generic benchmark；无生产 Wasm/Web 写入 |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持同字节/同 SHA |
| 审计 | commit `f4c758e4…`；接受 run `run-0994e769…`（summary.json 不可解析但 events/signatures/git/runner 可用）；初始 `run-2bbf3928…` 非接受；G8 migrated + 空 remainingGap；Unified completed/full；仅 Lucian Q 语义对象变化；counts 与 §5 最终清单一致 |
| 设计门控 | 有效 READY 仅 `run-198e699d…`；首次 `run-2f6f3f3c…` 无效；runDelta0/diff0；1117 events / 58 complete tool groups；无 truncation/blocker/nonblocking/user decision |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
