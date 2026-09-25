import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GenericFormulaExpr } from '../types/genericEngine';
import { fixedValue, formulaValue, parameterValue } from '../types/numericValue';
import type { SkillEffectDamageModifierResult } from '../types/skillEffect';
import {
  adaptDamageModifierProgram, withDamageModifierPrograms,
  type AuthoredDamageModifierProgram, type DamageModifierScenario
} from './damageModifierAdapter';

function program(comparator: 'LT' | 'GT' = 'LT'): AuthoredDamageModifierProgram {
  const result: SkillEffectDamageModifierResult = {
    resultKey: 'amplify', name: '条件增伤', resultType: 'DAMAGE_MODIFIER', target: 'SOURCE',
    description: null, sortOrder: 10, spellShieldBlockScope: null,
    valueRule: { value: parameterValue('bonus'), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
    lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'MOMENT_EVALUATION', stackValueMode: 'SHARED',
      reapplicationValueMode: null, periodicExecutionMode: null },
    detail: { modifierZoneKey: 'rune_amp', direction: 'DEALT', operation: 'INCREASE', damageTypeKey: null,
      deliveryKind: 'ANY', originKind: 'DIRECT', criticalFilter: 'ANY',
      condition: { receiver: 'ENEMY_CHAMPION', attributeKey: 'hp', attributeValueKind: 'CURRENT_RATIO', comparator,
        comparisonValue: parameterValue('threshold') } }
  };
  return {
    gameId: 'lol', skillKey: 'rune_passive', skillLevel: 1, characterLevel: 1, owner: 'source',
    identity: { owner: { category: 'CHAMPION', hostility: 'SELF' }, opponent: { category: 'CHAMPION', hostility: 'ENEMY' } },
    parameters: [['bonus', 0.08], ['threshold', comparator === 'LT' ? 0.4 : 0.6]].map(([key, value]) => ({
      gameId: 'lol', skillKey: 'rune_passive', parameterKey: String(key), name: String(key), description: null,
      valueType: 'DECIMAL', valueMode: 'FIXED', fixedValue: Number(value), levelValues: null,
      sortOrder: 10, createdAt: '', updatedAt: ''
    })),
    formulas: [],
    modifierZones: [{ gameId: 'lol', modifierZoneKey: 'rune_amp', name: '独立增伤', domain: 'DAMAGE',
      calculationMode: 'RATIO_ADD', applicationStage: 'DAMAGE_PRE_DEFENSE', status: 'ENABLED', sortOrder: 10,
      description: null, createdAt: '', updatedAt: '' }],
    effects: [{ gameId: 'lol', skillKey: 'rune_passive', effectKey: 'passive', name: '常驻条件增伤', description: null,
      sortOrder: 10, createdAt: '', updatedAt: '', results: [result],
      lifecycle: { instanceScope: 'SOURCE', durationValue: null, maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1),
        reapplicationStackMode: 'KEEP', reapplicationDurationMode: null, expiryMode: 'EXPLICIT_ONLY',
        periodicIntervalValue: null, firstPeriodicExecution: null } }],
    rules: [{ ruleKey: 'initialize', name: '初始化', description: null, sortOrder: 10,
      eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} }, conditionGroups: [],
      perTargetCooldown: null, maxTriggersPerProcess: null, oncePerUse: null,
      actions: [{ actionKey: 'apply', name: '施加', actionType: 'EXECUTE_EFFECT', sortOrder: 10, targetContext: 'CURRENT_TARGET',
        detail: { effectKey: 'passive' }, runtimeInputBindings: [], resultModifiers: [] }] }]
  };
}
function result(a: AuthoredDamageModifierProgram) { return a.effects[0]!.results[0]! as SkillEffectDamageModifierResult; }
function scenario(): DamageModifierScenario {
  const fixture = JSON.parse(readFileSync(new URL('../../../wasm/tinygo_engine_v2/internal/testkit/fixtures/generic_p0_basic_damage.json', import.meta.url), 'utf8')) as DamageModifierScenario;
  const { compileRequest, runRequest } = fixture;
  runRequest.schemaVersion = compileRequest.schemaVersion;
  runRequest.schemaHash = compileRequest.schemaHash;
  runRequest.rulesHash = compileRequest.rulesHash;
  compileRequest.typeCatalog.types.push({ key: 'combatant/champion', domain: 'combatant' });
  for (const actor of compileRequest.combatants) {
    actor.types = ['combatant/champion'];
    actor.attributes.hp = { base: 1000, current: 399, max: 1000, resolved: 1000 };
  }
  for (const actor of runRequest.initialSnapshot.combatants) actor.attributes.hp = { base: 1000, current: 399, max: 1000, resolved: 1000 };
  return { compileRequest, runRequest };
}
// 只验宿主公式映射；真实原生执行另由工作线程检查，不能用此解释器替代。
function evaluate(expr: GenericFormulaExpr, reads: Record<string, number>): number {
  if (expr.op === 'const') return expr.value!;
  if (expr.op === 'read') {
    if (!(expr.path! in reads)) throw new Error(`missing ${expr.path}`);
    return reads[expr.path!]!;
  }
  if (expr.op === 'if') return evaluate(expr.args![evaluate(expr.args![0]!, reads) !== 0 ? 1 : 2]!, reads);
  const [a, b] = expr.args!.map(x => evaluate(x, reads)) as [number, number];
  switch (expr.op) {
    case 'min': return Math.min(a, b); case 'max': return Math.max(a, b);
    case 'add': return a + b; case 'mul': return a * b; case 'div': return a / b;
    case 'eq': return Number(a === b); case 'lt': return Number(a < b); case 'gt': return Number(a > b);
    default: throw new Error(expr.op);
  }
}
function multiplier(a: AuthoredDamageModifierProgram, hp: number, reads: Record<string, number> = {}) {
  return adaptDamageModifierProgram(a, 'rune:test').provider.modifiers!.reduce((value, m) => value * evaluate(m.value!, {
    'target.attr.hp.current': hp, 'target.attr.hp.max': 1000, 'damage.self': 0,
    'damage.trait.origin_direct': 1, ...reads
  }), 1);
}

