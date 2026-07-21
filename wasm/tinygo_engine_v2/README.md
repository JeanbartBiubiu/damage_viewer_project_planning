# TinyGo Engine V2

`wasm/tinygo_engine_v2` 是 Damage Viewer 的 TinyGo Wasm 计算引擎正式落点。

当前 canonical 路径是 generic compile / session / run / release：

```text
CompileRequest -> engine_compile -> CompiledSession (sessionId + rulesHash)
RunRequest + sessionId/expectedRulesHash -> engine_run -> DoneResult
ReleaseSessionRequest -> engine_release_session -> release_result
```

更细的模块依赖与时序见 [`ARCHITECTURE.md`](ARCHITECTURE.md)。协作规则见 [`AGENTS.md`](AGENTS.md)。

## Review 顺序

| 阶段 | 阅读目标 | 关键文件 |
| --- | --- | --- |
| 1. 契约与 ABI | generic DTO、frame kind `200..214`、错误码、outbox 优先级 | `internal/model/generic*.go`、`internal/abi/frame.go`、`internal/abi/outbox.go` |
| 2. Wasm 入口 | 导出是否只做装配；session 是否唯一状态持有者 | `cmd/engine_wasm/main.go` |
| 3. 生命周期 | compile → registry → run → release | `internal/runtime/session.go` |
| 4. 编译层 | `CompileGeneric` → `CompiledSession`，collect-all | `internal/compile/generic.go`、`generic_validate.go` |
| 5. 运行主循环 | `RunGeneric`、gate、provider、execution、scheduler | `internal/runtime/generic_run.go`、`generic_execution.go`、`generic_gate.go`、`generic_provider*.go` |
| 6. 公式 / 类型集 / pipeline | 只读编译结果的消费边界 | `internal/formula/generic*.go`、`internal/typeset/generic.go`、`internal/pipeline/**` |
| 7. 验证契约 | canonical fixture + Node/Go bench | `internal/testkit/fixtures/generic_p0_basic_damage.json`、`scripts/smoke-node.mjs`、`cmd/bench` |

兼容说明（一次即可）：legacy `engine_init` / `engine_begin_run` / `engine_step` 与 `dps_*.go` 单攻 DPS 仍在源码中供回归，**不是**新机制主路径。

## 模块职责

```text
cmd/engine_wasm/          TinyGo 导出：alloc/dealloc + engine_compile/run/release_session + outbox_*
cmd/bench/                原生 Go benchmark（默认 generic-run；legacy 对照）
internal/abi/             frame header、outbox、内存桥接
internal/model/           generic*.go 为 canonical DTO；types.go 含 legacy DTO
internal/compile/         CompileGeneric → CompiledSession
internal/runtime/         Session registry + RunGeneric / generic execution
internal/scheduler/       generic 稳定事件堆
internal/formula/         generic formula compile/eval
internal/typeset/         flat type catalog/matcher
internal/pipeline/        数值变更统一 resolver
internal/{attribute,resource,command,status,shield,...}/  支撑子系统
internal/testkit/         fixture、ABI helper（含 generic_p0_*）
scripts/                  构建、generic ABI smoke、Node benchmark
targets/wasm-256m.json    256 MiB TinyGo wasm target
```

## 核心数据流

```text
宿主 alloc → 写入 compile frame (kind=200, CompileRequest JSON)
  → engine_compile → CompileGeneric → register session
  → outbox: compile_result{ok, sessionId, schemaHash, rulesHash} | error

宿主写入 run frame (kind=201, RunRequest: sessionId + expectedRulesHash + snapshot/driver/stop/sampling)
  → engine_run → hash/session 校验 → RunGeneric
  → outbox: generic done{summary, finalSnapshot, series, evidence...} | error

宿主写入 release frame (kind=202, sessionId + expectedRulesHash?)
  → engine_release_session → 删除 registry 项
  → outbox: release_result{ok, sessionId, released:true} | error

宿主 engine_outbox_ptr/len → 读帧 → engine_outbox_clear
```

## 当前已接入能力

| 区域 | 状态 | 说明 |
| --- | --- | --- |
| Generic ABI / frame / outbox | 已接入 | kind `200..214`；优先帧保留 |
| Session registry + hash 校验 | 已接入 | `session.go` Compile/Run/Release |
| `CompileGeneric` | 已接入 | collect-all；输出 `CompiledSession` |
| `RunGeneric` | 已接入 | driver plan、gate、damage/heal/resource、provider tick |
| Canonical fixture | 已接入 | `generic_p0_basic_damage.json`（targetFinalHp=900） |
| Node smoke | 已接入 | 真实 compile/run/release round-trip |
| Node / Go bench | 已接入 | `--mode generic-run` / `go run ./cmd/bench` 默认 generic |

## 常用命令

在 `wasm/tinygo_engine_v2/` 目录执行：

