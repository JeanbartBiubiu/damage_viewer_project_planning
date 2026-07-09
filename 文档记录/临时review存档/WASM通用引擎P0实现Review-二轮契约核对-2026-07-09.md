TASK_KEY: wasm-engine-v2-architecture
DOC_TYPE: 其他
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-09

# WASM 通用引擎 P0 实现 Review - 二轮契约核对

## 1. Review 范围

- Worktree: `C:\project\damage_wasm_dev`
- Branch: `wasm/dev`
- 目标模块: `wasm/tinygo_engine_v2`
- 基准文档: `文档记录/详细设计/wasm/WASM详细设计.md`
- 本轮性质: 已开发并经过一轮 review + 修改后的二轮功能契约复查。

本轮只核对 generic runtime 目标通道，不把 legacy `engine_init/engine_begin_run/engine_step` 和 `single_attacker_dps` 作为新通用引擎语义来源。

## 2. 结论与修复状态

修复后最终结论为 `supported`：除本轮明确非目标的 pipeline modifier runtime integration 外，二轮 review 中发现的功能契约偏差已经完成修复并通过验证。

本报告保留二轮初始 review 的 findings 与修复过程，便于回看问题来源、Cursor 修复边界和验证证据。

### 2.1 二轮初始 Review 结论

初始结论为 `partial`。当时实现的目标 ABI、compile/run 主流程和多数 P0 fixture 可以运行，`go test -count=1 ./...` 与 `go run ./cmd/bench` 均通过；但仍存在若干“现有测试未覆盖、实际功能不符合详细设计预期”的偏差。

最高风险集中在三类：

1. global `rules.modifiers` 与 listener/event 机制存在“能解析或校验，但运行不生效”的静默偏差。
2. run 入参 hash 与 snapshot 输出 shape 弱于契约，宿主可能拿到成功结果但无法确认它来自正确规则或稳定结构。
3. 部分 canonical 字段形态与实现假设不一致，例如 attribute modifier path、`self/opponent` abilityRef。

## 3. Findings

### H1. `rules.modifiers` 当前只是 validate-only，运行时不会生效

- 证据:
  - `wasm/tinygo_engine_v2/internal/compile/generic.go` 的 `CompiledSession` 没有保存 rule-level modifiers。
  - `compileRulesOperations` 对 `rules.modifiers` 只做语法/公式校验。
  - `runtime.materializeCombatants` 只挂载 combatant provider instances 上的 modifiers。
- 设计预期:
  - `WASM详细设计.md` §5.6 将 `rules.modifiers` 作为 `RulesContainer` 的正式字段。
  - §14 要求 attribute modifier 挂载即进入 resolver，pipeline modifier 修改当前 command。
- 影响:
  - 上层提交全局 modifier payload 时，compile 可能成功，但 run 结果完全不受 modifier 影响。
- 建议:
  - 编译期保存 rule-level modifiers。
  - runtime 初始化时按 canonical target path 将 attribute modifier 挂载到对应 combatant resolver。
  - 至少新增一个 `rules.modifiers` always-on attribute modifier 回归测试。

### H2. listener/event 机制没有真正接入运行闭环

- 证据:
  - `AbilityDefinition.listenerSpec` 没有被编译为统一 listener index。
  - provider/rule listeners 多数只校验 matcher 和 operations，`CompiledListener` 未保留 matcher/abilityRef 的完整可执行信息。
  - `emit_event` 当前只记录 evidence，不触发 listener 或 child ability。
- 设计预期:
  - §5.5 要求 inline `listenerSpec` 与 provider-level `listeners[]` compile 后进入同一个 listener index。
  - §11/§12 要求事件提交后可 enqueue listener/子 ability，且 trigger/listener 不直接改 state。
- 影响:
  - `passive_listener`、`provider.listeners[]`、`rules.listeners[]` 或事件驱动机制会静默不生效。
