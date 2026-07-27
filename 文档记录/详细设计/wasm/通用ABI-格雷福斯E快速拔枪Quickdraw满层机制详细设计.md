TASK_KEY: wasm-generic-graves-quickdraw-max-stack
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-20

# 通用 ABI - 格雷福斯 E 快速拔枪（Quickdraw）Phase-A 满层机制详细设计

关联验证记录：[通用 ABI 格雷福斯 E 快速拔枪 Quickdraw 满层机制验证记录](../../测试记录/wasm/通用ABI-格雷福斯E快速拔枪Quickdraw满层机制验证记录-2026-07-20.md)。本任务在用户批准的 **Phase-A rank-5 满层 True Grit 近似** 内将精确候选 `hero_skill|hero_graves|E|快速拔枪` 标为 `completed/full/generic_runtime`（G8 `migrated`）；**不**宣称完整游戏技能保真。

## 1. Exact candidate completed 声明（Phase-A 边界）

本项为 **completed/full**（用户批准 rank-5 max-stack Phase-A）：一次施放直接把 `true_grit_stacks` 写成满层 8，并解析四条抗性 flat-add。不得误称完整英雄 E / 位移 / 装填 / 弹丸 CD 返还保真。

| 环节 | 合同 |
| --- | --- |
| Wiki 真源（E 数值） | `数据参考/lol-wiki-current-champions/normalized/generic/graves-e.json`；revision `4007744`；contentSha256 `ff4c65c5ce2a0ac1ae757271fbb924b35bf4eca1af0f4d07a69d865db901a4e1` |
| Bootstrap 面板 provenance | Module:ChampionData / `graves-champion-data.json`（rev `4042886` 等）仅作 `hero_graves` level-1 面板 bootstrap；**不是** E 机制数值真理 |
| scope | 仅 rank-5 满层 True Grit 近似；无专用英雄生产分支；**不以** Meraki/DataDragon/截图/OCR 为当前 E 数值真理 |
| ability | `ability_hero_graves_quickdraw`；40 mana；冷却 12000ms；唯一 op：`state_change` + `state_scope/provider` + `value_policy/override` → `true_grit_stacks = 8` |
| state | `true_grit_stacks`：default0 / max8 / **untimed** |
| SQL ↔ DTO | Backend SQL：`duration_ms=NULL`、`refresh_policy_type_id=NULL`（schema 禁止 `duration_ms=0`）；组装后 generic DTO/runtime 语义：`durationMs=0`、无 `refreshPolicy` |
| armor / bonus_armor | 各 `19 * provider.state.true_grit_stacks`（满层 +152） |
| magic_resist / bonus_magic_resist | 各嵌套 `mul(mul(19, 0.5), stacks)` ≡ `(19*0.5)*stacks`（满层 +76；**不**烘焙成字面量 `9.5`） |
| evidence | Backend：`lol_generic_graves_quickdraw_max_stack_seed.sql` + `LolGenericGravesQuickdrawMaxStackSeedSqlTest`；Wasm：`generic_graves_quickdraw_max_stack_test.go`（CompileFrame→RunFrame→ReleaseSessionFrame） |

不新增 runtime、DDL、Wasm ABI/DTO 或生产发布流程；只复用既有 ability / cost / cooldown / provider state / attribute flat-add / nested formula 语义。

## 2. 真源拆分（source ownership）

| 真源 | 用途 | 不得冒充 |
| --- | --- | --- |
| `graves-e.json` rev `4007744` / SHA256 `ff4c65c5…` | Phase-A 满层 True Grit / mana / CD / 每层护甲公式数值真理 | Bootstrap 面板 |
| `graves-champion-data.json` / Module:ChampionData | `hero_graves` 实体 level-1 面板 bootstrap（与 P seed 同字面量） | E 机制完成证据 |
| Graves P seed / `provider_hero_graves_new_destiny` | 同英雄既有普攻图；本 E seed **不得**覆写 | E 图 |
| DDragon / Meraki / 截图 / OCR | **禁止** | — |

未来 Wiki registry / 规范化管道 redesign **不在本任务范围**（仅此一句 out-of-scope；本设计不以之为依赖）。

## 3. 精确数据 / 图合同

### 3.1 IDs

| 角色 | ID |
| --- | --- |
| provider | `provider_hero_graves_quickdraw_max_stack` |
| stableId | `hero_graves_e_quickdraw_max_stack` |
| ability | `ability_hero_graves_quickdraw` |
| state | `true_grit_stacks` |
| step（Backend） | `step_hero_graves_quickdraw_true_grit_max` |
| modifiers（Backend modifier_id / key） | `modifier_hero_graves_quickdraw_armor` / `true_grit_armor`；`…_bonus_armor` / `true_grit_bonus_armor`；`…_magic_resist` / `true_grit_magic_resist`；`…_bonus_magic_resist` / `true_grit_bonus_magic_resist` |

Wasm fixture 使用同一 provider/ability/state 语义；modifier_key 可为 fixture 本地前缀，目标属性与 AST 必须与上表一致。

