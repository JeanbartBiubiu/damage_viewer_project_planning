TASK_KEY: server-backend-review
DOC_TYPE: 需求澄清
WORKSTREAM: server
STATUS: superseded
EXECUTION_MODEL: gpt-5.4
LAST_TRACKED_AT: 2026-05-10

# Superseded / 历史参考

本文是早期外部 AI 建议原文，保留为历史参考，不再作为当前后端或 Wasm 契约真源。

当前实现与契约请优先看：

- `文档记录/需求澄清/server/wasm-db-design-gap-todo.md`
- `文档记录/详细设计/server/game_manage/接口定义.md`
- `文档记录/需求澄清/wasm/WASM机制覆盖需求.md`
- `文档记录/详细设计/wasm/WASM详细设计.md`

下文中的绝对路径、`@/c:\...` 引用和早期 `接口/game_manage/接口定义.md` 引用均已过时。

---

Let me explore the existing designs across the project.







Let me find more about the current `mechanicsConfig` contract and any existing server-side designs.

Let me check the skill classification summary to understand the frequency of heal/shield mechanics in real MOBA data.

我已通读了所有相关设计文档。以下是基于现有架构的 **P0-3** 和 **P0-4** 具体设计方案。

---

# P0-3：四条状态变更通道设计方案

## 背景数据

从 `@/c:\project\damage_viewer_project_planning\wasm\outputs\lol_skill_classification_summary_16.3.1_20260217_234809.md:9-19` 可见：
- **治疗/回复 228 次**（占 860 技能的 26.5%）
- **护盾 80 次**（9.3%）
- 两者加上伤害(711)和自我增益/减益(286+119)，覆盖了绝大多数 MOBA 技能效果

当前 `@/c:\project\damage_viewer_project_planning\接口\game_manage\接口定义.md:529-538` 中 `ActionNode` 仅有 `deal_damage` 和 `apply_modifier`，无法表达治疗和护盾，缺口很大。

## 一、ActionNode 扩展

在现有 `ActionNode` 联合类型上新增 3 个动作类型：

```ts
export type ActionNode =
  // --- 现有保持不变 ---
  | { type: "deal_damage"; damage: DamageSpec }
  | { type: "apply_modifier"; modifier: ModifierSpec }
  | { type: "add_stack"; stackId: string; amount: number; max?: number }
  | { type: "remove_stack"; stackId: string; amount?: number; all?: boolean }
  | { type: "schedule_tick"; tickKey: string; everyMs: number; times: number }
  | { type: "if"; cond: ConditionNode; then: ActionNode[]; else?: ActionNode[] }
  // --- P0-3 新增 ---
  | { type: "deal_heal"; heal: HealSpec }
  | { type: "apply_shield"; shield: ShieldApplySpec }
  | { type: "remove_shield"; shieldRef: ShieldRemoveSpec }
```

## 二、HealSpec（治疗规格）

覆盖主流 MOBA 治疗场景：直接治疗、HoT（治疗持续效果）、吸血/法术吸血。

```ts
export type HealSpec = {
  source: "self" | "owner"
  target: "self" | "enemy"          // 大多数治疗 target=self，但存在给敌方回血的边缘情况(索拉卡R)
  amount: ExprNode                   // 治疗量表达式
  tags?: string[]                    // 可选标签，如 ["lifesteal","spell_vamp","regen"]
                                     // 引擎不硬编码标签语义，用于触发条件匹配
  affectedByHealModifier?: boolean   // 默认 true：是否受治疗增减效果(如重伤)影响
                                     // false 时跳过治疗增减修正（如某些"不可被减少"的回复）
}
```

**设计要点**：
- `tags` 是开放字符串数组，不硬编码 `lifesteal/spell_vamp` 等 LoL 专属概念，其他游戏可定义自己的标签
- 治疗增减修正（如重伤 Grievous Wounds）通过 `apply_modifier` 挂载到目标的 `healModifier` 属性上，引擎结算时自动读取
- `amount` 复用现有 `ExprNode`，可引用 `attr/stack/const` 等

