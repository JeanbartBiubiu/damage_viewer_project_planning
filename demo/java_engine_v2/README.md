# Java Engine V2 Demo

> 纯 Java 数据驱动的 1v1 战斗模拟引擎原型，面向 LoL 等 MOBA 的伤害 / 战斗计算场景。

## 设计理念

| 原则 | 说明 |
|---|---|
| **完全数据驱动** | 角色、技能、公式、触发器全部以模板声明，引擎不硬编码任何具体游戏机制 |
| **中央事件队列** | 主循环从优先队列取事件，Actor / Skill 不主动推进时间 |
| **Command 闭环** | 所有 runtime 变更经 `EngineCommand` 通道，trigger 反馈也回流到同一条命令执行链 |
| **统一节奏模型** | 冷却、充能、自动重复以及触发式节奏修改由同一个 `CadenceSubsystem` 统管 |
| **零运行时依赖** | 生产代码只依赖 Java 标准库 |

## 技术栈

- **Java 21**（records、sealed interfaces、pattern matching switch）
- **Maven** 构建
- **JUnit 5.10.2**（唯一外部依赖，仅测试）

## 快速开始

```bash
# 编译
mvn compile

# 运行全部测试（55 tests）
mvn test

# 打包
mvn package
```

## 引擎生命周期

```
init(bundle)                         run(session, input)
┌──────────────────────┐             ┌──────────────────────────────────┐
│ EngineBundle          │             │ EngineRunInput                   │
│ (模板 / 公式 / 触发器) │──compile──▶│ (角色实例 / 初始动作 / 停止条件)  │
│                       │    │        │                                  │
└──────────────────────┘    │        └──────────┬───────────────────────┘
                            ▼                   │
                     EngineSession              ▼
                     (CompiledSnapshot     主循环：poll → dispatch → 命令执行
                      + 子系统)                  │
                                                ▼
                                         EngineRunResult
                                         (快照 / 日志 / 停止原因)
```

### `init(bundle) → EngineSession`

`BundleCompiler` 将声明式配置编译为 `CompiledSnapshot`，并在编译期：
- 验证所有公式引用
- 验证角色→动作引用
- 构建 `TriggerIndex`（按 TriggerType 索引所有订阅）

随后创建各子系统实例并组装依赖关系，返回不可变的 `EngineSession`。

### `run(session, input) → EngineRunResult`

1. 基于 `CompiledSnapshot` 实例化角色运行时、创建双向 PairState
2. 初始状态过期事件 + 初始动作入队
3. **主循环**——按 `(time → priority → sequence)` 从优先队列取事件，通过 `EventDispatcher` 分发：
   - `ActionCast` → 动作校验 → 冷却 / 充能 / 资源检查 → 公式求值 → 触发器 → 伤害管线
   - `StatusExpire` → 状态移除 → 派生 `ON_STATUS_EXPIRED` 触发器
4. 终止条件：队列为空（`queue_empty`）或达到 `maxEvents`（`max_events`）

## 包结构

```
xyz.game.enginev2demo
├── api/                # 公共 API 类型——引擎输入输出契约 (12 文件)
├── action/             # 动作模板、选择 (ActionSelector) 与执行 (ActionExecutor) (6 文件)
├── cadence/            # 节奏子系统——CD + 充能 + 触发式节奏修改 (2 文件)
├── command/            # 统一命令层——EngineCommand (sealed, 11 种) + 执行器 (2 文件)
├── compile/            # 静态配置 → CompiledSnapshot 的编译 (2 文件)
├── control/            # 控制效果子系统 (眩晕 / 免控 / 零伤窗口) (1 文件)
├── counter/            # 计数器子系统 (N 次命中触发) (2 文件)
├── event/              # 中央事件队列 + 调度器 (4 文件)
├── formula/            # AST 公式引擎 (FormulaNode sealed, 13 种节点) (5 文件)
├── history/            # 时间窗口历史聚合 (近期受伤 / 控制时长) (1 文件)
├── mark/               # 标记子系统 (有向可消耗印记) (1 文件)
├── pipeline/           # 统一伤害管线 (穿透 → 抗性 → 减伤 → 护盾 → HP) (8 文件)
├── resource/           # 资源管理 (法力等可消耗资源) (1 文件)
├── runtime/            # 运行时可变状态 (RuntimeState / ActorRuntime / PairState) (17 文件)
├── shield/             # 护盾子系统 (3 文件)
├── trigger/            # 通用触发器分发 (8 种 TriggerType, 7 种 EffectDef) (9 文件)
├── EngineDemoFacade    # 门面入口
└── EngineSession       # 编译产物 + 子系统持有体
```

## 核心 API

### 输入

