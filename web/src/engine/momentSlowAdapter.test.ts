import { describe, expect, it } from 'vitest';
import { fixedValue, formulaValue } from '../types/numericValue';
import type { SkillFormula } from '../types/skillFormula';
import type { AuthoredPersistentResult } from './persistentResultAdapter';
import { compilePersistentResult } from './persistentResultAdapter';
import { parseSkillEffect } from '../services/skillEffectClient';
import type { SkillEffect } from '../types/skillEffect';

function sample() {
  const formula: SkillFormula = { gameId: 'mechanism_lab', skillKey: 'timed_slow', formulaKey: 'landing_strength', name: '落地后减速',
    description: null, sortOrder: 0, createdAt: '', updatedAt: '', expression: {
      inputs: [{ key: 'elapsed', binding: { kind: 'context', contextKey: 'effect_elapsed_ms' } }],
      stages: [{ key: 'out', name: '当前强度', expression: { op: 'if', args: [
        { op: 'lt', args: [{ op: 'read', inputKey: 'elapsed' }, { op: 'const', value: '1000' }] },
        { op: 'const', value: '0' }, { op: 'const', value: '0.6' }] } }], outputStageKey: 'out' } };
  const authored: AuthoredPersistentResult = { gameId: formula.gameId, skillKey: formula.skillKey, skillLevel: 1, characterLevel: 1,
    effectKey: 'landing', source: 'source', target: 'target', parameters: [], formulas: [formula], modifierZones: [],
    statuses: [{ statusKey: 'lab_slow', statusKind: 'MOVEMENT_SLOW', status: 'ENABLED' }],
    lifecycle: { durationValue: fixedValue(2500), maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1),
      instanceScope: 'SOURCE_TARGET', reapplicationStackMode: 'KEEP', reapplicationDurationMode: 'REFRESH_ALL',
      expiryMode: 'ALL_AT_ONCE', periodicIntervalValue: null, firstPeriodicExecution: null, endWhenShieldEndsResultKey: null },
    result: { resultKey: 'slow', name: '落地减速', resultType: 'STATUS_OPERATION', target: 'TARGET', description: null, sortOrder: 0,
      detail: { statusKey: 'lab_slow', operation: 'APPLY' }, spellShieldBlockScope: null,
      lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: 'MOMENT_EVALUATION', stackValueMode: 'SHARED', reapplicationValueMode: null, periodicExecutionMode: null },
      valueRule: { value: formulaValue('landing_strength'), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null } } };
  return { authored, formula };
}

