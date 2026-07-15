TASK_KEY: wasm-engine-v2-architecture
DOC_TYPE: 其他
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-15 15:40:43

# WASM 通用引擎 P0 实现 Review —— 与详细设计契约核对

- 范围：`wasm/tinygo_engine_v2` 通用引擎（generic）ABI/session、compile、runtime/execution/gate/provider、scheduler、pipeline、formula。
- 基准文档：`文档记录/详细设计/wasm/WASM详细设计.md`
- 基线：`go test ./...` 全绿（全部包 ok / no test files），主路径 A1–F2 各 slice 已落地并有测试覆盖。
- 结论：主路径实现与设计一致；但存在 2 处需修正的缺陷、2 处默认值/输入契约偏差、4 处局部留白，以及若干测试覆盖缺口（详见下）。
- 本轮仅出报告，未改代码。

---

## 高优先级：需修正

### H1. `attribute_change` operation 在 runtime 未实现，会 fatal
- 设计 §13 将 `attribute_change` 列入「P0 runtime 必须闭环」的 10 个 operation。
- compile 已接受该 operation：`internal/compile/generic.go:651`（`case "heal","shield","resource_change","attribute_change"`）。
- runtime 分发 switch 无该 case，落到 `default` 返回 `runtime_invariant_failed`：`internal/runtime/generic_execution.go:137-236`。
- 影响：合法编译的 `attribute_change` payload 一进 run 即 fatal。
- 建议：补齐 runtime 实现；或在设计中将其显式降级为「schema/compile 预留、runtime 暂不闭环」。

### H2. dynamic provider refresh（extend/replace）会被旧过期事件提前清除
- `refreshProviderInstance` 在 extend/replace 分支更新 `inst.ExpireAt` 并 enqueue 新 cleanup，但初次 apply enqueue 的旧 cleanup 仍在堆中：`internal/runtime/generic_provider.go:99-161`。
- `handleExpireCleanup` 对 `kind="provider"` 无条件 `removeProviderInstance`，不校验事件时间是否等于当前 `ExpireAt`：`internal/runtime/generic_provider.go:186-198`。
- 影响：被延长的 provider 会在旧到期时间被提前移除（stale event）。
- 现状：无 `refresh_provider` fixture，CI 测不到。
- 建议：cleanup 时增加 `inst.Expired(nowMs)` 守卫，非当前到期的 stale 事件跳过。

---

## 中优先级：默认值/输入契约偏差

### M1. `StopPolicy` 默认值与设计相反
- 设计 §4.1：`stopOnTargetDeath`、`stopWhenNoEvents` 缺省为 `true`。
- DTO 为 `bool + omitempty`，`internal/model/generic_run.go:56-61`；`newGenericRunState` / `RunJSON` 未做缺省填充 → JSON 省略时得到零值 `false`。
- 现状：所有 fixture 都显式写 `true`，掩盖了偏差。
- 影响：省略字段时行为（target 死亡不停、stopReason 变化）与契约不符。
- 建议：run 初始化按「缺省 true」填充。

### M2. `RunRequest` 缺 `safetyBudget` / `runtimeOptions`，run 级预算被忽略
- 设计 §4.1 的 `RunRequest` 含 `safetyBudget` 与 `runtimeOptions`，DTO 只到 `Sampling`：`internal/model/generic_run.go:5-15`。
- runtime 预算仅来自 `DefaultSafetyBudget()` + compile `Settings.MaxEvents`：`internal/runtime/generic_run.go:118-121`。
- 影响：run frame 传入的 `safetyBudget` 被静默丢弃。
- 建议：确认是否有意收窄；否则补齐解析与生效。

---

## 低优先级：局部留白（P0 可接受，记录待办）

### L1. `cooldown_change` 忽略 operation 自带 abilityRef
- `internal/runtime/generic_execution.go:179-192` 有空操作死代码，恒用施法能力自身的 `f.abilityRef`，无法对「另一个能力」改 CD。

### L2. `emit_event` no-op、listener / `triggered_continuation` 未接入 run 循环
- compile 已构建 listener index、scheduler 已定义 `GenericCategoryTriggeredContinuation`，但 run 循环无 event/listener 派发；`emit_event` 直接返回 nil（`internal/runtime/generic_execution.go:232-233`）。
- 与 §11/§12「提交后 enqueue listener/子 ability」尚有差距；P0 fixture 无 listener 场景，属已知留白。

