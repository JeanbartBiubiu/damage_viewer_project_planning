import { describe, expect, it } from 'vitest';
import type { SkillEffect } from '../types/skillEffect';
import type { SkillFormula } from '../types/skillFormula';
import type { ModifierZone } from '../types/modifierZone';
import { fixedValue, formulaValue } from '../types/numericValue';
import { compileTimedAttributeEffect } from './timedAttributeEffectAdapter';
import { compileNumericValue, createNumericCompileState } from './numericAdapter';
import { compileLinkedShieldEffect } from './shieldEffectAdapter';
import { validateStoredSkillFormula } from '../services/skillFormulaContract';
import { readFileSync } from 'node:fs';
import { TinyGoV2Bridge } from './tinygoV2Bridge';
import { parseCompileResult, parseDoneResult, parseReleaseResult } from './genericEngineClient';
import { simulationInitialSnapshot } from './simulationInitialSnapshot';
import type { CompileRequest } from '../types/genericEngine';

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

describe('有限持续属性的实例时间', () => {
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
