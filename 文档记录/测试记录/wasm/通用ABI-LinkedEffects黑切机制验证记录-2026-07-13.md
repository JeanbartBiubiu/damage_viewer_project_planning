TASK_KEY: wasm-generic-linked-effects-black-cleaver
DOC_TYPE: 测试记录
WORKSTREAM: wasm
STATUS: done
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-15

# 通用 ABI Linked Effects 黑切机制验证记录

详细设计：[通用 ABI Linked Effects 黑切机制详细设计](../../详细设计/wasm/通用ABI-LinkedEffects黑切机制详细设计.md)

## 1. 当前提交

| 仓库 | commit | 说明 |
| --- | --- | --- |
| Backend | `597f9ae6f6d10e3b9e481699e72982b1a59b121b` | 当前 Carve seed：6%×5、6000ms refresh、root physical matcher |
| Wasm | `01ceb07153272f9c4d234605444c7e1a9af3cb02` | provider-target window、跨 combatant modifier、expiry/event 边界与统一清单 |
| Web | `0977c60d4bc1a8bf88ab544164973d629e321e9d` | 同步最终 TinyGo artifact |

## 2. Cursor 与独立 review

顶层 Cursor agent 均使用 `grok-4.5`、`effort=high`、`fast=false`。首轮 artifact：

```text
C:\project\damage_wasm_dev\.agents\artifacts\black-cleaver-3071-wasm-20260715\cursor-run
```

修复与复核 artifact：

```text
C:\project\damage_wasm_dev\.agents\artifacts\black-cleaver-3071-wasm-20260715\fix-run
C:\project\damage_wasm_dev\.agents\artifacts\black-cleaver-3071-wasm-20260715\second-fix-run
C:\project\damage_wasm_dev\.agents\artifacts\black-cleaver-3071-wasm-20260715\revert-physical-alias-attempt-run
```

最终各修复轮 `runDeltaOutsideScopeCount=0`。首轮曾创建后删除 allowlist 外临时 debug tests，最终 worktree 无残留；主会话因此不直接依赖 `diff.patch`，而是读取两个新 helper、审完整 diff 并重跑所有门禁。

## 3. Backend

| 检查 | 结果 |
| --- | --- |
| `LolGenericLinkedEffectsSeedSqlTest` | PASS |
| 全量 Maven | 333/333 PASS |
| seed 安全 | 幂等、material-change revision、无 live migration、无 auto publish |

静态合同：

- `carve_stacks`：max 5 / 6000ms / refresh-on-write
- listener：`damage_dealt + physical + source_owner`；active matcher 不含 basic-attack qualifier
- modifier：opponent armor `percent_add`，`-0.06 * provider.target_state.carve_stacks`

## 4. Wasm targeted 证据

Targeted pipeline/runtime 共 34 项 PASS，覆盖：

- 首击旧 armor、5 层 70 armor、第 6 次 cap refresh、6000ms expiry
- expiry 与 hit 同毫秒；两次伤害都按恢复后的 100 armor 起算
- optional basic qualifier 缺失仍 emit/Carve
- non-basic physical 与 basic-only matcher 隔离
- true/magic/zero 不合成
- phantom/child 不递归；同 frame 多 physical 只 emit 一次
- 两侧相反方向同 providerRef 隔离，一侧到期不影响另一侧
- mixed provider/provider-target 默认值不泄漏
- modifierKey 在 owner/provider 之前排序

工程结果：

| 命令 | 结果 |
| --- | --- |
| `go test -count=1 ./...` | PASS |
| `go run ./cmd/bench` | `samples=100 avg_us=3693.76 max_us=21344.00` |
| `build-wasm.ps1` | PASS |
| `smoke-node.mjs` | legacy 11 / generic 3 exports PASS |
| `bench-node.mjs --iterations 10 --warmup 2` | min 1.569ms / mean 2.127ms / p50 2.086ms / p95 3.057ms |
| CodeGraph | sync 后 status clean |
| `git diff --check` | PASS（Git 仅提示工作副本 LF→CRLF 未来转换；实测全部变更 Go 文件 CRLF=0） |

Artifact：

| 项 | 值 |
| --- | --- |
| path | `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2\dist\tinygo_engine_v2.wasm` |
| size | 1,101,630 bytes |
| SHA256 | `2CE1A0DAF10D193567663F28CD2ACD7941EA62EBF4284C307D5C5CC91C0B0BBF` |

## 5. Web

同步目标 `web/src/engine/wasm/tinygo_engine_v2.wasm` 与 Wasm artifact size/hash 完全一致。

| 检查 | 结果 |
| --- | --- |
| `npm run test:wasm-generic` | 83/83 PASS |
| `npm run test` | 114/114 PASS |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run build` | PASS；bundle wasm 1,101.63 kB |

无 TypeScript 合同改动；`ProviderStateField` 与 assembler 已保留 structured state schema。

## 6. 统一机制清单

生成器与 `--check` 均 PASS：

| 指标 | 值 |
| --- | ---: |
| sources / coverage records / item containers | 36 / 527 / 518 |
| deduplicated mechanisms | 254 |
| completed | 21 |
| partial_actionable / ready_to_implement | 0 / 0 |
| blocked_runtime / blocked_data | 40 / 146 |
| out_of_scope / regression_only | 42 / 5 |
| completion full / partial / none | 21 / 8 / 225 |

`item_passive|3071|item_passive|切割` 为 `completed/full`；`热烈` 保持 `blocked_runtime`。

## 7. 历史 live 证据边界

2026-07-13 的 Backend `678d95a`、Wasm `3dfe838`、Web `a2b7388` 与 live revision 17 只证明旧 `-4 / basic-only / run 永久` partial。当前 6%×5/6000ms/root-physical 合同**未执行 live migration、未 publish、未重跑浏览器 live E2E**，不得把 revision 17 当作本轮发布证据。

## 8. 结论

Black Cleaver `切割 / Carve` 已在当前 Backend seed、generic Wasm compile/run、数值/时序测试、Web artifact 与统一清单中完成闭环。剩余精确边界是 `热烈` 的 movement-speed combat-damage window，以及本轮明确禁止的 live migration/publish。
