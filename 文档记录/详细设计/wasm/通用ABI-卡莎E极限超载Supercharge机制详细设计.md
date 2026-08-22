TASK_KEY: wasm-generic-kaisa-supercharge
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-20

# 通用 ABI - 卡莎 E 极限超载（Supercharge）rank5 机制详细设计

关联验证记录：[通用 ABI 卡莎 E 极限超载 Supercharge 机制验证记录](../../测试记录/wasm/最小验证剩余阻塞项汇总-2026-07-19.md)。本任务在用户批准的 **Phase-A rank5 1v1 攻速分支** 内将精确候选 `hero_skill|hero_kaisa|E|极限超载` 标为 `completed/full/generic_runtime`（G8 `migrated`）；**不**宣称完整游戏技能保真。

## 1. Exact candidate completed 声明（Phase-A 边界）

本项为 **completed/full**（用户批准 Phase-A rank5 1v1 攻速分支）：表达 rank5 E 施放资源/冷却、充能完成近似触发、时限态与攻速加成。不得误称完整英雄 E / 全技能保真。

| 环节 | 合同 |
| --- | --- |
| Wiki | `数据参考/lol-wiki-current-champions/normalized/generic/kaisa-e.json`；revision `4038391`；contentSha256 `327dc441e84bf2b320dccbe9099b4e98bf42562529e95facd417fbbc27d99e24` |
| scope | 仅 rank5 1v1 攻速分支；无专用英雄分支，全部由既有 generic ability / cost / cooldown / listener / state / modifier 表达 |
| ability | `ability_hero_kaisa_e_supercharge`，key `supercharge` |
| cost / CD | 30 mana；冷却 10000ms |
| listener | 通用 `ability_started`：**充能完成近似**（非字面 cast-start；本批无 cast-time scheduler） |
| state | provider-scoped timed state 持续 4000ms；**Wasm fixture** 键 `supercharge_as_active`，**Backend seed** 键 `supercharge_active`（provider-local/data-defined，本证据语义等价，**非**跨 bundle 字面同键） |
| modifier | `attack_speed` / `valuePolicy=percent_add`，公式 `0.80 * provider.state.<active>`（Wasm 读 `supercharge_as_active`，Backend 读 `supercharge_active`） |
| cross-check | base AS `0.60 * (1 + 0.80) = 1.08`；mana `100 → 70`；state 到期后 AS 回 `0.60`；冷却内重复施放被阻断 |
| evidence | CompileGeneric → RunGeneric：`generic_kaisa_supercharge_test.go` + `lol_generic_kaisa_supercharge_seed.sql` |

不新增 runtime、DDL、Wasm ABI/DTO 或生产发布流程；只复用既有 ability / cost / cooldown / listener / state / modifier 语义。

## 2. 跨模块边界

| Worktree | Commit | 职责 | 不越界 |
| --- | --- | --- | --- |
| Backend | `275fd67` | 幂等 seed 与静态 SQL 合同测试 | **不得**跑 DDL、live migration、Admin publish |
| Wasm | `588e0f7` | 既有 generic runtime 合同回归 + G8/unified generator/`--check` 更新 | 无 runtime / ABI / DTO 扩展 |
| Web | `58962a4` | 既有 generic assembler 投影回归（test-only） | 无产品专用 special case、无 live E2E |
| Planning | 本详细设计、验证记录与 `task_rules.json` 映射 | 不改 Backend/Wasm/Web 代码 |

## 3. 可表达机制边界

仅使用既有 Generic ABI：

- ability 定义与施放 key `supercharge`
- mana cost / cooldown
- `ability_started` listener（充能完成近似）
- provider-scoped timed state：Wasm fixture `supercharge_as_active` / Backend seed `supercharge_active`（语义等价，非跨 bundle 字面同键）
- attribute modifier `attack_speed` / `percent_add`（`0.80 * state`）

**无专用英雄分支。** 无 DDL / ABI / DTO 扩展、无 live migration / publish。

## 4. 用户批准排除（非 remainingGap / 非 blocker）

下列分支为用户批准排除，**不是**剩余缺口：

- 移动速度加成与幽灵（ghosting）。
- attack-windup 变化。
- 真实充能 / cast 时序（`ability_started` 仅为充能完成近似）。
- 每次普攻返还 0.5s 冷却。
- 进化版隐形。
- 其它 rank、完整 rotation / cadence、多目标。
- live migration、Admin publish、浏览器对 live backend 的 E2E。
- 完整游戏技能保真或 G8 全量 goal。
