TASK_KEY: pending
DOC_TYPE: 详细设计
WORKSTREAM: docs
STATUS: draft
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: pending

# SQLite 任务文档治理方案

## 目标

把任务治理的真源固定为本地 SQLite，不再依赖 Notion、MCP 或插件能力。

## 设计原则

- `SQLite` 是唯一真源。
- `文档记录/**/*.md` 是事实输入，文档头只保留最小可解析元数据。
- task 粒度按功能实现拆分，例如 `wasm-shield-mechanism`、`wasm-move-speed-mechanism`，而不是按文档目录粗分。

## 落地位置

- SQLite schema: `db/task_doc_governance/schema.sql`
- task 规则: `db/task_doc_governance/task_rules.json`
- SQLite 文件: `db/task_doc_governance/task_doc_governance.sqlite`
- CLI: `tools/task-governance/cli.mjs`

## 表结构

### `tasks`

- `task_key`: 稳定主键，例如 `wasm-shield-mechanism`
- `title`: 人类可读标题
- `module`: `planning/web/server/wasm`
- `feature`: 机器可读功能标识
- `status`: `未开始/进行中/完成`
- `priority`: 数字优先级
- `owner_model`: 生成或维护该条记录的模型
- `completion_note`: 完成说明

### `docs`

- `local_path`: 文档相对路径，唯一
- `title`: 从 H1 或文件名解析
- `doc_type`: `需求澄清/概要设计/详细设计/测试记录/任务单`
- `module`: 与 task 对齐
- `task_key`: 归属功能任务
- `execution_model`: 最近一次治理时使用的模型
- `last_tracked_at`: 最近一次本地治理时间

## 文档头约定

```md
TASK_KEY: wasm-shield-mechanism
DOC_TYPE: 概要设计
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: pending
```

说明：

- `TASK_KEY` 是本地治理的主字段。
- `STATUS` 用于标记文档已纳入治理，不表达外部同步状态。

## 使用方式

先安装依赖：

```powershell
npm install --prefix tools/task-governance
```

重建数据库并同步文档头：

```powershell
node tools/task-governance/cli.mjs rebuild
```

查看 task 摘要：

```powershell
node tools/task-governance/cli.mjs tasks
```

查看某个 task 挂了哪些文档：

```powershell
node tools/task-governance/cli.mjs docs wasm-shield-mechanism
```

## 当前导入策略

- 通过 `task_rules.json` 明确把文档映射到功能 task。
- 对于跨多个功能的测试与回归文档，先收敛到专门的验证 task，例如 `wasm-benchmark-regression`。
- 对于尚未实现的机制，task 状态直接记为 `未开始`。
- 对于代码和测试都已存在的机制，task 状态可直接记为 `完成`。

## 迁移结论

- 旧的 Notion 兼容字段已退出主流程。
- 新的本地关系通过 `TASK_KEY` + SQLite 数据库表达。
- 后续如果还要对接别的任务系统，也应由 SQLite 向外做映射，而不是反过来。
