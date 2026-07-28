# TinyGo Engine V2 AGENTS.md

## 1. 适用范围

本文只适用于 `wasm/tinygo_engine_v2/**`。

如果与仓库根目录 `AGENTS.md` 冲突，在 `wasm/tinygo_engine_v2/**` 范围内以本文为准。旧 Rust/Katarina crate 已移除，不再作为开发、验证或对照目录。

## 2. 当前目标

1. `wasm/tinygo_engine_v2` 是 Damage Viewer 的 TinyGo Wasm 计算引擎正式落点。
2. **当前 canonical 路径**是 generic ABI：`CompileRequest -> engine_compile -> CompiledSession`，再 `RunRequest + sessionId/expectedRulesHash -> engine_run -> DoneResult`，最后 `ReleaseSessionRequest -> engine_release_session`。
3. 正式宿主目标是浏览器 Worker；Node 脚本只作为本地/CI 的 instantiate、generic ABI smoke 和 benchmark 工具。
4. 首期优化目标是 1v1 单线程确定性计算，不提前为多单位战斗支付热路径复杂度。
5. TinyGo 是当前 Wasm 主线；新机制默认落在 provider/ability/operation + compile/session/run/release。旧单攻 DPS / step-loop lane 与对应导出已从本模块源码移除。
6. 允许用较大的 Wasm 初始内存换取稳定延迟；当前已验证可接受的基线是 `256 MiB`。
7. 低配置设备不是当前 Wasm 计算引擎的兼容目标。
8. 如需推翻 TinyGo 主线或 `256 MiB` 基线，必须附带同口径 benchmark、包体和宿主侧延迟证据，并同步更新本文件、`README.md` 和验证记录。

## 3. 默认写入与参考边界

默认主写入范围：

1. `wasm/tinygo_engine_v2/**`
2. 与 TinyGo V2 契约、架构、验证记录直接相关的 `文档记录/需求澄清/wasm/**`、`文档记录/概要设计/wasm/**`、`文档记录/详细设计/wasm/**`、`文档记录/测试记录/wasm/**`
3. 任务与文档映射变化时的 `db/task_doc_governance/task_rules.json`

默认只读参考：

1. `web/src/engine/**`
2. `web/src/pages/**` 中与 TinyGo V2 验证页面相关的文件
3. `文档记录/概要设计/wasm/网络归档/**`
4. `文档记录/详细设计/最小验证/**`

跨模块写入规则：

1. 只有实现浏览器 Worker adapter、桥接层或宿主验证时，才最小化修改 `web/**`。
2. 不要重新引入旧 Rust/Katarina crate、`demo/go_engine_v2` 或 `demo/java_engine_v2` 作为开发基线。

## 4. 启动时优先读取

进入本目录工作时优先读取：

1. `README.md`
2. `ARCHITECTURE.md`
3. `文档记录/详细设计/wasm/WASM详细设计.md`
4. `文档记录/需求澄清/wasm/WASM需求澄清.md` / `WASM通用计算引擎需求对齐记录.md`
5. `文档记录/概要设计/wasm/WASM概要设计.md`

## 5. 关键入口地图

1. `cmd/engine_wasm/main.go`：TinyGo Wasm 导出；canonical 业务入口为 `engine_compile` / `engine_run` / `engine_release_session`，外加 `alloc`/`dealloc`/outbox glue。
2. `cmd/bench/main.go`：原生 Go benchmark（`generic|generic-run`；`legacy` 与未知参数非零退出）。
3. `internal/abi/**`：frame、outbox、内存拷贝。
4. `internal/model/generic*.go`：`CompileRequest`、`RunRequest`、`DoneResult`、generic frame kind `200..214`、错误 DTO。
5. `internal/compile/generic.go`：`CompileGeneric` → `CompiledSession`；`generic_validate.go` collect-all。
6. `internal/runtime/session.go`：`CompileFrame`/`RunFrame`/`ReleaseSessionFrame` 与 session registry/hash 校验。
7. `internal/runtime/generic_run.go`：`RunGeneric`；`generic_execution.go`、`generic_gate.go`、`generic_provider*.go`。
8. `internal/scheduler/generic_heap.go`、`internal/formula/generic*.go`、`internal/typeset/generic.go`、`internal/pipeline/**`：generic 调度/公式/类型集/数值管道。
9. `internal/testkit/fixtures/generic_p0_basic_damage.json`：canonical fixture（勿改、勿复制）。
10. `scripts/smoke-node.mjs`、`scripts/bench-node.mjs`、`scripts/generic-abi-host.mjs`：Node generic ABI 验证与 benchmark。
11. `targets/wasm-256m.json`：256 MiB TinyGo wasm target。

