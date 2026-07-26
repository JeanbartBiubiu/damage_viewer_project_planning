TASK_KEY: wasm-generic-graves-new-destiny
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-20

# 通用 ABI - 格雷福斯 P 新命运（New Destiny）Phase-A 贴脸机制详细设计

关联验证记录：[通用 ABI 格雷福斯 P 新命运 New Destiny 机制验证记录](../../测试记录/wasm/通用ABI-格雷福斯P新命运NewDestiny机制验证记录-2026-07-20.md)。本任务在冻结的 **Phase-A 贴脸最大弹丸 1v1** 内将精确候选 `hero_skill|hero_graves|P|新命运` 标为 `completed/full/generic_runtime`（G8 `migrated`）；**不**宣称完整游戏技能保真。

## 1. Exact candidate completed 声明（Phase-A 边界）

本项为 **completed/full**（冻结 Phase-A 贴脸合并口径）：表达点空白合并普攻物理伤害、C2 expected-crit 分支 override、单次 hit 契约。不得误称完整英雄被动 / 装填 / 弹道保真。

| 环节 | 合同 |
| --- | --- |
| Wiki 真源（P 数值） | `数据参考/lol-wiki-current-champions/normalized/generic/graves-p.json`；revision `4038342`；contentSha256 `553bda222e9e85f0eff6d4cba3b8723979a58b68fba9097d2dfa1bd373117aa8`；`reviewed-contracts.json#graves-p` |
| Bootstrap 面板 provenance | `数据参考/lol-wiki-current-champions/normalized/graves-champion-data.json`；Module:ChampionData/data pageid `1401029` / revision `4042886` / full-module SHA256 `98094d20…` 仅作检索元数据；**不**存储完整 Module dump；**不是** Graves P 完成证据 |
| scope | 仅贴脸最大弹丸（普通 4 / 暴击 6）合并为一次伤害；无专用英雄生产分支；**不以** Meraki/DataDragon/截图/OCR 为数值真理 |
| ability | key `basic_attack`；Types 含 `ability/basic_attack`（channel `basic_damage`）；ops：`damage/physical` → `emit_event event/basic_attack_hit` |
| 伤害 | `AD * F(x) * (1 + 3*s)`；`x=source.attr.champion_level.resolved`；`AD=source.attr.ad.resolved`；`s=0.33302`；`F(x)=0.6895 + 0.01765*x*(0.595 + 0.0225*(x-1))`；`CritEligible=true`；`copyable_on_hit=false` |
| C2 | natural/forced 同公式 `override`：`((1+5*s)/(1+3*s)) * (1 + 0.5*(source.attr.crit_damage.resolved - 1))`；不双乘 `crit_damage` |
| evidence | CompileFrame → RunFrame → ReleaseSessionFrame：`generic_graves_new_destiny_test.go` + `lol_generic_graves_new_destiny_seed.sql` |

不新增 runtime、DDL、Wasm ABI/DTO 或生产发布流程；只复用既有 ability / formula / C2 pipeline / emit_event 语义。

## 2. 真源拆分

| 真源 | 用途 | 不得冒充 |
| --- | --- | --- |
| `graves-p.json` / `reviewed-contracts#graves-p` | Phase-A 贴脸弹丸伤害与暴击分支数值真理 | Bootstrap 面板 |
| `graves-champion-data.json` | `hero_graves` 实体 level-1 面板 bootstrap provenance | P 机制完成证据 |
| DDragon / Meraki / 截图 / OCR | **禁止** | — |

`reviewed-contracts#graves-p` 可保留 Wiki 文本上的精确装填 unknown 作为 provenance，但**不得**再驱动 `blocked_data` / `dataGapEvidence.missingFields` 分类。

## 3. Phase-A 数学与图语义

- 普通贴脸最大：一次合并物理 raw = `AD * F(x) * (1+3*s)`。
- 暴击贴脸最大：在 expected-crit C2 管道上，natural/forced 分支均 `value_policy=override` 为 Graves 公式（含 `crit_damage.resolved` 的 50% bonus 缩放），避免再乘一次基线 `crit_damage`。
- 图：恰好一次 damage 实例 + 紧随一次 `event/basic_attack_hit`；无装填/弹药/弹道/多目标状态。
- 抗性与护盾：C2 证据（含 branch modifiers）在抗性之前冻结；再经物理抗性；再由护盾吸收。

独立探针（非生产常量）：

| 条件 | expected raw |
| --- | ---: |
| L1 AD100 chance0 | `139.9345498355` |
| L18 AD100 chance0 | `199.9163451355` |
| L18 AD100 chance0.25 critDamage2.0 | `249.88368081131247` |
| L18 AD100 chance0.25 critDamage2.3 | `259.8783230072812` |

## 4. 跨模块边界

| Worktree | 职责 | 不越界 |
| --- | --- | --- |
| Backend | 幂等 seed 与静态 SQL 合同测试 | **不得**跑 DDL、live migration、Admin publish |
| Wasm | 既有 generic runtime 合同回归 + G8/unified generator/`--check` | 无 runtime / ABI / DTO 扩展；无生产源码改动 |
| Web | 既有 generic assembler 投影（validation-only） | 无产品专用 special case、无 live E2E |
| Planning | 本详细设计、验证记录与 `task_rules.json` 映射 | 不改 Backend/Wasm/Web 生产代码 |

## 5. 可表达机制边界

仅使用既有 Generic ABI：

- ability Types `ability/basic_attack` → channel `basic_damage`
- formula `add`/`mul`/`sub`/`div`/`read`（level / AD / crit_damage）
- pipeline crit modifiers：`crit_multiplier_natural_branch` / `crit_multiplier_forced_branch` / `override`
- `CritEligible` + deterministic expected-crit C2
- `emit_event` / `copyable_on_hit=false`

**无专用英雄生产分支。** 无 reload / projectile / multitarget 操作。

## 6. Phase-A 排除（非 remainingGap / 非 blocker）

下列分支为 completed-boundary exclusions，**不是**剩余缺口：

- 精确装填速度公式（Wiki：Precise formula is unknown）
- 弹药计数 / 装填日程 / idle reload / attack lockout / Quickdraw 交互
- 距离 / 锥形 / 弹道 / 碰撞 / 多目标 / 建筑 / 眼与植物
- blind / dodge / block / 击退 / 吸血 / 逐弹 Black Cleaver / Rock Solid 首弹特例
- 独立弹丸实例 / 逐弹 on-hit 重放 / RNG crit 序列
- live migration、Admin publish、E2E、完整 live-game 保真