| 类型 | 用途 |
|---|---|
| `EngineBundle` | 静态配置包：角色 / 动作 / 装备 / 状态模板 + 公式定义 |
| `ActorTemplate` | 角色模板：基础属性、资源、可用动作、触发订阅 |
| `ActionTemplate` | 动作模板：伤害类型、公式、冷却、充能、标签、资源消耗、施放门控 |
| `ItemTemplate` | 装备模板：触发订阅 |
| `StatusTemplate` | 状态模板：种类、持续时间、刷新策略、触发订阅 |
| `EngineRunInput` | 本次模拟输入：双方角色实例、初始动作序列、停止条件 |
| `CombatantRunInit` | 角色实例：模板 ID、装备列表、初始状态列表 |
| `ActionRequest` | 初始动作：触发时间、来源 / 目标 / 动作 ID |

### 输出

| 类型 | 用途 |
|---|---|
| `EngineRunResult` | 模拟结果：各角色终态快照、全量日志、终止原因 |
| `ActorSnapshot` | 角色终态：当前 HP、护盾量、属性 |
| `EngineLogEntry` | 日志条目（`ActionLogEntry` / `DamageLogEntry` / `ShieldLogEntry`） |

## 子系统

### 节奏 (Cadence)

统一管理动作冷却、充能和触发式节奏修改的核心子系统。

**冷却模型**：所有动作统一通过 `cooldownFormulaId` 计算冷却时长。`autoRepeat=true` 的动作成功施放后引擎自动安排下次施放（典型用途：普通攻击按攻速公式 `1000 / attack_speed` 循环）。

**充能模型**：`maxCharges >= 2` 的动作拥有多层充能，每次施放消耗一层并启动回充计时（回充时长同 `cooldownFormulaId`）。回充完成时恢复一层充能。充能满时停止回充。

**触发式节奏修改**：通过 `ModifyCadenceEffect` 触发器效果，在命中 / 受击等事件后按动作标签（`tags`）匹配，对目标 Actor 的动作执行节奏修改。支持 6 种操作：

| CadenceOp | 语义 |
|---|---|
| `REDUCE_REMAINING_CD_FLAT_MS` | 固定毫秒数缩短剩余 CD |
| `REDUCE_REMAINING_CD_PERCENT` | 按百分比缩短剩余 CD |
| `RESET_CD` | 重置 CD（充能动作额外补满全部层数） |
| `GRANT_CHARGE` | 补充一层充能 |
| `REDUCE_RECHARGE_FLAT_MS` | 固定毫秒数加速回充进度 |
| `REDUCE_RECHARGE_PERCENT` | 按百分比加速回充进度 |

标签匹配规则：效果的 `targetActionTags` 与动作的 `tags` 取交集，有任一相同字符串即命中。

**阻断重试**：`autoRepeat` 动作被冷却阻断时按 `readyAtMs` 精确重排；被控制阻断时按最近 STUN 结束时刻重排；被资源 / 标记阻断时回退到冷却周期重试。手动施放被阻断直接抛 `IllegalStateException`（fail-fast）。

### 伤害管线 (Pipeline)

LoL 风格结算链：

```
原始伤害 → 穿透扣减(flat) → 有效抗性 → 减伤倍率 → 零伤窗口检查 → 护盾吸收 → HP 扣除
```

- 物理穿透 `armor_pen_flat`，法术穿透 `magic_pen_flat`
- 正抗性减伤：`100 / (100 + R)`；负抗性增伤：`2 - 100 / (100 - R)`
- 真实伤害 bypass 全部抗性
- 结算完成后派生 `ON_DAMAGE_DEALT` + `ON_DAMAGE_TAKEN` 触发事件

### 护盾 (Shield)

- `TAKE_MAX`：取当前值与请求值的较大值
- `REPLACE`：直接覆盖
- 伤害结算时先消耗最大活跃护盾

### 控制 (Control)

| StatusKind | 效果 |
|---|---|
| `STUN` | 阻止动作施放 |
| `CONTROL_IMMUNE` | 防止 STUN 被挂上 |
| `FORCE_DAMAGE_TO_ZERO` | 强制零伤窗口 |
| `SHIELD` | 护盾状态 |

### 触发器 (Trigger)

引擎最核心的扩展机制，支持 4 种归属作用域 × 8 种触发事件 × 7 种效果：

**触发事件**：`ON_ACTION_CAST` · `ON_DAMAGE_DEALT` · `ON_DAMAGE_TAKEN` · `ON_STATUS_APPLIED` · `ON_STATUS_EXPIRED` · `ON_COUNTER_THRESHOLD` · `ON_MARK_APPLIED` · `ON_MARK_CONSUMED`

**效果**：`DealDamage` · `GrantShield` · `ApplyStatus` · `ApplyMark` · `ConsumeMark` · `ModifyCounter` · `ModifyCadence`

**归属**：`ACTOR` · `ITEM` · `ACTION` · `STATUS`

### 公式引擎 (Formula)

基于 AST 的声明式公式系统，13 种节点类型：

`Constant` · `Attr` · `InputValue` · `Add` · `Multiply` · `Divide` · `Min` · `Max` · `SignSwitch` · `RecentDamageTaken` · `RecentControlDuration` · `CounterValue` · `ResourceValue`

### 其他子系统

