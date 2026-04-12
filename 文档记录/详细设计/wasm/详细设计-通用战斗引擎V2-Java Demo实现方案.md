TASK_KEY: wasm-engine-v2-architecture
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-04-11

# 详细设计：通用战斗引擎 V2 Java Demo 实现方案

> 日期：2026-04-11
> 状态：草案
> 对应概要设计：
> - [概要设计-通用战斗引擎V2架构.md](../概要设计/概要设计-通用战斗引擎V2架构.md)
> - [概要设计-通用战斗引擎V2对象化建模适配.md](../概要设计/概要设计-通用战斗引擎V2对象化建模适配.md)

---

## 1. 文档目标

本文不追求把 V2 所有能力一次写全，而是定义一个能跑起来、能体现关键子系统职责、能用 Java 快速做交互演示和机制验证的 demo 实现方案。

目标：

- 用 Java 把 V2 的核心执行拓扑落成可运行 demo
- 保留“对象化状态组织 + 中央事件管线执行”的架构口径
- 优先覆盖能体现子系统价值的代表性机制
- 让后续从 Java demo 迁移到 Rust/WASM 时，核心对象边界和执行顺序不需要推翻

不追求：

- 完整的多游戏生产级抽象
- 完整的 DSL 编译器
- WASM ABI、Worker、流式输出
- 竞技场全部海克斯、复活、召唤物、商店与 loadout 元逻辑

---

## 2. Demo 范围

## 2.1 固定边界

- 只做 `1v1`
- 单线程、同步执行
- 一次 `run` 从初始状态推进到停止条件
- 输入可以是 JSON，也可以先用 Java builder/fixture 直接构造
- 输出先以结果对象 + 日志列表 + JUnit 断言为主

## 2.2 Demo 必做能力

Java demo 最少实现下面这些能力：

1. 属性存储与公式求值
2. 中央事件队列
3. Action 执行与冷却/资源检查
4. Damage 通道
5. Trigger 分发
6. 护盾
7. 控制与霸体/0伤害窗口
8. 历史窗口
9. 计数器与阈值触发
10. 标记与每目标状态

## 2.3 用来证明架构有效的代表样例

| 样例 | 主要体现的子系统 |
|------|------------------|
| 反甲回击 | trigger + damage pipeline + item passive |
| 瑟提 W | history window + shield + damage |
| 阿卡丽 E1/E2 | mark state + action gate |
| 布隆/布兰德被动 | counter + threshold proc |
| “N 秒内被控超过 M 秒获得霸体” | history window + counter + defensive window |

这些样例够用来证明：

- 子系统是挂在统一执行内核上的
- 对象化状态没有破坏中央事件流
- 触发、状态、历史值、伤害四通道能互相衔接

---

## 3. 总体实现口径

Java demo 采用下面这个混合模型：

- `ActorRuntime`、`ActionRuntimeState`、`StatusInstance`、`PairRuntimeState` 用对象聚合状态
- `PriorityQueue<ScheduledEvent>` 统一管理所有时序
- `PipelineRunner` 统一执行伤害/回复/护盾/修改器通道
- `TriggerIndex` 统一管理被动和状态订阅
- 子系统通过 handler/service 接口挂到引擎，不直接互相调用

核心原则：

1. 对象负责“状态归属”
2. 中央引擎负责“执行顺序”
3. 公式负责“算值”
4. action/effect 负责“改状态”

---

## 4. Java 包结构建议

## 4.0 项目落点建议

Java demo 不应放进 `server/data_manage`。

原因：

- `server/data_manage` 是后端 API 服务，不是战斗引擎 demo 容器
- 如果把 demo 塞进去，会把 API 服务依赖、Spring Boot 生命周期和 demo 引擎主链路混在一起
- Java demo 的目标是快速验证 V2 内核，不是复用后端服务工程

建议新起一个独立项目：

- 项目路径：`demo/java_engine_v2`
- 构建方式：独立 `pom.xml`
- 包名前缀建议：`xyz.game.enginev2demo`

这样做的好处：

- 与后端服务隔离
- 后续可独立演进、删除或迁移
- 更适合交给通用 `worker` sub-agent 做受限目录开发

## 4.1 Java 包结构建议

