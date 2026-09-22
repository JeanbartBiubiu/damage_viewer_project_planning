import { describe, expect, it } from 'vitest';
import { adaptDamageVamp, withVampConfiguration, type AuthoredVampDamage } from './vampAdapter';
import type { CompileRequest } from '../types/genericEngine';
import type { GameVampRule } from '../types/gameVamp';
import type { SkillParameter } from '../types/skillParameter';

const rules: GameVampRule[] = [
  { vampType: 'OMNIVAMP', sourceAttributeKey: 'omnivamp_percent', basisOutputKind: 'POST_DEFENSE_DAMAGE',
    defaultEfficiency: 1, deliveryKinds: ['SKILL', 'BASIC_ATTACK'], originKinds: ['DIRECT'], skillCategoryKeys: ['common', 'basic_attack'] },
  { vampType: 'LIFE_STEAL', sourceAttributeKey: 'life_steal_percent', basisOutputKind: 'POST_DEFENSE_DAMAGE',
    defaultEfficiency: 1, deliveryKinds: ['BASIC_ATTACK'], originKinds: ['DIRECT'], skillCategoryKeys: ['basic_attack'] }
];
const damage = (): AuthoredVampDamage => ({
  gameId: 'lol', skillKey: 'ahri_q', skillCategoryKeys: ['common'], skillLevel: 1, characterLevel: 1,
  detail: { damageTypeKey: 'magic', deliveryKind: 'SKILL', originKind: 'DIRECT',
    critical: { mode: 'DISALLOWED', multiplierValue: null }, vampQualification: 'RESOLVED', vampOverrides: [] }
});
const parameter = (patch: Partial<SkillParameter> = {}): SkillParameter => ({
  gameId: 'lol', skillKey: 'ahri_q', parameterKey: 'efficiency', name: '效率', valueType: 'DECIMAL',
  valueMode: 'FIXED', fixedValue: 0, levelValues: null, description: null, sortOrder: 0,
  createdAt: '', updatedAt: '', ...patch
});
function parameterDamage(patch: Partial<SkillParameter> = {}): AuthoredVampDamage {
  const row = damage();
  row.parameters = [parameter(patch)];
  row.detail.vampOverrides = [{ vampType: 'OMNIVAMP', mode: 'OVERRIDE', basisOutputKind: 'ACTUAL_HP_LOSS',
    efficiencyValue: { kind: 'PARAMETER', parameterKey: 'efficiency' } }];
  return row;
}
function request(): CompileRequest {
  const slot = { base: 0, current: 0, max: 0, resolved: 0 };
  return {
    schemaVersion: 'generic-p0', schemaHash: 'schema.vamp.test', rulesHash: 'before',
    typeCatalog: { types: [{ key: 'ability/basic_attack', domain: 'ability' }], relations: [] }, rules: {},
    combatants: (['source', 'target'] as const).map(key => ({ key, resources: {}, providers: [],
      attributes: { life_steal_percent: { ...slot }, omnivamp_percent: { ...slot } } })),
    sharedProviders: [{ providerKey: 'champion', stableId: 'champion', kind: 'champion', abilities: [
      { abilityKey: 'q', kind: 'active', types: ['ability/basic_attack'], operations: [
        { operation: 'damage', target: 'target', damageType: 'magic', amount: { op: 'const', value: 100 } },
        { operation: 'damage', target: 'target', damageType: 'magic', amount: { op: 'const', value: 100 } }
      ] }
    ] }]
  };
}
const options = { combatantKinds: { source: 'CHAMPION', target: 'CHAMPION' }, rulesHash: 'after' } as const;
const bind = (row = damage(), operationIndex = 0) => ({ providerKey: 'champion', abilityKey: 'q', operationIndex, damage: row });

