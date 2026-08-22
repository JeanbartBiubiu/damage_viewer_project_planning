TASK_KEY: planning-cursor-agent-dev-workflow
DOC_TYPE: 详细设计
WORKSTREAM: planning
STATUS: tracked
EXECUTION_MODEL: Cursor grok-4.5 + GPT-5
LAST_TRACKED_AT: 2026-08-22

# Cursor 协同开发流程说明

> 角色定义见根 `AGENTS.md` §0。「驱动模型」是角色，可由 GPT / opus / glm 等担任；**顶层** Cursor local agent 固定 `grok-4.6` + `effort=high` + `fast=false`，但必须在每次 run 中显式选择 `DESIGN_REVIEW_ONLY` 或 `IMPLEMENTATION` 模式。裸 `grok-4.6` 默认仍是 `effort=high` + `fast=true`，因此必须显式传参；SDK 目录另有 `effort=xhigh`，本项目合同仍固定 `high`。Cursor 内部 task/subagent/explore 委派继承顶层 prompt 边界，由顶层 agent 对产出负责，不适用该固定 grok 合同。Codex-native subagent 默认探索/审查/分析，不得绕过本流程直接改代码/脚本/配置。

## 1. 适用范围

`goal`、需求描述或任务页只定义目标与范围，不覆盖本流程。驱动模型先把任务当决策树逐枝收敛：能从代码库、最近层 `AGENTS.md`、`README`、脚本和现有文档回答的问题先自己查；查不到再一次只问用户一个问题，并给推荐答案。独立有界分支可交给 Codex-native subagent，主线程保留集成与最终验证。

下列任一条件成立时，编码前必须增加 Cursor 方案评审：

- 存在两个及以上合理技术方案或会影响实现的未确认假设；
- 涉及跨模块、跨 worktree、API、Schema、ABI、数据迁移、权限或安全边界；
- 需要新增或实质修改需求澄清、概要设计、详细设计；
- 写入范围、兼容策略、验证方法或停止条件不能由现有规则唯一确定。

仅当以下条件全部成立时，才可按纯机械小改跳过方案评审：

- 仓库证据表明实现路径唯一，不存在需要选择的设计分支；
- 不改变 API、Schema、ABI、持久化格式、权限、安全边界或用户可见行为；
- 写入范围、兼容影响、验证命令和预期结果均已明确；
- 不存在会影响实现的默认假设或待用户决策。

驱动模型必须在执行说明中记录 `SKIP_DESIGN_REVIEW: <理由和仓库证据>`。任一条件无法证明即不得跳过；Cursor 也不得自行降级流程。

## 2. 角色与模式

### 2.1 驱动模型

- 负责仓库事实调查、候选方案、范围和最终技术裁决；
- 负责逐项处理 Cursor 评审意见并更新方案；
- 只有本地证据不足且确实涉及用户取舍时才向用户提问；
- 负责冻结最终方案、启动编码 run、检查 diff/事件日志和完成最终验收。

### 2.2 `DESIGN_REVIEW_ONLY`

顶层 Cursor local agent 只评审候选方案的实现可行性，检查遗漏影响面、契约矛盾、模糊步骤、不可执行的验证和隐含假设。该模式：

- 不拥有最终设计决策权；`READY` 仅表示实现准备度通过；
- 不得创建、修改或删除任何工作区文件；
- 不得自行扩写需求或把个人偏好升级为阻塞项；
- 每个阻塞项必须给出仓库证据、实际影响和需要驱动模型回答的具体问题。

### 2.3 `IMPLEMENTATION`

顶层 Cursor local agent 只执行已经冻结的最终方案：

- 必须使用新的 run，不得沿用方案评审 run 直接编码；
- 只接收最终方案、允许写入范围、非目标、验证命令和停止条件；
- 不得重新打开已经关闭的纯偏好讨论；若发现新的事实冲突，停止编码并报告，不得自行改写方案。

## 3. 状态流转