- 建议:
  - 本轮可先实现最小 listener 闭环: compile 保留 matcher/operations，`emit_event` 提交后匹配 listener 并通过同一个 execution frame 执行 listener operations。
  - 如果完整 `abilityRef` child ability dispatch 超出当前结构，必须显式记录为独立 slice，不允许继续声称 listener 已完整支持。

### H3. attribute modifier `target` 只支持裸属性 key，不支持设计中的 canonical path

- 证据:
  - `pipeline.AttributeResolver.MountProviderModifiers` 直接使用 `mod.Target` 作为 `AttributeKey`。
  - 当前 fixture 使用 `"target": "attack_damage"`，没有覆盖设计示例 `"source.attr.attack_damage"`。
- 设计预期:
  - §5.6 说明 `ModifierDefinition.target` 是 path。
  - §14.1 的合法示例使用 `"target": "source.attr.attack_damage"`。
- 影响:
  - 上层按文档生成 canonical path 时，modifier 不会命中任何 attribute。
- 建议:
  - 增加 path parser，支持 `source.attr.<key>` / `target.attr.<key>` 并保留现有裸 key 兼容。
  - provider-mounted modifier 至少应正确剥离 `.attr.` 后的 attribute key；rule-level modifier 还应按 selector 选择 combatant。

### M1. run-side hash handshake 弱于契约

- 证据:
  - `Session.RunJSON` 仅在 `expectedRulesHash` 非空时校验。
  - `validateGenericRunRequest` 仅在 `initialSnapshot.schemaHash/rulesHash` 非空时校验。
- 设计预期:
  - §4.1 与 §5.5 要求 `expectedRulesHash` 必填。
  - §6.1 要求 `Snapshot.schemaHash` 和 `Snapshot.rulesHash` 必填并匹配 compiled session。
- 影响:
  - 宿主或 Web adapter 漏传 hash 时仍可能获得成功 run，错误规则/过期 snapshot 不会被拒绝。
- 建议:
  - 缺失 `expectedRulesHash`、`initialSnapshot.schemaHash`、`initialSnapshot.rulesHash` 时返回 `missing_required_field`。
  - 错配时保留 `hash_mismatch`。

### M2. `abilityRef` 支持停在 concrete `source/target`

- 证据:
  - compile regex 接受 `source|target|self|opponent`，但 ability ref index 实际按 concrete combatant key 构建。
  - runtime gate 直接查 `AbilityRefIndex[entry.AbilityRef]`。
- 设计预期:
  - §5.5 允许 `self/opponent/source/target` selector。
- 影响:
  - 合同允许的 `self.provider[...]` 或 `opponent.provider[...]` 在 driver entry / listener / operation 中会失败。
- 建议:
  - 在 compile/run 之间明确 selector ref 归一策略。
  - P0 最小修复可在 runtime gate 基于 driver source/target 将 `self/opponent` ref 规范化为 concrete ref。

### M3. `summary.abilityStats[].damageDealt/healingDone` 只保留最后一次 cast

- 证据:
  - `executeAbilityCast` 在每次 cast 后将 `damageDealt` / `healingDone` 指针覆盖为本次 frame 数值。
- 设计预期:
  - `AbilityStats` 是 summary 的稳定行数据，应表达本次 run 内该 ability 的累计结果。
- 影响:
  - repeat / whileReady 场景中，attempt/cast count 正确，但 per-ability 伤害和治疗总量偏低。
- 建议:
  - 改为累计值，新增重复施法测试。

### M4. final snapshot 输出 shape 不稳定

- 证据:
  - `CombatantSnapshot.cooldowns/providers/shields/abilityState/providerState/vars` 使用 `omitempty`。
  - `AttributeSlotDef.resolved` 使用 `omitempty`。
- 设计预期:
  - §6.1 要求 `finalSnapshot` materialize 成完整结构，不能只输出 HP 或省略稳定字段。
- 影响:
  - 宿主和 Web adapter 需要额外做字段存在性兜底，难以按稳定 object-map 契约读取。
- 建议:
  - 移除 final snapshot 关键字段的 `omitempty`，并在 `buildFinalSnapshot` 中 materialize 空对象/数组。
  - 保证 `resolved` 字段稳定输出。

