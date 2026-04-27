# TinyGo Engine V2

`wasm/tinygo_engine_v2` 是 Damage Viewer 的 TinyGo Wasm 计算引擎正式落点。当前代码目标不是继续扩展临时 demo，而是按 V2 契约和子系统边界建立可逐层 review、逐层实现的骨架。

## 当前范围

- Wasm ABI 已固定为显式导出函数：`alloc/dealloc/engine_init/engine_snapshot_initial/engine_begin_run/engine_step/engine_abort_run/outbox_*`。
- 输入契约使用 `EngineBundleV2` 和 `EngineRunInputV2`，不继承 Rust MVP 的 `BenchmarkBundle`。
- 输出契约使用 `DonePayloadV2`、`EngineEventLogV2`、`SnapshotV2`、`ValueTraceV2` 和结构化错误。
- 属性已从单个 `float64` 升级为 `base/current/max/resolved/dirty` 运行时模型。
- 资源已拆成独立 `ResourceRuntime`，支持 current/max、spend/refund/regen/clamp。
- Node 脚本只作为本地/CI instantiate 与 ABI smoke；正式宿主目标仍是浏览器 Worker。

## 目录

```text
cmd/engine_wasm/          TinyGo Wasm 导出入口，只放 ABI 函数和 session 装配
cmd/bench/                原生 Go benchmark smoke
internal/abi/             frame、outbox、错误帧和内存拷贝
internal/model/           V2 DTO、枚举、输入/输出契约
internal/compile/         bundle 编译、短 ID、引用校验
internal/runtime/         session、run context、1v1 actor runtime
internal/scheduler/       (time, priority, seq) 稳定事件堆
internal/formula/         公式 bytecode 和 EvalContext
internal/attribute/       属性 base/current/max/resolved 与 modifier 聚合
internal/resource/        资源 current/max 与 spend/refund/regen
internal/{command,pipeline,trigger,...}/  后续机制子系统骨架
internal/testkit/         fixture、golden replay 辅助
scripts/                  TinyGo 构建、Node smoke 和 benchmark
targets/wasm-256m.json    256 MiB TinyGo wasm target
```

## 构建

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
```

脚本默认等价于：

```powershell
tinygo build -scheduler=none -no-debug -opt=z -target .\targets\wasm-256m.json -o .\dist\tinygo_engine_v2.wasm .\cmd\engine_wasm
```

如果 TinyGo 不在 `PATH`：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1 -TinyGo "C:\path\to\tinygo.exe"
```

`wasm_exec.js` 必须来自同一 TinyGo 版本的 `TINYGOROOT`。

## 验证

```powershell
go test ./...
go run ./cmd/bench
node .\scripts\smoke-node.mjs
node .\scripts\bench-node.mjs --iterations 10 --warmup 2
```

Node 脚本只负责实例化/性能 smoke，不是正式运行宿主。

## ABI 摘要

```text
alloc(size) -> ptr
dealloc(ptr, size)
engine_init(ptr, size) -> 0/-1
engine_snapshot_initial(ptr, size) -> 0/-1
engine_begin_run(ptr, size) -> 0/-1
engine_step(maxEvents) -> 1/0/-1
engine_abort_run() -> 0
engine_outbox_ptr() -> ptr
engine_outbox_len() -> len
engine_outbox_clear()
```

`engine_snapshot_initial` 在 `engine_init` 后调用，接收与 `engine_begin_run` 相同的 run frame/payload，忽略 `initialActions`，不推进 scheduler，并向 outbox 写入 `snapshot` frame。

首期协议为二进制 frame header + JSON payload。frame header 包含 `magic/schemaVersion/kind/flags/payloadLen`；JSON 用于调试和前后端对齐，二进制 payload kind 只预留。

## 约束

- `targets/wasm-256m.json` 固定 `--initial-memory=268435456` 和 `--max-memory=268435456`。
- 构建模式默认 `-scheduler=none -no-debug -opt=z`。
- 核心热路径禁止 goroutine、channel、lock、panic/recover 控制流和反射。
- 网络请求、缓存、版本协商、文件加载留在 JS/Worker；TinyGo 只接收准备好的 frame payload。
- `wasm/katarina_mvp_engine` 只作为 Rust 历史 ABI、行为和性能回归基线。