## 三、ShieldApplySpec / ShieldRemoveSpec（护盾规格）

```ts
export type ShieldApplySpec = {
  shieldKey: string                  // 护盾唯一标识（同源同 key 做刷新/叠加判定）
  source: "self" | "owner"
  target: "self" | "enemy"           // 通常 target=self
  amount: ExprNode                   // 护盾值表达式
  scope: ShieldScope                 // 护盾吸收范围
  durationMs?: ExprNode | number     // 持续时间(ms)，缺省=永久(直到被打破)
  priority?: number                  // 消耗优先级，默认 0，数值越大越先被消耗
  stacking?: ShieldStackingMode      // 同源同 key 的叠加策略
  tags?: string[]                    // 开放标签，用于条件匹配和交互矩阵扩展
}

export type ShieldScope =
  | "all"                            // 吸收所有伤害类型（LoL 通用护盾）
  | "physical"                       // 仅吸收物理伤害（LoL 物理护盾）
  | "magic"                          // 仅吸收魔法伤害（LoL 魔法护盾）
  | { custom: string }               // 自定义标签匹配（跨游戏扩展，如 Dota 的 damage_block）

export type ShieldStackingMode =
  | "refresh"                        // 刷新：覆盖旧护盾值和持续时间
  | "stack"                          // 叠加：新旧护盾值相加（受 max 上限约束）
  | "independent"                    // 独立实例：不互相影响，各自独立消耗和过期

export type ShieldRemoveSpec = {
  target: "self" | "enemy"
  shieldKey?: string                 // 指定移除某个 key 的护盾；缺省=移除目标所有护盾
  scope?: ShieldScope                // 可选：仅移除指定 scope 的护盾
}
```

## 四、TriggerEvent 扩展

在现有 `@/c:\project\damage_viewer_project_planning\接口\game_manage\接口定义.md:511-517` 基础上新增：

```ts
export type TriggerEvent =
  // --- 现有保持不变 ---
  | { type: "on_basic_attack_hit" }
  | { type: "on_spell_cast" }
  | { type: "on_damage_dealt" }
  | { type: "on_tick"; tickKey: string }
  | { type: "on_stack_change"; stackId: string }
  // --- P0-3 新增 ---
  | { type: "on_damage_taken" }      // 受到伤害后触发（护盾吸收后的实际 HP 损失）
  | { type: "on_heal_done" }         // 自己施放的治疗生效后触发
  | { type: "on_heal_taken" }        // 自己被治疗后触发
  | { type: "on_shield_gain" }       // 获得护盾时触发
  | { type: "on_shield_break" }      // 护盾被打破（amount 归零）时触发
  | { type: "on_shield_expire" }     // 护盾到期消失时触发
```

## 五、TriggerContext 扩展

引擎在分发触发事件时，需为新通道提供上下文：

```ts
export type TriggerContext = {
  tMs: number
  eventType: string
  sourceId: string
  sourceOwnerType: string
  targetId: string

  // --- damage 通道 ---
  rawDamage?: number                 // 减伤前伤害
  finalDamage?: number               // 最终 HP 实际减少量
  damageType?: string
  shieldAbsorbed?: number            // 被护盾吸收的量

  // --- heal 通道 ---
  rawHeal?: number                   // 治疗增减前
  finalHeal?: number                 // 实际回复量
  healTags?: string[]

  // --- shield 通道 ---
  shieldKey?: string
  shieldAmount?: number              // 护盾获得/剩余/被破数值
  shieldScope?: ShieldScope
}
```

## 六、结算管线（四通道）

引擎内部处理 action 时按以下管线分流：

