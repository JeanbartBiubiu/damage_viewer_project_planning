TASK_KEY: wasm-generic-tristana-rapid-fire-timed-bonus-attack-speed
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-26

# 通用 ABI - 崔丝塔娜 Q 急速射击（Rapid Fire）限时攻速机制详细设计

关联验证记录：[通用 ABI 崔丝塔娜 Q 急速射击 Rapid Fire 限时攻速机制验证记录](../../测试记录/wasm/通用ABI-崔丝塔娜Q-急速射击限时攻速机制验证记录-2026-07-26.md)。本任务将精确候选 `hero_skill|hero_tristana|Q|急速射击` 标为 `completed/full/generic_runtime`（G8 governed disposition `migrated`）；关闭此前 `blocked_runtime` / `implementation_gap_no_unresolved_data_fields`。**不**宣称 rank-up update、attack animation/windup、basic attack count/rotation、cooldown bypass/reset/direct state admin、ranks1-4、P/W/E/basic/Explosive Charge/loadout、bootstrap、Q damage/heal/shield/control/repeat/explicit event、Buster Shot dependency/synthesis，或完整 Rapid Fire/游戏保真；本闭环是 **rank5 自身限时攻速**（ability-type listener isolation 相对 Buster Shot），**不是**完整 Q；**未**声称总体 Goal 完成。冻结方案：`FROZEN_PLAN_REV tristana-q-rapid-fire-timed-bonus-attack-speed-phase-a-v1`（有效 DESIGN_READY `run-22dbfa4d-cdf8-4d91-ae21-d0cc5c23f906`；strict model；runDelta0/diff0；1496 parseable event lines / 65/65 complete tool groups；无 truncation / mutation；三条非阻塞笔记已接受，**不是** blockers）。

## 1. Exact candidate completed 声明

| 环节 | 合同 |
| --- | --- |
| stable key | `hero_skill\|hero_tristana\|Q\|急速射击` |
| Wiki | 请求 `Template:Data Tristana/Q`，解析为 `Template:Data Tristana/Rapid Fire`；pageId `1308522`；revision `4026462`；timestamp `2026-06-09T21:59:03Z`；canonical raw bytes `872`；SHA256 `f6465863035c4634510ecc96e9ee04f4a998d150871d88e498e6636e27a9d4da`；sidecar `数据参考/lol-wiki-current-champions/normalized/generic/tristana-q.json` plus pages sibling 为权威；sourceCount **仍为 12**（9 active + 3 generators；无新源） |
| raw caveat | 仓库 local raw materialization 为 `866` bytes，SHA256 `db084b4142559f0775af841fe163e1b80880e2661b26b6d82fb26261e1f5d170`。**sidecar/pages 拥有 canonical 身份**；**故意不断言** local raw 字节等价，亦**不得**表述为源矛盾（local raw materialization caveat only） |
| status | `completed/full/generic_runtime`；G8 governed disposition `migrated` |
| completedBoundary | `rank5_self_timed_bonus_attack_speed; duration_7000ms; bonus_attack_speed_120_percent; cooldown_16000ms_prevents_recast_before_expiry; ability_type_listener_isolation_from_buster_shot; no_rank_up_update_attack_animation_windup_basic_attack_count_rotation_cooldown_bypass_other_ranks_or_full_fidelity` |
| governed tags（序） | `ability_cost_cooldown`、`active_attack_speed_modifier`、`timed_state`、`ability_type_listener_isolation`（G8 override 写入序；Unified 全局 `localeCompare` 序列化时显示序可能不同——集合相同，不得误读为两套 tags） |
| Rank-5 active | 35 mana；16000ms cooldown；timed provider state `rapid_fire_active`（default0 / max1 / duration7000ms）；`attack_speed` `percent_add` 精确 `1.20 * rapid_fire_active`；game-local type **62013** `ability/tristana_rapid_fire`；listener **空** `AbilityRef` + exact ALL `{event/ability_started, event/source_owner, ability/tristana_rapid_fire}`；**无** damage / 显式 event op；成功施放自动合成恰好一次 `ability_started` |
| Phase-A 语义框定 | 将 Rank-5 leveling 的自身限时攻速表达为 **有界 self timed bonus attack speed**。CD **16000ms** > duration **7000ms**，故正常成功再施放路径无法在窗内 refresh；**不得**把 runtime refresh 策略本身描述为 non-refreshing |
| Standalone | Tristana Q provider **独立**；**不**依赖 Tristana P/W/E/basic/Explosive Charge；**不**依赖或合成 Buster Shot；**不**合成 Batch-B 或 sibling Tristana 机制 |
| Q/R isolation | R 单独施放留下 Q state0 / AS0.60，且仅产生 R 伤害；Q 武装 Q / AS1.32，且**不**产生 R 伤害 |
| Backend 前置 | 仓库**无** repository-owned `hero_tristana` / attack_speed / mana materializer；seed/JUnit 仅记录 **external-existing-data/check-only** 前置；**不**写入 identity/panel/resource materialization；**不** live-publish |
| 数值 / 日程交叉 | baseline AS0.60；active AS1.32（t0 through t6999）；baseline AS0.60 at t7000；mana105 t0/t15999/t16000 → success/skip/success、恰好两次 Q `ability_started`、readyAt16000、final mana35 / state1 / AS1.32；mana34 → resource skip / 不变 |
| 发布边界 | **不**执行 live migration / Admin publish / push / browser E2E |