- **计数器 (Counter)**：`ACTOR` / `PAIR` 作用域，达到阈值触发 `ON_COUNTER_THRESHOLD`，支持 `NONE` / `ZERO` 重置模式
- **标记 (Mark)**：有向可消耗印记，支持懒过期，可作为动作施放门控 (`RequireMarkGate`)
- **历史 (History)**：时间窗口聚合——`recentDamageTaken()` 和 `recentControlDuration()`，为"基于近期事件"的公式和触发提供数据

## ActionTemplate 字段

```java
record ActionTemplate(
    String actionId,          // 唯一标识
    String label,             // 显示名
    String damageProfileId,   // 伤害类型配置引用
    String formulaId,         // 伤害数值公式引用
    String cooldownFormulaId, // 冷却时长公式引用（必填）
    boolean autoRepeat,       // 施放成功后自动安排下次
    int maxCharges,           // 充能层数（>=1，1=非充能）
    List<String> tags,        // 标签（用于节奏修改匹配）
    Map<String,Double> resourceCosts,       // 资源消耗
    List<ActionGateDef> actionGates,        // 施放门控
    List<TriggerSubscriptionDef> triggerSubscriptions  // 动作级触发器
)
```

## 测试覆盖

55 个测试方法，分为端到端场景、机制单元测试与节奏修改测试。测试数据全部通过 Java 代码构造（`DemoFixtures` 工厂），无外部 JSON 文件。

### 端到端场景

| 场景 | 验证内容 |
|---|---|
| **Sett W** | 历史窗口 → 护盾授予 → 真实伤害 |
| **Akali E** | 标记施加 → 门控检查 → 标记消耗 → 二段 |
| **荆棘甲** | 装备触发反伤 (item-owned ON_DAMAGE_TAKEN) |
| **三层被动** | 计数器 → 阈值触发 → 额外伤害 |
| **竞技场 CC 阈值** | 控制历史 → 条件触发 → CC 免疫 |
| **攻速影响普攻节奏** | 攻速 buff → CD 公式重算 → 自动普攻间隔变化 |
| **Benchmark 战斗时序** | 长回合模拟烟雾测试 |
| **临时最大生命** | buff 授予 → buff 过期 → HP 钳位 |

### 动作节奏测试

| 场景 | 验证内容 |
|---|---|
| **统一 CD 公式** | 非普攻技能走 `cooldownFormulaId` 路径 |
| **CD 公式读 resolved attr** | 冷却公式引用即时属性值 |
| **CD 阻断按 readyAt 重排** | autoRepeat 冷却中精确重排到就绪时刻 |
| **永久控制不 busy-loop** | 永久 STUN 不导致无限重排 |
| **手动施放阻断 fail-fast** | 非 autoRepeat 被阻断直接抛异常 |
| **已入队普攻保留旧时刻** | 重复入队不覆盖已有 schedule |

### 节奏修改 (Cadence Trigger) 测试

| 场景 | 验证内容 |
|---|---|
| **命中缩短 source CD** | ON_DAMAGE_DEALT 触发 REDUCE_REMAINING_CD_FLAT_MS |
| **受击缩短 target CD** | ON_DAMAGE_TAKEN 触发 REDUCE_REMAINING_CD_FLAT_MS |
| **重置 CD** | RESET_CD 使技能立即可用 |
| **已就绪不受影响** | CD 缩短对已就绪动作无效 |
| **充能消耗与回充** | maxCharges>1 消耗层数 + 启动回充计时 |
| **命中补充充能** | GRANT_CHARGE 触发补一层 |
| **缩短回充进度** | REDUCE_RECHARGE_FLAT_MS 加速回充 |
| **重置充能补满** | RESET_CD 对充能动作补满所有层数 |
| **双侧同时触发** | 同一次伤害触发 source 和 target 的节奏效果 |
| **标签精确匹配** | 仅标签命中的动作被修改 |
| **多标签任一匹配** | 效果配置多个标签时任一命中即生效 |

### 机制单元测试

基础物理攻击 · 护甲穿透 · 法术减伤 · 护盾吸收 · 护盾刷新策略 · 眩晕阻止施放 · 零伤窗口 · 冷却阻止 · 法力不足 · 标记消耗 · RequireMarkGate · 计数器阈值重置 · 时间窗口伤害聚合 · 时间窗口控制聚合 · 空队列 · Session 初始化 · 四种归属作用域的触发器 · 属性修改器组合 · 临时 MaxHP

## 项目统计

| 指标 | 数值 |
|---|---|
| 生产代码 | 78 个 Java 文件 |
| 测试代码 | 62 个 Java 文件（含工厂 / fixtures） |
| 测试方法 | 55 |
| 包数量 | 16 |
| sealed interface | 5（`EngineCommand` · `EffectDef` · `FormulaNode` · `ActionGateDef` · `InternalEvent`） |
| EngineCommand 子类型 | 11 |
| EffectDef 子类型 | 7 |
| FormulaNode 子类型 | 13 |
| TriggerType | 8 |
| CadenceOp | 6 |
| 运行时依赖 | 0 |
