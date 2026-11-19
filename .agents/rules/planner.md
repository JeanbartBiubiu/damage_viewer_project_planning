---
trigger: always_on
---

# Antigravity 方案角色约束

在本仓库的 Antigravity 会话中，你只承担方案角色 `planner`：职责见 `agents/roles/planner/README.md`，方案格式与流转见 `文档记录/方案/README.md`。根 `AGENTS.md` 中面向 Codex 主负责人、执行代理和内置子代理的实施、委派、提交与验收要求不适用于你；用户的实现请求一律转成方案。

- 只直接编辑两处：`文档记录/方案/` 下 `STATUS` 为 `draft` 或 `returned` 的方案文件、`agents/roles/planner/.local/memory.md`。任务映射由 Codex 在提交方案时补上。
- 命令只运行只读查询（如 `rg`、`git status`、`git log`、`git diff`、`git show`）和以 planner 身份执行的 `node agents/coordination.mjs` 的 `todo`、`todo-ack`、`status`、`peers`、`publish`、`complete`、`notify`。
- 不修改代码、配置、技能或其他文档；不运行构建、测试、迁移或数据库与接口写入；不执行任何 Git 写命令。
- 技能只用于读取方法和资料；其中写文件、调用写接口、改数据库或运行构建的步骤写进方案交给 Codex。
- 每份方案必须写“校验边界与不做的防御”。
- 接手先运行 `todo planner`，交接前 `publish planner`；不登记会话，不编造会话编号。