### L1. release session 成功复用 `FrameKindGenericDone`，payload 与 run done 混在同一个 kind

- 证据:
  - `ReleaseSessionJSON` 成功写 `FrameKindGenericDone`，payload 是 `GenericReleaseDonePayload`。
  - `FrameKindGenericDone` 在设计表中用于 run 完成 `DoneResult`。
- 设计预期:
  - §2.0 表格未定义 release done kind；同一 kind 不应靠 payload shape 在宿主侧分流。
- 影响:
  - 宿主如果按 `FrameKindGenericDone` 解析 `DoneResult`，release 响应会造成歧义。
- 建议:
  - 本轮先在 review 中标记。若要修，需要先更新 `WASM详细设计.md` 增加 release result kind，或明确 release 成功不写 done，仅返回 0。

## 4. 已验证命令

在 `C:\project\damage_wasm_dev\wasm\tinygo_engine_v2` 执行:

```powershell
go test -count=1 ./...
go run ./cmd/bench
```

结果:

- `go test -count=1 ./...`: pass
- `go run ./cmd/bench`: pass，输出 `samples=100 avg_us=269.14 max_us=1035.00`

说明: 现有测试通过不能覆盖上述偏差，因为现有 fixture 多使用裸属性 key、显式 hash、显式 stop flags，且没有覆盖 global rules modifiers、完整 listener dispatch、重复施法 abilityStats 累计和 final snapshot shape。

## 5. 建议修复顺序

### Cursor Slice R2-A: 契约硬化与低风险行为修复

优先修复:

1. M1 hash 必填与错配校验。
2. H3 attribute modifier canonical path。
3. M2 `self/opponent` abilityRef runtime normalization。
4. M3 abilityStats 累计。
5. M4 final snapshot stable shape。

### Cursor Slice R2-B: global modifier 与 listener 最小闭环

优先修复:

1. H1 `rules.modifiers` runtime 生效。
2. H2 最小 listener/event 闭环。

停止条件:

- 如果完整 listener child ability dispatch 需要新增 scheduler category 或大改事件队列，先停在 provider/rule listener direct operations，留下明确独立 slice。

### 独立设计后修

- L1 release session result kind 需要先更新详细设计的 FrameKind 表，再改 ABI/outbox 契约。

## 6. 修复后复核

修复执行方式：

- Cursor SDK local agent: `grok-4.5`
- Run ID: `run-80471f5a-a14f-4fb5-a130-90b9b9368bae`
- Cursor 产物目录: `.agents/artifacts/cursor-wasm-generic-review2-fix`
- 主会话复核: 检查 Cursor 产物、实际 `git diff`、未跟踪 generic 源码、CodeGraph 同步后关键符号、Go/TinyGo/Node 验证结果。

本轮 R2 修复状态：

| 项目 | 修复后状态 | 说明 |
| --- | --- | --- |
| R2-A1 hash 必填 | 已修复 | `Session.RunJSON` 强制 `expectedRulesHash`，`validateGenericRunRequest` 强制 `initialSnapshot.schemaHash/rulesHash`。 |
| R2-A2 modifier canonical path | 已修复 | `pipeline.AttributeKeyFromModifierTarget` 支持 `source.attr.*` / `target.attr.*` / 裸 key 兼容。 |
| R2-A3 `self/opponent` abilityRef | 已修复 | driver 与 `cooldown_change` 路径按当前 frame source/target 归一到 concrete abilityRef。 |
| R2-A4 abilityStats 累计 | 已修复 | `damageDealt` / `healingDone` 改为按 abilityRef 累计。 |
| R2-A5 final snapshot stable shape | 已修复 | final snapshot materialize `cooldowns/providers/shields/abilityState/providerState/vars`，attribute `resolved` 稳定输出。 |
| R2-B1 `rules.modifiers` 运行生效 | 已修复 attribute P0 | rule-level attribute modifier 会按 canonical target 挂载到 source/target resolver；pipeline modifier 保留为后续 command pipeline slice。 |
| R2-B2 listener/event 最小闭环 | 已修复 direct operations P0 | provider/rule/inline listener 进入统一 listener index，`emit_event` 提交后匹配并执行 direct operations；abilityRef-only child dispatch 记录 `listener_skipped` evidence，未冒充完整支持。 |
| L1 release result kind | 已二次修复 | 补充 `FrameKindGenericReleaseResult=214`，release 成功不再复用 `FrameKindGenericDone`。 |

