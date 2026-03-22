# 卡特琳娜 MVP 运行协议

## 1. 目标

本协议只服务当前 MVP：

- 1v1
- `hero_katarina` 对 `hero_dummy_10000hp_100ar_100mr`
- `S0`：平A x10
- `S1`：完整 R

目标不是完整还原英雄联盟，而是固定一套可替换的 `init/run/cancel` 运行契约，先让：

`bundle -> run input -> runtime -> sample/result`

这条链路稳定下来。

---

## 2. 为什么本轮必须给 run input 加 `plan`

现有 `wasm/引擎协议与数据结构.md` 里，`run` 输入只描述：

- 初始单位
- 覆盖项
- 停止条件

但对当前 MVP 来说，这还不够，因为 `S0` 与 `S1` 的差别不在角色和装备，而在“本次要执行什么动作”：

- `S0`：执行 10 次普攻
- `S1`：施放一次完整 `R`

如果没有 `plan`，运行层无法知道本次应该：

- 走基础攻击路径
- 还是走多段技能路径
- 需要执行多少次
- 使用哪个技能 ID

因此本轮在 `run input` 中加入最小 `action plan` 是必要的。

结论：

- `bundle` 继续负责“数据”
- `run input` 负责“场景”
- `plan` 是 MVP 场景的最小动作描述

---

## 3. 最小输入结构

```ts
export type EngineRunInput = {
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

export type CombatantInit = {
  heroId: string
  level?: number
  itemIds?: string[]
}

export type CombatantOverride = {
  baseStats?: Record<string, number>
  addItemIds?: string[]
  removeItemIds?: string[]
}

export type EngineActionPlan =
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

### 3.1 字段语义

- `stop.maxSeconds`
  - 单位：秒
  - 默认：无默认值，必填
  - 约束：`> 0`
- `initial.self/enemy.heroId`
  - 必须能在 bundle 的 `heroes` 中找到
- `initial.*.itemIds`
  - 默认：`[]`
  - 每个元素必须能在 bundle 的 `items` 中找到
- `overrides.*.baseStats`
  - key 必须存在于 `attributeDefinitions`
- `plan.type = basic_attack`
  - `count` 必须 `> 0`
  - `skillId` 可选，若提供则必须存在于 `skills`
- `plan.type = cast_skill`
  - `skillId` 必填且必须存在
  - `skillLevel` 默认取技能配置中的默认等级
  - `castCount` 默认 `1`

### 3.2 单位与精度

- 时间：毫秒整数
- 属性：`number`
- 伤害：`number`
- 采样点中的展示值建议保留 3 位小数

---

## 4. 最小输出结构

```ts
export type EngineSamplePoint = {
  tMs: number
  selfHp: number
  enemyHp: number
  cumulativeDamageToEnemy: number
  cumulativeDamageToSelf: number
}

export type EngineRunResult = {
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

### 4.1 字段语义

- `stopReason = completed`
  - 计划动作已执行完，但双方都未死亡
- `stopReason = enemyDead`
  - 敌方生命在本次运行中降到 `<= 0`
- `totalDamageToEnemy`
  - 本次运行累计对敌方造成的最终伤害
- `executedHits`
  - 实际结算的命中次数
- `actionDurationMs`
  - 本次动作实际持续时间
- `lastSample`
  - 最后一个样本点

### 4.2 最小错误语义

- `INVALID_INPUT`
  - 结构错误或必填字段缺失
- `SEMANTIC_ERROR`
  - 引用不存在、属性 key 不合法、技能 ID 不存在
- `RUNTIME_ERROR`
  - 运行时未预期异常

---

## 5. 样本点产生规则

本轮 MVP 采用“按命中产样本”的最小策略：

- 每次普攻命中，产出 1 个样本点
- `R` 的每次匕首命中，产出 1 个样本点
- 样本点必须按 `tMs` 递增
- 同一次 `run` 的样本点不允许回退

这足够支持：

- 页面列表展示
- 累计伤害曲线
- 最终结果摘要

---

## 6. `S0` / `S1` 输入示例

### 6.1 S0：平A x10

```json
{
  "stop": {
    "maxSeconds": 10
  },
  "initial": {
    "self": {
      "heroId": "hero_katarina",
      "level": 18,
      "itemIds": []
    },
    "enemy": {
      "heroId": "hero_dummy_10000hp_100ar_100mr",
      "level": 1
    }
  },
  "plan": {
    "type": "basic_attack",
    "count": 10,
    "skillId": "skill_katarina_basic_attack"
  }
}
```

### 6.2 S1：完整 R

```json
{
  "stop": {
    "maxSeconds": 10
  },
  "initial": {
    "self": {
      "heroId": "hero_katarina",
      "level": 18,
      "itemIds": []
    },
    "enemy": {
      "heroId": "hero_dummy_10000hp_100ar_100mr",
      "level": 1
    }
  },
  "plan": {
    "type": "cast_skill",
    "skillId": "skill_katarina_r",
    "skillLevel": 3
  }
}
```

---

## 7. 当前为何可以先用同协议 runtime 代替真实 wasm

当前仓库与环境的现实约束是：

- `wasm/` 目录主要是设计文档
- 仓库内没有现成真实 Wasm 计算核心
- 当前环境没有 Rust 工具链

所以本轮采用“同协议 runtime”是合理的：

- 页面仍然走 `init/run/cancel`
- 输出仍然是 `tick/done/error`
- 场景输入结构不变
- 后续只替换执行核心，不替换页面和 bundle 消费方式

这保证了：

- 本轮能跑通闭环
- 协议不会绑死在某个前端页面实现里
- 真 wasm 接入时迁移成本最低

---

## 8. 后续替换为真实 wasm 的要求

后续若替换为真实 wasm 二进制，必须保持以下不变：

1. `EngineRunInput` 结构不变
2. `EngineSamplePoint` / `EngineRunResult` 字段语义不变
3. `init/run/cancel` 消息协议不变
4. `INVALID_INPUT / SEMANTIC_ERROR / RUNTIME_ERROR` 错误分层不变

允许变化的只有：

- 内部计算实现
- 内存布局
- 批量执行方式
- Worker 与 Wasm 的桥接细节

---

## 9. 性能与实现注意事项

本轮不做性能极限优化，但要保证后续可扩：

- `bundle` 初始化后应缓存 hero / item / skill 索引
- `attributeDefinitions` 初始化后应构建默认值表
- `samples` 生成要按时间顺序 append，避免后续排序
- 多次 `run` 必须复用已初始化的会话数据，不重复解析 bundle

如果后续做真 wasm：

- 建议把属性区映射为稳定索引
- 样本点可改为结构化连续内存写入
- 批量场景可基于固定输入模板只替换少量字段

---

## 10. 本轮结论

本轮 MVP 的 Wasm/运行层契约可以固定为：

- `bundle` 提供数据
- `run input` 提供场景和 `plan`
- `sample/result` 提供展示结果
- 真实 wasm 尚未接入前，可以先用同协议 runtime 占位

这样 `S0 / S1` 已具备稳定联调前提。  
