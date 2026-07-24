TASK_KEY: wasm-generic-quinn-harrier-premarked-consume
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: cursor-agent
LAST_TRACKED_AT: 2026-07-24

# 通用 ABI - 奎因 P 侵扰（Harrier）预标记普攻消耗机制详细设计

关联验证记录：[通用 ABI 奎因 P 侵扰 Harrier 预标记普攻消耗机制验证记录](../../测试记录/wasm/通用ABI-奎因P侵扰Harrier预标记普攻消耗机制验证记录-2026-07-24.md)。本任务将精确候选 `hero_skill|hero_quinn|P|侵扰` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated` exact override；保留 raw baseline provenance）。关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称 Harrier 标记产生（Q/E/Skystrike/Valor）、时长/reveal/overwrite/冷却/选敌/AI、monster flat75、R disable、parry、levels1–17，或完整游戏技能保真；**不**宣称 W AS 幅度校正。冻结方案：`FROZEN_PLAN_REV quinn-p-harrier-premarked-consume-phase-a-v2`（DESIGN_REVIEW READY `run-e139d9f9-e2bb-4333-835a-8f186c6d4008`；strict `grok-4.5`；effort high；fast false；runDelta0/diff0；2037 JSONL events parseable；55 unique direct tool calls all completed；无 truncation / orphans；无 user decision。较早 v1 `quinn-p-harrier-premarked-consume-phase-a-v1` 为 `REVISE`——因一步 orphaned wrong-path read **不是**干净门控，**不是** READY；selector/`20110+20252`（Wasm `source`+`provider_target`）发现已吸收进 v2）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_quinn\|P\|侵扰` |
| Wiki | 请求 `Template:Data Quinn/I`，解析为 `Template:Data Quinn/Harrier`；pageId `1308953`；revision `4024765`；timestamp `2026-06-03T00:49:03Z`；canonical raw bytes `2390`；SHA256 `740debfb3b72dd7f926337f7eb4adbe3a65c88caec227ca16e00dff6634f798c`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/quinn-p.json`；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw materialization 亦为 `2390` bytes / SHA256 `08853c2c25ada7769e25908123dbb56f7b14dc0c1479a8a5842693874849a731`。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾 |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated`（exact override；保留 raw baseline provenance） |
| completedBoundary | `level18_preexisting_harrier_target_single_basic_attack_consume; bonus_physical_120_plus_0_40_bonus_ad; preserve_heightened_senses_arm; no_mark_generation_ability_application_duration_reveal_valor_targeting_monster_bonus_r_disable_parry_or_other_levels` |
| governed tags（序） | `on_hit`、`formula_on_hit`、`bonus_ad_ratio`、`copyable_on_hit_false`、`provider_target_state_consume` |
| Level-18 premark | 预先存在 `harrier_vulnerable` 的目标上，owner `basic_attack_hit` 时：同既有 W provider 有序 arm `heightened_senses_active=1` → 恰好一笔非暴击/不可复制物理 `120+0.40*(source.attr.ad.resolved-source.attr.ad.base)`（嵌套二元 `add`）→ consume mark；Backend selector/self `20110` + scope `provider_target` `20252` / Wasm `source`+`provider_target`；无 mark 不触发 |
| 事件范围 | 扩展既有 W provider 监听 `basic_attack_hit`；**不**产生主动施放/cost/cooldown；**不**生成 mark；**不**宣称 W AS 幅度校正 |
| 数值交叉 | bonusAD80 → raw152 / armor100 → mitigated76；baseline raw120 / mitigated60 |
| 日程交叉 | t0 / t3000 两次 AA、仅初始一枚 mark → 恰好一次 P bonus；双 listener 顺序（W→P / P→W）结果相同 |
| Backend 前置 | 扩展既有 `provider_hero_quinn_heightened_senses`；W 行 check-only；Q/E/mana **非**前置 |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

Phase-A 只关闭 **预存在 Harrier 标记** 上的单次 owner 普攻消耗命中：arm 既有 W active → 一笔 bonus 物理 → consume mark。不代表标记产生、时长、Valor AI、monster 加成或 R disable。

