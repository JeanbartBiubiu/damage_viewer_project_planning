import { describe, expect, it } from 'vitest';
import type { SkillEffect } from '../types/skillEffect';
import type { SkillFormula } from '../types/skillFormula';
import type { ModifierZone } from '../types/modifierZone';
import { fixedValue, formulaValue } from '../types/numericValue';
import { compileTimedAttributeEffect, requiresSelfAttributeSnapshot } from './timedAttributeEffectAdapter';
import { compileNumericValue, createNumericCompileState } from './numericAdapter';
import { compileLinkedShieldEffect } from './shieldEffectAdapter';
import { validateStoredSkillFormula } from '../services/skillFormulaContract';
import { readFileSync } from 'node:fs';
import { TinyGoV2Bridge } from '../../tests/fixtures/authorizedBridge';
import { parseCompileResult, parseDoneResult, parseReleaseResult } from './genericEngineClient';
import { simulationInitialSnapshot } from './simulationInitialSnapshot';
import type { CompileRequest } from '../types/genericEngine';
import { approveAuthoredFixture } from '../../tests/fixtures/nativeFormulaProof';

function sample(skillKey = 'speed_alpha') {
  const formula: SkillFormula = { gameId: 'lol', skillKey, formulaKey: 'decay', name: '有限时间线性模型', description: null, sortOrder: 0, createdAt: '', updatedAt: '',
    expression: { inputs: [{ key: 'elapsed', binding: { kind: 'context', contextKey: 'effect_elapsed_ms' } }],
      stages: [{ key: 'output', name: '增益', expression: { op: 'mul', args: [{ op: 'const', value: '0.20000000298023224' },
        { op: 'max', args: [{ op: 'const', value: '0' }, { op: 'sub', args: [{ op: 'const', value: '1' }, { op: 'div', args: [{ op: 'read', inputKey: 'elapsed' }, { op: 'const', value: '1500' }] }] }] }] } }], outputStageKey: 'output' } };
  const effect: SkillEffect = { gameId: 'lol', skillKey, effectKey: 'speed', name: '独立有限速度', description: null, sortOrder: 0, createdAt: '', updatedAt: '',
    lifecycle: { instanceScope: 'SOURCE', durationValue: fixedValue(1500), maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1), reapplicationStackMode: 'KEEP',
      reapplicationDurationMode: 'REFRESH_ALL', expiryMode: 'ALL_AT_ONCE', periodicIntervalValue: null, firstPeriodicExecution: null, endWhenShieldEndsResultKey: null },
    results: [{ resultKey: 'speed', name: '速度', resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE', description: null, sortOrder: 0, spellShieldBlockScope: null,
      lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'MOMENT_EVALUATION', stackValueMode: 'SHARED', reapplicationValueMode: null, periodicExecutionMode: null },
      valueRule: { value: formulaValue('decay'), fixedMultiplier: 1, fixedMinValue: 0, fixedMaxValue: null }, detail: { attributeKey: 'move_speed', operation: 'INCREASE', modifierZoneKey: 'speed_zone' } }] };
  const zone: ModifierZone = { gameId: 'lol', modifierZoneKey: 'speed_zone', name: '速度比例', domain: 'ATTRIBUTE', calculationMode: 'RATIO_ADD', applicationStage: 'ATTRIBUTE_PERCENT',
    status: 'ENABLED', description: null, sortOrder: 0, createdAt: '', updatedAt: '' };
  const state = createNumericCompileState({ gameId: 'lol', skillKey, skillLevel: 1, characterLevel: 1, formulas: [formula], parameters: [], formulaNamespace: 'speed-proof',
    bindParameters: true, allowAttributeReads: true, runtimeInputMessage: '不猜输入' });
  return { formula, effect, zone, state };
}

