# AGENTS.md

## 0. 术语与权限

| 角色 | 含义 | 写权限 |
|------|------|--------|
| **驱动模型** | 主会话主控角色（可由 GPT / opus / glm 等担任）：收敛范围、写 Cursor prompt、review、最终验收 | 纯只读分析/小文档可直接改；代码/脚本/配置默认经 Cursor |
| **Codex-native subagent** | 驱动模型在 Codex 内派发的探索/审查/分析代理 | 默认只读；仅当父任务显式给出**互不重叠**的写入集，且仓库流程允许该产物类型时才可写 |
| **顶层 Cursor local agent** | 驱动模型通过 SDK/runner **显式创建**的受限方案评审或编码执行体 | 方案评审模式只读且要求 run delta 为零；编码执行模式仅在 prompt 允许写入范围内写；固定 `grok-4.6` + `effort=high` + `fast=false` |
| **Cursor internal task/subagent/explore** | 顶层 Cursor agent 在其会话内的有界委派 | 继承顶层 prompt 边界；顶层 agent 对其产出负责；**不适用**上述固定 grok 合同（合同只约束显式创建的顶层 agent） |

硬约束：

1. Codex-native subagent **不得**绕过强制 Cursor 代码/脚本/配置流程去直接改业务实现。
2. 仅把**独立、有界**的分支委派出去；不要把琐碎或必须串行的工作扇出。主线程保留集成与最终验证。
3. `grok-4.6` + `effort=high` + `fast=false` **只**适用于显式创建的顶层 Cursor local agent。
4. **planning / master** 上的本文件、共享 `.agents/skills/**`、`tools/task-governance/**`、`tools/agent-governance/**`、`db/task_doc_governance/task_rules.json` 为跨 worktree 协作真源；长寿模块分支应 merge/cherry-pick，不要手抄分叉副本。

## 1. 全局协作底线

1. 每次新起对话，先识别当前 worktree 根目录和 Git 分支；如果普通 `git` 被 safe.directory 拦截，可用一次性 `git -c safe.directory=<repo> ...` 读取状态，不要为了读取状态改全局配置。
2. 修改前先读取目标路径最近一层 `AGENTS.md`、相关 `README.md` 和构建/验证脚本；更近层规则优先于本文件。
3. 复杂任务优先委派给 Codex-native subagent 做探索/审查/分析，避免主会话上下文膨胀；分配时明确读写范围，避免交叉覆盖。见 §0。
4. 不要把 API key、Bearer token、Cookie、Obsidian REST API 密钥或其他密钥写入仓库、Codex Memory 或 Obsidian。
5. 优先做最小必要改动，避免跨模块顺手重构；发现无关脏改时不要回滚，除非用户明确要求。
6. 只改文档时通常不需要运行构建；如果文档更新了命令、脚本、入口或路径，至少核对对应文件仍存在。
7. 当前 worktree 已初始化 `.codegraph/`。涉及源码符号搜索、调用链、引用解析、影响面分析、跨层入口定位或先建立代码地图时，优先使用 `npx @colbymchenry/codegraph query|callers|callees|impact`；`context` 只在问题范围已收敛、需要为 AI 组装小段实现上下文时使用，不要一上来生成大段无边界 `context`，也不要先在源码里用 `grep`/`rg` 盲扫符号名。得到候选链路后仍要回源码定点核对；大改后、跨 worktree 切换后或结果可疑时先 `codegraph status`/`sync`；`.codegraph/*.db*` 等本地索引产物不入库。
8. `rg` / `rg --files` 仍用于精确文本匹配、文件名检索，以及 `Markdown/SQL/XML/YAML/JSON/日志/生成物/配置` 等 CodeGraph 不能可靠建图的内容；核对字面量、报错文本、HTTP 路径、注释、文档原文，或最终确认具体 callsite / state 写入点时，同样优先用 `rg`、`Select-String` 或定点读文件。若 CodeGraph 或 sub-agent 查询长时间无返回、输出过量，主动缩小问题并切回 `rg` / 定点读文件，不要为“全程只用 CodeGraph”无限等待。
9. 读取协作规则时忽略生成目录和依赖目录里的副本，例如 `target/`、`dist/`、`build/`、`node_modules/`、`.codegraph/`、`output/`；这些位置里的 `AGENTS.md`、`README.md` 或脚本说明不是规则真源，除非用户明确要求检查生成产物。
10. Codex skill 通常只预加载 `name` / `description` 元数据，正文按需读取。不要仅因担心上下文占用而删除 skill；优先收窄 description、保持项目级 `.agents/skills` 为真源，并让用户级副本与项目真源同步或明确只作转发。
11. 新增或修改 skill 时先使用 `writing-skills` 做轻量压力场景或基线检查；机械同步副本时至少说明真源和同步范围。

## 2. Cursor 开发流程（强制）

以下规则用于所有“要落代码/脚本/配置改动”的开发任务；纯只读分析、纯文档小改不强制走 Cursor。

