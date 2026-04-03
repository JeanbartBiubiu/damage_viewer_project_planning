TASK_KEY: wasm-benchmark-regression
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: pending

# 详细设计：测试基准驱动的 Wasm 实施方案

## 1. 目标

本方案以 [测试基准.md](c:\project\damage_viewer_project_planning\wasm\测试基准.md) 为唯一实现基准，先完成一条“可自测、可回归、可逐步扩展”的 Rust Wasm 战斗链路。

本阶段目标不是直接做通用引擎，而是先把以下能力做成稳定闭环：

- 基准文档可转换为稳定内部数据
- 事件驱动自动战斗能把敌方生命值打到 `0`
- 关键中间结果可记录并断言
- 后续可按模块继续扩展为更通用的引擎

## 1.1 本阶段范围

本阶段只覆盖测试基准中已经拍板的机制：

- 面板属性与固定输入
- 普攻、主动技能、被动叠层
- 攻击特效
- 生命偷取
- 普通护盾
- 黑切减甲层数
- 面具 DoT
- 眩晕控制
- 技能法力消耗与法力回复
- 技能冷却与技能极速
- 默认无前摇、无后摇、无引导

## 1.2 本阶段非目标

- 通用公式解释器全量上线
- 前端正式数据接入
- 任意游戏规则包
- 多单位、多目标
- 复杂位移与空间模型
- 真正外部可配置的插件系统

---

## 2. 实施策略

## 2.1 核心策略

采用“测试基准驱动实现”，先做：

1. 基准数据转换层
2. 内部运行时模型
3. 自动战斗事件队列
4. 标准效果处理器
5. 验收测试矩阵

等这条链路稳定后，再把内部模型抽象成更通用的 bundle/run 协议。

## 2.2 为什么不先做通用前端协议

当前前端数据、后台编辑链路、公式绑定表都还不稳定。  
如果现在直接把公共 ABI 拉满，开发时间会被大量消耗在“协议兼容”和“假数据录入”上。

所以本阶段采用两层策略：

- 外部 JSON ABI 保持兼容，不大改
- 内部先引入“测试基准编译层”

这能保证：

- 现在就能实现和回归
- 后面不会把当前成果全部推翻

---

## 3. 当前工程与建议模块边界

当前工程只有 4 个核心源码文件：

- `src/model.rs`
- `src/engine.rs`
- `src/sim.rs`
- `src/lib.rs`

现状适合立即拆模块。

## 3.1 建议目标文件结构

```text
src/
  model.rs                // 外部 ABI + 公共 DTO + 枚举
  catalog.rs              // 基准文档转换后的静态目录、索引、编译层
  benchmark_fixture.rs    // 测试基准 -> 内部固定 fixture
  runtime.rs              // RuntimeState / ActorState / Cooldown / Status / Shield / Stack
  effects.rs              // 伤害、护盾、偷取、DoT、黑切、眩晕等效果处理
  sim.rs                  // 事件队列、调度循环、自动战斗决策
  engine.rs               // init/run 入口，组装 catalog/runtime/sim
  benchmark_tests.rs      // 基于测试基准的验收测试
  lib.rs                  // Wasm ABI 导出与模块注册
```

## 3.2 模块职责边界

### `model.rs`

职责：

- 保留当前对外 JSON ABI
- 扩展可选测试配置
- 定义公共枚举和结果结构

不负责：

- 业务逻辑
- 事件推进
- 测试基准转换

### `catalog.rs`

职责：

- 把外部 bundle 或测试 fixture 编译成可执行目录
- 提供 ID 查找、type 查找、默认值查找
- 生成运行时所需的稳定 owner/source 映射

### `benchmark_fixture.rs`

职责：

- 把 [测试基准.md](c:\project\damage_viewer_project_planning\wasm\测试基准.md) 映射成稳定内部 fixture
- 提供固定 ID、属性 key、技能优先级、默认假设

### `runtime.rs`

职责：

- 定义运行时容器
- 提供状态读写接口
- 处理基础时间推进和资源更新

### `effects.rs`

职责：

