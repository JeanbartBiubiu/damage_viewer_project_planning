/**
 * Bundle 编译器 — 主入口
 *
 * 将后端 API 返回的 GameDataBundle（管理数据）编译为
 * Wasm 引擎可消费的 BenchmarkBundle（运行时数据）。
 *
 * 使用方式：
 *   const benchmark = compileBenchmarkBundle({ bundle, selfHeroId, ... });
 *   // 将 benchmark 注入 bundle 后传给 MvpEngineClient
 */

import type {
  GameDataBundle,
  Hero,
  Item,
  Skill,
  AttributeDefinition,
  TypeRelation,
  FormulaProfile,
  FormulaBinding,
  JsonObject,
  JsonValue,
} from '../types/api';

import type {
  BenchmarkBundle,
  BenchmarkActorDefinition,
  BenchmarkActionDefinition,
  BenchmarkSkillDefinition,
  BenchmarkItemDefinition,
  BenchmarkFormulaDefinition,
  BenchmarkFormulaExpr,
  BenchmarkDamageFlags,
  BenchmarkRules,
  ActionBehavior,
  DamageTypeTag,
} from './benchmarkTypes';

import {
  compileVarsToExprMap,
  compileFormulaText,
  buildFormulaDefinition,
  type VarDefinition,
  type FormulaCompileContext,
} from './formulaCompiler';

// ═══════════════════════════════════════════════════════════════
// 公开接口
// ═══════════════════════════════════════════════════════════════

export type CompileScenarioInput = {
  bundle: GameDataBundle;
  selfHeroId: string;
  selfItemIds: string[];
  selfLevel: number;
  selfSkillLevels?: Record<string, number>;
  /** 自方优先技能列表（决定 AI 释放顺序） */
  selfPriorities?: string[];
  enemyHeroId: string;
  enemyItemIds: string[];
  enemyLevel: number;
  enemySkillLevels?: Record<string, number>;
  enemyPriorities?: string[];
  /** mapping_scaled_attr 选择器值 */
  selectorValues?: Record<string, string>;
  /** hp 属性键，默认 "hp" */
  hpAttrKey?: string;
};

/**
 * 核心编译函数：从管理数据编译出 BenchmarkBundle。
 */
export function compileBenchmarkBundle(input: CompileScenarioInput): BenchmarkBundle {
  const ctx = buildCatalog(input);

  const selfActor = compileActor(ctx, 'self');
  const enemyActor = compileActor(ctx, 'enemy');

  const rules = compileRules(ctx);

  // 编译管线公式（减伤 / 冷却 / 护盾等）
  compilePipelineFormulas(ctx);

  const pipelineFormulas: Record<string, BenchmarkFormulaDefinition> = {};
  for (const [key, def] of ctx.pipelineFormulaDefs) {
    pipelineFormulas[key] = def;
  }

  return {
    hpAttrKey: ctx.hpAttrKey,
    selfActor,
    enemyActor,
    rules,
    skillDefs: [...ctx.skillDefs.values()],
    itemDefs: [...ctx.itemDefs.values()],
    formulas: [...ctx.formulaDefs.values()],
    ...(ctx.pipelineFormulaDefs.size > 0 ? { pipelineFormulas } : {}),
  };
}

/**
 * 便捷方法：编译后直接注入到 bundle 中，返回带 benchmark 字段的 bundle。
 */
export function compileAndInjectBenchmark(
  input: CompileScenarioInput
): GameDataBundle & { benchmark: BenchmarkBundle } {
  const benchmark = compileBenchmarkBundle(input);
  return { ...input.bundle, benchmark } as any;
}

// ═══════════════════════════════════════════════════════════════
// 内部编译上下文
// ═══════════════════════════════════════════════════════════════

type CompileContext = {
  hpAttrKey: string;
  input: CompileScenarioInput;
  bundle: GameDataBundle;
  // 索引
  heroesById: Map<string, Hero>;
  itemsById: Map<string, Item>;
  skillsById: Map<string, Skill>;
  attrDefs: AttributeDefinition[];
  typeRelations: TypeRelation[];
  // 按 owner 分组的技能
  skillsByOwner: Map<string, Skill[]>;
  // 公式编译上下文
  selfFormulaCtx: FormulaCompileContext;
  enemyFormulaCtx: FormulaCompileContext;
  // FormulaProfile / FormulaBinding 索引
  formulaProfilesById: Map<string, FormulaProfile>;
  bindingsByTarget: Map<string, FormulaBinding[]>;
  // 编译输出收集（去重）
  skillDefs: Map<string, BenchmarkSkillDefinition>;
  itemDefs: Map<string, BenchmarkItemDefinition>;
  formulaDefs: Map<string, BenchmarkFormulaDefinition>;
  pipelineFormulaDefs: Map<string, BenchmarkFormulaDefinition>;
  formulaCounter: number;
};

