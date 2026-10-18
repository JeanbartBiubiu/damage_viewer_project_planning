import { describe, expect, it } from 'vitest';
import { FORMULA_SCHEMA, type Expression, type FormulaDefinition } from '../types/formulaContract.generated';
import type { NumericValue } from '../types/numericValue';
import type { SkillEffectValueRule } from '../types/skillEffect';
import type { SkillParameter } from '../types/skillParameter';
import { NumericAdaptationError } from './numericAdapter';
import { BASIC_ATTACK_CONTRIBUTION_FORMULA_LIMITS, lowerBasicAttackContributionValue,
  lowerBasicAttackContributionValueRule, type BasicAttackContributionFormulaAuthor,
  type BasicAttackContributionFormulaPurpose } from './basicAttackContributionFormula';

const c = (value: string): Expression => ({ op: 'const', value });
const read = (inputKey: string): Expression => ({ op: 'read', inputKey });
const ref = (stageKey: string): Expression => ({ op: 'ref', stageKey });
const add = (a: Expression, b: Expression): Expression => ({ op: 'add', args: [a, b] });
const mul = (a: Expression, b: Expression): Expression => ({ op: 'mul', args: [a, b] });
const pathOf = (author: BasicAttackContributionFormulaAuthor) => `skills.${author.skillKey}.effects.bonus.results.damage.valueRule.value`;

function parameter(skillKey: string, key: string, value: number): SkillParameter {
  return { gameId: 'lol', skillKey, parameterKey: key, name: key, description: null, sortOrder: 0, createdAt: '', updatedAt: '',
    valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: value, levelValues: null };
}
function author(suffix = 'alpha', factor = .2): BasicAttackContributionFormulaAuthor {
  const skillKey = `natural_${suffix}`;
  return { gameId: 'lol', skillKey, skillLevel: 2, characterLevel: 7,
    parameters: [parameter(skillKey, 'factor', factor), { ...parameter(skillKey, 'skill_bonus', 0), valueMode: 'SKILL_LEVEL', fixedValue: null, levelValues: { '1': 2, '2': 3 } },
      { ...parameter(skillKey, 'level_bonus', 0), valueMode: 'CHARACTER_LEVEL', fixedValue: null, levelValues: { '1': 4, '7': 5 } }],
    formulas: [{ gameId: 'lol', skillKey, formulaKey: 'bonus', name: '真实作者公式', description: null, sortOrder: 0, createdAt: '', updatedAt: '',
      expression: { inputs: [
        { key: 'factor', binding: { kind: 'parameter', skillKey, parameterKey: 'factor' } },
        { key: 'ad', binding: { kind: 'attribute', object: 'source', attributeKey: 'attack_damage', valueKind: 'TOTAL', view: 'current_frame' } },
        { key: 'skill', binding: { kind: 'parameter', skillKey, parameterKey: 'skill_bonus' } },
        { key: 'level', binding: { kind: 'parameter', skillKey, parameterKey: 'level_bonus' } }
      ], stages: [
        { key: 'base', name: '当前属性乘静态比例', expression: mul(read('ad'), read('factor')) },
        { key: 'output', name: '保留作者括号与阶段', expression: add(ref('base'), mul(read('skill'), read('level'))) }
      ], outputStageKey: 'output' } }],
    attributes: [{ attributeKey: 'attack_damage', status: 'ENABLED' }, { attributeKey: 'hp', status: 'ENABLED' }] };
}
function lower(a = author(), purpose: BasicAttackContributionFormulaPurpose = 'amount') {
  return lowerBasicAttackContributionValue({ kind: 'FORMULA', formulaKey: 'bonus' }, a, pathOf(a), purpose);
}
function replaceDefinition(a: BasicAttackContributionFormulaAuthor, expression: Expression, inputs: FormulaDefinition['inputs'] = []) {
  a.formulas[0]!.expression = { inputs, stages: [{ key: 'output', name: '测试作者表达式', expression }], outputStageKey: 'output' };
  return a;
}