- 标准化所有效果应用
- 保证不同调用点都走同一条结算链

### `sim.rs`

职责：

- 维护最小堆
- 推进自动战斗
- 决策当前时刻谁能行动、该放什么

### `engine.rs`

职责：

- init/run 入口
- 将 ABI 输入转为 compile/runtime/sim 调用
- 生成 `EngineRunOutput`

### `benchmark_tests.rs`

职责：

- 落基准验收
- 覆盖关键事件、关键分项、关键状态
- 作为回归门禁

## 3.3 建议接口契约

为降低并行实现冲突，本阶段建议各模块按下列 Rust 接口收敛。

### `model.rs`

```rust
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineConfig {
    #[serde(default)]
    pub hp_attr_key: Option<String>,
    #[serde(default)]
    pub test_profile: Option<TestProfile>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TestProfile {
    Full,
    FormulaBypass,
    BucketIdentity,
    NoControl,
    NoShield,
}
```

要求：

- `test_profile` 缺省时等价于 `TestProfile::Full`
- `EngineRunOutput` 继续沿用现有 JSON ABI，不引入破坏性字段重命名

### `catalog.rs`

```rust
pub fn compile_benchmark_catalog(config: &EngineConfig) -> Result<CompiledCatalog, EngineError>;
```

```rust
pub struct CompiledCatalog {
    pub profile: TestProfile,
    pub hp_attr_key: String,
    pub self_actor: CompiledActor,
    pub enemy_actor: CompiledActor,
    pub skill_defs: HashMap<String, CompiledSkill>,
    pub item_defs: HashMap<String, CompiledItem>,
}
```

要求：

- `CompiledCatalog` 必须已经包含“基准文档解释后的固定值”，运行时不得再去做中文字段解释
- 我方与敌方若复用同一技能或装备模板，编译层必须提供稳定实例化来源，避免后续运行时 owner/source 混淆

### `runtime.rs`

```rust
pub fn build_runtime(catalog: &CompiledCatalog, max_seconds: f64) -> RuntimeState;
```

```rust
pub struct RuntimeState {
    pub now_ms: u32,
    pub stop_reason: Option<StopReason>,
    pub profile: TestProfile,
    pub actors: HashMap<ActorId, ActorRuntime>,
    pub queue: BinaryHeap<ScheduledEvent>,
    pub next_seq: u32,
    pub samples: Vec<EngineSamplePoint>,
    pub events: Vec<EngineDamageEvent>,
}
```

要求：

- `RuntimeState` 负责运行期真值，`EngineRunOutput` 只在收尾阶段聚合
- 所有可验收状态都应能从 `RuntimeState` 或其日志派生

### `effects.rs`

```rust
pub fn apply_damage_packet(
    state: &mut RuntimeState,
    source_actor: ActorId,
    target_actor: ActorId,
    packet: DamagePacket,
) -> Result<ResolvedDamage, EngineError>;

pub fn apply_status_effects_after_hit(
    state: &mut RuntimeState,
    source_actor: ActorId,
    target_actor: ActorId,
    resolved: &ResolvedDamage,
) -> Result<(), EngineError>;
```

要求：

- 伤害分量结算和命中后触发效果必须拆成两个阶段，避免“边结算边递归触发”导致事件记录失真
- `no_shield`、`no_control` 等 profile 只允许在效果层分支，不允许改调度主循环

### `sim.rs`

```rust
pub fn seed_initial_events(state: &mut RuntimeState);
pub fn run_until_stop(state: &mut RuntimeState) -> Result<(), EngineError>;
```

要求：

- `sim.rs` 只负责调度、决策、入队、出队
- 真实数值处理统一委托给 `effects.rs`

### `engine.rs`

```rust
pub fn init_session(payload: EngineInitPayload) -> Result<EngineSession, EngineError>;
pub fn run(session: &EngineSession, input: EngineRunInput) -> Result<EngineRunOutput, EngineError>;
```

要求：

- `run()` 在本阶段允许忽略旧版 `EngineActionPlan` 的自由输入能力，优先走“基准自动战斗”主链路
- 若保留旧 MVP 入口，必须与新链路隔离，不能污染验收结果

