TASK_KEY: planning-cursor-agent-dev-workflow
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-06-03 17:03:14

# Cursor-GPT协同开发流程说明

1. `goal` 文档只定义目标与范围，不覆盖流程。
2. GPT 先把任务当决策树逐枝收敛：能从代码库、`AGENTS.md`、`README`、脚本回答的问题先自己查；查不到再一次只问用户一个问题，并给推荐答案。
3. 分支收敛后，GPT 再写 Cursor prompt，必须包含目标、写入范围、非目标、验证命令、停止条件；Cursor 固定 `composer-2.5` + `fast=false`，且只负责编码。
4. GPT 每轮先看 diff/日志再 review；最终由 GPT 亲自测试、Playwright 验证并交人工验收。分支未收敛、权限或环境异常时，不得继续推进。