describe('有限普通减速显式当前时点取值', () => {
  it('只给新模式发出可选wire，保留完整if公式和纯状态实例，不生成第二命中或周期', () => {
    const { authored, formula } = sample(), compiled = compilePersistentResult(authored, 'landing_definition');
    expect(compiled.provider).toEqual({ providerKey: 'landing_definition', skillKey: 'timed_slow', kind: 'status', stableId: 'landing_definition',
      lifecycle: { durationMs: { op: 'const', value: 2500 }, maxStacks: 1, refreshPolicy: 'replace', instanceScope: 'source_target' },
      statusContributions: [{ resultRef: 'slow', statusKey: 'lab_slow', statusKind: 'movement_slow',
        strength: { op: 'ref', ref: 'status/timed_slow/levels/1/1/landing_strength' }, valueReadMode: 'MOMENT_EVALUATION' }] });
    expect(compiled.formulas[0]!.expression).toEqual(formula.expression);
    expect(compiled.params).toEqual({}); expect(compiled.requiredAttributes).toEqual([]);
    expect(compiled.operation).toEqual({ operation: 'apply_provider', target: 'target', providerDefinitionRef: 'landing_definition' });
  });
  it('新模式常量仍须有限单层门，旧快照wire继续省略字段并保留0至1作者上下界', () => {
    const { authored } = sample(); authored.result.valueRule!.value = fixedValue(.6);
    expect(compilePersistentResult(authored, 'new').provider.statusContributions![0]).toMatchObject({ valueReadMode: 'MOMENT_EVALUATION', strength: { op: 'const', value: .6 } });
    authored.result.lifecycleBehavior!.valueReadMode = 'APPLICATION_SNAPSHOT';
    authored.result.lifecycleBehavior!.reapplicationValueMode = 'REPLACE';
    authored.result.valueRule!.fixedMinValue = 0; authored.result.valueRule!.fixedMaxValue = 1;
    const old = compilePersistentResult(authored, 'old');
    expect(old.provider.statusContributions![0]).not.toHaveProperty('valueReadMode');
    expect(old.provider.statusContributions![0]!.strength).toEqual({ op: 'const', value: .6 });
  });
  it.each(['snapshot_time', 'null_mode', 'unknown_mode', 'multi', 'scope', 'infinite', 'periodic', 'reapplication', 'shield', 'min', 'max', 'range', 'negative_multiplier'])(
    '拒绝非法授权或静态越界 %s', kind => {
      const { authored } = sample();
      if (kind === 'snapshot_time') { authored.result.lifecycleBehavior!.valueReadMode = 'APPLICATION_SNAPSHOT'; authored.result.lifecycleBehavior!.reapplicationValueMode = 'REPLACE'; }
      if (kind === 'null_mode' || kind === 'unknown_mode') (authored.result.lifecycleBehavior as unknown as Record<string, unknown>).valueReadMode = kind === 'null_mode' ? null : 'CURRENT';
      if (kind === 'multi') authored.lifecycle.maxStacksValue = fixedValue(2);
      if (kind === 'scope') authored.lifecycle.instanceScope = 'TARGET';
      if (kind === 'infinite') authored.lifecycle.durationValue = null;
      if (kind === 'periodic') authored.lifecycle.periodicIntervalValue = fixedValue(100);
      if (kind === 'reapplication') authored.result.lifecycleBehavior!.reapplicationValueMode = 'REPLACE';
      if (kind === 'shield') authored.lifecycle.endWhenShieldEndsResultKey = 'shield';
      if (kind === 'min') authored.result.valueRule!.fixedMinValue = 0;
      if (kind === 'max') authored.result.valueRule!.fixedMaxValue = 1;
      if (kind === 'range') authored.result.valueRule!.value = fixedValue(1.01);
      if (kind === 'negative_multiplier') { authored.result.valueRule!.value = fixedValue(-.6); authored.result.valueRule!.fixedMultiplier = -1; }
      expect(() => compilePersistentResult(authored, 'bad')).toThrow();
    });
  it.each(['attribute_branch', 'unused_attribute', 'runtime', 'other_clock'])(
    '所有命名输入和条件分支不能借本场短路越权 %s', kind => {
      const { authored, formula } = sample();
      if (kind === 'other_clock') formula.expression.inputs[0]!.binding = { kind: 'context', contextKey: 'foreign_clock' };
      if (kind === 'attribute_branch' || kind === 'unused_attribute') {
        formula.expression.inputs.push({ key: 'live', binding: { kind: 'attribute', object: 'target', attributeKey: 'move_speed', valueKind: 'TOTAL', view: 'current_frame' } });
        if (kind === 'attribute_branch') formula.expression.stages[0]!.expression = { op: 'if', args: [{ op: 'const', value: '1' }, { op: 'const', value: '0' }, { op: 'read', inputKey: 'live' }] };
      }
      if (kind === 'runtime') {
        formula.expression.inputs.push({ key: 'free', binding: { kind: 'parameter', skillKey: authored.skillKey, parameterKey: 'free' } });
        authored.parameters = [{ gameId: authored.gameId, skillKey: authored.skillKey, parameterKey: 'free', name: '不明值', valueType: 'DECIMAL', valueMode: 'RUNTIME_INPUT', fixedValue: null, levelValues: null, description: null, sortOrder: 0, createdAt: '', updatedAt: '' }];
      }
      expect(() => compilePersistentResult(authored, 'bad')).toThrow();
    });
  it('管理响应模式与重施及上下界成套校验，不能把非法MOMENT形状补为旧快照', () => {
    const { authored } = sample();
    const effect: SkillEffect = { gameId: authored.gameId, skillKey: authored.skillKey, effectKey: authored.effectKey,
      name: '落地', description: null, sortOrder: 0, createdAt: '', updatedAt: '', lifecycle: authored.lifecycle, results: [authored.result] };
    expect(parseSkillEffect(effect)).toEqual(effect);
    const multiple = structuredClone(effect);
    multiple.results.push({ ...structuredClone(multiple.results[0]!), resultKey: 'other' });
    expect(() => parseSkillEffect(multiple)).toThrow('effect.results');
    for (const kind of ['null', 'unknown', 'min', 'max', 'reapplication', 'scope', 'multi', 'negative_multiplier']) {
      const changed = structuredClone(effect);
      if (kind === 'null' || kind === 'unknown') (changed.results[0]!.lifecycleBehavior as unknown as Record<string, unknown>).valueReadMode = kind === 'null' ? null : 'CURRENT';
      if (kind === 'min') changed.results[0]!.valueRule!.fixedMinValue = 0;
      if (kind === 'max') changed.results[0]!.valueRule!.fixedMaxValue = 1;
      if (kind === 'reapplication') changed.results[0]!.lifecycleBehavior!.reapplicationValueMode = 'REPLACE';
      if (kind === 'scope') changed.lifecycle!.instanceScope = 'TARGET';
      if (kind === 'multi') changed.lifecycle!.maxStacksValue = fixedValue(2);
      if (kind === 'negative_multiplier') { changed.results[0]!.valueRule!.value = fixedValue(-.6); changed.results[0]!.valueRule!.fixedMultiplier = -1; }
      expect(() => parseSkillEffect(changed)).toThrow();
    }
  });
  it('不禁止作者公式明确的负乘负，只拒绝新模式的负固定倍率字段', () => {
    const { authored, formula } = sample();
    formula.expression.inputs = [];
    formula.expression.stages[0]!.expression = { op: 'mul', args: [{ op: 'const', value: '-0.6' }, { op: 'const', value: '-1' }] };
    const compiled = compilePersistentResult(authored, 'explicit_math');
    expect(compiled.formulas[0]!.expression).toEqual(formula.expression);
    expect(compiled.provider.statusContributions![0]!.valueReadMode).toBe('MOMENT_EVALUATION');
  });
});
