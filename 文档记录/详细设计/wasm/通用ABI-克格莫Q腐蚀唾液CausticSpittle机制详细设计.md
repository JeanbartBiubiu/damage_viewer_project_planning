TASK_KEY: wasm-generic-kogmaw-caustic-spittle
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-14

# 通用 ABI - 克格莫 Q 腐蚀唾液（Caustic Spittle）rank5 被动攻速机制详细设计

关联验证记录：[通用 ABI 克格莫 Q 腐蚀唾液 Caustic Spittle 机制验证记录](../../测试记录/wasm/通用ABI-克格莫Q腐蚀唾液CausticSpittle机制验证记录-2026-07-14.md)。本任务只迁移 G8 精确候选中的 Kog'Maw Q / Caustic Spittle **rank5 常驻被动攻速**子集；G8 分类为 `partial`，不得标为 fully migrated，亦不得误称完整 Q。

## 1. Exact candidate partial 声明

本项为 **candidate-level partial**：仅表达 rank5 被动常驻 `+25% attack speed`；不宣称完整英雄 Q 闭环。

| Rank | 被动攻速加成 |
| --- | ---: |
| 1 | 5% |
| 2 | 10% |
| 3 | 15% |
| 4 | 20% |
| 5 | 25% |

本批只实现 **rank5**，常数 `0.25`（`percent_add`）。其它 rank 数值表未建模。

## 2. 数据合同

| 环节 | 合同 |
| --- | --- |
| scope | 仅 rank5 常驻被动攻速；无专用英雄分支 |
| provider | 独立 `provider_hero_kogmaw_caustic_spittle`，mount `hero_kogmaw` |
| formula | `caustic_spittle_attack_speed`，const `0.25` |
| modifier | attribute modifier，target `attack_speed`，`valuePolicy=percent_add` |
| 不含 | ability / listener / state / effect / damage |
| cross-check | base AS `0.72` × `(1 + 0.25)` → resolved `0.90`；无 mount 保持 `0.72` |

不新增 runtime、DDL、Wasm ABI/DTO 或生产发布流程；只复用既有 provider mount、formula const 与 attribute percent_add 管线。

## 3. 跨模块边界

| Worktree | Commit | 职责 | 不越界 |
| --- | --- | --- | --- |
| Backend | `bb26fa7` | 幂等单事务 seed；依赖 Batch-B `hero_kogmaw` / reserved / `attack_speed`；静态 SQL 测试 | **不得**跑 DDL、live migration、Admin publish |
| Wasm | `10a6658` | 仅 generic 目标测试 + G8 generator/`--check`；证明 `0.72→0.90`、attribute-only、无 mount=`0.72` | 无 runtime / ABI / DTO 扩展 |
| Web | `85b4ea8` | 既有 generic assembler 投影 formula / modifier / mount；test-only | 无产品专用 special case、无 live E2E |
| Planning | 本详细设计、验证记录与 `task_rules.json` 映射 | 不改 Backend/Wasm/Web 代码 |

## 4. 可表达机制边界

仅使用既有 Generic ABI：

- 独立 provider mount 到 `hero_kogmaw`
- formula const `0.25`
- attribute modifier `attack_speed` / `percent_add`

**无专用英雄分支。** 无 ability / listener / state / effect / damage 合同。

## 5. 非目标（仍属边界外）

- Q 主动命中魔法伤害。
- 护甲 / 魔抗击碎（armor / MR shred）。
- Q cast / cooldown / rotation。
- 其它 rank（5% / 10% / 15% / 20%）数值。
- live migration、Admin publish、浏览器对 live backend 的 E2E。
- 把本 partial 误计为完整腐蚀唾液 / 完整 Q 闭环，或宣称 G8 全量 goal 完成。
