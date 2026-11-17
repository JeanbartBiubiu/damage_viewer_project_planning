# 角色低频轮询流程

本流程供本机原生定时任务与人工检查使用，环境示例为 `codex-local`。默认每四小时一轮，每轮最多为一个已登记角色登记或复用周期待办，等待自然接手。新环境先按[初始化入口](environment-bootstrap.md)建立或复用定时任务，保留用户暂停；轮询不创建尚未登记的角色会话，不跨环境使用编号。

## 开始周期

1. 读取[共享入口](README.md)和 `agents/coordination.json`。首次进入环境或本地自动化登记缺失时执行 `bootstrap` 并完成原生核对；不能只写本地文件冒充建立了定时任务。
2. 运行 `tick --environment codex-local`，补偿完成事件到各自待办，并收集详细消息及未知结果。通知补偿故障单独报告，不阻断有效的详细任务。完成事件不直接发送会话输入；本流程的周期检查是独立来源。
3. 执行 `poll-begin --environment codex-local`。它从主检出本地会话登记建立候选，按轮询游标循环，不要求先有消息。返回 `cooldown` 时结束；有 `needs_reconcile` 先看领取类型：`local_todo` 按保存的 `todoId` 查询该角色本地待办（含已关闭项），找到就结算 `deferred`，明确未落盘则结算 `not_sent`，仍不明保留。不要把本地待办结果送去原生会话核对。其他历史会话投递按原实际结果读回，不盲重发。
4. 无候选时用 `poll-finish` 记录原因并结束，不为了凑数建立新会话。只有具体授权任务确实需要新角色时，才由正常工作的主负责人按共享入口创建和绑定；定时轮询不扩充会话池。

```powershell
node agents/coordination.mjs poll-begin --environment codex-local
node agents/coordination.mjs poll-status --environment codex-local
```

## 查询与循环

逐个检查本轮候选，只查询登记中的真实宿主与会话。使用当前环境的真实运行状态工具，例如 Codex `wait_threads` 的单目标零等待快照；不能以短近况、上轮文件或“未加载”推断空闲。运行中记为 `running`，需要用户操作记为 `needs_input`，错误或不明记为 `unknown`，只有明确空闲才记为 `idle`。观察时间使用本机刚查询后的标准时间，精确到毫秒，例如 `2026-11-18T01:00:00.000Z` 的格式；不可复用示例或上轮时间。

```text
node agents/coordination.mjs poll-observe <角色> --environment codex-local --cycle <周期编号> --thread-id <实际会话> --generation <当前代次> --state idle --observed-at <本次查询时间>
```

忙碌、需输入、未知或过期代次均跳过，继续后续候选；检查会推进游标，下轮从后续角色开始。全部跳过后 `poll-finish --reason <原因>`，本轮仍进入冷却，不立即反复检查。不可调用中断、停止或转向当前任务的工具。

用户已选择严格不打断，当前 `pollingMode=observe_only`。对第一个明确空闲的候选执行下述 `poll-defer`：占用本轮一个角色名额，追加或复用一条本地周期检查待办，等待它自然接手；随后结束。它不会向会话发输入，唤醒次数保持不变。有尚未关闭的周期检查待办就复用，不每四小时堆新条目。

```text
node agents/coordination.mjs poll-defer <角色> --environment codex-local --cycle <周期编号> --thread-id <实际会话> --generation <当前代次>
```

登记异常后按领取中的待办编号核对，不盲目新增。当前不能切换主动发送模式、调用 `poll-claim` 或把详细消息合并成轮询输入；现有会话工具缺少原子忙时拒绝保证。

## 登记结果核对与结束

`poll-defer` 正常完成后已经结算本轮，无需再结束。中途失败时先用 `poll-status` 读取领取编号和 `todoId`，再用 `todo <角色> --environment <环境> --all` 核对本地条目：已存在则结算 `deferred`，明确未写入则结算 `not_sent`，仍不明则保留 `uncertain`。本地领取不能结算为 `sent`，也不能通过查询会话推断文件结果。

领取未结清前禁止更换该角色的会话，避免失去核对目标；本轮不继续给其他角色登记。没有领取且全忙、未知或无候选时，使用 `poll-finish` 结束并进入冷却。周期查看不代表业务任务完成，角色真实完成阶段仍使用 `complete` 生成关联待办。

```text
node agents/coordination.mjs poll-settle --environment codex-local --cycle <周期编号> --token <领取编号> --outcome deferred --receipt <已核对的本地待办编号>
node agents/coordination.mjs poll-finish --environment codex-local --cycle <周期编号> --reason <全忙或只观察等原因>
```

每轮至此结束，不在同一个定时运行里无限续跑或手动绕过冷却。仅报告有意义的进展、失败或确实需要的输入；没有事项不制造报告。