---

## 4. 数据模型设计

## 4.1 稳定属性 key

测试基准里的中文名，在内部统一转换为稳定 key：

```ts
hp
ad
attack_speed_base
attack_speed_bonus
attack_speed_ratio
ap
hp_regen
mana
armor
magic_resist
armor_pen_flat
magic_pen_flat
ability_haste
crit_chance
crit_multiplier
life_steal
heal_power
```

说明：

- `成长攻击速度` 在本阶段直接映射为 `attack_speed_bonus`
- `成长攻击速度系数` 映射为 `attack_speed_ratio`
- 普攻间隔使用：
  - `total_attack_speed = attack_speed_base + attack_speed_bonus * attack_speed_ratio`

## 4.2 稳定对象 ID

### 角色

```text
hero_self_benchmark
hero_enemy_benchmark
```

### 装备

```text
item_lifesteal_blade
item_magic_blade
item_mask
item_black_cleaver
item_dorans_blade
item_thorn_armor
```

### 技能

```text
skill_basic_attack
skill_mystic_shot
skill_arcane_shift
skill_count_to_three
skill_generate_shield
skill_stun
```

### type

```text
type_can_trigger_on_hit
type_active_skill
type_reserved_benchmark
```

## 4.3 运行时核心结构

```ts
type RuntimeState = {
  nowMs: number
  stopReason?: StopReason
  actors: Record<ActorId, ActorRuntime>
  queue: BinaryHeap<InternalEvent>
  nextSeq: number
  logs: RuntimeLog[]
  samples: EngineSamplePoint[]
  events: EngineDamageEvent[]
}
```

```ts
type ActorRuntime = {
  actorId: "self" | "enemy"
  hpCurrent: number
  hpMax: number
  manaCurrent: number
  attrs: Record<string, number>

  cooldowns: Record<SkillId, u32>
  blackCleaverStacks: BlackCleaverState
  countToThreeMarks: u32
  shield?: ShieldState
  stunUntilMs?: u32

  priorities: SkillId[]
  ownedItems: ItemId[]
  canBasicAttack: boolean
}
```

```ts
type ShieldState = {
  amount: number
}

type BlackCleaverState = {
  stacks: u32
  expireAtMs?: u32
}
```

本阶段刻意不做更通用的 `StatusInstance[] / ShieldInstance[] / StackInstance[]` 列表模型，而是先用基准足够的固定槽位实现。  
原因是：

- 当前机制数量有限
- 子 agent 更容易并行实现
- 之后再统一抽象时不会影响验收结果定义

---

## 5. 自动战斗调度设计

## 5.1 事件类型

本阶段只定义满足基准所需的事件：

```ts
type InternalEvent =
  | { type: "actor_decide"; actorId: ActorId }
  | { type: "damage_resolve"; sourceId: string; actorId: ActorId; targetId: ActorId; packet: DamagePacket }
  | { type: "dot_tick"; sourceId: string; actorId: ActorId; targetId: ActorId; dotKind: "mask"; remaining: u32 }
  | { type: "shield_ready"; actorId: "enemy" }
  | { type: "stun_ready"; actorId: "enemy" }
  | { type: "stun_expire"; actorId: "self" }
  | { type: "black_cleaver_expire"; actorId: "enemy" }
```

## 5.2 调度原则

- 统一最小堆排序：`(tMs, priority, seq)`
- `t=0` 时同时种入：
  - `self.actor_decide`
  - `enemy.actor_decide`
  - `enemy.shield_ready`
  - `enemy.stun_ready`
- 未指定优先级时，使用默认事件优先级

## 5.3 自动作战循环

### 我方

按优先级：

`奥术跃迁 > 秘术射击 > 普通攻击`

行为规则：

- 找当前不在 CD、未被眩晕阻断、且法力值足够支付耗蓝的最高优先级技能
- 若多个同刻可放，则按优先级高者先执行
- 若更高优先级技能因法力不足不可释放，则继续尝试下一个优先级技能
- 若某个技能因法力不足被阻止，则该次动作不进入冷却、不扣法力、不产生伤害或触发后续效果
- 所有动作默认无前摇、无后摇、无引导

