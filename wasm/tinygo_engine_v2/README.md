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

也可尝试项目级 fallback：`C:\project\tinygo0.40.1`。

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

Pipeline：`raw → (optional expected crit) → target resistance → shields → HP clipping`。

- `physical` / `damage/physical` → `armor.resolved`
- `magic` / `damage/magic` / `magical` / `damage/magical` → `magic_resist.resolved`
- `true` / `damage/true` → 跳过抗性

公式：`R>=0: amount*100/(100+R)`；`R<0: amount*(2-100/(100-R))`。首批不读 source penetration。未知 damage type 在 compile collect-all 拒绝。`Result.Amount` / summary `damageDealt` 使用 mitigated（抗性后、护盾前）；HP clipping 不反向改 summary。

### Expected crit（`critEligible`）

仅当 damage operation 显式 `critEligible=true` 时，在抗性前做固定确定性 `expected` 结算（无 RNG、无 run-input 策略）：

```text
chanceEffective = clamp(source.attr.crit_chance.resolved, 0, 1)
multiplier      = max(source.attr.crit_damage.resolved, 1)
critAdjustedRaw = baseRaw*(1-chanceEffective) + baseRaw*chanceEffective*multiplier
```

缺省 / 非 finite 的 `crit_chance` / `crit_damage` 结构化失败，不静默造值。非 eligible damage 跳过整段。Canonical Infinity Edge：chance `0.25`、multiplier `2.3`、标量 `1.325`。

Evidence kind 仍为 `damage`：eligible 行含 `policy=expected`、chance*/multiplier、base/parts/`critAdjustedRawAmount`；`rawAmount` = post-crit raw。Phantom replay 冻结真实命中的 post-crit raw 与 crit 证据，不二次结算、不额外 emit、不增加 crit 专用 command budget。
