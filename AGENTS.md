# AGENTS.md

## 通用协作约定

1. 能拆分的任务优先使用 sub-agent，避免主 agent 上下文膨胀。
2. 可以根据进展随时补充或细化 sub-agent 的工作范围与交付要求。
3. 不要把用户提供的 API key、Bearer token、Cookie 或其他密钥写入仓库文件。

## Git Worktree 路由约定

当前仓库已按模块拆成多个 Git worktree 开发目录：

- `C:\project\damage_viewer_project_planning`
- `C:\project\damage_backend_dev`，当前分支：`backend/dev`
- `C:\project\damage_web_dev`，当前分支：`web/dev`
- `C:\project\damage_wasm_dev`，当前分支：`wasm/dev`

每次新起对话，除遵守本文件通用规则外，还必须先识别当前 worktree 根目录和 Git 分支前缀，再决定是否继续读取 `agent_group/` 下的专项规则：

1. 如果当前 worktree 根目录位于 `C:\project\damage_backend_dev`，或当前分支前缀为 `backend/` 或 `server/`，继续读取 `agent_group/AGENTS_BACKEND.md`。
2. 如果当前 worktree 根目录位于 `C:\project\damage_web_dev`，或当前分支前缀为 `web/`，继续读取 `agent_group/AGENTS_WEB.md`。
3. 如果当前 worktree 根目录位于 `C:\project\damage_wasm_dev`，或当前分支前缀为 `wasm/`，继续读取 `agent_group/AGENTS_WASM.md`。
4. 如果 worktree 目录信号与分支前缀冲突，以当前 worktree 根目录为准，并在会话开始时明确说明。
5. `agent_group/` 下的专项规则用于收紧当前模块的默认写入范围、Obsidian 目录和跨模块边界；若与本文件冲突，以专项规则在对应模块范围内优先。
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

回写内容保持简洁、可追踪，优先记录：

1. 日期
2. 本次任务目标
3. 实际修改的代码或文档路径
4. 关键决策与取舍
5. 验证结果
6. 未解决问题或风险
7. 建议的下一步
8. 关联的 `task_key`、任务页或来源会话页

### 与 Obsidian 的交互方式

1. 默认优先直接读写 Vault 下的 Markdown 文件，不依赖 REST API 凭据。
2. 需要使用 Obsidian Local REST API 时，默认使用固定地址 `https://127.0.0.1:27124`。
3. 不要把 Obsidian Local REST API 的凭据写入仓库；凭据只允许在当前会话内临时使用，或从用户本机环境变量读取。
4. 获取 Obsidian Local REST API key 的方式：在 Obsidian 中打开当前 Vault，进入 `Settings -> Community plugins -> Local REST API`，在插件设置页查看或复制 API key。

### 并发会话补充约定

1. 共享页包括：`01-当前上下文.md`、模块上下文页、`02-决策日志.md`，这些页面默认视为需要串行写入。
2. 会话记录页默认允许并发追加，但文件名要足够具体，避免多个会话误写到同一页。
3. 同一任务如果预计会跨 2 个以上并发会话，尽早建立独立任务页，减少多个会话直接碰共享页。
4. `02-决策日志.md` 只记录“已确认采用”的决策；候选方案、争议点、待验证结论先放会话记录页或任务页。
5. 汇总会话在回写共享页前，应先读取相关会话记录页，必要时再核对仓库实际文件，避免二次转述失真。

## SQLite 任务治理约定

### 职责边界

1. `db/task_doc_governance/task_rules.json` 是任务与文档映射的规则真源。
2. `db/task_doc_governance/task_doc_governance.sqlite` 是由规则和文档头重建出的本地结构化索引，不手工编辑。
3. Obsidian 只负责项目记忆、上下文、决策日志、会话记录和人工可读索引，不单独发明另一套任务真源。

### 真源规则

1. `task_key`、任务归属、任务状态，以 `task_rules.json` 和重建出的 SQLite 结果为准。
2. Obsidian 如果提到任务，优先直接引用已有 `task_key`，避免产生第二套命名。
3. `文档记录/**/*.md` 是本地实现文档真源；Obsidian 是记忆层，不替代这些文档。

### 更新规则

1. 需要调整任务粒度、任务归属、文档映射或任务状态时，优先修改 `db/task_doc_governance/task_rules.json`。
2. 任务映射或治理元数据变化后，运行 `node tools/task-governance/cli.mjs rebuild` 重建本地 SQLite。
3. 不要直接手改 `db/task_doc_governance/task_doc_governance.sqlite`。
4. 如果只是补充背景、决策、上下文、会话总结，优先更新 Obsidian，不需要改 SQLite 任务治理数据。

### 冲突避免

1. 不要在 Obsidian 和 SQLite 两边同时维护不同版本的任务状态。
2. 不要在 Obsidian 中维护与 `task_rules.json` 不一致的任务映射表。
3. 如果发现两边描述冲突，以仓库代码、`文档记录/`、`task_rules.json` 和重建后的 SQLite 为准，再回写 Obsidian 修正说明。
