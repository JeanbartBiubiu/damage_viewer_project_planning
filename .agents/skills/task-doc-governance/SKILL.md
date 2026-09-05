---
name: task-doc-governance
description: "维护文档记录的 TASK_KEY、任务映射、状态或本地 SQLite 治理索引时使用；普通代码和说明文字修改不使用。"
---

# 任务与文档治理

本技能只处理 `文档记录/**` 的治理元数据、任务映射和本地查询索引。普通代码修改、正文润色或内部实施步骤不需要新增任务、修改文档头或重建索引。

`REPO_ROOT` 表示当前 Git 仓库根目录。共享技能真源位于 `damage_viewer_project_planning/master`；变更从真源提交并推送，其他分支自行获取和合入，不直接改写其他工作树的副本。

## 使用前读取

- `references/sqlite-governance-playbook.md`：操作顺序、诊断和失败处理。
- `<REPO_ROOT>/db/task_doc_governance/document_header.schema.json`：文档头字段及枚举。

## 唯一来源

| 内容 | 真源 |
| --- | --- |
| 任务定义、状态和文档映射 | `db/task_doc_governance/task_rules.json` |
| 文档标识字段 | 对应 Markdown 文档头 |
| 文档头契约 | `db/task_doc_governance/document_header.schema.json` |
| 查询索引 | `db/task_doc_governance/task_doc_governance.sqlite`，仅派生产物 |
| 操作入口 | `tools/task-governance/cli.mjs` |

不得手改 SQLite。Obsidian 和 Codex Memory 只提供补充上下文，不能成为第二份任务状态或映射来源。

## 工作流

1. 确认本次是否真的改变任务粒度、状态、文档归属、路径或文档头。仅改正文时停止治理操作，只检查链接和差异。
2. 读取相关文档标题与内容，按可独立验收的功能确定任务，不因同目录就合并，也不因每个表或接口就拆分。
3. 映射或任务状态变化时先修改 `task_rules.json`；新增、移动或重分类文档时按 schema 维护最小文档头。
4. 运行只读检查：`node tools/task-governance/cli.mjs check`。既有缺失、未归属或非法项与本次变化分开报告，不顺手扩大修复范围。
5. 只有需要刷新查询结果且在任务授权内时运行 `node tools/task-governance/cli.mjs rebuild`。仅在明确需要批量修正文档头时使用 `rebuild --fix-headers`。
6. 需要读回时使用 `node tools/task-governance/cli.mjs tasks` 和 `node tools/task-governance/cli.mjs docs <task_key>`；派生数据库缺失时先按上一步决定是否重建。

## 判断边界

- 文档 `STATUS` 只描述该文档；任务状态只写入 `task_rules.json`。
- `TASK_KEY` 必须与映射一致；`DOC_TYPE` 与目录类型一致；`WORKSTREAM` 与任务归属一致。
- `EXECUTION_MODEL` 记录实际模型或代理路线，不写固定默认值；`LAST_TRACKED_AT` 记录真实维护日期。
- 当前方案与历史评审、执行证据分开；治理索引不证明实现、数据库或运行时状态。

## 交付

说明修改的文件、任务键或映射变化、`check` 结果、是否重建 SQLite、是否运行 `--fix-headers`，以及仍存在但不属于本次范围的治理问题。
