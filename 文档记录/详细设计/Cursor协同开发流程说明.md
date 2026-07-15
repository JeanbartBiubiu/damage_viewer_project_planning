TASK_KEY: planning-cursor-agent-dev-workflow
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: tracked
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-07-15

# Cursor 协同开发流程说明

> 角色定义见根 `AGENTS.md` §0。「驱动模型」是角色，可由 GPT / opus / glm 等担任；**顶层** Cursor local agent 固定 `grok-4.5` + `effort=high` + `fast=false`。Cursor 内部 task/subagent/explore 委派继承顶层 prompt 边界，由顶层 agent 对产出负责，不适用该固定 grok 合同。Codex-native subagent 默认探索/审查/分析，不得绕过本流程直接改代码/脚本/配置。

1. `goal` 文档只定义目标与范围，不覆盖流程。
2. 驱动模型先把任务当决策树逐枝收敛：能从代码库、`AGENTS.md`、`README`、脚本回答的问题先自己查；查不到再一次只问用户一个问题，并给推荐答案。独立有界分支可交给 Codex-native subagent；主线程保留集成与最终验证。
3. 分支收敛后，驱动模型再写 Cursor prompt，必须包含目标、写入范围、非目标、验证命令、停止条件；通过 SDK/runner **显式创建**顶层 Cursor agent，固定 `grok-4.5` + `effort=high` + `fast=false`，且只负责编码。`--allowed-path` 是审计型写入 allowlist（fail-closed），不是 OS sandbox。
4. 驱动模型每轮先看产物（含 `summary.json` / `review.md` 中的越界路径分类）、diff/日志再 review；最终由驱动模型亲自完成命令级测试和本地服务探测。
5. 涉及页面、联调或用户流时，驱动模型默认先自行启动或复用后端/前端，再用 Playwright 走完整验证路径，并记录 route、操作、关键断言、截图或导出证据；不得把可自动化页面验收直接交给用户。
6. 只有 Playwright 无法覆盖的外部条件才交用户：游戏客户端实测、OCR/人工读数确认、登录/验证码、权限密钥、设备/网络侧操作，或必须由用户手动启动的本机服务。交接时必须列清驱动模型已验证内容和用户只需确认的剩余项。
7. 分支未收敛、权限或环境异常时，不得继续推进。

接线与 runner 操作真源：`.agents/skills/cursor-local-agent/SKILL.md`（本文件只定决策与验收，不重复 runner 实现）。
