import { describe, expect, it } from 'vitest';
import type { Attribute } from '../types/attribute';
import type { SkillFormula } from '../types/skillFormula';
import type { SkillInternalState } from '../types/skillInternalState';
import type { SkillParameter } from '../types/skillParameter';
import { createNumericCompileState } from './numericAdapter';
import { compileStateFieldSchema } from './processStateAdapter';

function sample(namespace = 'active') {
  const meta = { gameId: 'lab', skillKey: 'ammo_skill', name: '独立回充', description: null, sortOrder: 0, createdAt: '', updatedAt: '' };
  const parameter: SkillParameter = { ...meta, parameterKey: 'recovery_ms', valueType: 'INTEGER', valueMode: 'SKILL_LEVEL', fixedValue: null, levelValues: { 1: 16000, 2: 15000 } };
  const attribute: Attribute = { gameId: meta.gameId, attributeKey: 'ability_haste', name: '急速', description: null, sortOrder: 0,
    createdAt: '', updatedAt: '', valueType: 'DECIMAL', status: 'ENABLED', minValue: null, maxValue: null };
  const formula: SkillFormula = { ...meta, formulaKey: 'recovery', expression: {
    inputs: [{ key: 'base', binding: { kind: 'parameter', skillKey: meta.skillKey, parameterKey: parameter.parameterKey } },
      { key: 'haste', binding: { kind: 'attribute', object: 'source', attributeKey: attribute.attributeKey, valueKind: 'TOTAL', view: 'current_frame' } }],
    stages: [{ key: 'raw', name: '实际原额', expression: { op: 'div', args: [
      { op: 'mul', args: [{ op: 'read', inputKey: 'base' }, { op: 'const', value: '100' }] },
      { op: 'add', args: [{ op: 'const', value: '100' }, { op: 'read', inputKey: 'haste' }] }
    ] } }, { key: 'result', name: '正毫秒舍入', expression: { op: 'if', args: [
      { op: 'gt', args: [{ op: 'ref', stageKey: 'raw' }, { op: 'const', value: '0' }] },
      { op: 'max', args: [{ op: 'const', value: '1' }, { op: 'round', args: [{ op: 'ref', stageKey: 'raw' }], decimals: 0 }] },
      { op: 'ref', stageKey: 'raw' }
    ] } }], outputStageKey: 'result'
  } };
  const row: SkillInternalState = { ...meta, stateKey: 'stock', stateType: 'AMMO', scope: 'SKILL', detail: {
    initialValue: { kind: 'FIXED', value: 2 }, maxValue: { kind: 'FIXED', value: 2 }, recoveryIntervalValue: { kind: 'FORMULA', formulaKey: 'recovery' },
    recoveryMode: 'ONE_BY_ONE', recoveryStartCondition: 'AFTER_CONSUME'
  } };
  const state = createNumericCompileState({ ...meta, skillLevel: 1, characterLevel: 18, parameters: [parameter], formulas: [formula],
    formulaNamespace: namespace, bindParameters: true, allowAttributeReads: true, runtimeInputMessage: '不补默认' });
  const attributes: Attribute[] = [attribute];
  return { row, state, formula, parameter, attributes,
    compile: () => compileStateFieldSchema(row, state, 'states.stock', {}, attributes) };
}

