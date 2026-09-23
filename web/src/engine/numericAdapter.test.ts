import { describe, expect, it } from 'vitest';
import type { SkillFormula } from '../types/skillFormula';
import type { SkillParameter } from '../types/skillParameter';
import { fixedValue, parameterValue } from '../types/numericValue';
import { compileNumericValue, compileParameter, createNumericCompileState, NumericAdaptationError } from './numericAdapter';

function parameter(overrides: Partial<SkillParameter> = {}): SkillParameter {
  return {
    gameId: 'lol', skillKey: 'cast_skill', parameterKey: 'mana_cost', name: '法力', valueType: 'INTEGER',
    valueMode: 'FIXED', fixedValue: 50, levelValues: null, description: null, sortOrder: 10, createdAt: '', updatedAt: '',
    ...overrides
  };
}

function state(parameters: SkillParameter[] = [parameter()]) {
  return createNumericCompileState({
    gameId: 'lol', skillKey: 'cast_skill', skillLevel: 1, characterLevel: 1, parameters,
    formulaNamespace: 'numeric/test', bindParameters: true, allowAttributeReads: false,
    runtimeInputMessage: '未知动态：未供值的计算时输入不能运行'
  });
}

describe('numericAdapter 计算时读值', () => {
  it('原型属性名不是当前动作的已绑定输入', () => {
    const compiled = state([parameter({ parameterKey: 'constructor', valueMode: 'RUNTIME_INPUT', fixedValue: null })]);
    compiled.runtimeInputReads = {};
    expect(() => compileParameter('constructor', 'value.parameterKey', compiled)).toThrow(/计算时输入/);
    compiled.runtimeInputReads = { constructor: { op: 'read', path: 'process.actual_cost.mana' } };
    expect(compileParameter('constructor', 'value.parameterKey', compiled)).toEqual({ op: 'read', path: 'process.actual_cost.mana' });
  });

  it('未映射的 RUNTIME_INPUT 仍拒绝，且不写入参数帧', () => {
    const compiled = state([parameter({ valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL', fixedValue: null })]);
    expect(() => compileParameter('mana_cost', 'mana_cost', compiled)).toThrow(NumericAdaptationError);
    expect(() => compileParameter('mana_cost', 'mana_cost', compiled)).toThrow(/计算时输入/);
    expect(compiled.params).toEqual({});
  });

  it('只接受当前动作列出的参数，固定值不被映射改写', () => {
    const dynamic = parameter({ parameterKey: 'refund', valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL', fixedValue: null });
    const compiled = state([parameter(), dynamic]);
    compiled.runtimeInputReads = { refund: { op: 'read', path: 'process.actual_cost.mana' } };
    expect(compileParameter('refund', 'refund', compiled)).toEqual({ op: 'read', path: 'process.actual_cost.mana' });
    expect(compiled.params).toEqual({});
    expect(() => compileParameter('mana_cost', 'mana_cost', { ...compiled, runtimeInputReads: { mana_cost: { op: 'read', path: 'process.actual_cost.mana' } } })).not.toThrow();
    expect(compileParameter('mana_cost', 'mana_cost', compiled)).toEqual({ op: 'read', path: 'ability.param.mana_cost' });
    expect(compiled.params.mana_cost).toBe(50);
    const missing = state([dynamic, parameter({ parameterKey: 'other', valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL', fixedValue: null })]);
    missing.runtimeInputReads = { refund: { op: 'read', path: 'process.actual_cost.mana' } };
    expect(() => compileParameter('other', 'other', missing)).toThrow(/计算时输入/);
  });

  it('命名公式里的直接参数引用仍要验证', () => {
    const formula: SkillFormula = {
      gameId: 'lol', skillKey: 'cast_skill', formulaKey: 'refund_formula', name: '退款', description: null, sortOrder: 10,
      createdAt: '', updatedAt: '',
      expression: { nodeType: 'PARAMETER', parameterKey: 'refund' }
    };
    const compiled = state([parameter({ parameterKey: 'refund', valueMode: 'RUNTIME_INPUT', valueType: 'DECIMAL', fixedValue: null })]);
    compiled.formulas = [formula];
    compiled.runtimeInputReads = { refund: { op: 'read', path: 'process.actual_cost.mana' } };
    expect(compileNumericValue({ kind: 'FORMULA', formulaKey: 'refund_formula' }, 'value', compiled)).toEqual({
      op: 'ref', ref: 'numeric/test/refund_formula'
    });
    expect(compiled.namedFormulas.get('numeric/test/refund_formula')?.expression).toEqual({ op: 'read', path: 'process.actual_cost.mana' });
    delete compiled.runtimeInputReads;
    expect(() => compileNumericValue({ kind: 'FORMULA', formulaKey: 'missing' }, 'value', compiled)).toThrow(/公式缺失/);
    expect(fixedValue(1).kind).toBe('FIXED');
    expect(parameterValue('refund').parameterKey).toBe('refund');
  });
});
