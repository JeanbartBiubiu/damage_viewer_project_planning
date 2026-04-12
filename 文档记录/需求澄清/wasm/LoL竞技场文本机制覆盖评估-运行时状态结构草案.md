TASK_KEY: wasm-lol-entity-coverage-audit
DOC_TYPE: 需求澄清
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-04-10 00:00:00

# LoL竞技场文本机制覆盖评估-运行时状态结构草案

日期：2026-04-10  
状态：草案  
用途：把最新稳定口径压成一份实现前的运行时状态结构草案。

## 2026-04-11 补充修正

- 旧稿过度收敛到了 `crit_policy + defensive_window`，对全量竞技场遍历不够。
- 这轮补回两个结构域：
  - `historyWindows`
  - `control`
- 其中 `historyWindows` 优先复用现有 [概要设计-历史值追踪与时间窗口机制.md](C:/project/damage_viewer_project_planning/文档记录/概要设计/wasm/概要设计-历史值追踪与时间窗口机制.md) 的 `TemporalRingBuffer` 思路。
- `perTargetCooldowns` 不再只是 `ability_on_hit_bridge` 的预留位，也用于 `Yasuo E / Udyr E / Braum` 这类重复施放限制。

## 范围约束

- 只覆盖 `1v1` 核心战斗链。
- 不纳入：
  - `revive / respawn / death hook`
  - `loadout / shop / anvil / random augment`
  - `summon / ally / terrain / map object`
- `incoming_damage_split` 当前不做成通用层，只保留“技能自持变量 + scheduler”能力。
- `ability_on_hit_bridge` 当前是 deferred，不进入本轮 MVP 落地顺序。

## 设计原则

1. 状态按作用域拆分，不把所有字段堆进一个角色大对象。
2. `actor`、`pair`、`skill`、`packet`、`scheduler` 分别负责不同问题。
3. 暴击在“packet 数值成形后、提交前”解析，不在命中回调里临时补算。
4. 防御窗口先只支持两件事：
   - `control_immune`
   - `force_damage_to_zero`

## 顶层结构

```ts
type ActorRef = string;
type SkillKey = string;
type PairKey = `${string}->${string}`;
type PacketId = string;
type SchedulerJobId = string;

interface ArenaCombatRuntimeState {
  schemaVersion: 'lol-arena-runtime-draft-v2';
  nowMs: number;
  roundId: number;
  actors: Record<ActorRef, ActorRuntimeState>;
  pairs: Record<PairKey, PairRuntimeState>;
  scheduler: SchedulerState;
  idCursor: IdCursorState;
}
```

## 1. Actor 作用域

```ts
interface ActorRuntimeState {
  ref: ActorRef;
  vitals: VitalState;
  resources: ResourceState;
  attrs: ActorAttributeState;
  crit: CritPolicyState;
  historyWindows: Record<string, HistoryWindowState>;
  control: ControlRuntimeState;
  windows: DefensiveWindowState[];
  skills: Record<SkillKey, SkillRuntimeState>;
  counters: Record<string, CounterState>;
}
```

### 1.1 `vitals`

```ts
interface VitalState {
  currentHp: number;
  maxHp: number;
  currentShield: number;
  missingHp: number;
}
```

### 1.2 `resources`

```ts
interface ResourceState {
  mana?: number;
  energy?: number;
  rage?: number;
  fury?: number;
}
```

### 1.3 `attrs`

```ts
interface ActorAttributeState {
  base: FlatAttributeBlock;
  bonus: FlatAttributeBlock;
  derived: DerivedAttributeBlock;
  adaptiveForce: number;
  penetration: PenetrationState;
}

interface FlatAttributeBlock {
  attackDamage: number;
  abilityPower: number;
  attackSpeed: number;
  critChance: number;
  critDamageBonus: number;
  armor: number;
  magicResist: number;
  abilityHaste: number;
  moveSpeed: number;
  attackRange: number;
}

interface DerivedAttributeBlock {
  values: Record<string, number>;
}

interface PenetrationState {
  armorFlat: number;
  armorPercent: number;
  magicFlat: number;
  magicPercent: number;
}
```

说明：

- `adaptiveForce` 独立存在，不提前折叠成 `AD/AP`。
- 穿透作为独立字段保留，进入物理/魔法伤害公式内部消化。

### 1.4 `crit`

