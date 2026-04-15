# AGENTS.md

## 适用范围

本文件只约束 `wasm/katarina_mvp_engine/**`。

## 目标与边界

1. 这里是 Damage Viewer 的 Rust/Wasm 数值模拟内核，不负责前端页面、后端接口或数据库 schema。
2. 默认只改当前 crate；如果必须联动 `web/**`，只改 `web/src/engine/**` 这类宿主桥接必需部分。
3. 任何 ABI、bundle 输入、输出结构调整，都必须同步更新 README 与相关验证文档。

## 关键入口

1. `src/lib.rs`：Wasm ABI、响应缓冲、Rust 公共导出。
2. `src/engine.rs`：`init_session()`、`run()`、`run_full_battle()` 与 benchmark 路由。
3. `src/catalog.rs`、`src/conversion_pipeline.rs`：bundle 编译与转换链路。
4. `src/runtime.rs`：运行时状态、采样、事件日志。
5. `src/sim/**`：战斗循环、动作执行、调度。
6. `src/effects/**`：伤害、护盾、控制与状态效果结算。
7. `build.ps1`、`build-web-wasm.ps1`：本地构建与复制到 Web 侧。
8. `examples/perf_bench.rs`：性能基线与吞吐参考。

## 完成定义

1. 只改文档：确认 README、设计文档与代码入口一致即可。
2. 改 Rust 代码：默认跑 `cargo test` 与 `cargo build --target wasm32-unknown-unknown --release`。
3. 改 ABI、宿主桥接、复制脚本：额外跑 `./build-web-wasm.ps1`，并检查 `web/src/engine/wasmBridge.ts`、`web/src/engine/worker.ts`。
4. 改热路径、调度或公式：额外跑 `cargo run --example perf_bench --release`，确认没有明显性能回退。

## 实现约定

1. 纯计算优先放 `combat_math.rs` 或明确的纯逻辑模块，不要混入 `RuntimeState` 依赖。
2. 新功能先判断所有权，再决定放到 `catalog`、`runtime`、`sim`、`effects` 哪一层。
3. 不要保留迁移完成后的旧入口、兼容 wrapper 或重复实现。
4. Windows 下改了路径或大小写时，注意额外核对 Linux / WSL 可用性。

## 常见排查

1. 找不到 `cargo` 或 Wasm 目标：先确认 Rust 工具链与 `wasm32-unknown-unknown` target 可用。
2. `build-web-wasm.ps1` 失败：先看 `cargo build` 是否已失败，再检查目标产物和 `web/src/engine/wasm/` 是否存在。
3. 前端调用异常：优先对照 `src/lib.rs` 的 ABI 与 `web/src/engine/wasmBridge.ts` 的导出声明。
