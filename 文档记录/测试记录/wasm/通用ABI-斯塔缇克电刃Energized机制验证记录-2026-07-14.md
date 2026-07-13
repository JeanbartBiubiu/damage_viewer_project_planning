TASK_KEY: wasm-generic-statikk-shiv-energized
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-14

# 通用 ABI 斯塔缇克电刃 Energized 机制验证记录

详细设计：[通用 ABI - 斯塔缇克电刃 Energized（item_3087）机制详细设计](../../详细设计/wasm/通用ABI-斯塔缇克电刃Energized机制详细设计.md)。

## 1. 范围

已验证的精确候选为 `item_passive|3087|item_passive|电疗`。合同为每次普攻总计 +15 Energize、max=100、满层后下一次对主目标造成 60 魔法伤害；`item_passive|3087|item_passive|电火花` 的次级弹射明确不进入本记录。

| Worktree | Commit | 内容 |
| --- | --- | --- |
| Backend | `2cc5db4` | item_3087 幂等 seed、静态 SQL 契约与 README 入口 |
| Wasm | `64e9661` | 精确充能/数值/phantom 回归与 G8 JSON/CSV 重生成 |
| Web | `b1174ac` | combat-data assembler 3087 source-equipment 投影回归 |

本轮未执行 live migration、Admin publish 或浏览器对 live backend 的 E2E。

## 2. Backend

| 验证 | 结果 |
| --- | --- |
| `mvn -Dtest=LolGenericStatikkShivEnergizedSeedSqlTest test` | PASS，9/9 |
| `mvn test` | PASS，232/232 |

静态契约确认 item_3087 mount、无时长 max=100 state、`gte` ready、60 魔法伤害、`copyable_on_hit=false` 与严格 damage → conditional consume → unconditional add15 顺序；seed 排除移动/距离、90 非英雄伤害、弹射/次级 on-hit、slow、共享池、自动 publish 与 destructive SQL。

## 3. Wasm

| 验证 | 结果 |
| --- | --- |
| `go test -count=1 ./internal/runtime -run StatikkShiv` | PASS |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS，`samples=100 avg_us=284.19 max_us=1079.00` |
| `scripts/build-wasm.ps1` | PASS，`1,087,334` bytes |
| `node scripts/smoke-node.mjs` | PASS，generic exports 3/3 |

独立数值交叉验证为 raw=60，`magic_resist=100` 后=30。状态回归证明从零层第 7 次命中只 charge 并 clamp 到 100；第 8 次才按 damage → consume → add 结束于 15。`copyable_on_hit=false` 下 Guinsoo phantom 不触发、不消费也不推进 Statikk state。

Wasm 产物为 `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\dist\tinygo_engine_v2.wasm`，SHA-256 `0D5C676F7FD4BF0EC9A82AAE2A1A0BEE8C46731C96D1D81F875375EE36382CE9`。

## 4. Web

| 验证 | 结果 |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run test` | PASS，8 files / 104 tests |
| `npm run build` | PASS |

Assembler 回归确认 3087 仅随 source loadout 挂载，完整投影 capped state、ready condition、60 magic / false-copyable damage、conditional consume 和 unconditional +15 recharge 的有序 operations；target 不挂载该 provider。

## 5. G8 与治理

`node 最小验证/数据/build-generic-g8-adc-passive-coverage-audit.mjs --check` PASS。`电疗` 精确迁移为 `migrated`，`电火花` 继续是无 evidence 的 `out_of_scope`；聚合为 `migrated=16 / partial=3 / blocked=185 / out_of_scope=38`。覆盖率为 migrated-only `6.61%`（all）/`7.84%`（in-scope），migrated+partial `7.85%`（all）/`9.31%`（in-scope）。

`node tools/task-governance/cli.mjs rebuild` 与 task/docs query 通过。rebuild 报告的既有 5 个 unassigned docs 及 1 个缺失 review archive 与本任务无关，未改动。

## 6. 已实现与边界

已实现：item_3087 的单目标 +15/100/60 魔法 Energized 数据合同、Wasm 数值与循环、Web 投影及审计证据一致。out-of-scope：电火花次级弹射、90 非英雄分支、移动/距离充能、slow、共享池与 live 发布。没有用 3094 的代表实现替代 3087 的精确 provider。