### 敌方

敌方不会普攻，只会：

- `生成护盾`
- `眩晕`

若同刻都可释放，则按默认排序处理。

## 5.4 眩晕处理

- 眩晕期间，目标不能普攻和释放技能
- 若当前存在可打断动作，则立即打断
- 本阶段由于默认无前摇/引导，打断效果主要影响未来调度，不影响已落地伤害

## 5.5 终止条件

主终止条件：

- `enemy.hpCurrent <= 0`

辅终止条件：

- 超过 `maxSeconds`
- 达到安全事件数上限，避免死循环

---

## 6. 效果处理详细设计

## 6.1 普攻

公式：

```text
intervalMs = 1000 / (attack_speed_base + attack_speed_bonus * attack_speed_ratio)
manaCost = 0
rawDamage = current ad
damageType = physical
```

附加行为：

- 可暴击字段先保留，但本阶段默认暴击率为 0，不影响结果
- 普攻属于 `type_can_trigger_on_hit`
- 普攻命中后：
  - 触发吸血刀攻击特效
  - 触发魔法刀攻击特效
  - 推进“数3”计数
  - 若造成物理伤害，触发黑切
  - 根据普通攻击本体和攻击特效伤害结算生命偷取

## 6.2 秘术射击

主效果：

```text
manaCost = 25
rawDamage = 100 + 1.0 * current ad + 0.2 * current ap
damageType = physical
```

附加行为：

- 属于主动技能
- 属于 `type_can_trigger_on_hit`
- 可携带攻击特效
- 命中后使所有技能冷却减少 1000ms
- 技能本体不触发生命偷取
- 附带攻击特效伤害可以触发生命偷取
- 技能本体造成物理伤害时可触发黑切

## 6.3 奥术跃迁

主效果：

```text
manaCost = 40
rawDamage = 200 + 0.8 * current ap
damageType = magic
```

附加行为：

- 属于主动技能
- 命中后若造成主动技能魔法伤害，则触发面具

## 6.4 面具 DoT

触发条件：

- 主动技能魔法伤害命中

效果：

- 3 秒内每秒 1 次
- 每次造成 `2% * 目标最大生命值` 魔法伤害

事件实现：

- 命中时入队 3 个 `dot_tick` 事件

## 6.5 吸血刀

效果：

- 普攻类型事件可触发攻击特效
- 对敌方额外造成当前生命值 `8%` 的物理伤害

生命偷取：

- 普攻本体伤害可吸血
- 普攻附带的攻击特效伤害可吸血
- 秘术射击附带的攻击特效伤害可吸血

## 6.6 魔法刀

效果：

```text
rawDamage = 20 + current ap * 0.15
damageType = magic
```

触发条件：

- `type_can_trigger_on_hit`

## 6.7 黑切

触发条件：

- 任意物理伤害分量结算成功

规则：

- 每个物理伤害分量叠 1 层
- 每层减少敌方 `5% * 最大护甲`
- 最多 6 层
- 所有层共享持续时间
- 每次新叠层刷新总持续时间到 5 秒

实现建议：

- `enemy.attrs["armor"] = armor_base - armor_max * 0.05 * stacks`
- `armor_base` 单独保存，避免层数变化后累计误差

## 6.8 数3

触发条件：

- 每次“攻击事件”命中时加 1 标记

本阶段默认“攻击事件”包括：

- 普攻
- 秘术射击

触发效果：

- 达到 3 层后，额外造成 `1% * 目标最大生命值` 真实伤害
- 触发后计数重置为 `0`

这是本方案采用的默认值。若后续需要别的行为，再单独改基准。

## 6.9 生成护盾

规则：

- `t=0` 可释放一次
- 之后每隔 8 秒可再次释放
- 护盾值：
  - `50 + target.hpMax * 0.01`
- 若已有护盾：
  - 不累加
  - 取 `max(currentShield, newShield)`

本阶段护盾只建单槽：

```ts
shield.amount = max(old_amount, new_amount)
```

## 6.10 反甲

