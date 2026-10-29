# TinyGo Scripts AGENTS.md

本文件适用于 `scripts/**`。Node 脚本是本地验证工具，不是正式浏览器 Worker 宿主。

## 约束

- `build-wasm.ps1`（Windows）、`build-wasm.sh`（macOS/Linux）与 `targets/wasm-256m.json` 共同决定构建，两份脚本的入口、参数和工具查找顺序保持一致；`wasm_exec.js` 必须来自同一 TinyGo 版本。
- `smoke-node.mjs` 验证 compile/run/release 往返，`bench-node.mjs` 负责实例化和 `generic-run` 性能，`generic-abi-host.mjs` 提供共享宿主接线。专项 `vamp-smoke-node.mjs`、`status-merge-smoke-node.mjs`、`skill-hit-smoke-node.mjs`、`p6-smoke-node.mjs` 使用各自独立 fixture，不修改或复制基准样例。
- 当前smoke与benchmark显式选择 `formula-phase4-input.mjs` 的独立作者输入。`generic-abi-host.mjs` 的旧样例加载器维持纯读取；原固定样例只用于新协议拒绝及旧档案复核，不修改、复制或加载后补公式。
- `smoke-node.mjs --legacy-fixture --wasm target/formula-phase4-baseline/tinygo_engine_v2.wasm` 复核旧协议900；第四阶段正式验证使用 `target/formula-phase4/tinygo_engine_v2.wasm`，专项为 `formula-phase4-smoke-node.mjs`。第三A／B专项在当前产物上分别证明原输入拒绝、新独立基准900及既有共同公式能力。
- 默认产物是 `dist/tinygo_engine_v2.wasm`。实例化后启动 `go.run(instance)`，但不把其长期 pending promise 当作往返完成门槛。
- 只断言当前 memory、alloc/dealloc、outbox 与 compile/run/release 导出，不恢复 legacy 导出。

## 验证

构建脚本变化运行实际构建。Node 脚本变化至少运行相关 `node --check`、`generic-abi-host.test.mjs`、smoke 和受影响 benchmark；精确命令以模块 README 为准。
