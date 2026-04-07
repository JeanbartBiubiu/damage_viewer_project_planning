# AGENTS.md

## 通用协作约定

1. 能拆分的任务优先使用 sub-agent，避免主 agent 上下文膨胀。
2. 可以根据进展随时补充或细化 sub-agent 的工作范围与交付要求。
3. 不要把用户提供的 API key、Bearer token、Cookie 或其他密钥写入仓库文件。

## Obsidian 持久化记忆约定

- Obsidian Vault 路径：`C:\project\obsidian-game\ai-remember`
- Obsidian Local REST API URL：`https://127.0.0.1:27124`

### 新对话启动流程

每次新起对话，在开始实质性工作前，先读取 Obsidian 中的项目上下文。

优先检查以下页面：

1. `00-项目索引.md`
2. `01-当前上下文.md`
3. `02-决策日志.md`
4. `03-任务地图.md`
5. 与当前任务直接相关的专题页、任务页、会话记录页

如果上述页面不存在，先创建最小骨架，再继续当前任务。

### 任务完成后的回写流程

每次完成任务后，必须同步更新 Obsidian 中的相关记忆与记录，至少包括：

1. `01-当前上下文.md`
2. `02-决策日志.md`，仅在新增或修改技术决策时必更
3. 与本次任务相关的专题页、任务页或会话记录页

### 回写内容要求

回写内容保持简洁、可追踪，优先记录：

1. 日期
2. 本次任务目标
3. 实际修改的代码或文档路径
4. 关键决策与取舍
5. 验证结果
6. 未解决问题或风险
7. 建议的下一步

### 与 Obsidian 的交互方式

1. 默认优先直接读写 Vault 下的 Markdown 文件，不依赖 REST API 凭据。
2. 需要使用 Obsidian Local REST API 时，默认使用固定地址 `https://127.0.0.1:27124`。
3. 不要把 Obsidian Local REST API 的凭据写入仓库；凭据只允许在当前会话内临时使用，或从用户本机环境变量读取。
4. 获取 Obsidian Local REST API key 的方式：在 Obsidian 中打开当前 Vault，进入 `Settings -> Community plugins -> Local REST API`，在插件设置页查看或复制 API key。

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