describe('damageModifierAdapter', () => {
  it.each([
    ['LT', 399, 108], ['LT', 400, 100], ['LT', 401, 100],
    ['GT', 601, 108], ['GT', 600, 100], ['GT', 599, 100]
  ] as const)('%s 门槛在 %s 生命的原始100伤害映射为 %s', (comparator, hp, expected) => {
    expect(100 * multiplier(program(comparator), hp)).toBeCloseTo(expected, 10);
  });
  it('每次映射读取当前目标，参数内联且不污染作者对象', () => {
    const a = program(), before = structuredClone(a);
    const provider = adaptDamageModifierProgram(a, 'rune:test').provider;
    expect(JSON.stringify(provider)).not.toContain('ability.param');
    expect(multiplier(a, 450)).toBe(1);
    expect(multiplier(a, 350)).toBe(1.08);
    expect(a).toEqual(before);
  });
  it('敌方资格和自伤分别约束，不能从对象键猜敌我', () => {
    const a = program();
    expect(multiplier(a, 399, { 'damage.self': 1 })).toBe(1);
    a.identity.opponent.hostility = 'ALLY';
    expect(multiplier(a, 399)).toBe(1);
    a.identity.opponent = { category: 'MINION', hostility: 'ENEMY' };
    expect(multiplier(a, 399)).toBe(1);
    delete a.identity.opponent.hostility;
    expect(() => adaptDamageModifierProgram(a, 'rune:test')).toThrow(/identity.opponent/);
  });
  it('伤害类型、产生方式及来源过滤同时保留', () => {
    const a = program();
    result(a).detail.damageTypeKey = 'magic'; result(a).detail.deliveryKind = 'SKILL';
    const reads = { 'damage.type.magic': 1, 'damage.trait.delivery_skill': 1 };
    expect(multiplier(a, 399, reads)).toBe(1.08);
    for (const field of ['damage.type.magic', 'damage.trait.delivery_skill', 'damage.trait.origin_direct']) {
      expect(multiplier(a, 399, { ...reads, [field]: 0 })).toBe(1);
    }
  });
  it('省略与空条件保持无生命门槛，不冒充敌方限定', () => {
    const a = program(); result(a).detail.condition = null;
    expect(multiplier(a, 1000, { 'damage.self': 1 })).toBe(1.08);
    delete result(a).detail.condition;
    expect(multiplier(a, 1000)).toBe(1.08);
    expect(adaptDamageModifierProgram(a, 'rune:test').ratioAttributes).toEqual([]);
  });
  it('同乘区加算，不同乘区相乘', () => {
    const a = program();
    const other = structuredClone(result(a)); other.resultKey = 'other'; other.valueRule.value = fixedValue(0.1);
    a.effects[0]!.results.push(other);
    expect(multiplier(a, 399)).toBeCloseTo(1.18);
    other.detail.modifierZoneKey = 'independent';
    a.modifierZones = [...a.modifierZones, { ...a.modifierZones[0]!, modifierZoneKey: 'independent', sortOrder: 20 }];
    expect(multiplier(a, 399)).toBeCloseTo(1.188);
  });
  it('当前等级静态公式作为门槛，运行输入和属性依赖不能偷偷补值', () => {
    const a = program();
    a.formulas = [{ gameId: 'lol', skillKey: a.skillKey, formulaKey: 'threshold_formula', name: '门槛', description: null,
      expression: { nodeType: 'PARAMETER', parameterKey: 'threshold' }, sortOrder: 10, createdAt: '', updatedAt: '' }];
    result(a).detail.condition!.comparisonValue = formulaValue('threshold_formula');
    expect(multiplier(a, 399)).toBe(1.08);
    a.parameters![1]!.valueMode = 'RUNTIME_INPUT'; a.parameters![1]!.fixedValue = null;
    expect(() => adaptDamageModifierProgram(a, 'rune:test')).toThrow(/运行输入/);
    a.formulas[0]!.expression = { nodeType: 'ATTRIBUTE', attributeOwner: 'TARGET', attributeKey: 'hp', attributeValueKind: 'CURRENT_RATIO' };
    expect(() => adaptDamageModifierProgram(a, 'rune:test')).toThrow(/属性/);
  });
  it('不支持的条件、结果与生命周期明确拒绝，不删去后运行', () => {
    const reject = (change: (a: AuthoredDamageModifierProgram) => void, message: RegExp) => {
      const a = program(); change(a); expect(() => adaptDamageModifierProgram(a, 'rune:test')).toThrow(message);
    };
    reject(a => { result(a).detail.criticalFilter = 'CRITICAL_ONLY'; }, /criticalFilter/);
    reject(a => { result(a).detail.direction = 'TAKEN'; }, /造成伤害/);
    reject(a => { result(a).detail.condition!.comparisonValue = fixedValue(1.1); }, /0至1/);
    reject(a => { result(a).lifecycleBehavior!.valueReadMode = 'APPLICATION_SNAPSHOT'; }, /重施策略/);
    reject(a => { a.effects[0]!.lifecycle!.durationValue = fixedValue(1000); }, /无期限/);
    reject(a => { a.rules[0]!.actions[0]!.runtimeInputBindings = [{ bindingKey: 'extra', parameterKey: 'bonus', sourceType: 'SOURCE_CAST_RESOURCE_COST', detail: { attributeKey: 'mana' } }]; }, /初始化动作/);
    reject(a => { result(a).valueRule.fixedMinValue = 1; result(a).valueRule.fixedMaxValue = 0; }, /下限/);
  });
  it.each(['source', 'target'] as const)('为%s拥有者同时装配编译挂载和新快照，无损保留原场景', async owner => {
    const a = program(); a.owner = owner;
    const input = scenario(), before = structuredClone(input);
    const adapted = await withDamageModifierPrograms(input, [{ providerKey: 'rune:test', authored: a }]);
    const actor = adapted.compileRequest.combatants.find(c => c.key === owner)!;
    expect(actor.providers.at(-1)).toEqual({ providerRef: 'rune:test', definitionRef: 'rune:test' });
    expect(adapted.runRequest.initialSnapshot.combatants.find(c => c.key === owner)!.providers.at(-1)).toMatchObject({
      providerRef: 'rune:test', owner, source: owner, stacks: 1, expireAt: null
    });
    expect(adapted.runRequest.expectedRulesHash).toMatch(/^rules.damage_modifier.[a-f0-9]{64}$/);
    expect(adapted.runRequest.initialSnapshot.rulesHash).toBe(adapted.compileRequest.rulesHash);
    expect(input).toEqual(before);
  });
  it('缺少生命或不正的最大值必须拒绝', async () => {
    const input = scenario(), a = program();
    delete input.runRequest.initialSnapshot.combatants[1]!.attributes.hp;
    const assemble = () => withDamageModifierPrograms(input, [{ providerKey: 'rune:test', authored: a }]);
    await expect(assemble()).rejects.toThrow(/snapshot.target.attributes.hp/);
    input.runRequest.initialSnapshot.combatants[1]!.attributes.hp = { base: 0, current: 0, max: 0, resolved: 0 };
    await expect(assemble()).rejects.toThrow(/max/);
  });
  it('恢复、重复和别名挂载、旧摘要不一致不能重新初始化', async () => {
    const a = program();
    const assemble = (input: DamageModifierScenario) => withDamageModifierPrograms(input, [{ providerKey: 'rune:test', authored: a }]);
    let input = scenario(); input.runRequest.initialSnapshot.timeMs = 1; await expect(assemble(input)).rejects.toThrow(/恢复/);
    input = scenario(); input.runRequest.rulesHash = 'other'; await expect(assemble(input)).rejects.toThrow(/摘要不一致/);
    input = scenario(); input.compileRequest.combatants[0]!.providers.push({ providerRef: 'alias', definitionRef: 'rune:test' });
    await expect(assemble(input)).rejects.toThrow(/别名/);
    input = scenario();
    await expect(withDamageModifierPrograms(input, [{ providerKey: 'a', authored: a }, { providerKey: 'b', authored: a }])).rejects.toThrow(/同区加算/);
  });
  it('不同身份、拥有者和金额生成不同摘要，同一配置确定重现', async () => {
    const a = program();
    const assemble = () => withDamageModifierPrograms(scenario(), [{ providerKey: 'rune:test', authored: a }]);
    const first = (await assemble()).compileRequest.rulesHash;
    expect((await assemble()).compileRequest.rulesHash).toBe(first);
    a.identity.opponent.hostility = 'ALLY';
    const ally = (await assemble()).compileRequest.rulesHash;
    expect(ally).not.toBe(first);
    a.owner = 'target';
    expect((await assemble()).compileRequest.rulesHash).not.toBe(ally);
    a.owner = 'source'; a.identity.opponent.hostility = 'ENEMY'; a.parameters![0]!.fixedValue = 0.1;
    expect((await assemble()).compileRequest.rulesHash).not.toBe(first);
  });
  it('门槛只要求承受者生命；不向拥有者索取无关属性', async () => {
    const input = scenario();
    delete input.compileRequest.combatants[0]!.attributes.hp;
    delete input.runRequest.initialSnapshot.combatants[0]!.attributes.hp;
    await expect(withDamageModifierPrograms(input, [{ providerKey: 'rune:test', authored: program() }])).resolves.toBeDefined();
  });
  it('同区未命中结果短路动态金额，自伤资格短路生命读取', () => {
    const a = program();
    const other = structuredClone(result(a)); other.resultKey = 'other'; other.detail.condition!.comparator = 'GT';
    other.valueRule.value = formulaValue('dynamic');
    other.valueRule.fixedMinValue = 0;
    a.formulas = [{ gameId: 'lol', skillKey: a.skillKey, formulaKey: 'dynamic', name: '动态金额', description: null,
      expression: { nodeType: 'ATTRIBUTE', attributeOwner: 'TARGET', attributeKey: 'power', attributeValueKind: 'CURRENT' },
      sortOrder: 10, createdAt: '', updatedAt: '' }];
    a.effects[0]!.results.push(other);
    expect(multiplier(a, 399)).toBe(1.08);
    expect(() => multiplier(a, 600)).toThrow(/target.attr.power.current/);
    const modifier = adaptDamageModifierProgram(a, 'rune:test').provider.modifiers![0]!;
    expect(evaluate(modifier.condition!, { 'damage.self': 1, 'damage.trait.origin_direct': 1 })).toBe(0);
    other.valueRule.fixedMinValue = null;
    expect(() => adaptDamageModifierProgram(a, 'rune:test')).toThrow(/非负下界/);
  });
  it('已有无法核对乘区的防御前修正不能混入', async () => {
    const input = scenario();
    input.compileRequest.rules.modifiers = adaptDamageModifierProgram(program(), 'other').provider.modifiers;
    await expect(withDamageModifierPrograms(input, [{ providerKey: 'rune:test', authored: program() }])).rejects.toThrow(/无法核对管理乘区/);
  });
  it('静态十进制公式门槛不因浮点加法把等值错判为严格低于', () => {
    const a = program();
    a.parameters = [...a.parameters!, { ...a.parameters![0]!, parameterKey: 'a', fixedValue: 0.1 },
      { ...a.parameters![0]!, parameterKey: 'b', fixedValue: 0.2 }];
    a.formulas = [{ gameId: 'lol', skillKey: a.skillKey, formulaKey: 'sum', name: '门槛', description: null,
      sortOrder: 10, createdAt: '', updatedAt: '', expression: { nodeType: 'OPERATION', operation: 'ADD', operands: [
        { nodeType: 'PARAMETER', parameterKey: 'a' }, { nodeType: 'PARAMETER', parameterKey: 'b' }] } }];
    result(a).detail.condition!.comparisonValue = formulaValue('sum');
    expect(multiplier(a, 300)).toBe(1);
    expect(multiplier(a, 299)).toBe(1.08);
    a.parameters![2]!.fixedValue = 1; a.parameters![3]!.fixedValue = 1e-17;
    a.formulas[0]!.expression = { nodeType: 'OPERATION', operation: 'SUBTRACT', operands: [
      { nodeType: 'PARAMETER', parameterKey: 'a' }, { nodeType: 'PARAMETER', parameterKey: 'b' }] };
    expect(() => adaptDamageModifierProgram(a, 'rune:test')).toThrow(/精度/);
  });
});
