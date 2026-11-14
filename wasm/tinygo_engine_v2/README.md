# TinyGo Engine V2

浏览器内运行的确定性数值计算引擎。正式业务链为 `engine_compile → engine_run → engine_release_session`；浏览器后台工作线程是正式宿主，Node脚本用于本地验证。当前约束见[模块规则](AGENTS.md)，调用关系见[架构图](ARCHITECTURE.md)。

从业务概念和计算因果理解系统，先读[项目知识手册](../../文档记录/项目说明/项目知识手册/README.md)。本文维护引擎实现、正式工具链及验证入口。

## 源码与职责

| 入口 | 职责 |
| --- | --- |
| `cmd/engine_wasm/`、`internal/base/abi/` | 正式导出、请求帧、线性内存及输出缓冲 |
| `internal/model/`、`internal/plan/`、`internal/compile/` | 共享协议、只读执行计划及规则编译 |
| `internal/runtime/` | 会话登记、请求身份检查及单场运行组合 |
| `internal/authorization/` | 固化可信公钥、计算授权票据验签及期限检查，只在编译和运行入口调用 |
| `internal/runtime/execution/` | 运行装配、原时点读取准备、跨功能次序、预算身份、帧预检与统一提交，见[功能入口](internal/runtime/execution/README.md) |
| `internal/runtime/execution/actionflow/`、`lifecycle/`、`operation/` | 分别执行行动与过程、效果生命周期、数值操作；私有持有所属局部执行事实 |
| `internal/runtime/execution/hit/`、`listener/`、`continuation/` | 分别执行命中候选与强化、监听派发、复制与续接；私有持有命中、节流、收集及同步因果 |
| `internal/runtime/execution/admission/`、`evaluation/`、`usage/` | 分别负责准入、运行求值与缓存、唯一共同额度账及预留凭据 |
| `internal/scheduler/` | 唯一时钟、稳定队列、循环与停止账 |
| `internal/runtime/actor/`、`action/`、`effect/` | 角色数值、行动过程与效果实例的私有状态 |
| `internal/formula/` | 公式构建、冻结、纯求值及只读元信息，见[阶段能力入口](internal/formula/generic_capabilities.go) |
| `internal/pipeline/` | 数值结算、命令、资源计算和护盾底层值；实际供值准备先于对应公式数学调用 |
| `internal/runtime/report/` | 可靠累计、有界记录、观察采样及冻结执行事实到报告字段的纯转换 |
| `internal/base/` | 六个稳定基础包，详见[基础层说明](internal/base/README.md) |
| `internal/testkit/`、`tests/runtime/` | 固定构造输入及公开入口的组合回归 |

具体类型的 `类型名API` 声明列出公开能力及中文约束，实际高频调用优先使用具体类型。共享字段与完整返回值查 `internal/model/`，数学结构查[共同公式](../../contracts/formula/README.md)；不再另抄一套逐方法详细设计。