```text
com.example.engine.demo
  ├─ api
  │   ├─ EngineBundle.java
  │   ├─ EngineRunInput.java
  │   ├─ EngineRunResult.java
  │   └─ EngineLogEntry.java
  ├─ compile
  │   ├─ BundleCompiler.java
  │   ├─ CompiledSnapshot.java
  │   └─ TriggerIndexBuilder.java
  ├─ runtime
  │   ├─ RuntimeState.java
  │   ├─ ActorRuntime.java
  │   ├─ PairRuntimeState.java
  │   ├─ ActionRuntimeState.java
  │   ├─ StatusInstance.java
  │   ├─ ExecutionInstance.java
  │   └─ HistoryWindowState.java
  ├─ event
  │   ├─ InternalEvent.java
  │   ├─ TriggerEvent.java
  │   ├─ ScheduledEvent.java
  │   ├─ EventDispatcher.java
  │   └─ TriggerDispatcher.java
  ├─ formula
  │   ├─ FormulaNode.java
  │   ├─ FormulaCatalog.java
  │   ├─ FormulaService.java
  │   └─ FormulaEvalContext.java
  ├─ pipeline
  │   ├─ DamagePacket.java
  │   ├─ HealPacket.java
  │   ├─ ModifierCommand.java
  │   ├─ PipelineContext.java
  │   └─ PipelineRunner.java
  ├─ subsystem
  │   ├─ SubsystemHandler.java
  │   ├─ ShieldSubsystem.java
  │   ├─ ControlSubsystem.java
  │   ├─ HistorySubsystem.java
  │   ├─ CounterSubsystem.java
  │   ├─ MarkSubsystem.java
  │   └─ CooldownResourceSubsystem.java
  ├─ action
  │   ├─ ActionSelector.java
  │   ├─ ActionExecutor.java
  │   └─ EffectExecutor.java
  └─ sample
      ├─ ThornmailSampleFactory.java
      ├─ SettWSampleFactory.java
      └─ AkaliESampleFactory.java
```

说明：

- `api` 放静态 DTO，不带运行时可变状态
- `compile` 负责把配置变成可执行快照
- `runtime` 放对象化状态容器
- `event` 和 `pipeline` 是中央内核
- `subsystem` 是可插拔功能层
- `sample` 放 demo 样例构造器和 JUnit fixture

---

## 5. 核心数据结构

## 5.1 静态输入层

Java demo 不必一开始就接完整前端 bundle，但输入结构要和 V2 思路一致：

```java
public record EngineBundle(
        List<AttributeDefinition> attributeDefinitions,
        List<ActorTemplate> actorTemplates,
        List<ActionTemplate> actionTemplates,
        List<ItemTemplate> itemTemplates,
        List<StatusTemplate> statusTemplates,
        List<FormulaDefinition> formulas,
        List<TriggerSubscriptionDef> triggerSubscriptions) {
}
```

```java
public record EngineRunInput(
        long seed,
        StopCondition stop,
        CombatantRunInit self,
        CombatantRunInit enemy) {
}
```

这里先允许 demo 用 builder 直接造数据，但结构上仍保留“bundle + run input”两层。

## 5.2 编译快照层

```java
public final class CompiledSnapshot {
    private final FormulaCatalog formulaCatalog;
    private final TriggerIndex triggerIndex;
    private final Map<String, ActorTemplate> actorTemplates;
    private final Map<String, ActionTemplate> actionTemplates;
    private final Map<String, ItemTemplate> itemTemplates;
}
```

职责：

- 校验公式引用和模板引用
- 把 trigger 订阅表编译成按事件类型索引的结构
- 预先整理 action、item、status 模板

## 5.3 运行时状态层

```java
public final class RuntimeState {
    long nowMs;
    RandomSequenceRegistry rng;
    PriorityQueue<ScheduledEvent> queue;
    ActorRuntime selfActor;
    ActorRuntime enemyActor;
    Map<PairKey, PairRuntimeState> pairStates;
    List<EngineLogEntry> logs;
    EngineRunResultAccumulator result;
}
```

```java
public final class ActorRuntime {
    ActorId actorId;
    String templateId;
    Map<String, Double> attrs;
    Map<String, ActionRuntimeState> actions;
    List<ItemRuntimeRef> items;
    Map<String, StatusInstance> statuses;
    Map<String, CounterState> counters;
    Map<String, ResourceState> resources;
    HistoryWindowState history;
}
```