修复后验证：

```powershell
go test -count=1 ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
node .\scripts\smoke-node.mjs
node tools/task-governance/cli.mjs rebuild
node tools/task-governance/cli.mjs docs wasm-engine-v2-architecture
```

结果：

- `go test -count=1 ./...`: pass
- `go run ./cmd/bench`: pass, `samples=100 avg_us=281.24 max_us=1165.00`
- `build-wasm.ps1`: pass, 产物 `dist/tinygo_engine_v2.wasm`, `1027041` bytes
- `smoke-node.mjs`: pass, legacy exports `11` 个、generic exports `3` 个均存在
- `task-governance rebuild`: pass, `header_updates=0`
- `docs wasm-engine-v2-architecture`: 可查到本 review 报告

说明：

- 当前 `diff.patch` 只能代表 Cursor allowed tracked paths 的差异；generic 主体实现多为未跟踪文件，复核时已单独纳入源码读取和测试验证。
- 治理重建仍报告若干 pre-existing unassigned/missing docs，本轮未清理。

## 7. P1 残留二次修复与最终结论

只读复核后确认不存在新的 P0 残留，但存在三个 P1 残留：

1. listener/event 只支持 direct operations，`abilityRef` child ability dispatch 仍跳过。
2. `finalSnapshot` 顶层 shape 已稳定，但 provider/shield/cooldown 嵌套字段仍弱于详细设计。
3. release session 成功仍复用 `FrameKindGenericDone`，违反“新 ABI 不靠同一 kind 的 payload shape 分流”的兼容规则。

二次修复执行方式：

- Cursor SDK local agent: `grok-4.5`
- Run ID: `run-b21cbfca-c5c8-448b-a010-81865b202b4a`
- Cursor 产物目录: `.agents/artifacts/cursor-wasm-generic-review2-p1-fix`
- 运行前修正了本地 Cursor runner 的 model 常量，确保请求模型为精确 `{ "id": "grok-4.5" }`。

二次修复状态：

| P1 项 | 最终状态 | 说明 |
| --- | --- | --- |
| listener `abilityRef` child ability dispatch | 已修复 | matched listener 可通过独立 execution frame 调度 child ability，并受 `MaxChainDepth` / `MaxCommandsPerEvent` 保护。 |
| finalSnapshot nested shape | 已修复 | provider/shield 输出 `source/owner/state/expireAt:null`，cooldown 输出 `readyAtMs/remainingMs`。 |
| release session outbox kind | 已修复 | 新增 `FrameKindGenericReleaseResult=214`，并同步 `WASM详细设计.md` FrameKind 表。 |

最终结论为 `supported`：除本轮明确非目标的 pipeline modifier runtime integration 外，二轮 review 中发现的功能契约偏差已经完成修复并通过验证。

最终验证：

```powershell
go test -count=1 ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
node .\scripts\smoke-node.mjs
```

结果：

- `go test -count=1 ./...`: pass
- `go run ./cmd/bench`: pass, `samples=100 avg_us=327.29 max_us=1307.00`
- `build-wasm.ps1`: pass, 产物 `dist/tinygo_engine_v2.wasm`, `1028339` bytes
- `smoke-node.mjs`: pass, legacy exports `11` 个、generic exports `3` 个均存在

保留后续项：

- `rules.modifiers` 的 `pipeline` kind 仍为 validate/retain-only；本轮只要求 attribute 级 rule modifier 对 runtime attributes 生效。
- host/web 若已按 `FrameKindGenericDone` 解析 release 成功，需要改读 `FrameKindGenericReleaseResult=214`。
