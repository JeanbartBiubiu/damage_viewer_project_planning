# AGENTS.md

## 1. 通用协作规则

1. 能拆分的复杂任务优先拆给 sub-agent，避免主会话上下文膨胀。
2. 不要把 API key、Bearer token、Cookie 或其他密钥写入仓库文件。
3. 优先做最小必要改动，避免跨模块顺手重构。
4. 修改前先确认目标目录的最近一层 `AGENTS.md`、相关 `README.md` 和构建脚本。

## 2. 指令优先级与 worktree 路由

当前仓库按模块拆分为多个 Git worktree：

- `C:\project\damage_viewer_project_planning`
- `C:\project\damage_backend_dev`，当前分支前缀通常为 `backend/` 或 `server/`
- `C:\project\damage_web_dev`，当前分支前缀通常为 `web/`
- `C:\project\damage_wasm_dev`，当前分支前缀通常为 `wasm/`

规则如下：

1. 先以当前 worktree 根目录判断模块归属；若与分支前缀冲突，以 worktree 根目录为准。
2. 最近一层 `AGENTS.md` 优先于更上层规则。
3. 如果当前 worktree 位于 `C:\project\damage_web_dev` 且目标位于 `web/**`，参考 `web/AGENTS.md`；其他路径默认继续沿用本文件。
4. 如果当前 worktree 位于 `C:\project\damage_backend_dev`，参考 `agent_group/AGENTS_BACKEND.md`。
5. 如果当前 worktree 位于 `C:\project\damage_wasm_dev`，参考 `agent_group/AGENTS_WASM.md`。

## 3. 修改与验证原则

1. 文档变更优先保持与代码现状一致，再考虑补充最佳实践说明。
2. 只改文档时，可不运行构建；但若更新了命令、脚本、入口描述，需至少核对对应源码或脚本仍存在。
3. 改代码时，优先运行目标模块最近文档中声明的最小验证命令，并在回复或记录中说明结果。
4. 若发现文档和代码不一致，以代码、脚本和可运行命令为准，再回写文档。

## 4. Obsidian 持久化记忆

- Vault 路径：`C:\project\obsidian-game\ai-remember`
- Local REST API 地址：`https://127.0.0.1:27124`

默认按并发会话模式处理：

1. 先写各自的会话记录页；如已有任务页，优先更新任务页并在会话记录页里链接。
2. 非汇总会话不要直接修改共享页：`01-当前上下文.md`、模块上下文页、`02-决策日志.md`。
3. 只有稳定结论进入共享页；排查过程、临时判断写会话记录页或任务页。

回写内容保持简洁可追踪，至少包括：日期、目标、实际修改路径、关键决策、验证结果、风险、下一步、关联 `task_key`。

## 5. SQLite 任务治理

1. `db/task_doc_governance/task_rules.json` 是任务与文档映射真源。
2. `db/task_doc_governance/task_doc_governance.sqlite` 只通过重建生成，不直接手改。
3. 任务粒度、归属、状态或映射变化后，运行 `node tools/task-governance/cli.mjs rebuild`。
4. `文档记录/**/*.md` 是实现文档真源；Obsidian 是记忆层，不替代这些文档。
