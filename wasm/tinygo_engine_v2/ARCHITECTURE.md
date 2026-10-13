# TinyGo Engine V2 当前架构图

按当前 generic ABI 实现生成，用于快速 review 边界。使用基础 `graph TD/LR`，避免部分预览器不识别复杂 Mermaid 语法。

## 模块依赖图

```mermaid
graph TD
    Host["浏览器 Worker / Node smoke"]
    Exports["cmd/engine_wasm 导出"]
    ABI["internal/abi frame memory outbox"]
    Session["runtime.Session registry"]
    Model["internal/model generic DTO"]
    Compile["compile.CompileGeneric"]
    Compiled["plan.CompiledSession 只读计划"]
    Run["runtime.RunGeneric"]
    Exec["generic_execution / gate / provider"]
    Scheduler["scheduler.GenericHeap"]
    Formula["formula generic"]
    Pure["expression 纯公式与数学原语"]
    Binding["inputbinding 独立输入绑定"]
    Probe["独立纯公式验证入口"]
    RunFormulas["本次独立公式表"]
    Typeset["typeset generic"]
    Pipeline["pipeline resolver"]
    Testkit["testkit fixtures + ABI helpers"]

    Host --> Exports
    Exports --> ABI
    Exports --> Session
    Session --> ABI
    Session --> Model
    Session --> Compile
    Compile --> Compiled
    Compile --> Formula
    Compile --> Pure
    Compile --> Binding
    Session --> Compiled
    Session --> Run
    Run --> Exec
    Run --> Scheduler
    Run --> Formula
    Run --> Typeset
    Run --> Pipeline
    Run --> Compiled
    Exec --> Compiled
    Exec --> Binding
    Pipeline --> Compiled
    Run --> RunFormulas
    Formula --> Pure
    Probe --> Pure
    Probe --> Binding
    Binding --> Pure
    Testkit --> Session
    Testkit --> Model
```

## 控制流时序图

```mermaid
graph TD
    A["宿主写入 compile frame kind=200"]
    B["engine_compile"]
    C["CompileGeneric"]
    D{"compile OK?"}
    E["register sessionId"]
    F["outbox compile_result"]
    G["outbox error / ok=false"]
    H["宿主写入 run frame kind=201"]
    I["engine_run"]
    J{"session + hash OK?"}
    K["RunGeneric"]
    L["outbox generic done"]
    M["outbox EngineError"]
    N["宿主写入 release frame kind=202"]
    O["engine_release_session"]
    P["outbox release_result"]
    Q["宿主读 outbox_ptr/len 并 clear"]

    A --> B --> C --> D
    D -->|是| E --> F --> Q
    D -->|否| G --> Q
    F --> H --> I --> J
    J -->|是| K --> L --> Q
    J -->|否| M --> Q
    L --> N --> O --> P --> Q
```

## 数据形态转换图

```mermaid
graph LR
    A["frame.Payload JSON"]
    B["CompileRequest"]
    C["CompiledSession"]
    D["RunRequest"]
    E["DoneResult"]
    F["ReleaseSessionRequest"]
    G["release_result"]

    A -->|compile| B
    B -->|CompileGeneric| C
    A -->|run| D
    C -->|RunGeneric| E
    D -->|RunGeneric| E
    A -->|release| F
    F -->|registry delete| G
```

## CompiledSession 职责（glance）

| 对象 | 职责 |
| --- | --- |
| `plan.CompiledSession` | 只读规则快照：schema/rules hash、combatants、providers、abilities、operations、formulas、settings、abilityRefIndex；类型归执行计划包，编译器仅生产它 |
| `CompiledSkillActionBinding` | 编译期固定来源、首次过程控制与合法完成命中绑定；运行只选择预设，不改过程时点或能力引用 |
| `CompiledCombatant` | combatant 模板与 provider mounts |
| `CompiledProvider` / `CompiledAbility` | capability 与 ability 定义；含 `instanceScope`、`statusContributions` 与治疗组计算方式 |
| `CompiledOperation` | 执行期 operation IR；`resolve_skill_hit` 携带编译后的命中计划；`outputRef` 导出同帧伤害口径 |
| `CompiledSkillHit` | 命中候选、阻挡范围、供值条件与候选 operations 切片 |
| `formula.GenericRegistry` | 内部用途指令与技能／伤害共同只读程序共享的有界注册表；外部调用只链接已声明具名程序 |
| `formula.SkillBinding` | 私有作者归属、原定义定位、已选参数、实际运行来源及只读绑定；可达依赖覆盖条件两支 |
| `CompiledAttributeDerivation` | 明确派生拥有方与可选作者技能；共同读取按拥有方解释，内部读取维持战斗侧语义 |
| `CompiledDamageTypeFormula` | 共同程序编号、只读绑定及原属性读值描述；一次防御求值供两部分使用 |
| `typeset.CatalogResult` | flat type key / matcher 输入 |

## 运行时状态（glance）

```mermaid
graph TD
    Session["Session: genericSessions + outbox"]
    Entry["genericSessionEntry: sessionId hashes CompiledSession"]
    State["genericRunState: 本次formulas combatants heap budget skillUses/skillHitFacts/useTriggerLedger"]
    Outbox["abi.Outbox priority frames"]

    Session --> Entry
    Session --> Outbox
    Entry --> State
```

## Review 建议

