TASK_KEY: planning-cursor-agent-dev-workflow
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: draft
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-05-23

# Cursor-GPT协同开发流程说明

本文定义后续新功能开发时的代理协作流程：GPT 负责任务拆解、技术任务说明、代码审查、测试验证和人工验收交接；Cursor 只作为本地代码开发执行器。

## 1. 目标

建立一条可重复的开发闭环：

```text
GPT 编写技术任务说明
-> 调用 Cursor 本地 agent 执行开发
-> GPT 审查 diff 和执行记录
-> 有问题则打回 Cursor 修复
-> 循环到无阻塞问题
-> GPT 使用测试命令和 Playwright 验证
-> 人工介入做最终验收
```

该流程的核心约束是：Cursor 负责编码，GPT 负责判断。Cursor 的结果不能自证通过，必须经过 GPT review、测试验证和人工验收 gate。

## 2. 角色边界

### 2.1 GPT 编排者

GPT 是流程 owner，负责：

1. 读取目标 worktree 的 `AGENTS.md`、README、相关设计和测试脚本。
2. 将用户需求转成可执行的技术任务说明。
3. 调用 Cursor 本地 agent，并明确写入范围、非目标和停止条件。
4. 收集 Cursor 的执行结果、transcript、`git diff` 和命令输出。
5. 对 Cursor 的改动做代码 review。
6. 将 review findings 转成下一轮 Cursor fix prompt。
7. 在改动收敛后运行测试、构建和 Playwright 验证。
8. 输出人工验收所需的变更摘要、验证证据和风险清单。

GPT 不把 review 职责交给 Cursor，不接受 Cursor 自述“已完成”作为完成证据。

### 2.2 Cursor 本地开发 agent

Cursor 只负责在指定 worktree 内执行开发任务：

1. 遵守指定路径的 `AGENTS.md` 和 README。
2. 只修改 GPT 指定的写入范围。
3. 不回滚用户或其他 agent 的无关改动。
4. 不私自扩大功能范围或做顺手重构。
5. 发现需求、契约、数据或环境不确定时停止并报告。
6. 返回实际改动、验证命令、失败原因和剩余风险。

Cursor 调用必须使用 `@cursor/sdk` 本地 agent，不依赖 Cursor IDE 聊天历史 UI 作为证据入口。

### 2.3 人工验收者

人工只在关键 gate 介入：

1. 需求不明确或存在产品取舍时。
2. 需要确认视觉、交互、业务口径或游戏侧真实行为时。
3. 自动测试和 Playwright 通过后，做最终验收。
4. GPT 明确标记风险或残留问题时做 go/no-go 判断。

## 3. Cursor 调用硬约束

Cursor 模型只允许使用 `composer-2.5`，并必须显式关闭 Fast：

```ts
model: {
  id: "composer-2.5",
  params: [{ id: "fast", value: "false" }],
}
```

禁止使用：

1. `composer-latest`
2. `composer`
3. `model: { id: "composer-2.5" }`

原因：`composer-2.5` 的默认 variant 是 `fast=true`，如果不显式传 `params`，账单侧会显示为 `composer-2.5-fast`。

调用时还必须：

1. 显式传入 `apiKey`，不要只依赖 `process.env.CURSOR_API_KEY`。
2. `cwd` 指向真实目标 worktree，不要误指到临时目录或 Codex 隔离 worktree。
3. 记录 `agentId`、`runId`、`cwd`、`model`、prompt、原始 status 序列，并持久化事件日志。
4. 如果 SDK 提供 transcript、artifact 或 conversation 线索，一并记录路径或清单。
5. 不打印 API key、Bearer token、Cookie 或其他密钥。
6. 真实任务执行前先跑 preflight，至少检查 Node runtime、`CURSOR_USE_HTTP1`、`CURSOR_API_KEY`、`@cursor/sdk` 可解析性，以及是否真的存在可编排的 CLI fallback。

本地调用规则以仓库内 skill 为准：

```text
.\.agents\skills\cursor-local-agent\SKILL.md
```

## 4. 标准开发流程

### 4.1 Intake：需求进入

GPT 收到用户需求后先判断：

1. 目标 worktree 是 planning、web、server 还是 wasm。
2. 当前需求是否足够明确。
3. 是否涉及高风险操作，例如数据库迁移、删除数据、发布、外部服务、账号密钥或大范围重构。
4. 是否需要先写需求澄清、概要设计或详细设计。

如果需求不明确，或存在互斥方案，GPT 必须先打断并让人判断，不得把模糊需求直接交给 Cursor。