| 通道 | 入口 Action | 经过的子步骤 | 影响的属性 | 后置触发事件 |
|------|-------------|-------------|-----------|-------------|
| **damage** | `deal_damage` | 公式计算 → 增减伤修正 → 穿透/抗性 → **护盾吸收** → HP 结算 | HP (↓) | `on_damage_dealt` / `on_damage_taken` |
| **heal** | `deal_heal` | 公式计算 → 治疗增减修正(重伤等) → HP 结算(不超上限) | HP (↑) | `on_heal_done` / `on_heal_taken` |
| **modifier** | `apply_modifier` | 属性叠加/乘区 → 过期调度 | 任意属性 | *(现有 on_stack_change 等)* |
| **shield** | `apply_shield` | 叠加策略判定 → 实例创建/刷新 → 过期调度 | ShieldInstance | `on_shield_gain` |

**关键规则**：
- damage 通道中的护盾吸收步骤在 P0-4 中详细定义
- heal 通道的"治疗增减修正"通过读取目标身上的 `heal_power_modifier`（ratio 类型属性）实现，不硬编码"重伤"概念
- 四个通道互不侵入，一个技能可同时产生多个通道的 action（如 LoL 蒙多 R：治疗+属性增益，卡莎 Q：伤害+护盾）

## 七、兼容策略

- 旧配置只含 `deal_damage`/`apply_modifier` → 行为完全不变，不存在新通道
- `mechanicsConfig.version` 保持 `1`（新 action type 是向后兼容的联合类型扩展）
- 引擎遇到不识别的 action type 应报 `SEMANTIC_ERROR` 而非静默忽略

## 八、配置示例

以 LoL 塞拉斯 W（弑君突刺）为例 —— 同时包含伤害和治疗：

```json
{
  "version": 1,
  "triggers": [
    {
      "id": "syl_w_cast",
      "event": { "type": "on_spell_cast" },
      "conditions": null,
      "actions": [
        {
          "type": "deal_damage",
          "damage": {
            "source": "self",
            "target": "enemy",
            "damageType": "magic",
            "amount": {
              "t": "op", "op": "+", "args": [
                { "t": "const", "v": 65 },
                { "t": "op", "op": "*", "args": [
                  { "t": "attr", "who": "self", "key": "ap" },
                  { "t": "const", "v": 0.9 }
                ]}
              ]
            }
          }
        },
        {
          "type": "deal_heal",
          "heal": {
            "source": "self",
            "target": "self",
            "amount": {
              "t": "op", "op": "+", "args": [
                { "t": "const", "v": 20 },
                { "t": "op", "op": "*", "args": [
                  { "t": "attr", "who": "self", "key": "ap" },
                  { "t": "const", "v": 0.45 }
                ]}
              ]
            },
            "tags": ["spell_vamp"],
            "affectedByHealModifier": true
          }
        }
      ]
    }
  ]
}
```

---

# P0-4：护盾交互机制设计方案

## 一、运行时数据模型

### 1.1 ShieldInstance（引擎内部）

```ts
export type ShieldInstance = {
  instanceId: string                 // 引擎运行时生成，全局唯一
  shieldKey: string                  // 来自 ShieldApplySpec.shieldKey
  sourceId: string                   // 施加者 ID
  ownerId: string                    // 持有者 ID（承受伤害的一方）
  amount: number                     // 当前剩余护盾值
  maxAmount: number                  // 初始护盾值（用于百分比判断等）
  scope: ShieldScope                 // 吸收范围
  priority: number                   // 消耗优先级（数值越大越先被消耗）
  createdAtMs: number                // 创建时刻
  expireAtMs: number | null          // 过期时刻，null=永久
  tags: string[]                     // 开放标签
  stackCount?: number                // stacking=stack 模式下的层数
}
```

### 1.2 RuntimeState 中的护盾容器

在 `@/c:\project\damage_viewer_project_planning\wasm\WASM概要设计.md:15-20` 的 `RuntimeState` 中新增：

```ts
// RuntimeState.combatants[id] 新增字段
shields: ShieldInstance[]            // 按 priority DESC, createdAtMs ASC 排序的有序列表
```

### 1.3 DamagePacket（伤害包，damage 通道内部流转对象）