执行职责、同步交接及成本验证约束以[功能执行与组合设计](../../文档记录/详细设计/项目/执行协调层功能执行与组合重构技术方案.md)为准。有限排程和四种前置决定已实施，契约见[接口与协作约束](../../文档记录/详细设计/项目/Wasm子系统接口设计草案.md)；其他剩余方向见[当前实现与剩余方向](../../文档记录/概要设计/项目/系统模型与计算协作设计.md#当前实现与剩余方向)。

## 运行边界

只读编译计划可以复用，每场状态独立。事件时间、实际来源与完整使用身份必须明确；数值读取保留缺失与有效0的区别。运行时间约束在 `internal/model/` 的快照、停止策略与驱动字段上说明，公开运行入口在创建循环前统一核对；续算保留非零起点，重复排程不把窗口外时刻回绕到过去。数值管道产生结果，所属子系统暂存，执行层按现有帧边界发布；不能推断整条派生链可回滚。

六个执行所有者不互相导入，也不接收完整执行器、根帧或调度器。数值和效果执行可以使用运行求值；命中、监听和续接可以借用同一个共同额度账。根层只通过原时点的有限事实、所属变更对象和同步阶段组合它们，不提供覆盖全部能力的大接口。

每场只组合一份 `usage.Ledger`，额度规则及私有记录由 `usage` 持有；命中规则和监听共享真实预留凭据，按原成功与失败边界提交或释放。使用身份继续归 `action`，时间与事件队列只归同一个 `scheduler.Loop`。

可靠累计、战斗预算、明细限额和采样分别负责；明细截断不改变数值。通用操作存在不等于任意管理配置可以运行，具体对象仍需生产适配、机制范围及首次运行验收。

有限被动延迟过程显式使用 `entryKind: "SKILL_HIT_PASSIVE"`。自身常驻来源的内联 `passive_listener`（被动监听能力）以 `start_passive_process`（被动过程启动操作）及自身 `processKey` 启动；监听必须限定真实同拥有者技能命中。过程只含明确不占行动的即时或延迟步骤，无费用和普通冷却，有实际时点叶操作，并拒绝主动、普攻控制和监听能力别名调用。

每次预约创建独立实例，同次或不同次原使用可以并存；实例与同刻启动计时在原帧统一预检后发布，后继沿唯一过程调度推进。尾部读取当前属性及状态，保留原实际目标与有限使用因果，不额外派发技能命中、法盾判断或主动使用。快照的 `useKey` 属于被动实例，`passiveOrigin` 保存真实原使用和命中身份；该类输出快照当前明确拒绝作为初始恢复输入。预约失败不发布半实例，后续时点失败保留既有提交前缀并报告运行失败，未执行部分不能据快照活动状态判断成功。

合法简单过程统一输出实际步骤执行或过程完成绑定的 `skillHitStages`（技能命中阶段事实），与是否挂载被动延迟功能无关。真实接触在命中原帧提交后带正安全整数 `hitSequence`、`hitOccurrenceId` 及明确为0或1的 `hitBlocked`；MISS或尚未接触时三项全部省略。零伤害及没有数值结果的真实接触同样登记，明细关闭或截断不影响这些事实。阶段的 `completed` 只表示该绑定及同步尾部正常返回，不能用过程已完成状态替代。已有普通恢复路径在尚无实际阶段时保持，已产生阶段的输出继续拒绝作为恢复资格导入。

普通主动的首次过程入口可组合既有 `castCondition`（施放条件）。条件在付款、分配使用身份和提交开始帧前读取本次稳定状态；不成立按 `condition_false` 拒绝，不开启过程或提交冷却。事件和同次使用字段没有此时的上下文，编译时拒绝；重施、取消及借用普攻事件身份的过程入口仍不接受该组合。状态到期沿原调度恢复自动施放，不增加轮询。作者自身计数条件及真实Wasm用例见前端 `selfCounterCondition.ts` 与 `initial_self_counter_*`。

## 构建工具与正式产物

正式工具链固定Go 1.25.2、TinyGo 0.40.1和Binaryen 129，构建脚本会检查版本。目标配置 `targets/wasm-256m.json` 固定初始与最大内存256MiB，参数为 `-scheduler=none -no-debug -opt=2`。

在 `wasm/tinygo_engine_v2/` 执行：

```powershell
$env:WASM_AUTH_REQUIRED = "false" # 早期匿名计算必须显式关闭
powershell -ExecutionPolicy Bypass -File .\scripts\build-wasm.ps1
```

macOS／Linux关闭版使用 `WASM_AUTH_REQUIRED=false bash scripts/build-wasm.sh`。缺省为启用版，设置 `WASM_AUTH_PUBLIC_KEY` 为原始32字节公钥的无填充、网址安全 Base64 编码，并通过 `WASM_AUTH_KEY_ID` 指定固定密钥编号；开关只接受小写 `true/false`，启用时缺少有效公钥或编号立即失败。私钥不参与 Wasm 构建。两种脚本共用 `scripts/authorization-build/` 验证配置，不从请求、浏览器或运行选项读取开关和可信公钥。

产物是 `dist/tinygo_engine_v2.wasm`，旁边的 `tinygo_engine_v2.identity.json` 记录实际字节数、摘要及授权策略。指定其他输出路径时，身份文件仍与产物同目录、同名。关闭版的密钥编号和公钥均为 `null`。前端分发位于 `web/src/engine/wasm/tinygo_engine_v2.wasm`，更新须同步实际身份与最终字节。

工具不在PATH时，脚本继续查仓库 `.tools/` 和上一级目录的 `tinygo0.40.1/tinygo/bin/`、`binaryen-version_129/bin/`。也可用PowerShell参数 `-TinyGo`、环境变量 `TINYGO` 或 `WASMOPT` 指定。Node加载与编译器同版本的 `wasm_exec.js`；显式设置 `TINYGO_WASM_EXEC` 时只使用该文件，不存在、不可读或不是文件都立即失败。未设置时依次查固定本地目录及PATH中的TinyGo安装，已找到工具的执行失败保留原错误。

在前端目录运行 `npm run check:wasm-build`，会把当前源码按正式参数重建到被忽略目录并与分发文件逐字节比较，不改分发文件或正式证明。

## 验证入口

在本模块按改动范围执行：

```powershell
go test -count=1 ./...
node scripts/check-package-boundaries.mjs
go run ./scripts/check-contract-layout
go run ./cmd/bench
node .\scripts\smoke-node.mjs
node .\scripts\time-bounds-smoke-node.mjs
node .\scripts\bench-node.mjs --mode generic-run --iterations 10 --warmup 2
```

涉及协议或会话时先构建最终Wasm再做真实冒烟。生产适配与真实Wasm回归见[固定机制用例](../../web/tests/mechanisms/README.md)，正式证明刷新见[开发与独立评审流程](../../文档记录/项目说明/开发与独立评审流程说明.md)。原生单测、Node、浏览器和真实对象各自说明验证范围。

启用版的编译及每次运行必须在顶层 `authorization` 字符串携带短期票据，会话绑定签发账号；同账号新票据可继续使用已编译会话，释放无需授权。票据唯一契约见[账号与权限接入方案](../../文档记录/详细设计/项目/账号注册登录与权限接入技术方案.md)。错误码为 `authorization_required`、`authorization_invalid`、`authorization_expired`、`authorization_account_mismatch`。授权不进入战斗规则身份或数值结算循环。

普通 Go 数学回归使用仅在非 TinyGo 构建存在的 `NewMathSession()`，固定输入不保存长期票据；正式导出始终使用固化构建策略的 `NewSession()`，缺配置时拒绝计算。Node 验证宿主可用 `WASM_AUTHORIZATION_FILE` 指向受控签发方提供的原始短期票据文件，每次编译和运行重新读取；集成工具也可调用 `setNodeAuthorizationProvider()` 按次提供票据。两者仅给真实请求附加字段，不能跳过产物验签，显式请求票据优先，底层 `invokeFrame()` 不自动注入。

计算票据只接受第 2 版，主体类别明确区分玩家与维护程序。玩家票据要求开通标记并固定有效 24 小时；维护票据不携带玩家开通字段，有效期为正且最多 30 分钟。编译与运行共同绑定主体类别和 UUID，同 UUID 的不同类别也不能复用计划。字段及签发约束以[维护共享契约](../../contracts/maintenance/README.md)为准；签发端还须限制维护票据不晚于维护会话截止。

`node scripts/authorization-smoke-node.mjs` 使用进程内临时密钥在 `target/account-authorization/` 分别构建关闭版和隔离启用版，验证第 2 版两类主体、跨类别拒绝、期限、旧版拒绝、续票、释放、规则身份及数值一致性，并记录包体与入口往返耗时。Windows 可加 `--shell bash` 验证类 Unix 脚本；工具不会写私钥或长期票据。隔离构建不能替代正式公钥产物及真实服务签发的联调。

保留旧 `generic_p0_basic_damage.json` 基准字节，不修改或复制来迁就实现；当前基准由 `scripts/formula-phase4-input.mjs` 和独立显式公式样例构造。测试不固化已录入英雄配置或资料摘要。

## 性能与后续目标

当前单次性能专项保持暂停，后续方向见[网格优化](后续网格优化.md)。正式采样和分配工具为 `scripts/profile-run-node.mjs`、`scripts/allocation-run-node.mjs`，输入、工具链、输出模式和观测窗口须同口径；诊断Wasm及冻结输入缺失时不能报告零分配或复用旧结论。

CPU归因只统计真实调用栈中含 `runLoop` 的样本，按叶函数汇总；优化后无可用符号时明确无法归因。原生Go耗时只辅助定位，Node往返包含宿主及垃圾回收，不能冒充纯计算耗时。基础分页取舍核对实际复制页数及正式Wasm测量。

本页只维护当前操作入口。历史性能、逐轮机制范围与安装证据从对应证据目录及Git历史追溯。