1. `SCOPE_CONVERGENCE`：驱动模型调查仓库并收敛任务边界。
2. `PLAN_CANDIDATE`：驱动模型形成带版本的候选方案 `PLAN_REV=N`。
3. `DESIGN_REVIEW`：Cursor 以 `DESIGN_REVIEW_ONLY` 模式返回结构化结论。
4. `ISSUE_RESOLUTION`：驱动模型逐项裁决、补证据并更新为 `PLAN_REV=N+1`。
5. `CONSENSUS_GATE`：满足全部通过条件后冻结方案。
6. `IMPLEMENTATION`：新建 Cursor run，执行冻结方案。
7. `ACCEPTANCE`：驱动模型检查产物并亲自完成可自动化验证。

`DESIGN_REVIEW -> ISSUE_RESOLUTION -> DESIGN_REVIEW` 可以循环，但不得无限文字往返。连续三轮仍未收敛，或同一阻塞点连续两轮没有新证据时，驱动模型必须停止循环，重新调查仓库；仍无法决定时再向用户提一个问题或报告阻塞。

## 4. 候选方案契约

每个送审方案至少包含：

- `PLAN_REV`：单调递增的方案版本；
- 目标、非目标和成功标准；
- 当前仓库事实及对应文件、符号或命令证据；
- 关键技术决策、数据流和接口/Schema/ABI 契约；
- 兼容、迁移、回退和错误处理策略；
- 预计写入范围与只读参考范围；
- 实现顺序、验证命令、预期结果和停止条件；
- 仍存在的假设、风险和需要重点评审的问题。

复审时必须提供完整最新方案，并附本轮变化摘要和上一轮问题处置表；不得只发送零散回复，让 Cursor 自行拼接最终设计。

## 5. Cursor 方案评审输出契约

方案评审 prompt 必须以 `MODE: DESIGN_REVIEW_ONLY` 开头，并明确写入禁令。Cursor 必须按以下结构返回：

```text
VERDICT: READY | REVISE | BLOCKED
REVIEWED_PLAN_REV: <number>

BLOCKERS:
- ISSUE_ID: R-001
  TYPE: ambiguity | contradiction | missing-impact | unverifiable | external-decision
  PROBLEM: <具体不明确点或冲突>
  IMPACT: <不解决会造成的实现分叉、错误或无法验证>
  EVIDENCE: <文件、符号、命令结果或现有契约>
  QUESTION: <驱动模型需要回答的一个具体问题>
  DEFAULT_ASSUMPTION: <未回答时 Cursor 会采用的假设；没有则写 none>

NON_BLOCKING_SUGGESTIONS:
- <不影响实现准备度的改进建议>

READINESS_CHECK:
- goals_and_non_goals: PASS | FAIL
- contracts: PASS | FAIL
- write_scope: PASS | FAIL
- compatibility_and_errors: PASS | FAIL
- validation: PASS | FAIL
- stop_conditions: PASS | FAIL
```

结论语义：

- `READY`：没有阻塞项，所有 readiness 项为 `PASS`；
- `REVISE`：驱动模型可通过补证据或修改方案解决；
- `BLOCKED`：缺少用户决策、外部条件或当前仓库无法取得的关键事实。

Cursor 不得只说“看起来可以”或“这里不清楚”。没有证据和实际影响的问题只能进入 `NON_BLOCKING_SUGGESTIONS`。

## 6. 驱动模型处置契约

驱动模型为每个 `ISSUE_ID` 维护处置记录：

| 状态 | 含义 |
| --- | --- |
| `ACCEPT` | 接受问题并修改方案，指出新版本中的修改位置 |
| `REJECT` | 不接受问题，提供仓库证据或现有契约说明原因 |
| `NEED_USER` | 本地无法决策且确属用户取舍，暂停门禁并向用户提一个问题 |

非阻塞建议可以接受或拒绝，但不得因为未采纳偏好而阻止进入编码。若评审暴露新的范围或需求，返回 `SCOPE_CONVERGENCE`，不得在评审循环中静默扩大任务。

## 7. 方案共识门禁

只有同时满足以下条件，方案才可冻结并进入编码：