```ts
export type DamagePacket = {
  packetId: string                   // 引擎生成
  sourceId: string
  targetId: string
  damageType: "physical" | "magic" | "true" | string  // 开放字符串，不硬编码
  rawAmount: number                  // 减伤前伤害
  postMitigationAmount: number       // 减伤后、护盾吸收前
  tags: string[]                     // 伤害标签，如 ["dot","spell","on_hit"]
  flags: DamageFlags
}

export type DamageFlags = {
  ignoreShield?: boolean             // true=完全无视护盾（极少数机制）
  ignoreArmor?: boolean              // true=无视护甲（真伤默认行为可由矩阵配置）
  ignoreResist?: boolean             // true=无视魔抗
}
```

## 二、护盾交互矩阵（核心，可配置）

### 2.1 矩阵模型

```ts
export type ShieldInteractionMatrix = {
  rules: ShieldInteractionRule[]
  defaultBehavior: "consume" | "bypass"  // 未匹配到任何规则时的默认行为
}

export type ShieldInteractionRule = {
  damageType: string | "*"           // 匹配的伤害类型，"*"=所有
  damageTags?: string[]              // 可选：额外伤害标签匹配条件
  shieldScope: string | "*"          // 匹配的护盾 scope
  shieldTags?: string[]              // 可选：额外护盾标签匹配条件
  behavior: "consume" | "bypass" | "partial"
  partialRate?: number               // behavior=partial 时的吸收比例 (0~1)
  priority?: number                  // 规则优先级（多条匹配时取最高）
}
```

### 2.2 主流 MOBA 矩阵配置示例

**英雄联盟 (LoL)**：

```json
{
  "defaultBehavior": "consume",
  "rules": [
    { "damageType": "physical", "shieldScope": "magic",     "behavior": "bypass", "priority": 10 },
    { "damageType": "physical", "shieldScope": "all",       "behavior": "consume", "priority": 5 },
    { "damageType": "physical", "shieldScope": "physical",  "behavior": "consume", "priority": 5 },
    { "damageType": "magic",    "shieldScope": "physical",  "behavior": "bypass", "priority": 10 },
    { "damageType": "magic",    "shieldScope": "all",       "behavior": "consume", "priority": 5 },
    { "damageType": "magic",    "shieldScope": "magic",     "behavior": "consume", "priority": 5 },
    { "damageType": "true",     "shieldScope": "physical",  "behavior": "bypass", "priority": 10 },
    { "damageType": "true",     "shieldScope": "magic",     "behavior": "bypass", "priority": 10 },
    { "damageType": "true",     "shieldScope": "all",       "behavior": "consume", "priority": 5 }
  ]
}
```

> LoL 规则要点：物理伤害不打魔法盾、魔法伤害不打物理盾、真实伤害只打通用盾。

**DOTA 2 风格**（如需适配）：

```json
{
  "defaultBehavior": "bypass",
  "rules": [
    { "damageType": "physical", "shieldScope": "all", "behavior": "consume" },
    { "damageType": "magic",    "shieldScope": "all", "behavior": "consume" },
    { "damageType": "magic",    "shieldScope": "magic", "behavior": "consume" },
    { "damageType": "pure",     "shieldScope": "*",  "behavior": "bypass" }
  ]
}
```

> Dota 2 "Pure" 伤害无视所有护盾（护盾更少，更偏 damage block 机制）。

**王者荣耀风格**：

```json
{
  "defaultBehavior": "consume",
  "rules": [
    { "damageType": "*", "shieldScope": "all", "behavior": "consume" },
    { "damageType": "true", "shieldScope": "all", "behavior": "bypass" }
  ]
}
```

> 王者荣耀真实伤害无视护盾。

### 2.3 矩阵在 Bundle 中的位置

在 `EngineBundleV1` 中新增 `combatRules` 段：

