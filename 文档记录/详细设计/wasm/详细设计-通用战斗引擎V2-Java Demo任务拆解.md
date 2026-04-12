TASK_KEY: wasm-engine-v2-architecture
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-04-11

# 详细设计：通用战斗引擎 V2 Java Demo 任务拆解

> 日期：2026-04-11
> 状态：草案
> 前序：
> - [详细设计-通用战斗引擎V2-Java Demo实现方案.md](./详细设计-通用战斗引擎V2-Java%20Demo实现方案.md)
> - [概要设计-通用战斗引擎V2对象化建模适配.md](../概要设计/wasm/概要设计-通用战斗引擎V2对象化建模适配.md)

---

## 1. 文档目标

本文把 Java demo 实现方案继续压成“可执行任务”。

重点回答四个问题：

1. 先写哪些类，后写哪些类
2. 每一批类应该一起落，避免中途出现半成品孤岛
3. 每个阶段用什么样例和 JUnit 断言证明它是通的
4. 哪些东西这轮明确不做，避免 demo 范围膨胀

本文不是新的架构稿，只是实现任务分解。

---

## 2. 拆解原则

Java demo 任务拆解遵守下面 5 条：

1. 先打通中央主链路，再补子系统细节。
2. 每个阶段都必须有最小可运行样例，不接受“类都建了但跑不通”。
3. 所有子系统都通过 `TriggerEvent`、`EngineCommand`、`PipelineRunner` 接入，不允许写对象互调捷径。
4. 先覆盖能证明架构边界的代表机制，再考虑机制广度。
5. 每一阶段都能独立合并，不依赖“大爆炸式收口”。

---

## 3. 交付策略

建议把 Java demo 拆成 5 个阶段。

| 阶段 | 目标 | 结果 |
|------|------|------|
| Phase A | 跑通骨架 | 能初始化 session，推进空事件循环 |
| Phase B | 跑通主伤害链 | 能执行普攻/技能、减伤、护盾、日志 |
| Phase C | 跑通触发链 | 能通过 trigger 产生命令并回流到伤害链 |
| Phase D | 跑通状态类子系统 | 能承载控制、历史窗口、计数器、标记 |
| Phase E | 跑通代表样例 | 5 个样例至少通过核心断言 |

推荐顺序不能乱。尤其不能跳过 Phase C 直接写 Phase D，因为很多状态类子系统最终都依赖 trigger 回流。

## 3.1 默认项目路径

Java demo 默认按独立项目处理：

- 项目路径：`demo/java_engine_v2`
- 构建方式：独立 `pom.xml`
- 不挂到 `server/data_manage`

实现时的默认文件责任边界也按这个路径执行：

- `worker` 只负责 `demo/java_engine_v2/**`
- 不修改 `server/data_manage/**`
- 不改 `wasm/katarina_mvp_engine/**`

---

## 4. Phase A：骨架与最小运行时

## 4.1 目标

先搭出“bundle -> compile -> runtime -> event loop -> result”的空骨架。

## 4.2 需要落的文件

### `api`

- `EngineBundle.java`
- `EngineRunInput.java`
- `EngineRunResult.java`
- `StopCondition.java`
- `EngineLogEntry.java`

### `compile`

- `BundleCompiler.java`
- `CompiledSnapshot.java`

### `runtime`

- `RuntimeState.java`
- `ActorRuntime.java`
- `ActionRuntimeState.java`
- `PairRuntimeState.java`

### `event`

- `ScheduledEvent.java`
- `InternalEvent.java`
- `EventDispatcher.java`

### 门面

- `EngineSession.java`
- `EngineDemoFacade.java`
- `demo/java_engine_v2/pom.xml`

## 4.3 这阶段暂时可以留空的东西

- 公式真正求值
- 伤害包
- trigger 分发
- 护盾、控制、计数器、历史值

## 4.4 最小验收口径

JUnit 至少要有：

- `EngineSessionInitTest`
- `EmptyRunLoopTest`

断言目标：

1. `init(bundle)` 能成功生成 `CompiledSnapshot`
2. `run(input)` 能生成 `RuntimeState`
3. 空事件队列能正常退出
4. 停止原因和空日志结构可用

---

## 5. Phase B：主伤害链

## 5.1 目标

让一次主动 action 可以真正结算伤害，并走完统一 damage 通道。

## 5.2 需要新增的文件

### `formula`

- `FormulaNode.java`
- `FormulaDefinition.java`
- `FormulaCatalog.java`
- `FormulaEvalContext.java`
- `FormulaService.java`

### `pipeline`

- `DamagePacket.java`
- `DamageResolvedEvent.java`
- `PipelineContext.java`
- `PipelineRunner.java`

### `action`

- `ActionTemplate.java`
- `ActionSelector.java`
- `ActionExecutor.java`