```powershell
go test -count=1 ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
node .\scripts\smoke-node.mjs
node .\scripts\bench-node.mjs --mode generic-run --iterations 10 --warmup 2
```

TinyGo 不在 `PATH` 时：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1 -TinyGo "C:\path\to\tinygo.exe"
```

### TinyGo 工具链定位

`Get-Command tinygo` 或 `where.exe tinygo` 未命中只表示当前终端的 `PATH` 没有 TinyGo，不代表机器上未安装。当前项目级 TinyGo 0.40.1 位于：

```text
C:\project\tinygo0.40.1\tinygo\bin\tinygo.exe
C:\project\tinygo0.40.1\tinygo\targets\wasm_exec.js
```

可直接复核版本：

```powershell
& 'C:\project\tinygo0.40.1\tinygo\bin\tinygo.exe' version
```

`build-wasm.ps1` 会先解析传入值或 `PATH` 中的 `tinygo`；默认值未命中时，再依次查找仓库级 `.tools\tinygo0.40.1\tinygo\bin\tinygo.exe` 和项目级 `C:\project\tinygo0.40.1\tinygo\bin\tinygo.exe`。因此在当前项目布局中无需修改全局 `PATH`，直接运行默认构建命令即可。工具移动到其它位置时再显式传入 `-TinyGo`。

Node 宿主必须加载与编译器同版本的 `wasm_exec.js`；仓库脚本同样会查找上述工具目录，也可用 `TINYGO_WASM_EXEC` 显式指定。

## 构建

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
```

等价于：

```powershell
tinygo build -scheduler=none -no-debug -opt=z -target .\targets\wasm-256m.json -o .\dist\tinygo_engine_v2.wasm .\cmd\engine_wasm
```

## ABI 摘要（canonical）

```text
alloc(size) -> ptr
dealloc(ptr, size)
engine_compile(ptr, size) -> 0/-1
engine_run(ptr, size) -> 0/-1
engine_release_session(ptr, size) -> 0/-1
engine_outbox_ptr() -> ptr
engine_outbox_len() -> len
engine_outbox_clear()
```

## 约束

- `targets/wasm-256m.json` 固定 256 MiB initial/max memory。
- 构建默认 `-scheduler=none -no-debug -opt=z`。
- 网络、缓存、版本协商、文件加载留在 JS/Worker；TinyGo 只接收准备好的 frame payload。
- 勿修改或复制 canonical fixture；smoke/bench 直接复用。

## Generic runtime 精度契约（事件快照 / 抗性 / expected crit）

### Event snapshot formula reads

Listener / child ability 公式可读：

- `event.entry_source|entry_target.attr.<key>[.base|.current|.max|.resolved]`
- `event.entry_source|entry_target.resource.<key>[.current|.max]`
- `event.source|target.attr.<key>[.base|.current|.max|.resolved]`
- `event.source|target.resource.<key>[.current|.max]`

语义：`entry_*` 为父 execution frame 创建时（cost/CD/ops 前）深拷贝；`event.source/target` 为 `emit_event` 当点 staged 深拷贝。参与者始终是原始 emittedEvent source/target，不随 owner-relative listener 重映射。无 event context（driver cast / provider tick）读取 `event.*` 返回结构化 formula error。

Resource 路径（含 `source/target/event`）支持 `.current`/`.max`；无 suffix 默认 current。

### Damage resistance

Pipeline：`raw → (optional expected crit) → target resistance（含 source penetration）→ shields → HP clipping`。

- `physical` / `damage/physical` → `armor.resolved`
- `magic` / `damage/magic` / `magical` / `damage/magical` → `magic_resist.resolved`
- `true` / `damage/true` → 跳过抗性与穿透

Source-side 穿透（读 source `*.resolved`，first finite wins）：

- physical percent：`armor_pen_percent` → `armor_pen_pct` → `physical_pen_percent` → `physical_pen_pct`
- physical flat：`armor_pen_flat` → `physical_pen` → `physical_pen_flat` → `lethality`
- magic percent：`magic_pen_percent` → `magic_pen_pct`
- magic flat：`magic_pen_flat` → `magic_pen`

顺序与钳制：percent clamp 到 `[0,1]`，忽略负 flat；先 percent 后 flat。正基础抗性穿透后 floor 到 `0`；非正基础抗性不应用穿透，沿用既有负抗性公式。`MitigateRawDamage` / `ResolveCommand` 仍为无 source 兼容包装；generic 真实伤害与 phantom replay 走 source-aware 路径（phantom 使用冻结的 event-entry source attrs + entry target 抗性）。Legacy `single_attacker_dps` 抗性/穿透路径不变。