describe('吸血管理配置适配', () => {
  it('多个普通技能共享游戏规则，不产生逐技能吸血副本', () => {
    const first = adaptDamageVamp(rules, damage());
    const second = adaptDamageVamp(rules, { ...damage(), skillKey: 'annie_q' });
    expect(first.rules).toEqual(second.rules);
    expect(first.operation.vampOverrides).toEqual([]);
    expect(first.rules.map(rule => rule.vampType)).toEqual(['LIFE_STEAL', 'OMNIVAMP']);
    expect(first.rules[0]).toMatchObject({
      targetMatcher: { all: ['combatant/champion'] }, abilityMatcher: { any: ['ability/basic_attack'] },
      damageMatcher: { all: ['damage_trait/delivery_basic_attack', 'damage_trait/origin_direct'] }
    });
    expect(first.operation.types).toEqual(['damage_trait/delivery_skill', 'damage_trait/origin_direct']);
    expect(first.abilityTypes).toEqual(['ability/common']);
  });

  it('两个伤害维度全允许时仍保留正向类型约束', () => {
    const result = adaptDamageVamp([{ ...rules[0]!, originKinds: ['DIRECT', 'REFLECTED'] }], damage());
    expect(result.rules[0]!.damageMatcher).toEqual({ any: ['damage_trait/delivery_skill', 'damage_trait/delivery_basic_attack'] });
  });

  it('固定效率与参数效率的明确零均保留', () => {
    const row = parameterDamage();
    const result = adaptDamageVamp(rules, row);
    expect(result.params).toEqual({ efficiency: 0 });
    expect(result.operation.vampOverrides?.[0]).toMatchObject({ efficiency: { op: 'read', path: 'ability.param.efficiency' } });
    row.detail.vampOverrides[0]!.efficiencyValue = { kind: 'FIXED', value: 0 };
    expect(adaptDamageVamp(rules, row).operation.vampOverrides?.[0]).toMatchObject({ efficiency: { op: 'const', value: 0 } });
  });

  it.each(['SKILL_LEVEL', 'CHARACTER_LEVEL'] as const)('读取明确的%s等级值，缺失等级报路径', valueMode => {
    const row = parameterDamage({ valueMode, fixedValue: null, levelValues: { '1': 0, '2': 0.5 } });
    expect(adaptDamageVamp(rules, row).params.efficiency).toBe(0);
    if (valueMode === 'SKILL_LEVEL') row.skillLevel = 3;
    else row.characterLevel = 3;
    expect(() => adaptDamageVamp(rules, row)).toThrow('levelValues.3');
  });

  it.each([
    [{ gameId: 'other' }, '不属于'],
    [{ skillKey: 'other' }, '不属于'],
    [{ valueMode: 'RUNTIME_INPUT', fixedValue: null }, '计算时输入'],
    [{ fixedValue: null }, '有限数值']
  ] as const)('拒绝无确定来源的参数 %j', (patch, message) => {
    expect(() => adaptDamageVamp(rules, parameterDamage(patch))).toThrow(message);
  });

  it('保留动态属性公式，按技能限定引用且不预先代入属性', () => {
    const row = damage();
    row.detail.vampOverrides = [{ vampType: 'OMNIVAMP', mode: 'OVERRIDE', basisOutputKind: 'ACTUAL_HP_LOSS',
      efficiencyValue: { kind: 'FORMULA', formulaKey: 'health_ratio' } }];
    row.formulas = [{ gameId: 'lol', skillKey: 'ahri_q', formulaKey: 'health_ratio', name: '生命比例', description: null,
      sortOrder: 0, createdAt: '', updatedAt: '', expression: {
        nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'health', attributeValueKind: 'MISSING_RATIO'
      } }];
    const result = adaptDamageVamp(rules, row);
    expect(result.formulas).toEqual([{ key: 'vamp/ahri_q/health_ratio', expression: {
      op: 'div', args: [{ op: 'sub', args: [{ op: 'read', path: 'source.attr.health.max' }, { op: 'read', path: 'source.attr.health.current' }] },
        { op: 'read', path: 'source.attr.health.max' }]
    } }]);
    expect(result.requiredAttributes).toContain('health');
  });

  it('未核定、旧字段和没有游戏规则均拒绝运行', () => {
    const row = damage();
    row.detail.vampQualification = 'UNRESOLVED';
    expect(() => adaptDamageVamp(rules, row)).toThrow('vampQualification');
    row.detail.vampQualification = 'RESOLVED';
    expect(() => adaptDamageVamp([], row)).toThrow('game.vampRules');
    Object.assign(row.detail, { vampRules: [] });
    expect(() => adaptDamageVamp(rules, row)).toThrow('旧逐伤害');
  });

  it('缺分类、重复规则、缺比例属性或非法效率不能默默匹配', () => {
    expect(() => adaptDamageVamp(rules, { ...damage(), skillCategoryKeys: [] })).toThrow('skillCategoryKeys');
    expect(() => adaptDamageVamp([rules[0]!, rules[0]!], damage())).toThrow('重复');
    expect(() => adaptDamageVamp([{ ...rules[0]!, sourceAttributeKey: '' }], damage())).toThrow('sourceAttributeKey');
    expect(() => adaptDamageVamp([{ ...rules[0]!, defaultEfficiency: Number.NaN }], damage())).toThrow('defaultEfficiency');
  });

  it('禁止项不能夹带参数且必须有对应游戏规则', () => {
    const row = damage();
    row.detail.vampOverrides = [{ vampType: 'OMNIVAMP', mode: 'DISABLED', basisOutputKind: null, efficiencyValue: null }];
    expect(adaptDamageVamp(rules, row).operation.vampOverrides).toEqual([{ vampType: 'OMNIVAMP', mode: 'DISABLED' }]);
    row.detail.vampOverrides[0]!.efficiencyValue = { kind: 'FIXED', value: 1 };
    expect(() => adaptDamageVamp(rules, row)).toThrow('禁止项');
    row.detail.vampOverrides[0]!.efficiencyValue = null;
    expect(() => adaptDamageVamp([rules[1]!], row)).toThrow('游戏规则缺失');
  });
});

