import { describe, expect, it } from 'vitest';
import {
  applyValueModeReset,
  applyPastedLevelValues,
  buildCreateParameterRequest,
  buildLevelValues,
  createEmptyParameterDraft,
  fillArithmeticLevelValues,
  fillFixedLevelValues,
  mapParameterFieldIssues,
  parameterToDraft,
  validateParameterDraft
} from './parameterForm';

describe('parameterForm empty and zero values', () => {
  it('requires an explicit fixed value and preserves a saved zero when reopened', () => {
    const draft = createEmptyParameterDraft('FIXED');
    draft.parameterKey = 'base_value';
    draft.name = '基础数值';

    expect(draft.fixedValue).toBe('');
    expect(validateParameterDraft(draft, true, null)).toEqual({
      ok: false,
      fieldErrors: { fixedValue: '固定值不能为空。' }
    });

    draft.fixedValue = '0';
    const validated = validateParameterDraft(draft, true, null);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const request = buildCreateParameterRequest(validated.normalized);
    expect(request.fixedValue).toBe(0);
    expect(request.levelValues).toBeNull();

    const reopened = parameterToDraft({
      ...request,
      gameId: 'test',
      skillKey: 'skill_q',
      createdAt: '2026-09-21T00:00:00Z',
      updatedAt: '2026-09-21T00:00:00Z'
    });
    expect(reopened.fixedValue).toBe('0');
    expect(validateParameterDraft(reopened, false, null)).toEqual(validated);
  });

  it.each([
    { valueMode: 'SKILL_LEVEL' as const, range: { minLevel: 1, maxLevel: 2 } },
    { valueMode: 'CHARACTER_LEVEL' as const, range: { minLevel: 3, maxLevel: 4 } }
  ])('requires every $valueMode value and preserves explicit zeros', ({ valueMode, range }) => {
    const draft = createEmptyParameterDraft(valueMode, range);
    draft.parameterKey = 'level_value';
    draft.name = '等级数值';
    const firstLevel = String(range.minLevel);
    const lastLevel = String(range.maxLevel);

    expect(draft.levelValues).toEqual({ [firstLevel]: '', [lastLevel]: '' });
    expect(validateParameterDraft(draft, true, range)).toEqual({
      ok: false,
      fieldErrors: { levelValues: `缺少等级 ${firstLevel} 的数值。` }
    });
    draft.levelValues[firstLevel] = '0';
    expect(validateParameterDraft(draft, true, range)).toEqual({
      ok: false,
      fieldErrors: { levelValues: `缺少等级 ${lastLevel} 的数值。` }
    });

    draft.levelValues[lastLevel] = '0';
    const validated = validateParameterDraft(draft, true, range);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const request = buildCreateParameterRequest(validated.normalized);
    expect(request.fixedValue).toBeNull();
    expect(request.levelValues).toEqual({ [firstLevel]: 0, [lastLevel]: 0 });

    const reopened = parameterToDraft({
      ...request,
      gameId: 'test',
      skillKey: 'skill_q',
      createdAt: '2026-09-21T00:00:00Z',
      updatedAt: '2026-09-21T00:00:00Z'
    }, range);
    expect(reopened.levelValues).toEqual({ [firstLevel]: '0', [lastLevel]: '0' });
    expect(validateParameterDraft(reopened, false, range)).toEqual(validated);
  });

  it('keeps zero available through fixed, arithmetic and pasted fills', () => {
    const expected = { '2': '0', '3': '0' };
    expect(fillFixedLevelValues(2, 3, 0)).toEqual(expected);
    expect(fillArithmeticLevelValues(2, 3, 0, 0)).toEqual(expected);
    expect(applyPastedLevelValues({}, '0\n0', 2, 3, 'INTEGER')).toEqual({
      ok: true,
      levelValues: expected
    });
  });
});

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
    expect(toLevel.levelValues).toEqual({ '1': '', '2': '' });

    const toFixed = applyValueModeReset(toLevel, 'FIXED', { minLevel: 1, maxLevel: 2 });
    expect(toFixed.fixedValue).toBe('');
    expect(toFixed.levelValues).toEqual({});

    const toRuntime = applyValueModeReset(toFixed, 'RUNTIME_INPUT', { minLevel: 1, maxLevel: 2 });
    expect(toRuntime.fixedValue).toBe('');
    expect(toRuntime.levelValues).toEqual({});

    const fromRuntime = applyValueModeReset(toRuntime, 'CHARACTER_LEVEL', {
      minLevel: 2,
      maxLevel: 3
    });
    expect(fromRuntime.fixedValue).toBe('');
    expect(fromRuntime.levelValues).toEqual({ '2': '', '3': '' });
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
