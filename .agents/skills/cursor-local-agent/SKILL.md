---
name: cursor-local-agent
description: "用户明确选择或要求排查 Cursor SDK 本地代理路线时使用；普通 Codex 实现和评审不使用。"
---

# Cursor 本地代理

本技能只补充 Cursor 专属接线和审计规则。任务授权、风险分级、委派和验收仍以根 `AGENTS.md` 为准；选择 Cursor 不会把它变成其他任务的前置条件。

## 固定契约

- 顶层代理使用 `@cursor/sdk@1.0.24`，模型固定为 `grok-4.6`、`effort=high`、`fast=false`。该限制不约束 Codex 或 Cursor 内部有界委派。
- `Agent.create(...)` 必须显式传入 `apiKey`，真实运行请求 `settingSources: ["project"]`。不得输出密钥或片段；只报告密钥是否可用。
- 优先使用 Node `>=22.13`；低于 `20` 阻塞运行。Codex 桌面系统 Node 过旧时，仅为本进程使用工作区依赖工具返回的 Node，不修改全局 `PATH`。
- 每次真实运行至少提供一个 `--allowed-path`。它是运行前后文件变化的审计清单，不是操作系统沙箱；路径必须位于 `--cwd` 内。
- 提示词第一物理行必须精确为 `MODE: DESIGN_REVIEW_ONLY` 或 `MODE: IMPLEMENTATION`，不能带空格、注释或其他文字。
- 运行证据默认写入 Git 忽略的 `.agents/artifacts/`。自定义目录先用 `git check-ignore` 确认已忽略，不将证据目录用作任务产物目录。

## 两种模式

### 方案评审

`DESIGN_REVIEW_ONLY` 只用于已选择 Cursor 的独立方案评审。提示词提供当前方案版本、仓库证据、预计写入范围、验证、停止条件和待审风险；要求返回 `VERDICT: READY | REVISE | BLOCKED`、`REVIEWED_PLAN_REV`、有证据的阻塞项以及分开的非阻塞建议。

只有同时满足以下条件，评审才有效：

- 运行状态为 `finished`，方案版本匹配；
- 文件变化审计和事件日志审计都可用；
- `runDeltaCount === 0`，没有创建、写入、删除、重命名或写入后恢复的证据；
- 相关工具事件未截断，日志可解析。

任一条件不满足都不能采用评审结论。不要用“变化在允许范围内”替代只读要求。

### 实现

`IMPLEMENTATION` 只接收当前已授权任务：目标、有效契约、允许写入范围、非目标、验证和停止条件。若方案已评审，引用已接受版本并另开实现运行；普通任务不强制先做 Cursor 评审。新事实改变共享语义、权限、数据处置或授权范围时，返回主负责人决策。

## 运行

先查看脚本的当前参数和产物说明：

```powershell
node .agents\skills\cursor-local-agent\scripts\cursor_local_agent_run.mjs --help
```

真实任务优先使用现有 runner（执行脚本）：

```powershell
$repo = "C:\project\damage_viewer_project_planning"
$runner = Join-Path $repo ".agents\skills\cursor-local-agent\scripts\cursor_local_agent_run.mjs"
node $runner `
  --cwd $repo `
  --prompt-file C:\task\cursor-task.txt `
  --allowed-path 文档记录 `
  --timeout-ms 900000
```

将 `$repo`、提示词和允许路径替换为真实任务值。runner 会保存 `summary.json`、`events.jsonl`、`diff.patch`、运行前后 Git 状态和路径签名；精确文件清单、重试、超时与回退参数以 `--help` 为准。

## 结果与异常

- 只有 SDK 返回 `finished` 且审计通过才算成功。`error`、`cancelled`、`expired`、未知状态或审计失败均为非零退出；即使运行失败也先检查差异，因为代码可能已经落地。
- 范围外变化使审计关闭并优先退出 `2`；保留证据，不自动回滚既有脏改。
- 启动重试只覆盖产生 `Run` 之前的可重试错误。已有 `runId` 后不得自动重试或命令行回退；超时后也不得盲目重放实现任务。
- 命令行回退仅可在启动阶段尚未产生 `Run` 时显式启用；默认不允许无法证明模型参数的回退。
- `MaxListeners` 警告本身不代表失败，应结合最终状态、审计和资源变化判断。
- 主负责人复核最终差异并运行仓库验证。Cursor 产物证明一次工具运行，不代替代码、浏览器、数据库或运行时验收。

## 轻量验证

修改本技能或 runner 后按影响选择：

```powershell
node .agents\skills\cursor-local-agent\scripts\cursor_local_agent_path_policy.test.mjs
node .agents\skills\cursor-local-agent\scripts\cursor_local_agent_smoke.mjs --dry-run
```

`--dry-run` 只验证接线和固定模型参数，不证明真实 SDK 调用、项目技能加载或任务完成。