旧 `engine_init` / `engine_begin_run` / `engine_step` / `engine_abort_run` / snapshot 导出与 `dps_*.go` 单攻 DPS、legacy step-loop 运行时已删除；当前唯一业务 ABI 是 compile/run/release。

## 6. 常用命令

在 `wasm/tinygo_engine_v2/` 目录执行：

```powershell
go test -count=1 ./...
go run ./cmd/bench
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
node .\scripts\smoke-node.mjs
node .\scripts\bench-node.mjs --mode generic-run --iterations 10 --warmup 2
```

如果 TinyGo 不在 `PATH`，构建命令使用：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1 -TinyGo "C:\path\to\tinygo.exe"
```

当前仓库默认优先使用 repo-local 工具路径；缺失时可回退到项目级 `C:\project\tinygo0.40.1`，再回退到 `PATH` / `TINYGO_WASM_EXEC` / 手工 `-TinyGo`。

`wasm_exec.js` 必须来自同一 TinyGo 版本的 `TINYGOROOT`。

## 7. 运行时与 ABI 约定（canonical）

1. 业务导出：`engine_compile`、`engine_run`、`engine_release_session`。
2. 内存/outbox glue：`alloc`、`dealloc`、`engine_outbox_ptr`、`engine_outbox_len`、`engine_outbox_clear`。
3. 协议：16 字节 frame header + UTF-8 JSON payload；generic kind `200..214`。
4. compile 成功写 `compile_result`（含 `sessionId`/`rulesHash`）；run 成功写 `generic done`；release 成功写 `release_result{released:true}`。
5. run 必须带 `sessionId` + `expectedRulesHash`；hash 错配 / session 缺失返回 structured `EngineError`。
6. outbox 固定容量；`compile_result`/`done`/`error`/`release_result` 为优先帧。
7. `targets/wasm-256m.json` 固定 `--initial-memory=268435456` 和 `--max-memory=268435456`。

## 8. 实现边界

1. 热路径禁止 goroutine、channel、lock、panic/recover 控制流和反射。
2. 1v1 首期优先使用定长数组、短 ID、bitset、arena handle 和索引表，不在热路径依赖 `map[string]...`。
3. 数值变化必须经 operation / pipeline，禁止 raw set HP。
4. listener/trigger 产出 operation，不直接写 runtime store。
5. TypeList 使用确定性 flat bitset matcher，不使用可能误判的 Bloom filter。
6. 公共 DTO 一旦进入 review gate，除修 bug 或用户确认外不要随意改字段语义。
7. 新机制落点是 provider/ability/operation；不要重新引入已删除的 legacy DPS/step-loop 路径。

## 9. 完成定义

1. 只改文档：无需构建，但要核对提到的入口文件、脚本和命令仍存在。
2. 改 ABI、frame、outbox 或 session 生命周期：至少运行 `go test -count=1 ./...` 和 `node .\scripts\smoke-node.mjs`。
3. 改 runtime、scheduler、attribute、resource、formula、pipeline 或机制子系统：至少运行 `go test -count=1 ./...` 和 `go run ./cmd/bench`。
4. 改 TinyGo 构建脚本、target 或 Wasm 导出：额外运行 `powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1`。
5. 改 Node smoke/bench：额外运行对应 `node .\scripts\*.mjs`（含 `--mode generic-run`）。
6. 改任务文档映射：运行 `node tools/task-governance/cli.mjs rebuild`。

## 10. 常见陷阱

1. 不要恢复旧 Rust/Katarina crate 作为新能力落点。
2. 不要把 Node 脚本写成正式运行宿主；正式宿主是浏览器 Worker。
3. 不要让 `cmd/engine_wasm/main.go` 承担业务逻辑。
4. 不要在 compile 校验里遇到第一个错误就提前返回；进入已知 schema 后 collect-all。
5. 不要从输出日志倒推机制状态。
6. 不要修改或复制 `generic_p0_basic_damage.json`；复用它做 smoke/bench 契约。
7. 不要把已删除的 legacy ABI/DPS 描述成当前仍存在的源码路径。
