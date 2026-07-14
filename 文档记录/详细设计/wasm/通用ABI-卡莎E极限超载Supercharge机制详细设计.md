TASK_KEY: wasm-generic-kaisa-supercharge
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-15

# 通用 ABI - 卡莎 E 极限超载（Supercharge）rank5 机制详细设计

关联验证记录：[通用 ABI 卡莎 E 极限超载 Supercharge 机制验证记录](../../测试记录/wasm/通用ABI-卡莎E极限超载Supercharge机制验证记录-2026-07-15.md)。本任务只迁移 G8 精确候选 `hero_skill|hero_kaisa|E|极限超载` 中的 **rank5** 可表达子集；G8 分类为 `partial`，不得标为 fully migrated，亦不得误称完整 E。

## 1. Exact candidate partial 声明

本项为 **candidate-level partial**：仅表达 rank5 E 施放资源/冷却、充能完成近似触发、`supercharge_active` 时限态与攻速加成；不宣称完整英雄 E 闭环。

| 环节 | 合同 |
| --- | --- |
| scope | 仅 rank5；无专用英雄分支，全部由既有 generic ability / cost / cooldown / listener / state / modifier 表达 |
| ability | `ability_hero_kaisa_e_supercharge`，key `supercharge` |
| cost / CD | 30 mana；冷却 10000ms |
| listener | 通用 `ability_started`：**充能完成近似**（非字面 cast-start；本批无 cast-time scheduler） |
| state | provider-scoped `supercharge_active`，持续 4000ms |
| modifier | `attack_speed` / `valuePolicy=percent_add`，公式 `0.80 * provider.state.supercharge_active` |
| cross-check | base AS `0.60 * (1 + 0.80) = 1.08`；mana `100 → 70`；state 到期后 AS 回 `0.60`；冷却内重复施放被阻断 |

不新增 runtime、DDL、Wasm ABI/DTO 或生产发布流程；只复用既有 ability / cost / cooldown / listener / state / modifier 语义。

## 2. 跨模块边界

| Worktree | Commit | 职责 | 不越界 |
| --- | --- | --- | --- |
| Backend | `275fd67` | 幂等 seed 与静态 SQL 合同测试 | **不得**跑 DDL、live migration、Admin publish |
| Wasm | `588e0f7` | 既有 generic runtime 合同回归 + G8 generator/`--check` 更新 | 无 runtime / ABI / DTO 扩展 |
| Web | `58962a4` | 既有 generic assembler 投影回归（test-only） | 无产品专用 special case、无 live E2E |
| Planning | 本详细设计、验证记录与 `task_rules.json` 映射 | 不改 Backend/Wasm/Web 代码 |

## 3. 可表达机制边界

仅使用既有 Generic ABI：

- ability 定义与施放 key `supercharge`
- mana cost / cooldown
- `ability_started` listener（充能完成近似）
- provider-scoped timed state `supercharge_active`
- attribute modifier `attack_speed` / `percent_add`（`0.80 * state`）

**无专用英雄分支。** 无 DDL / ABI / DTO 扩展、无 live migration / publish。

## 4. 非目标（仍属边界外）

- 移动速度加成与幽灵（ghosting）。
- attack-windup 变化。
- 真实充能 / cast 时序（本批无 cast-time scheduler；`ability_started` 仅为充能完成近似）。
- 每次普攻返还 0.5s 冷却。
- 进化版隐形。
- 其它 rank、完整 rotation / cadence。
- live migration、Admin publish、浏览器对 live backend 的 E2E。
- 把本 partial 误计为完整极限超载 / 完整 E 闭环，或宣称 G8 全量 goal 完成。
