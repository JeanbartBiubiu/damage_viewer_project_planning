TASK_KEY: wasm-generic-quinn-vault-primary-hit
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-24

# 通用 ABI - 奎因 E 旋翔掠杀（Vault）主目标伤害机制详细设计

关联验证记录：[通用 ABI 奎因 E 旋翔掠杀 Vault 主目标伤害机制验证记录](../../测试记录/wasm/通用ABI-奎因E旋翔掠杀Vault主目标伤害机制验证记录-2026-07-24.md)。本任务将精确候选 `hero_skill|hero_quinn|E|旋翔掠杀` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated` exact override）；关闭此前 `blocked_runtime` / `distance_or_ratio_input`（dash prose **不是**距离伤害倍率；保留 raw baseline provenance）。**不**宣称 dash/tracking/bounce/geometry、knockback/slow、Harrier/P/W、basic-attack reset/autoattack，或完整游戏技能保真。冻结方案：`FROZEN_PLAN_REV quinn-e-vault-phase-a-v1`（DESIGN_REVIEW READY `run-d8b6235d-dbff-4aef-9a8b-3c6187998f8a`；strict `grok-4.5`；effort high；fast false；runDelta0/diff0；1265 JSONL events parseable；43 unique direct tool calls all completed；无 truncation / mutation / orphans；无 user decision。非阻塞笔记已接受：README/seed 顺序 W → Q(resource) → E，E 仅检查既有中性 mana resource 行且不以 Q provider 为前置；governed distance override only 同时保留 raw baseline；嵌套二元 `add`）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_quinn\|E\|旋翔掠杀` |
| Wiki | 请求 `Template:Data Quinn/E`，解析为 `Template:Data Quinn/Vault`；pageId `1308957`；revision `4024768`；timestamp `2026-06-03T00:51:11Z`；canonical raw bytes `2649`；SHA256 `9f6baba1d062b473d41586cd8323f31bd7c1c4d865db134a783c19ae998e7714`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/quinn-e.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw materialization 亦为 `2649` bytes / SHA256 `317ac3ccf31e53ba17255dbb15c856ba5499d9257fbe0c9faa91b43f8438e24b`。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾 |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated`（exact override；dash prose 非 distance damage multiplier；保留 raw baseline provenance） |
| completedBoundary | `rank5_primary_champion_single_hit; immediate_impact_scaffold; physical_140_plus_0_20_bonus_ad; no_dash_tracking_bounce_geometry_knockback_slow_harrier_mark_basic_attack_reset_auto_attack_or_other_ranks` |
| governed tags（序） | `ability_cost_cooldown`、`active_physical_damage`、`bonus_ad_ratio`、`immediate_impact_scaffold` |
| Rank-5 active | 50 mana；8000ms cooldown；immediate primary-champion scaffold；每次成功施放恰好一笔非暴击/不可复制物理伤害 `140 + 0.20*(source.attr.ad.resolved-source.attr.ad.base)`（嵌套二元 `add`）；**零** provider state / listener / direct emit / control / repeat |
| 事件范围 | runtime **可**合成既有 `ability_started`；E **不**产生 `basic_attack_hit`、**不**武装既有 Quinn W、**不**改变 AS；**不**宣称全局零事件 |
| 数值交叉 | 默认 baseAD59 / resolvedAD139 → raw156 / armor100 → mitigated78；baseline resolvedAD59 → raw140 / mitigated70 |
| 日程交叉 | mana150：t0 / t7999 / t8000 → 两次成功 + 恰好一次 cooldown skip（无 mana/伤害），final mana50；mana49 → resource skip / 无伤害 |
| Backend 顺序 | seed/README 顺序 W → Q(resource) → E；E **仅**检查既有中性 mana resource 行，**不**要求 Q provider 本身存在 |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Immediate impact 是 **Phase-A scaffold**：成功施放后立即对主目标（primary champion）结算单次物理伤害；不代表 dash/tracking/bounce、knockback/slow、Harrier 标记或 basic-attack reset。

| 排除（非 remainingGap / 非 blocker；亦非已建模行为的近似） | 说明 |
| --- | --- |
| dash / tracking / bounce / range / speed / wall / geometry / grounded / knockdown | 位移与几何全部排除 |
| knockback / airborne / slow / control / facing / windup | 控制与朝向全部排除 |
| Harrier / P / W interaction | Harrier 标记与 P/W 耦合全部排除 |
| basic-attack reset / fuzzy delay / autoattack | 普攻重置与自动攻击全部排除 |
| failed-too-far / spellshield / callforhelp | 失败分支与护盾/仇恨全部排除 |
| ranks 1–4 | 仅 Rank5 |
| other Quinn skills / basic | 无其它技能/普攻耦合（W/Q seed 仅作 mana resource 前置顺序，非本机制完成条件） |
| loadout / crit / on-hit | 无负荷/暴击/on-hit 耦合 |
| live migration / Admin publish / browser E2E / full-game / full-skill fidelity | 发布与完整保真不在本闭环 |

## 3. 端到端数据流

```text
Wiki quinn-e.json (page1308957/rev4024768；canonical SHA 9f6baba1…)
  → Backend seed（lol_generic_quinn_vault_primary_hit_seed.sql；
     provider_hero_quinn_e_vault_primary_hit；嵌套二元物理公式；
     顺序 W → Q(resource) → E；E 仅 check 既有 mana resource）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；资产已与当前 build 同步且本轮不变）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → null-duration impact + on_enter sequence
    → 一笔 physical damage operation（nested binary 140+0.20*bonusAD）
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_quinn_vault_primary_hit_seed.sql` + `LolGenericQuinnVaultPrimaryHitSeedSqlTest`：独立 `provider_hero_quinn_e_vault_primary_hit`；50 mana / 8000ms CD；immediate primary-champion scaffold；一笔嵌套二元物理伤害。seed/README 顺序 W → Q(resource) → E；E 仅检查既有中性 mana resource 行，**不**要求 Q provider 本身。owning `c487eb47b872c63b70f9d9709a66d807b5b924a8` / 集成 `3f698ab4ec4992a5bb1fb3e73e38e59c24c7b182`；focused JUnit **9/9**；full Maven **789/789**。实现 run `run-31ec64a5-be95-4e0c-8af2-93760f2c5a77`（delta3/outside0；1003 events；37 unique calls completed；无 truncation/orphans）。**无** live seed execution |
| Web | **无**本机制 Web 源码或资产写入/commit。当前源资产与标准 build 精确同字节/同 SHA（`1,169,377` / `65A4C6F8…C6A0`）；本轮 test-only Wasm 追加后资产**保持同步且不变**。**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E |
| Wasm | exact `bfe9e5bcef59f863c0aab5591c766f5d80bf65bb`（`generic_quinn_vault_primary_hit_test.go`）；实现 run `run-0a658dac-5fd0-45bd-b076-b488758cf1d1`（delta1/outside0；685 events；29 unique calls all completed；无 truncation）。主验证：focused `-count=100` PASS；full `go test -count=1 ./...` PASS；标准 `scripts/build-wasm.ps1` 产物 **1,169,377** bytes，SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`（相对既有标准 build **未变**）；Node canonical compile/run/release smoke PASS。**无**生产 Wasm 写入/commit |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放（mana150） | 扣 50 mana；一笔物理伤害；CD 武装 |
| t7999（CD 内） | 恰好一次 cooldown skip；不扣 mana、无伤害 |
| t8000 再次成功 | 第二次命中；final mana50 |
| mana49 | resource skip；无伤害 |
| 默认交叉 | baseAD59 / resolvedAD139 → raw156 / armor100 → 78 |
| baseline 交叉 | resolvedAD59 → raw140 / mitigated70 |
| 事件 | 可合成 `ability_started`；无 `basic_attack_hit`；不武装 W；不改 AS |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止把 dash prose 写成 distance damage multiplier；禁止把 exclusions 写成 remainingGap 或近似实现 |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY | `run-d8b6235d-dbff-4aef-9a8b-3c6187998f8a`；strict `grok-4.5`；effort high；fast false；READY；runDelta0/diff0；1265 parseable；43 unique direct tool calls completed；无 truncation/mutation/orphans；无 user decision；非阻塞笔记已接受 |
| Backend owning / 集成 | owning `c487eb47b872c63b70f9d9709a66d807b5b924a8`；集成 `3f698ab4ec4992a5bb1fb3e73e38e59c24c7b182`；run `run-31ec64a5-be95-4e0c-8af2-93760f2c5a77`（delta3/outside0；1003 events；37 unique calls completed；无 truncation/orphans）；focused9/9；full Maven **789/789**；无 live seed |
| Wasm exact | `bfe9e5bcef59f863c0aab5591c766f5d80bf65bb`；run `run-0a658dac-5fd0-45bd-b076-b488758cf1d1`（delta1/outside0；685 events；29 unique calls completed；无 truncation） |
| Web | 无本机制写入；资产保持 `1,169,377` / `65A4…C6A0` 同步不变 |
| 审计 commit | `299da97cf4d606a0fef90b5d872b0fd7a5aafb9e`；run `run-ca65f4d0-ee7c-46c6-aac3-f7be285b9235`（delta6/outside0；1192 events；75 unique calls completed；无 truncation；四 generator checks PASS；语义比较证明 G8/Unified key order 不变且**仅** Quinn E 对象变化） |
| 最终清单 | G8 242 = migrated67 / partial4 / blocked102 / OOS69；Unified sourceCount12 / total254；completed77 / partial_actionable0 / ready0 / blocked_runtime96 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full77 / partial3 / none174；actionable0；`implementation_gap_no_unresolved_data_fields=79`；Wiki-only registry check candidate242 / migrated48 / partial5 / blocked120 / OOS69；Batch-G / G8 / Unified checks PASS；242/254 keys/order 不变，**仅** Quinn E 语义对象变化。治理 tasks 必须为 90 |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_physical_damage|bonus_ad_ratio|immediate_impact_scaffold`）、空 `remainingGap`。exact override 因 dash prose 不是距离伤害倍率；raw upstream 字段按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。

主会话语义比较：ordered keys 242/254 不变；**仅** Quinn E 记录/机制语义变化（metadata source hash / generatedAt 除外）。Registry / Batch-G / G8 / Unified checks PASS。

**Web Wasm 资产现状（本机制当前状态）**：本轮为 test-only Wasm 追加，**无**生产 Wasm 或 Web 写入/commit。源资产保持与标准 build 精确一致——size `1,169,377` / SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`。该状态为既有同步结果的延续（artifact parity）；**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。