```java
public final class PairRuntimeState {
    ActorId source;
    ActorId target;
    Map<String, MarkState> marks;
    Map<String, Long> perTargetLockouts;
}
```

说明：

- `ActorRuntime` 用来装 actor 自己的状态
- `PairRuntimeState` 用来装“我对你”的状态，例如 mark、每目标锁窗
- `ActionRuntimeState` 只负责技能冷却、充能、阶段
- `StatusInstance` 负责 dot/shield/cc/defensive window 这类时态实例

---

## 6. 中央执行拓扑

## 6.1 引擎入口

```java
public final class EngineDemoFacade {

    public EngineSession init(EngineBundle bundle) { ... }

    public EngineRunResult run(EngineSession session, EngineRunInput input) { ... }
}
```

`EngineSession` 保存 `CompiledSnapshot`，`run` 时只实例化本次的 `RuntimeState`。

## 6.2 主循环

```java
while (!stopPolicy.shouldStop(state)) {
    ScheduledEvent event = state.queue.poll();
    if (event == null) {
        break;
    }

    state.nowMs = event.triggerAtMs();
    eventDispatcher.dispatch(state, event);
}
```

主循环是中央的，不交给对象。

## 6.3 统一 dispatch 原则

统一流程固定为：

1. 取出 `InternalEvent`
2. 读取当前上下文和相关 runtime 对象
3. 执行 action 或 subsystem handler
4. 生成 `DamagePacket / HealPacket / ModifierCommand / TriggerEvent / 新事件`
5. 回写状态、日志、采样

对象只作为被读取和被修改的宿主，不控制 dispatch。

---

## 7. 事件与触发系统

## 7.1 InternalEvent

Java demo 不需要一开始做完全动态事件模型，先用封闭类型就够：

```java
public sealed interface InternalEvent permits
        ActorDecideEvent,
        ActionCastEvent,
        ActionImpactEvent,
        StatusExpireEvent,
        DotTickEvent,
        IntentRecheckEvent {
}
```

说明：

- Java demo 阶段先用 `sealed interface + record`
- 等迁移到更强泛化阶段，再放宽为更配置驱动的 event payload

## 7.2 TriggerEvent

配置层可订阅的事件单独建模：

```java
public enum TriggerType {
    ON_ACTION_CAST,
    ON_DAMAGE_DEALT,
    ON_DAMAGE_TAKEN,
    ON_SHIELD_GAINED,
    ON_STATUS_APPLIED,
    ON_COUNTER_THRESHOLD,
    ON_MARK_CONSUMED
}
```

```java
public record TriggerEvent(
        TriggerType type,
        ActorId sourceActor,
        ActorId targetActor,
        Map<String, Object> payload) {
}
```

## 7.3 TriggerIndex

```java
public final class TriggerIndex {
    private final Map<TriggerType, List<TriggerSubscription>> subscriptionsByType;
}
```

订阅记录里至少包含：

- owner scope：actor / item / status / action
- owner id
- 条件
- effect handle

这样一来，反甲、布隆被动、护盾猛击都只是不同的订阅配置，不需要对象互相直调。

---

## 8. 四通道与关键子系统

## 8.1 Damage 通道

这是 demo 的绝对核心。

建议统一入口：

```java
public final class PipelineRunner {
    public DamageResolvedEvent runDamage(RuntimeState state, DamagePacket packet) { ... }
    public HealResolvedEvent runHeal(RuntimeState state, HealPacket packet) { ... }
    public void applyModifier(RuntimeState state, ModifierCommand command) { ... }
}
```

伤害结算顺序固定为：

1. 取 `rawDamage`
2. 暴击资格与倍率
3. 增减伤修正
4. 穿透与抗性
5. 霸体/0伤害窗口
6. 护盾吸收
7. HP 扣减
8. 写日志
9. 派生 `on_damage_dealt / on_damage_taken`

Java demo 阶段可以不把每个 stage 都做成可插拔插件，但顺序必须固定。

## 8.2 Shield 子系统

职责：

- 管理护盾实例
- 负责刷新、覆盖、叠层策略
- 在 damage pipeline 的 shield 阶段被消费

最小实现：

```java
public final class ShieldSubsystem implements SubsystemHandler {
    public void grantShield(...);
    public double absorb(...);
    public void expire(...);
}
```