```ts
interface CritPolicyState {
  resolutionMode: 'expected' | 'random_seeded';
  eligibility: PacketCritEligibilityState;
  multiplier: CritMultiplierState;
  overflow: CritOverflowState;
  defenderMitigation: CritMitigationState;
}

interface PacketCritEligibilityState {
  attack: boolean;
  skill: boolean;
  itemProc: boolean;
}

interface CritMultiplierState {
  attackMultiplier: number;
  skillMultiplier: number;
  itemProcMultiplier: number;
}

interface CritOverflowState {
  enabled: boolean;
  cap: number;
  overflowToCritDamageBonus: number;
  overflowToOtherAttrs: Record<string, number>;
}

interface CritMitigationState {
  receivedCritDamageMultiplier: number;
}
```

说明：

- 这部分直接承接 `crit_policy_gap`。
- 解析时机固定为：
  1. packet 先形成基础数值；
  2. 如果该 packet 允许暴击，再按 `CritPolicyState` 解析；
  3. 然后提交最终结果。

### 1.5 `windows`

```ts
interface DefensiveWindowState {
  windowId: string;
  startAtMs: number;
  endAtMs: number;
  forceDamageToZero: boolean;
  controlImmune: boolean;
  sourceSkillKey?: SkillKey;
}

interface HistoryWindowState {
  windowId: string;
  kind: 'damage_taken' | 'damage_exchange' | 'gray_health' | 'state_snapshot' | 'cc_duration';
  windowMs: number;
  lastUpdatedAtMs: number;
  currentValue?: number;
  decayRule?: 'none' | 'linear' | 'drop_on_expire';
}

interface ControlRuntimeState {
  hardCcBudgetWindows: Record<string, HistoryWindowState>;
  activeTags: Record<string, number>;
}
```

说明：

- 这部分承接简化后的 `invulnerable_window_gap`。
- 当前不再做复杂 `blockedPacketKinds` 体系。
- 如果后续出现更细的“只挡某类效果”需求，再在这个结构上扩字段，不回退到更大的系统设计。
- `historyWindows` 用来承接 `Sett W / DrMundo W / Mordekaiser W / Tahm E / Pyke P / Ekko R` 这一族。
- `control.activeTags` 用来承接霸体、不可阻挡、控制免疫等结果态；`hardCcBudgetWindows` 用来承接“最近 N 秒被控累计时长”。

## 2. Skill 作用域

```ts
interface SkillRuntimeState {
  skillKey: SkillKey;
  castStage: number;
  cooldownEndAtMs: number;
  remainingCharges: number;
  maxCharges: number;
  rechargeEndAtMs?: number;
  unlocked: boolean;
  availabilityGate?: SkillAvailabilityGate;
  effectState?: Record<string, number | boolean | string>;
}

interface SkillAvailabilityGate {
  kind: 'none' | 'mark_required' | 'resource_required';
  source?: string;
}
```

说明：

- `castStage`、`remainingCharges`、`rechargeEndAtMs` 不再混用。
- `availabilityGate` 用于承接阿卡丽 `E2` 这类“有标记才可释放”的技能门槛。
- `effectState` 是当前对“技能自持变量”的统一挂点。
  - 如果某个技能或效果需要记录“减伤后取样值”并在后续 tick 里再用，就写在这里。
  - 这就是当前对 `incoming_damage_split` 的收口方式。

## 3. Pair 作用域

```ts
interface PairRuntimeState {
  pairKey: PairKey;
  sourceRef: ActorRef;
  targetRef: ActorRef;
  marks: Record<string, MarkState>;
  counters: Record<string, CounterState>;
  perTargetCooldowns: Record<string, number>;
  storedDamage: Record<string, StoredDamageState>;
}
```

### 3.1 `marks`

```ts
interface MarkState {
  markId: string;
  sourceRef: ActorRef;
  targetRef: ActorRef;
  createdAtMs: number;
  expiresAtMs: number;
  armedAtMs?: number;
  consumeTrigger: string;
  consumeResult: string;
}
```

### 3.2 `storedDamage`

```ts
interface StoredDamageState {
  storeId: string;
  sourceRef: ActorRef;
  targetRef: ActorRef;
  accumulatedValue: number;
  detonateAtMs: number;
  detonateRule: 'mark_expire';
}
```

### 3.3 `perTargetCooldowns`

说明：

