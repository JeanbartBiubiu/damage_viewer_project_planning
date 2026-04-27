# TinyGo Engine V2 AGENTS.md

## 1. 适用范围

本文只适用于 `wasm/tinygo_engine_v2/**`。

如果与仓库根目录 `AGENTS.md` 或旧 Rust 引擎 `wasm/katarina_mvp_engine/AGENTS.md` 冲突，在 `wasm/tinygo_engine_v2/**` 范围内以本文为准。`wasm/katarina_mvp_engine/**` 仍视为历史 Rust/Wasm 基线，不因为本文件而改变。

## 2. 当前目标

1. `wasm/tinygo_engine_v2` 是 Damage Viewer 的 TinyGo Wasm 计算引擎正式落点。
2. 当前代码目标是按 V2 契约和子系统边界逐层实现、逐层 review，不再扩展临时 demo。
3. 正式宿主目标是浏览器 Worker；Node 脚本只作为本地或 CI 的 instantiate、ABI smoke 和 benchmark 工具。
4. 首期优化目标是 1v1 单线程确定性计算，不提前为多单位战斗支付热路径复杂度。

## 3. 默认写入与参考边界

默认主写入范围：

1. `wasm/tinygo_engine_v2/**`
2. 与 TinyGo V2 契约、架构、验证记录直接相关的 `文档记录/需求澄清/wasm/**`、`文档记录/概要设计/wasm/**`、`文档记录/详细设计/wasm/**`、`文档记录/测试记录/wasm/**`
3. 任务与文档映射变化时的 `db/task_doc_governance/task_rules.json`

默认只读参考：

1. `wasm/katarina_mvp_engine/**`
2. `web/src/engine/**`
3. `web/src/pages/**` 中与 Wasm 宿主或旧 Katarina MVP 页面相关的文件
4. `文档记录/概要设计/wasm/网络归档/**`
5. `文档记录/详细设计/最小验证/**`

跨模块写入规则：

1. 只有实现浏览器 Worker adapter、桥接层或宿主验证时，才最小化修改 `web/**`。
2. 只有明确要求维护旧 ABI、修复旧链路或做 Rust/TinyGo 对照时，才修改 `wasm/katarina_mvp_engine/**`。
3. 不要重新引入 `demo/go_engine_v2` 或 `demo/java_engine_v2` 作为开发基线。

## 4. 启动时优先读取

进入本目录工作时优先读取：

1. `README.md`
2. `ARCHITECTURE.md`
3. `文档记录/需求澄清/wasm/WASM需求澄清.md`
4. `文档记录/概要设计/wasm/WASM概要设计.md`
5. `文档记录/详细设计/wasm/WASM详细设计.md`
6. `文档记录/需求澄清/wasm/WASM机制覆盖需求.md`

## 5. 关键入口地图

1. `cmd/engine_wasm/main.go`：TinyGo Wasm 导出函数，只保留 ABI 和 session 装配。
2. `cmd/bench/main.go`：原生 Go benchmark smoke。
3. `internal/abi/**`：frame、outbox、错误码、内存拷贝和 ABI 合约测试。
4. `internal/model/**`：`EngineBundleV2`、`EngineRunInputV2`、输出日志、snapshot、错误 DTO 和枚举。
5. `internal/compile/**`：bundle 编译、短 ID、引用校验、索引构建。
6. `internal/runtime/**`：`EngineSession`、`RunContext`、actor runtime、RNG、运行生命周期。
7. `internal/scheduler/**`：`(time, priority, seq)` 稳定事件堆和 lazy invalidation。
8. `internal/formula/**`：公式 bytecode、EvalContext 和读取 opcode。
9. `internal/attribute/**`：属性 `base/current/max/resolved/dirty`、modifier 聚合、派生刷新。
10. `internal/resource/**`：资源 `current/max`、spend/refund/regen/clamp。
11. `internal/{command,pipeline,trigger,status,shield,control,cadence,history,counter,mark,crit,augment}/**`：机制子系统骨架和后续实现落点。
12. `internal/testkit/**`：fixture、golden replay、ABI helper。
13. `scripts/**`：TinyGo 构建、Node smoke、Node benchmark。
14. `targets/wasm-256m.json`：256 MiB TinyGo wasm target。

