import { describe, expect, it } from 'vitest';
import { adaptPersistentResult, compilePersistentResult, withPersistentResults, type AuthoredPersistentResult } from './persistentResultAdapter';
import type { CompileRequest } from '../types/genericEngine';
import { fixedValue, formulaValue, parameterValue } from '../types/numericValue';
import type { SkillEffectLifecycle, SkillEffectResult } from '../types/skillEffect';
import type { SkillParameter } from '../types/skillParameter';
import type { SkillFormula } from '../types/skillFormula';

const lifecycle = (patch: Partial<SkillEffectLifecycle> = {}): SkillEffectLifecycle => ({
  durationValue: fixedValue(1000), maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1),
  instanceScope: 'SOURCE_TARGET', reapplicationStackMode: 'KEEP', reapplicationDurationMode: 'REFRESH_ALL',
  expiryMode: 'ALL_AT_ONCE', periodicIntervalValue: null, firstPeriodicExecution: null, ...patch
});

const slowResult = (patch: Partial<SkillEffectResult> = {}): SkillEffectResult => ({
  resultKey: 'slow', name: '普通减速', resultType: 'STATUS_OPERATION', target: 'TARGET',
  description: null, sortOrder: 0, spellShieldBlockScope: null,
  valueRule: { value: fixedValue(0.3), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: 1 },
  detail: { statusKey: 'slow_q', operation: 'APPLY' },
  lifecycleBehavior: {
    moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED',
    reapplicationValueMode: 'REPLACE', periodicExecutionMode: null
  }, ...patch
});