1. 先看 `internal/model/generic*.go` 与 `ARCHITECTURE` 本图，确认 ABI 边界。
2. 再看 `compile/generic.go` → `session.go` → `RunGeneric`，确认 call chain。
3. 新机制落在 provider/ability/operation + gate/execution；legacy step-loop/DPS 源码与导出已删除。
4. 当前验证契约：独立作者 `formula-phase4-input.mjs`／`formula_phase4_explicit_basic_damage.json` + `smoke-node.mjs` + `go run ./cmd/bench`。原 `generic_p0_basic_damage.json` 字节保留，当前协议明确拒绝；旧900结果由 `target/formula-phase4-baseline` 档案复核。

第二阶段执行及数值管道已解除对编译器包的类型依赖；会话接线仍调用真实编译入口。临时驱动程序只追加到本次独立公式表，派生与其他求值共同读取该表。第三阶段A将伤害共同定义接入正式防御结算；第三阶段B将技能具名共同定义和私有参数绑定先注册，再链接内部用途包装，统一读取依赖、静态冻结、作用域及调用预算。第四阶段要求每个实际伤害操作都有成功注册的共同防御计划，金额短路前检查计划约束；普通防御读取帧入口，复制读取完整冻结双方视图，统一结算后才经 `ApplyMitigatedDamage` 扣盾和生命。通用命令入口只保留治疗、护盾与斩杀。成功编译的已核定静态输出只供宿主消费本次真实程序结果，不另设求值导出。正式技能／伤害专项经过真实编译、运行和释放导出，Node证据不代替浏览器工作线程。

## 阶段2连续运行链

`model/generic_basic_attack.go`定义原生连续计划、已知预算原因、可靠记录与完整性字段。`runtime/generic_basic_attack_admission.go`在原始初始快照上核对本次编译身份和静态共享普攻范围；`runtime/generic_basic_attack.go`在`RunGeneric`内逐刀创建使用身份，依次经过真实开始监听、首次即时过程、命中候选及同步尾部，只消费已提交的过程冷却并安排下一刀。它不改变单次事实限制，也不增加导出入口。

`generic_frame_commit*.go`先核对本帧所需队列容量，再统一提交生命、过程、冷却、证据及相关统计；`generic_execution_budget*.go`跨同刀各帧保留命令计数，并传播可识别的停止原因。`generic_basic_attack_output.go`只观察已提交伤害，完整累计与有限明细互不代替；预算中断可保留已经发生的击杀，但不能把未完成尾部标成完整。

`generic_sampling_cursor.go`只在战斗时点之间和同刻全部提交后观察，独立于`scheduler.GenericHeap`。调整或关闭采样、截断记录都不改变战斗时钟、事件预算或可靠汇总。具体运行字段与验收以规划工作树阶段2设计及验收记录为准，本图不另定义契约。

## 主动过程运行链

阶段6C `generic_skill_actions.go` 的有限行动列表与现有普攻事件堆共用时钟，使用引用索引关联每项真实过程及其已接受首次指令。后续控制调用真实阶段能力，转移提交后接受；首次只发布一次成功开始事件。普通过程成功完成或唯一末尾复杂步骤的实际执行，在该转移同步尾部生成同一使用的独立命中事实，不另排宿主计时器或预加载成功事实。`generic_process_repeat.go`冻结有限分段并只调度下一真实时点，快照保存进度及占用历史。`generic_action_occupancy.go`从已提交活动步骤派生许可，共同提交预检用待提交实例核对安全期限与唯一下一刀的队列容量；提前控制按实际退出唤醒，旧步骤与段序守卫防重复释放。占用、普通冷却与弹药恢复共同约束下一刀，不重复建立时钟。直接治疗与实际扣血在原帧提交时累计，行动、使用、治疗记录预算只控制保留数量。当前通用机制验证不等于候选业务对象已录入或已通过真实联调；详细契约以规划真源阶段6设计为准。

`model/generic_process.go` 固定第4项过程、控制事实与实例快照；`compile/generic_process.go` 编译步骤时间、逐笔成本和有序时点操作。`runtime/generic_process.go` 负责单次控制入口、暂存付款、统一时点和终结；`runtime/generic_process_snapshot.go` 负责严格恢复与计时重建。

`generic_process_repeat.go`（有限分段执行）在引导实际进入时冻结指定窗口的首末偏移、次数及完整时长，只安排下一段或最后一段后的完整期限事件。旧引导仍直接按冻结完整时长与原首次口径计算，各段不依赖已舍入的证明端点。`generic_process_snapshot.go`（过程恢复）按真实步骤口径校验两项偏移、计数、最后／下一执行时刻及完整占用；终结不恢复下一段，变化后的作者表达式不能重写冻结历史。

首次控制使用一个执行帧检查全部成本，再生成稳定使用归属的实例。阶段推进复用首次拥有者、挂载、目标和能力分类，数值仍经现有操作与管道；时点帧提交后按首次完整能力引用累计伤害和治疗。成本供值仅在所属完成/失败时点开放。

过程计时采用独立事件类别，同刻先于推进。实例索引与步骤版本让旧事件失效；拥有者、挂载、过程和使用组成可重建的同刻排序键，因此中途恢复与连续执行顺序一致。死亡结算先冻结全部受影响实例，再执行失败效果并检查连带死亡。

实例快照保存活动和终结记录，独立预算不遗忘已开始的使用。恢复只重建当前步骤所需计时，不恢复整个事件堆；到期等于快照时间仍入队处理，过去期限拒绝。过程相关运行拒绝任何过去驱动，避免普通伤害或第5项命中使时间倒退。
