TASK_KEY: wasm-generic-crit-modifier-infinity-edge
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-13

# 通用 ABI Crit/Modifier 无尽之刃机制验证记录

详细设计：[通用 ABI Crit/Modifier 无尽之刃机制详细设计](../../详细设计/wasm/通用ABI-CritModifier无尽之刃机制详细设计.md)

## 0. Commits

| 仓库 | commit | 备注 |
| --- | --- | --- |
| Planning | `19b642d` | Crit/Modifier 详细设计 |
| Backend | `0a58ecc` | `crit_eligible` + Infinity Edge seed / 测试 |
| Wasm | `c6c6b5d` | generic expected crit + evidence |
| Web | `a206240` | 类型/assembler 投影 + wasm artifact 同步 |

## 1. Backend

| 检查 | 结果 |
| --- | --- |
| targeted | 29/29 PASS |
| 全量 Maven | 204/204 PASS |

## 2. Wasm

| 检查 | 结果 |
| --- | --- |
| targeted | PASS |
| `go test -count=1 ./...` | PASS |
| build | PASS |
| Node smoke | PASS |

Bench（samples=100）：

| 指标 | 值 |
| --- | ---: |
| avg_us | 260.08 |
| max_us | 1027.00 |

Artifact：

| 项 | 值 |
| --- | --- |
| size | 1,087,334 bytes |
| SHA256 | `0D5C676F7FD4BF0EC9A82AAE2A1A0BEE8C46731C96D1D81F875375EE36382CE9` |

## 3. Web

| 检查 | 结果 |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| Vitest | 101/101 PASS |
| `npm run build` | PASS |
| Wasm source/destination hash 与 size | 与 Wasm artifact 一致 |

## 4. Live PostgreSQL

执行路径：migration → seed → 幂等重跑 → 显式 publish。

| 阶段 | current/published | 备注 |
| --- | --- | --- |
| migration + seed 后 | 18/17 | — |
| 幂等重跑 | 18/17 | 不变 |
| 显式 publish 后 | 18/18 | — |

发布：

| 项 | 值 |
| --- | --- |
| version code | `lol-generic-crit-modifier-v1-20260713` |
| version id | 196 |
| revision | 18 |

核对：

| 检查 | 结果 |
| --- | --- |
| MAIN/LOG 六个基础普攻 `crit_eligible` | 6/6 |
| Public API Vayne basic attack `damageDetail.critEligible` | `true` |

## 5. Browser E2E

路由：`#/wasm-validation-generic`。三个 session 均 release；临时服务已停止。

### 5.1 无装备

| 项 | 值 |
| --- | --- |
| baseRaw | 60 |
| chance | 0 |
| multiplier | 2 |
| raw | 60 |
| mitigated（200 armor） | 20 |
| warnings | 0 |

### 5.2 Infinity Edge

| 项 | 值 |
| --- | --- |
| baseRaw | 135 |
| chance | 0.25 |
| multiplier | 2.3 |
| normalPart | 101.25 |
| critPart | 77.625 |
| critAdjustedRaw | 178.875 |
| mitigated | 59.625 |
| warnings | 0 |

### 5.3 Infinity Edge + Guinsoo 四击

| 项 | 值 |
| --- | --- |
| providers | 8 |
| formulas | 34 |
| attempts / casts / skips | 4 / 4 / 0 |
| warnings | 0 |
| evidence truncated | false |
| damage evidence | 10 |
| emitted_event | 8 |

观察：

- 攻击间隔持续缩短，Guinsoo `attack_speed` modifier 生效。
- listener magic damage **无** crit evidence。

## 6. 结论与剩余风险

结论：Crit/Modifier（Infinity Edge expected crit + Guinsoo owner-side modifier 回归）在 Backend / Wasm / Web / live **18/18** / 浏览器 E2E 上闭环成立。

剩余风险 / 明确边界：

- P0 仅确定性 `expected`；无 RNG、无 run-input 策略切换、无兰顿 `critOnly` incoming reduction。
- crit settlement **不额外增加** command budget；existing phantom damage command **仍按既有合同计费**（不声称 phantom 本身无成本）。
- 总体审计任务 `wasm-generic-min-validation-coverage-audit` **保持开发中**：G8 的 242 candidates 全量重分类与覆盖率汇总尚未执行。
- `wasm-min-validation-data-spec` **未**因本批改为完成。

## 7. 治理验证

| 命令 | 预期 |
| --- | --- |
| `node tools/task-governance/cli.mjs rebuild` | 成功 |
| `node tools/task-governance/cli.mjs docs wasm-generic-crit-modifier-infinity-edge` | 含详细设计 + 本验证记录；任务已完成 |
| `node tools/task-governance/cli.mjs docs wasm-generic-min-validation-coverage-audit` | 仍为开发中 |
| `git diff --check` | 通过 |
