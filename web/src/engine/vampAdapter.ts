import { GAME_VAMP_TYPES, type GameVampRule } from '../types/gameVamp';
import type { SkillEffectDamageDetail } from '../types/skillEffect';
import type { FormulaExpressionNode, SkillFormula } from '../types/skillFormula';
import type { SkillParameter } from '../types/skillParameter';
import type { NumericValue } from '../types/numericValue';
import type {
  CompileRequest, GenericFormulaExpr, GenericVampOverride, GenericVampRule,
  NamedFormula, OperationDefinition, TypeCatalog
} from '../types/genericEngine';

export class VampAdaptationError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'VampAdaptationError';
  }
}

const deliveryTypes = {
  SKILL: 'damage_trait/delivery_skill', BASIC_ATTACK: 'damage_trait/delivery_basic_attack'
} as const;
const originTypes = {
  DIRECT: 'damage_trait/origin_direct', REFLECTED: 'damage_trait/origin_reflected'
} as const;
const championType = 'combatant/champion';
const basisKinds = ['POST_DEFENSE_DAMAGE', 'ACTUAL_HP_LOSS'];
const fail = (path: string, message: string): never => { throw new VampAdaptationError(path, message); };
const finite = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail(path, '需要明确的有限数值，不能用零替代缺失值');
  return value;
};
const keys = (values: readonly string[], path: string): string[] => {
  if (!Array.isArray(values) || !values.length || new Set(values).size !== values.length
    || values.some(value => typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(value))) {
    return fail(path, '需要非空、无重复的合法分类标识');
  }
  return [...values];
};

export type AuthoredVampDamage = {
  gameId: string;
  skillKey: string;
  skillCategoryKeys: string[];
  skillLevel: number;
  characterLevel: number;
  detail: SkillEffectDamageDetail;
  parameters?: SkillParameter[];
  formulas?: SkillFormula[];
};

export type AdaptedVampDamage = {
  rules: GenericVampRule[];
  abilityTypes: string[];
  operation: Pick<OperationDefinition, 'types' | 'vampQualification' | 'vampOverrides'>;
  params: Record<string, number>;
  formulas: NamedFormula[];
  typeEntries: TypeCatalog['types'];
  requiredAttributes: string[];
};