Java demo 建议先只支持：

- 单实例护盾
- 取大值刷新
- 过期移除

够演示即可。

## 8.3 Control / DefensiveWindow 子系统

职责：

- 管理 stun/root/silence/unstoppable/control_immune 等状态
- 决定 action 是否可执行
- 在 damage pipeline 中决定是否强制 0 伤害

关键点：

- `control_immune` 和 `force_damage_to_zero` 不一定是同一个状态，但都可以挂在 `StatusInstance`
- 行为阻断发生在 action 可执行性检查
- 伤害归零发生在 damage pipeline

## 8.4 History 子系统

职责：

- 记录最近承伤
- 记录最近被控时长
- 为“过去 N 秒”型技能和强化提供查询

最小结构：

```java
public final class HistoryWindowState {
    Deque<DamageRecord> recentDamage;
    Deque<ControlRecord> recentControl;
}
```

代表用途：

- 瑟提 W：读取最近承伤
- “N 秒内被控超过 M 秒获得霸体”：读取最近控制累计时长

## 8.5 Counter 子系统

职责：

- 维护技能、状态、被动的计数器
- 支持递增、重置、阈值触发

最小结构：

```java
public final class CounterState {
    int value;
    long lastUpdatedAt;
}
```

代表用途：

- 布隆被动第 4 次触发
- 布兰德被动到层后爆炸
- “每第三次攻击触发一次额外效果”

## 8.6 Mark 子系统

职责：

- 管理标记附着、武装、消费
- 支持按 `source-target` 维度挂状态
- 为技能解锁提供 action gate

最小结构：

```java
public final class MarkState {
    String markId;
    long armedAtMs;
    long expireAtMs;
    boolean consumable;
    Map<String, Object> payload;
}
```

代表用途：

- 阿卡丽 E1 命中后产生 `mark`
- 阿卡丽 E2 可用性检查读取 `PairRuntimeState.marks`
- 伊芙琳 W 通过 `armedAtMs` 管理成熟前后的不同收益

## 8.7 Cooldown / Resource 子系统

职责：

- 技能冷却
- 资源消耗
- 充能和返还

Java demo 先做最小版本：

- 固定冷却结束时间
- mana/energy 两种资源
- 可选的充能数

这部分更多是为了保证 action 系统能正常闭环。

---

## 9. 代表样例如何在引擎里落

## 9.1 反甲回击

反甲不应由受击者对象直接调用攻击者对象，而是按下面流程：

1. 普攻/技能命中产出 `DamagePacket`
2. `PipelineRunner.runDamage()` 完成伤害结算
3. 派生 `TriggerEvent(ON_DAMAGE_TAKEN)`
4. `TriggerIndex` 找到受击者物品上的 `thornmail_retaliate`
5. `EffectExecutor` 生成一个新的反向 `DamagePacket`
6. 反向 `DamagePacket` 再进入 `PipelineRunner`

这样能确保：

- 反甲伤害与普通伤害走同一条减伤/护盾/日志链路
- 不需要写对象互调

## 9.2 瑟提 W

落法：

1. 每次受到伤害都写入 `HistoryWindowState.recentDamage`
2. 施放 W 时从 history 中聚合最近 N 秒承伤
3. 同时产出：
   - 护盾 `grantShield`
   - 伤害 `DamagePacket`

这能直接证明 history 子系统和 shield/damage 两通道是联通的。

## 9.3 阿卡丽 E

落法：

1. E1 命中后，在 `PairRuntimeState(self, enemy)` 上挂 `MarkState`
2. E2 的 action gate 检查 mark 是否存在且可消费
3. E2 执行后消费该 mark

这能证明 pair 级状态确实有必要，不该全塞到 actor attrs。

## 9.4 布隆/布兰德被动

落法：

1. 命中后递增 `CounterState`
2. 达阈值派生 `TriggerEvent(ON_COUNTER_THRESHOLD)`
3. effect 执行 stun、爆炸或额外伤害
4. counter 重置

这能证明 counter 子系统不是“附属工具”，而是第一层运行时能力。

## 9.5 “N 秒内被控超过 M 秒获得霸体”

落法：

1. 每次受控状态进入和结束都写 `recentControl`
2. 每次控制变化后计算最近 N 秒累计受控时长
3. 达到阈值则挂一个 `control_immune` 或 `defensive_window` 状态

