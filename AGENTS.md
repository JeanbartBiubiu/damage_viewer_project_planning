# AGENTS.md

## 1. 全局协作底线

1. 每次新起对话，先识别当前 worktree 根目录和 Git 分支；如果普通 `git` 被 safe.directory 拦截，可用一次性 `git -c safe.directory=<repo> ...` 读取状态，不要为了读取状态改全局配置。
2. 修改前先读取目标路径最近一层 `AGENTS.md`、相关 `README.md` 和构建/验证脚本；更近层规则优先于本文件。
3. 能拆分的复杂任务优先拆给 sub-agent，避免主会话上下文膨胀；分配任务时明确读写范围，避免交叉覆盖。
4. 不要把 API key、Bearer token、Cookie、Obsidian REST API 密钥或其他密钥写入仓库、Codex Memory 或 Obsidian。
5. 优先做最小必要改动，避免跨模块顺手重构；发现无关脏改时不要回滚，除非用户明确要求。
6. 只改文档时通常不需要运行构建；如果文档更新了命令、脚本、入口或路径，至少核对对应文件仍存在。改代码时按最近层 `AGENTS.md` / `README.md` 的完成定义验证。
7. 当前 worktree 已初始化 `.codegraph/`。涉及源码符号搜索、调用链、引用解析、影响面分析或为 AI 组装实现上下文时，优先使用 `npx @colbymchenry/codegraph query|callers|callees|impact|context`，不要先在源码里用 `grep`/`rg` 盲扫符号名。
8. `rg` / `rg --files` 仍用于精确文本匹配、文件名检索，以及 `Markdown/SQL/XML/YAML/JSON/日志/生成物/配置` 等 CodeGraph 不能可靠建图的内容；当需要核对字面量、报错文本、注释或文档原文时，同样优先用 `rg`。
9. CodeGraph 结果可能因未同步而过期；大改后或结果可疑时，先运行 `npx @colbymchenry/codegraph status` 或 `npx @colbymchenry/codegraph sync`，不要把 `.codegraph/*.db*` 之类本地索引产物提交入库。

## 2. 渐进式披露与 worktree 路由

当前仓库按模块拆分为多个 Git worktree：

- `C:\project\damage_viewer_project_planning`
- `C:\project\damage_backend_dev`，当前分支前缀通常为 `backend/` 或 `server/`
- `C:\project\damage_web_dev`，当前分支前缀通常为 `web/`
- `C:\project\damage_wasm_dev`，当前分支前缀通常为 `wasm/`

路由规则：

1. 先按当前 worktree 根目录判断，再参考分支前缀；如果两者冲突，以 worktree 根目录为准，并在会话开始时说明。
2. 后端任务：进入 `C:\project\damage_backend_dev` 或分支前缀为 `backend/` / `server/` 时，继续读取 `server/data_manage/AGENTS.md` 和 `server/data_manage/README.md`。
3. 前端任务：进入 `C:\project\damage_web_dev` 或分支前缀为 `web/` 时，继续读取 `web/AGENTS.md` 和 `web/README.md`。
4. Wasm 任务：进入 `C:\project\damage_wasm_dev` 或分支前缀为 `wasm/` 时，按目标路径读取最近规则；TinyGo V2 任务优先读取 `wasm/tinygo_engine_v2/AGENTS.md` 和 `wasm/tinygo_engine_v2/README.md`。
5. 主 planning 仓内如果目标子目录存在更近的 `AGENTS.md` / `README.md`，同样按最近层规则执行。
6. 根 `AGENTS.md` 只保留跨 worktree 的协作底线、路由和治理摘要；Backend、Web、Wasm/TinyGo 的入口地图、命令、运行时、验证和技术路线细节由各模块 `AGENTS.md` / `README.md` 承接，不在根文件重复。

## 3. 记忆层与持久化边界

当前同时使用 Codex Memory、Obsidian 和本仓库 SQLite 任务治理，三者职责不同：

1. Codex Memory 只保存高层协作偏好、长期技术路线和常见约束，不保存精确模板、大段原文、完整命令输出或可审计任务记录。
2. Obsidian 是长期记忆和审计层，只在出现稳定决策、复杂排查结论、跨 worktree 上下文、任务页状态变化，或用户明确要求记录时回写；普通小改动和一次性问答不强制回写。
3. `文档记录/**/*.md` 是实现文档真源；`db/task_doc_governance/task_rules.json` 是任务与文档映射真源；`db/task_doc_governance/task_doc_governance.sqlite` 是从规则重建得到的查询索引。
4. 当 Codex Memory、Obsidian 与仓库内 `AGENTS.md`、`README.md`、`文档记录/**/*.md` 或 `task_rules.json` 冲突时，以仓库当前文件为准。
5. 需要回写 Obsidian 时，优先写会话记录页或既有任务页；非汇总会话不要直接修改共享上下文页。

## 4. SQLite 任务治理摘要

1. 修改任务粒度、归属、状态或文档映射时，更新 `db/task_doc_governance/task_rules.json`。
2. `db/task_doc_governance/task_doc_governance.sqlite` 只通过重建生成，不直接手改。
3. 映射变化后运行 `node tools/task-governance/cli.mjs rebuild`。
4. 只改 AGENTS/README 且不改变任务映射时，不需要重建 SQLite。
