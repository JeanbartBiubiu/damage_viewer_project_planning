TASK_KEY: wasm-katarina-mvp
DOC_TYPE: 详细设计
WORKSTREAM: wasm
STATUS: tracked
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: pending

# 卡特琳娜 MVP Rust Wasm 运行协议

本文档描述当前 Rust Wasm 计算核心的实际可用协议。对于卡特 MVP，本文档优先级高于旧的 raw 数值 ABI 说明。

## 1. 当前范围

当前 Rust Wasm 已支持：

- `basic_attack`
- `cast_skill`
- 事件级 `events` 输出
- 分项级 `components` 输出
- 平A本体
- 破败王者之刃被动：敌方当前生命值 `12%`，物理伤害
- 纳什之牙被动：`15 + 0.15 * AP`，魔法伤害
- `armor` / `magic_resist` 减伤

当前未支持：

- 护盾、回复、控制、打断、位移
- 通用公式解释器
- 运行中取消
- 多目标、多实体战斗
- 比赛级完整英雄机制

## 2. Wasm 导出函数

统一使用 Rust JSON ABI：

```text
alloc(len)
dealloc(ptr, len)
engine_init(ptr, len)
engine_run(ptr, len)
engine_response_ptr()
engine_response_len()
```

说明：

- `alloc(len)`：为主机写入 JSON 请求分配线性内存。
- `dealloc(ptr, len)`：主机在不再使用输入缓冲区时释放内存。
- `engine_init(ptr, len)`：读取 `EngineInitPayload` JSON，初始化会话。
- `engine_run(ptr, len)`：读取 `EngineRunInput` JSON，执行一次模拟。
- `engine_response_ptr/len`：返回最近一次调用的 JSON 响应缓冲区。

返回码语义：

- `0`：调用成功，响应中为 `ok: true`
- `1`：调用失败，响应中为 `ok: false`

## 3. 主机响应包

成功包：

```json
{
  "ok": true,
  "value": {}
}
```

失败包：

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_INPUT",
    "message": "..."
  }
}
```

错误码语义：

- `INVALID_INPUT`
  - JSON 结构错误
  - 必填字段缺失
  - 数值非法，例如 `stop.maxSeconds <= 0`
- `SEMANTIC_ERROR`
  - `heroId` / `itemId` / `skillId` 引用不存在
  - 覆盖属性 key 不在 `attributeDefinitions` 中
- `RUNTIME_ERROR`
  - 引擎未初始化
  - 序列化/反序列化之外的运行时异常

## 4. 输入结构

### 4.1 `EngineInitPayload`

```ts
type EngineInitPayload = {
  meta: {
    gameId: string
    versionId: number
    dataHash: string
  }
  bundle: GameDataBundle
  engineConfig?: {
    hpAttrKey?: string
  }
}
```

字段约束：

- `bundle.attributeDefinitions` 不能为空
- `engineConfig.hpAttrKey` 默认值为 `"hp"`
- `hpAttrKey` 必须存在于 `attributeDefinitions.attrKey`

### 4.2 `EngineRunInput`

```ts
type EngineRunInput = {
  seed?: number
  stop: {
    maxSeconds: number
  }
  initial: {
    self: CombatantInit
    enemy: CombatantInit
  }
  overrides?: {
    self?: CombatantOverride
    enemy?: CombatantOverride
  }
  plan: EngineActionPlan
}
```

```ts
type CombatantInit = {
  heroId: string
  level?: number
  itemIds?: string[]
}

type CombatantOverride = {
  baseStats?: Record<string, number>
  addItemIds?: string[]
  removeItemIds?: string[]
}

type EngineActionPlan =
  | {
      type: "basic_attack"
      count: number
      skillId?: string
    }
  | {
      type: "cast_skill"
      skillId: string
      skillLevel?: number
      castCount?: number
    }
