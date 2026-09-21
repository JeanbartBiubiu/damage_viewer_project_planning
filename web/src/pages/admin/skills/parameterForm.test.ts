import { describe, expect, it } from 'vitest';
import {
  applyValueModeReset,
  applyPastedLevelValues,
  buildLevelValues,
  createEmptyParameterDraft,
  fillArithmeticLevelValues,
  fillFixedLevelValues,
  mapParameterFieldIssues,
  validateParameterDraft
} from './parameterForm';

describe('parameterForm level helpers', () => {
  it('fills fixed and arithmetic sequences including negative and non-1 start', () => {
    expect(fillFixedLevelValues(1, 3, 7)).toEqual({ '1': '7', '2': '7', '3': '7' });
    expect(fillArithmeticLevelValues(1, 5, 20, 25)).toEqual({
      '1': '20',
      '2': '45',
      '3': '70',
      '4': '95',
      '5': '120'
    });
    expect(fillArithmeticLevelValues(2, 4, 10, -3)).toEqual({
      '2': '10',
      '3': '7',
      '4': '4'
    });
  });

  it('allows manual override after generation', () => {
    const generated = fillArithmeticLevelValues(1, 3, 1, 1);
    generated['2'] = '99';
    const built = buildLevelValues(generated, 1, 3, 'INTEGER');
    expect(built).toEqual({ ok: true, levelValues: { '1': 1, '2': 99, '3': 3 } });
  });

  it('rejects missing keys, extra keys, non-finite and non-integer values', () => {
    expect(buildLevelValues({ '1': '1' }, 1, 2, 'DECIMAL')).toMatchObject({ ok: false });
    expect(buildLevelValues({ '1': '1', '2': '2', '3': '3' }, 1, 2, 'DECIMAL')).toMatchObject({
      ok: false
    });
    expect(buildLevelValues({ '1': '1', '2': 'abc' }, 1, 2, 'DECIMAL')).toMatchObject({ ok: false });
    expect(buildLevelValues({ '1': '1', '2': '1.5' }, 1, 2, 'INTEGER')).toMatchObject({ ok: false });
    expect(buildLevelValues({ '1': '1', '2': 'Infinity' }, 1, 2, 'DECIMAL')).toMatchObject({
      ok: false
    });
  });

  it('builds a complete map for the current range', () => {
    expect(buildLevelValues({ '1': '0', '2': '1.5', '3': '-2' }, 1, 3, 'DECIMAL')).toEqual({
      ok: true,
      levelValues: { '1': 0, '2': 1.5, '3': -2 }
    });
  });

  it('applies a nonlinear eighteen-level column from a non-1 starting level without mutating the draft', () => {
    const currentValues = Object.fromEntries(
      Array.from({ length: 18 }, (_, index) => [String(index + 3), '0'])
    );
    const originalValues = { ...currentValues };
    const values = Array.from({ length: 18 }, (_, index) => String(index * index + 0.25));
    const result = applyPastedLevelValues(currentValues, values.join('\n'), 3, 20, 'DECIMAL');

    expect(result).toEqual({
      ok: true,
      levelValues: Object.fromEntries(values.map((value, index) => [String(index + 3), value]))
    });
    expect(currentValues).toEqual(originalValues);
  });

  it('accepts mixed supported separators and scientific decimal notation', () => {
    expect(applyPastedLevelValues({}, '1\t-2.5\n3e1，4', 2, 5, 'DECIMAL')).toEqual({
      ok: true,
      levelValues: { '2': '1', '3': '-2.5', '4': '3e1', '5': '4' }
    });
  });

  it('accepts Windows CRLF line endings while preserving a real empty line', () => {
    expect(applyPastedLevelValues({}, '1\r\n2\r\n3', 5, 7, 'DECIMAL')).toEqual({
      ok: true,
      levelValues: { '5': '1', '6': '2', '7': '3' }
    });
    expect(applyPastedLevelValues({}, '1\r\n\r\n3', 5, 7, 'DECIMAL')).toEqual({
      ok: false,
      message: '第2项（Lv6）不能为空。'
    });
  });

  it('rejects an empty item with its exact level and leaves the draft unchanged', () => {
    const currentValues = { '5': '10', '6': '20', '7': '30' };
    const result = applyPastedLevelValues(currentValues, '1\n\n3', 5, 7, 'DECIMAL');

    expect(result).toEqual({ ok: false, message: '第2项（Lv6）不能为空。' });
    expect(currentValues).toEqual({ '5': '10', '6': '20', '7': '30' });
  });

  it('rejects an exact count mismatch without filling missing values', () => {
    expect(applyPastedLevelValues({ '5': '10', '6': '20', '7': '30' }, '1,2', 5, 7, 'DECIMAL'))
      .toEqual({ ok: false, message: '请按 Lv5 至 Lv7 的顺序输入 3 个数值，当前为 2 个。' });
  });

  it.each(['0x10', 'NaN', 'Infinity', '-Infinity', '1e309'])('rejects non-decimal or non-finite value: %s', (value) => {
    expect(applyPastedLevelValues({}, `1\n${value}\n3`, 5, 7, 'DECIMAL')).toEqual({
      ok: false,
      message: '第2项（Lv6）必须是十进制有限数字。'
    });
  });

  it('rejects a decimal item for an integer parameter', () => {
    expect(applyPastedLevelValues({}, '1\n2.5\n3', 5, 7, 'INTEGER')).toEqual({
      ok: false,
      message: '第2项（Lv6）必须是整数。'
    });
  });
});