- Cursor 对最新 `PLAN_REV` 返回 `READY`；
- 驱动模型的问题处置表没有未关闭项或 `NEED_USER`；
- 所有会影响实现的默认假设已经写入方案并得到确认；
- 目标、非目标、契约、写入范围、兼容/错误策略、验证命令和停止条件齐全；
- 本轮方案评审审计可用，且 `summary.writeAllowlistAudit.runDeltaCount == 0`；
- 事件日志完整且可解析，关键工具事件未截断，并且没有文件写入、删除、重命名或写后恢复的工具调用/命令证据；
- 驱动模型明确记录冻结版本，例如 `FROZEN_PLAN_REV=3`。

若调用层支持对同一个 agent 连续 `send`，评审迭代可以复用 reviewer 会话；当前 `cursor_local_agent_run.mjs` 每次调用只执行一个 run，因此复审必须携带完整最新方案、变化摘要和处置表。无论评审如何调用，编码都必须新建 run。跨 worktree、迁移、权限、安全或 ABI 等高风险方案，可在冻结前使用新的 Cursor 会话做一次只读冷评审。

## 8. 只读评审与写入审计

当前 runner 的 `--allowed-path` 是审计型写入 allowlist，不是 OS sandbox，也不是只读开关。`runDeltaCount` 基于 Git 可见状态和路径签名；默认 `/.agents/artifacts/` 已被仓库忽略，runner 写入其中的审计产物不属于 agent 工作区变更。方案评审必须使用默认的 gitignored artifacts 目录，或在启动前用 `git check-ignore` 证明自定义 `--out-dir` 已被忽略；不得借 artifacts 目录存放任务产物或形成审计盲区。

方案评审 run 仍按 runner 契约提供明确 allowlist，但必须同时满足：

1. prompt 明确禁止创建、修改或删除文件；
2. 驱动模型检查 `summary.json`、事件日志、完整 worktree 状态和 diff；
3. 无论变更是否落在 allowlist 内，只要 `runDeltaCount != 0`，该次评审即无效；
4. 驱动模型检查事件日志中的工具调用和命令；若出现文件写入、删除、重命名或写后恢复，即使最终 `runDeltaCount == 0`，评审仍无效；
5. `events.jsonl` 缺失、无法解析，或与文件操作相关的关键工具事件被标记为截断时，按审计不可用处理，不得用“未发现写入”替代有效证据；
6. 审计不可用、状态捕获失败或出现文件变化时，保留产物并按异常处理，不得把评审结论作为编码依据，也不得自动回滚无关脏改。

后续若 runner 增加一等的 `--read-only` 模式，应以“任意 run delta 均非零退出”为契约；在此之前，由驱动模型执行上述零写入门禁。

## 9. 编码执行与最终验收

编码 prompt 必须引用冻结版本，并包含目标、允许写入范围、非目标、验证命令和停止条件。Cursor 只负责受限编码执行；驱动模型每轮先查看 `summary.json`、`review.md`、事件日志、完整/范围内 Git 状态和 diff，即使 `status=error` 也要先确认是否已有文件落地。

最终由驱动模型亲自完成命令级测试和本地服务探测。涉及页面、联调或用户流时，驱动模型默认先自行启动或复用后端/前端，再用 Playwright 走完整验证路径，并记录 route、操作、关键断言、截图或导出证据，不得把可自动化页面验收直接交给用户。

只有 Playwright 无法覆盖的外部条件才交用户：游戏客户端实测、OCR/人工读数确认、登录/验证码、权限密钥、设备/网络侧操作，或必须由用户手动启动的本机服务。交接时必须列清驱动模型已验证内容和用户只需确认的剩余项。

## 10. 产物分层

- 需求澄清、概要设计、详细设计只保留收敛后的当前真源，不复制完整评审对话；
- 每轮 Cursor 的 `prompt.txt`、`summary.json`、`events.jsonl`、`review.md`、diff 和问题处置记录保存在 run artifacts 中；
- 冻结方案应能独立交给新的编码 run，不依赖读取旧会话才能理解；
- 分支未收敛、门禁未通过、权限或环境异常时，不得继续推进。

接线、模型和 runner 操作真源：`.agents/skills/cursor-local-agent/SKILL.md`。本文件定义决策、方案共识门禁和验收，不重复 SDK 实现。