const woundResult = (patch: Partial<SkillEffectResult> = {}): SkillEffectResult => ({
  resultKey: 'wound', name: '受到治疗降低', resultType: 'HEALING_MODIFIER', target: 'TARGET',
  description: null, sortOrder: 0, spellShieldBlockScope: null,
  valueRule: { value: fixedValue(0.4), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
  detail: { modifierZoneKey: 'grievous', direction: 'RECEIVED', operation: 'DECREASE', healingKind: 'ANY' },
  lifecycleBehavior: {
    moment: 'PERSISTENT', valueReadMode: 'APPLICATION_SNAPSHOT', stackValueMode: 'SHARED',
    reapplicationValueMode: 'KEEP', periodicExecutionMode: null
  }, ...patch
});

function authored(kind: 'slow' | 'wound' = 'slow', patch: Partial<AuthoredPersistentResult> = {}): AuthoredPersistentResult {
  return {
    gameId: 'lol', skillKey: kind === 'slow' ? 'urgot_q' : 'morellonomicon', skillLevel: 1, characterLevel: 1,
    effectKey: kind === 'slow' ? 'slow_effect' : 'grievous_effect', lifecycle: lifecycle(),
    result: kind === 'slow' ? slowResult() : woundResult(),
    statuses: [{ statusKey: 'slow_q', statusKind: 'MOVEMENT_SLOW', status: 'ENABLED' }],
    modifierZones: [{ modifierZoneKey: 'grievous', domain: 'HEALING', calculationMode: 'RATIO_MAX', status: 'ENABLED' }],
    source: 'source', target: 'target', ...patch
  };
}

function request(): CompileRequest {
  const slot = { base: 100, current: 100, max: 100, resolved: 100 };
  return {
    schemaVersion: 'generic-p0', schemaHash: 'schema.p7', rulesHash: 'before',
    typeCatalog: { types: [], relations: [] }, rules: {},
    combatants: (['source', 'target'] as const).map((key) => ({
      key, resources: {}, providers: [{ providerRef: 'champion', definitionRef: 'champion' }],
      attributes: { hp: { ...slot } }
    })),
    sharedProviders: [{
      providerKey: 'champion', stableId: 'champion', kind: 'champion',
      abilities: [{ abilityKey: 'apply', kind: 'active', operations: [] }]
    }]
  };
}

const hash = { rulesHash: 'after' } as const;
const bind = (row = authored(), providerKey = 'status:slow') => ({
  providerKey, applyProviderKey: 'champion', applyAbilityKey: 'apply', authored: row
});

describe('有界持续结果适配', () => {
  it('映射普通减速应用快照/shared/replace，强度按倍率与上下界编译且不提前算动态属性', () => {
    const formula: SkillFormula = {
      gameId: 'lol', skillKey: 'urgot_q', formulaKey: 'slow_formula', name: '减速', description: null,
      sortOrder: 0, createdAt: '', updatedAt: '',
      expression: { nodeType: 'ATTRIBUTE', attributeOwner: 'TARGET', attributeKey: 'move_speed', attributeValueKind: 'CURRENT' }
    };
    const row = authored('slow', {
      formulas: [formula],
      result: slowResult({
        valueRule: { value: formulaValue('slow_formula'), fixedMultiplier: 0.01, fixedMinValue: 0, fixedMaxValue: 1 }
      })
    });
    const adapted = adaptPersistentResult(row, 'status:slow');
    expect(adapted.provider.lifecycle).toMatchObject({ maxStacks: 1, refreshPolicy: 'replace', instanceScope: 'source_target' });
    expect(adapted.provider.statusContributions?.[0]).toMatchObject({
      resultRef: 'slow', statusKey: 'slow_q', statusKind: 'movement_slow'
    });
    expect(adapted.provider.statusContributions?.[0]?.strength).toEqual({
      op: 'min',
      args: [
        { op: 'max', args: [{ op: 'mul', args: [{ op: 'ref', ref: 'status/urgot_q/slow_formula' }, { op: 'const', value: 0.01 }] }, { op: 'const', value: 0 }] },
        { op: 'const', value: 1 }
      ]
    });
    expect(adapted.formulas[0]?.expression).toEqual({ op: 'read', path: 'target.attr.move_speed.current' });
    expect(adapted.requiredAttributes).toEqual(['move_speed']);
    expect(adapted.operation).toEqual({ operation: 'apply_provider', target: 'target', providerDefinitionRef: 'status:slow' });
  });

  it('明确零合法，缺参数、重复参数、缺等级和计算时输入报路径', () => {
    const parameter = (patch: Partial<SkillParameter> = {}): SkillParameter => ({
      gameId: 'lol', skillKey: 'urgot_q', parameterKey: 'strength', name: '强度', valueType: 'DECIMAL',
      valueMode: 'FIXED', fixedValue: 0, levelValues: null, description: null, sortOrder: 0,
      createdAt: '', updatedAt: '', ...patch
    });
    const row = authored('slow', {
      parameters: [parameter()],
      result: slowResult({ valueRule: { value: parameterValue('strength'), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: 1 } })
    });
    expect(adaptPersistentResult(row, 'status:slow').params).toEqual({ strength: 0 });
    expect(() => adaptPersistentResult({ ...row, parameters: [] }, 'status:slow')).toThrow('缺失或重复');
    expect(() => adaptPersistentResult({ ...row, parameters: [parameter(), parameter()] }, 'status:slow')).toThrow('缺失或重复');
    expect(() => adaptPersistentResult({
      ...row, parameters: [parameter({ valueMode: 'SKILL_LEVEL', fixedValue: null, levelValues: { '1': 0.3 } })], skillLevel: 2
    }, 'status:slow')).toThrow('levelValues.2');
    expect(() => adaptPersistentResult({
      ...row, parameters: [parameter({ valueMode: 'RUNTIME_INPUT', fixedValue: null })]
    }, 'status:slow')).toThrow('未知动态');
  });

  it('来源目标不串，周期和非法层数明确失败', () => {
    expect(() => adaptPersistentResult(authored('slow', { result: slowResult({ target: 'SOURCE' }) }), 'status:slow'))
      .toThrow('TARGET');
    expect(() => adaptPersistentResult(authored('slow', { source: 'target' }), 'status:slow')).toThrow('不能串用目标');
    expect(() => adaptPersistentResult(authored('slow', { lifecycle: lifecycle({ periodicIntervalValue: fixedValue(500) }) }), 'status:slow'))
      .toThrow('周期');
    expect(() => adaptPersistentResult(authored('slow', { lifecycle: lifecycle({ maxStacksValue: fixedValue(2) }) }), 'status:slow'))
      .toThrow('层数');
  });

  it('法术护盾粒度非空且未提供命中判定时拒绝，不静默忽略', () => {
    expect(() => adaptPersistentResult(authored('slow', { result: slowResult({ spellShieldBlockScope: 'RESULT' }) }), 'status:slow'))
      .toThrow('命中判定');
  });

  it('命中入口共用编译函数保留原粒度，不提供跳过判定的开关', () => {
    const row = authored('slow', { result: slowResult({ spellShieldBlockScope: 'RESULT' }) });
    const compiled = compilePersistentResult(row, 'status:slow');
    expect(row.result.spellShieldBlockScope).toBe('RESULT');
    expect(compiled.operation).toEqual({ operation: 'apply_provider', target: 'target', providerDefinitionRef: 'status:slow' });
    expect(compiled.provider.statusContributions?.[0]?.statusKind).toBe('movement_slow');
  });

  it('治疗 RATIO_MAX 把管理减少比例映射为 add_percent 负值，种类按目录映射', () => {
    const adapted = adaptPersistentResult(authored('wound'), 'status:wound');
    expect(adapted.provider.modifiers?.[0]).toMatchObject({
      command: 'heal', healDirection: 'RECEIVED', healCategory: 'ANY', healGroupKey: 'grievous',
      healGroupCalculationMode: 'ratio_max', valuePolicy: 'add_percent', value: { op: 'const', value: -0.4 }
    });
    expect(adapted.params).toEqual({});
    const vamp = authored('wound', {
      result: woundResult({ detail: { modifierZoneKey: 'grievous', direction: 'RECEIVED', operation: 'DECREASE', healingKind: 'VAMP' } })
    });
    expect(adaptPersistentResult(vamp, 'status:wound').provider.modifiers?.[0]?.healCategory).toBe('VAMP');
  });

  it('治疗减少按倍率上下界折成常量，属性快照公式和负号非法值失败', () => {
    const level: SkillParameter = {
      gameId: 'lol', skillKey: 'morellonomicon', parameterKey: 'ratio', name: '比例', valueType: 'DECIMAL',
      valueMode: 'SKILL_LEVEL', fixedValue: null, levelValues: { '1': 40, '2': 40 }, description: null,
      sortOrder: 0, createdAt: '', updatedAt: ''
    };
    const folded = authored('wound', {
      parameters: [level],
      result: woundResult({
        valueRule: { value: parameterValue('ratio'), fixedMultiplier: 0.01, fixedMinValue: null, fixedMaxValue: null }
      })
    });
    expect(adaptPersistentResult(folded, 'status:wound').provider.modifiers?.[0]?.value).toEqual({ op: 'const', value: -0.4 });
    expect(adaptPersistentResult(folded, 'status:wound').params).toEqual({});
    const formula: SkillFormula = {
      gameId: 'lol', skillKey: 'morellonomicon', formulaKey: 'hp', name: '生命', description: null,
      sortOrder: 0, createdAt: '', updatedAt: '',
      expression: { nodeType: 'ATTRIBUTE', attributeOwner: 'TARGET', attributeKey: 'hp', attributeValueKind: 'CURRENT' }
    };
    expect(() => adaptPersistentResult(authored('wound', {
      formulas: [formula],
      result: woundResult({ valueRule: { value: formulaValue('hp'), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null } })
    }), 'status:wound')).toThrow('实时读取');
    expect(() => adaptPersistentResult(authored('wound', {
      result: woundResult({ valueRule: { value: fixedValue(-0.2), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null } })
    }), 'status:wound')).toThrow('0到1');
    expect(() => adaptPersistentResult(authored('wound', {
      modifierZones: [{ modifierZoneKey: 'healing_ratio', domain: 'HEALING', calculationMode: 'RATIO_ADD', status: 'ENABLED' }],
      result: woundResult({ detail: { modifierZoneKey: 'healing_ratio', direction: 'RECEIVED', operation: 'DECREASE', healingKind: 'ANY' } })
    }), 'status:wound')).toThrow('不能按名称推断');
  });

  it('保留调用者请求并检查 provider/参数/公式冲突，必须提供新的 rulesHash', () => {
    const input = request();
    const before = structuredClone(input);
    const output = withPersistentResults(input, [bind()], hash);
    expect(input).toEqual(before);
    expect(output.rulesHash).toBe('after');
    expect(output.sharedProviders?.[0]?.abilities?.[0]?.operations).toEqual([
      { operation: 'apply_provider', target: 'target', providerDefinitionRef: 'status:slow' }
    ]);
    expect(output.sharedProviders?.[0]?.abilities?.[0]?.operations?.[0]).not.toBe(input.sharedProviders?.[0]?.abilities?.[0]?.operations?.[0]);
    expect(() => withPersistentResults(request(), [bind()], { rulesHash: 'before' })).toThrow('新的配置摘要');
    const conflict = request();
    conflict.sharedProviders!.push({ providerKey: 'status:slow', kind: 'other', stableId: 'other' });
    expect(() => withPersistentResults(conflict, [bind()], hash)).toThrow('冲突');
    expect(() => withPersistentResults(request(), [
      bind(authored('wound', { gameId: 'other' }), 'status:wound'), bind()
    ], hash)).toThrow('不同游戏');
  });

  it('同组治疗计算方式冲突同时指出路径，不覆盖无关配置', () => {
    const input = request();
    input.rules.modifiers = [{
      modifierKey: 'old', kind: 'pipeline', command: 'heal', healDirection: 'DONE', healCategory: 'ANY',
      healGroupKey: 'grievous', healGroupCalculationMode: 'ratio_add', valuePolicy: 'add_percent',
      value: { op: 'const', value: 0.1 }
    }];
    expect(() => withPersistentResults(input, [bind(authored('wound'), 'status:wound')], hash))
      .toThrow('healGroupKey calculationMode conflict');
    const ok = request();
    ok.sharedProviders![0]!.abilities![0]!.operations = [{ operation: 'heal', target: 'target', amount: { op: 'const', value: 100 } }];
    const merged = withPersistentResults(ok, [bind(authored('wound'), 'status:wound')], hash);
    expect(merged.sharedProviders![0]!.abilities![0]!.operations?.[0]).toMatchObject({ operation: 'heal' });
    expect(merged.sharedProviders![0]!.abilities![0]!.operations?.[1]).toMatchObject({ operation: 'apply_provider' });
  });
});
