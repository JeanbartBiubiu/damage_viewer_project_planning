TASK_KEY: archived-governance-notes
DOC_TYPE: 详细设计
WORKSTREAM: docs
STATUS: archived
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-04-03T00:00:00+08:00

# 任务与文档治理子 Agent 方案

这份文档对应的是早期的外部联动方案，现已归档。

当前项目已经切换到 SQLite-first 本地治理：

- 任务真源：`db/task_doc_governance/task_doc_governance.sqlite`
- 任务映射：`db/task_doc_governance/task_rules.json`
- 重建入口：`node tools/task-governance/cli.mjs rebuild`
- 当前标准说明：[SQLite任务文档治理方案.md](C:/project/damage_viewer_project_planning/文档记录/详细设计/SQLite任务文档治理方案.md)

后续如需调整 task 粒度、文档归类或状态，统一修改 `task_rules.json` 并重跑 `rebuild`，不再参考旧的 Notion relation 设计。
