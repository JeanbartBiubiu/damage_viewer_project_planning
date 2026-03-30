/**
 * BenchmarkBundle TypeScript 类型定义
 *
 * 与 Rust model.rs 中 BenchmarkBundle 及其子结构一一对应。
 * Wasm 引擎通过 serde(rename_all = "camelCase") 序列化，
 * 因此所有字段名使用 camelCase。
 */

// ─── 顶层 ────────────────────────────────────────────────────

export type BenchmarkBundle = {
  hpAttrKey: string;
  selfActor: BenchmarkActorDefinition;
  enemyActor: BenchmarkActorDefinition;
  rules: BenchmarkRules;
  skillDefs: BenchmarkSkillDefinition[];
  itemDefs: BenchmarkItemDefinition[];
  formulas: BenchmarkFormulaDefinition[];
  /**
   * 管线公式：减伤 / 冷却缩减 / 护盾 / 移速等。
   * 引擎在对应结算阶段调用，输入值通过 input_value 节点注入。
   * key = 标准 bindingKey（如 "mitigation.physical"、"cooldown.ability"）
   */
  pipelineFormulas?: Record<string, BenchmarkFormulaDefinition>;
};

// ─── Actor ───────────────────────────────────────────────────

export type BenchmarkActorDefinition = {
  heroId: string;
  label: string;
  attrs: Record<string, number>;
  ownedItemIds: string[];
  priorities: string[];
  actions: BenchmarkActionDefinition[];
};

// ─── Action ──────────────────────────────────────────────────

export type ActionBehavior =
  | 'basic_attack'
  | 'mystic_shot'
  | 'arcane_shift'
  | 'generate_shield'
  | 'stun';

export type BenchmarkCooldownDefinition =
  | { kind: 'basic_attack_interval' }
  | { kind: 'ability_haste_scaled'; baseMs: number }
  | { kind: 'fixed_ms'; ms: number };

export type BenchmarkActionDefinition = {
  actionId: string;
  label: string;
  priority: number;
  behavior: ActionBehavior;
  cooldown: BenchmarkCooldownDefinition;
  manaCost: number;
};

// ─── Skill ───────────────────────────────────────────────────

export type BenchmarkDamageFlags = {
  canTriggerOnHit?: boolean;
  canLifeSteal?: boolean;
  canApplyBlackCleaver?: boolean;
  countsAsAttack?: boolean;
  isActiveSkillMagicDamage?: boolean;
};

export type BenchmarkSkillDefinition = {
  skillId: string;
  label: string;
  typeIds?: string[];
  primaryFormulaId?: string;
  damageType?: DamageTypeTag;
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

// ─── Item ────────────────────────────────────────────────────

export type BenchmarkItemDefinition = {
  itemId: string;
  label: string;
  onHitFormulaId?: string;
  onHitDamageType?: DamageTypeTag;
  onHitFlags?: BenchmarkDamageFlags;
  dotFormulaId?: string;
  dotTicks?: number;
  dotIntervalMs?: number;
  retaliateFormulaId?: string;
  retaliateDamageType?: DamageTypeTag;
  blackCleaverArmorRatioPerStack?: number;
  blackCleaverMaxStacks?: number;
  blackCleaverExpireAfterMs?: number;
};

// ─── Formula ─────────────────────────────────────────────────

export type FormulaActorRef = 'source' | 'target' | 'self_actor' | 'enemy';

export type BenchmarkFormulaExpr =
  | { type: 'constant'; value: number }
  | { type: 'actor_attr'; actor: FormulaActorRef; attrKey: string }
  | { type: 'actor_hp_current'; actor: FormulaActorRef }
  | { type: 'actor_hp_max'; actor: FormulaActorRef }
  | { type: 'add'; terms: BenchmarkFormulaExpr[] }
  | { type: 'multiply'; factors: BenchmarkFormulaExpr[] }
  // ─── 跨游戏扩展节点 ─────────────────────────────────────────
  | { type: 'subtract'; left: BenchmarkFormulaExpr; right: BenchmarkFormulaExpr }
  | { type: 'divide'; numerator: BenchmarkFormulaExpr; denominator: BenchmarkFormulaExpr }
  | { type: 'max'; operands: BenchmarkFormulaExpr[] }
  | { type: 'min'; operands: BenchmarkFormulaExpr[] }
  | { type: 'negate'; operand: BenchmarkFormulaExpr }
  /** 管线输入值：减伤公式中的 raw_damage、冷却公式中的 baseCd 等 */
  | { type: 'input_value' };

export type BenchmarkFormulaDefinition = {
  formulaId: string;
  label: string;
  expr: BenchmarkFormulaExpr;
  bypassValue?: number;
};

// ─── Rules ───────────────────────────────────────────────────

export type BenchmarkSchedulerRule = {
  decidePriority: number;
  dotTickPriority: number;
  stunExpirePriority: number;
  blackCleaverExpirePriority: number;
};

export type BenchmarkCountToThreeRule = {
  sourceSkillId: string;
  label: string;
  trueDamageFormulaId: string;
  procEveryHits: number;
};

export type BenchmarkRules = {
  scheduler: BenchmarkSchedulerRule;
  countToThree?: BenchmarkCountToThreeRule;
};

// ─── Shared ──────────────────────────────────────────────────

export type DamageTypeTag = 'physical' | 'magic' | 'true';
