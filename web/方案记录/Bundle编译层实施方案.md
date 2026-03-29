# 前端 Bundle 编译层实施方案

## 1. 目标

在前端实现 `BundleCompiler`，将后端 API 返回的 `GameDataBundle`（管理数据）编译为 Wasm 引擎可消费的 `BenchmarkBundle`（运行时数据），使前端页面可以直接驱动 Wasm 引擎进行伤害模拟。

## 2. 现状分析

### 2.1 数据通路已通

```
API Bundle → MvpEngineClient.init(meta, bundle) → Worker → WasmBridge → JSON.stringify → Wasm engine_init
```

`wasmBridge.ts` 直接把整个 `GameDataBundle` 序列化传给 Wasm。只要 bundle 中存在 `benchmark` 字段，引擎就能正常消费。

### 2.2 核心差距

| 维度 | 前端 Bundle | Wasm BenchmarkBundle |
|------|------------|---------------------|
| 英雄属性 | `hero.baseStats`（基础面板） | `actor.attrs`（hero + items 合并后的最终属性） |
| 技能 | `skill.params`（松散 JSON） | `skillDefs[]`（结构化：formulaId, flags, dot, on-hit） |
| 装备 | `item.statsModifier`（数值加成） | `itemDefs[]`（on-hit/dot/反甲/黑切机制定义） |
| 公式 | `params.vars`（5 种 kind） | `formulas[]`（AST 树：Add/Multiply/ActorAttr/Constant） |
| 行为 | 不存在 | `actions[]`（behavior/cooldown/priority/manaCost） |
| 规则 | 不存在 | `rules`（scheduler 优先级、count_to_three） |

## 3. 分步实施计划

### Step 1：BenchmarkBundle TypeScript 类型定义

**文件**：`src/engine/benchmarkTypes.ts`

定义与 Rust `model.rs` 一一对应的 TypeScript 类型：

```typescript
// 顶层
export type BenchmarkBundle = {
  hpAttrKey: string;
  selfActor: BenchmarkActorDefinition;
  enemyActor: BenchmarkActorDefinition;
  rules: BenchmarkRules;
  skillDefs: BenchmarkSkillDefinition[];
  itemDefs: BenchmarkItemDefinition[];
  formulas: BenchmarkFormulaDefinition[];
};

// Actor
export type BenchmarkActorDefinition = {
  heroId: string;
  label: string;
  attrs: Record<string, number>;
  ownedItemIds: string[];
  priorities: string[];
  actions: BenchmarkActionDefinition[];
};

// Action
export type BenchmarkActionDefinition = {
  actionId: string;
  label: string;
  priority: number;
  behavior: ActionBehavior;
  cooldown: BenchmarkCooldownDefinition;
  manaCost: number;
};

export type ActionBehavior = 'basic_attack' | 'mystic_shot' | 'arcane_shift' | 'generate_shield' | 'stun';

export type BenchmarkCooldownDefinition =
  | { kind: 'basic_attack_interval' }
  | { kind: 'ability_haste_scaled'; baseMs: number }
  | { kind: 'fixed_ms'; ms: number };

// Skill
export type BenchmarkSkillDefinition = {
  skillId: string;
  label: string;
  typeIds?: string[];
  primaryFormulaId?: string;
  damageType?: 'physical' | 'magic' | 'true';
  flags?: BenchmarkDamageFlags;
  attachOnHitItemIds?: string[];
  cooldownReductionOnHitMs?: number;
  shieldFormulaId?: string;
  stunDurationMs?: number;
  dotFormulaId?: string;
  dotTicks?: number;
  dotIntervalMs?: number;
  finalKillEnemyHpOverride?: number;
};

export type BenchmarkDamageFlags = {
  canTriggerOnHit?: boolean;
  canLifeSteal?: boolean;
  canApplyBlackCleaver?: boolean;
  countsAsAttack?: boolean;
  isActiveSkillMagicDamage?: boolean;
};

// Item
export type BenchmarkItemDefinition = {
  itemId: string;
  label: string;
  onHitFormulaId?: string;
  onHitDamageType?: 'physical' | 'magic' | 'true';
  onHitFlags?: BenchmarkDamageFlags;
  dotFormulaId?: string;
  dotTicks?: number;
  dotIntervalMs?: number;
  retaliateFormulaId?: string;
  retaliateDamageType?: 'physical' | 'magic' | 'true';
  blackCleaverArmorRatioPerStack?: number;
  blackCleaverMaxStacks?: number;
  blackCleaverExpireAfterMs?: number;
};

// Formula
export type BenchmarkFormulaDefinition = {
  formulaId: string;
  label: string;
  expr: BenchmarkFormulaExpr;
  bypassValue?: number;
};

export type BenchmarkFormulaExpr =
  | { type: 'constant'; value: number }
  | { type: 'actor_attr'; actor: FormulaActorRef; attrKey: string }
  | { type: 'actor_hp_current'; actor: FormulaActorRef }
  | { type: 'actor_hp_max'; actor: FormulaActorRef }
  | { type: 'add'; terms: BenchmarkFormulaExpr[] }
  | { type: 'multiply'; factors: BenchmarkFormulaExpr[] };

export type FormulaActorRef = 'source' | 'target' | 'self_actor' | 'enemy';

// Rules
export type BenchmarkRules = {
  scheduler: {
    decidePriority: number;
    dotTickPriority: number;
    stunExpirePriority: number;
    blackCleaverExpirePriority: number;
  };
  countToThree?: {
    sourceSkillId: string;
    label: string;
    trueDamageFormulaId: string;
    procEveryHits: number;
  };
};
```

