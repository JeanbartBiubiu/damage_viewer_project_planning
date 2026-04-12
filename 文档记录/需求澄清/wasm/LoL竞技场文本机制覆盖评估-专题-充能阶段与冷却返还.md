TASK_KEY: wasm-lol-entity-coverage-audit
DOC_TYPE: 需求澄清
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-04-09 16:34:41

# LoL竞技场文本机制覆盖评估-专题-充能阶段与冷却返还

日期：2026-04-10
状态：已确认
数据快照：`文档记录/详细设计/最小验证/数据/lol_竞技场静态文本快照`
Data Dragon 版本：`16.7.1`
范围约束：

- 只讨论 `1v1` 数值计算
- 跳过召唤物
- 地形、位移、多目标只在必要时标记为“需转换”
- 本专题只收“阶段链 / 充能池 / 冷却返还 / 再次施放次数”语义，不把计数器专题混进来

## 专题定位

第 4 组已经证明：真正需要收口的不是新 AST 节点，而是 `cast_stage`、`remaining_charges`、`recharge_timer`、`refund_cooldown` 这些运行时状态。  
本专题只收这条链路，并把几个容易混淆的状态边界定死：

- `cast_stage`：同一个技能内部，按阶段顺序推进的再次施放链
- `remaining_charges`：可以独立恢复的可用次数
- `recharge_timer`：为充能池回补次数的计时器
- `refund_cooldown`：按数值减少剩余冷却
- `reset_skill_cd`：把技能重新置回可用状态

## 本专题样本

1. 亚托克斯 `暗裔利刃`，`champion:Aatrox:spell:AatroxQ`
2. 阿木木 `绷带牵引`，`champion:Amumu:spell:BandageToss`
3. 安妮 `碎裂之火`，`champion:Annie:spell:AnnieQ`
4. 伊泽瑞尔 `秘术射击`，`champion:Ezreal:spell:EzrealQ`
5. 阿狸 `灵魄突袭`，`champion:Ahri:spell:AhriR`

说明：

- 阿狸这一条带有 `needs_conversion` 的空间/多目标语义，但它的“再次施放次数”仍然是本专题要收的部分。
- 计数器、阈值消费、周期触发不在本专题，属于下一轮专题。

## 样本 1：亚托克斯 `暗裔利刃`

文本摘要：

- 亚托克斯可以挥击三次，每次都有一个不同的范围效果。
- 这个技能可以再次施放两段，每段都会改变形状并比上一段多造成伤害。

抽象机制：

- 同一个技能内部存在明确的阶段序列
- 每一段施放都依赖上一段是否结束
- 阶段变化伴随形状变化和伤害变化

映射到 V2：

- `cast_stage(stage_index)`
- `next_cast_window`
- `stage_damage_multiplier`
- 形状变化只作为 `需转换` 的执行细节

结论：

- **这是 `cast_stage`**
- **不等于 `remaining_charges`**
- **核心是“同一技能内的顺序阶段链”**

说明：

- 这类样本说明 `cast_stage` 是“同一技能的内部流程”，不是独立技能池。
- 它和充能池的区别在于，阶段是序列，充能是库存。

## 样本 2：阿木木 `绷带牵引`

文本摘要：

- 阿木木向目标投掷粘稠的绷带，将自己拉向目标，并对目标造成伤害和眩晕效果。
- 这个技能拥有 2 层充能。

抽象机制：

- 技能是一个可重复消耗的充能池
- 每次施放消耗一层，冷却期间逐步回补
- 充能次数决定当前可释放性

映射到 V2：

- `remaining_charges`
- `recharge_timer`
- `consume_charge`

结论：

- **这是 `remaining_charges / recharge_timer`**
- **不等于 `cast_stage`**
- **核心是“独立可恢复次数”而不是阶段序列**

说明：

- 这个样本最适合说明“充能”和“普通冷却”不是同一件事。
- 充能是库存，冷却是时间门槛。

## 样本 3：安妮 `碎裂之火`

文本摘要：

- 安妮向目标投出火球。
- 如果目标死于碎裂之火，则碎裂之火消耗的法力值会返还给安妮，且冷却时间减半。

抽象机制：

- 击杀结果驱动资源返还
- 冷却变化是数值返还，而不是重新赋值
- 目标死亡后会改变技能可用节奏

映射到 V2：

- `refund_cooldown(cooldown, partial=50%)`
- `modify_attribute("mana", +x)`
- 如果要写得更明确，属于“命中/击杀结果驱动的节奏回收”

结论：