非目标（再次强调）：dash/tracking/bounce/range/speed/wall/geometry/grounded/knockdown、knockback/airborne/slow/control/facing/windup、Harrier/P/W interaction、basic-attack reset/fuzzy delay/autoattack、failed-too-far/spellshield/callforhelp、ranks1–4、other Quinn skills/basic、loadout/crit/on-hit、live migration/Admin publish/browser E2E/full-game/full-skill fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Vault/游戏技能保真；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1308957 / rev4024768 / timestamp2026-06-03T00:51:11Z / canonical raw2649 / SHA256 `9f6baba1…e7714`；sidecar/pages canonical；local raw2649 / SHA `317ac3cc…8438e24b` materialization caveat 非源矛盾、非字节等价主张 |
| 稳定键 | 唯一 `hero_skill\|hero_quinn\|E\|旋翔掠杀` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers |
| 公式 / fixtures | 嵌套二元 `140+0.20*bonusAD`；默认与 baseline 交叉；CD/resource 日程；零 provider state/listener/direct emit/control/repeat；无 `basic_attack_hit` / 不武装 W / 不改 AS；无 distance damage multiplier |
| Backend | owning `c487eb4` / 集成 `3f698ab`；focused9/9；full789/789；W→Q(resource)→E 顺序；E 仅 check mana resource；无 live seed |
| Wasm | exact `bfe9e5b`；focused `-count=100`；full Go；标准脚本 TinyGo 1,169,377 / `65A4…C6A0`（未变）；Node smoke PASS；无生产 Wasm 写入 |
| Web | 无本机制写入；资产保持同字节/同 SHA 同步不变 |
| 审计 | commit `299da97`；G8 migrated + 空 remainingGap；Unified completed/full；counts 与 §5 最终清单一致 |
| 设计门控 | READY `run-d8b6235d…`；非阻塞笔记已接受 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
