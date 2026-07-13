TASK_KEY: wasm-generic-lich-bane-spellblade
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-13

# 通用 ABI 巫妖之祸 Spellblade 机制验证记录

详细设计：[通用 ABI — 巫妖之祸 Spellblade（item_3100）机制详细设计](../../详细设计/wasm/通用ABI-巫妖之祸Spellblade机制详细设计.md)。

## 1. 提交与范围

| Worktree | Commit | 内容 |
| --- | --- | --- |
| Backend | `b535cbc` | 幂等 seed、静态 SQL 契约、README 入口 |
| Wasm | `e08669e` | Lich Bane runtime 回归与 G8 JSON/CSV 重新生成 |
| Web | `1a58942` | combat-data assembler source-equipment 投影回归 |

本轮未执行 live migration、Admin publish 或浏览器对 live backend 的 E2E。

## 2. Backend

| 验证 | 结果 |
| --- | --- |
| `mvn -Dtest=LolGenericLichBaneSpellbladeSeedSqlTest test` | PASS，10/10 |
| `mvn test` | PASS，214/214 |

静态合同确认 `item_3100` mount、10s ready、1.5s ICD、`0.75 * base AD + 0.45 * resolved AP` 魔法伤害、`copyable_on_hit=false`、以及 `0.5 * ready` 的 attack-speed percent-add modifier。seed 无 DELETE/DROP/CASCADE 且不自动 publish。

## 3. Wasm

| 验证 | 结果 |
| --- | --- |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS，`samples=100 avg_us=284.13 max_us=1188.00` |
| `scripts/build-wasm.ps1` | PASS，`1087334` bytes |
| `node scripts/smoke-node.mjs` | PASS，generic exports 3/3 |

产物：`C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\dist\tinygo_engine_v2.wasm`，SHA-256 `0D5C676F7FD4BF0EC9A82AAE2A1A0BEE8C46731C96D1D81F875375EE36382CE9`。

新增回归验证 cast 武装、ready/ICD、120 点零魔抗精确魔法伤害、ready consume 后攻速恢复、ready/ICD 到期、动态 `intervalFormula`（固定 `FirstAtMs` 不被改写）以及 Guinsoo phantom 禁区。

## 4. Web

| 验证 | 结果 |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run test` | PASS，8 files / 102 tests |
| `npm run build` | PASS |

Assembler 回归确认 3100 仅随 source loadout 挂载，正确投影 namespaced state schema、`percent_add` modifier、公式、listener matcher 和 damage→consume 顺序；false `copyableOnHit` 不会被投影成 true。

## 5. G8 与治理

`node 最小验证/数据/build-generic-g8-adc-passive-coverage-audit.mjs --check` 通过，精确重分类结果为 `migrated=14 / partial=3 / blocked=187 / out_of_scope=38`。本轮把 3100 标为 `migrated`，并将已经完整闭环的 6672 从误报 `blocked` 更正为 `migrated`。

执行 `node tools/task-governance/cli.mjs rebuild` 后，应通过 `docs wasm-generic-lich-bane-spellblade` 解析本文与详细设计。

## 6. 残余边界

已实现范围是 3100 的单目标 ready/ICD、伤害和一次性攻速动态 cadence；不包含多 Spellblade unique-group、完整 rotation、同帧 arm+on-hit 或 live 发布验证。这些边界不影响本数据合同、Wasm 数值结果与独立公式的一致性。
