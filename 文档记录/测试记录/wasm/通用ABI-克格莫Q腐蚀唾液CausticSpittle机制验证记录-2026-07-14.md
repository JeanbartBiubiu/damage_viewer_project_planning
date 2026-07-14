TASK_KEY: wasm-generic-kogmaw-caustic-spittle
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-14

# 通用 ABI 克格莫 Q 腐蚀唾液 Caustic Spittle 机制验证记录

详细设计：[通用 ABI - 克格莫 Q 腐蚀唾液（Caustic Spittle）rank5 被动攻速机制详细设计](../../详细设计/wasm/通用ABI-克格莫Q腐蚀唾液CausticSpittle机制详细设计.md)。

## 1. 范围与提交

已闭环候选为 Kog'Maw Q / Caustic Spittle **rank5 常驻被动攻速**（游戏语义 `partial` / candidate-level）：独立 provider `provider_hero_kogmaw_caustic_spittle` mount `hero_kogmaw`；formula `caustic_spittle_attack_speed` const `0.25`；attribute modifier target `attack_speed` / `valuePolicy=percent_add`。交叉：base AS `0.72` × `(1 + 0.25)` → resolved `0.90`；无 mount 保持 `0.72`。无 ability / listener / state / effect / damage。

| Worktree | Commit | 内容 |
| --- | --- | --- |
| Backend | `bb26fa7` | 幂等单事务 seed（依赖 Batch-B `hero_kogmaw` / reserved / `attack_speed`）与静态 SQL 测试 |
| Wasm | `10a6658` | generic 目标测试 + G8 generator/`--check`（无 runtime/ABI/DTO 扩展） |
| Web | `85b4ea8` | 既有 generic assembler 对 formula/modifier/mount 的投影回归（test-only，无产品 special case） |

跨 worktree 交付提交已齐；本 Planning 记录只固化证据，**不执行** live migration、Admin publish 或浏览器对 live backend 的 E2E。未建模：主动命中魔法伤害、护甲/魔抗击碎、Q cast/cooldown/rotation、其它 rank。

## 2. Backend

| 验证 | 结果 |
| --- | --- |
| `mvn -Dtest=LolGenericKogmawCausticSpittleSeedSqlTest test` | PASS，6 tests |
| `mvn test` | PASS，309 tests |

静态合同确认 rank5 被动 `+25% AS` only：独立 provider mount、formula const `0.25`、`attack_speed`/`percent_add`；无 ability/listener/state/effect/damage、**无 live DB**、无 DDL、无 migration、无自动 publish。

## 3. Wasm

| 验证 | 结果 |
| --- | --- |
| `go test -count=1 -run TestKogmawCausticSpittle ./internal/runtime/` | PASS |
| `go test -count=1 ./...` | PASS |
| generator 与 `--check` | PASS |

目标证明：mount 后 `0.72→0.90`（attribute-only）；无 mount 保持 `0.72`。无 runtime / ABI / DTO 扩展。

## 4. Web

| 验证 | 结果 |
| --- | --- |
| `npm run test` | PASS，113 tests（assembler 58） |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| build | PASS |

仅 unit projection；无 live backend、无 E2E；无产品专用 special case。

## 5. G8 与治理

`node 最小验证/数据/build-generic-g8-adc-passive-coverage-audit.mjs --check` PASS。Kog'Maw Q exact generic 为 `partial`，证据指向本 task，`sourceWorktree=wasm`。聚合为 `migrated=20 / partial=7 / blocked=177 / out_of_scope=38`（`inScope=204`）；partial `2.89%`；migrated+partial 为 `11.16%`（all）/`13.24%`（in-scope）。证据记录 27 条。Input SHA-256 仍为 `63b2460e5307419ec9d1dc776de453237f9fed359d777b0b4be1e846e6695004`。

本 Planning 批次不运行 governance rebuild（由驱动模型随后执行）。本项不宣称 G8 全量 goal 已完成，亦不虚构 live DB / Admin publish / 浏览器 live E2E。

## 6. 残余风险

已实现：rank5 常驻被动 `+25% attack speed`（attribute-only）。未建模：主动命中魔法伤害、护甲/魔抗击碎、Q cast/cooldown/rotation、其它 rank、live migration/publish/E2E。后续不得把本 partial 误计为完整腐蚀唾液 / 完整 Q 闭环。