## 2. Phase-A scaffold 与排除

本机制是 **cast 触发的限时 provider-state 自身攻速**：成功施放发出 `ability_started` → ability-type isolation listener（空 AbilityRef + ALL started/source_owner/Q-type）武装 `rapid_fire_active=1` → `attack_speed` percent_add `1.20 * rapid_fire_active`。下列排除为 **completed-boundary exclusions**，**不是** remaining blockers，亦**不是**已建模行为的近似：

| 排除 | 说明 |
| --- | --- |
| rank-up update | 升阶刷新/更新全部排除 |
| attack animation / windup | 攻击动画与 windup 全部排除 |
| basic attack count / rotation | 普攻次数与轮转全部排除 |
| cooldown bypass / reset / direct state admin | 冷却绕过/重置与直接状态管理全部排除 |
| ranks 1–4 | 仅 Rank5 |
| P / W / E / basic / Explosive Charge / loadout | 无其它技能/普攻/爆炸火花/负荷耦合 |
| bootstrap | 启动/bootstrap 路径全部排除 |
| Q damage / heal / shield / control / repeat / explicit event | Q 无伤害/治疗/护盾/控制/重复/显式 event |
| Buster Shot dependency / synthesis | **不**依赖或合成 R；仅 isolation 共存 |
| live migration / Admin publish / browser E2E / full Rapid Fire / full-game fidelity | 发布与完整保真不在本闭环；本闭环是 rank5 限时攻速，不是完整 Q |

## 3. 端到端数据流

```text
Wiki tristana-q.json (page1308522/rev4026462；canonical SHA f6465863…)
  → Backend seed（lol_generic_tristana_rapid_fire_timed_bonus_attack_speed_seed.sql；
     provider_hero_tristana_q_rapid_fire_timed_bonus_attack_speed；
     35 mana / 16000ms CD；rapid_fire_active 7000ms；
     AS percent_add 1.20*rapid_fire_active；type 62013；
     listener 空 AbilityRef + ALL {20205,20212,62013}；
     hero_tristana/attack_speed/mana external-existing-data/check-only；
     不物化 identity/panel/resource；standalone 无 sibling 合成）
    → Web 既有 generic 投影（无本机制 Web 源码/资产写入；Built 与独立 Web worktree 资产已与当前 build 同步且本轮不变）
    → Wasm CompileGeneric → RunGeneric → ReleaseSession
    → ability cost/cooldown → automatic ability_started
    → isolation listener → rapid_fire_active=1（7000ms）
    → attack_speed percent_add 1.20 * rapid_fire_active
```