function attributeSnapshotSample() {
  const fixture = sample('self_snapshot');
  fixture.formula.expression = { inputs: [{ key: 'ad', binding: { kind: 'attribute', object: 'source', attributeKey: 'attack_damage', valueKind: 'BONUS', view: 'current_frame' } }],
    stages: [{ key: 'out', name: '施加前护甲', expression: { op: 'add', args: [{ op: 'const', value: '45' }, { op: 'mul', args: [{ op: 'const', value: '0.4' }, { op: 'read', inputKey: 'ad' }] }] } }], outputStageKey: 'out' };
  fixture.zone.calculationMode = 'FLAT_ADD';
  fixture.zone.applicationStage = 'ATTRIBUTE_FLAT';
  const first = fixture.effect.results[0]!;
  if (first.resultType !== 'ATTRIBUTE_CHANGE') throw new Error('fixture');
  first.detail.attributeKey = 'armor';
  first.valueRule!.fixedMinValue = null;
  first.lifecycleBehavior = { ...first.lifecycleBehavior!, valueReadMode: 'APPLICATION_SNAPSHOT', reapplicationValueMode: 'REPLACE' };
  const second = structuredClone(first);
  second.resultKey = 'resistance';
  second.sortOrder = 1;
  second.detail.attributeKey = 'magic_resistance';
  second.valueRule!.fixedMultiplier = .6;
  fixture.effect.results.push(second);
  return fixture;
}

