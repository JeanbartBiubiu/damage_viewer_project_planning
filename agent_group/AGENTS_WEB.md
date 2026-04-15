# AGENTS_WEB.md

## 适用范围

- 当前模块 worktree 根目录：`C:\project\damage_web_dev`
- 默认 Git 分支前缀：`web/`
- 这是同一 monorepo 下的前端专用 Git worktree，不是独立拆仓；仓内仍包含 `server/`、`db/`、`wasm/`、`文档记录/` 等目录，但默认不要把它们当作当前任务的主写入范围。

## 默认写入范围

1. `web/**`
2. `tools/**` 中与前端构建、资源处理、发布校验直接相关的脚本
3. `文档记录/**` 中与前端页面、发布链、缓存策略、Wasm 宿主集成直接相关的文档

## 默认只读参考

1. `server/**`
2. `db/**`
3. `wasm/**`
4. `接口/**`

## 启动时优先读取的上下文

1. `C:\project\obsidian-game\ai-remember\web专用\00-项目索引.md`
2. `C:\project\obsidian-game\ai-remember\web专用\01-当前上下文.md`
3. 与当前任务直接相关的 Web 专用专题页、任务页、会话记录页
4. 只有当任务需要历史决策或任务归属时，再读取 `web专用\02-决策日志.md` 和 `web专用\03-任务地图.md`
5. 只有当任务明确跨模块时，再回看 Vault 根目录共享页、`上下文/Web-前端上下文.md` 与相关模块上下文页

## 默认回写边界

1. 会话记录默认写入 `C:\project\obsidian-game\ai-remember\web专用\会话记录\`
2. 不直接改 Vault 根目录的共享页，除非当前会话被明确指定为汇总/收口会话
3. 如果当前讨论同时影响 `web / server / wasm` 边界，先写 Web 专用会话记录页，再由汇总会话决定是否同步共享页

## 前端实现约定

1. 优先保证 `web/**` 在当前 monorepo worktree 中可单独安装、单独启动、单独构建。
2. 默认把 Wasm 当作前端消费的运行时产物；只有在 ABI、worker 宿主或本地构建桥接确实需要时，才最小化改动 `wasm/**`。
3. 不要把外部仓路径或机器本地绝对路径硬编码进前端业务源码；需要桥接时优先使用脚本、环境变量或配置项。
4. 涉及接口行为时，优先以前端服务层、接口契约和联调结果为准，不直接假设后端实现细节。
5. 需要跨模块改动时，只做支撑当前前端任务所必需的最小变更，并在会话记录中注明原因。

## SQLite 任务治理

1. 当前 worktree 的 `db/task_doc_governance/task_rules.json` 仍是任务映射真源。
2. 治理元数据变化后，运行 `node tools/task-governance/cli.mjs rebuild` 重建 SQLite。
3. 不要直接手改 `db/task_doc_governance/task_doc_governance.sqlite`。