公式：`R>=0: amount*100/(100+R)`；`R<0: amount*(2-100/(100-R))`（R 为穿透后有效抗性）。未知 damage type 在 compile collect-all 拒绝。`Result.Amount` / summary `damageDealt` 使用 mitigated（抗性后、护盾前）；HP clipping 不反向改 summary。成功 settlement 的 damage evidence 额外暴露 `resistanceBeforePenetration` / `penetrationPercent` / `penetrationFlat` / `effectiveResistance` / `resistanceFactor`（true/zero 为稳定 0 / factor 1）；fail-closed 与 phantom 省略。

### Expected crit（`critEligible`）

仅当 damage operation 显式 `critEligible=true` 时，在抗性前做固定确定性 `expected` 结算（无 RNG、无 run-input 策略）：

```text
chanceEffective = clamp(source.attr.crit_chance.resolved, 0, 1)
multiplier      = max(source.attr.crit_damage.resolved, 1)
critAdjustedRaw = baseRaw*(1-chanceEffective) + baseRaw*chanceEffective*multiplier
```

缺省 / 非 finite 的 `crit_chance` / `crit_damage` 结构化失败，不静默造值。非 eligible damage 跳过整段。Canonical Infinity Edge：chance `0.25`、multiplier `2.3`、标量 `1.325`。

Evidence kind 仍为 `damage`：eligible 行含 `policy=expected`、chance*/multiplier、base/parts/`critAdjustedRawAmount`；`rawAmount` = post-crit raw。Phantom replay 冻结真实命中的 post-crit raw 与 crit 证据，不二次结算、不额外 emit、不增加 crit 专用 command budget。

### Provider tick / TickSpec（含 target-state-anchored）

Tick ability 的 `TickSpec`：

- `intervalMs` / `onTick` / 可选 `startDelayMs`（非锚定且省略时默认 = `intervalMs`）。
- 可选成对 `anchorScope` + `anchorStateKey`：同省略 = 既有 mount/run provider tick；同存在 = target-state-anchored（当前仅 `state_scope/provider_target`）；半对 collect-all 拒绝。
- 锚定配对校验在 start-delay 默认化**之前**；锚定要求 `startDelayMs` 省略或 0（不默认成 interval）。
- 锚定不在 mount/seed 启动；首次合格 `provider_target` 写入启动；触顶钳制 refresh 重启 cadence。
- 调度类别 `GenericCategoryAnchoredTick` 在 expire cleanup 之前；活跃绑定使用 `bag.targetKey`。
- inclusive-at-expiry：仅在公式/pipeline 求值窗口内保持可见；不改全局 expiry 语义。

### Cast origin / cast instance / per-cast throttle

ABI（向后兼容，字段均可省略）：

- Ability `castOrigin`：可选枚举 `champion|item|pet|innate`（非空非法值 collect-all 拒绝）。
- Listener `perCastThrottleMs`：可选非负整数；省略/`0` 保持旧行为。`>0` 时要求 `eventMatcher.all` 含 `event/damage_instance`（需要 cast-instance 事件上下文）。
- Operation `repeatDelayMs`：可选非负整数毫秒；仅 `operation=repeat` 允许非零。省略/`0` 保持即时 phantom replay；`>0` 时在原事件时刻冻结合格 provenance，并入队 `GenericCategoryTriggeredContinuation` 事件于 `nowMs+repeatDelayMs`（独立 `MaxCommandsPerEvent` 计数，不继承原 hit collector 余额）。

运行时：

- 每次成功顶层 cast（driver / TickSpec / Listener `AbilityRef` 完整 child ability）mint 单调 `uint64` cast instance ID（从 1 起）；同 cast 多 op / listener Operations 子伤害继承 ID+origin。
- Event TypeSet 附加恰好一个已知 `cast_origin/<origin>`；damage evidence / emitted event data 暴露 `castInstanceId`（float64）与 `castOrigin`（非公式输入）。
- Pipeline damage context 可读：`damage.cast_origin.<key>`、`damage.ability_type.<key>`（catalog 校验；未知 compile 拒绝；运行时不匹配返回 0）。casting ability TypeSet 在 pipeline 前可用。
- 延迟 repeat：listener flush 先完成全部 delay=0 即时回放；再评估正延迟触发并 enqueue。continuation handler 消费 run-local payload、按冻结 raw/crit/entry 抗性施加 phantom，不重收集、不二次 repeat。超出 duration 或原 hit 已 death-stop 时不执行；堆 push 失败为 run error。

Per-cast throttle 安全边界：

- 表键：`listenerIndex + ownerCombatantKey + ownerProviderRef + castInstanceId → lastTriggerMs`；缺表项或 `now-last >= PerCastThrottleMs` 允许触发；重叠 cast 独立。
- 容量 `min(4096, max(256, MaxEvents))`。溢出按最小 `castInstanceId` 驱逐（并列 listenerIndex → combatantKey → providerRef）；每次 run 至多一条 `per_cast_throttle_overflow` 警告。表在 run 结束丢弃。
