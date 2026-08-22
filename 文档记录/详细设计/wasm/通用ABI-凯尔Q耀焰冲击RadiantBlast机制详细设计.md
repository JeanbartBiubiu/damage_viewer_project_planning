TASK_KEY: wasm-generic-kayle-radiant-blast
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-20

# 通用 ABI - 凯尔 Q 耀焰冲击（Radiant Blast）Phase-A rank5 机制详细设计

关联验证记录：[通用 ABI 凯尔 Q 耀焰冲击 Radiant Blast 机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务在当前 **Phase-A rank5 主目标 1v1** 内将精确候选 `hero_skill|hero_kayle|Q|耀焰冲击` 标为 `completed/full/generic_runtime`（G8 `migrated`）；**不**宣称完整游戏技能保真。

## 1. Exact candidate completed 声明（Phase-A 边界）

本项为 **completed/full**（本任务冻结的 Phase-A rank5 主目标）：表达 rank5 Q 魔法伤害、先伤后击碎抗性、资源/冷却。不得误称完整英雄 Q / 全技能保真。

| 环节 | 合同 |
| --- | --- |
| Wiki 真源（Q 数值） | `数据参考/lol-wiki-current-champions/normalized/generic/kayle-q.json`；revision `4005105`；contentSha256 `ded516de4861d88de21ba54de9a8723b654f424f1cc3f9dac30d06382ee1a87c` |
| Bootstrap 面板 provenance | Backend seed 可引用 Module:ChampionData / 面板 bootstrap 作为 **英雄实体面板** 出处；**不得**冒充本 Q 机制数值真理；本地无 Module dump 时 **不**编造 contentSha256 |
| scope | 仅 rank5 主目标 1v1 Phase-A；无专用英雄分支；**不以** Meraki/DataDragon 为当前 Q 数值真理 |
| ability | key `radiant_blast`；100 mana；冷却 8000ms；ops：`damage/magic` → `state_change` provider-target override |
| 伤害 | `180 + 0.60*(source.attr.ad.resolved-source.attr.ad.base) + 0.50*source.attr.ap.resolved`（嵌套二元 `add`） |
| state | `kayle_q_sundered`：default0 / max1 / 4000ms / `refresh_on_write` |
| shred | source-owned attribute modifiers：`opponent.attr.armor` 与 `opponent.attr.magic_resist` / `percent_add` = `-0.15 * provider.target_state.kayle_q_sundered` |
| evidence | CompileGeneric → RunGeneric：`generic_kayle_radiant_blast_test.go` + `lol_generic_kayle_radiant_blast_seed.sql` |
| 探针 | Wasm fixture **仅测试** 物理/魔法 probe；**不得**进入生产 seed/文档作为生产操作 |

不新增 runtime、DDL、Wasm ABI/DTO 或生产发布流程；只复用既有 ability / cost / cooldown / provider-target state / attribute modifier 语义（Kog'Maw Q + Ashe Volley 模式）。

## 2. 跨模块边界

| Worktree | 职责 | 不越界 |
| --- | --- | --- |
| Backend | 幂等 seed 与静态 SQL 合同测试 | **不得**跑 DDL、live migration、Admin publish；README completed-boundary 文案由 Backend 拥有 |
| Wasm | 既有 generic runtime 合同回归 + G8/unified generator/`--check` | 无 runtime / ABI / DTO 扩展 |
| Web | 既有 generic assembler 投影（validation-only） | 无产品专用 special case、无 live E2E |
| Planning | 本详细设计、验证记录与 `task_rules.json` 映射 | 不改 Backend/Wasm/Web 生产代码 |

## 3. 可表达机制边界

仅使用既有 Generic ABI：

- ability / mana cost / cooldown
- ordered operations：`damage` then `state_change`（`state_scope/provider_target`）
- provider timed target state + attribute `percent_add` on opponent armor/MR
- formula：`add`/`mul`/`sub`/`read`（bonus AD + AP）

**无专用英雄分支。** 无 slow / projectile / multi-target 操作。

## 4. Phase-A 排除（非 remainingGap / 非 blocker）

下列分支为 Phase-A 排除，**不是**剩余缺口：

- slow（减速）
- portal launch delay
- attack-windup cast time
- projectile travel / collision
- cross expansion / secondary targets
- ranks 1–4
- death persistence（死后 portal 仍发射等）
- live migration、Admin publish、E2E、完整 live-game 保真