describe('吸血配置接入通用编译请求', () => {
  it('保留原伤害金额和输入，清除旧分类，零属性保持为零', () => {
    const input = request();
    const before = structuredClone(input);
    const output = withVampConfiguration(input, rules, [bind()], options);
    expect(input).toEqual(before);
    expect(output.sharedProviders![0]!.abilities![0]!.types).toEqual(['ability/common']);
    expect(output.sharedProviders![0]!.abilities![0]!.operations![0]).toMatchObject({
      amount: { op: 'const', value: 100 }, vampQualification: 'RESOLVED', vampOverrides: []
    });
    expect(output.combatants[0]!.attributes.omnivamp_percent!.resolved).toBe(0);
    expect(output.rulesHash).toBe('after');
  });

  it('缺失运行属性必须拒绝，不能补零', () => {
    const input = request();
    delete input.combatants[0]!.attributes.omnivamp_percent;
    expect(() => withVampConfiguration(input, rules, [bind()], options)).toThrow('combatants.source.attributes.omnivamp_percent');
  });

  it('附伤跨技能、跨游戏、同技能分类冲突与重复绑定均拒绝', () => {
    expect(() => withVampConfiguration(request(), rules, [bind(), bind({ ...damage(), skillKey: 'diana_p' }, 1)], options)).toThrow('另一技能');
    expect(() => withVampConfiguration(request(), rules, [bind(), bind({ ...damage(), gameId: 'other' }, 1)], options)).toThrow('不同游戏');
    expect(() => withVampConfiguration(request(), rules, [bind(), bind({ ...damage(), skillCategoryKeys: ['passive'] }, 1)], options)).toThrow('分类在请求内不一致');
    expect(() => withVampConfiguration(request(), rules, [bind(), bind()], options)).toThrow('重复绑定');
  });

  it('类型域与参数冲突不覆盖原值，规则摘要必须更新', () => {
    const input = request();
    input.typeCatalog.types.push({ key: 'combatant/champion', domain: 'ability' });
    expect(() => withVampConfiguration(input, rules, [bind()], options)).toThrow('类型域冲突');
    const other = request();
    other.sharedProviders![0]!.abilities![0]!.params = { efficiency: 1 };
    expect(() => withVampConfiguration(other, rules, [bind(parameterDamage())], options)).toThrow('参数与现有运行输入冲突');
    expect(() => withVampConfiguration(request(), rules, [bind()], { ...options, rulesHash: 'before' })).toThrow('新的配置摘要');
  });
});
