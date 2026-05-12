# TinyGo Scripts AGENTS.md

## 适用范围

本文件适用于 `wasm/tinygo_engine_v2/scripts/**`。

## 默认读写边界

1. 默认可写：TinyGo 构建脚本、Node instantiate/export smoke、Node benchmark 脚本。
2. 不要把 Node 脚本升级成正式浏览器 Worker 宿主。
3. 改构建参数时同步检查 `targets/wasm-256m.json` 和 README 构建说明。

## 关键入口

1. `build-wasm.ps1`：TinyGo 构建封装。
2. `smoke-node.mjs`：Node instantiate 和导出函数检查。
3. `bench-node.mjs`、`bench_wasm.mjs`：Node benchmark smoke。

## 最小验证

1. 改构建脚本后运行 `powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1`。
2. 改 Node smoke/bench 后运行对应 `node .\scripts\*.mjs`。

## 常见陷阱

1. `wasm_exec.js` 必须匹配 TinyGo 版本。
2. 默认产物是 `dist/tinygo_engine_v2.wasm`。
3. 不要默认推翻 `targets/wasm-256m.json` 的 256 MiB 基线。