## 6. 常用命令

在 `wasm/tinygo_engine_v2/` 目录执行：

```powershell
go test ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
node .\scripts\smoke-node.mjs
node .\scripts\bench-node.mjs --iterations 10 --warmup 2
```

如果 TinyGo 不在 `PATH`，构建命令使用：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1 -TinyGo "C:\path\to\tinygo.exe"
```

`wasm_exec.js` 必须来自同一 TinyGo 版本的 `TINYGOROOT`。

## 7. 运行时与 ABI 约定

1. ABI 固定为显式导出函数：`alloc`、`dealloc`、`engine_init`、`engine_snapshot_initial`、`engine_begin_run`、`engine_step`、`engine_abort_run`、`engine_outbox_ptr`、`engine_outbox_len`、`engine_outbox_clear`。
2. 协议首期为二进制 frame header + UTF-8 JSON payload；frame header 包含 `magic/schemaVersion/kind/flags/payloadLen`。
3. ABI 可预留二进制 payload kind，但首期不要实现 MessagePack/CBOR 快路径。
4. outbox 使用固定容量缓冲；`done/error/snapshot` 记录必须优先保留，普通 `tick/log/sample` 可降采样或丢弃。
5. `targets/wasm-256m.json` 固定 `--initial-memory=268435456` 和 `--max-memory=268435456`，下探内存只能在 benchmark 证明安全后进行。

## 8. 实现边界

1. 热路径禁止 goroutine、channel、lock、panic/recover 控制流和反射。
2. 1v1 首期优先使用定长数组、短 ID、bitset、arena handle 和索引表，不在热路径依赖 `map[string]...`。
3. 所有实例事件只保存 generation handle，不保存裸指针；旧事件出队时 lazy drop。
4. action、item、status、augment 等机制不得直接改 HP；数值变化必须通过 command、resolver、pipeline 或 runtime 统一入口。
5. trigger 只产出 command，command 回流到 scheduler/resolver，不直接写 runtime 状态。
6. TypeList 网络使用确定性 bitset/inverted index/matcher，不使用 Bloom filter 这类可能误判的数据结构。
7. 公共 DTO 一旦进入 review gate，除修 bug 或用户确认外不要随意改字段语义。

## 9. 完成定义

1. 只改文档：无需构建，但要核对提到的入口文件、脚本和命令仍存在。
2. 改 ABI、frame、outbox 或 session 生命周期：至少运行 `go test ./...` 和 `node .\scripts\smoke-node.mjs`。
3. 改 runtime、scheduler、attribute、resource、formula、pipeline、trigger 或机制子系统：至少运行 `go test ./...` 和 `go run ./cmd/bench`。
4. 改 TinyGo 构建脚本、target 或 Wasm 导出：额外运行 `powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1`。
5. 改 Node smoke/bench 或浏览器宿主桥接：额外运行对应 `node .\scripts\*.mjs`，涉及 `web/**` 时按 `web/AGENTS.md` 补充前端验证。
6. 改任务文档映射：运行 `node tools/task-governance/cli.mjs rebuild`。

## 10. 常见陷阱

1. 不要把 `wasm/katarina_mvp_engine` 当成新能力默认落点；它只是历史 ABI、行为和性能对照。
2. 不要把 Node 脚本写成正式运行宿主；正式宿主是浏览器 Worker。
3. 不要让 `cmd/engine_wasm/main.go` 承担业务逻辑；导出函数之外的逻辑应下沉到 `internal/**`。
4. 不要在编译期校验里遇到第一个错误就提前返回；需要尽量 collect-all，便于前后端一次修完输入。
5. 不要从输出日志倒推机制状态；历史窗口、counter、pair state、mark 都应有独立 runtime 状态。
6. 不要把临时 fixture 或 benchmark 结果写成正式契约；正式契约以 `internal/model` 和 Wasm 主文档为准。
