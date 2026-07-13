TASK_KEY: wasm-generic-essence-reaver-spellblade
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-14

# 通用 ABI 夺萃之镰 Spellblade 机制验证记录

详细设计：[通用 ABI - 夺萃之镰 Spellblade（item_3508）机制详细设计](../../详细设计/wasm/通用ABI-夺萃之镰Spellblade机制详细设计.md)。

| Worktree | Commit | 内容 |
| --- | --- | --- |
| Backend | `fbcc3b1` | 3508 幂等 seed、静态 SQL 契约与 README 入口 |
| Wasm | `86ea9e4` | 精确数值/状态/快照/phantom 回归与 G8 JSON/CSV 重生成 |
| Web | `3389084` | combat-data assembler 3508 source-equipment 投影回归 |

## 1. 范围

本记录验证 G8 精确候选 `item_passive|3508|item_passive|咒刃`，而不是以其他 Spellblade 装备代替。实现覆盖 next-hit 的 `1.25 * base AD + 50 * resolved crit chance` 物理伤害、10 秒 ready 与命中开始的 1.5 秒 ICD；不执行 live migration 或 publish。

## 2. Backend

| 验证 | 结果 |
| --- | --- |
| `mvn -Dtest=LolGenericEssenceReaverSpellbladeSeedSqlTest test` | PASS，9/9 |
| `mvn test` | PASS，223/223 |

静态契约测试覆盖幂等与安全边界、3508 mount、精确 formula AST、现有 VM 支持的 numeric gate、state/lifecycle 与 damage → ICD → ready 顺序；确认没有 Vayne/Tumble 专用依赖，也没有法力或攻击速度 modifier。

## 3. Wasm

`generic_essence_reaver_spellblade_test.go` 的独立公式交叉验证得到：`baseAD=100, crit=0.25` 时 raw=`137.5`，armor=100 后=`68.75`；`crit=1` 时 raw=`175`。回归还覆盖 ready/ICD 边界、10 秒 expiry、event-entry 属性快照和 phantom 隔离。

| 验证 | 结果 |
| --- | --- |
| `go test -count=1 ./internal/runtime -run EssenceReaver` | PASS |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS，`samples=100 avg_us=274.98 max_us=1048.00` |
| `scripts/build-wasm.ps1` | PASS，`1,087,334` bytes |
| `node scripts/smoke-node.mjs` | PASS，generic exports 3/3 |

Wasm 产物为 `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\dist\tinygo_engine_v2.wasm`，SHA-256 为 `0D5C676F7FD4BF0EC9A82AAE2A1A0BEE8C46731C96D1D81F875375EE36382CE9`。

## 4. Web

| 验证 | 结果 |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run test` | PASS，8 files / 103 tests |
| `npm run build` | PASS |

Assembler 断言确认 3508 只随 source loadout 挂载，完整投影 namespaced states、numeric gate、exact formula 和 damage → ICD → ready operations；不将 `copyable_on_hit=false` 变成可复制，也不虚构法力回复投影。

## 5. G8 与治理

`node 最小验证/数据/build-generic-g8-adc-passive-coverage-audit.mjs --check` PASS。3508 已精确分类为 `migrated`，聚合为 `migrated=15 / partial=3 / blocked=186 / out_of_scope=38`，覆盖率为 migrated-only `6.20%`（all）/`7.35%`（in-scope），migrated+partial `7.44%`（all）/`8.82%`（in-scope）。

`node tools/task-governance/cli.mjs rebuild` PASS；`tasks wasm-generic-essence-reaver-spellblade` 和 `docs wasm-generic-essence-reaver-spellblade` 均解析到本任务与两份文档。rebuild 同时报告既有 5 个 unassigned docs 和 1 个缺失 review archive，均与本任务无关，未改动。

## 6. 残余边界

已实现边界是数据合同、Wasm 数值结果与独立公式的一致性。法力回复、unique-group、完整 rotation、多目标与 live 发布明确为非本任务范围；它们不改变 item_3508 单目标 Spellblade 的精确迁移结论。
