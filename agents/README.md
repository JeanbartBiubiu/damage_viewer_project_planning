# 项目长期智能体

本目录定义项目内长期承担职责的角色。角色身份稳定，执行它的会话可以更换；角色在用户已授权的任务内组织现有子代理，继续遵守[根规则](../AGENTS.md)和相关模块规则。

## 角色与工具

| 角色 | 编号 | 工具 | 定义 |
| --- | --- | --- | --- |
| 项目协调 | `manager` | Codex | [分派、集成与验收](roles/manager/README.md) |
| 方案设计 | `planner` | Antigravity（Gemini） | [方案编写与修订](roles/planner/README.md) |
| 前端开发 | `frontend` | Codex | [页面、平台与计算宿主](roles/frontend/README.md) |
| 后端开发 | `backend` | Codex | [接口、权限与数据](roles/backend/README.md) |
| Wasm 开发 | `wasm` | Codex | [编译、运行与数值机制](roles/wasm/README.md) |
| 资料与录入 | `authoring` | Codex | [确认文本、配置保存与对象验证](roles/authoring/README.md) |
| 独立验收 | `reviewer` | Codex | [需求、产物与证据核对](roles/reviewer/README.md) |

哪些任务需要方案见根规则第 2 节“工具分工”，方案的格式、流转与删除见[方案约定](../文档记录/方案/README.md)。项目协调者按已确认方案为每项任务指定一个交付负责人；独立验收者保持只读，实现者的自查不算独立验收。`.codex/agents/` 继续定义 Codex 可调用的专业子代理；`.agents/rules/planner.md` 只被 Antigravity 读取，约束方案角色的写入边界。

## 本地数据

角色定义、关系矩阵、本说明及脚本随 Git 保存。本机数据都在主检出的被忽略目录，同机工作树共用一份，其他机器各自生成，不保存凭据：

| 文件 | 内容 |
| --- | --- |
| `agents/.local/sessions.json` | 角色由哪个工具的哪个会话承担 |
| `agents/.local/coordination-status.json` | 各角色短近况 |
| `agents/roles/<角色>/.local/todo.json` | 本角色待办 |
| `agents/roles/<角色>/.local/memory.md` | 本角色笔记与交接 |

写入使用短文件锁和临时文件替换。异常退出留下 `.lock` 时，先确认其中记录的进程已结束再删除锁文件；坏文件直接报错并保留原文件。本机登记只防止正常协作中的误写，不构成权限隔离。

## 会话登记

```powershell
node agents/coordination.mjs resolve manager
node agents/coordination.mjs bind manager --tool codex --session-id <实际会话编号>
```

`resolve` 返回登记的会话以及本角色的定义、待办和笔记路径。需要角色会话时由当前工具新建，读完角色资料后用真实编号 `bind`；重复 `bind` 直接替换，一个会话只承担一个角色。登记只改变路由，不会停止旧会话或撤销其权限。planner 在 Antigravity 中不登记会话。

## 近况

```powershell
node agents/coordination.mjs publish frontend --state working --current "处理当前授权页面的输入接线" --needs "等待后端确认错误字段" --ref web/README.md
node agents/coordination.mjs status
node agents/coordination.mjs peers frontend
node agents/coordination.mjs matrix
```

近况包含状态（`idle` 空闲、`working` 处理中、`waiting` 等待依赖、`blocked` 受阻）、最多 160 字符的当前进展与协作需要，以及最多 3 条仓库相对路径。接手、进展或阻塞变化以及交接前由角色自己发布，结束一轮不会自动提醒。超过 `statusStaleMinutes` 的近况显示 `stale`，未发布显示 `unknown`，都不能当作当前事实。`status` 可带角色只看一个；`peers` 只列关系为 1 的角色。关系 0 不禁止明确任务下的查询或通知，也不扩大写入权限。

## 完成、通知与待办

```powershell
node agents/coordination.mjs complete backend --task <原任务及阶段> --summary "本阶段已完成的内容" --ref <证据路径> --attention frontend
node agents/coordination.mjs notify planner --from manager --task <task_key>@v<版本> --summary "偏差摘要" --ref 文档记录/方案/<task_key>.md
node agents/coordination.mjs todo frontend
node agents/coordination.mjs todo-ack frontend <待办编号> --decision no_action --note "当前任务不受影响"
```

启用多角色异步协作时，`complete` 用于申报已授权且有证据的阶段完成，给所有关系为 1 的角色各写一条待办，编号 `done:<来源>:<任务>`。`--attention` 只能指向这些角色，标为请求关注，其余标为请判断。`notify` 给指定角色写一条请求关注的待办，编号 `notice:<来源>:<任务>`，用于退回方案或提醒具体事项。相同编号和内容只记录一次。内容变化时在 `--task` 写明新阶段或方案版本。两个命令的作用范围是本地待办文件。Antigravity 与 Codex 双窗口直接交接走[方案约定](../文档记录/方案/README.md)。

`todo` 默认列出未关闭条目及未读、待跟进数量，`--all` 包括已关闭项。处置 `follow_up` 表示需要跟进，`no_action` 与 `done` 关闭条目；处置本身不是业务完成，不再广播。

## 钩子

[.codex/hooks.json](../.codex/hooks.json) 只登记 `SessionStart`，命令通过 Git 定位主检出并执行 [coordination-hook.mjs](coordination-hook.mjs)。已登记角色的根会话启动时获得角色、待办数量与笔记路径提示；子代理、未登记会话和其他任何事件都得到空对象。钩子不读取或保存输入正文与会话转录。Codex 对变更后的钩子要求在 `/hooks` 中重新审阅信任，未信任时会跳过。Antigravity 中的方案角色在启用异步协作时按角色说明自行查看待办。

## 角色笔记

笔记保存有来源的稳定认识、待核假设和必要交接，不保存凭据，也不修改全局记忆。重要认识附源码、契约、提交或验证证据的引用，被推翻时及时修正。笔记与待办不替代任务规则、录入账本或共享定义。

## 验证

依赖 Node.js 20 或更新版本和 Git：

```powershell
node --test agents/coordination.test.mjs agents/coordination-hook.test.mjs
git check-ignore agents/.local/sessions.json agents/roles/manager/.local/todo.json
```