### 3.2 Nested formula AST

- armor / bonus_armor：`{"op":"mul","args":[{"op":"const","value":19},{"op":"read","path":"provider.state.true_grit_stacks"}]}`
- MR / bonus_MR：`{"op":"mul","args":[{"op":"mul","args":[{"op":"const","value":19},{"op":"const","value":0.5}]},{"op":"read","path":"provider.state.true_grit_stacks"}]}`

### 3.3 Lifecycle / 探针期望

| 探针 | 期望 |
| --- | --- |
| 首次施放 | mana `325→285`；`true_grit_stacks` `0→8`；armor `33→185`；bonus_armor `0→152`；MR `30→106`；bonus_MR `0→76` |
| CD 内重施 | `cooldown_not_ready` skip；不扣第二次 mana |
| CD 后第二施 | 仍 cap 在 8；mana 再 −40 → `245` |
| 代数交叉 | 独立 `8*19=152`、`8*19*0.5=76`（不得回走 model AST） |
| 生命周期 | CompileFrame → RunFrame → ReleaseSessionFrame；释放后同 session 再跑 → `session_not_found` |
| 排除图 | 无 damage / reload / projectile / dash / multi_target / geometry；无 timed refresh listener |

面板 baseline（bootstrap，非 E 真理）：armor33 / MR30 / bonus_*0 / mana325。

## 4. SQL NULL ↔ DTO `durationMs=0`（untimed）

Backend `provider_state_fields` 对 untimed 状态写入 `duration_ms=NULL` 且 `refresh_policy_type_id=NULL`，因为 schema **禁止** `duration_ms=0`。Assembler / generic DTO / Wasm runtime 将该 NULL 映射为语义 `durationMs=0`（无 refreshPolicy）。Nightstalker 形 untimed 先例适用；**不得**把 SQL NULL 误读为“未建模”，也不得把 DTO 0 回写成 SQL 0。

## 5. 跨模块边界与写边界

| Worktree | 职责 | 不越界 |
| --- | --- | --- |
| Backend | 幂等 seed + 静态 SQL 合同（10 tests）；ensure `bonus_armor`/`bonus_magic_resist` + EAV base0；独立 mount，不覆写 P 图 | **不得** DDL、live migration、Admin publish |
| Wasm | 既有 generic 合同回归 + G8/unified generator/`--check` | 无 runtime / ABI / DTO / 生产源码改动 |
| Web | 既有 generic assembler 投影（validation-only） | 无产品专用 special case、无 live E2E；本任务无 Web 源码变更 |
| Planning / 本 wasm worktree 治理映射 | 本详细设计、验证记录、剩余阻塞汇总、`task_rules.json` | 不改 Backend/Wasm/Web 生产代码；Planning/master 仍为共享治理真源 |

## 6. 可表达机制边界（无 runtime 变更）

仅使用既有 Generic ABI：

- ability / mana cost / cooldown
- `state_change` + `value_policy/override` + `state_scope/provider`
- provider untimed state（DTO `durationMs=0`）
- attribute `value_policy/add` ×4
- nested binary `mul` / `const` / `read`

**无专用英雄生产分支。** 兼容性声明：本 Phase-A **不**要求、也 **不**引入生产 runtime / ABI / DTO 变更。

## 7. Audit exact override

G8 必须对 `hero_skill|hero_graves|E|快速拔枪` 使用 **exact migrated override**（家族规则会把 `stacking_stat_modifier_on_hit` 一律标 blocked）。Unified 同步 `completed/full/generic_runtime`，清空 `remainingGap`/`blocker`/`runtimeGapEvidence`；排除项记为 completed-boundary exclusions。

期望计数（本闭环后）：G8 `48/5/120/69`；unified total254，completed56，blocked_runtime117，blocked_data3，out_of_scope72，regression_only5，stale_or_duplicate1；full56 / partial5 / none193；`actionableKeyCount=0`。

## 8. Validations / stop conditions

| 门禁 | 要求 |
| --- | --- |
| Backend focused | `LolGenericGravesQuickdrawMaxStackSeedSqlTest` 10/10 |
| Wasm focused | `go test -count=1 -run GravesQuickdrawMaxStack ./internal/runtime/` PASS |
| Audit | G8 + unified 正常再生与 `--check` PASS |
| Governance | `cli.mjs check` / `rebuild` / `docs wasm-generic-graves-quickdraw-max-stack`；**禁止** `--fix-headers` |
| Stop | 若需生产 runtime/ABI/DTO、覆写 Graves P 图、或离开 allowlist 才能修无关治理问题 → 停止并上报 |

## 9. Phase-A 排除（非 remainingGap / 非 blocker）

下列为 completed-boundary exclusions，**不是**剩余缺口：

- intermediate stacks（0..7 逐步叠层）
- 精确 4s refresh / expiry
- dash direction / geometry
- reload / shell
- attack reset
- pellet cooldown reduction
- targeting / collision / multi-target
- damage / 完整 gameplay fidelity
- live migration / Admin publish / E2E