| 层 | 合同 |
| --- | --- |
| Backend | seed `db/game_manage/seeds/lol_generic_tristana_rapid_fire_timed_bonus_attack_speed_seed.sql`（SHA256 `146a1c6ead2c42e76133da184860adc01d006cca33784b441001f93d60f8e09d`）+ `LolGenericTristanaRapidFireTimedBonusAttackSpeedSeedSqlTest`（SHA256 `fa2e8658b82dca7389d9b86a4f01c78bc90b284355bcd689dcbdc874f8e01d08`）；README `server/data_manage/README.md` SHA256 `551ebe5574c73c66f6e65b3322150df48fadd6fca7ef223e4c3330369a487d31`：独立 `provider_hero_tristana_q_rapid_fire_timed_bonus_attack_speed`；35 mana / 16000ms CD；timed state + AS percent_add；type 62013 isolation；`hero_tristana`/attack_speed/mana 为 **external-existing-data/check-only**（不物化 identity/panel/resource；不 live-publish；standalone 无 Batch-B/sibling 合成）。owning `abc7500cba2ca33fc162a489535842ef11fdd675`（`run-9ab9684f-3134-48a0-8754-f7155a82a895`；runDelta3/outside0；主 focused11 / adjacent49 / full922 PASS）。镜像 `5d468bfaf854058632e45a45ceb8fdbedbdeccd8`（`run-e8e80b77-837c-410d-9efc-b59fc52ce735`；runDelta3/outside0；精确 parity）。较早 `run-766a0fbf-2fa0-4a8e-a802-4d8cec290dfa` 因 driving-prompt SHA typo 以 delta0 停止且**无** task write——**不是**完成证据。**无** live seed execution |
| Web | **无**本机制 Web 源码或资产写入/commit。Built 与独立 Web worktree 资产均 **1,169,377** bytes / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`；本轮 test-only Wasm 追加后资产**保持同步且不变**。**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E |
| Wasm | exact `ddbca0f9f46e7450e3c8127e9073d115d3b62615`（`generic_tristana_rapid_fire_timed_bonus_attack_speed_test.go`）；实现 run `run-6e1cb345-6311-45df-bbd2-5496968816ef`（runDelta1/outside0）。主验证：focused6 / full / bench / build / smoke / benchmark PASS。Built 与独立 Web worktree 均 **1,169,377** / `65a4…c6a0`；**无** Web 文件变更/拷贝；**无**生产 Wasm 写入/commit |

## 4. 运行时日程与失败/停止条件

| 时刻 / 条件 | 合同结果 |
| --- | --- |
| t0 成功施放（mana105；baseline AS0.60） | 扣 35 mana；`rapid_fire_active=1`；AS→1.32；CD 武装；一次 `ability_started` |
| t0 through t6999 | AS 保持 1.32；state 保持 1 |
| t7000 | state 到期；AS 回 0.60 |
| t15999（CD 内） | 恰好一次 cooldown skip；不扣 mana、不写状态；readyAt16000 |
| t16000 再次成功 | 第二次 Q start；final mana35 / state1 / AS1.32；两次 `ability_started` |
| mana34 | resource skip；mana/AS/state 不变；无 Q start |
| R alone（Q/R isolation） | Q state0 / AS0.60；仅 R damage；不武装 Q |
| Q after R mount | Q arms Q / AS1.32；无 R damage |
| 失败/停止 | 禁止 DDL/DELETE/auto-publish/live；禁止把 exclusions 写成 remainingGap 或近似实现；禁止物化 check-only 身份/面板/资源；禁止合成 Batch-B/sibling / Buster Shot；禁止把 runtime refresh 策略本身写成 non-refreshing；禁止把本限时攻速误称为完整 Q |

## 5. 证据锚点

| Worktree / 阶段 | Commit / Run |
| --- | --- |
| DESIGN_REVIEW READY | `run-22dbfa4d-cdf8-4d91-ae21-d0cc5c23f906`；READY；strict model；runDelta0/diff0；1496 parseable events / 65/65 complete tool groups；无 truncation/mutation；三条非阻塞笔记已接受（非 blockers） |
| Backend owning | owning `abc7500cba2ca33fc162a489535842ef11fdd675`；`run-9ab9684f-3134-48a0-8754-f7155a82a895`（runDelta3/outside0）；主 focused11 / adjacent49 / full922 PASS；seed SHA `146a1c6e…e09d`；JUnit SHA `fa2e8658…01d08`；README SHA `551ebe55…87d31` |
| Backend 镜像（Wasm worktree） | `5d468bfaf854058632e45a45ceb8fdbedbdeccd8`；`run-e8e80b77-837c-410d-9efc-b59fc52ce735`（runDelta3/outside0；精确 parity）。较早 `run-766a0fbf…` 因 SHA typo delta0 停止、无 task write——非完成证据 |
| Wasm exact | `ddbca0f9f46e7450e3c8127e9073d115d3b62615`；`run-6e1cb345-6311-45df-bbd2-5496968816ef`（runDelta1/outside0）；focused6/full/bench/build/smoke/benchmark PASS；Built/独立 Web 资产 `1,169,377` / `65a4…c6a0`；无 Web 写入 |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持 `1,169,377` / `65a4…c6a0` |
| 审计接受 | commit `168341833a597addc83b34c7fa1c9a027fc6caaf`；`run-c4348cec-caa9-4e8a-a7cf-f4056af704c7`（strict model；runDelta8/outside0）。主五检查通过；语义比较证明**仅** Tristana Q G8/Unified 记录变化，且 provisional **仅**移除 Tristana Q |
| 最终清单 | registry 242 = migrated48 / partial5 / blocked120 / OOS69；G8 242 = migrated82 / partial4 / blocked87 / OOS69；inScope173；Unified sourceCount12 / total254；completed92 / partial_actionable0 / ready0 / blocked_runtime81 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full92 / partial3 / none159；implementation gap64；actionable0；provisional84（runtime81/data3；hero82/item2）。治理 tasks 必须为 106。报告口径：严格 verified completion **92/254=36.2%**；completed + provisional implementation-description coverage **176/254=69.3%**；当前 84 张 template-eligible blocked 键均有 provisional 卡；provisional 仍为 unverified，**不是** completed 主张 |

## 6. 审计 override、语义比较与资产现状

G8 最终 governed 字段：`genericClassification=migrated`、exact `genericMechanismTags`（序：`ability_cost_cooldown|active_attack_speed_modifier|timed_state|ability_type_listener_isolation`）、空 `remainingGap`。raw upstream 字段按既有 G8 schema 保留为历史输入 provenance，**不是**最终 disposition。

主会话语义比较：ordered keys 242/254 不变；**仅** Tristana Q 记录/机制语义变化（metadata source hash / generatedAt 除外）；provisional 仅移除 Tristana Q（85→84）。Registry / Batch-G / G8 / Unified / provisional checks PASS。先前 completed/migrated 记录保持锁定。稳定 digests 不变。

**Web Wasm 资产现状（本机制当前状态）**：本轮为 test-only Wasm 追加，**无**生产 Wasm 或 Web 写入/commit。Built 与独立 Web worktree 源资产保持与标准 build 精确一致——size `1,169,377` / SHA256 `65a4c6f848e614791509a9c849518a3d50c2ef1af4fbcfa55823e56ca1d7c6a0`。该状态为既有同步结果的延续（artifact parity）；**不是** bilateral runtime 替代，亦**不是** Playwright / live E2E。

非目标（再次强调）：rank-up update、attack animation/windup、basic attack count/rotation、cooldown bypass/reset/direct state admin、ranks1-4、P/W/E/basic/Explosive Charge/loadout、bootstrap、Q damage/heal/shield/control/repeat/explicit event、Buster Shot dependency/synthesis、live migration/Admin publish/browser E2E/full Rapid Fire/full-game fidelity。不得误称排除行为已实现、已近似为建模行为，或完整 Rapid Fire/游戏技能保真；本闭环是 **rank5 自身限时攻速**，**不是**完整 Q；**未**声称总体 254 机制 Goal 完成。`actionableKeyCount=0` **不是**停工条件。Tristana Q 为 standalone；Backend 无 repository-owned `hero_tristana`/attack_speed/mana materializer——仅 external-existing-data/check-only；listener 空 AbilityRef + type **62013** isolation；正常路径因 CD16000>duration7000 而无法窗内再施放 refresh，**不得**把 refresh 策略本身写成 non-refreshing。

## 7. 验收门控

| 门控 | 要求 |
| --- | --- |
| Wiki 身份 | page1308522 / rev4026462 / timestamp2026-06-09T21:59:03Z / canonical raw872 / SHA256 `f6465863…d4da`；sidecar/pages canonical；local raw866 / SHA `db084b41…d170` materialization caveat only——非源矛盾主张 |
| 稳定键 | 唯一 `hero_skill\|hero_tristana\|Q\|急速射击` |
| 边界 | exact `completedBoundary` 字符串；排除项为 completed-boundary exclusions，非 remaining data/runtime blockers；rank5 限时攻速 + Q/R isolation |
| 公式 / fixtures | AS percent_add `1.20*rapid_fire_active`；state default0/max1/duration7000；35 mana / 16000ms；type 62013；空 AbilityRef + ALL started/source_owner/Q-type；无 damage/显式 event；自动 `ability_started`；baseline0.60 / active1.32 / expire0.60；mana105 日程与 mana34 skip；Q/R isolation；standalone；四 tags 序；CD>duration 正常路径说明（非 refresh-policy 主张） |
| Backend | owning `abc7500c…` / 镜像 `5d468bfa…`；focused11 + adjacent49 + full922；无 live seed |
| Wasm | exact `ddbca0f9…`；focused6/full/bench/build/smoke/benchmark；无生产 Wasm/Web 写入 |
| Web | 无本机制写入；Built/独立 Web worktree 资产保持同字节/同 SHA |
| 审计 | commit `1683418…`；接受 run `run-c4348cec…`；G8 migrated + 空 remainingGap；Unified completed/full；仅 Tristana Q 语义对象变化；provisional 仅移除 Tristana Q；counts 与 §5 最终清单一致 |
| 设计门控 | 有效 READY `run-22dbfa4d…`；runDelta0/diff0；1496 events / 65/65 complete tool groups；无 truncation/mutation；三条非阻塞笔记已接受 |
| 发布 | 无 live / publish / E2E；不宣称 full fidelity / 总体 Goal 完成；`actionableKeyCount=0` 非停工条件 |
