# TinyGo Engine V2

`wasm/tinygo_engine_v2` 是 Damage Viewer 的 TinyGo Wasm 计算引擎正式落点。当前代码目标不是继续扩展临时 demo，而是按 V2 契约和子系统边界建立可逐层 review、逐层实现的骨架。

更细的模块依赖图、时序图和对象关系见 [`ARCHITECTURE.md`](ARCHITECTURE.md)。协作规则见 [`AGENTS.md`](AGENTS.md)。

## 整体 Review 顺序

建议按「契约 → 编译 → 运行时 → 机制骨架」阅读，避免从某个 effect 实现倒推全局：

| 阶段 | 阅读目标 | 关键文件 |
| --- | --- | --- |
| 1. 契约与 ABI | 输入/输出 DTO、frame kind、错误码、outbox 优先级 | `internal/model/types.go`、`internal/abi/frame.go`、`internal/abi/outbox.go` |
| 2. Wasm 入口 | 导出函数是否只做装配、session 是否唯一状态持有者 | `cmd/engine_wasm/main.go` |
| 3. 生命周期 | init → ready → begin_run → step → done/error 状态机 | `internal/runtime/session.go` |
| 4. 编译层 | DTO → 短 ID + 索引 + 引用校验（collect-all） | `internal/compile/compile.go` |
| 5. 数值底座 | 属性/资源/公式/调度堆的独立不变量 | `internal/attribute/`、`internal/resource/`、`internal/formula/`、`internal/scheduler/` |
| 6. 运行主循环 | 事件弹出顺序、CanCast 门控、效果入口、HP 变更路径 | `internal/runtime/runtime.go` |
| 7. 竖切能力 | DPS 联动、伤害公式等已接入但边界独立的模块 | `internal/runtime/dps_driver.go`、`internal/runtime/damage_math.go` |
| 8. 机制骨架 | 包边界与后续落点，不要求完整行为 | `internal/{command,pipeline,trigger,status,shield,control,cadence,counter,mark,crit,augment}/` |

Review 时应重点核对：**不能绕过的入口**（`CanCast`、`applyEffect`/`dealDamage`、outbox 写入）、**snapshot 不推进 scheduler**、**短 ID 与 slice 下标一致**。

## 模块职责

```text
cmd/engine_wasm/          TinyGo Wasm 导出入口：alloc/dealloc + engine_* + outbox_*，不含业务逻辑
cmd/bench/                原生 Go benchmark smoke（testkit 驱动，非 Wasm）
internal/abi/             frame header 编解码、outbox 缓冲、内存指针桥接
internal/model/           V2 DTO、枚举、frame kind、错误码（无运行时逻辑）
internal/compile/         EngineBundleV2 → CompiledBundle，短 ID、索引、引用校验
internal/runtime/         Session 生命周期 + RunContext 1v1 主循环 + DPS 竖切
internal/scheduler/       (time, priority, seq) 稳定事件堆 + generation handle
internal/formula/         公式 DTO → bytecode → EvalContext 执行
internal/attribute/       base/current/max/resolved/dirty + modifier 聚合
internal/resource/        current/max + spend/refund/regen/clamp
internal/{command,...}/   机制子系统骨架（待完整接入主流程）
internal/testkit/         fixture、golden replay、ABI helper（测试用）
scripts/                  TinyGo 构建、Node instantiate/export smoke、Node benchmark
targets/wasm-256m.json    256 MiB TinyGo wasm target
```

## 核心数据流

```text
宿主 alloc → 写入 init frame (header + JSON EngineBundleV2)
  → engine_init → compile.Bundle → outbox: ready | error

宿主写入 run frame (JSON EngineRunInputV2 或 SingleAttackerDPSInputV2)
  → engine_begin_run
      ├─ 普通 run: NewRunContext → phase=running，初始 action 入堆
      └─ DPS run: runSingleAttackerDPS 同步完成 → outbox: done（不创建 RunContext）

engine_step(maxEvents)
  → RunContext.Step: Pop 事件 → dispatch → 改 runtime 状态 → outbox: log/sample
  → 队列空或达上限 → outbox: done
  → 失败 → outbox: error

engine_snapshot_initial / engine_snapshot_actions_initial
  → NewRunContext（忽略 initialActions/trace）→ outbox: snapshot | action_snapshot
  → 不推进 scheduler、不修改 Session.phase 为 running

宿主 engine_outbox_ptr/len → 读帧 → engine_outbox_clear
```

