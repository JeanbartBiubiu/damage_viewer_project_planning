TASK_KEY: pending
DOC_TYPE: 详细设计
WORKSTREAM: docs
STATUS: draft
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: pending

# SQLite任务文档治理方案

## 目标

把任务治理的结构化真源固定在本地 SQLite 体系上，不再依赖外部任务平台作为项目内的主索引。

## 设计原则

1. `task_rules.json` 是任务与文档映射规则真源。
2. `task_doc_governance.sqlite` 是重建产物，不手工编辑。
3. `文档记录/**/*.md` 是实现文档真源。
4. 任务粒度按功能交付拆分，不按文件夹粗分。
5. Obsidian 负责上下文记忆和会话沉淀，不负责替代 SQLite 的结构化任务治理。

## 落地位置

- SQLite schema: `db/task_doc_governance/schema.sql`
- task 规则: `db/task_doc_governance/task_rules.json`
- SQLite 文件: `db/task_doc_governance/task_doc_governance.sqlite`
- CLI: `tools/task-governance/cli.mjs`

## 职责边界

### SQLite 负责什么

- `task_key`
- 任务归属
- 文档映射
- 任务状态
- 结构化查询

### Obsidian 负责什么

- 项目上下文
- 决策日志
- 会话记录
- 人工可读索引
- 下一步建议

### 不允许的做法

1. 不要在 Obsidian 里维护另一套独立的任务真源。
2. 不要手工修改 `task_doc_governance.sqlite`。
3. 不要让 Obsidian 中的任务状态与 `task_rules.json` 长期不一致。

## 表结构

### `tasks`

- `task_key`: 稳定主键，例如 `wasm-shield-mechanism`
- `title`: 人类可读标题
- `module`: `planning / web / server / wasm`
- `feature`: 机器可读功能标识
- `status`: `未开始 / 开发中 / 已完成`
- `priority`: 数字优先级
- `owner_model`: 生成或维护该记录的模型
- `completion_note`: 完成说明

### `docs`

- `local_path`: 文档相对路径
- `title`: 文档标题
- `doc_type`: 需求澄清 / 概要设计 / 详细设计 / 测试记录 / 任务单 / 其他
- `module`: 与任务对齐的模块
- `task_key`: 文档归属任务
- `execution_model`: 最近一次治理时使用的模型
- `last_tracked_at`: 最近一次治理时间

## 文档头规则

```md
TASK_KEY: wasm-shield-mechanism
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: pending
```

说明：

- `TASK_KEY` 是本地治理主键。
- `STATUS` 只表示文档治理状态，不等于功能是否完成。

## 使用方式

先安装依赖：

```powershell
npm install --prefix tools/task-governance
```

重建数据库并同步文档头：

```powershell
node tools/task-governance/cli.mjs rebuild
```

查看任务摘要：

```powershell
node tools/task-governance/cli.mjs tasks
```

查看某个任务挂了哪些文档：

```powershell
node tools/task-governance/cli.mjs docs wasm-shield-mechanism
```

## 更新规则

### 需要改 SQLite 任务治理时

适用于：

- 调整任务粒度
- 修改任务归属
- 增减文档映射
- 更正任务状态

流程：

1. 先改 `db/task_doc_governance/task_rules.json`
2. 再执行 `node tools/task-governance/cli.mjs rebuild`
3. 最后用 `tasks` 和 `docs <task_key>` 验证

### 只需要改 Obsidian 时

适用于：

- 记录项目背景
- 补决策过程
- 补会话总结
- 补下一步建议

这类更新不需要改 SQLite 任务治理数据。

## 当前导入策略

1. 通过 `task_rules.json` 显式把文档映射到功能任务。
2. 跨功能的测试与回归文档优先收敛到专门的验证任务。
3. 尚未实现的机制直接标记为 `未开始`。
4. 已有实现和验证证据的机制才标记为 `已完成`。

## 迁移结论

1. 本地任务治理以 SQLite-first 为准。
2. Obsidian 与 SQLite 可以并存，但不应争夺真源。
3. 以后如果要对接别的任务系统，也应由 SQLite 向外映射，而不是反向让外部系统定义本地任务结构。
