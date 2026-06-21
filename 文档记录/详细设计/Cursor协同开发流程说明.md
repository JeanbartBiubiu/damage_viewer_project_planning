TASK_KEY: planning-cursor-agent-dev-workflow
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: tracked
EXECUTION_MODEL: multi-model
LAST_TRACKED_AT: 2026-06-04

# Cursor 协同开发流程说明

> 本流程的「驱动模型」是一个角色，可由 GPT / opus / glm 等任一当前可用的会话主模型担任；Cursor 侧固定 `composer-2.5` + `fast=false`，与驱动模型是谁无关。下文「驱动模型」均指代该角色。

1. `goal` 文档只定义目标与范围，不覆盖流程。
2. 驱动模型先把任务当决策树逐枝收敛：能从代码库、`AGENTS.md`、`README`、脚本回答的问题先自己查；查不到再一次只问用户一个问题，并给推荐答案。
3. 分支收敛后，驱动模型再写 Cursor prompt，必须包含目标、写入范围、非目标、验证命令、停止条件；Cursor 固定 `composer-2.5` + `fast=false`，且只负责编码。
4. 驱动模型每轮先看 diff/日志再 review；最终由驱动模型亲自完成命令级测试和本地服务探测。
5. 涉及页面、联调或用户流时，驱动模型默认先自行启动或复用后端/前端，再用 Playwright 走完整验证路径，并记录 route、操作、关键断言、截图或导出证据；不得把可自动化页面验收直接交给用户。
6. 只有 Playwright 无法覆盖的外部条件才交用户：游戏客户端实测、OCR/人工读数确认、登录/验证码、权限密钥、设备/网络侧操作，或必须由用户手动启动的本机服务。交接时必须列清驱动模型已验证内容和用户只需确认的剩余项。
7. 分支未收敛、权限或环境异常时，不得继续推进。