describe('当前拥有者属性驱动的逐轮弹药回充', () => {
  it('保留完整作者round/if公式与实际等级参数，不折叠AH或预约截止', () => {
    const item = sample(), schema = item.compile(), interval = schema.ammoRecovery!.intervalMs;
    expect(interval.op).toBe('ref');
    const formula = item.state.namedFormulas.get(interval.ref!)!;
    expect(formula.expression).toEqual(item.formula.expression);
    expect(formula.parameters).toEqual([{ parameterKey: 'recovery_ms', valueMode: 'SKILL_LEVEL', valueType: 'INTEGER', value: 16000 }]);
    expect(item.state.requiredAttributes).toEqual(new Set(['ability_haste']));
    expect(item.state.params).toEqual({});
    expect(schema).toMatchObject({ defaultValue: 2, maxValue: 2, stateKind: 'ammo', ammoRecovery: { mode: 'one_by_one', startCondition: 'after_consume' } });
  });
  it('自然与主动的原命名空间不同仍产出逐字相等的schema/完整公式', () => {
    const active = sample('process/ammo_skill'), natural = sample('source_natural_skill_1');
    expect(active.compile()).toEqual(natural.compile());
    expect([...active.state.namedFormulas.values()]).toEqual([...natural.state.namedFormulas.values()]);
    expect(active.compile().ammoRecovery!.intervalMs.ref).toBe('ammo-recovery/lab/ammo_skill/levels/1/18/state/stock/recovery');
  });
  it('原静态回充可省属性目录，仍是原严格整数和常量schema', () => {
    const item = sample(); item.row.detail.recoveryIntervalValue = { kind: 'FIXED', value: 16000 };
    expect(compileStateFieldSchema(item.row, item.state, 'states.stock')).toMatchObject({ ammoRecovery: { intervalMs: { op: 'const', value: 16000 } } });
    item.row.detail.recoveryIntervalValue = { kind: 'FIXED', value: 1.5 };
    expect(item.compile).toThrow();
  });
  it.each(['missing', 'disabled', 'wrong_game', 'duplicate', 'no_directory'] as const)('真实属性目录拒绝:%s', variant => {
    const item = sample();
    if (variant === 'missing') item.attributes.length = 0;
    if (variant === 'disabled') item.attributes[0]!.status = 'DISABLED';
    if (variant === 'wrong_game') item.attributes[0]!.gameId = 'other';
    if (variant === 'duplicate') item.attributes.push({ ...item.attributes[0]! });
    expect(() => variant === 'no_directory' ? compileStateFieldSchema(item.row, item.state, 'states.stock') : item.compile()).toThrow();
  });
  it.each(['target', 'bonus', 'start_frame', 'context', 'hidden_context', 'unused_attribute'] as const)('完整公式不隐藏额外读取:%s', variant => {
    const item = sample(), input = item.formula.expression.inputs[1]!;
    if (input.binding.kind !== 'attribute') throw Error('样例失效');
    if (variant === 'target') input.binding.object = 'target';
    if (variant === 'bonus') input.binding.valueKind = 'BONUS';
    if (variant === 'start_frame') input.binding.view = 'event_snapshot';
    if (variant === 'context') input.binding = { kind: 'context', contextKey: 'effect_elapsed_ms' };
    if (variant === 'hidden_context') item.formula.expression.inputs.push({ key: 'hidden', binding: { kind: 'context', contextKey: 'effect_elapsed_ms' } });
    if (variant === 'unused_attribute') item.formula.expression.stages = [{ key: 'result', name: '不读取', expression: { op: 'const', value: '1000' } }];
    expect(item.compile).toThrow();
  });
  it.each(['runtime', 'missing', 'duplicate', 'wrong_skill', 'missing_level', 'nonfinite', 'invalid_false_branch'] as const)('本地参数和所有分支严格验证:%s', variant => {
    const item = sample();
    if (variant === 'runtime') { item.parameter.valueMode = 'RUNTIME_INPUT'; item.parameter.levelValues = null; item.state.sceneParameterValues = { recovery_ms: 1000 }; }
    if (variant === 'missing') item.state.parameters = [];
    if (variant === 'duplicate') item.state.parameters = [item.parameter, { ...item.parameter }];
    if (variant === 'wrong_skill') item.parameter.skillKey = 'other';
    if (variant === 'missing_level') item.parameter.levelValues = { 2: 15000 };
    if (variant === 'nonfinite') item.parameter.levelValues = { 1: Infinity };
    if (variant === 'invalid_false_branch') item.formula.expression.stages[1]!.expression = { op: 'if', args: [
      { op: 'const', value: '1' }, { op: 'const', value: '1000' }, { op: 'read', inputKey: 'absent' }
    ] };
    expect(item.compile).toThrow();
  });
  it.each(['capacity_dynamic', 'initial_dynamic', 'short_missing', 'full_remaining', 'duplicate_formula'] as const)('库存/容量/余时旧门不放宽:%s', variant => {
    const item = sample();
    if (variant === 'capacity_dynamic') item.row.detail.maxValue = { kind: 'FORMULA', formulaKey: 'recovery' };
    if (variant === 'initial_dynamic') item.row.detail.initialValue = { kind: 'FORMULA', formulaKey: 'recovery' };
    if (variant === 'short_missing') item.row.detail.initialValue = { kind: 'FIXED', value: 1 };
    if (variant === 'full_remaining') item.row.detail.initialRemainingValue = { kind: 'FIXED', value: 1 };
    if (variant === 'duplicate_formula') item.state.formulas = [item.formula, { ...item.formula }];
    expect(item.compile).toThrow();
  });
  it('同一规范键下不同参数/原文仍触发现有完整载荷冲突门', () => {
    const item = sample(); item.compile(); item.parameter.levelValues = { 1: 9999 };
    expect(item.compile).toThrow(/冲突/);
  });
  it('非法原额不在Web补成1，实际正整数期限仍交原生每轮核验', () => {
    const item = sample(); item.parameter.levelValues = { 1: 0 };
    const result = item.compile();
    expect(result.ammoRecovery!.intervalMs.op).toBe('ref');
    expect(item.state.namedFormulas.get(result.ammoRecovery!.intervalMs.ref!)!.expression).toEqual(item.formula.expression);
  });
});
