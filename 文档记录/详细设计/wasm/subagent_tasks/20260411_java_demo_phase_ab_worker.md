TASK_KEY: wasm-engine-v2-architecture
DOC_TYPE: 任务单
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-04-11

# Java Demo Worker 子任务：独立项目骨架与 Phase A/B

## 任务目标

为通用战斗引擎 V2 新建一个独立的 Java demo 项目，并完成 Phase A / Phase B 的最小代码骨架：

- Phase A：骨架与最小运行时
- Phase B：主伤害链

目标不是一次把所有子系统写完，而是先把“独立项目 + 核心主链路”打通，为后续继续派发 `worker` 奠定基础。

## 适合的 sub-agent 角色

当前可用角色里，最适合承担这个子任务的是：

- `worker`

原因：

- 任务是新项目骨架和受限目录实现，不是后端 API 开发
- `backend_api_dev` 更偏接口、服务、数据模型和缓存，不适合拿来做独立战斗引擎 demo
- `worker` 更适合承担“明确目录责任 + 逐阶段落代码”的实现任务

辅助角色建议：

- `explorer`：只读检查仓库约定、目录落点、构建边界
- `test_engineer`：补 JUnit、回归和阶段验收

## 目录责任

本子任务的默认写入范围固定为：

- `demo/java_engine_v2/**`

默认不修改：

- `server/data_manage/**`
- `wasm/**`
- `web/**`

如果后续确实需要改仓库根配置或 CI，再单独开子任务，不在本任务里顺手带上。

## 项目落点

- 项目路径：`demo/java_engine_v2`
- 构建方式：独立 Maven 项目
- 包名前缀建议：`xyz.game.enginev2demo`

建议最少包含：

- `pom.xml`
- `src/main/java/...`
- `src/test/java/...`

## 参考文档

- `文档记录/概要设计/wasm/概要设计-通用战斗引擎V2架构.md`
- `文档记录/概要设计/wasm/概要设计-通用战斗引擎V2对象化建模适配.md`
- `文档记录/详细设计/wasm/详细设计-通用战斗引擎V2-Java Demo实现方案.md`
- `文档记录/详细设计/wasm/详细设计-通用战斗引擎V2-Java Demo任务拆解.md`

## 本子任务的交付范围

### Phase A：骨架与最小运行时

需要落的最小类：

- `EngineDemoFacade`
- `EngineSession`
- `EngineBundle`
- `EngineRunInput`
- `EngineRunResult`
- `RuntimeState`
- `ActorRuntime`
- `ActionRuntimeState`
- `PairRuntimeState`
- `ScheduledEvent`
- `InternalEvent`
- `EventDispatcher`
- `BundleCompiler`
- `CompiledSnapshot`

最小测试：

- `EngineSessionInitTest`
- `EmptyRunLoopTest`

### Phase B：主伤害链

需要补的最小类：

- `FormulaNode`
- `FormulaDefinition`
- `FormulaCatalog`
- `FormulaEvalContext`
- `FormulaService`
- `DamagePacket`
- `DamageResolvedEvent`
- `PipelineContext`
- `PipelineRunner`
- `ActionTemplate`
- `ActionSelector`
- `ActionExecutor`

最小测试：

- `BasicAttackDamageTest`
- `MagicDamageMitigationTest`
- `PhysicalPenetrationTest`

## 非目标

本子任务明确不做：

- trigger 分发
- 反甲
- 护盾
- 控制与霸体窗口
- 历史窗口
- 计数器
- 标记
- UI、WebWorker、WASM、JNI

这些属于后续 Phase C/D/E，不应在本任务里顺手扩张。

## 验收口径

本子任务完成时，应满足：

1. `demo/java_engine_v2` 可独立执行 Maven 测试
2. 可以完成 `bundle -> compile -> runtime -> event loop -> result` 的最小闭环
3. 可以完成一次基础 action 的 damage 结算
4. `server/data_manage` 没有被混入 demo 代码

## 给 worker 的派发口径

派发给 `worker` 时，建议直接带上下面 4 条约束：

1. 你只负责 `demo/java_engine_v2/**`
2. 不要把 Java demo 写进 `server/data_manage`
3. 先完成 Phase A/B，不提前做 Phase C 以后的 trigger/state 子系统
4. 最终回答必须列出你新增/修改的文件和通过的测试