1. 开发任务默认先走 Cursor 协同流程；驱动模型不得在主会话里未经收敛就直接改代码，偏离该流程须有用户明确许可。「驱动模型」是角色，可由 GPT / opus / glm 等任一当前可用的会话主模型担任。
2. `goal`、需求描述或任务页只定义目标与范围。驱动模型先从代码库、最近层 `AGENTS.md`、`README.md`、脚本和现有文档自行收敛；只有本地无法确定时，才一次向用户提一个问题并给推荐答案。
3. 非机械开发任务在编码前必须通过“方案共识门禁”：凡存在技术取舍、跨模块/接口/Schema/ABI/迁移/权限影响，或驱动模型仍保留会影响实现的假设，驱动模型必须先形成带版本的候选方案并交顶层 Cursor local agent 做只读方案评审。仅当实现路径唯一、无契约或外部行为变化、写入范围与验证命令已明确、且不存在影响实现的假设时，才可按纯机械小改跳过；驱动模型必须记录 `SKIP_DESIGN_REVIEW` 理由及仓库证据。
4. 顶层 Cursor local agent 必须显式声明模式。`DESIGN_REVIEW_ONLY` 只检查实现可行性、遗漏影响面、矛盾和不明确点，不得创建、修改或删除文件，并按 `READY | REVISE | BLOCKED` 返回带仓库证据的问题清单；即使 allowlist 审计通过，只要本轮 `runDeltaCount != 0`，事件日志显示发生过文件写入/删除/重命名后又恢复，或事件日志缺失、不可解析、关键工具事件被截断，该次方案评审仍无效。`IMPLEMENTATION` 只执行已冻结方案，不负责自行扩写需求、扩大范围或替代最终验收。
5. 驱动模型逐项将评审意见标记为 `ACCEPT | REJECT | NEED_USER`，给出证据或方案修改，并用完整最新方案复审；先自行补查仓库，只有本地无法决策时才向用户提一个问题。只有 Cursor 返回 `READY`、驱动模型无未关闭项、无待用户决策、方案版本已冻结，且目标、非目标、契约、写入范围、验证命令和停止条件齐全时，才允许进入编码。连续三轮仍未收敛，或同一阻塞点连续两轮没有新证据时，必须停止文字往返并报告阻塞。
6. 编码执行必须新建 Cursor run，仅发送冻结后的最终方案、允许写入范围、非目标、验证命令和停止条件；不得把未决讨论或已废弃方案交给编码执行体。高风险任务可在冻结前增加一次新会话的只读冷评审。
7. 通过 SDK / local agent **显式创建顶层 Cursor agent** 时，模型选择、接线、runner 和 smoke 规则见 `.agents/skills/cursor-local-agent/SKILL.md`（固定 `grok-4.6` + `effort=high` + `fast=false`，不得用裸 `grok-4.6`、`composer-latest`/`composer`/`composer-2.5`/`composer-2.5-fast`）。顶层 agent 内部的 Cursor task/subagent/explore 委派允许在有界 prompt 内进行，由顶层 agent 对产出负责。
8. 驱动模型每轮先检查 Cursor 产物、事件日志和 `git diff` 再 review；即使 `status=error` 也要先看 diff。编码执行的写入范围审计是 **fail-closed 的审计型 allowlist**（非 OS sandbox）：按运行前后路径签名计算 **run delta**，仅当本次运行导致的越界变更（或审计不可用）时 runner 非零退出且保留产物；未再改动的既有脏文件不单独导致失败。最终验证由驱动模型亲自完成，可自动化项不得交用户；若 Cursor 链路、权限、环境或验证异常，先报告阻塞，除非用户明确同意，否则不退回“驱动模型直接改代码”。验收细则见 `.\文档记录\详细设计\Cursor协同开发流程说明.md`。

流程说明真源见 `.\文档记录\详细设计\Cursor协同开发流程说明.md`。

## 3. 渐进式披露与 worktree 路由

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
5. 根 `AGENTS.md` 只保留跨 worktree 的协作底线、路由和治理摘要；Backend、Web、Wasm/TinyGo 的入口地图、命令、运行时、验证和技术路线细节由各模块 `AGENTS.md` / `README.md` 承接，不在根文件重复。
6. 跨 worktree 共享治理文件漂移检查（只读）：`node tools/agent-governance/cli.mjs check`。

## 4. 记忆与治理边界

当前同时使用 Codex Memory、Obsidian 和本仓库 SQLite 任务治理，三者职责不同：

1. Codex Memory 只保存高层协作偏好、长期技术路线和常见约束，不保存精确模板、大段原文、完整命令输出或可审计任务记录。
2. Obsidian 是长期记忆和审计层，只在出现稳定决策、复杂排查结论、跨 worktree 上下文、任务页状态变化，或用户明确要求记录时回写；回写时优先写会话记录页或既有任务页，非汇总会话不要直接修改共享上下文页。
3. `文档记录/**/*.md` 是实现文档真源；`db/task_doc_governance/task_rules.json` 是任务与文档映射及任务状态的**唯一**真源；`db/task_doc_governance/task_doc_governance.sqlite` 只是从规则重建得到的查询索引、不直接手改；Markdown 文档头用于标识文档，**不**替代映射。文档头契约见 `db/task_doc_governance/document_header.schema.json`。默认只读检查：`node tools/task-governance/cli.mjs check`；仅显式 `rebuild` 写 SQLite，仅显式 `rebuild --fix-headers` 可改 Markdown 头。
4. 当 Codex Memory、Obsidian 与仓库内 `AGENTS.md`、`README.md`、`文档记录/**/*.md` 或 `task_rules.json` 冲突时，以仓库当前文件为准。