/** 仅适配吸血规则、资格与效率；伤害金额、施放过程及事件由调用方提供。 */
export function adaptDamageVamp(rules: readonly GameVampRule[], damage: AuthoredVampDamage): AdaptedVampDamage {
  const root = `skills.${damage.skillKey}.damage`;
  keys([damage.gameId], 'gameId');
  keys([damage.skillKey], 'skillKey');
  if ('vampRules' in damage.detail) fail(`${root}.vampRules`, '旧逐伤害吸血规则必须先完成迁移');
  if (damage.detail.vampQualification !== 'RESOLVED') fail(`${root}.vampQualification`, '吸血资格尚未核定，不能运行');
  if (!rules.length) fail('game.vampRules', '尚未配置游戏吸血规则');
  const categories = keys(damage.skillCategoryKeys, `skills.${damage.skillKey}.skillCategoryKeys`);
  const delivery = deliveryTypes[damage.detail.deliveryKind];
  const origin = originTypes[damage.detail.originKind];
  if (!delivery) fail(`${root}.deliveryKind`, '缺少明确的伤害产生方式');
  if (!origin) fail(`${root}.originKind`, '缺少明确的伤害来源性质');
  const types = new Map<string, string>([
    [championType, 'combatant'],
    ...Object.values(deliveryTypes).map(key => [key, 'damage_trait'] as const),
    ...Object.values(originTypes).map(key => [key, 'damage_trait'] as const)
  ]);
  const categoryType = (key: string) => { const type = `ability/${key}`; types.set(type, 'ability'); return type; };
  const seen = new Set<string>();
  const genericRules = [...rules].sort((a, b) => GAME_VAMP_TYPES.indexOf(a.vampType) - GAME_VAMP_TYPES.indexOf(b.vampType)).map((rule, index): GenericVampRule => {
    const path = `game.vampRules[${index}]`;
    if (!GAME_VAMP_TYPES.includes(rule.vampType) || seen.has(rule.vampType)) fail(`${path}.vampType`, '吸血种类未知或重复');
    seen.add(rule.vampType);
    keys([rule.sourceAttributeKey], `${path}.sourceAttributeKey`);
    if (!basisKinds.includes(rule.basisOutputKind)) fail(`${path}.basisOutputKind`, '未知计算基数');
    if (finite(rule.defaultEfficiency, `${path}.defaultEfficiency`) < 0) fail(`${path}.defaultEfficiency`, '效率不能为负数');
    if (!rule.deliveryKinds.length || new Set(rule.deliveryKinds).size !== rule.deliveryKinds.length
      || rule.deliveryKinds.some(kind => !deliveryTypes[kind])) fail(`${path}.deliveryKinds`, '伤害产生方式必须非空、合法且无重复');
    if (!rule.originKinds.length || new Set(rule.originKinds).size !== rule.originKinds.length
      || rule.originKinds.some(kind => !originTypes[kind])) fail(`${path}.originKinds`, '伤害来源性质必须非空、合法且无重复');
    const all = [
      ...(rule.deliveryKinds.length === 1 ? [deliveryTypes[rule.deliveryKinds[0]!]] : []),
      ...(rule.originKinds.length === 1 ? [originTypes[rule.originKinds[0]!]] : [])
    ];
    return {
      vampType: rule.vampType, sourceAttributeKey: rule.sourceAttributeKey,
      basisOutputKind: rule.basisOutputKind, defaultEfficiency: rule.defaultEfficiency,
      targetMatcher: { all: [championType] },
      abilityMatcher: { any: keys(rule.skillCategoryKeys, `${path}.skillCategoryKeys`).map(categoryType) },
      damageMatcher: all.length ? { all } : { any: Object.values(deliveryTypes) }
    };
  });
  const params: Record<string, number> = {};
  const formulas = new Map<string, NamedFormula>();
  const requiredAttributes = new Set(genericRules.map(rule => rule.sourceAttributeKey));
  const parameter = (key: string, path: string): GenericFormulaExpr => {
    const matches = damage.parameters?.filter(value => value.parameterKey === key) ?? [];
    if (matches.length !== 1) fail(path, '技能参数缺失或重复');
    const row = matches[0]!;
    if (row.gameId !== damage.gameId || row.skillKey !== damage.skillKey) fail(path, '参数不属于当前游戏和技能');
    let value: number;
    if (row.valueMode === 'FIXED') value = finite(row.fixedValue, path);
    else if (row.valueMode === 'SKILL_LEVEL' || row.valueMode === 'CHARACTER_LEVEL') {
      const level = row.valueMode === 'SKILL_LEVEL' ? damage.skillLevel : damage.characterLevel;
      if (!Number.isInteger(level) || level < 1) fail(path, '本次等级必须明确且有效');
      value = finite(row.levelValues?.[String(level)], `${path}.levelValues.${level}`);
    } else return fail(path, '本期吸血适配不支持未供值的计算时输入');
    params[key] = value;
    return { op: 'read', path: `ability.param.${key}` };
  };
  const expression = (node: FormulaExpressionNode, path: string, depth = 0): GenericFormulaExpr => {
    if (depth > 32) return fail(path, '公式深度超过限制');
    if (node.nodeType === 'PARAMETER') return parameter(node.parameterKey, `${path}.parameterKey`);
    if (node.nodeType === 'OPERATION') {
      const operation = { ADD: 'add', SUBTRACT: 'sub', MULTIPLY: 'mul', DIVIDE: 'div', MIN: 'min', MAX: 'max' }[node.operation];
      if (!operation || node.operands.length !== 2) return fail(path, '不支持的公式运算');
      return { op: operation, args: node.operands.map((operand, index) => expression(operand, `${path}.operands[${index}]`, depth + 1)) };
    }
    if (node.nodeType !== 'ATTRIBUTE' || !['SOURCE', 'TARGET'].includes(node.attributeOwner)) return fail(path, '不支持的公式节点');
    keys([node.attributeKey], `${path}.attributeKey`);
    requiredAttributes.add(node.attributeKey);
    const owner = node.attributeOwner === 'SOURCE' ? 'source' : 'target';
    const read = (field: string): GenericFormulaExpr => ({ op: 'read', path: `${owner}.attr.${node.attributeKey}.${field}` });
    const missing: GenericFormulaExpr = { op: 'sub', args: [read('max'), read('current')] };
    switch (node.attributeValueKind) {
      case 'BASE': return read('base');
      case 'TOTAL': return read('resolved');
      case 'CURRENT': return read('current');
      case 'BONUS': return { op: 'sub', args: [read('resolved'), read('base')] };
      case 'MISSING': return missing;
      case 'CURRENT_RATIO': return { op: 'div', args: [read('current'), read('max')] };
      case 'MISSING_RATIO': return { op: 'div', args: [missing, read('max')] };
      default: return fail(path, '不支持的属性取值口径');
    }
  };
  const numeric = (value: NumericValue, path: string): GenericFormulaExpr => {
    if (value.kind === 'FIXED') {
      if (finite(value.value, path) < 0) fail(path, '效率不能为负数');
      return { op: 'const', value: value.value };
    }
    if (value.kind === 'PARAMETER') return parameter(value.parameterKey, path);
    if (value.kind !== 'FORMULA') return fail(path, '不支持的数值来源');
    const matches = damage.formulas?.filter(row => row.formulaKey === value.formulaKey) ?? [];
    if (matches.length !== 1) return fail(path, '技能公式缺失或重复');
    const row = matches[0]!;
    if (row.gameId !== damage.gameId || row.skillKey !== damage.skillKey) return fail(path, '公式不属于当前游戏和技能');
    const key = `vamp/${damage.skillKey}/${row.formulaKey}`;
    if (!formulas.has(key)) formulas.set(key, { key, expression: expression(row.expression, `${path}.expression`) });
    return { op: 'ref', ref: key };
  };
  const overrideKinds = new Set<string>();
  if (!Array.isArray(damage.detail.vampOverrides)) fail(`${root}.vampOverrides`, '吸血例外必须为明确的列表');
  const overrides = damage.detail.vampOverrides.map((override, index): GenericVampOverride => {
    const path = `${root}.vampOverrides[${index}]`;
    if (!seen.has(override.vampType) || overrideKinds.has(override.vampType)) fail(path, '例外的游戏规则缺失或种类重复');
    overrideKinds.add(override.vampType);
    if (override.mode === 'DISABLED') {
      if (override.basisOutputKind !== null || override.efficiencyValue !== null) fail(path, '禁止项不能携带基数和效率');
      return { vampType: override.vampType, mode: 'DISABLED' };
    }
    if (override.mode !== 'OVERRIDE' || !override.basisOutputKind || !basisKinds.includes(override.basisOutputKind)
      || !override.efficiencyValue) return fail(path, '覆盖项需要明确的基数和效率');
    return { vampType: override.vampType, mode: 'OVERRIDE', basisOutputKind: override.basisOutputKind,
      efficiency: numeric(override.efficiencyValue, `${path}.efficiencyValue`) };
  }).sort((a, b) => GAME_VAMP_TYPES.indexOf(a.vampType) - GAME_VAMP_TYPES.indexOf(b.vampType));
  const abilityTypes = categories.map(categoryType);
  return {
    rules: genericRules, abilityTypes,
    operation: { types: [delivery, origin], vampQualification: 'RESOLVED', vampOverrides: overrides },
    params, formulas: [...formulas.values()], typeEntries: [...types].map(([key, domain]) => ({ key, domain })),
    requiredAttributes: [...requiredAttributes]
  };
}