### Step 2：属性合并工具

**文件**：`src/engine/bundleCompiler.ts`（attrMerge 部分）

从 `runtime.ts` 的 `resolveCombatant()` 提取复用：

```
hero.baseStats + Σ item[i].statsModifier + attributeDefinitions.defaultValue → actor.attrs
```

逻辑已验证可用，只需重构为独立函数。

### Step 3：公式 AST 编译器

**文件**：`src/engine/formulaCompiler.ts`

将 `params.vars` 中的 5 种变量类型编译为 `BenchmarkFormulaExpr`：

| 变量 kind | 编译策略 |
|-----------|---------|
| `const` | `{ type: "constant", value }` |
| `table` | 按等级索引取值 → `Constant` |
| `scaled_attr` | `Multiply(ActorAttr(attr, coeff), Constant(coefficient))` |
| `formula` | 解析 `formulaText` 中的变量引用，递归展开 → `Add/Multiply` 树 |
| `mapping_scaled_attr` | 按选择器取系数 → `Multiply(ActorAttr, Constant)` |

MVP 阶段的 `formulaText` 只包含简单加法/乘法和变量引用（`base_damage + ap_damage`），不需要完整数学解析器。用正则拆分 `+` / `*` 运算符 + 变量查表即可。

### Step 4：技能 → SkillDef 映射

**文件**：`src/engine/bundleCompiler.ts`（compileSkillDef 部分）

对于每个技能，从 `mechanicsConfig.triggers` 中提取：

1. **伤害公式**：找 `actions[type=deal_damage]` → 编译为 formula → 设为 `primaryFormulaId`
2. **damageType**：从 damage action 中取
3. **flags**：从 typeRelations 推导（type_can_trigger_on_hit 等）
4. **attachOnHitItemIds**：如果 flags.canTriggerOnHit = true，关联角色已装备的 on-hit 装备
5. **DoT**：找 `schedule_tick` + `on_tick → deal_damage` 组合 → 编译为 dot 公式
6. **stunDurationMs**：找 `apply_modifier` 中控制类效果

第一步用硬编码映射表覆盖 MVP 数据（卡特琳娜 + 基准测试角色），后续迭代通用化。

### Step 5：装备 → ItemDef 映射

**文件**：`src/engine/bundleCompiler.ts`（compileItemDef 部分）

装备通过 `item.skillRefs` 关联被动技能，从被动技能的 `mechanicsConfig` 中提取：