首期协议：**16 字节 frame header**（magic/schemaVersion/kind/flags/payloadLen）+ **UTF-8 JSON payload**。`FrameKindBinaryRun` 仅预留。

## 当前已接入能力

| 区域 | 状态 | 说明 |
| --- | --- | --- |
| ABI / frame / outbox | 已接入 | 固定导出函数；done/error/snapshot 优先保留 |
| Session 生命周期 | 已接入 | PhaseEmpty→Ready→Running→Done/Failed |
| Bundle 编译 | 已接入 | collect-all 校验；短 ID 与数组下标绑定 |
| 公式 bytecode | 已接入 | compile 期编译，runtime EvalContext 读取 |
| 调度堆 | 已接入 | 稳定排序；MaxEventHeap 上限 |
| 属性 Store | 已接入 | dirty/ResolveAll；公式可读 resolved |
| 资源 Store | 已接入 | spend/refund；action cost gate |
| 1v1 runtime 竖切 | 已接入 | cast intent、冷却、status/shield arena、基础 effect、trigger 遍历 |
| Action snapshot | 已接入 | 面板 cost/effect breakdown、CanCast 状态 |
| Single-attacker DPS | 已接入 | begin_run 识别 DPS payload，同步输出 DonePayload |
| ValueTraceV2 | 骨架 | DTO 已定义，runtime 尚未稳定产出 |

## 骨架边界（review 时勿当作已完成）

以下包已有目录/类型/占位，**尚未完整接入** scheduler → command → pipeline 主链：

- `command`、`pipeline`：数值变更应经统一 resolver，不应散落改 HP
- `trigger`：当前 runtime 线性遍历 `CompiledTrigger`；后续需 TriggerIndex
- `status`、`shield`、`control`、`cadence`：部分逻辑在 runtime 内联，包内为扩展落点
- `counter`、`mark`、`crit`、`augment`：runtime 有基础消费点，独立包待丰满
- `ValueTraceV2`：trace 选项存在，稳定输出待实现
- 浏览器 Worker 宿主：在 `web/**`，本目录 Node 脚本非正式宿主

热路径约束（见 `AGENTS.md` §8）：禁止 goroutine/channel/lock/panic-recover/反射；1v1 优先定长数组与短 ID。

## 常用命令

在 `wasm/tinygo_engine_v2/` 目录执行：

```powershell
go test ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
node .\scripts\smoke-node.mjs
node .\scripts\bench-node.mjs --iterations 10 --warmup 2
```

TinyGo 不在 `PATH` 时：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1 -TinyGo "C:\path\to\tinygo.exe"
```

仓库默认可发现 repo-local 工具：`.tools/tinygo0.40.1/`、`.tools/binaryen-version_129/`。`wasm_exec.js` 必须来自同一 TinyGo 版本的 `TINYGOROOT`。

## 构建

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
```

等价于：

```powershell
tinygo build -scheduler=none -no-debug -opt=z -target .\targets\wasm-256m.json -o .\dist\tinygo_engine_v2.wasm .\cmd\engine_wasm
```

## ABI 摘要

```text
alloc(size) -> ptr
dealloc(ptr, size)
engine_init(ptr, size) -> 0/-1
engine_snapshot_initial(ptr, size) -> 0/-1
engine_snapshot_actions_initial(ptr, size) -> 0/-1
engine_begin_run(ptr, size) -> 0/-1
engine_step(maxEvents) -> 1/0/-1    # 1=还有事件, 0=run 结束, -1=错误
engine_abort_run() -> 0
engine_outbox_ptr() -> ptr
engine_outbox_len() -> len
engine_outbox_clear()
```

- `engine_init` 成功后 phase=ready，outbox 写 `ready` frame。
- `engine_snapshot_*` 在 ready/done 阶段可调用，不进入 running。
- `engine_step` 仅在 running 阶段有效；宿主循环 step 直到返回 0 或 -1，再读 outbox。

## 约束

- `targets/wasm-256m.json` 固定 `--initial-memory=268435456` 和 `--max-memory=268435456`。
- 构建模式默认 `-scheduler=none -no-debug -opt=z`。
- 网络请求、缓存、版本协商、文件加载留在 JS/Worker；TinyGo 只接收准备好的 frame payload。
- 旧 Rust/Katarina crate 已移除；新增 Wasm 能力默认落在本目录。