export type VampDamageBinding = {
  providerKey: string;
  abilityKey: string;
  operationIndex: number;
  damage: AuthoredVampDamage;
};

/** 给已有通用请求接入吸血；不生成缺失的角色属性、过程或命中事件。 */
export function withVampConfiguration(
  input: CompileRequest,
  rules: readonly GameVampRule[],
  bindings: readonly VampDamageBinding[],
  options: { combatantKinds: { source: 'CHAMPION'; target: 'CHAMPION' }; rulesHash: string }
): CompileRequest {
  if (!options.rulesHash.trim() || options.rulesHash === input.rulesHash) fail('rulesHash', '接入规则后必须提供新的配置摘要');
  if (input.combatants.length !== 2 || !input.combatants.some(row => row.key === 'source')
    || !input.combatants.some(row => row.key === 'target')
    || input.combatants.some(row => options.combatantKinds[row.key] !== 'CHAMPION')) fail('combatants', '首期仅接受身份已核验的两个英雄对象');
  if (!bindings.length) fail('bindings', '没有选择要适配的真实伤害配置');
  if (bindings.some(binding => binding.damage.gameId !== bindings[0]!.damage.gameId)) fail('bindings', '同一请求不能混用不同游戏的配置');
  const request = structuredClone(input);
  request.rulesHash = options.rulesHash;
  const seenBindings = new Set<string>();
  const abilityOwners = new Map<string, string>();
  const abilityCategories = new Map<string, string>();
  const addType = (key: string, domain: string) => {
    const old = request.typeCatalog.types.find(row => row.key === key);
    if (old && old.domain !== domain) fail('typeCatalog', `类型域冲突：${key}`);
    if (!old) request.typeCatalog.types.push({ key, domain });
  };
  for (const binding of bindings) {
    const bindingKey = `${binding.providerKey}/${binding.abilityKey}/${binding.operationIndex}`;
    if (seenBindings.has(bindingKey)) fail('bindings', '同一伤害重复绑定');
    seenBindings.add(bindingKey);
    const abilityKey = `${binding.providerKey}/${binding.abilityKey}`;
    const owner = abilityOwners.get(abilityKey);
    if (owner && owner !== binding.damage.skillKey) fail('bindings', '附伤不能继承另一技能的分类');
    abilityOwners.set(abilityKey, binding.damage.skillKey);
    const categories = JSON.stringify([...binding.damage.skillCategoryKeys].sort());
    if (abilityCategories.has(abilityKey) && abilityCategories.get(abilityKey) !== categories) fail('bindings', '同一技能的分类在请求内不一致');
    abilityCategories.set(abilityKey, categories);
    const provider = request.sharedProviders?.find(row => row.providerKey === binding.providerKey);
    const ability = provider?.abilities?.find(row => row.abilityKey === binding.abilityKey);
    const operation = ability?.operations?.[binding.operationIndex];
    if (!ability || !operation || operation.operation !== 'damage') fail('bindings', '绑定必须指向已有伤害操作');
    const adapted = adaptDamageVamp(rules, binding.damage);
    request.rules.vampRules = adapted.rules;
    for (const entry of adapted.typeEntries) addType(entry.key, entry.domain);
    ability!.types = [...new Set([...(ability!.types ?? []).filter(key => !key.startsWith('ability/')), ...adapted.abilityTypes])];
    ability!.params ??= {};
    for (const [key, value] of Object.entries(adapted.params)) {
      if (key in ability!.params && ability!.params[key] !== value) fail(`ability.params.${key}`, '参数与现有运行输入冲突');
      ability!.params[key] = value;
    }
    const classifiedTypes = new Set<string>([...Object.values(deliveryTypes), ...Object.values(originTypes)]);
    Object.assign(operation!, adapted.operation, {
      types: [...new Set([...(operation!.types ?? []).filter(key => !classifiedTypes.has(key)), ...adapted.operation.types!])]
    });
    request.formulas ??= [];
    for (const formula of adapted.formulas) {
      const old = request.formulas.find(row => row.key === formula.key);
      if (old && JSON.stringify(old.expression) !== JSON.stringify(formula.expression)) fail('formulas', '具名公式与现有输入冲突');
      if (!old) request.formulas.push(formula);
    }
    for (const actor of request.combatants) {
      actor.types = [...new Set([...(actor.types ?? []), championType])];
      for (const key of adapted.requiredAttributes) {
        const slot = actor.attributes[key];
        if (!slot) fail(`combatants.${actor.key}.attributes.${key}`, '缺少明确的运行属性，不能自动补零');
        for (const field of ['base', 'current', 'max', 'resolved'] as const) finite(slot[field], `combatants.${actor.key}.attributes.${key}.${field}`);
      }
    }
  }
  if (request.typeCatalog.types.length > 256) fail('typeCatalog', '类型数量超过256');
  return request;
}