| 排除（非 remainingGap / 非 blocker；亦非已建模行为的近似） | 说明 |
| --- | --- |
| mark generation（Q / E / Skystrike / Valor targeting） | 标记产生全部排除 |
| duration / refresh / overwrite / reveal / Harrier cooldown | 时长与冷却全部排除 |
| targeting / visibility / AI | 选敌与 AI 全部排除 |
| monster flat75 | 野怪加成排除 |
| Behind Enemy Lines R disable / clear | R 禁用排除 |
| parry / negation | 格挡/否定排除 |
| levels 1–17 | 仅 level18 固定 `120+0.40*bonusAD` |
| multitarget / minions / monsters / loadout / crit / on-hit replication | 多目标与复制全部排除 |
| W AS magnitude correction | **不**宣称对本轮 AS 幅度的校正 |
| live migration / Admin publish / browser E2E / full-game / full-skill fidelity | 发布与完整保真不在本闭环 |

## 3. 端到端数据流

```text
Wiki quinn-p.json (page1308953/rev4024765；canonical SHA 740debfb…)
  → Backend seed（lol_generic_quinn_p_harrier_premarked_consume_seed.sql；
     扩展既有 provider_hero_quinn_heightened_senses；
     arm → nested binary 120+0.40*bonusAD → consume 20110+20252）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；资产已与当前 build 同步且本轮不变）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → basic_attack_hit（premark）→ W arm + P bonus + mark consume
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_quinn_p_harrier_premarked_consume_seed.sql` + `LolGenericQuinnPHarrierPremarkedConsumeSeedSqlTest` + README：扩展既有 W provider；W 行 check-only；嵌套二元物理；`20110+20252`。owning `0a6301e70a85c6e677c8ce26a746d170bafe784f` / 集成 `12d92810147ccfb626edfc3e26795551c01c2585`；focused JUnit **8/8**；full Maven **797/797**。实现 run `run-391e437d-0b99-49de-9570-1b6eeadf208b`（delta3/outside0；960 events；46 unique calls completed；无 truncation）。**无** live seed execution |
| Web | **无**本机制 Web 源码或资产写入/commit。当前源资产与标准 build 精确同字节/同 SHA（`1,169,377` / `65A4C6F8…C6A0`）；本轮 test-only Wasm 追加后资产**保持同步且不变**。**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E |
| Wasm | exact `7c84b369688d67017182e090cc5dc88fdef15d37`（`generic_quinn_harrier_premarked_consume_test.go`）；实现 run `run-a3e0519c-b956-4b5d-8f23-b0c7560026a9`（delta1/outside0；1010 events；61 unique calls；一笔 orphaned read-only grep；无 truncation；diff 独立复核）。主验证：focused `-count=100` PASS；full `go test -count=1 ./...` PASS；标准 `scripts/build-wasm.ps1` 产物 **1,169,377** bytes，SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`（相对既有标准 build **未变**）；Node canonical compile/run/release smoke PASS。**无**生产 Wasm 写入/commit |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| premark=1 + owner AA（bonusAD80） | arm W active=1；一笔物理 raw152 / armor100 → 76；mark → 0 |
| baseline（resolvedAD=baseAD） | raw120 / mitigated60 |
| 无 premark | 零 P bonus；mark0；W 不因本机制武装 |
| t0 / t3000 两次 AA（仅初始一枚 mark） | 两次基础 AA；恰好一次 P bonus；无第二次 W re-arm |
| W→P 与 P→W listener 顺序 | P 伤害 / consume / W-arm 结果相同 |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止把 exclusions 写成 remainingGap 或近似实现；禁止宣称 W AS 幅度校正 |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY | `run-e139d9f9-e2bb-4333-835a-8f186c6d4008`；strict `grok-4.5`；effort high；fast false；READY；runDelta0/diff0；2037 parseable；55 unique direct tool calls completed；无 truncation/orphans；无 user decision；v1 REVISE 非干净门控（orphaned wrong-path read）；selector/`20110+20252` 已吸收 |
| Backend owning / 集成 | owning `0a6301e70a85c6e677c8ce26a746d170bafe784f`；集成 `12d92810147ccfb626edfc3e26795551c01c2585`；run `run-391e437d-0b99-49de-9570-1b6eeadf208b`（delta3/outside0；960 events；46 unique calls completed；无 truncation）；focused8/8；full Maven **797/797**；无 live seed |
| Wasm exact | `7c84b369688d67017182e090cc5dc88fdef15d37`；run `run-a3e0519c-b956-4b5d-8f23-b0c7560026a9`（delta1/outside0；1010 events；61 unique calls；一笔 orphaned read-only grep；无 truncation；diff 独立复核） |
| Web | 无本机制写入；资产保持 `1,169,377` / `65A4…C6A0` 同步不变 |
| 审计 commit | `7c81a6b04d3085dbefee93055b9cfbcb32460059`；run `run-9d0ecd29-e7bd-45d5-9361-824faba46b1b`（delta6/outside0；1042 events；92 unique calls completed；无 truncation；四 generator checks PASS；语义比较证明 G8/Unified key order 不变且**仅** Quinn P 对象变化） |
| 最终清单 | G8 242 = migrated68 / partial4 / blocked101 / OOS69；Unified sourceCount12 / total254；completed78 / partial_actionable0 / ready0 / blocked_runtime95 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full78 / partial3 / none173；actionable0；`implementation_gap_no_unresolved_data_fields=78`；Wiki-only registry check candidate242 / migrated48 / partial5 / blocked120 / OOS69；Batch-G / G8 / Unified checks PASS；242/254 keys/order 不变，**仅** Quinn P 语义对象变化。治理 tasks 必须为 91 |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`on_hit|formula_on_hit|bonus_ad_ratio|copyable_on_hit_false|provider_target_state_consume`）、空 `remainingGap`。exact override 保留 raw upstream 字段为历史输入 provenance，**不是**最终 disposition。

主会话语义比较：ordered keys 242/254 不变；**仅** Quinn P 记录/机制语义变化（metadata source hash / generatedAt 除外）。Registry / Batch-G / G8 / Unified checks PASS。

**Web Wasm 资产现状（本机制当前状态）**：本轮为 test-only Wasm 追加，**无**生产 Wasm 或 Web 写入/commit。源资产保持与标准 build 精确一致——size `1,169,377` / SHA256 `65A4C6F848E614791509A9C849518A3D50C2EF1AF4FBCFA55823E56CA1D7C6A0`。该状态为既有同步结果的延续（artifact parity）；**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。

非目标（再次强调）：mark generation（Q/E/Skystrike/Valor）、duration/reveal/overwrite/cooldown、targeting/AI、monster75、R disable、parry、levels1–17、multitarget/loadout/crit/replication、W AS magnitude correction、live migration/Admin publish/browser E2E/full-game/full-skill fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Harrier/游戏技能保真；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1308953 / rev4024765 / timestamp2026-06-03T00:49:03Z / canonical raw2390 / SHA256 `740debfb…798c`；sidecar/pages canonical；local raw2390 / SHA `08853c2c…a731` materialization caveat 非源矛盾、非字节等价主张 |
| 稳定键 | 唯一 `hero_skill\|hero_quinn\|P\|侵扰` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers |
| 公式 / fixtures | 嵌套二元 `120+0.40*bonusAD`；bonusAD80→152/76；baseline120/60；无 mark 不触发；t0/t3000 仅一次；双 listener 顺序相等；`20110+20252` / source+provider_target；不宣称 W AS 幅度校正 |
| Backend | owning `0a6301e` / 集成 `12d9281`；focused8/8；full797/797；扩展既有 W provider；W rows check-only；无 live seed |
| Wasm | exact `7c84b36`；focused `-count=100`；full Go；标准脚本 TinyGo 1,169,377 / `65A4…C6A0`（未变）；Node smoke PASS；无生产 Wasm 写入 |
| Web | 无本机制写入；资产保持同字节/同 SHA 同步不变 |
| 审计 | commit `7c81a6b`；G8 migrated + 空 remainingGap；Unified completed/full；counts 与 §5 最终清单一致 |
| 设计门控 | READY `run-e139d9f9…`；v1 REVISE 非干净门控；selector 发现已吸收 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
