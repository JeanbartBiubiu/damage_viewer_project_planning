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
3. 如果当前 worktree 根目录位于 `C:\project\damage_wasm_dev`，或当前分支前缀为 `wasm/`，按目标路径继续读取 Wasm 专项规则：TinyGo V2 任务优先读取 `wasm/tinygo_engine_v2/AGENTS.md`；旧 Rust/Katarina 任务读取 `wasm/katarina_mvp_engine/AGENTS.md`。
4. 如果 worktree 目录信号与分支前缀冲突，以当前 worktree 根目录为准，并在会话开始时明确说明。
5. 模块专项规则用于收紧当前模块的默认写入范围、Obsidian 目录和跨模块边界；若与本文件冲突，以专项规则在对应模块范围内优先。
6. 如果未命中任何专项规则，或目标文件不存在，则继续沿用本文件作为默认规则。

## 2.5 Wasm 路线决策

当前 `C:\project\damage_wasm_dev` worktree 的 Wasm 计算引擎默认开发语言改为 TinyGo。

1. 新的 Wasm 引擎能力、性能实验、包体优化和浏览器宿主接入，默认优先落到 TinyGo 路线，不再默认扩展 Rust 版本作为主实现。
2. 现有 `wasm/katarina_mvp_engine/**` Rust crate 视为历史实现、兼容参考或对照基线；只有在明确要求维护旧 ABI、修复旧链路或做 Rust/TinyGo 对照时，才继续改它。
3. TinyGo 路线允许用较大的 Wasm 初始内存换取稳定延迟；当前已验证可接受的基线是 `256 MiB` 初始内存，后续可继续下探更小阈值，但不要默认回到“小内存优先”的假设。
4. 低配置设备不是当前 Wasm 计算引擎的兼容目标。若设备资源明显不足，优先降级、禁用或不加载计算引擎，不为了兼容低端机器而回退 TinyGo 路线或削弱主计算能力。
5. 如果后续任务想推翻这条决策，必须附带新的同口径 benchmark、包体和宿主侧延迟证据，再同步更新相关 AGENTS、README 和验证记录。

## 2.6 记忆层与持久化边界

当前同时使用 Codex Memory、Obsidian 和本仓库 SQLite 任务治理。三者职责不同，不互相替代：

1. Codex Memory 用于高层协作偏好、长期技术路线和常见约束，例如“先读最近 AGENTS”“TinyGo 是当前 Wasm 主线”“不要持久化密钥”。不要依赖它保存精确模板、大段原文、命令输出、完整任务记录或可审计决策链。
2. Obsidian 是项目长期记忆和审计层，只记录有后续复用价值的稳定结论、关键决策、复杂排查结果、跨 worktree 上下文、任务页或会话索引。普通小改动、一次性问答、简单构建/格式修复默认不强制回写。
3. `文档记录/**/*.md` 是实现文档真源；`db/task_doc_governance/task_rules.json` 是任务与文档映射真源；`db/task_doc_governance/task_doc_governance.sqlite` 是从规则重建得到的查询索引。
4. 当 Codex Memory、Obsidian 记录与仓库内 `AGENTS.md`、`README.md`、`文档记录/**/*.md` 或 `task_rules.json` 冲突时，以仓库内当前文件为准，并在必要时把稳定结论回写到正确层级。
5. 不要把 API key、Bearer token、Cookie、Obsidian REST API 密钥或其他敏感信息写入 Codex Memory、Obsidian 或仓库文件。

## 3. 修改与验证原则

1. 文档变更优先保持与代码现状一致，再考虑补充最佳实践说明。
2. 只改文档时，可不运行构建；但若更新了命令、脚本、入口描述，需至少核对对应源码或脚本仍存在。
3. 改代码时，优先运行目标模块最近文档中声明的最小验证命令，并在回复或记录中说明结果。
4. 若发现文档和代码不一致，以代码、脚本和可运行命令为准，再回写文档。

## 4. Obsidian 持久化记忆

- Vault 路径：`C:\project\obsidian-game\ai-remember`
- Local REST API 地址：`https://127.0.0.1:27124`

默认按并发会话模式处理。Obsidian 回写从“每次任务必写”降级为条件触发：只有满足以下任一条件时才需要写入 Obsidian：

1. 新增或修改技术决策、架构路线、跨 worktree 边界、长期流程规则。
2. 复杂排查产生了可复用的稳定结论、根因、验证命令或风险说明。
3. 任务跨越多个会话、多个 worktree、多个 sub-agent，后续需要从记录中恢复上下文。
4. 用户明确要求记录、回写、同步 Obsidian 或更新长期记忆。
5. 任务页、专题页或会话记录已经存在，本轮结果会改变其状态、结论或下一步。

不满足上述条件时，在最终回复中说明修改路径和验证结果即可，不需要为了形式完整而写 Obsidian。

需要回写时遵守以下规则：

1. 先写各自的会话记录页；如已有任务页，优先更新任务页并在会话记录页里链接。
2. 非汇总会话不要直接修改共享页：`01-当前上下文.md`、模块上下文页、`02-决策日志.md`。
3. 只有稳定结论进入共享页；排查过程、临时判断写会话记录页或任务页。
4. 汇总会话更新共享页时，优先引用对应的任务页和会话记录页，不直接凭记忆改写摘要。
5. 如果无法确认当前是不是并发会话，默认按并发模式处理。

回写内容保持简洁可追踪，按需包括：日期、目标、实际修改路径、关键决策、验证结果、风险、下一步、关联 `task_key`。不要复制完整设计正文或长命令输出到 Obsidian；设计正文应留在 `文档记录/**/*.md`，任务映射应落在 `task_rules.json`。

## 5. SQLite 任务治理

1. `db/task_doc_governance/task_rules.json` 是任务与文档映射真源。
2. `db/task_doc_governance/task_doc_governance.sqlite` 只通过重建生成，不直接手改。
3. 任务粒度、归属、状态或映射变化后，运行 `node tools/task-governance/cli.mjs rebuild`。
4. `文档记录/**/*.md` 是实现文档真源；Obsidian 是记忆层，不替代这些文档。
