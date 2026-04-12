TASK_KEY: wasm-lol-entity-coverage-audit
DOC_TYPE: 需求澄清
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-04-09 16:34:41

# LoL竞技场文本机制覆盖评估-专题-计数器初值阈值消费与周期触发

日期：2026-04-10
状态：已确认
数据快照：`文档记录/详细设计/最小验证/数据/lol_竞技场静态文本快照`
Data Dragon 版本：`16.7.1`
范围约束：

- 只讨论 `1v1` 数值计算
- 跳过召唤物
- 地形、位移、多目标、建筑物、史诗级野怪只在必要时标记为“需转换”
- 本专题只收“计数器、阈值触发、周期触发、预置初值”的语义，不把阶段链和充能池混进来

## 专题定位

第 5 组已经确认：当前要收口的是 `counter_seed / initial_value`、`stack_threshold_proc`、`periodic_proc`，而不是死亡/复活钩子。  
本专题只收“数一数，到了阈值就触发；或者按固定周期触发”的机制，并把 `counter_state` 和普通 buff stack 分开。

## 本专题样本

1. 黑暗之女 `嗜火`，`champion:Annie:passive`
2. 布隆 `震荡猛击`，`champion:Braum:passive`
3. 布兰德 `炽热之焰`，`champion:Brand:passive`
4. 海洋之灾 `烈火审讯`，`champion:Gangplank:passive`
5. 铸星龙王 `星海焕然`，`champion:AurelionSol:passive`

说明：

- `每第三次攻击触发` 这类效果和本专题同类，属于计数器机制的横向类比，但不作为主样本。
- 复活/死亡相关钩子不进入本专题。

## 样本 1：黑暗之女 `嗜火`

文本摘要：

- 施放 4 个技能后，下一个伤害类技能会晕眩目标。
- 游戏开始和重生时，安妮会带着满层【嗜火】。

抽象机制：

- 自身计数器达到阈值后触发消费
- 计数器可以在开局直接被种入一个初值
- 结果是控制效果，不是属性堆叠

映射到 V2：

- `counter_state`
- `counter_seed(initial_value=4)`
- `stack_threshold_proc`
- `consume_stack`

结论：

- **这是计数器，不是普通 buff stack**
- **开局满层应通过 seed 表达，不需要先引入死亡/复活生命周期钩子**

说明：

- 这个样本最适合说明“计数器初值”这个概念本身。
- 它的本质是“先有一个数，再按阈值消费”，不是每次都从 0 开始。

## 样本 2：布隆 `震荡猛击`

文本摘要：

- 布隆的普攻会给目标叠加震荡猛击；后续友军也可继续叠层，叠到 4 层后目标会被击晕并受到伤害，之后一段时间内无法再次叠层。

抽象机制：

- 目标维度的计数累积
- 达到阈值后触发控制与伤害
- 触发后进入短时锁定窗口

映射到 V2：

- `counter_state(target_ref)`
- `stack_threshold_proc(threshold=4)`
- `consume_stack`
- `lockout_window`

结论：

- **这是 `counter_state` + `stack_threshold_proc`**
- **不是单纯的 buff stack**
- **它和羊刀式第 N 次触发属于同一类计数器机制**

说明：

- 这类条目说明计数器可以挂在目标身上，而不是只挂在自己身上。
- 触发后锁定窗口是计数器消费后的副产物，不是计数器本体。

## 样本 3：布兰德 `炽热之焰`

文本摘要：

- 布兰德的技能会对目标施加持续伤害效果，可叠加至 3 次。
- 当击杀带有该效果的敌人时会回复法力值。
- 满层后还会在短延迟后爆炸并造成更大范围伤害。

抽象机制：

- 计数累积和持续伤害并存
- 阈值到达后引发延迟爆炸
- 击杀结果驱动资源返还

映射到 V2：

- `counter_state`
- `stack_threshold_proc(threshold=3)`
- `periodic_proc`
- `mark_detonate`
- `on_kill_refund_resource`

结论：

- **这是计数器 + 周期触发的组合**
- **不是单独的 tick 子系统**
- **核心是“层数到阈值后进入延迟结算”**