这能证明：

- history 不只看伤害
- control 与 defensive window 需要协同

---

## 10. 关键接口草案

## 10.1 子系统接口

```java
public interface SubsystemHandler {
    void onInit(RuntimeState state);
    void onInternalEvent(RuntimeState state, InternalEvent event, EngineServices services);
    void onTriggerEvent(RuntimeState state, TriggerEvent event, EngineServices services);
}
```

## 10.2 公式接口

```java
public interface FormulaService {
    double eval(String formulaId, FormulaEvalContext context);
}
```

## 10.3 effect 执行接口

```java
public interface EffectExecutor {
    List<EngineCommand> execute(EffectHandle handle, EffectContext context);
}
```

说明：

- effect 不直接改状态
- effect 产出 `EngineCommand`
- 中央引擎统一解释 `EngineCommand`

常见 command：

- `DealDamageCommand`
- `GrantShieldCommand`
- `ApplyStatusCommand`
- `ModifyCounterCommand`
- `ScheduleEventCommand`

这样 Java demo 会比较稳，也更接近后续可迁移到 Rust 的形态。

---

## 11. 推荐的最小类关系

```java
public final class EngineServices {
    FormulaService formulaService;
    PipelineRunner pipelineRunner;
    EventDispatcher eventDispatcher;
    TriggerDispatcher triggerDispatcher;
    EffectExecutor effectExecutor;
}
```

```java
public final class EventDispatcher {
    public void dispatch(RuntimeState state, ScheduledEvent scheduled) {
        InternalEvent event = scheduled.event();
        // 1. 读取运行时对象
        // 2. 执行 action/subsystem
        // 3. 产出 command 或 trigger
        // 4. 统一提交给 services
    }
}
```

```java
public final class TriggerDispatcher {
    public void dispatch(RuntimeState state, TriggerEvent trigger) {
        // 1. 查 TriggerIndex
        // 2. 对每个订阅执行 EffectExecutor
        // 3. 把产出的命令回送给中央执行层
    }
}
```

---

## 12. Demo 阶段的简化策略

为了尽快证明架构有效，Java demo 可以做这些简化：

1. 只支持两名 actor：`SELF`、`ENEMY`
2. 只支持 `double` 数值，不先上 BigDecimal
3. 公式节点先做最小集合：
   - `Constant`
   - `Attr`
   - `InputValue`
   - `Add`
   - `Multiply`
   - `Min`
   - `Max`
   - `DamageTakenInWindow`
4. trigger 条件先支持最小布尔判断，不急着做复杂条件树
5. pipeline 先写死核心顺序，不急着做阶段注册 DSL
6. status 先统一建模，不急着区分太多子类

不建议做的偷懒方式：

- 把反甲、瑟提 W、阿卡丽 E 都硬编码在 `if (skillId.equals(...))`
- 让 item/skill 对象直接互调
- 让每个子系统自己维护一套事件队列

这样虽然 demo 跑得快，但会把 V2 的关键边界破坏掉。

---

## 13. 推荐实施顺序

1. 先写 `api/compile/runtime` 三层模型
2. 写 `PriorityQueue<ScheduledEvent>` 和主循环
3. 写 `FormulaService` 最小节点集
4. 写 `PipelineRunner.runDamage()`
5. 写 `TriggerIndex + TriggerDispatcher`
6. 写 `ShieldSubsystem / CounterSubsystem / HistorySubsystem`
7. 写 `MarkSubsystem / ControlSubsystem / CooldownResourceSubsystem`
8. 最后补样例：
   - 反甲
   - 瑟提 W
   - 阿卡丽 E
   - 布隆/布兰德被动

做到这一步，Java demo 就已经足够证明：

- V2 的对象化建模是可行的
- 子系统能挂在统一引擎里工作
- 后续再迁移到 Rust/WASM 主要是语言实现问题，不是架构推翻

---

## 14. 本文的收口结论

面向 Java demo 的 V2 详细设计，应该坚持下面这句话：

**对象用于聚合运行时状态，中央事件流用于驱动执行，四通道用于统一结算，子系统通过 trigger 和 command 接入内核。**

只要这个边界不破，Java demo 可以写得足够直观，也不会和 V2 主架构冲突。
