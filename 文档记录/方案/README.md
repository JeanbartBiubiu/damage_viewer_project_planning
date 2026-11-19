TASK_KEY: planning-agent-dev-workflow
DOC_TYPE: 其他
WORKSTREAM: planning
STATUS: tracked
EXECUTION_MODEL: Cursor 执行代理（Claude）
LAST_TRACKED_AT: 2026-11-19

# 方案约定

本目录存放方案角色 `planner`（Antigravity 中的 Gemini）编写、交 Codex 实施的方案。哪些任务需要方案见根 [AGENTS.md](../../AGENTS.md) 第 2 节“工具分工”；本页是方案文件位置、格式、流转和删除的唯一来源。

## 文件与治理

- 路径 `文档记录/方案/<task_key>.md`；同一任务分阶段时用 `<task_key>-<阶段>.md`。
- 文件开头写六字段文档头：`TASK_KEY` 写对应任务键（没有现成任务时拟一个），`DOC_TYPE: 其他`，`WORKSTREAM` 与任务模块一致，`STATUS` 见下文，`EXECUTION_MODEL` 写实际模型（如 Antigravity Gemini Neon），`LAST_TRACKED_AT` 写真实日期。
- 任务映射由 Codex 在提交方案时写入 `db/task_doc_governance/task_rules.json`：在对应任务的 `docs` 中登记方案路径，没有对应任务时新增一个，状态按实际填写，不设 `owner_model`，并运行 `node tools/task-governance/cli.mjs check`。草案期间未登记映射，`check` 报告该文件未归属属于预期。

## 正文

按下列小节编写，没有内容的写“无”：

1. **方案版本**：从 1 开始，每次实质修订加 1。
2. **目标与验收**：可观察的行为和成功标准。
3. **非目标**。
4. **契约**：输入、结果、失败、副作用、拥有者；共享字段与规则的唯一定义来源。
5. **写入范围与实施顺序**：按模块列出路径并标明依赖次序。
6. **校验边界与不做的防御**：输入在哪些契约边界校验一次；明确列出不加的兜底默认值、静默重试、兼容旧格式的分支、重复校验和吞掉的异常。方案未列入的这类代码在验收时按阻塞处理。
7. **验证层次**：单测、实库、真实 Wasm、浏览器等各需哪些证据。
8. **未决问题**。
9. **退回条件**：出现哪些事实时停止实施、退回修订。
10. **偏差记录**：由 Codex 填写。

## 流转

`STATUS` 决定方案状态和唯一写入者，只有 `active` 的当前版本可以实施：

| STATUS | 含义 | 写入者 |
| --- | --- | --- |
| `draft` | 草案：编写或修订中 | planner |
| `active` | 已确认：用户确认的版本 | Codex（只写偏差记录和退回状态） |
| `returned` | 已退回：受影响部分已暂停，等待修订 | planner |

1. planner 在主检出编写 `draft`，只改 `文档记录/方案/` 下的这份文件，不改其他已跟踪文件，不提交。这样主检出的其他快进合入不受影响。
2. 用户在 Antigravity 对话中明确确认后，planner 把 `STATUS` 改为 `active`，并运行 `node agents/coordination.mjs notify manager --from planner --task <task_key>@v<版本> --summary "<摘要>" --ref <方案路径>`。
3. Codex 主负责人在主检出原地提交：记下当前分支，`git switch -c docs/plan-<task_key> master`，补任务映射并运行 `check`，只暂存这份方案和 `task_rules.json` 中本方案的映射并提交；`git switch master`、`git merge --ff-only docs/plan-<task_key>`，删除分支后切回原分支。属于根规则第 2 节第 3 条需要独立评审的方案，先由只读评审代理审查，有阻塞项时按第 4 步退回；通过后从最新 `master` 开实施分支，交付注明所依据的方案版本。
4. 实施中发现改变契约、范围或业务含义的事实时，Codex 停下受影响部分，在“偏差记录”写明事实与证据，把 `STATUS` 改为 `returned`，按第 3 步的方式在主检出原地提交到 `master`，再运行 `node agents/coordination.mjs notify planner --from manager --task <task_key>@v<版本> --summary "<偏差摘要>" --ref <方案路径>`。只调整内部实现不退回。
5. planner 在最新 `master` 副本上修订、升版并改回 `draft`，回到第 2 步。

## 删除

实施验收通过、需要长期保留的定义已落到 `contracts/` 或 `文档记录/` 的对应文档后，Codex 主负责人在验收交付中删除方案文件、移除映射、按实际更新任务状态并运行 `check`。历史从 Git 追溯。