说明：

- 布兰德说明周期触发不该被切成另一个孤立专题。
- 它通常和计数器、阈值消费绑在一起出现。

## 样本 4：海洋之灾 `烈火审讯`

文本摘要：

- 普朗克每过几秒，近战攻击就会让目标着火。

抽象机制：

- 固定间隔触发
- 条件满足时给普攻附加额外效果
- 是典型的周期型 proc

映射到 V2：

- `periodic_proc`
- `on_melee_attack`
- `apply_status("burn")`

结论：

- **这是 `periodic_proc`**
- **不需要单独拆成别的子系统**
- **它应该和计数器阈值放在同一专题里看**

说明：

- 这个样本说明周期性效果本质上也是一种触发契约。
- 它常常只是“每隔一段时间检查一次条件，然后给计数器或状态加料”。

## 样本 5：铸星龙王 `星海焕然`

文本摘要：

- 奥瑞利安·索尔的伤害型技能会收集星尘，星尘会永久增强他的技能。

抽象机制：

- 计数累积后永久成长
- 计数本身不一定展示为可见 buff
- 阈值/层数变化直接影响后续技能强度

映射到 V2：

- `counter_state`
- `stack_threshold_proc`
- `permanent_growth`

结论：

- **这是计数器驱动的永久成长**
- **不是普通时效 buff**
- **它证明计数器和永久属性写回可以共存，但语义仍然是计数器**

说明：

- 这一条和第 6 组的属性派生不同。
- 这里的核心是“数到多少次”，而不是“从哪个属性派生出哪个属性”。

## 本专题汇总结论

### 已确认可支撑的能力

1. `counter_seed / initial_value` 可以覆盖开场满层、预置效果，不需要先引入死亡/复活生命周期钩子。
2. `counter_state` 和普通 buff stack 不能混为一谈。
3. `stack_threshold_proc` 可以统一承接“第 N 次触发”与“叠到 N 层触发”两类机制。
4. `periodic_proc` 不应该单独拆出去，它通常就是计数器和阈值触发的前置供给器。

### 本专题暴露出的真实重点

1. **计数器本体只负责记次数，buff stack 才负责携带更完整的状态载荷。**
2. `counter_seed` 解决开局预置，不需要把问题拉进生命周期钩子。
3. `stack_threshold_proc` 是计数器专题的核心收口点。
4. `periodic_proc` 仍然和计数器、阈值触发同属一层运行时契约，不值得单独开一个更碎的专题。

### 本专题建议收口的通用模板

1. `counter_state`
   - 输入：事件流
   - 输出：累计次数
2. `counter_seed`
   - 输入：初始值
   - 输出：开局预置计数
3. `stack_threshold_proc`
   - 输入：当前次数、阈值
   - 输出：控制、伤害、返还或永久成长
4. `periodic_proc`
   - 输入：时间间隔与条件
   - 输出：周期性状态附加或计数增长
5. `counter_consume`
   - 输入：达到阈值的计数器
   - 输出：一次性消费并重置

### 本专题已确认的实现导向

1. `Annie` 这类开场满层效果，优先用 `counter_seed` 表达，不引入死亡/复活钩子。
2. `Braum` 这类目标计数效果，按目标维度的 `counter_state` 建模。
3. `Brand` 这类“层数 + 延迟爆炸 + 击杀返还”效果，按 `counter_state + periodic_proc + stack_threshold_proc` 组合处理。
4. `Gangplank` 这类固定间隔触发，作为 `periodic_proc` 保留，不单独拆更细的子系统。
5. `Aurelion Sol` 这类永久成长，仍由计数器驱动，不误归到属性派生专题。

## 当前判断

本专题结论是：**可行，而且已经把“计数器 / 阈值 / 周期触发”统一收到了一个运行时层。**

更具体地说：

- `counter_seed` 解决起始值
- `counter_state` 解决记数
- `stack_threshold_proc` 解决阈值消费
- `periodic_proc` 解决周期触发

这四者已经足够覆盖本轮样本，不需要把它们拆成更多更碎的主题。