| 装备机制 | 识别方式 |
|---------|---------|
| on-hit 附伤 | trigger event = `on_basic_attack_hit`, action = `deal_damage` |
| DoT | action = `schedule_tick` + `on_tick → deal_damage` |
| 反甲 | trigger event = `on_damage_taken`, action = `deal_damage` |
| 黑切叠层 | action = `add_stack` + `apply_modifier(armor_shred)` |

### Step 6：Action 生成 + Rules 配置

**文件**：`src/engine/bundleCompiler.ts`（compileActor 部分）

Action 生成规则：
- 有 `basic_attack` 类型的技能 → `behavior: "basic_attack"`，`cooldown: { kind: "basic_attack_interval" }`
- 有主动技能（含冷却和法力消耗） → 映射为对应 behavior，`cooldown: { kind: "ability_haste_scaled", baseMs }`
- 敌方特殊技能（护盾/眩晕） → `behavior: "generate_shield" | "stun"`

Rules 使用合理默认值：
```json
{
  "scheduler": { "decidePriority": 0, "dotTickPriority": 10, "stunExpirePriority": -10, "blackCleaverExpirePriority": 5 },
  "countToThree": null
}
```

### Step 7：BundleCompiler 主入口

**文件**：`src/engine/bundleCompiler.ts`

```typescript
export type CompileScenarioInput = {
  bundle: GameDataBundle;
  selfHeroId: string;
  selfItemIds: string[];
  selfLevel: number;
  selfSkillLevels?: Record<string, number>;
  enemyHeroId: string;
  enemyItemIds: string[];
  enemyLevel: number;
};

export function compileBenchmarkBundle(input: CompileScenarioInput): BenchmarkBundle;
```

### Step 8：集成到现有页面

在 `KatarinaMvpPage.tsx` 或新建的场景模拟页中：
1. 从 API 获取 `GameDataBundle`（已有 `bundleSnapshot` 服务）
2. 调用 `compileBenchmarkBundle(...)` 编译出 `BenchmarkBundle`
3. 将 `benchmark` 字段注入 bundle
4. 传给 `MvpEngineClient.init(meta, enrichedBundle)`
5. 调用 `client.run(runInput)` 获取结果

## 4. 文件结构

```
web/src/engine/
├── benchmarkTypes.ts       # BenchmarkBundle 完整 TS 类型（新建）
├── formulaCompiler.ts      # params.vars → FormulaExpr AST 编译器（新建）
├── bundleCompiler.ts       # 主编译入口 + 属性合并 + 技能/装备/Action 映射（新建）
├── client.ts               # 已有，无需改动
├── wasmBridge.ts           # 已有，无需改动
├── worker.ts               # 已有，无需改动
├── runtime.ts              # 已有 JS 降级运行时，保留
└── types.ts                # 已有引擎协议类型，无需改动
```

## 5. 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| `ActionBehavior` 枚举硬编码（5 种） | 新技能行为无法自动映射 | MVP 用映射表；后续推动引擎泛化 |
| `formulaText` 解析有边界情况 | 复杂公式编译失败 | 先覆盖 MVP 数据集；增加 fallback 和错误提示 |
| 装备机制识别有误 | 部分装备效果丢失 | 单元测试覆盖已知装备；逐步扩展 |
| `GameDataBundle` 缺少 `benchmark` 字段的 TS 类型 | 编译警告 | 在 `api.ts` 中扩展类型定义 |

## 6. 工时估算

| 步骤 | 内容 | 估时 |
|------|------|------|
| Step 1 | BenchmarkBundle TS 类型定义 | 0.5 天 |
| Step 2 | 属性合并工具 | 0.5 天 |
| Step 3 | 公式 AST 编译器 | 1.5 天 |
| Step 4 | 技能 → SkillDef 映射 | 1.5 天 |
| Step 5 | 装备 → ItemDef 映射 | 1 天 |
| Step 6 | Action + Rules 生成 | 0.5 天 |
| Step 7 | 主入口 + API 类型扩展 | 0.5 天 |
| Step 8 | 集成验证 | 1 天 |
| **合计** | | **~7 天** |
