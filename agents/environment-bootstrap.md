# 开发环境与定时任务初始化

本流程由新开发环境的主负责人执行；子代理不建立定时任务。角色、会话和轮询数据只属于本机，不从另一环境复制。用户已授权本项目首次接入时建立必要的角色轮询自动化；仅拉取仓库不会自行执行命令，需要当前环境中的助手按本入口接手。

## 检查或首次接入

```powershell
node agents/coordination.mjs bootstrap --environment codex-local
```

该命令初始化本地会话、轮询及自动化登记，并返回原生任务的发现或核对计划，不会虚构已建立的自动化。不同会话工具、账号或存储范围使用不同环境编号。主检出与环境共同生成稳定标记 `marker`，只在当前本机范围识别同一项自动化。后续写入均提供刚读取的修订号 `revision`；比较与递增在同一文件锁内完成，即使原生任务编号未变，旧操作也不能覆盖较新的暂停记录。冲突后重新读取本地及原生状态，不只换一个修订号重放旧结果。

1. `verify_existing`：用原生自动化工具核对返回的实际任务编号。仍存在则复用，按当前共享策略更新频率与提示，并保留实际暂停状态；不要仅凭本地登记宣称任务正在运行。
2. `discover_native`：先查本机原生任务中匹配该 `marker` 的任务。Codex 可用当前自动化工具及本机 `$CODEX_HOME/automations/*/automation.toml` 核对，只提取任务标识、状态和间隔，不输出凭据或无关任务内容。匹配一项就绑定，不能因为本地文件缺失重复新建；匹配多项先明确冲突，不自动删除。
3. 确认不存在匹配任务后，先领取创建操作，再用原生工具创建当前聊天的定时自动化。名称、频率和标记使用初始化返回值，提示读取当前 [轮询流程](heartbeat.md)，实际每四小时一轮；不建立每次另开新聊天的任务。

```text
node agents/coordination.mjs bootstrap-create --environment codex-local --expected-id none --expected-revision <刚读取的修订号> --native-absent
```

4. 原生创建明确成功后，用真实自动化编号、归属聊天和实际状态绑定；新建时附创建操作编号。`--expected-id` 使用刚读取的旧任务编号，没有旧值才用 `none`。

```text
node agents/coordination.mjs bootstrap-bind --environment codex-local --expected-id none --expected-revision <创建领取返回的修订号> --automation-id <真实任务编号> --target-thread-id <实际归属聊天> --native-status <实际ACTIVE或PAUSED> --attempt <创建操作编号>
```

5. 原生结果不明时记录 `uncertain`，再按稳定标记核对实际任务，不盲目创建第二个。只有明确未创建才能记录 `not_created` 后重新领取；用户之前暂停的意图保留，新建替代任务也保持暂停。

```text
node agents/coordination.mjs bootstrap-result --environment codex-local --expected-revision <刚读取的修订号> --attempt <创建操作编号> --outcome uncertain --receipt <实际核对依据>
```

6. 原生工具不可用时如实报告待建立，不把登记文件当作定时器，不自行添加系统计划任务。当前机器的原生任务状态始终以应用实际记录为准。

## 本地文件

`agents/.local/automation.json` 按环境登记原生任务、创建操作及暂停意图，`agents/.local/polling.json` 保存轮询顺序、检查结果、冷却与未知唤醒结果；都被 Git 忽略。坏文件明确失败并保全，不初始化覆盖。旧结构迁移先保留恢复备份，当前实现不长期维护旧格式兼容。
