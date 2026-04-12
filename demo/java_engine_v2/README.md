# Java Engine V2 Demo

> 纯 Java 数据驱动的 1v1 战斗模拟引擎原型，面向 LoL 等 MOBA 的伤害 / 战斗计算场景。

## 设计理念

| 原则 | 说明 |
|---|---|
| **完全数据驱动** | 角色、技能、公式、触发器全部以模板声明，引擎不硬编码任何具体游戏机制 |
| **中央事件队列** | 主循环从优先队列取事件，Actor / Skill 不主动推进时间 |
| **Command 闭环** | 所有 runtime 变更经 `EngineCommand` 通道，trigger 反馈也回流到同一条命令执行链 |
| **零运行时依赖** | 生产代码只依赖 Java 标准库 |

## 技术栈

- **Java 21**（records、sealed interfaces、pattern matching switch）
- **Maven** 构建
- **JUnit 5.10.2**（唯一外部依赖，仅测试）

## 快速开始

```bash
# 编译
mvn compile

# 运行全部测试
mvn test

# 打包
mvn package
```

## 引擎生命周期

引擎分为两个阶段：

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
   - `ActionCast` → 动作校验 → 公式求值 → 资源 / 冷却 → 触发器 → 伤害管线
   - `StatusExpire` → 状态移除 → 派生 `ON_STATUS_EXPIRED` 触发器
4. 终止条件：队列为空（`queue_empty`）或达到 `maxEvents`（`max_events`）

## 包结构

```
xyz.game.enginev2demo
├── api/                # 公共 API 类型——引擎输入输出契约
├── action/             # 动作选择 (ActionSelector) 与执行 (ActionExecutor)
├── command/            # 统一命令层——EngineCommand (sealed, 10 种) + 执行器
├── compile/            # 静态配置 → CompiledSnapshot 的编译
├── control/            # 控制效果子系统 (眩晕 / 免控 / 零伤窗口)
├── counter/            # 计数器子系统 (N 次命中触发)
├── event/              # 中央事件队列 + 调度器
├── formula/            # AST 公式引擎 (FormulaNode sealed, 11 种节点)
├── history/            # 时间窗口历史聚合 (近期受伤 / 控制时长)
├── mark/               # 标记子系统 (有向可消耗印记)
├── pipeline/           # 统一伤害管线 (穿透 → 抗性 → 减伤 → 护盾 → HP)
├── resource/           # 冷却与资源管理
├── runtime/            # 运行时可变状态 (RuntimeState / ActorRuntime / PairState)
├── shield/             # 护盾子系统
├── trigger/            # 通用触发器分发 (8 种 TriggerType, 6 种 EffectDef)
├── EngineDemoFacade    # 门面入口
└── EngineSession       # 编译产物 + 子系统持有体
```

## 核心 API

### 输入

| 类型 | 用途 |
|---|---|
| `EngineBundle` | 静态配置包：角色 / 动作 / 装备 / 状态模板 + 公式定义 |
| `ActorTemplate` | 角色模板：基础属性、资源、可用动作、触发订阅 |
| `ActionTemplate` | 动作模板：伤害类型、公式、冷却、资源消耗、施放门控 |
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

引擎最核心的扩展机制，支持 4 种归属作用域 × 8 种触发事件 × 6 种效果：

**触发事件**：`ON_ACTION_CAST` · `ON_DAMAGE_DEALT` · `ON_DAMAGE_TAKEN` · `ON_STATUS_APPLIED` · `ON_STATUS_EXPIRED` · `ON_COUNTER_THRESHOLD` · `ON_MARK_APPLIED` · `ON_MARK_CONSUMED`

**效果**：`DealDamage` · `GrantShield` · `ApplyStatus` · `ApplyMark` · `ConsumeMark` · `ModifyCounter`

**归属**：`ACTOR` · `ITEM` · `ACTION` · `STATUS`

### 公式引擎 (Formula)

基于 AST 的声明式公式系统，11 种节点类型：

`Constant` · `Attr` · `InputValue` · `Add` · `Multiply` · `Min` · `Max` · `RecentDamageTaken` · `RecentControlDuration` · `CounterValue` · `ResourceValue`

### 其他子系统

- **计数器 (Counter)**：`ACTOR` / `PAIR` 作用域，达到阈值触发 `ON_COUNTER_THRESHOLD`，支持 `NONE` / `ZERO` 重置模式
- **标记 (Mark)**：有向可消耗印记，支持懒过期，可作为动作施放门控 (`RequireMarkGate`)
- **历史 (History)**：时间窗口聚合——`recentDamageTaken()` 和 `recentControlDuration()`，为"基于近期事件"的公式和触发提供数据

## 测试覆盖

32 个测试文件，分为端到端场景与单元机制两类。测试数据全部通过 Java 代码构造（`DemoFixtures` 工厂），无外部 JSON 文件。

### 端到端场景

| 场景 | 验证内容 |
|---|---|
| **Sett W** | 历史窗口 → 护盾授予 → 真实伤害 |
| **Akali E** | 标记施加 → 门控检查 → 标记消耗 → 二段 |
| **荆棘甲** | 装备触发反伤 (item-owned ON_DAMAGE_TAKEN) |
| **三层被动** | 计数器 → 阈值触发 → 额外伤害 |
| **竞技场 CC 阈值** | 控制历史 → 条件触发 → CC 免疫 |

### 机制单元测试

基础物理攻击 · 护甲穿透 · 法术减伤 · 护盾吸收 · 护盾刷新策略 · 眩晕阻止施放 · 零伤窗口 · 冷却阻止 · 法力不足 · 标记消耗 · RequireMarkGate · 计数器阈值重置 · 时间窗口伤害聚合 · 时间窗口控制聚合 · 空队列 · Session 初始化 · 四种归属作用域的触发器

## 项目统计

| 指标 | 数值 |
|---|---|
| 生产代码 | 71 个 Java 文件 |
| 测试代码 | 32 个 Java 文件 |
| 包数量 | 15 |
| sealed interface | 5 (`EngineCommand` · `EffectDef` · `FormulaNode` · `ActionGateDef` · `InternalEvent`) |
| 运行时依赖 | 0 |
