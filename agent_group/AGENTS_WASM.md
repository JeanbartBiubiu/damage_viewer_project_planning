# AGENTS_WASM.md

## 适用范围

- 当前模块 worktree 根目录：`C:\project\damage_wasm_dev`
- 默认 Git 分支前缀：`wasm/`
- 这是同一 monorepo 下的 Wasm 专用 Git worktree，不是独立拆仓；仓内仍包含 `web/`、`server/`、`db/`、`文档记录/` 等目录，但默认不要把它们当作当前任务的主写入范围。

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
3. 与当前任务直接相关的 Wasm 专题页、任务页、会话记录页
4. 只有当任务需要历史决策或任务归属时，再读取：
   - `C:\project\obsidian-game\ai-remember\wasm专用\02-决策日志.md`
   - `C:\project\obsidian-game\ai-remember\wasm专用\03-任务地图.md`
5. 只有当任务明确跨模块时，再回看 Vault 根目录共享页，以及 `C:\project\obsidian-game\ai-remember\上下文\Wasm-引擎上下文.md`

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

## SQLite 任务治理

1. 当前 worktree 的 `db/task_doc_governance/task_rules.json` 仍是任务映射真源。
2. 治理元数据变化后，运行 `node tools/task-governance/cli.mjs rebuild` 重建 SQLite。
3. 不要直接手改 `db/task_doc_governance/task_doc_governance.sqlite`。