describe('parameterForm mode switching', () => {
  it('resets value fields for each mode transition', () => {
    const base = createEmptyParameterDraft('FIXED');
    base.fixedValue = '12';
    base.levelValues = { '1': '9' };

    const toLevel = applyValueModeReset(base, 'SKILL_LEVEL', { minLevel: 1, maxLevel: 2 });
    expect(toLevel.fixedValue).toBe('');
    expect(toLevel.levelValues).toEqual({ '1': '0', '2': '0' });

    const toFixed = applyValueModeReset(toLevel, 'FIXED', { minLevel: 1, maxLevel: 2 });
    expect(toFixed.fixedValue).toBe('0');
    expect(toFixed.levelValues).toEqual({});

    const toRuntime = applyValueModeReset(toFixed, 'RUNTIME_INPUT', { minLevel: 1, maxLevel: 2 });
    expect(toRuntime.fixedValue).toBe('');
    expect(toRuntime.levelValues).toEqual({});

    const fromRuntime = applyValueModeReset(toRuntime, 'CHARACTER_LEVEL', {
      minLevel: 2,
      maxLevel: 3
    });
    expect(fromRuntime.fixedValue).toBe('');
    expect(fromRuntime.levelValues).toEqual({ '2': '0', '3': '0' });
  });

  it('validates RUNTIME_INPUT as null value fields', () => {
    const draft = createEmptyParameterDraft('RUNTIME_INPUT');
    draft.parameterKey = 'current_stacks';
    draft.name = '当前层数';
    draft.valueType = 'INTEGER';
    const result = validateParameterDraft(draft, true, null);
    expect(result).toEqual({
      ok: true,
      normalized: {
        parameterKey: 'current_stacks',
        name: '当前层数',
        valueType: 'INTEGER',
        valueMode: 'RUNTIME_INPUT',
        fixedValue: null,
        levelValues: null,
        description: null,
        sortOrder: 0
      }
    });
  });
});

describe('mapParameterFieldIssues', () => {
  it('maps known fields and keeps unmapped messages', () => {
    const mapped = mapParameterFieldIssues({
      details: {
        fieldIssues: [
          { field: 'parameterKey', message: '标识冲突' },
          { field: 'name', message: '名称过长' },
          { field: 'valueType', message: '类型无效' },
          { field: 'valueMode', message: '取值方式无效' },
          { field: 'fixedValue', message: '固定值无效' },
          { field: 'levelValues', message: '等级 Map 不完整' },
          { field: 'description', message: '说明过长' },
          { field: 'sortOrder', message: '排序无效' },
          { field: 'unknownField', message: '未知字段' }
        ]
      }
    });
    expect(mapped.fieldErrors).toEqual({
      parameterKey: '标识冲突',
      name: '名称过长',
      valueType: '类型无效',
      valueMode: '取值方式无效',
      fixedValue: '固定值无效',
      levelValues: '等级 Map 不完整',
      description: '说明过长',
      sortOrder: '排序无效'
    });
    expect(mapped.unmappedMessages).toEqual(['未知字段']);
  });
});