```ts
export type EngineBundleV1 = {
  meta: { /* 不变 */ }
  attributeDefinitions: AttributeDefinitionDTO[]
  // ... 现有字段不变 ...

  // P0-4 新增
  combatRules?: CombatRulesV1
}

export type CombatRulesV1 = {
  version: 1
  shieldInteraction: ShieldInteractionMatrix
  damageSettlement?: DamageSettlementConfig   // 预留：抗性曲线等
  healModifierAttrKey?: string                // 治疗增减属性 key，默认 "heal_power_modifier"
}
```

- 若 `combatRules` 缺省，引擎使用**内置默认矩阵**（LoL 风格，覆盖最广）
- 每个 `gameId` 可在后端配置不同的 `combatRules`，发布时进 bundle

### 2.4 DB 层支持

在 `@/c:\project\damage_viewer_project_planning\db\game_manage\schema.sql` 中新增一张轻量表：

```sql
CREATE TABLE public.combat_rule_profiles (
    game_id varchar(64) NOT NULL,
    rule_key varchar(64) NOT NULL DEFAULT 'default',
    start_version_id bigint NOT NULL,
    end_version_id bigint NOT NULL,
    rule_config jsonb NOT NULL DEFAULT '{}',
    description varchar(255),
    updated_at timestamp NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_combat_rule_profiles PRIMARY KEY (game_id, rule_key),
    CONSTRAINT fk_combat_rule_profiles_start_version FOREIGN KEY (game_id, start_version_id)
        REFERENCES public.game_versions (game_id, version_id),
    CONSTRAINT fk_combat_rule_profiles_end_version FOREIGN KEY (game_id, end_version_id)
        REFERENCES public.game_versions (game_id, version_id)
) PARTITION BY LIST (game_id);

COMMENT ON TABLE public.combat_rule_profiles IS '战斗规则配置（护盾矩阵、抗性曲线等），每 gameId 一个默认 profile';
```

## 三、护盾结算流程（伤害通道内嵌）

> 关键约束（实现时必须遵守）：
> - 护盾结算输入必须是 `postMitigationAmount`（即已完成增减伤、穿透、抗性后的伤害）。
> - 护盾吸收阶段**不得再次**计算护甲/魔抗/穿透，避免重复减伤。
> - 生命实际扣减量为：`finalHpDamage = remaining = max(0, postMitigationAmount - shieldAbsorbed)`。

```
damage 通道完整管线：
┌─────────────────────────────────────────────────────────┐
│ 1. 公式计算 rawAmount                                    │
│ 2. 增减伤修正 (damageModifier)                           │
│ 3. 穿透 / 抗性计算 → postMitigationAmount               │
│ 4. ★ 护盾吸收（本节重点）                                │
│    a. 检查 DamagePacket.flags.ignoreShield               │
│       → true: 跳过护盾，直接到步骤 5                      │
│    b. 获取目标 shields[]（已按 priority DESC 排序）        │
│    c. 遍历每个 ShieldInstance:                            │
│       i.   查 ShieldInteractionMatrix                    │
│            match(damageType, shield.scope) → behavior     │
│       ii.  bypass → 跳过该护盾                            │
│       iii. consume → absorbed = min(remaining, shield)    │
│            shield.amount -= absorbed                      │
│            remaining -= absorbed                          │
│            if shield.amount <= 0 → 标记破盾               │
│       iv.  partial → absorbed = remaining * partialRate   │
│            同上逻辑                                       │
│       v.   remaining <= 0 → 跳出循环                      │
│    d. totalAbsorbed = postMitigationAmount - remaining    │
│ 5. HP 结算: hp -= remaining                              │
│ 6. 触发后置事件:                                          │
│    - on_damage_dealt (含 shieldAbsorbed)                  │
│    - on_damage_taken                                      │
│    - 若有护盾被打破 → on_shield_break (per shield)        │
│ 7. 濒死 / 死亡判定                                       │
└─────────────────────────────────────────────────────────┘
```

## 四、护盾生命周期管理

### 4.1 创建

