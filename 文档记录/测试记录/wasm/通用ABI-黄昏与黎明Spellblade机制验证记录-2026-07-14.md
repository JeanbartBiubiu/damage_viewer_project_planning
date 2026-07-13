TASK_KEY: wasm-generic-dusk-and-dawn-spellblade
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: partial
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-14

# 通用 ABI 黄昏与黎明 Spellblade 机制验证记录

详细设计：[通用 ABI - 黄昏与黎明 Spellblade（item_2510）机制详细设计](../../详细设计/wasm/通用ABI-黄昏与黎明Spellblade机制详细设计.md)。

## 1. 范围

已闭环的主伤害合同为 `0.75 * base AD + 0.10 * resolved AP` 额外魔法伤害、10 秒 ready 与命中起算的 1.5 秒 ICD。治疗和 0.2 秒后的第二次攻击特效不在本实现范围，G8 保持 `partial`。

| Worktree | Commit | 内容 |
| --- | --- | --- |
| Backend | `9cca754` | item_2510 幂等 core seed、静态 SQL 契约与 README 入口 |
| Wasm | `97d220d` | 精确主伤害/状态/快照/phantom 回归与 G8 partial JSON/CSV 重生成 |
| Web | `0ecd3ac` | combat-data assembler 2510 core Spellblade 投影回归 |

本轮未执行 live migration、Admin publish 或浏览器对 live backend 的 E2E。

## 2. Backend

| 验证 | 结果 |
| --- | --- |
| `mvn -Dtest=LolGenericDuskAndDawnSpellbladeSeedSqlTest test` | PASS，9/9 |
| `mvn test` | PASS，241/241 |

静态契约确认 item_2510 only mount、10 秒 ready、命中起算 1.5 秒 ICD、支持的 numeric gate、精确魔法公式、`copyable_on_hit=false` 与 damage → ICD → ready 顺序；同时断言没有 heal、bonus-health、delay/repeat、Vayne/tumble 或自动 publish 依赖。

## 3. Wasm

| 验证 | 结果 |
| --- | --- |
| `go test -count=1 ./internal/runtime -run DuskAndDawn` | PASS |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | PASS，`samples=100 avg_us=269.67 max_us=1029.00` |
| `scripts/build-wasm.ps1` | PASS，`1,087,334` bytes |
| `node scripts/smoke-node.mjs` | PASS，generic exports 3/3 |

独立数值交叉验证：`baseAD=100`、`AP=100` 时 raw=85，`magic_resist=100` 后=42.5。回归覆盖 arm/consume、ICD 阻止与到期重武装、ready expiry、event-entry 属性快照和 `copyable_on_hit=false` 的 Guinsoo phantom 隔离。

Wasm 产物为 `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\dist\tinygo_engine_v2.wasm`，SHA-256 `0D5C676F7FD4BF0EC9A82AAE2A1A0BEE8C46731C96D1D81F875375EE36382CE9`。

## 4. Web

| 验证 | 结果 |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run test` | PASS，8 files / 105 tests |
| `npm run build` | PASS |

Assembler 回归确认 item_2510 只随 source loadout 挂载，投影 namespaced states、`mul(eq,eq)` gate、`0.75 * base AD + 0.10 * resolved AP` 公式和 damage → ICD → ready operations；target 无 provider，且没有 heal、bonus-HP 或 delayed repeat 投影。

## 5. G8 与治理

`node 最小验证/数据/build-generic-g8-adc-passive-coverage-audit.mjs --check` PASS。2510 精确分类为 `partial`，证据指向本 task 与 Backend seed；remaining gap 保留治疗 `0.10 AP + 0.03 bonus HP` 和需 generalized delayed-repeat 的 0.2 秒第二次 on-hit。聚合为 `migrated=16 / partial=4 / blocked=184 / out_of_scope=38`，migrated-only 为 `6.61%`（all）/`7.84%`（in-scope），migrated+partial 为 `8.26%`（all）/`9.80%`（in-scope）。

`node tools/task-governance/cli.mjs rebuild` 与 task/docs query 通过。rebuild 报告的既有 5 个 unassigned docs 和 1 个缺失 review archive 均与本任务无关，未修改。

## 6. 已实现与未实现边界

已实现：item_2510 主目标 85（示例）魔法 Spellblade、ready/ICD、数据投影与独立公式一致。近似/未实现：治疗及 0.2 秒 delayed second on-hit；它们并未被宣称已迁移，仍通过 G8 `partial` 的 `remainingGap` 追踪。out-of-scope：live 发布与完整 multi-effect gameplay。