### 4.2 GPT 编写技术任务说明

每次交给 Cursor 的任务说明必须包含：

1. 目标：本轮要交付的可观察行为。
2. 写入范围：允许修改的目录和文件类型。
3. 只读参考：必须先读的 `AGENTS.md`、README、设计文档、接口和测试。
4. 非目标：明确禁止顺手做的扩展。
5. 现有脏改规则：不得回滚用户或其他 agent 的无关改动。
6. 验证命令：本轮期望 Cursor 自测哪些命令。
7. 停止条件：遇到哪些问题必须停止并返回 GPT。
8. 汇报格式：列出改动文件、验证结果、失败项和风险。
9. 如果使用标准 runner，要求落标准产物目录：`prompt.txt`、`summary.json`、`events.jsonl`、`diff.patch`、`review.md`。

### 4.3 Cursor 执行开发

GPT 调用 Cursor 后，Cursor 在指定 worktree 内完成开发。Cursor 可以读取和修改文件，但不能把“通过”结论直接写入最终验收。

如果 Cursor 返回失败、部分完成或风险提示，GPT 必须先判断失败是否属于：

1. 需求或业务口径不清。
2. 技术契约缺失。
3. 环境或依赖问题。
4. Cursor 实现错误。
5. 任务范围过大。

只有第 4 类才直接进入 Cursor fix；前 1 到 3 类优先由 GPT 查证或打断让人介入。

补充规则：

1. Cursor run 的 `status=error` 只表示本轮没有干净收敛，不表示“没有落代码”。
2. 只要 Cursor 实际执行过写入任务，GPT 都必须先检查 worktree diff、事件日志和生成文件，再判断是 fix loop 还是按无改动处理。
3. 不能把 “run 失败” 直接等价成 “本轮无产物”。

### 4.4 GPT Review

Cursor 完成一轮后，GPT 必须检查：

1. 无论 Cursor run 最终状态是 `finished` 还是 `error`，都先检查 `git diff` 是否只包含本轮范围。
2. 是否违反 `AGENTS.md`、README 或既有架构约束。
3. 是否引入兼容性风险、数据契约风险或 UI 回归。
4. 是否缺少测试、构建或页面验证。
5. 是否有未说明的失败命令。
6. 是否留下调试代码、临时文件、密钥或无关重构。

Review 输出按严重级别组织，优先指出阻塞项。没有阻塞项时，明确写出“未发现阻塞 review 问题”，但仍需进入测试验证。

### 4.5 Fix Loop

如果 GPT review 发现问题：

1. GPT 将 findings 转成精确 fix prompt。
2. Cursor 只修复 findings，不扩大任务范围。
3. Cursor fix 后 GPT 再次 review。
4. 循环直到没有阻塞问题，或触发人工介入条件。

默认最多连续 3 轮 Cursor fix。超过 3 轮仍未收敛时，GPT 停止自动循环，向用户报告当前差异、阻塞原因和建议取舍。

### 4.6 GPT 测试与 Playwright 验证

当 review 无阻塞问题后，GPT 负责最终自动验证：

1. 先按依赖顺序执行构建、发布、生成和刷新步骤，再执行消费这些产物的 smoke / E2E；不要把存在前后依赖的验证并行化。
2. 运行最近层 `AGENTS.md` / README 要求的构建、单测和 smoke 命令。
3. 如果验证目标涉及 published bundle 契约变化，先 fresh republish，再以这次新发布的版本或 snapshot 作为验收权威；不要拿历史旧 snapshot 判定新契约。
4. 如果验证目标涉及 TinyGo / wasm 产物，先完成 TinyGo rebuild，再执行 Node smoke 或页面验证；不要对旧产物做 smoke。
5. 浏览器 E2E 前先检查目标端口是否被旧服务占用；必要时清理旧进程或改用新端口，并记录实际 URL。证据采集后关闭本轮临时启动的服务。
6. 如果 SDK preflight 失败，不要默认认为可以直接切 Cursor CLI。先验证当前环境是否真的有可编排的 `cursor-agent` 二进制，以及 CLI 是否能满足模型约束；不能验证时按 blocked 处理。
7. 对前端或页面流程使用 Playwright 做真实浏览器验证。
8. 对页面变更截屏或导出关键 DOM、请求、控制台证据。
9. 对后端接口变更检查 API 响应、错误码和兼容字段。
10. 对 wasm 或验证页变更检查 wasm 输出、页面证据和测试记录。