`apply_shield` action 执行时：
1. 根据 `shieldKey` + `ownerId` 查找现有实例
2. 按 `stacking` 策略处理：
   - **refresh**: 覆盖 amount/expireAtMs
   - **stack**: amount 累加（受 max 上限）
   - **independent**: 新建独立实例
3. 若有 `durationMs` → 入队 `shield_expire` 内部事件
4. 触发 `on_shield_gain`

### 4.2 消耗

见上方结算流程步骤 4。

### 4.3 过期

`shield_expire` 事件到时：
1. 移除对应 `ShieldInstance`
2. 触发 `on_shield_expire`

### 4.4 主动移除

`remove_shield` action：
1. 按 `shieldKey` / `scope` 筛选
2. 移除匹配的实例
3. 不触发 `on_shield_break`（仅被打破时触发）

## 五、跨游戏验证矩阵

| 场景 | LoL | 王者荣耀 | Dota 2 | 期望引擎行为 |
|------|-----|---------|--------|-------------|
| 物理伤害 vs 物理盾 | ✅吸收 | ✅吸收 | ✅吸收 | consume |
| 物理伤害 vs 魔法盾 | ❌穿透 | - | - | bypass |
| 真伤 vs 通用盾 | ✅吸收 | ❌穿透 | ❌穿透 | **按 gameId 矩阵不同** |
| ignoreShield 标记 | 少见 | 少见 | BKB期间 | bypass all |
| 多层护盾消耗顺序 | 高 priority 先 | 同 | 同 | priority DESC → createdAt ASC |

**核心结论**：仅通过切换 `combatRules.shieldInteraction` 的 JSON 配置，不改引擎代码，即可适配以上三款游戏的护盾规则。

## 六、EngineSamplePoint 扩展

`文档记录/详细设计/wasm/WASM详细设计.md` 的采样点需补充护盾和治疗数据：

```ts
export type EngineSamplePoint = {
  tMs: number
  selfHp: number
  enemyHp: number
  cumulativeDamageToEnemy: number
  cumulativeDamageToSelf: number
  // P0-3/P0-4 新增
  selfShieldTotal?: number           // self 当前总护盾值
  enemyShieldTotal?: number          // enemy 当前总护盾值
  cumulativeHealBySelf?: number      // self 累计治疗量
  cumulativeHealByEnemy?: number     // enemy 累计治疗量
  cumulativeShieldAbsorbedBySelf?: number  // self 护盾累计吸收伤害
  cumulativeShieldAbsorbedByEnemy?: number
}
```

## 七、兼容性与实施建议

1. **向后兼容**：所有新增字段/类型为 optional 或联合类型扩展，旧配置不含 `deal_heal`/`apply_shield` 时行为完全不变
2. **`combatRules` 缺省默认值**：引擎内置 LoL 风格矩阵作为 fallback
3. **`mechanicsConfig.version` 不变**：保持 `1`，新 action type 是兼容扩展
4. **实施顺序建议**：
   - 先落地 `deal_heal`（最简单，不涉及实例管理）
   - 再落地 `apply_shield` + `ShieldInstance`（核心数据模型）
   - 最后落地 `ShieldInteractionMatrix` + `DamagePacket` 的护盾吸收步骤
   - `combat_rule_profiles` 表和 bundle 扩展可与 P0-2 公式链路并行

---

## 总结

- **P0-3** 通过新增 `deal_heal` / `apply_shield` / `remove_shield` 三种 ActionNode 和 6 种 TriggerEvent，将所有数值变更归入 damage/heal/modifier/shield 四条独立管线，覆盖主流 MOBA **95%+** 的技能效果
- **P0-4** 通过 `ShieldInstance` 运行时模型 + `DamagePacket` + **可配置的 `ShieldInteractionMatrix`**，实现护盾的类型/优先级/过期/叠加/交互全生命周期管理，仅通过 JSON 矩阵切换即可适配 LoL、王者荣耀、Dota 2 等主流 MOBA 的护盾规则差异
