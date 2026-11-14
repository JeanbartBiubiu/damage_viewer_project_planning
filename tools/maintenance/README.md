# 公共查看与 AI 维护工具

本目录承担候选冻结、独立计算对照、私有批次调用、问题事件编排和公网入口导出。业务保存仍由同一个 Java 后端负责；协议见[共享维护契约](../../contracts/maintenance/README.md)，整体范围见[单后端方案](../../文档记录/概要设计/项目/公共查看与AI维护单后端方案.md)。

## 候选到正式配置

1. 经私有入口取得维护会话、计算票据和当前游戏基线。长期维护凭据由宿主文件提供，不输入页面。`client.mjs` 的私密配置只包含 `apiBase`、`origin`、`sessionFile`、`maintenanceTokenFile`、`deploymentTokenFile` 等路径；问题候选另配置 `feedbackQueueDirectory`，每次写入前核对最新证据修订。配置、会话及票据放在忽略目录，不能进入 Git。
2. 把现行技能计划、真实场景快照和事先确认的独立预期放到同一候选输入。`candidate.mjs` 使用现行完整技能请求检查，不猜写入类型；冻结文件与输入同目录，资料相对路径也解析到该目录且不得越界。
3. 独立验证执行者先固定预期，再重新读取相同选择的真实服务快照，前后核对整个游戏基线，运行最终 Wasm 并逐项比较。只有启用第 2 版验签的产物、有效维护计算票据、完整执行与释放、独立对照及真实基线检查均通过，才签发回执与批次请求。
4. 写入执行者登记批次；部署执行者实际进入维护并排空请求后打开该批次。`client.mjs apply` 按冻结原始请求字节逐笔提交、查询后端进度并独立回读。请求不明或已有提交时停止，不自动从头重放。
5. 部署执行者交接匹配的正式证明及程序，私有验收后完成批次、恢复公网，再通过正常证书的公网浏览器确认真实编译、运行和释放。`accept-public.mjs` 核对发布身份、真实 COMPLETE 批次和受信浏览器命令后签发公网验收；它不执行部署或自动解除维护。

从仓库根目录使用，各命令的完整参数见 `--help`：

```powershell
node tools/maintenance/client.mjs --help
node tools/maintenance/candidate.mjs --help
node tools/maintenance/verify-candidate.mjs --help
node tools/maintenance/collect-saved-scenes.mjs --help
node tools/maintenance/accept-public.mjs --help
```

候选输入包含 `principalId / gameId / reference / sourceRevision / baselineDigest / skillPlan / scenes / expectedPlan`。`skillPlan` 使用现行 `skill-configuration-plan-v1` 的完整基线、请求和完整预期。每个 `scenes` 项含唯一 `id`、完整原始 `snapshot` 和明确 `scenario`；场景模式为 `fixed` 或 `continuous`，给出时长、双方生命、必要属性及技能动作等本场输入。独立预期使用[离线对照格式](../../.agents/skills/skill-damage-verification/references/calculation-tool.md)，字段路径相对运行档案，例如 `/done/summary/sourceDamageDealt`、`/done/damageRecords` 的长度及逐笔字段。预期与场景一一对应；涉及多段或时序时声明逐笔内容，不能只比较总额。

通过生产结果准入的运行档案另有 `passiveProcesses`：从原始过程快照选择被动实例，按拥有者、挂载、过程、开始时刻和实例标识稳定排序，不改原始 `done`。冻结预期可直接比较其数量、期限、状态及原使用归属，并在正式签发前参与同一轮对照；声明了被动过程却缺少过程快照时直接失败。

当前自动候选仅接受不改变来源、引用、枚举、排序、集合结构和最高等级的数值或说明修正。新增组成、触发入口、依赖、类别或其他配置对象交回开发验证，不沿用旧快照的派生信息。此限制由代码拒绝，不能用替换摘要绕过。

开发录入新增组成时，显式使用 `candidate.mjs --mode development`，冻结为独立的开发候选。场景除原始 `snapshot` 外还提供 `previewSnapshot`，后者必须来自私有只读 `POST /internal/maintenance/games/{gameId}/simulation-preview`。请求为 `{selection, updates:[{skillKey, request}]}`，按真实快照 `references` 的来源和目标技能筛选本场实际执行闭包内的更新；完整配置列表中的其它本批技能保持原基线，每项变更至少在一场实际进入闭包，缺少执行引用则拒绝。后端核对原摘要，用现行配置准备和场景装配重建来源、引用及目录，不写业务数据。开发候选允许已授权的组成`DELETE/null`，并检查完整最终聚合中的本地引用；自动候选仍拒绝结构删除。验证执行者再次向真实服务读取原始和预检快照，逐字段核对后才运行并签发。正式保存后的对象仍用普通快照验收；开发预检不替代保存或完整对象准入。

新增主动入口等结构修复可能使修前普通快照无法生成。仅开发候选可明确填写 `snapshot: null`，保留真实 `previewSnapshot`；不省略字段或伪造普通快照。此时验证前后独立读取本批全部技能的完整配置，分别核对冻结 `before` 的业务内容与 `baseDigest`，再按预检选择和真实执行引用重建、核对整个后端预检场景。原始配置、预检与全游戏基线证据同时保留；正式保存后仍通过普通场景快照验证。

真实 Node 计算由 `engine-client.ts` 共用正式桥接与维护票据接线。票据文件只取后端维护取票接口的响应，每次编译和运行重新读取，主体变化、过期或错误类别失败，不访问测试签名材料；最终签名和权限仍由启用第 2 版验签的正式 Wasm 独立核验。