### L3. shield 吸收的伤害仍计入 `damageDealt` 与 DPS
- `resolveDamage` 的 `TotalAmount` 为护盾前全额，`applyCommand` 用它累加 `damageDealt` 并 `recordDamage`：`internal/runtime/generic_execution.go:246-254`、`internal/pipeline/resolver.go:58-94`。
- 影响：被护盾完全吸收的伤害不减 HP 却计入造成伤害/窗口 DPS，series 的 HP 曲线与 DPS 曲线口径不一致。§16 未明确定义 pre/post-mitigation 口径。
- 建议：明确口径并统一。

### L4. heal overheal 统计未输出
- §5.6 要求 heal「输出 overheal 统计」，当前仅累加实际治疗量，DTO 无 overheal 字段。

---

## 测试覆盖缺口
- `internal/testkit/generic_fixtures_test.go` 对 temp_provider / fixed_tick / both_dead / series_downsample 仅断言「能 compile」；run 级断言在 `internal/runtime/generic_run_test.go`。
- 未覆盖（恰是最易藏 bug 处）：
  - `refresh_provider`（对应 H2）
  - `attribute_change`（对应 H1）
  - shield 部分吸收后的 `damageDealt` 口径（对应 L3）
  - `StopPolicy` 省略字段的缺省行为（对应 M1）

---

## 建议的落地顺序（按 Cursor 流程分 slice）
1. Slice-fix-A：H1 + H2（补 runtime 闭环与 stale 守卫）+ 回归 fixture/test。
2. Slice-fix-B：M1 + M2（默认值与 run 输入契约）。
3. Slice-fix-C：L1–L4 收尾 + 口径/统计对齐 + 测试补全。

---

## 修正落地记录（Cursor 协同流程）
- 执行方式：Cursor SDK local agent（`composer-2.5`, `fast=false`），runId `run-6cf01b4b-2362-4059-ab9b-a45e54176ccf`，产物在 `.agents/artifacts/slice-fix-abc/`（gitignored），prompt 见同目录 `cursor-slice-fix-abc-prompt.md`。
- 驱动模型最终验证：`go build ./...`、`go test ./...` 全绿；10 个新增测试 `-count=1` 复跑通过。
- **H1** attribute_change：`executeOperation` 新增 case + `applyAttributeChange`（valuePolicy add/set/multiply/percent_add/min/max，Max>0 clamp，resolver 重算 Resolved）。fixture `generic_p0_attribute_change.json` + `TestGenericRunAttributeChangeUpdatesResolved`。已修。
- **H2** provider stale 过期：`handleExpireCleanup` provider 分支加 `ExpireAt > nowMs` 守卫跳过。`TestStaleProviderExpireCleanupSkippedAfterExtend`。已修。
- **M1** StopPolicy 缺省：改 `*bool` + `StopOnTargetDeathOrDefault()/StopWhenNoEventsOrDefault()`（nil→true），全部读点改用 helper。两个 omitted 默认测试。已修。
- **M2** RunRequest 预算：新增 `SafetyBudget *RunSafetyBudget` + `RuntimeOptions`，run 级可覆盖 chain/commands，`MaxEvents` 不超 compile cap。两个 budget 测试。已修。
- **L1** cooldown_change：compile 增 `AbilityRefStr`，runtime 按 op abilityRef + valuePolicy(reset/reduce/refund/extend/set)。`TestGenericRunCooldownChangeReduceAndReset`。已修。
- **L2** emit_event：改为记录 `EvidenceKindEmittedEvent`（非静默），**完整 listener 派发按范围留到独立 slice**。`TestGenericRunEmitEventRecordsEvidence`。最小闭环。
- **L3** 伤害口径：按决定锁定 `damageDealt`=护盾前全额（含被吸收部分），仅加注释 + `TestGenericRunDamageDealtUsesPreShieldAmount`，**未改行为**，待 §16 明确。
- **L4** overheal：`overheal = requested - healed` 汇总到 `summary.sourceOverheal/targetOverheal`。`TestGenericRunHealOverhealReported`。已修。
- 遗留：L2 完整 listener/event 派发（含 triggered_continuation 与 matcher 运行态求值）仍为独立待办 slice。