function buildCatalog(input: CompileScenarioInput): CompileContext {
  const bundle = input.bundle;
  const hpAttrKey = input.hpAttrKey ?? 'hp';

  const heroesById = new Map(bundle.heroes.map((h) => [h.heroId, h]));
  const itemsById = new Map(bundle.items.map((it) => [it.itemId, it]));
  const skillsById = new Map(bundle.skills.map((s) => [s.skillId, s]));

  // 按 owner 分组
  const skillsByOwner = new Map<string, Skill[]>();
  for (const skill of bundle.skills) {
    const key = `${skill.ownerType}:${skill.ownerId}`;
    const list = skillsByOwner.get(key) ?? [];
    list.push(skill);
    skillsByOwner.set(key, list);
  }

  const defaultSkillLevel = 1;
  const selfFormulaCtx: FormulaCompileContext = {
    skillLevel: defaultSkillLevel,
    championLevel: input.selfLevel,
    selectorValues: input.selectorValues,
  };
  const enemyFormulaCtx: FormulaCompileContext = {
    skillLevel: defaultSkillLevel,
    championLevel: input.enemyLevel,
    selectorValues: input.selectorValues,
  };

  // FormulaProfile / FormulaBinding 索引
  const formulaProfilesById = new Map(
    (bundle.formulaProfiles ?? []).map((fp) => [fp.formulaId, fp])
  );
  const bindingsByTarget = new Map<string, FormulaBinding[]>();
  for (const fb of bundle.formulaBindings ?? []) {
    const key = `${fb.targetCategory}:${fb.targetId}`;
    const list = bindingsByTarget.get(key) ?? [];
    list.push(fb);
    bindingsByTarget.set(key, list);
  }

  return {
    hpAttrKey,
    input,
    bundle,
    heroesById,
    itemsById,
    skillsById,
    attrDefs: bundle.attributeDefinitions,
    typeRelations: bundle.typeRelations ?? [],
    skillsByOwner,
    selfFormulaCtx,
    enemyFormulaCtx,
    formulaProfilesById,
    bindingsByTarget,
    skillDefs: new Map(),
    itemDefs: new Map(),
    formulaDefs: new Map(),
    pipelineFormulaDefs: new Map(),
    formulaCounter: 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// 属性合并（从 runtime.ts 提取 + 增强）
// ═══════════════════════════════════════════════════════════════

function mergeActorAttrs(
  ctx: CompileContext,
  heroId: string,
  itemIds: string[],
  level: number
): Record<string, number> {
  const hero = ctx.heroesById.get(heroId);
  if (!hero) throw new Error(`Hero not found: ${heroId}`);

  // 1. 默认值
  const attrs: Record<string, number> = {};
  for (const def of ctx.attrDefs) {
    attrs[def.attrKey] = toNum(def.defaultValue);
  }

  // 2. 英雄属性：优先使用 statsByLevel 按等级查找，回退到 baseStats
  const levelAttrs = resolveHeroStatsAtLevel(hero, level);
  for (const [key, val] of Object.entries(levelAttrs)) {
    attrs[key] = (attrs[key] ?? 0) + toNum(val);
  }

  // 3. 装备属性
  for (const itemId of itemIds) {
    const item = ctx.itemsById.get(itemId);
    if (!item) {
      console.warn(`Item not found: ${itemId}, skipping`);
      continue;
    }
    if (item.statsModifier && typeof item.statsModifier === 'object') {
      for (const [key, val] of Object.entries(item.statsModifier)) {
        attrs[key] = (attrs[key] ?? 0) + toNum(val);
      }
    }
  }

  return attrs;
}

/**
 * 从 hero.statsByLevel 按等级提取属性，无法提取时回退到 hero.baseStats。
 *
 * 支持两种 statsByLevel 格式：
 * - 格式 A（属性→数组）: { "hp": [672, 780, ...], "ad": [58, 61.2, ...] }
 * - 格式 B（等级→属性）: { "1": { "hp": 672, "ad": 58 }, "2": { "hp": 780 } }
 */
function resolveHeroStatsAtLevel(hero: Hero, level: number): Record<string, unknown> {
  const sbl = hero.statsByLevel;
  if (!sbl || typeof sbl !== 'object') return hero.baseStats ?? {};

  const keys = Object.keys(sbl);
  if (keys.length === 0) return hero.baseStats ?? {};

  // 格式 B：key 是等级号（"1".."18"）
  const levelKey = String(level);
  const levelEntry = sbl[levelKey];
  if (levelEntry && typeof levelEntry === 'object' && !Array.isArray(levelEntry)) {
    return levelEntry as Record<string, unknown>;
  }

  // 格式 A：value 是数组（每元素对应 level 1..N）
  const firstVal = sbl[keys[0]];
  if (Array.isArray(firstVal)) {
    const result: Record<string, number> = {};
    for (const [attrKey, values] of Object.entries(sbl)) {
      if (Array.isArray(values) && values.length > 0) {
        const idx = clamp(level, 1, values.length) - 1;
        result[attrKey] = toNum((values as JsonValue[])[idx]);
      }
    }
    if (Object.keys(result).length > 0) return result;
  }

  // 回退到 baseStats
  return hero.baseStats ?? {};
}

// ═══════════════════════════════════════════════════════════════
// Actor 编译
// ═══════════════════════════════════════════════════════════════

function compileActor(
  ctx: CompileContext,
  side: 'self' | 'enemy'
): BenchmarkActorDefinition {
  const isSelf = side === 'self';
  const heroId = isSelf ? ctx.input.selfHeroId : ctx.input.enemyHeroId;
  const itemIds = isSelf ? ctx.input.selfItemIds : ctx.input.enemyItemIds;
  const hero = ctx.heroesById.get(heroId);
  if (!hero) throw new Error(`Hero not found: ${heroId}`);

  const level = isSelf ? ctx.input.selfLevel : ctx.input.enemyLevel;
  const attrs = mergeActorAttrs(ctx, heroId, itemIds, level);
  const priorities = (isSelf ? ctx.input.selfPriorities : ctx.input.enemyPriorities) ?? [];

  // 收集该角色的英雄技能
  const heroSkills = ctx.skillsByOwner.get(`hero:${hero.heroId}`) ?? [];

  // 收集装备关联技能
  const itemSkillIds = new Set<string>();
  for (const itemId of itemIds) {
    const item = ctx.itemsById.get(itemId);
    if (item?.skillRefs) {
      for (const ref of item.skillRefs) {
        itemSkillIds.add(ref);
      }
    }
  }

  // 生成 actions
  const actions = compileActionsForActor(ctx, heroSkills, side);
  const actionIdSet = new Set(actions.map((a) => a.actionId));

  // 编译英雄技能 → SkillDef
  const formulaCtx = isSelf ? ctx.selfFormulaCtx : ctx.enemyFormulaCtx;
  const skillLevels = (isSelf ? ctx.input.selfSkillLevels : ctx.input.enemySkillLevels) ?? {};
  for (const skill of heroSkills) {
    if (!ctx.skillDefs.has(skill.skillId)) {
      const level = skillLevels[skill.skillId] ?? skillLevels[skill.skillKey ?? ''] ?? 1;
      const localCtx = { ...formulaCtx, skillLevel: level };
      const def = compileSkillDef(ctx, skill, localCtx, itemIds);
      if (def) {
        ctx.skillDefs.set(skill.skillId, def);
      }
    }
  }

  // 编译装备 → ItemDef + 装备关联的 SkillDef
  for (const itemId of itemIds) {
    if (!ctx.itemDefs.has(itemId)) {
      const itemDef = compileItemDef(ctx, itemId, formulaCtx);
      if (itemDef) {
        ctx.itemDefs.set(itemId, itemDef);
      }
    }
  }

  return {
    heroId,
    label: hero.name ?? heroId,
    attrs,
    ownedItemIds: [...itemIds],
    priorities: priorities.filter((p) => actionIdSet.has(p)),
    actions,
  };
}

// ═══════════════════════════════════════════════════════════════
// Action 编译
// ═══════════════════════════════════════════════════════════════

/** 已知的 skillKey → ActionBehavior 映射 */
const SKILL_KEY_BEHAVIOR_MAP: Record<string, ActionBehavior> = {
  A: 'basic_attack',
};

/**
 * 从英雄技能列表生成 BenchmarkActionDefinition[]。
 * MVP 策略：
 * - skillKey="A" → basic_attack
 * - 有 cooldowns 或 mechanicsConfig.triggers 的主动技能 → ability_haste_scaled
 * - 其余（被动/无触发器）→ 不生成 action
 */
function compileActionsForActor(
  ctx: CompileContext,
  heroSkills: Skill[],
  side: 'self' | 'enemy'
): BenchmarkActionDefinition[] {
  const actions: BenchmarkActionDefinition[] = [];
  let priorityCounter = 10;

  for (const skill of heroSkills) {
    const skillKey = skill.skillKey ?? '';
    const knownBehavior = SKILL_KEY_BEHAVIOR_MAP[skillKey];

    if (knownBehavior === 'basic_attack') {
      actions.push({
        actionId: skill.skillId,
        label: skill.name ?? skill.skillId,
        priority: 100, // 普攻优先级最低
        behavior: 'basic_attack',
        cooldown: { kind: 'basic_attack_interval' },
        manaCost: extractManaCost(skill),
      });
      continue;
    }

    // P (被动) 没有 action
    if (skillKey === 'P') continue;

    // 判断是否为主动技能：有 cooldowns 或有 mechanicsConfig 触发器
    const cooldowns = skill.cooldowns ?? [];
    const mc = skill.mechanicsConfig as JsonObject | undefined;
    const triggers = (mc?.triggers as JsonValue[]) ?? [];
    const hasTriggers = triggers.length > 0;
    const params = skill.params as JsonObject | undefined;

    if (cooldowns.length > 0 || hasTriggers) {
      // 从 cooldowns 或 params 中提取冷却时间
      let baseCdMs = 0;
      if (cooldowns.length > 0) {
        const baseCdSeconds = extractCooldownSeconds(skill, ctx.selfFormulaCtx.skillLevel);
        baseCdMs = Math.round(baseCdSeconds * 1000);
      } else if (params) {
        // 尝试从 params 中获取 CD 信息
        const channelMs = toNum(params.channelDurationMs);
        if (channelMs > 0) baseCdMs = channelMs;
        // 也试 baseCd / cooldownMs
        const paramCd = toNum(params.baseCd ?? params.cooldownMs ?? params.cooldown);
        if (paramCd > 0) baseCdMs = Math.round(paramCd * 1000);
      }
      // 兜底：没有 CD 信息的主动技能给一个合理默认值
      if (baseCdMs <= 0) baseCdMs = 10000;

      const behavior = inferBehavior(skill, side);

      actions.push({
        actionId: skill.skillId,
        label: skill.name ?? skill.skillId,
        priority: priorityCounter,
        behavior,
        cooldown: { kind: 'ability_haste_scaled', baseMs: baseCdMs },
        manaCost: extractManaCost(skill),
      });
      priorityCounter += 10;
    }
  }

  return actions;
}

function inferBehavior(skill: Skill, _side: 'self' | 'enemy'): ActionBehavior {
  const mc = skill.mechanicsConfig as JsonObject | undefined;
  if (!mc) return 'basic_attack';

  const triggers = mc.triggers as JsonValue[] | undefined;
  if (!triggers || triggers.length === 0) return 'basic_attack';

  // 检查是否有 shield / stun 类 action
  for (const trigger of triggers) {
    const t = trigger as JsonObject;
    const actionList = t.actions as JsonValue[] | undefined;
    if (!actionList) continue;
    for (const action of actionList) {
      const a = action as JsonObject;
      const type = a.type as string;
      if (type === 'apply_modifier') {
        // 检查是否是护盾（有 shield 关键词或 target=self 的 hp 修改）
        const mod = a.modifier as JsonObject | undefined;
        if (mod) {
          const stats = mod.stats as JsonValue[] | undefined;
          if (stats) {
            for (const stat of stats) {
              const s = stat as JsonObject;
              if (String(s.key ?? '').includes('shield')) {
                return 'generate_shield';
              }
            }
          }
        }
      }
    }
  }

  // 检查 stun 关键词
  const name = (skill.name ?? '').toLowerCase();
  if (name.includes('眩晕') || name.includes('stun')) return 'stun';
  if (name.includes('护盾') || name.includes('shield')) return 'generate_shield';

  // 检查是否有 deal_damage 且伤害类型是 magic + canTriggerOnHit=false → arcane_shift 风格
  const hasDamage = triggers.some((t) => {
    const tr = t as JsonObject;
    return ((tr.actions as JsonValue[]) ?? []).some(
      (a) => (a as JsonObject).type === 'deal_damage'
    );
  });

  // 有位移扩展？
  const ext = skill.mvpExtensions as JsonObject | undefined;
  if (ext?.movement) return 'arcane_shift';

  // 默认：有伤害的主动技能用 mystic_shot
  if (hasDamage) return 'mystic_shot';

  return 'basic_attack';
}

function extractManaCost(skill: Skill): number {
  const costs = skill.resourceCosts ?? [];
  if (costs.length === 0) return 0;
  const first = costs[0] as JsonObject;
  return toNum(first?.value);
}

function extractCooldownSeconds(skill: Skill, skillLevel: number): number {
  const cooldowns = skill.cooldowns ?? [];
  if (cooldowns.length === 0) return 0;
  const first = cooldowns[0] as JsonObject;
  const kind = first?.kind as string;
  if (kind === 'const') return toNum(first?.value);
  if (kind === 'table') {
    const values = first?.values as number[] | undefined;
    if (values && values.length > 0) {
      const idx = clamp(skillLevel, 1, values.length) - 1;
      return toNum(values[idx]);
    }
  }
  return toNum(first?.value);
}

// ═══════════════════════════════════════════════════════════════
// Skill → SkillDef 编译
// ═══════════════════════════════════════════════════════════════

function compileSkillDef(
  ctx: CompileContext,
  skill: Skill,
  formulaCtx: FormulaCompileContext,
  actorItemIds: string[]
): BenchmarkSkillDefinition | null {
  const mc = skill.mechanicsConfig as JsonObject | undefined;
  const triggers = (mc?.triggers as JsonValue[]) ?? [];
  const params = skill.params as JsonObject | undefined;
  const vars = (params?.vars as Record<string, any>) ?? {};

  // 编译变量 → formula AST（如果有 params.vars 格式）
  let varExprs: Map<string, BenchmarkFormulaExpr>;
  try {
    varExprs = compileVarsToExprMap(vars as Record<string, VarDefinition>, formulaCtx);
  } catch (e) {
    console.warn(`Failed to compile vars for skill ${skill.skillId}:`, e);
    varExprs = new Map();
  }

  const result: BenchmarkSkillDefinition = {
    skillId: skill.skillId,
    label: skill.name ?? skill.skillId,
  };

  // 收集 typeIds
  const typeIds = collectTypeIds(ctx, skill.skillId);
  if (typeIds.length > 0) result.typeIds = typeIds;

  // 找主伤害 trigger
  const primaryDamage = findPrimaryDamage(triggers);
  const damageTypeFromParams = params?.damageType as string | undefined;

  // ── 三阶优先级查找公式 ──
  // 优先级 1：从 FormulaBinding 查找
  const bindingFormulaId = resolveFormulaFromBinding(ctx, 'skill', skill.skillId, 'primary_damage', formulaCtx);
  if (bindingFormulaId) {
    result.primaryFormulaId = bindingFormulaId;
    const damageType = (damageTypeFromParams ?? primaryDamage?.damageType ?? 'physical') as DamageTypeTag;
    result.damageType = damageType;
    result.flags = inferFlags(ctx, skill, damageType);
    if (result.flags?.canTriggerOnHit) {
      const onHitItemIds = actorItemIds.filter((itemId) => {
        const item = ctx.itemsById.get(itemId);
        return item && hasOnHitTrigger(ctx, item);
      });
      if (onHitItemIds.length > 0) result.attachOnHitItemIds = onHitItemIds;
    }
  } else if (primaryDamage) {
    // 优先级 2/3：mechanicsConfig formulaText 或 flat params（原有逻辑）
    let formulaExpr: BenchmarkFormulaExpr | null = null;
    let formulaLabel = skill.name ?? skill.skillId;

    if (primaryDamage.formulaText && primaryDamage.formulaText !== '0') {
      // 有显式 formulaText — 使用标准编译路径
      const formulaId = registerFormula(ctx, skill.skillId, formulaLabel, primaryDamage.formulaText, primaryDamage.formulaVars, varExprs);
      result.primaryFormulaId = formulaId;
    } else {
      // 无 formulaText — 尝试从 flat params 构建公式 AST
      formulaExpr = buildFormulaFromFlatParams(params, formulaCtx);
      if (formulaExpr) {
        const formulaId = `formula_${skill.skillId.replace(/[^a-zA-Z0-9_]/g, '_')}`;
        if (!ctx.formulaDefs.has(formulaId)) {
          const bypassValue = evaluateConstantExpr(formulaExpr);
          ctx.formulaDefs.set(formulaId, buildFormulaDefinition(formulaId, formulaLabel, formulaExpr, bypassValue));
        }
        result.primaryFormulaId = formulaId;
      }
    }

    const damageType = (primaryDamage.damageType !== 'undefined' ? primaryDamage.damageType : damageTypeFromParams ?? 'physical') as DamageTypeTag;
    result.damageType = damageType;

    // flags
    result.flags = inferFlags(ctx, skill, damageType);

    // attachOnHitItemIds — 只在 canTriggerOnHit 时
    if (result.flags?.canTriggerOnHit) {
      const onHitItemIds = actorItemIds.filter((itemId) => {
        const item = ctx.itemsById.get(itemId);
        return item && hasOnHitTrigger(ctx, item);
      });
      if (onHitItemIds.length > 0) result.attachOnHitItemIds = onHitItemIds;
    }
  } else if (damageTypeFromParams) {
    // 没有 trigger 里的伤害 action，但 params 中有 damageType — 从 flat params 构建
    const formulaExpr = buildFormulaFromFlatParams(params, formulaCtx);
    if (formulaExpr) {
      const formulaId = `formula_${skill.skillId.replace(/[^a-zA-Z0-9_]/g, '_')}`;
      if (!ctx.formulaDefs.has(formulaId)) {
        const bypassValue = evaluateConstantExpr(formulaExpr);
        ctx.formulaDefs.set(formulaId, buildFormulaDefinition(formulaId, skill.name ?? skill.skillId, formulaExpr, bypassValue));
      }
      result.primaryFormulaId = formulaId;
      result.damageType = damageTypeFromParams as DamageTypeTag;
      result.flags = inferFlags(ctx, skill, damageTypeFromParams as DamageTypeTag);
    }
  }

  // 检查 cooldownReductionOnHitMs（如 Q 的命中减 CD）
  const ext = (skill as any).mvpExtensions as JsonObject | undefined;
  if (ext?.attackInteraction) {
    const ai = ext.attackInteraction as JsonObject;
    if (ai.resetBasicAttackTimer) {
      // E 类：可触发 on-hit
    }
  }

  // 找 DoT（schedule_tick + on_tick → deal_damage）
  const dotInfo = findDotInfo(triggers);
  if (dotInfo) {
    const dotFormulaId = registerFormula(
      ctx,
      `${skill.skillId}_dot`,
      `${skill.name ?? skill.skillId} DoT`,
      dotInfo.formulaText,
      dotInfo.formulaVars,
      varExprs
    );
    result.dotFormulaId = dotFormulaId;
    result.dotTicks = dotInfo.ticks;
    result.dotIntervalMs = dotInfo.intervalMs;
  }

  // 找 shield
  const shieldInfo = findShieldInfo(triggers, varExprs);
  if (shieldInfo) {
    const shieldFormulaId = registerFormula(
      ctx,
      `${skill.skillId}_shield`,
      `${skill.name ?? skill.skillId} Shield`,
      shieldInfo.formulaText,
      shieldInfo.formulaVars,
      varExprs
    );
    result.shieldFormulaId = shieldFormulaId;
  }

  // 检查是否是 stun 技能
  if (skill.name?.includes('眩晕') || skill.name?.includes('stun')) {
    // 默认 stun 500ms
    result.stunDurationMs = 500;
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════
// Item → ItemDef 编译
// ═══════════════════════════════════════════════════════════════

function compileItemDef(
  ctx: CompileContext,
  itemId: string,
  formulaCtx: FormulaCompileContext
): BenchmarkItemDefinition | null {
  const item = ctx.itemsById.get(itemId);
  if (!item) return null;

  const result: BenchmarkItemDefinition = {
    itemId,
    label: item.name ?? itemId,
  };

  // 查找装备关联技能
  const itemSkills = (item.skillRefs ?? [])
    .map((ref) => ctx.skillsById.get(ref))
    .filter(Boolean) as Skill[];

  // 也查找 ownerType=item 且 ownerId 匹配的技能
  const ownerKey = `item:${item.name ?? itemId}`;
  const ownerSkills = ctx.skillsByOwner.get(ownerKey) ?? [];
  // 合并
  const allSkills = [...itemSkills, ...ownerSkills.filter((s) => !itemSkills.some((is) => is.skillId === s.skillId))];

  for (const skill of allSkills) {
    const params = skill.params as JsonObject | undefined;
    const vars = (params?.vars as Record<string, any>) ?? {};
    let varExprs: Map<string, BenchmarkFormulaExpr>;
    try {
      varExprs = compileVarsToExprMap(vars as Record<string, VarDefinition>, formulaCtx);
    } catch {
      varExprs = new Map();
    }

    const mc = skill.mechanicsConfig as JsonObject | undefined;
    const triggers = (mc?.triggers as JsonValue[]) ?? [];

    for (const trigger of triggers) {
      const t = trigger as JsonObject;
      const event = t.event as JsonObject;
      const eventType = event?.type as string;
      const actions = (t.actions as JsonValue[]) ?? [];

      for (const action of actions) {
        const a = action as JsonObject;
        const actionType = a.type as string;

        if (actionType === 'deal_damage' && eventType === 'on_basic_attack_hit') {
          // on-hit 附伤
          if (!result.onHitFormulaId) {
            const dmg = a.damage as JsonObject;
            const formulaId = registerFormula(
              ctx,
              `${itemId}_on_hit`,
              `${item.name ?? itemId} on-hit`,
              String(dmg?.formulaText ?? '0'),
              (dmg?.formulaVars as string[]) ?? [],
              varExprs
            );
            result.onHitFormulaId = formulaId;
            result.onHitDamageType = (dmg?.damageType as DamageTypeTag) ?? 'physical';
            result.onHitFlags = {
              canTriggerOnHit: false,
              canLifeSteal: true,
              canApplyBlackCleaver: result.onHitDamageType === 'physical',
              countsAsAttack: false,
              isActiveSkillMagicDamage: false,
            };
          }
        }

        if (actionType === 'deal_damage' && eventType === 'on_damage_taken') {
          // 反甲
          if (!result.retaliateFormulaId) {
            const dmg = a.damage as JsonObject;
            const formulaId = registerFormula(
              ctx,
              `${itemId}_retaliate`,
              `${item.name ?? itemId} retaliate`,
              String(dmg?.formulaText ?? '0'),
              (dmg?.formulaVars as string[]) ?? [],
              varExprs
            );
            result.retaliateFormulaId = formulaId;
            result.retaliateDamageType = (dmg?.damageType as DamageTypeTag) ?? 'magic';
          }
        }

        if (actionType === 'schedule_tick') {
          // 装备 DoT
          const tickKey = a.tickKey as string;
          const everyMs = toNum(a.everyMs, 1000);
          const times = toNum(a.times, 3);

          // 找对应的 on_tick trigger
          const dotDmgTrigger = triggers.find((tr) => {
            const trig = tr as JsonObject;
            const ev = trig.event as JsonObject;
            return ev?.type === 'on_tick' && ev?.tickKey === tickKey;
          }) as JsonObject | undefined;

          if (dotDmgTrigger && !result.dotFormulaId) {
            const dotActions = (dotDmgTrigger.actions as JsonValue[]) ?? [];
            const dmgAction = dotActions.find((da) => (da as JsonObject).type === 'deal_damage') as JsonObject | undefined;
            if (dmgAction) {
              const dmg = dmgAction.damage as JsonObject;
              const formulaId = registerFormula(
                ctx,
                `${itemId}_dot`,
                `${item.name ?? itemId} DoT`,
                String(dmg?.formulaText ?? '0'),
                (dmg?.formulaVars as string[]) ?? [],
                varExprs
              );
              result.dotFormulaId = formulaId;
              result.dotTicks = times;
              result.dotIntervalMs = everyMs;
            }
          }
        }

        if (actionType === 'add_stack') {
          // 黑切类叠层检测
          const stackId = a.stackId as string;
          if (stackId && String(stackId).includes('armor')) {
            // armor shred stacks — 类似黑切
            result.blackCleaverArmorRatioPerStack = 0.05;
            result.blackCleaverMaxStacks = toNum(a.max, 6);
            result.blackCleaverExpireAfterMs = 5000;
          }
        }
      }
    }
  }

  return result;
}

function hasOnHitTrigger(ctx: CompileContext, item: Item): boolean {
  const itemSkills = (item.skillRefs ?? [])
    .map((ref) => ctx.skillsById.get(ref))
    .filter(Boolean) as Skill[];
  
  const ownerSkills = ctx.skillsByOwner.get(`item:${item.name ?? item.itemId}`) ?? [];
  const allSkills = [...itemSkills, ...ownerSkills];

  for (const skill of allSkills) {
    const mc = skill.mechanicsConfig as JsonObject | undefined;
    const triggers = (mc?.triggers as JsonValue[]) ?? [];
    for (const trigger of triggers) {
      const t = trigger as JsonObject;
      const event = t.event as JsonObject;
      if (event?.type === 'on_basic_attack_hit') {
        const actions = (t.actions as JsonValue[]) ?? [];
        if (actions.some((a) => (a as JsonObject).type === 'deal_damage')) {
          return true;
        }
      }
    }
    // 也检查 mvpExtensions.attackInteraction.isOnHitEffect
    const ext = (skill as any).mvpExtensions as JsonObject | undefined;
    if ((ext?.attackInteraction as JsonObject)?.isOnHitEffect) return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════
// Rules 编译
// ═══════════════════════════════════════════════════════════════

function compileRules(_ctx: CompileContext): BenchmarkRules {
  // MVP 使用合理默认值
  return {
    scheduler: {
      decidePriority: 0,
      dotTickPriority: 10,
      stunExpirePriority: -10,
      blackCleaverExpirePriority: 5,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// FormulaProfile / FormulaBinding 对接
// ═══════════════════════════════════════════════════════════════

/**
 * 标准管线公式绑定键。
 * 引擎在对应结算阶段按 key 查找管线公式：
 *   input_value 节点注入管线输入值（raw_damage / baseCd / shieldAmount 等）。
 */
export const PIPELINE_BINDING_KEYS = {
  MITIGATION_PHYSICAL: 'mitigation.physical',
  MITIGATION_MAGIC: 'mitigation.magic',
  MITIGATION_TRUE: 'mitigation.true',
  COOLDOWN_ABILITY: 'cooldown.ability',
  COOLDOWN_ULTIMATE: 'cooldown.ultimate',
  MOVE_SPEED: 'move_speed.base',
  SHIELD_ABSORPTION: 'shield.absorption',
  LIFE_STEAL: 'life_steal.base',
} as const;

/**
 * 从 FormulaBinding 查找并编译公式。
 *
 * @param targetCategory  绑定目标类别（skill/hero/item/global）
 * @param targetId        绑定目标 ID
 * @param bindingKey      绑定点（如 "primary_damage"、"mitigation.physical"）
 * @param formulaCtx      公式编译上下文（skillLevel / championLevel）
 * @returns 已注册的 formulaId，如果未找到绑定则返回 null
 */
function resolveFormulaFromBinding(
  ctx: CompileContext,
  targetCategory: string,
  targetId: string,
  bindingKey: string,
  formulaCtx: FormulaCompileContext
): string | null {
  const key = `${targetCategory}:${targetId}`;
  const bindings = ctx.bindingsByTarget.get(key);
  if (!bindings) return null;

  const binding = bindings.find((b) => b.bindingKey === bindingKey);
  if (!binding) return null;

  const profile = ctx.formulaProfilesById.get(binding.formulaId);
  if (!profile) {
    console.warn(`FormulaBinding references unknown profile: ${binding.formulaId}`);
    return null;
  }

  // 合并 profile.params + binding.overrideParams
  const params = {
    ...(profile.params as Record<string, unknown> ?? {}),
    ...(binding.overrideParams as Record<string, unknown> ?? {}),
  };

  return compileFormulaFromParams(ctx, binding.formulaId, profile.description ?? binding.formulaId, params, formulaCtx);
}

/**
 * 将 FormulaProfile.params 编译为 AST 并注册。
 *
 * 支持两种 params 格式（由 formulaKind 字段或 params 内容自动检测）：
 *
 * 1. flat_params 格式（简单 AD/AP 系数）：
 *    { baseDamageBySkillLevel: [...], adRatio: 1.3, apRatio: 0.2, damageType: "magic" }
 *
 * 2. vars_expr 格式（变量引用+公式文本）：
 *    { formulaText: "base_damage + ap_damage", vars: { base_damage: { kind: "table", ... } } }
 *
 * 3. ast 格式（预编译 AST）：
 *    { expr: { type: "add", terms: [...] } }
 */
function compileFormulaFromParams(
  ctx: CompileContext,
  formulaId: string,
  label: string,
  params: Record<string, unknown>,
  formulaCtx: FormulaCompileContext
): string | null {
  // 已注册则复用
  if (ctx.formulaDefs.has(formulaId)) return formulaId;
  if (ctx.pipelineFormulaDefs.has(formulaId)) return formulaId;

  let expr: BenchmarkFormulaExpr | null = null;

  // 尝试格式 3：预编译 AST
  if (params.expr && typeof params.expr === 'object' && (params.expr as JsonObject).type) {
    expr = params.expr as unknown as BenchmarkFormulaExpr;
  }

  // 尝试格式 2：vars_expr
  if (!expr && typeof params.formulaText === 'string' && params.formulaText) {
    const vars = (params.vars ?? {}) as Record<string, VarDefinition>;
    try {
      const varExprs = compileVarsToExprMap(vars, formulaCtx);
      expr = compileFormulaText(params.formulaText as string, undefined, varExprs);
    } catch (e) {
      console.warn(`Failed to compile FormulaProfile ${formulaId}:`, e);
    }
  }

  // 尝试格式 1：flat_params
  if (!expr) {
    expr = buildFormulaFromFlatParams(params as JsonObject, formulaCtx);
  }

  if (!expr) return null;

  const bypassValue = evaluateConstantExpr(expr);
  const def = buildFormulaDefinition(formulaId, label, expr, bypassValue);
  ctx.formulaDefs.set(formulaId, def);
  return formulaId;
}

/**
 * 编译全局管线公式（减伤 / 冷却缩减 / 护盾 / 移速等）。
 * 从 FormulaBinding(targetCategory=global, targetId=gameId, bindingKey=PIPELINE_KEY) 查找。
 */
function compilePipelineFormulas(ctx: CompileContext): void {
  const gameId = ctx.bundle.meta.gameId;
  const globalKey = `global:${gameId}`;
  const globalBindings = ctx.bindingsByTarget.get(globalKey);
  if (!globalBindings || globalBindings.length === 0) return;

  for (const binding of globalBindings) {
    const profile = ctx.formulaProfilesById.get(binding.formulaId);
    if (!profile) {
      console.warn(`Pipeline binding references unknown profile: ${binding.formulaId}`);
      continue;
    }

    const params = {
      ...(profile.params as Record<string, unknown> ?? {}),
      ...(binding.overrideParams as Record<string, unknown> ?? {}),
    };

    let expr: BenchmarkFormulaExpr | null = null;

    // 预编译 AST
    if (params.expr && typeof params.expr === 'object' && (params.expr as JsonObject).type) {
      expr = params.expr as unknown as BenchmarkFormulaExpr;
    }

    // formulaText 编译
    if (!expr && typeof params.formulaText === 'string' && params.formulaText) {
      try {
        const vars = (params.vars ?? {}) as Record<string, VarDefinition>;
        // 管线公式不依赖 skillLevel，使用默认上下文
        const varExprs = compileVarsToExprMap(vars, ctx.selfFormulaCtx);
        expr = compileFormulaText(params.formulaText as string, undefined, varExprs);
      } catch (e) {
        console.warn(`Failed to compile pipeline formula ${binding.formulaId}:`, e);
      }
    }

    if (!expr) continue;

    const bypassValue = evaluateConstantExpr(expr);
    const def = buildFormulaDefinition(
      binding.formulaId,
      profile.description ?? binding.bindingKey,
      expr,
      bypassValue
    );
    ctx.pipelineFormulaDefs.set(binding.bindingKey, def);
  }
}

// ═══════════════════════════════════════════════════════════════
// 辅助：公式注册
// ═══════════════════════════════════════════════════════════════

function registerFormula(
  ctx: CompileContext,
  idHint: string,
  label: string,
  formulaText: string,
  formulaVars: string[],
  varExprs: Map<string, BenchmarkFormulaExpr>
): string {
  // 标准化 formulaId
  const formulaId = `formula_${idHint.replace(/[^a-zA-Z0-9_]/g, '_')}`;

  if (ctx.formulaDefs.has(formulaId)) {
    return formulaId;
  }

  let expr: BenchmarkFormulaExpr;
  try {
    expr = compileFormulaText(formulaText, formulaVars, varExprs);
  } catch (e) {
    console.warn(`Failed to compile formula "${formulaId}": ${formulaText}`, e);
    expr = { type: 'constant', value: 0 };
  }

  // 计算 bypassValue（用常量值近似）
  const bypassValue = evaluateConstantExpr(expr);

  ctx.formulaDefs.set(formulaId, buildFormulaDefinition(formulaId, label, expr, bypassValue));
  return formulaId;
}

/**
 * 从实际 API 的扁平 params 格式构建公式 AST。
 *
 * 支持的 params 字段：
 * - attackRatio: number → Multiply(ActorAttr(source, ad), Constant(ratio))
 * - adRatio: number → Multiply(ActorAttr(source, ad), Constant(ratio))
 * - apRatio: number → Multiply(ActorAttr(source, ap), Constant(ratio))
 * - baseDamageBySkillLevel: number[] → Constant(values[level])
 * - baseDamage: number → Constant(value)
 */
function buildFormulaFromFlatParams(
  params: JsonObject | undefined,
  formulaCtx: FormulaCompileContext
): BenchmarkFormulaExpr | null {
  if (!params) return null;

  const terms: BenchmarkFormulaExpr[] = [];

  // 基础伤害
  const baseDmgByLevel = params.baseDamageBySkillLevel as number[] | undefined;
  if (baseDmgByLevel && Array.isArray(baseDmgByLevel) && baseDmgByLevel.length > 0) {
    const idx = clamp(formulaCtx.skillLevel, 1, baseDmgByLevel.length) - 1;
    terms.push({ type: 'constant', value: toNum(baseDmgByLevel[idx]) });
  } else if (params.baseDamage != null) {
    terms.push({ type: 'constant', value: toNum(params.baseDamage) });
  }

  // AD 系数
  const attackRatio = toNum(params.attackRatio);
  const adRatio = toNum(params.adRatio);
  const effectiveAdRatio = attackRatio || adRatio;
  if (effectiveAdRatio > 0) {
    const adExpr: BenchmarkFormulaExpr = { type: 'actor_attr', actor: 'source', attrKey: 'ad' };
    if (effectiveAdRatio === 1) {
      terms.push(adExpr);
    } else {
      terms.push({ type: 'multiply', factors: [adExpr, { type: 'constant', value: effectiveAdRatio }] });
    }
  }

  // AP 系数
  const apRatio = toNum(params.apRatio);
  if (apRatio > 0) {
    const apExpr: BenchmarkFormulaExpr = { type: 'actor_attr', actor: 'source', attrKey: 'ap' };
    terms.push({ type: 'multiply', factors: [apExpr, { type: 'constant', value: apRatio }] });
  }

  if (terms.length === 0) return null;
  if (terms.length === 1) return terms[0];
  return { type: 'add', terms };
}

/**
 * 尝试对纯常量表达式求值（用于 bypassValue）。
 * 遇到 actor_attr 等运行时节点返回 undefined。
 */
function evaluateConstantExpr(expr: BenchmarkFormulaExpr): number | undefined {
  switch (expr.type) {
    case 'constant':
      return expr.value;
    case 'add': {
      let sum = 0;
      for (const t of expr.terms) {
        const v = evaluateConstantExpr(t);
        if (v == null) return undefined;
        sum += v;
      }
      return sum;
    }
    case 'multiply': {
      let product = 1;
      for (const f of expr.factors) {
        const v = evaluateConstantExpr(f);
        if (v == null) return undefined;
        product *= v;
      }
      return product;
    }
    case 'subtract': {
      const l = evaluateConstantExpr(expr.left);
      const r = evaluateConstantExpr(expr.right);
      return l != null && r != null ? l - r : undefined;
    }
    case 'divide': {
      const n = evaluateConstantExpr(expr.numerator);
      const d = evaluateConstantExpr(expr.denominator);
      return n != null && d != null && d !== 0 ? n / d : undefined;
    }
    case 'max': {
      const vals = expr.operands.map(evaluateConstantExpr);
      return vals.every((v) => v != null) ? Math.max(...vals as number[]) : undefined;
    }
    case 'min': {
      const vals = expr.operands.map(evaluateConstantExpr);
      return vals.every((v) => v != null) ? Math.min(...vals as number[]) : undefined;
    }
    case 'negate': {
      const v = evaluateConstantExpr(expr.operand);
      return v != null ? -v : undefined;
    }
    default:
      return undefined;
  }
}

// ═══════════════════════════════════════════════════════════════
// 辅助：trigger 结构提取
// ═══════════════════════════════════════════════════════════════

type DamageInfo = {
  formulaText: string;
  formulaVars: string[];
  damageType: string;
};

function findPrimaryDamage(triggers: JsonValue[]): DamageInfo | null {
  // 按优先级查找伤害 trigger：on_spell_cast > on_basic_attack_hit > on_tick
  const eventPriority = ['on_spell_cast', 'on_basic_attack_hit', 'on_tick'];
  for (const targetEvent of eventPriority) {
    for (const trigger of triggers) {
      const t = trigger as JsonObject;
      const event = t.event as JsonObject;
      if (event?.type === targetEvent) {
        const actions = (t.actions as JsonValue[]) ?? [];
        for (const action of actions) {
          const a = action as JsonObject;
          if (a.type === 'deal_damage') {
            const dmg = a.damage as JsonObject;
            const ft = dmg?.formulaText;
            return {
              formulaText: ft != null ? String(ft) : '',
              formulaVars: (dmg?.formulaVars as string[]) ?? [],
              damageType: String(dmg?.damageType ?? 'physical'),
            };
          }
        }
      }
    }
  }
  return null;
}

type DotInfo = DamageInfo & { ticks: number; intervalMs: number };

function findDotInfo(triggers: JsonValue[]): DotInfo | null {
  // 找 schedule_tick action
  for (const trigger of triggers) {
    const t = trigger as JsonObject;
    const actions = (t.actions as JsonValue[]) ?? [];
    for (const action of actions) {
      const a = action as JsonObject;
      if (a.type === 'schedule_tick') {
        const tickKey = a.tickKey as string;
        const everyMs = toNum(a.everyMs, 1000);
        const times = toNum(a.times, 3);

        // 找对应的 on_tick → deal_damage
        for (const trigger2 of triggers) {
          const t2 = trigger2 as JsonObject;
          const event2 = t2.event as JsonObject;
          if (event2?.type === 'on_tick' && event2?.tickKey === tickKey) {
            const actions2 = (t2.actions as JsonValue[]) ?? [];
            for (const action2 of actions2) {
              const a2 = action2 as JsonObject;
              if (a2.type === 'deal_damage') {
                const dmg = a2.damage as JsonObject;
                return {
                  formulaText: String(dmg?.formulaText ?? '0'),
                  formulaVars: (dmg?.formulaVars as string[]) ?? [],
                  damageType: String(dmg?.damageType ?? 'magic'),
                  ticks: times,
                  intervalMs: everyMs,
                };
              }
            }
          }
        }
      }
    }
  }
  return null;
}

function findShieldInfo(
  triggers: JsonValue[],
  _varExprs: Map<string, BenchmarkFormulaExpr>
): { formulaText: string; formulaVars: string[] } | null {
  for (const trigger of triggers) {
    const t = trigger as JsonObject;
    const actions = (t.actions as JsonValue[]) ?? [];
    for (const action of actions) {
      const a = action as JsonObject;
      if (a.type === 'apply_modifier') {
        const mod = a.modifier as JsonObject;
        const stats = (mod?.stats as JsonValue[]) ?? [];
        for (const stat of stats) {
          const s = stat as JsonObject;
          if (String(s.key ?? '').includes('shield')) {
            return {
              formulaText: String(s.formulaText ?? '0'),
              formulaVars: (s.formulaVars as string[]) ?? [],
            };
          }
        }
      }
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// 辅助：TypeRelation / flags
// ═══════════════════════════════════════════════════════════════

function collectTypeIds(ctx: CompileContext, skillId: string): string[] {
  return ctx.typeRelations
    .filter((r) => r.targetCategory === 'skill' && r.targetId === skillId)
    .map((r) => `type_${r.typeId}`);
}

function inferFlags(
  ctx: CompileContext,
  skill: Skill,
  damageType: DamageTypeTag
): BenchmarkDamageFlags {
  const typeIds = collectTypeIds(ctx, skill.skillId);
  const hasOnHitType = typeIds.some((id) => id.includes('on_hit') || id.includes('trigger_on_hit'));

  const ext = (skill as any).mvpExtensions as JsonObject | undefined;
  const ai = ext?.attackInteraction as JsonObject | undefined;
  const canTriggerOnHit = hasOnHitType || ai?.canTriggerOnHit === true || ai?.consumeOnHit === true;
  const skillKey = skill.skillKey ?? '';
  const isBasicAttack = skillKey === 'A';

  return {
    canTriggerOnHit: !!canTriggerOnHit,
    canLifeSteal: isBasicAttack,
    canApplyBlackCleaver: damageType === 'physical',
    countsAsAttack: isBasicAttack || !!canTriggerOnHit,
    isActiveSkillMagicDamage: !isBasicAttack && damageType === 'magic',
  };
}

// ═══════════════════════════════════════════════════════════════
// 通用工具
// ═══════════════════════════════════════════════════════════════

function toNum(v: unknown, fallback = 0): number {
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