`verify-candidate.mjs` 不提供密钥时可生成诊断证据；正式签发另需 `--read-config`（受信真实服务读取配置）及隔离签发私钥，输出独占创建，不覆盖旧证据。输入快照、被冻结的服务配置及原始独立预期始终保留。诊断通过不授予整角色计算资格。

保存后使用 `collect-saved-scenes.mjs --candidate <冻结候选> --read-config <私密读取配置> --output <新目录>`，独立核对各技能完整预期、读取同选择的普通实库快照，并确认采集期间游戏基线稳定。生成的 `scenes.json` 直接交给技能场景运行脚本，`expected-plan.json` 复用候选独立预期。该工具不写业务、不自动计算或提升准入；中途失败保留已有文件且不生成成功汇总，避免每批重写相同采集接线。

维护请求默认等待60000毫秒，私密客户端配置可用 `requestTimeoutMs` 在1000～300000整数毫秒内调整，期限包含完整响应体。响应不明不代表未保存；使用 `client.mjs reconcile --config <私密配置> --candidate <冻结候选> --output <新回读目录>` 核对批次已提交序号、完整配置和实际游戏基线。该命令只读取，不重发配置、不自动续写或完成批次；原失败尝试保持。

## 权限与密钥归属

| 执行者 | 可以持有的私密材料 | 不能因此取得的能力 |
| --- | --- | --- |
| AI 资料与候选执行者 | 受控维护会话、计算票据 | 验证签发私钥、部署凭据与账号开通凭据 |
| 独立验证执行者 | 只用于真实场景核对的会话、计算票据、验证签发私钥 | 自行打开发布窗口或修改账号资格 |
| 部署与公网验收执行者 | 部署凭据、独立公网验收签发私钥 | 玩家密码、验证器或恢复材料 |
| 后端及问题回写者 | 各自所需受信公钥和限定用途凭据 | 验证或验收签发私钥 |

实际部署以不同操作系统身份、目录访问控制或独立宿主隔离这些材料。只换代理名称、提示词或在同一可读目录分三个文件不构成隔离；未配置受信验证公钥时后端拒绝写入。公网验收的 `browserCommand` 为部署者固定的绝对可执行路径、参数数组和工作目录，不接受问题正文中的命令。它通过标准输入取得关联身份，只在真实浏览器的编译、运行、释放均完成后返回对应结果；标准输出只能为该 JSON 结果。

## 问题事件

`feedback.mjs` 只处理明确的 GitHub 问题或评论事件，不做定时网站巡检。原始事件必须通过 HMAC（带密钥的消息认证摘要）校验，并匹配指定仓库；机器人、拉取请求评论及无关活动忽略。同问题同证据修订去重，新证据使旧执行结果失效；启动、提交、回写阶段都核对修订。

接入配置包含 `repository / webhookSecretFile / queueDirectory`；运行 AI 时提供受信 `executor: {executable, args, cwd}`。执行器通过标准输入接收 `{task, outputDirectory}`，把正文和附件当作待核实资料，返回单个 JSON：`sourceRevision / outcome / explanation`。结果种类为 `WAITING_EVIDENCE / DEVELOPMENT_REQUIRED / EXPLAINED / CANDIDATE / RESOLVED`；候选附 `candidateFile`，解决附 `releaseId / batchId / acceptanceFile`。执行器应复用本目录候选与维护工具，不自行把“通过”布尔值当发布依据。

标记解决需要受信部署者签发的验收文件，并独立查询真实后端 COMPLETE 状态；签名或关联身份不符则拒绝。自动回写另配置 `githubTokenFile / maintenanceConfig / acceptancePublicKeyFile / publicOrigin`，令牌仅授予问题回复所需权限。回写前读取 GitHub 当前问题和证据评论再次核对修订，网络结果不明保留请求事实，不盲目重发评论或关闭。

```powershell
node tools/maintenance/feedback.mjs --help
```

`serve` 仅监听回环地址的 `/feedback/github`，由受控事件转发器送入；该进程是 AI 执行宿主的事件适配，不提供游戏业务接口，也不额外部署 Java 业务服务。收到事件后先入队再运行，失败记录脱敏事实。没有配置执行器时仅入队；不会偷偷选择外部模型、创建计划任务或用问题内容拼接命令。反馈仓库、受控执行宿主、凭据隔离和实际部署尚需在发布环境明确配置。

## Nginx 导出与验证

`generate-nginx.mjs` 消费后端唯一 `api-access.json`，导出 http 级方法路径白名单、server 级维护状态和 API location 级门禁。公共版只读快照、登录及计算授权的 POST 按业务分类保留；未登记路径默认拒绝，维护和部署请求头在公网被清空。部署仓库负责制包和实际站点接线。

```powershell
node tools/maintenance/generate-nginx.mjs --catalog server/data_manage/src/main/resources/api-access.json --output <新的配置目录>
node --test tools/maintenance/maintenance.test.mjs
node tools/maintenance/nginx-smoke.mjs --nginx <Nginx可执行文件> --output <新的证据目录>
```

最后一项启动本次独有的回环 Nginx 和隔离接口替身，验证正常、拒绝、异常路径及维护状态，再按本次配置退出自己的进程。它证明真实入口规则，不替代服务器网络隔离、真实业务数据库或公网浏览器验收。
