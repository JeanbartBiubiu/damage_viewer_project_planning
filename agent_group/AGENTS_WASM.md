# AGENTS_WASM.md

## 适用范围

- 当前模块 worktree 根目录：`C:\project\damage_wasm_dev`
- 默认 Git 分支前缀：`wasm/`
- 这是同一 monorepo 下的 Wasm 专用 Git worktree，不是独立拆仓；仓内仍包含 `web/`、`server/`、`db/`、`文档记录/` 等目录，但默认不要把它们当作当前任务的主写入范围。

## 本地路径说明

1. 文档中出现的 `C:\project\...`、`C:\project\obsidian-game\...` 都是当前仓库与本机的默认路径约定，用于帮助 agent 快速定位。
2. 如果本地不存在这些绝对路径，不应阻塞当前 Wasm 代码或文档任务本身；优先完成仓库内可独立落地的工作。
3. 需要跨机器复用时，优先改脚本、相对路径、环境变量或 README 说明，不要把本机绝对路径硬编码进 Wasm 运行时代码。

## 默认写入范围

1. `wasm/**`
2. `最小验证/**`
3. `tools/**` 中与 Wasm 构建、基准、验证直接相关的脚本
4. `文档记录/**` 中与 Wasm 引擎、ABI、公式运行时、验证数据直接相关的文档

## 默认只读参考

1. `web/**`
2. `server/**`
3. `db/**`
4. `接口/**`

## Obsidian 专用目录

- Vault 根目录：`C:\project\obsidian-game\ai-remember`
- Wasm 专用目录：`C:\project\obsidian-game\ai-remember\wasm专用`
- Wasm 会话记录目录：`C:\project\obsidian-game\ai-remember\wasm专用\会话记录`

## 启动时优先读取的上下文

1. `C:\project\obsidian-game\ai-remember\wasm专用\00-项目索引.md`
2. `C:\project\obsidian-game\ai-remember\wasm专用\01-当前上下文.md`
3. 进入 `wasm/katarina_mvp_engine/**` 任务时，再优先读取 `wasm/katarina_mvp_engine/AGENTS.md`
4. 只有当任务需要历史决策或任务归属时，再读取：
   - `C:\project\obsidian-game\ai-remember\wasm专用\02-决策日志.md`
   - `C:\project\obsidian-game\ai-remember\wasm专用\03-任务地图.md`
5. 与当前任务直接相关的 Wasm 专题页、任务页、会话记录页
6. 只有当任务明确跨模块时，再回看 Vault 根目录共享页，以及 `C:\project\obsidian-game\ai-remember\上下文\Wasm-引擎上下文.md`

## 默认回写边界

1. Wasm 日常会话默认只写 `C:\project\obsidian-game\ai-remember\wasm专用\` 下的索引、上下文、决策和会话记录页。
2. 会话记录默认写入 `C:\project\obsidian-game\ai-remember\wasm专用\会话记录\`。
3. 不直接改 Vault 根目录的共享页，除非当前会话被明确指定为汇总/收口会话。
4. 如果当前讨论同时影响 `web / server / wasm` 边界，先写 Wasm 专用会话记录页，再由汇总会话决定是否同步共享页。

## Wasm 实现约定

1. 优先保证 `wasm/**` 在当前 monorepo worktree 中可单独构建、单独测试、单独跑 benchmark。
2. 默认聚焦 `wasm/katarina_mvp_engine/**` 与相关验证数据；只有在 ABI、worker 宿主或构建桥接确实需要时，才最小化改动 `web/**`。
3. 不要让 Wasm 引擎直接承担后端接口、数据库 schema 或前端页面逻辑职责；跨模块依赖优先通过 bundle 契约、ABI 和文档收口。
4. 若变更 bundle 输入、ABI 或宿主桥接，至少同步检查 `web/src/engine/**`、相关验证脚本与文档口径。
5. 需要跨模块改动时，只做支撑当前 Wasm 任务所必需的最小变更，并在会话记录中注明原因。

## 关键入口地图

1. `wasm/katarina_mvp_engine/README.md`：模块定位、命令矩阵、常见排查、协作边界。
2. `wasm/katarina_mvp_engine/AGENTS.md`：crate 级快速规则、关键入口与最低验证。
3. `wasm/katarina_mvp_engine/src/lib.rs`：Wasm ABI 导出、宿主共享响应缓冲、Rust 公共导出。
4. `wasm/katarina_mvp_engine/src/engine.rs`：会话初始化、主运行入口、benchmark 路由。
5. `wasm/katarina_mvp_engine/src/catalog.rs` 与 `src/conversion_pipeline.rs`：bundle 编译、转换与运行时数据准备。
6. `wasm/katarina_mvp_engine/src/runtime.rs`、`src/sim/**`、`src/effects/**`：运行时状态、主循环、动作执行、伤害与状态结算。
7. `wasm/katarina_mvp_engine/build.ps1` 与 `build-web-wasm.ps1`：本地构建与复制 Wasm 产物。
8. `web/src/engine/wasmBridge.ts`、`web/src/engine/worker.ts`：前端宿主桥接与 worker 消费侧。

## 完成定义与最低验证

1. 只改 Wasm 文档时，至少同步检查 README / 设计文档是否仍与当前代码入口一致；可不跑构建。
2. 改动 `wasm/katarina_mvp_engine/src/**` 后，默认至少执行：
   - `cargo test`
   - `cargo build --target wasm32-unknown-unknown --release`
3. 改动 ABI、输出 JSON、宿主桥接或复制脚本后，额外执行 `./build-web-wasm.ps1`，并复核 `web/src/engine/**` 是否仍匹配。
4. 改动热路径、调度、伤害结算、关键公式或性能基线后，额外执行 `cargo run --example perf_bench --release`。
5. 涉及结构重构、入口迁移或模块拆分时，同步更新 `wasm/katarina_mvp_engine/README.md` 与相关 `文档记录/**`。

## SQLite 任务治理

1. 当前 worktree 的 `db/task_doc_governance/task_rules.json` 仍是任务映射真源。
2. 治理元数据变化后，运行 `node tools/task-governance/cli.mjs rebuild` 重建 SQLite。
3. 不要直接手改 `db/task_doc_governance/task_doc_governance.sqlite`。