触发条件：

- 受到可以触发攻击特效的攻击时

效果：

```text
rawDamage = 10 + 0.1 * self.armor
damageType = magic
```

本阶段视为反击伤害事件，不触发攻击特效，不触发生命偷取。

---

## 7. 标准结算链

## 7.1 DamagePacket

```ts
type DamagePacket = {
  sourceKind: "basic_attack" | "skill" | "item" | "status"
  sourceId: string
  sourceActor: ActorId
  targetActor: ActorId
  label: string
  damageType: "physical" | "magic" | "true"
  rawDamage: f64
  flags: {
    canTriggerOnHit: bool
    canLifeSteal: bool
    canApplyBlackCleaver: bool
    countsAsAttack: bool
    isActiveSkillMagicDamage: bool
  }
}
```

## 7.2 统一处理顺序

```text
rawDamage
-> 护甲/魔抗/真伤公式
-> 若有护盾，先护盾吸收
-> 剩余值扣 HP
-> 记录组件
-> 根据 flags 触发后置效果
```

## 7.3 生命偷取顺序

```text
只有 dealtDamage 参与吸血
lifeStealHeal = dealtDamage * life_steal * (1 + heal_power)
```

## 7.4 组件事件与聚合事件

建议内部按“组件级”结算，外部输出按“攻击事件聚合”：

- 一次普攻事件可能包含：
  - 普攻本体
  - 吸血刀附伤
  - 魔法刀附伤
  - 数3 真伤
- 对外 `EngineDamageEvent` 是一个事件
- 对内记录多个 `EngineDamageComponent`

这样与当前 MVP 输出结构最接近，也便于回归。

---

## 8. 测试 profile 设计

本阶段不做真正插件系统，只做测试 profile。

## 8.1 配置入口

在 `EngineConfig` 中扩展可选项：

```ts
testProfile?: "full" | "formula_bypass" | "bucket_identity" | "no_control" | "no_shield"
```

## 8.2 语义

- `full`
  - 正常完整流程
- `formula_bypass`
  - 对已知公式直接取固定计算路径，不走通用解析
- `bucket_identity`
  - 所有乘区视为 `1`
- `no_control`
  - 眩晕状态记录但不阻断动作
- `no_shield`
  - 护盾逻辑记录但不吸收伤害

说明：

- 这是测试隔离能力，不是生产能力
- 默认 profile 必须是 `full`

---

## 9. 验收矩阵

## 9.1 T01 初始化编译

断言：

- 属性 key 转换正确
- 我方/敌方固定初值正确
- 装备加成正确
- 攻速计算口径正确

## 9.2 T02 首次普攻

断言：

- 事件时间正确
- 普攻本体伤害正确
- 吸血刀附伤正确
- 魔法刀附伤正确
- 吸血值正确

## 9.3 T03 首次秘术射击

断言：

- 技能本体伤害正确
- 附带攻击特效正确
- 成功释放时法力扣减 25 正确
- 冷却减少 1 秒生效
- 黑切正确叠层

## 9.4 T04 首次奥术跃迁

断言：

- 技能本体魔法伤害正确
- 成功释放时法力扣减 40 正确
- 成功触发面具
- 3 次 DoT tick 正确

## 9.5 T05 护盾

断言：

- `t=0` 护盾生成成功
- 护盾先于 HP 吸收
- 再生成时按取大值刷新

## 9.6 T06 眩晕

断言：

- 眩晕生效时间正确
- 眩晕结束时间正确
- 我方在眩晕期间不行动

## 9.7 T07 黑切过期

断言：

- 多个物理分量可多次叠层
- 5 秒无续层后层数清空
- 护甲恢复到原始值

## 9.8 T08 最终完成

断言：

- `stopReason = enemyDead`
- 结果包含 `samples/events/result`
- 关键事件字段可用于回归

补充资源门禁断言：

- 主动技能若当前法力值不足，则本次施法被阻止
- 被阻止的施法不扣法力、不进入冷却、不产生伤害/DoT/攻击特效/减 CD
- 自动决策会降级到下一个可释放动作；若仍无动作，则等待下一事件

