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

每次新起对话，除遵守本文件通用规则外，还必须先识别当前 worktree 根目录和 Git 分支前缀，再决定是否继续读取模块内更近的专项规则：

1. 如果当前 worktree 根目录位于 `C:\project\damage_backend_dev`，或当前分支前缀为 `backend/` 或 `server/`，优先读取最近的后端项目级规则；当前默认入口是 `server/data_manage/AGENTS.md`。
2. 如果当前 worktree 根目录位于 `C:\project\damage_web_dev`，或当前分支前缀为 `web/`，继续读取 `agent_group/AGENTS_WEB.md`。
3. 如果当前 worktree 根目录位于 `C:\project\damage_wasm_dev`，或当前分支前缀为 `wasm/`，继续读取 `agent_group/AGENTS_WASM.md`。
4. 如果 worktree 目录信号与分支前缀冲突，以当前 worktree 根目录为准，并在会话开始时明确说明。
5. 更近目录下的专项规则用于收紧当前模块的默认写入范围、Obsidian 目录和跨模块边界；若与本文件冲突，以更近规则优先。
6. 如果未命中任何专项规则，或目标文件不存在，则继续沿用本文件作为默认规则。

## Obsidian 持久化记忆约定

- Obsidian Vault 路径：`C:\project\obsidian-game\ai-remember`
- Obsidian Local REST API URL：`https://127.0.0.1:27124`

### 任务完成后的回写流程

单会话模式下，每次完成任务后，必须同步更新 Obsidian 中的相关记忆与记录，至少包括：

1. `01-当前上下文.md`
2. `02-决策日志.md`，仅在新增或修改技术决策时必更
3. 与本次任务相关的专题页、任务页或会话记录页

并发会话模式下，回写流程改为：

1. 每个会话必须先写自己的会话记录页；如果已有对应任务页，优先更新任务页，并在会话记录页里链接它。
2. 非汇总会话不要直接改 `01-当前上下文.md`、模块上下文页或 `02-决策日志.md`。
3. `01-当前上下文.md`、模块上下文页、`02-决策日志.md` 属于共享页，只允许由单一“汇总/收口会话”串行更新。
4. 汇总会话更新共享页时，优先引用对应的任务页和会话记录页，不直接凭记忆改写摘要。
5. 讨论中的临时判断、未确认方案、排查过程，只写入会话记录页或任务页；只有稳定结论才能进入共享页。
6. 如果无法确认当前是不是并发会话，默认按并发模式处理。

### 回写内容要求

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