- 这不再只是 `ability_on_hit_bridge_gap` 的预留挂点。
- 现在它也是通用 `repeat_gate` 能力的一部分，用来承接：
  - `Yasuo E`
  - `Udyr E`
  - `Braum passive`
- `ability_on_hit_bridge` 仍然 deferred，但 `perTargetCooldowns` 本身应该保留并升为通用结构位。

## 4. Counter 结构

```ts
interface CounterState {
  counterId: string;
  scope: 'actor' | 'pair';
  currentValue: number;
  initialValue: number;
  threshold?: number;
  maxValue?: number;
  lastTriggeredAtMs?: number;
  periodicIntervalMs?: number;
  nextPeriodicAtMs?: number;
}
```

说明：

- 布隆、布兰德、羊刀这类语义仍走计数器层，不并入新的横切 gap。

## 5. Packet 结构

```ts
type PacketKind =
  | 'attack'
  | 'skill'
  | 'item_proc'
  | 'dot'
  | 'heal'
  | 'shield';

interface CombatPacket {
  packetId: PacketId;
  sourceRef: ActorRef;
  targetRef: ActorRef;
  skillKey?: SkillKey;
  kind: PacketKind;
  damageType?: 'physical' | 'magic' | 'true';
  baseValue: number;
  resolvedValue: number;
  tags: PacketTagState;
  crit?: CritResolutionResult;
}

interface PacketTagState {
  canCrit: boolean;
  canApplyOnHit: boolean;
  consumesMark: boolean;
}

interface CritResolutionResult {
  didCrit: boolean;
  multiplier: number;
  expectedContribution: number;
}
```

说明：

- `CombatPacket` 是当前草案里最重要的中介。
- `crit_policy` 依赖 packet。
- 当前 `ability_on_hit_bridge` 虽然 deferred，但 `canApplyOnHit` 标签仍可预留。
- `incoming_damage_split` 不再依赖 packet 侧的独立通用改写层。

## 6. Scheduler 结构

```ts
interface SchedulerState {
  jobs: Record<SchedulerJobId, SchedulerJob>;
}

interface SchedulerJob {
  jobId: SchedulerJobId;
  ownerRef: ActorRef;
  sourceSkillKey?: SkillKey;
  runAtMs: number;
  kind: 'skill_tick' | 'periodic_counter' | 'delayed_effect';
  payload: Record<string, number | boolean | string>;
}
```

说明：

- scheduler 负责技能自持变量的后续结算。
- 例如某个效果想在“本次承伤结束后”把一部分数值拆到后续 tick 里，就通过 `effectState + SchedulerJob` 完成。

## 7. 关键顺序

1. 生成 `CombatPacket`
2. 标记 packet 的基础标签
3. 走正常伤害公式，形成 packet 的基础数值
4. 如果 `canCrit=true`，解析 `crit_policy`
5. 检查 `defensive_window`
   - 如窗口生效且 `forceDamageToZero=true`，则本次伤害改为 `0`
6. 提交最终结果
7. 发出后置事件
   - `on_hit`
   - `on_crit`
   - `mark_consume`
   - `counter_threshold`
   - `refund_cooldown`

## 8. 事件面

```ts
type CombatEvent =
  | 'skill_cast'
  | 'skill_hit'
  | 'attack_landed'
  | 'packet_resolved'
  | 'crit_resolved'
  | 'mark_consumed'
  | 'counter_threshold_reached'
  | 'shield_gained'
  | 'charge_granted'
  | 'control_apply';
```

说明：

- 新增 `control_apply`，用于给 `control_immune` 预留消费点。

## 建议实现顺序

1. 先把 `CombatPacket + CritPolicyState` 定下来。
2. 再把 `DefensiveWindowState` 接进去，先只做 `forceDamageToZero + controlImmune`。
3. 给 `SkillRuntimeState.effectState + SchedulerState` 补齐，承接技能自持变量。
4. `ability_on_hit_bridge` 继续 deferred，不进入当前 MVP。

## 当前判断

这份草案意味着当前已经不需要继续维持一个“大而全”的运行时增量设计了。

更合适的方向是：

- 把暴击做成 packet 数值解析阶段的能力
- 把无敌窗口收缩成 `defensive_window`
- 把延迟伤害类语义下沉到技能自持状态
- 把 `ability_on_hit_bridge` 明确延后

如果后续再扫出新样本，只要它能落到这几种口径里，就不再新增新的顶层结构。