## 9.9 Profile 隔离验收

除主链路验收外，还需要最少补 4 组 profile 验收，确认“可替换策略模块”真实可用。

### P01 `full`

断言：

- 全部机制开启
- 能稳定打死敌方
- 护盾、控制、黑切、DoT 都会进入日志

### P02 `no_shield`

断言：

- 护盾事件仍记录
- 但护盾不吸收伤害
- 同时间线下敌方死亡时间应早于 `full`

### P03 `no_control`

断言：

- 眩晕事件仍记录
- 我方动作不会因眩晕被阻断
- 同时间线下我方动作数不小于 `full`

### P04 `formula_bypass`

断言：

- 普攻、秘术射击、奥术跃迁仍能产出组件事件
- 结果结构保持不变
- 该模式只替换数值来源，不改变事件类型和触发关系

### P05 `bucket_identity`

断言：

- 乘区按单位值处理后，伤害应可预测下降或上升到固定区间
- 事件数不变，只有数值变

---

## 10. Sub Agent 拆分

## 10.1 Worker A：模型与编译层

负责文件：

- `wasm/katarina_mvp_engine/src/model.rs`
- `wasm/katarina_mvp_engine/src/catalog.rs`
- `wasm/katarina_mvp_engine/src/benchmark_fixture.rs`

职责：

- 扩展公共 DTO
- 建立基准 fixture
- 编译静态目录和稳定 ID 映射

不负责：

- 运行时逻辑
- 事件调度
- Wasm ABI glue

## 10.2 Worker B：运行时与效果层

负责文件：

- `wasm/katarina_mvp_engine/src/runtime.rs`
- `wasm/katarina_mvp_engine/src/effects.rs`
- `wasm/katarina_mvp_engine/src/sim.rs`

职责：

- 运行时状态
- 标准效果应用
- 事件最小堆与自动战斗循环

不负责：

- 对外 ABI
- fixture 生成

## 10.3 Worker C：引擎接线与验收测试

负责文件：

- `wasm/katarina_mvp_engine/src/engine.rs`
- `wasm/katarina_mvp_engine/src/lib.rs`
- `wasm/katarina_mvp_engine/src/benchmark_tests.rs`

职责：

- init/run 接线
- profile 注入
- 基准测试落地

不负责：

- 修改 worker A / B 的核心数据结构定义

---

## 11. 主控验收原则

主控只负责两件事：

1. 方案设计
2. 测试验收

验收标准：

- 代码必须以测试基准为真
- 子 agent 不能为通过测试而绕过中间结果记录
- 关键事件、关键组件、关键状态必须可观测
- 若实现与基准描述冲突，以本方案和测试基准文档为准

## 11.1 验收执行顺序

主控验收按固定顺序进行，不跳步：

1. `cargo test --no-run`
2. `cargo test benchmark_tests::t01_init_compile`
3. `cargo test benchmark_tests::t02_first_basic_attack`
4. `cargo test benchmark_tests::t03_first_mystic_shot`
5. `cargo test benchmark_tests::t04_first_arcane_shift`
6. `cargo test benchmark_tests::t05_shield`
7. `cargo test benchmark_tests::t06_stun`
8. `cargo test benchmark_tests::t07_black_cleaver_expire`
9. `cargo test benchmark_tests::t08_enemy_dead`
10. `cargo test`

若中途失败，按下列优先级排查：

- 编译失败：先看模块接口是否偏离 `3.3 建议接口契约`
- 单测失败：先看事件时间，再看组件值，再看状态机
- 结果能打死但断言失败：视为实现不合格，不能以最终击杀掩盖过程错误

## 11.2 门禁要求

下列项任一缺失，都不能算通过本阶段验收：

- `EngineRunOutput.result.stopReason`
- `EngineRunOutput.samples`
- `EngineRunOutput.events`
- 首次普攻的组件级记录
- 首次秘术射击的组件级记录
- 奥术跃迁触发的面具 DoT 记录
- 护盾生成与吸收记录
- 眩晕开始与结束记录
- 黑切层数变化与过期恢复记录