### 运行日志

- `DamageLogEntry.java`
- `ActionLogEntry.java`

## 5.3 最小功能范围

公式先只支持：

- `Constant`
- `Attr`
- `InputValue`
- `Add`
- `Multiply`
- `Min`
- `Max`

伤害链先只支持：

1. raw damage
2. 穿透/抗性
3. HP 扣减
4. 日志记录

此阶段先不做：

- 暴击
- 护盾
- 反甲
- trigger

## 5.4 最小验收口径

JUnit 至少要有：

- `BasicAttackDamageTest`
- `MagicDamageMitigationTest`
- `PhysicalPenetrationTest`

断言目标：

1. 普攻能正确扣血
2. 物理和魔法减伤走不同链路
3. 属性读取和公式求值已接通
4. `EngineLogEntry` 中能看到动作和伤害记录

---

## 6. Phase C：触发链与命令回流

## 6.1 目标

让引擎具备“某次结算后派生 trigger，再产出新的 effect command”的闭环。这一阶段完成后，反甲和护盾猛击这类被动才有真正落点。

## 6.2 需要新增的文件

### `event`

- `TriggerType.java`
- `TriggerEvent.java`
- `TriggerSubscription.java`
- `TriggerIndex.java`
- `TriggerDispatcher.java`

### `action`

- `EffectHandle.java`
- `EffectContext.java`
- `EffectExecutor.java`
- `EngineCommand.java`
- `EngineCommandExecutor.java`

### `pipeline`

- `HealPacket.java`
- `ModifierCommand.java`

## 6.3 命令类型最小集

Java demo 第一版建议只做下面几类：

- `DealDamageCommand`
- `GrantShieldCommand`
- `ApplyStatusCommand`
- `ModifyCounterCommand`
- `ScheduleEventCommand`

## 6.4 最小功能范围

这一阶段要打通的不是“所有触发”，而是统一模式：

1. `PipelineRunner` 结算后产出 `TriggerEvent`
2. `TriggerDispatcher` 查索引
3. `EffectExecutor` 返回 `EngineCommand`
4. `EngineCommandExecutor` 再执行命令

## 6.5 最小验收口径

JUnit 至少要有：

- `ThornmailReflectTest`
- `ShieldBashProcTest`

断言目标：

1. 反甲通过 `ON_DAMAGE_TAKEN` 触发，不是写死在普攻逻辑里
2. 产出的反击伤害仍然回到统一伤害链
3. 一个 effect 可以通过 command 产出伤害或护盾，不需要对象互调

---

## 7. Phase D：状态类子系统

## 7.1 目标

把 V2 里最关键的“状态型能力”补齐：护盾、控制、历史窗口、计数器、标记、资源/冷却。

## 7.2 建议拆成 6 个子批次

### D1 护盾

需要文件：

- `StatusTemplate.java`
- `StatusInstance.java`
- `ShieldSubsystem.java`

验收：

- `ShieldAbsorbBeforeHpTest`
- `ShieldRefreshPolicyTest`

### D2 控制与防御窗口

需要文件：

- `ControlSubsystem.java`
- `DefensiveWindowState.java`

验收：

- `StunBlocksActionTest`
- `DefensiveWindowForcesZeroDamageTest`

### D3 历史窗口

需要文件：

- `HistoryWindowState.java`
- `DamageRecord.java`
- `ControlRecord.java`
- `HistorySubsystem.java`

验收：

- `RecentDamageWindowAggregateTest`
- `RecentControlDurationAggregateTest`

### D4 计数器

需要文件：

- `CounterState.java`
- `CounterSubsystem.java`

验收：

- `EveryThirdHitCounterTest`
- `ThresholdProcResetTest`

### D5 标记与 pair state

需要文件：

- `PairKey.java`
- `MarkState.java`
- `MarkSubsystem.java`

验收：

- `AkaliE2RequiresMarkTest`
- `MarkConsumeRemovesAvailabilityTest`

### D6 冷却与资源

需要文件：

- `CooldownResourceSubsystem.java`
- `ResourceState.java`

验收：

- `ManaBlocksCastTest`
- `CooldownBlocksRepeatCastTest`

## 7.3 顺序要求

这 6 个子批次的推荐顺序是：

1. D1 护盾
2. D6 冷却与资源
3. D2 控制与防御窗口
4. D3 历史窗口
5. D4 计数器
6. D5 标记与 pair state

原因：

- 护盾和冷却/资源最基础，影响所有后续样例
- 历史值和计数器要在触发链后补，不然会出现状态有了、却没有统一触发回流的尴尬

---

## 8. Phase E：代表样例与 Demo 完整验收

## 8.1 目标

这一步不是补更多机制，而是用 5 个代表样例验证前四个阶段的组合正确性。