- **这是 `refund_cooldown`**
- **不等于 `reset_skill_cd`**
- **核心是“按数值回收冷却”，不是直接刷新满冷却**

说明：

- 这里最容易混淆的是“返还”与“重置”。
- 本专题里，安妮更适合被归到冷却返还，而不是冷却重置。

## 样本 4：伊泽瑞尔 `秘术射击`

文本摘要：

- 伊泽瑞尔发射一枚能量弹，如果击中敌方单位，就会略微减少他所有技能的冷却时间。

抽象机制：

- 命中结果驱动全技能池减冷却
- 减少的是一组技能的剩余冷却，而不是某一个技能的独立状态

映射到 V2：

- `refund_cooldown(all_skills, seconds=cdrefund)`
- 命中触发：`on_hit`
- 作用对象：`skill_pool`

结论：

- **这是 `refund_cooldown`**
- **不等于 `reset_skill_cd`**
- **核心是“命中后统一扣减技能池冷却”**

说明：

- 这个样本说明命中驱动的冷却回收可以作用于整个技能池。
- 它和安妮一起说明，返还不等于刷新。

## 样本 5：阿狸 `灵魄突袭`

文本摘要：

- 灵魄突袭在进入冷却阶段以前最多可被施放三次，并在参与击杀敌方英雄后获得额外的再次施放次数。

抽象机制：

- 同一技能拥有明确的再次施放额度
- kill participation 可以额外补充一次可释放次数
- 同时还混有移动/多目标等 `需转换` 语义

映射到 V2：

- `remaining_charges`
- `grant_charge(on_takedown)`
- `consume_charge`
- 空间位移和多目标只保留为 `需转换`

结论：

- **这是 `remaining_charges` + `grant_charge`**
- **不等于 `cast_stage`**
- **核心是“击杀后补充再次施放次数”**

说明：

- 阿狸这一条更适合作为“额外再次施放次数”的样本，而不是纯阶段链样本。
- 它说明 kill/takedown 驱动的补充次数，应当和普通冷却返还分开。

## 本专题汇总结论

### 已确认可支撑的能力

1. `cast_stage` 和 `remaining_charges` 不是一类状态，前者是序列，后者是库存。
2. `recharge_timer` 负责充能回补，不等于普通冷却计时。
3. `refund_cooldown` 是数值回收，`reset_skill_cd` 才是直接刷新。
4. 命中驱动的冷却回收和击杀驱动的再次施放次数补充，都可以继续走 V2 现有路线。

### 本专题暴露出的真实重点

1. **阶段链和充能池必须分层。**
2. `cast_stage` 关注“同一个技能内部的顺序”，`remaining_charges` 关注“还能放几次”。
3. `refund_cooldown` 和 `reset_skill_cd` 必须区分，否则以后会把“减半”“缩短”“刷新”混成一个口径。
4. 命中驱动和击杀驱动也要分开看，不能默认都叫“返还”。

### 本专题建议收口的通用模板

1. `cast_stage`
   - 输入：当前阶段、下一阶段窗口
   - 输出：下一段伤害或形态变化
2. `consume_charge`
   - 输入：剩余充能
   - 输出：充能消耗
3. `recharge_charge`
   - 输入：计时器到期
   - 输出：补回一层充能
4. `refund_cooldown`
   - 输入：命中/击杀结果
   - 输出：按数值减少剩余冷却
5. `reset_skill_cd`
   - 输入：刷新事件
   - 输出：技能回到可用状态
6. `grant_charge`
   - 输入：击杀、参与击杀或其他触发
   - 输出：额外再次施放次数

### 本专题已确认的实现导向

1. `Aatrox Q` 这类条目按 `cast_stage` 建模，不要拆成充能池。
2. `Amumu Q` 这类条目按 `remaining_charges / recharge_timer` 建模，不要误当成普通冷却。
3. `Annie Q` 和 `Ezreal Q` 这类条目按 `refund_cooldown` 建模，保留“减半/略微减少”这种数值语义。
4. `Ahri R` 这类条目把 `kill participation -> extra cast` 视为 `grant_charge`，不要和 `reset_skill_cd` 混用。
5. `需转换` 的空间位移和多目标细节不进入本专题主线。

## 当前判断

本专题结论是：**可行，而且把“充能 / 阶段 / 冷却返还”分成了三条清楚的运行时线。**

更具体地说：

- `cast_stage` 解决技能内部的阶段顺序
- `remaining_charges / recharge_timer` 解决可恢复次数
- `refund_cooldown / reset_skill_cd / grant_charge` 解决不同类型的节奏回收

这三者足够覆盖本轮样本，不需要把它们再压成一类“冷却系统”。
