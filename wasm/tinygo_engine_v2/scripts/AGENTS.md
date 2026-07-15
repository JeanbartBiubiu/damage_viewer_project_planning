# TinyGo Scripts AGENTS.md

## 适用范围

本文件适用于 `wasm/tinygo_engine_v2/scripts/**`。

## 默认读写边界

1. 默认可写：TinyGo 构建脚本、Node generic ABI smoke、Node benchmark、共享 host helper。
2. 不要把 Node 脚本升级成正式浏览器 Worker 宿主。
3. 改构建参数时同步检查 `targets/wasm-256m.json` 和 README 构建说明。
4. smoke/bench 必须复用 `internal/testkit/fixtures/generic_p0_basic_damage.json`，不得修改或复制该 fixture。

## 关键入口

1. `build-wasm.ps1`：TinyGo 构建封装。
2. `smoke-node.mjs`：canonical compile → run → release round-trip。
3. `bench-node.mjs`：`--mode instantiate_*` 或 `--mode generic-run`。
4. `generic-abi-host.mjs`：frame/outbox/instantiate 共享 helper。

## 最小验证

1. 改构建脚本后运行 `powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1`。
2. 改 Node smoke/bench/host helper 后：
   - `node --check .\scripts\generic-abi-host.mjs`
   - `node --check .\scripts\smoke-node.mjs`
   - `node --check .\scripts\bench-node.mjs`
   - `node --test .\scripts\generic-abi-host.test.mjs`
   - `node .\scripts\smoke-node.mjs`
   - `node .\scripts\bench-node.mjs --mode generic-run --iterations 10 --warmup 2`

## 常见陷阱

1. `wasm_exec.js` 必须匹配 TinyGo 版本；缺失时可查 `C:\project\tinygo0.40.1`。
2. 默认产物是 `dist/tinygo_engine_v2.wasm`。
3. instantiate 后必须启动 `go.run(instance)`（本模块 `main` 立即返回；勿把 `go.run` 的 pending promise 当成 round-trip 完成门禁）再调 export。
4. canonical profile 只要求 memory/alloc/dealloc/outbox + compile/run/release；不要把 legacy export 断言成必选。
5. 不要默认推翻 `targets/wasm-256m.json` 的 256 MiB 基线。