describe('有限持续属性的实例时间', () => {
  it('来源属性施加快照保留完整共同公式，并把同组两笔都交给原生冻结', () => {
    const { effect, zone, state, formula } = attributeSnapshotSample();
    const before = structuredClone(effect);
    approveAuthoredFixture(state);
    const compiled = compileTimedAttributeEffect(effect, state, [zone]);
    expect(effect).toEqual(before);
    expect(requiresSelfAttributeSnapshot(effect, state)).toBe(true);
    expect(compiled.operation).toMatchObject({ operation: 'apply_provider', target: 'self' });
    expect(compiled.provider.modifiers).toHaveLength(2);
    expect(compiled.provider.modifiers?.map(modifier => ({ target: modifier.target, policy: modifier.valuePolicy, mode: modifier.valueReadMode }))).toEqual([
      { target: 'self.attr.armor', policy: 'add', mode: 'APPLICATION_SNAPSHOT' },
      { target: 'self.attr.magic_resistance', policy: 'add', mode: 'APPLICATION_SNAPSHOT' },
    ]);
    expect([...state.namedFormulas.values()][0]?.expression).toEqual(formula.expression);
    expect([...state.requiredAttributes]).toEqual(expect.arrayContaining(['attack_damage', 'armor', 'magic_resistance']));
  });

  it.each(['target', 'event_view', 'hp', 'context', 'runtime', 'mixed', 'ratio', 'resource_max', 'limit'] as const)('自身属性快照组拒绝 %s', variant => {
    const { effect, zone, state, formula } = attributeSnapshotSample();
    const first = effect.results[0]!;
    if (first.resultType !== 'ATTRIBUTE_CHANGE') throw new Error('fixture');
    if (variant === 'target') formula.expression.inputs[0]!.binding = { kind: 'attribute', object: 'target', attributeKey: 'attack_damage', valueKind: 'BONUS', view: 'current_frame' };
    if (variant === 'event_view') formula.expression.inputs[0]!.binding = { kind: 'attribute', object: 'source', attributeKey: 'attack_damage', valueKind: 'BONUS', view: 'event_snapshot' };
    if (variant === 'hp') formula.expression.inputs[0]!.binding = { kind: 'attribute', object: 'source', attributeKey: 'hp', valueKind: 'CURRENT', view: 'current_frame' };
    if (variant === 'context') formula.expression.inputs[0]!.binding = { kind: 'context', contextKey: 'effect_elapsed_ms' };
    if (variant === 'runtime') {
      formula.expression.inputs.push({ key: 'external', binding: { kind: 'parameter', skillKey: state.skillKey, parameterKey: 'external' } });
      formula.expression.stages[0]!.expression = { op: 'add', args: [formula.expression.stages[0]!.expression, { op: 'read', inputKey: 'external' }] };
      state.parameters = [{ gameId: 'lol', skillKey: state.skillKey, parameterKey: 'external', name: '外部', valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL', fixedValue: null, levelValues: null, description: null, sortOrder: 0, createdAt: '', updatedAt: '' }];
      state.sceneParameterValues = { external: 0 };
    }
    if (variant === 'mixed') effect.results[1]!.lifecycleBehavior = { ...effect.results[1]!.lifecycleBehavior!, valueReadMode: 'MOMENT_EVALUATION', reapplicationValueMode: null };
    if (variant === 'ratio') { zone.calculationMode = 'RATIO_ADD'; zone.applicationStage = 'ATTRIBUTE_PERCENT'; }
    if (variant === 'resource_max') first.detail.attributeKey = 'hp';
    if (variant === 'limit') first.detail = { attributeKey: 'armor', operation: 'LIMIT_MAX', modifierZoneKey: null };
    expect(() => compileTimedAttributeEffect(effect, state, [zone])).toThrow();
  });

  it('静态叠层不被属性读取快照入口接管', () => {
    const { effect, state } = attributeSnapshotSample();
    for (const result of effect.results) result.valueRule!.value = fixedValue(5);
    effect.lifecycle!.maxStacksValue = fixedValue(8);
    expect(requiresSelfAttributeSnapshot(effect, state)).toBe(false);
  });

  it('最终上界作为同一有限属性实例的明确限制，不冒充覆盖或比例乘区', () => {
    const { effect, state } = sample();
    const result = effect.results[0]!;
    if (result.resultType !== 'ATTRIBUTE_CHANGE') throw new Error('fixture');
    result.detail = { attributeKey: 'attack_speed', operation: 'LIMIT_MAX', modifierZoneKey: null };
    result.valueRule = { value: fixedValue(3.33), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null };
    expect(compileTimedAttributeEffect(effect, state, []).provider.modifiers).toEqual([
      { modifierKey: 'speed', kind: 'attribute', target: 'self.attr.attack_speed', valuePolicy: 'min', stage: 'final', value: { op: 'const', value: 3.33 } }
    ]);
    result.valueRule.value = fixedValue(0);
    expect(compileTimedAttributeEffect(effect, state, []).provider.modifiers![0]!.value).toEqual({ op: 'const', value: 0 });
    result.detail.modifierZoneKey = 'speed_zone';
    expect(() => compileTimedAttributeEffect(effect, state, [])).toThrow(/不使用乘区/);
    result.detail.modifierZoneKey = null;
    result.valueRule.value = formulaValue('decay');
    expect(() => compileTimedAttributeEffect(effect, state, [])).toThrow();
  });

  it.each(['snapshot_alpha', 'snapshot_beta'])('%s 静态快照由已选等级核定，支持补集比例且不采样属性', skillKey => {
    const { effect, zone, state, formula } = sample(skillKey);
    formula.expression = { inputs: [{ key: 'ratio', binding: { kind: 'parameter', skillKey, parameterKey: 'ratio' } }],
      stages: [{ key: 'out', name: '静态值', expression: { op: 'read', inputKey: 'ratio' } }], outputStageKey: 'out' };
    state.skillLevel = 2;
    state.parameters = [{ gameId: 'lol', skillKey, parameterKey: 'ratio', name: '真实等级值', valueMode: 'SKILL_LEVEL', valueType: 'DECIMAL',
      fixedValue: null, levelValues: { '1': .4, '2': .6 }, description: null, sortOrder: 0, createdAt: '', updatedAt: '' }];
    const result = effect.results[0]!;
    result.lifecycleBehavior = { ...result.lifecycleBehavior!, valueReadMode: 'APPLICATION_SNAPSHOT', reapplicationValueMode: 'REPLACE' };
    zone.calculationMode = 'RATIO_COMPLEMENT_MULTIPLY';
    approveAuthoredFixture(state);
    const compiled = compileTimedAttributeEffect(effect, state, [zone]);
    expect(compiled.provider.modifiers![0]).toMatchObject({ kind: 'attribute', stage: 'total', valuePolicy: 'complement_multiply', value: { op: 'const', value: .6 } });
    expect(compiled.operation.ref).toBe(`skills.${skillKey}.effects.speed.results.speed`);
    expect([...state.namedFormulas.values()][0]!.expression).toEqual(formula.expression);
  });

  it.each(['attribute', 'elapsed', 'runtime', 'too_large', 'multi_result'] as const)('静态快照拒绝完整依赖中的 %s', variant => {
    const { effect, zone, state, formula } = sample();
    effect.results[0]!.lifecycleBehavior = { ...effect.results[0]!.lifecycleBehavior!, valueReadMode: 'APPLICATION_SNAPSHOT', reapplicationValueMode: 'REPLACE' };
    if (variant === 'attribute') formula.expression.inputs[0]!.binding = { kind: 'attribute', object: 'source', attributeKey: 'hp', valueKind: 'total' };
    if (variant === 'runtime') {
      formula.expression.inputs[0]!.binding = { kind: 'parameter', skillKey: state.skillKey, parameterKey: 'unknown' };
      state.parameters = [{ gameId: 'lol', skillKey: state.skillKey, parameterKey: 'unknown', name: '未知', valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL',
        fixedValue: null, levelValues: null, description: null, sortOrder: 0, createdAt: '', updatedAt: '' }];
      state.runtimeInputReads = { unknown: { op: 'read', path: 'use.charge_duration_ms' } };
    }
    if (variant === 'too_large') { effect.results[0]!.valueRule!.value = fixedValue(1.1); zone.calculationMode = 'RATIO_COMPLEMENT_MULTIPLY'; }
    if (variant === 'multi_result') effect.results.push({ ...structuredClone(effect.results[0]!), resultKey: 'extra' });
    expect(() => compileTimedAttributeEffect(effect, state, [zone])).toThrow();
  });

  it.each(['speed_alpha', 'haste_beta'])('%s 只生成显式按自身刷新的供值器，原精度与作者公式完整保留', skillKey => {
    const { formula, effect, zone, state } = sample(skillKey);
    const before = structuredClone(effect);
    expect(validateStoredSkillFormula(formula.expression, skillKey)).toBeNull();
    const compiled = compileTimedAttributeEffect(effect, state, [zone], 'real_source_definition');
    expect(effect).toEqual(before);
    expect(compiled.operation).toMatchObject({ operation: 'apply_provider', target: 'self', providerDefinitionRef: `timed/real_source_definition/${skillKey}/speed` });
    expect(compiled.provider.lifecycle).toEqual({ durationMs: { op: 'const', value: 1500 }, maxStacks: 1, refreshPolicy: 'replace', instanceScope: 'source_target' });
    expect(compiled.provider.modifiers![0]!.value.op).toBe('max');
    expect([...state.namedFormulas.values()][0]!.expression).toEqual(formula.expression);
    expect(compiled.provider.abilities).toBeUndefined();
    expect(state.allowedContextKeys).toBeUndefined();
  });

  it('普通数值、盾金额及持续时间都不能借用实例时间', () => {
    const { effect, zone, state } = sample();
    expect(() => compileNumericValue(formulaValue('decay'), 'damage', state)).toThrow(/只允许有限持续属性/);
    effect.lifecycle!.durationValue = formulaValue('decay');
    expect(() => compileTimedAttributeEffect(effect, state, [zone])).toThrow(/只允许有限持续属性/);
    effect.lifecycle!.durationValue = fixedValue(1500);
    effect.lifecycle!.endWhenShieldEndsResultKey = 'speed';
    effect.results = [{ ...effect.results[0]!, resultType: 'NORMAL_SHIELD', detail: { absorbedDamageTypeKey: null, decayMode: 'NONE' },
      lifecycleBehavior: { ...effect.results[0]!.lifecycleBehavior!, valueReadMode: 'APPLICATION_SNAPSHOT', reapplicationValueMode: 'REPLACE' } }];
    expect(() => compileLinkedShieldEffect(effect, state, [zone])).toThrow(/只允许有限持续属性/);
  });

  it.each(['infinite', 'snapshot', 'multi', 'target', 'periodic', 'keep', 'other_context'] as const)('不支持的组合 %s 仍报字段错误', variant => {
    const { effect, zone, state, formula } = sample();
    if (variant === 'infinite') { effect.lifecycle!.expiryMode = 'EXPLICIT_ONLY'; effect.lifecycle!.durationValue = null; }
    if (variant === 'snapshot') effect.results[0]!.lifecycleBehavior!.valueReadMode = 'APPLICATION_SNAPSHOT';
    if (variant === 'multi') effect.lifecycle!.maxStacksValue = fixedValue(2);
    if (variant === 'target') effect.results[0]!.target = 'TARGET';
    if (variant === 'periodic') effect.lifecycle!.periodicIntervalValue = fixedValue(100);
    if (variant === 'keep') effect.results[0]!.lifecycleBehavior!.reapplicationValueMode = 'KEEP';
    if (variant === 'other_context') formula.expression.inputs[0]!.binding = { kind: 'context', contextKey: 'arbitrary_clock' };
    expect(() => compileTimedAttributeEffect(effect, state, [zone])).toThrow();
  });

  it('真实 Wasm 按实例时间求值0、750、1499、1500毫秒，原共同公式不变且无需逐毫秒事件', async () => {
    const { effect, state, zone } = sample();
    const compiledEffect = compileTimedAttributeEffect(effect, state, [zone], 'owner_definition');
    const input: CompileRequest = { schemaVersion: 'generic-p0', schemaHash: 'timed-host-proof', rulesHash: 'timed-host-proof',
      typeCatalog: { types: [{ key: 'hp', domain: 'attribute' }, { key: 'move_speed', domain: 'attribute' }], relations: [] },
      combatants: ['source', 'target'].map(key => ({ key, attributes: { hp: { base: 1000, current: 1000, max: 1000, resolved: 1000 },
        move_speed: { base: 100, current: 100, max: 100, resolved: 100 } }, resources: { energy: { current: 0, max: 100000 } },
        providers: key === 'source' ? [{ providerRef: 'owner', definitionRef: 'owner_definition' }] : [] })),
      formulas: [...state.namedFormulas.values()], rules: {}, sharedProviders: [compiledEffect.provider,
        { providerKey: 'owner_definition', stableId: 'owner_definition', skillKey: state.skillKey, kind: 'character', abilities: [
          { abilityKey: 'apply', kind: 'active', operations: [compiledEffect.operation] },
          { abilityKey: 'inspect', kind: 'active', operations: [{ operation: 'resource_change', target: 'self', resourceKey: 'energy', amount: { op: 'read', path: 'source.attr.move_speed.resolved' } }] }
        ] }] };
    const bytes = readFileSync(process.env.PHASE3B_WASM_PATH || new URL('./wasm/tinygo_engine_v2.wasm', import.meta.url));
    const bridge = await TinyGoV2Bridge.create({ wasmUrl: 'data:application/wasm;base64,' + bytes.toString('base64') });
    const result = parseCompileResult(bridge.compile(input));
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
    if (!result.sessionId) throw new Error('真实编译没有会话');
    try {
      for (const at of [0, 750, 1499, 1500]) {
        const done = parseDoneResult(bridge.run({ sessionId: result.sessionId, expectedRulesHash: input.rulesHash, schemaVersion: input.schemaVersion,
          schemaHash: input.schemaHash, rulesHash: input.rulesHash, initialSnapshot: simulationInitialSnapshot(input),
          driverPlan: { conditionRecheckIntervalMs: 100, entries: [
            { entryKey: 'apply', abilityRef: 'source.provider[owner].ability[apply]', source: 'source', target: 'source', firstAtMs: 0, priority: 0 },
            { entryKey: 'inspect', abilityRef: 'source.provider[owner].ability[inspect]', source: 'source', target: 'source', firstAtMs: at, priority: 1 }
          ] }, stopPolicy: { durationMs: Math.max(1, at), stopOnTargetDeath: false, stopWhenNoEvents: false },
          sampling: { disabled: true, sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 10 } }));
        expect(done.ok, JSON.stringify(done.errors)).toBe(true);
        const source = done.finalSnapshot.combatants.find(row => row.key === 'source')!;
        expect(source.resources.energy!.current).toBeCloseTo(100 * (1 + .20000000298023224 * Math.max(0, 1 - at / 1500)), 9);
        const provider = source.providers.find(row => row.definitionRef === compiledEffect.provider.providerKey);
        if (at < 1500) expect(provider?.appliedAtMs).toBe(0);
        else expect(provider).toBeUndefined();
        expect(done.evidence.items.filter(row => row.kind === 'provider_tick')).toEqual([]);
      }
    } finally { expect(parseReleaseResult(bridge.releaseSession(result.sessionId, input.rulesHash)).released).toBe(true); }
  });
});