```

字段约束：

- `stop.maxSeconds`
  - 单位：秒
  - 必填
  - 必须 `> 0`
- `initial.self.heroId` / `initial.enemy.heroId`
  - 必须存在于 `bundle.heroes`
- `itemIds`
  - 默认空数组
  - 每个元素必须存在于 `bundle.items`
- `overrides.*.baseStats`
  - key 必须存在于 `bundle.attributeDefinitions`
- `addItemIds/removeItemIds`
  - 先移除，再新增
- `plan.type = basic_attack`
  - `count` 必须 `> 0`
  - `skillId` 可选；若提供则必须存在于 `bundle.skills`
- `plan.type = cast_skill`
  - `skillId` 必填且必须存在
  - `skillLevel` 缺省时使用技能默认等级，否则限制到 `1..=5`
  - `castCount` 缺省时按 `1` 处理

数值处理：

- 时间统一输出为毫秒整数 `tMs`
- 伤害、生命值、累计值统一保留 3 位小数
- true damage 不走抗性减伤

## 5. 输出结构

```ts
type EngineRunOutput = {
  result: EngineRunResult
  samples: EngineSamplePoint[]
  events: EngineDamageEvent[]
}
```

### 5.1 `result`

```ts
type EngineRunResult = {
  stopReason: "enemyDead" | "selfDead" | "maxSeconds" | "cancelled" | "error" | "completed"
  timeToKillEnemyMs?: number
  timeToDieMs?: number
  totalDamageToEnemy: number
  totalDamageToSelf: number
  executedHits: number
  actionDurationMs: number
  actionLabel: string
  lastSample?: EngineSamplePoint
}
```

### 5.2 `samples`

```ts
type EngineSamplePoint = {
  tMs: number
  selfHp: number
  enemyHp: number
  cumulativeDamageToEnemy: number
  cumulativeDamageToSelf: number
}
```

规则：

- 每个已结算命中事件追加 1 个 sample
- `samples` 按 `tMs` 非递减输出

### 5.3 `events`

```ts
type EngineDamageEvent = {
  sequence: number
  tMs: number
  label: string
  enemyHpBefore: number
  enemyHpAfter: number
  totalRawDamage: number
  totalDealtDamage: number
  components: EngineDamageComponent[]
}

type EngineDamageComponent = {
  sourceKind: "basic_attack" | "skill" | "item"
  sourceId: string
  label: string
  damageType: "physical" | "magic" | "true"
  rawDamage: number
  dealtDamage: number
}
```

规则：

- 一个命中事件输出一个 `EngineDamageEvent`
- `sequence` 从 `1` 开始递增
- `enemyHpBefore` 取该事件开始前的敌方当前生命值
- `enemyHpAfter` 取该事件全部分项结算后的敌方生命值
- `totalRawDamage = sum(components.rawDamage)`
- `totalDealtDamage = sum(components.dealtDamage)`
- `components` 按结算组成顺序输出
- 同一事件内每个 component 独立按伤害类型做减伤

## 6. 当前已验证公式

### 6.1 平A本体

- 原始伤害：`AD * attackRatio`
- 默认伤害类型：物理

### 6.2 破败王者之刃

- 触发时机：每次平A命中事件
- 原始伤害：`enemyHpBefore * 0.12`
- 伤害类型：物理
- 注意：必须取该命中事件开始前的敌方当前生命值，而不是初始生命值

### 6.3 纳什之牙

- 触发时机：每次平A命中事件
- 原始伤害：`15 + 0.15 * AP`
- 伤害类型：魔法

### 6.4 抗性减伤

- 物理伤害使用 `armor`
- 魔法伤害使用 `magic_resist`
- 当抗性为 `100` 时，伤害减半

## 7. 黄金样例

测试 bundle 下：

- Katarina 基础 AD：`112.4`
- BORK 额外 AD：`55`
- Nashor 额外 AP：`90`
- Dummy HP：`10000`
- Dummy armor：`100`
- Dummy magic_resist：`100`

首个平A事件：

- 平A本体原始 `167.4`，结算 `83.7`
- 破败原始 `1200`，结算 `600`
- 纳什原始 `28.5`，结算 `14.25`
- 事件总原始 `1395.9`
- 事件总结算 `697.95`
- 敌方生命：`10000 -> 9302.05`

第二个平A事件：

- 破败改用新的 `enemyHpBefore = 9302.05`
- 破败原始伤害下降为 `1116.246`

## 8. 已知限制

- 当前 Rust `run` 仍是同步单次执行，没有运行中取消点
- `events` 已支持，但 `tick` 推进仍需前端 worker 自行组织
- 目前只实现了 MVP 中已验证的少量装备/技能逻辑
- 复杂多装备、多技能、状态交互仍需后续继续扩展

## 9. 前端平台层必须对齐的 ABI 细节

前端桥接必须按以下步骤调用：

1. `alloc(len)` 申请输入缓冲区
2. 将 UTF-8 JSON 请求写入 Wasm memory
3. 调用 `engine_init` 或 `engine_run`
4. 用 `engine_response_ptr/engine_response_len` 读取 UTF-8 JSON 响应
5. 解析 `{ ok, value }` 或 `{ ok, error }`
6. 读取结束后调用 `dealloc(ptr, len)` 释放输入缓冲区

前端不应再依赖这些旧导出：

- `run_basic_attack`
- `run_death_lotus`
- `sample_stride`
- `result_stride`
- `samples_ptr`
- `result_ptr`