Cursor 自测可以作为参考，但不能替代 GPT 这一轮验证。

### 4.7 人工验收

GPT 自动验证通过后，输出人工验收包：

1. 改动文件列表。
2. 需求到实现的对应关系。
3. Review 循环次数和最终结论。
4. 每轮 Cursor 的 `agentId` / `runId` / `cwd` / `model` / 原始 status 摘要，以及事件日志或 transcript / artifact 线索。
5. 运行过的命令、执行顺序和结果。
6. Playwright 验证入口、实际 URL、截图或导出证据。
7. 未覆盖风险。
8. 需要人工判断的验收项。

人工验收通过后，本功能才算完成。若人工验收发现问题，回到 `4.5 Fix Loop`。

## 5. 主动打断条件

出现以下任一情况，GPT 必须停止自动推进并请求人工判断：

1. 用户需求存在多种合理解释，且选择会影响架构或用户体验。
2. Cursor 需要修改未授权的 worktree、目录或数据表。
3. 需要删除、重命名、批量迁移或发布生产数据。
4. 需要密钥、账号权限、外部服务配置或人工登录。
5. 当前仓库存在与本任务冲突的未提交改动。
6. Cursor 试图使用 `composer-2.5-fast` 或模型参数不可验证。
7. 第三轮 fix 后仍有阻塞问题。
8. 测试失败原因不是实现错误，而是环境、依赖或需求口径不明。
9. Playwright 验证需要人工视觉判断，或页面行为无法由自动化可靠判断。
10. 发现安全、权限、数据破坏、成本异常或合规风险。

打断时必须给出：

1. 当前已完成内容。
2. 阻塞事实和证据。
3. 可选方案。
4. GPT 推荐方案。
5. 继续前需要用户确认的问题。

## 6. 记录与证据

每个自动开发闭环至少保留以下记录：

1. 用户原始需求。
2. GPT 技术任务说明。
3. Cursor `agentId` / `runId` / `cwd` / `model`。
4. Cursor 原始 status 序列、事件日志，以及 transcript / artifact 路径或清单（如果可得）。
5. 每轮 `git diff` 摘要；即使 Cursor run 最终是 `error`，也不能省略这一项。
6. GPT review findings。
7. Cursor fix prompt 和结果。
8. GPT 最终验证命令、执行顺序、Playwright 证据和结论。
9. 人工验收结论。

不记录密钥、Cookie、Bearer token、完整账号凭据或无法脱敏的私密数据。

## 6.2 标准产物目录

如果本轮使用标准 Cursor runner，至少生成以下产物：

1. `prompt.txt`：本轮发给 Cursor 的原始 prompt。
2. `summary.json`：结构化元数据、preflight、agent/run 标识、结果状态、warnings/blocking。
3. `events.jsonl`：原始事件流或等价逐行记录。
4. `diff.patch`：按允许写入范围导出的 scoped patch；如果允许路径在运行前已脏，必须显式标记“不是纯 per-run delta”。
5. `review.md`：供 GPT review / fix loop / 验收整理使用的工作底稿。

可选附加产物：

1. `preflight.md`
2. `git-status-before.txt`
3. `git-status-after.txt`
4. CLI fallback 的 `stderr` 日志

## 6.1 常见假信号

以下现象不能直接当作结论：

1. **Cursor run `status=error`**：可能已经落下部分有效代码，先看 diff 和验证结果。
2. **历史 published snapshot 字段不对**：如果本轮改的是发布契约，先 fresh republish，再看新版本，不要让旧 snapshot 混淆判断。
3. **浏览器端口被占用**：这通常是旧服务残留，不是新代码自动失败的直接证据。
4. **Node smoke 命中旧 wasm 产物**：如果 TinyGo rebuild 还没完成，smoke 结论无效。

## 7. 完成定义

新功能只有同时满足以下条件才算开发完成：

1. Cursor 使用 `composer-2.5` 且 `fast=false` 完成开发。
2. GPT review 没有阻塞问题，且 review 覆盖了 Cursor 本轮实际 diff。
3. 每轮 Cursor 调用的关键证据已留存：prompt、`agentId`、`runId`、status、事件日志或等价记录。
4. 所有约定测试、构建或 smoke 命令已按依赖顺序运行并通过，或失败原因已被明确接受。
5. 前端相关改动已经通过 Playwright 验证。
6. 变更范围与用户需求一致，没有无关重构。
7. 验收包已交给人工。
8. 人工验收通过。

如果只完成到 GPT 自动验证，还不能标记为“人工验收完成”。
