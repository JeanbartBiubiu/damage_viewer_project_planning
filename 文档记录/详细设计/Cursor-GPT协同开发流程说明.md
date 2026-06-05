TASK_KEY: planning-cursor-agent-dev-workflow
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-06-04

# Cursor-GPT协同开发流程说明

1. `goal` 文档只定义目标与范围，不覆盖流程。
2. GPT 先把任务当决策树逐枝收敛：能从代码库、`AGENTS.md`、`README`、脚本回答的问题先自己查；查不到再一次只问用户一个问题，并给推荐答案。
3. 分支收敛后，GPT 再写 Cursor prompt，必须包含目标、写入范围、非目标、验证命令、停止条件；Cursor 固定 `composer-2.5` + `fast=false`，且只负责编码。
4. GPT 每轮先看 diff/日志再 review；最终由 GPT 亲自完成命令级测试和本地服务探测。
5. 涉及页面、联调或用户流时，GPT 默认先自行启动或复用后端/前端，再用 Playwright 走完整验证路径，并记录 route、操作、关键断言、截图或导出证据；不得把可自动化页面验收直接交给用户。
6. 只有 Playwright 无法覆盖的外部条件才交用户：游戏客户端实测、OCR/人工读数确认、登录/验证码、权限密钥、设备/网络侧操作，或必须由用户手动启动的本机服务。交接时必须列清 GPT 已验证内容和用户只需确认的剩余项。
7. 分支未收敛、权限或环境异常时，不得继续推进。
