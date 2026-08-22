TASK_KEY: wasm-generic-xayah-deadly-plumage
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-25

# 通用 ABI - 霞 W 致死羽衣（Deadly Plumage）Phase-A rank5 机制详细设计

关联验证记录：[通用 ABI 霞 W 致死羽衣 Deadly Plumage 机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务在用户批准的 **Phase-A rank5 1v1 近似** 内将精确候选 `hero_skill|hero_xayah|W|致死羽衣` 标为 `completed/full/generic_runtime`（G8 `migrated`）；**不**宣称完整游戏技能保真。

## 1. Exact candidate completed 声明（Phase-A 边界）

本项为 **completed/full**（用户批准 Phase-A rank5 1v1）：表达 rank5 W 施放资源/冷却、时限攻速、以及 Wiki 次级羽刃 25% 的 **合并普攻倍率** 近似。不得误称完整英雄 W / 全技能保真。

| 环节 | 合同 |
| --- | --- |
| Wiki | `数据参考/lol-wiki-current-champions/normalized/generic/xayah-w.json`；revision `4010669`；contentSha256 `09d5476533722311e85c4ca79813cd0bec2cf35d105be894b80dac14478845a7` |
| scope | 仅 rank5 1v1 Phase-A；无专用英雄分支；**不以** Meraki/DataDragon 为当前 W 数值真理 |
| ability | key `deadly_plumage`；40 mana；冷却 14000ms；**无** damage 操作 |
| listener | `ability_started` + `event/source_owner` → 武装 `deadly_plumage_active=1`（max1 / 4000ms / refresh_on_write） |
| AS | `attack_speed` / `percent_add`：`0.55 * provider.state.deadly_plumage_active`（base `0.60→0.93`） |
| 伤害近似 | source-owned pipeline：`kind=pipeline` / `command=damage` / `channel=basic_damage` / `bucket=all_instances` / `stage=outgoing_pre_mitigation` / `priority=0` / `valuePolicy=multiply`；value `1 + 0.25 * provider.state.deadly_plumage_active`；condition `min(eq(damage.trait.on_hit,0), eq(damage.trait.proc,0))` |
| crit | 先独立 expected-crit：`base*(1-p)+base*p*critMultiplier`，再对合并结果 **恰好一次** ×1.25；**无** crit pipeline modifiers |
| phantom | 仅 `CopyableOnHit` 重放；非 copyable 基攻不重放；Xayah basic_damage 倍率不在 phantom settlement 重跑 |
| evidence | CompileGeneric → RunGeneric：`generic_xayah_deadly_plumage_test.go` + `lol_generic_xayah_deadly_plumage_seed.sql` |

不新增 runtime、DDL、Wasm ABI/DTO 或生产发布流程；只复用既有 ability / cost / cooldown / listener / state / attribute+pipeline modifier 语义。

## 2. 跨模块边界

| Worktree | Commit（当前基线） | 职责 | 不越界 |
| --- | --- | --- | --- |
| Backend | `084f4dc`（本任务未单独提交则保持 worktree 基线） | 幂等 seed 与静态 SQL 合同测试（focused 10/10） | **不得**跑 DDL、live migration、Admin publish |
| Wasm | `58fd761`（本任务未单独提交则保持 worktree 基线） | 既有 generic runtime 合同回归 + G8/unified generator/`--check` | 无 runtime / ABI / DTO 扩展 |
| Web | `b14638a` | 既有 generic assembler 投影 kind/command/channel/bucket/stage/value/condition；`target_attr_key='hp'` 仅为 pipeline 占位 | 无产品专用 special case、无 live E2E（本任务 **validation-only**） |
| Planning | 本详细设计、验证记录与 `task_rules.json` 映射 | 不改 Backend/Wasm/Web 生产代码 | |

## 3. 可表达机制边界

仅使用既有 Generic ABI：

- ability / mana cost / cooldown
- `ability_started` listener + provider timed state
- attribute modifier `attack_speed` / `percent_add`
- pipeline damage modifier `basic_damage` / `outgoing_pre_mitigation` / `multiply`

**无专用英雄分支。** 无第二伤害实例 / 独立次级羽刃 missile。

## 4. 用户批准排除（非 remainingGap / 非 blocker）

下列分支为用户批准排除，**不是**剩余缺口：

- 移动速度加成与 Rakan / 洛联动。
- Runaan / 多目标。
- projectile / in-flight / ward / blind / dodge / block 细节。
- 独立次级羽刃 missile / 第二伤害操作。
- 其它 rank、完整 live-game 保真。
- live migration、Admin publish、浏览器对 live backend 的 E2E。

## 5. 2026-07-25 ability-type listener isolation addendum（当前证据）

本补记**仅**记录 ability-type listener 隔离与 Q 共存证据；**不**重分类 W，**不**改变既有 Phase-A 合同：40 mana / 14000ms CD / 4000ms timed AS +55% / pipeline basic_damage ×1.25。

| 项 | 当前合同 / 证据 |
| --- | --- |
| Backend type | game-local type `62012` `ability/xayah_deadly_plumage` |
| relation | W ability type relation 挂载该 type |
| listener | `ability_id IS NULL`（`AbilityRef` 不是事件过滤） |
| match set | exact ALL types `{20205, 20212, 62012}` |
| runtime | W ability 带该 type；listener matcher = `event/ability_started` + `event/source_owner` + ability type；`ListenerDefinition.AbilityRef` 为空 |
| Q 共存 | Q 成功/skip 不交叉武装 W（W inactive / AS baseline）；W 成功在 Q 已挂载时仅武装 W、零 Q 伤害 |
| commits / runs | Backend owning `8ace954`（恢复 `run-3c2645ea…`）；集成 `6bab0b8`（接受 `run-f84ba8c6…`）；Wasm exact `dd7dae6`（`run-8fbe36dd…`）；审计 `d94d35a`（`run-aae6eb8d…`） |
| canonical hashes | Xayah W G8 `dd91a84a1e307ab4540b9d0f422c3715334ecdac3ac01580c5cb04859f6d938f`、Unified `b03237eb01927cccdfa38f2abacd12f2cf0a17cf0b5bbcde75f06b7870b45ed4` 在 Q 闭环审计中**保持字节语义不变** |
| 纠正范围 | isolation-only；不改变 W 分类或数值/公式/state/modifier 合同 |

当前盘点（2026-07-25，只读审计 JSON）：G8 242 = migrated70 / partial4 / blocked99 / OOS69；Unified254 sourceCount12 = completed80 / partial_actionable0 / ready0 / blocked_runtime93 / blocked_data3 / OOS72 / regression5 / stale1；completionMode full80 / partial3 / none171；`implementation_gap_no_unresolved_data_fields=76`；`actionableKeyCount=0`（**不是**停工条件）。