describe('自然普攻组成的窄公式结构替换', () => {
  it.each([['alpha', .2], ['beta', .7]] as const)('%s保留自己的作者、等级和同名参数，不借父能力参数', (suffix, factor) => {
    const a = author(suffix, factor), before = structuredClone(a), result = lower(a);
    expect(result.expression).toEqual({ op: 'add', args: [
      { op: 'mul', args: [{ op: 'read', path: 'source.attr.attack_damage.resolved' }, { op: 'const', value: factor }] },
      { op: 'mul', args: [{ op: 'const', value: 3 }, { op: 'const', value: 5 }] }
    ] });
    expect(result.usage).toEqual({ nodes: 7, depth: 3 });
    expect(result.requiredAttributes).toEqual({ source: ['attack_damage'], target: [] });
    expect(result.source.author).toEqual(before);
    expect(result.source.formula).toEqual(a.formulas[0]);
    expect(result.source.selectedParameters.map(row => [row.definition.skillKey, row.definition.parameterKey, row.value]))
      .toEqual([[a.skillKey, 'factor', factor], [a.skillKey, 'skill_bonus', 3], [a.skillKey, 'level_bonus', 5]]);
    expect(result.mappings).toContainEqual({ privatePath: 'expression.args[0]',
      authorPath: `skills.${a.skillKey}.formulas.bonus.expression.stages[1].expression.args[0]`, kind: 'stageReference' });
    expect(result.mappings).toContainEqual({ privatePath: 'expression.args[0].args[0]',
      authorPath: `skills.${a.skillKey}.formulas.bonus.expression.inputs[1].binding`, kind: 'binding' });
    expect(JSON.stringify(result.expression)).not.toContain('ability.param');
    expect(JSON.stringify(result.expression)).not.toContain('"ref"');
    expect(a).toEqual(before);
  });

  it('来源与私有树均独立，不因之后改DTO或改另一返回对象而串值', () => {
    const a = author(), first = lower(a), second = lower(a);
    a.parameters[0]!.fixedValue = 99;
    a.formulas[0]!.expression.stages[0]!.expression = c('999');
    first.source.author.parameters[0]!.fixedValue = 77;
    first.expression.args![0]!.args![1]!.value = 88;
    expect(second.source.author.parameters[0]!.fixedValue).toBe(.2);
    expect(second.source.formula!.expression.stages[0]!.expression).toEqual(mul(read('ad'), read('factor')));
    expect(second.expression.args![0]!.args![1]!.value).toBe(.2);
  });

  it.each(['amount', 'criticalMultiplier', 'vampEfficiency'] as const)('%s消费者共用同一严谨结构转换', purpose => {
    const result = lower(author(), purpose);
    expect(result.source.purpose).toBe(purpose);
    expect(result.expression.op).toBe('add');
  });

  it('全常量的加乘不在JS求值，不重排括号或忽略负零', () => {
    const a = replaceDefinition(author(), mul(add(c('10000000000000000'), c('-10000000000000000')), add(c('1'), c('-0'))));
    expect(lower(a).expression).toEqual({ op: 'mul', args: [
      { op: 'add', args: [{ op: 'const', value: 1e16 }, { op: 'const', value: -1e16 }] },
      { op: 'add', args: [{ op: 'const', value: 1 }, { op: 'const', value: -0 }] }
    ] });
    expect(Object.is(lower(a).expression.args![1]!.args![1]!.value, -0)).toBe(true);
  });

  it('倍率、下限、上限只按原数值规则顺序包装，不折叠全常量', () => {
    const a = author(), path = `skills.${a.skillKey}.effects.bonus.results.damage.valueRule`;
    const rule: SkillEffectValueRule = { value: { kind: 'FIXED', value: 2 }, fixedMultiplier: 3, fixedMinValue: 4, fixedMaxValue: 5 };
    const result = lowerBasicAttackContributionValueRule(rule, a, path, 'vampEfficiency');
    expect(result.expression).toEqual({ op: 'min', args: [{ op: 'max', args: [
      { op: 'mul', args: [{ op: 'const', value: 2 }, { op: 'const', value: 3 }] }, { op: 'const', value: 4 }
    ] }, { op: 'const', value: 5 }] });
    expect(result.source.valueRule).toEqual(rule);
    expect(result.usage).toEqual({ nodes: 7, depth: 4 });
    expect(result.mappings).toContainEqual({ privatePath: 'expression', authorPath: `${path}.fixedMaxValue`, kind: 'valueRule' });
  });

  it('复用目标当前帧TOTAL属性原语，不采样成常量', () => {
    const valueKind = 'TOTAL';
    const a = replaceDefinition(author(), read('live'), [{ key: 'live', binding: { kind: 'attribute', object: 'target', attributeKey: 'hp', valueKind, view: 'current_frame' } }]);
    const result = lower(a);
    expect(result.requiredAttributes).toEqual({ source: [], target: ['hp'] });
    expect(JSON.stringify(result.expression)).toContain('target.attr.hp.');
    expect(result.source.formula!.expression.inputs[0]!.binding).toMatchObject({ object: 'target', valueKind, view: 'current_frame' });
  });

  it.each(['BASE', 'BONUS', 'CURRENT', 'MAX', 'MISSING', 'CURRENT_RATIO', 'MISSING_RATIO'] as const)('明确拒绝尚未授权的%s属性取值', valueKind => {
    const a = replaceDefinition(author(), read('live'), [{ key: 'live', binding: { kind: 'attribute', object: 'target', attributeKey: 'hp', valueKind, view: 'current_frame' } }]);
    expect(() => lower(a)).toThrow(/仅授权当前帧总值TOTAL/);
  });

  it.each([0, -5, 9007199254740991])('静态安全整数%s保持原值', value => {
    const a = author(); a.parameters[0]!.fixedValue = value; a.parameters[0]!.valueType = 'INTEGER';
    expect(lowerBasicAttackContributionValue({ kind: 'PARAMETER', parameterKey: 'factor' }, a, pathOf(a), 'amount').expression).toEqual({ op: 'const', value });
  });

  it.each([
    ['公式未知字段', (a: BasicAttackContributionFormulaAuthor) => { Object.assign(a.formulas[0]!, { value: 1 }); }],
    ['定义未知字段', (a: BasicAttackContributionFormulaAuthor) => { Object.assign(a.formulas[0]!.expression, { context: {} }); }],
    ['输入未知字段', (a: BasicAttackContributionFormulaAuthor) => { Object.assign(a.formulas[0]!.expression.inputs[0]!, { fallback: 0 }); }],
    ['节点未知字段', (a: BasicAttackContributionFormulaAuthor) => { Object.assign(a.formulas[0]!.expression.stages[0]!.expression, { error: 0 }); }],
    ['参数未知字段', (a: BasicAttackContributionFormulaAuthor) => { Object.assign(a.parameters[0]!, { runtimeSource: { kind: 'scene_parameter', value: 1 } }); }],
    ['上下文未知字段', (a: BasicAttackContributionFormulaAuthor) => { Object.assign(a, { runtimeInputReads: { factor: { op: 'const', value: 1 } } }); }],
    ['错误作者公式', (a: BasicAttackContributionFormulaAuthor) => { a.formulas[0]!.skillKey = 'other'; }],
    ['错误作者参数', (a: BasicAttackContributionFormulaAuthor) => { a.parameters[0]!.skillKey = 'other'; }],
    ['重复公式', (a: BasicAttackContributionFormulaAuthor) => { (a.formulas as unknown[]).push(structuredClone(a.formulas[0])); }],
    ['重复参数', (a: BasicAttackContributionFormulaAuthor) => { (a.parameters as unknown[]).push(structuredClone(a.parameters[0])); }],
    ['缺参数', (a: BasicAttackContributionFormulaAuthor) => { (a.parameters as SkillParameter[]).splice(0, 1); }],
    ['未声明属性', (a: BasicAttackContributionFormulaAuthor) => { (a.attributes as unknown[]).splice(0, 1); }],
    ['禁用属性', (a: BasicAttackContributionFormulaAuthor) => { a.attributes[0]!.status = 'DISABLED'; }],
    ['未供值运行输入', (a: BasicAttackContributionFormulaAuthor) => { a.parameters[0]!.valueMode = 'RUNTIME_INPUT'; a.parameters[0]!.fixedValue = null; }],
    ['模式残留另一组值', (a: BasicAttackContributionFormulaAuthor) => { a.parameters[0]!.levelValues = { '1': 1 }; }],
    ['缺选中等级', (a: BasicAttackContributionFormulaAuthor) => { a.parameters[1]!.levelValues = { '1': 1 }; }],
    ['不安全整数', (a: BasicAttackContributionFormulaAuthor) => { a.parameters[0]!.valueType = 'INTEGER'; a.parameters[0]!.fixedValue = 9007199254740992; }],
    ['小数冒充整数', (a: BasicAttackContributionFormulaAuthor) => { a.parameters[1]!.valueType = 'INTEGER'; a.parameters[1]!.levelValues!['2'] = 2.5; }],
    ['非有限参数', (a: BasicAttackContributionFormulaAuthor) => { a.parameters[0]!.fixedValue = Infinity; }],
    ['非有限等级', (a: BasicAttackContributionFormulaAuthor) => { a.parameters[2]!.levelValues!['7'] = NaN; }],
    ['未学等级', (a: BasicAttackContributionFormulaAuthor) => { a.skillLevel = 0; }]
  ] as const)('拒绝%s', (_name, mutate) => {
    const a = author(); mutate(a);
    expect(() => lower(a)).toThrow(NumericAdaptationError);
  });

  it.each([
    { kind: 'attribute', object: 'source', attributeKey: 'attack_damage', valueKind: 'TOTAL', view: 'event_snapshot' },
    { kind: 'attribute', object: 'event_source', attributeKey: 'hp', valueKind: 'CURRENT', view: 'current_frame' },
    { kind: 'attribute', object: 'owner', attributeKey: 'hp', valueKind: 'CURRENT', view: 'current_frame' },
    { kind: 'context', contextKey: 'effect_elapsed_ms' },
    { kind: 'context', contextKey: 'use_charge_duration_ms' },
    { kind: 'parameter', skillKey: 'foreign', parameterKey: 'factor' },
    { kind: 'attribute', object: 'source', attributeKey: 'provider.state.factor', valueKind: 'TOTAL', view: 'current_frame' }
  ])('拒绝未授权读取 $kind/$object/$view', binding => {
    const a = replaceDefinition(author(), read('bad'), [{ key: 'bad', binding } as FormulaDefinition['inputs'][number]]);
    expect(() => lower(a)).toThrow(NumericAdaptationError);
  });

  it.each(['if', 'sub', 'div', 'min', 'max', 'floor', 'round'])('拒绝共同定义中子集外的%s，不只检查输出已走分支', op => {
    const expression = op === 'if' ? { op, args: [c('1'), c('2'), c('3')] } : op === 'floor' ? { op, args: [c('1')] }
      : op === 'round' ? { op, args: [c('1')], decimals: 0 } : { op, args: [c('1'), c('2')] };
    const a = author(); a.formulas[0]!.expression.stages.push({ key: 'unused', name: '不能忽略的未支持节点', expression: expression as Expression });
    expect(() => lower(a)).toThrow(/仅授权/);
  });

  it.each(['1e3', '1\n', '0.' + '0'.repeat(400) + '1', '9'.repeat(400)])('拒绝无效十进制或非有限/下溢常量', value => {
    expect(() => lower(replaceDefinition(author(), c(value)))).toThrow(NumericAdaptationError);
  });

  it('保留共同校验的未知引用与循环错误，不递归溢出', () => {
    expect(() => lower(replaceDefinition(author(), ref('absent')))).toThrow(/FORMULA_UNKNOWN_STAGE/);
    const a = author(); a.formulas[0]!.expression = { inputs: [], stages: [
      { key: 'a', name: 'a', expression: ref('b') }, { key: 'b', name: 'b', expression: ref('a') }
    ], outputStageKey: 'a' };
    expect(() => lower(a)).toThrow(/FORMULA_CYCLE/);
  });

  it('共享阶段倍增在真正复制前按展开后节点预算停止，不放大256节点契约', () => {
    const a = author(), stages: FormulaDefinition['stages'] = [{ key: 's0', name: 's0', expression: c('1') }];
    for (let index = 1; index <= 8; index++) stages.push({ key: `s${index}`, name: `s${index}`, expression: add(ref(`s${index - 1}`), ref(`s${index - 1}`)) });
    a.formulas[0]!.expression = { inputs: [], stages, outputStageKey: 's8' };
    expect(BASIC_ATTACK_CONTRIBUTION_FORMULA_LIMITS).toEqual({ maxNodes: 256, maxDepth: 32 });
    expect(() => lower(a)).toThrow(/FORMULA_LIMIT/);
    a.formulas[0]!.expression.outputStageKey = 's7';
    expect(lower(a).usage).toEqual({ nodes: 255, depth: 8 });
    expect(() => lowerBasicAttackContributionValueRule({ value: { kind: 'FORMULA', formulaKey: 'bonus' },
      fixedMultiplier: 2, fixedMinValue: null, fixedMaxValue: null }, a, pathOf(a), 'amount')).toThrow(/FORMULA_LIMIT/);
    expect(FORMULA_SCHEMA['x-limits'].maxInstructions).toBe(512);
  });

  it('TOTAL属性和数值包装均占用展开后深度和节点预算', () => {
    const a = author(); let expression: Expression = read('current');
    for (let index = 1; index < 32; index++) expression = add(c('0'), expression);
    replaceDefinition(a, expression, [{ key: 'current', binding: { kind: 'attribute', object: 'source', attributeKey: 'hp', valueKind: 'TOTAL', view: 'current_frame' } }]);
    expect(lower(a).usage.depth).toBe(32);
    const rule: SkillEffectValueRule = { value: { kind: 'FORMULA', formulaKey: 'bonus' }, fixedMultiplier: 2, fixedMinValue: null, fixedMaxValue: null };
    expect(() => lowerBasicAttackContributionValueRule(rule, a, pathOf(a), 'amount')).toThrow(/FORMULA_LIMIT/);
  });

  it.each([
    { kind: 'FIXED', value: 1, defaultValue: 1 }, { kind: 'FIXED', value: null }, { kind: 'FIXED', value: '1' },
    { kind: 'FIXED', value: Infinity }, { kind: 'FORMULA', formulaKey: 'absent' }
  ])('拒绝错误直接数值引用', value => {
    const a = author(); expect(() => lowerBasicAttackContributionValue(value as NumericValue, a, pathOf(a), 'vampEfficiency')).toThrow(NumericAdaptationError);
  });

  it('数值规则拒绝未知修正、缺边界、非有限值和上下界倒置', () => {
    const a = author(), base: SkillEffectValueRule = { value: { kind: 'FIXED', value: 1 }, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null };
    for (const rule of [{ ...base, unknown: 1 }, { ...base, fixedMinValue: undefined }, { ...base, fixedMultiplier: NaN }, { ...base, fixedMinValue: 2, fixedMaxValue: 1 }]) {
      expect(() => lowerBasicAttackContributionValueRule(rule as SkillEffectValueRule, a, pathOf(a), 'amount')).toThrow(NumericAdaptationError);
    }
  });

  it('拒绝不完整目录与空目录项，保持明确的适配错误', () => {
    for (const key of ['parameters', 'formulas', 'attributes'] as const) {
      const missing = { ...author(), [key]: null } as unknown as BasicAttackContributionFormulaAuthor;
      expect(() => lower(missing)).toThrow(NumericAdaptationError);
      const empty = { ...author(), [key]: [null] } as unknown as BasicAttackContributionFormulaAuthor;
      expect(() => lower(empty)).toThrow(NumericAdaptationError);
    }
  });

  it.each([undefined, null, true])('作者身份缺失或非字符串%s不能被正则隐式转换接纳', value => {
    for (const key of ['gameId', 'skillKey'] as const) {
      const a = { ...author(), [key]: value } as unknown as BasicAttackContributionFormulaAuthor;
      expect(() => lowerBasicAttackContributionValue({ kind: 'FIXED', value: 1 }, a, pathOf(a), 'amount')).toThrow(/作者身份不合法/);
    }
  });
});