## 8.2 需要落的 sample/fixture 文件

### `sample`

- `ThornmailSampleFactory.java`
- `SettWSampleFactory.java`
- `AkaliESampleFactory.java`
- `BraumBrandSampleFactory.java`
- `ArenaCcThresholdSampleFactory.java`

### `test`

- `ThornmailEndToEndTest`
- `SettWEndToEndTest`
- `AkaliEEndToEndTest`
- `CounterProcEndToEndTest`
- `ArenaCcThresholdEndToEndTest`

## 8.3 每个样例的主断言

### 反甲

- 触发源是 `ON_DAMAGE_TAKEN`
- 反伤伤害类型正确
- 反伤日志独立记录

### 瑟提 W

- 最近承伤聚合值正确
- 先获得护盾，再造成伤害
- 同一 action 可以同时产出 shield 和 damage command

### 阿卡丽 E

- E1 产生 mark
- E2 在无 mark 时不可施放
- E2 消费 mark 后不可再次使用

### 布隆/布兰德

- 命中次数累计正确
- 阈值达到后才触发额外效果
- 触发后计数器按设计重置

### 被控累计获霸体

- 最近 N 秒控制时长累计正确
- 达阈值后挂上 defensive window
- defensive window 生效后新的控制或伤害链表现正确

---

## 9. 文件级责任拆分

为了避免实现时文件互相缠死，建议按责任拆：

### 主链路责任

- `EngineDemoFacade`
- `EngineSession`
- `RuntimeState`
- `EventDispatcher`
- `PipelineRunner`
- `EngineCommandExecutor`

### 配置/编译责任

- `BundleCompiler`
- `CompiledSnapshot`
- `FormulaCatalog`
- `TriggerIndexBuilder`

### 状态归属责任

- `ActorRuntime`
- `ActionRuntimeState`
- `PairRuntimeState`
- `StatusInstance`
- `HistoryWindowState`
- `CounterState`

### 子系统责任

- `ShieldSubsystem`
- `ControlSubsystem`
- `HistorySubsystem`
- `CounterSubsystem`
- `MarkSubsystem`
- `CooldownResourceSubsystem`

### 样例责任

- `*SampleFactory`
- `*EndToEndTest`

一个实现批次最好只横跨 2 到 3 类责任，不要一次改全链路所有文件。

---

## 10. 推荐的提交切片

如果后续真的进入实现，我建议按下面的提交切片推进：

1. `demo-core-skeleton`
2. `demo-formula-and-basic-damage`
3. `demo-trigger-and-command-loop`
4. `demo-shield-and-resource`
5. `demo-control-and-defensive-window`
6. `demo-history-and-counter`
7. `demo-mark-and-pair-state`
8. `demo-sample-fixtures-and-e2e-tests`

每个切片都应满足：

- 编译通过
- 至少新增 1 到 2 个 JUnit 用例
- 不引入临时性的对象互调捷径

---

## 11. 最小验收矩阵

| 能力 | Phase | 验收测试 |
|------|-------|----------|
| 空事件循环 | A | `EmptyRunLoopTest` |
| 基础伤害链 | B | `BasicAttackDamageTest` |
| 穿透/减伤 | B | `PhysicalPenetrationTest` |
| trigger -> command -> damage 回流 | C | `ThornmailReflectTest` |
| 护盾吸收 | D1 | `ShieldAbsorbBeforeHpTest` |
| 资源/冷却拦截 | D6 | `ManaBlocksCastTest` |
| 控制阻断 | D2 | `StunBlocksActionTest` |
| 0伤害窗口 | D2 | `DefensiveWindowForcesZeroDamageTest` |
| 最近承伤 | D3 | `RecentDamageWindowAggregateTest` |
| 计数阈值触发 | D4 | `EveryThirdHitCounterTest` |
| 标记解锁技能 | D5 | `AkaliE2RequiresMarkTest` |

只要这个矩阵大部分通过，Java demo 就已经具备“证明 V2 主架构可落地”的价值。

---

## 12. 明确不做的内容

本轮拆解明确不把下面这些塞进 Java demo 第一版：

- 多人战斗
- 召唤物和伙伴 AI
- 复活链
- 商店、铁砧、loadout 替换
- 完整公式 DSL
- 图形界面
- WebWorker / WASM / JNI
- 复杂随机技能树和插件化脚本

这些不做，不代表以后不支持；只是它们不是用来证明当前 V2 架构的最短路径。

---

## 13. 下一步建议

如果继续推进，最自然的下一份文档不是再写概念，而是二选一：

1. `Java demo 类图 + 接口草图`
2. `Java demo Phase A/B 代码骨架任务单`

我更建议先写第 2 个，因为它可以直接指导开工。
