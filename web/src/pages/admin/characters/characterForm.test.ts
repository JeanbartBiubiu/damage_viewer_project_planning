import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../../services/apiClient';
import type { Attribute } from '../../../types/attribute';
import {
  characterFieldIssues,
  describeAttributeProgression,
  generateIncrementingLevelValues,
  generatePerLevelValues,
  getAttributeGenerationMode,
  isAttributeConfigured,
  normalizeLevelValues,
  removeConfiguredAttribute,
  validateCharacterDraft
} from './characterForm';

const ATTRIBUTES: Attribute[] = [
  {
    gameId: 'demo', attributeKey: 'hp', name: '生命值', valueType: 'DECIMAL',
    minValue: 0, maxValue: null, description: null, status: 'ENABLED', sortOrder: 0,
    createdAt: 'now', updatedAt: 'now'
  },
  {
    gameId: 'demo', attributeKey: 'armor', name: '护甲', valueType: 'INTEGER',
    minValue: 0, maxValue: null, description: null, status: 'DISABLED', sortOrder: 1,
    createdAt: 'now', updatedAt: 'now'
  }
];

describe('character form and level map', () => {
  it('validates stable keys and required names', () => {
    expect(validateCharacterDraft({ characterKey: 'Ashe', name: '', description: '' }, true)).toEqual({
      characterKey: '小写字母开头，只能包含小写字母、数字和下划线',
      name: '角色名称不能为空'
    });
    expect(validateCharacterDraft({ characterKey: 'ashe', name: '艾希', description: '' }, true)).toEqual({});
  });

  it('materializes every configured level and current attribute with zero defaults', () => {
    expect(normalizeLevelValues(1, 2, ATTRIBUTES, {
      '1': { hp: 580, armor: 18 },
      '2': { hp: 610 },
      '9': { hp: 999 }
    })).toEqual({
      '1': { hp: 580 },
      '2': { hp: 610 }
    });
  });

  it('distinguishes configured rows and describes fixed or linear progression', () => {
    const values = {
      '1': { hp: 580, armor: 18 },
      '2': { hp: 610, armor: 18 },
      '3': { hp: 640, armor: 18 }
    };
    expect(isAttributeConfigured(values, 'hp', 1, 3)).toBe(true);
    expect(isAttributeConfigured(values, 'mana', 1, 3)).toBe(false);
    expect(describeAttributeProgression(values, 'hp', 1, 3)).toBe('+30 / level');
    expect(describeAttributeProgression(values, 'armor', 1, 3)).toBe('固定');
    expect(removeConfiguredAttribute(values, 'hp')).toEqual({
      '1': { armor: 18 },
      '2': { armor: 18 },
      '3': { armor: 18 }
    });
  });

  it('generates a linear curve while preserving all other attributes', () => {
    expect(generateIncrementingLevelValues(
      {
        '1': { hp: 580, armor: 18 },
        '2': { hp: 0, armor: 20 },
        '3': { hp: 0, armor: 22 }
      },
      'hp',
      1,
      3,
      580,
      30
    )).toEqual({
      '1': { hp: 580, armor: 18 },
      '2': { hp: 610, armor: 20 },
      '3': { hp: 640, armor: 22 }
    });
  });

  it('selects a lossless editor for fixed, linear and nonlinear values', () => {
    const source = {
      '5': { hp: 600, armor: 10, mana: 0 },
      '6': { hp: 625.5, armor: 12, mana: 0 },
      '7': { hp: 655.25, armor: 14, mana: 0 }
    };
    expect(getAttributeGenerationMode(source, 'hp', 5, 7)).toBe('levels');
    expect(getAttributeGenerationMode(source, 'armor', 5, 7)).toBe('increment');
    expect(getAttributeGenerationMode(source, 'mana', 5, 7)).toBe('fixed');
    expect(describeAttributeProgression(source, 'hp', 5, 7)).toBe('逐级变化');
    const reopenedText = [5, 6, 7].map((level) => source[String(level) as keyof typeof source].hp).join('\n');
    expect(generatePerLevelValues(source, ATTRIBUTES[0]!, 5, 7, reopenedText)).toEqual({ levelValues: source, error: null });
  });

  it('does not replace precise saved values with an almost-linear approximation', () => {
    const source = { '1': { hp: 0.123456789 }, '2': { hp: 0.223456789 }, '3': { hp: 0.323456789 } };
    expect(getAttributeGenerationMode(source, 'hp', 1, 3)).toBe('levels');
    expect(generatePerLevelValues(source, ATTRIBUTES[0]!, 1, 3, '0.123456789 0.223456789 0.323456789').levelValues).toEqual(source);
    const fixed = { '1': { hp: 0.123456789 }, '2': { hp: 0.123456789 } };
    expect(getAttributeGenerationMode(fixed, 'hp', 1, 2)).toBe('fixed');
    expect(generateIncrementingLevelValues(fixed, 'hp', 1, 2, 0.123456789, 0)).toEqual(fixed);
  });

  it('pastes eighteen levels with mixed separators and preserves every other map entry', () => {
    const source = Object.fromEntries(Array.from({ length: 18 }, (_, index) => [String(index + 1), { hp: 100, armor: 20 + index }]));
    const original = structuredClone(source);
    const numbers = Array.from({ length: 18 }, (_, index) => index * index + 0.25);
    const separators = [' ', '\n', ',', '，', '\t'];
    const text = numbers.map((value, index) => `${value}${separators[index % separators.length]}`).join('');
    const result = generatePerLevelValues(source, ATTRIBUTES[0]!, 1, 18, text);
    expect(result.error).toBeNull();
    for (let index = 0; index < 18; index += 1) {
      expect(result.levelValues?.[String(index + 1)]).toEqual({ hp: numbers[index], armor: 20 + index });
    }
    expect(source).toEqual(original);
  });

  it('keeps the complete map and maps zero and inclusive limits to the configured starting level', () => {
    const source = { '1': { hp: 99 }, '5': { armor: 1 }, '6': { armor: 2 }, '7': { armor: 3 }, '9': { hp: 999 } };
    expect(generatePerLevelValues(source, { ...ATTRIBUTES[0]!, minValue: 0, maxValue: 10 }, 5, 7, '0, 5，10')).toEqual({
      error: null,
      levelValues: { '1': { hp: 99 }, '5': { armor: 1, hp: 0 }, '6': { armor: 2, hp: 5 }, '7': { armor: 3, hp: 10 }, '9': { hp: 999 } }
    });
  });

  it.each([['', 0], ['1 2', 2], ['1 2 3 4', 4]] as const)('rejects the wrong value count without producing a partial map: %j', (text, count) => {
    expect(generatePerLevelValues({}, ATTRIBUTES[0]!, 5, 7, text)).toEqual({
      levelValues: null, error: `请按 Lv5 至 Lv7 的顺序输入 3 个数值，当前为 ${count} 个。`
    });
  });

  it.each(['NaN', 'Infinity', '-Infinity', '1e309', 'invalid'])('rejects nonfinite or invalid level values: %s', (value) => {
    expect(generatePerLevelValues({}, ATTRIBUTES[0]!, 5, 7, `1 ${value} 3`)).toEqual({ levelValues: null, error: 'Lv6 的数值必须为有限数。' });
  });

  it('rejects decimal values for integer attributes', () => {
    expect(generatePerLevelValues({}, ATTRIBUTES[1]!, 5, 7, '1 2.5 3')).toEqual({ levelValues: null, error: 'Lv6 的数值必须是整数。' });
    expect(generatePerLevelValues({}, ATTRIBUTES[1]!, 5, 7, '0 2 3').error).toBeNull();
  });

  it.each([-0.1, 10.1])('rejects a level outside the attribute range: %s', (value) => {
    expect(generatePerLevelValues({}, { ...ATTRIBUTES[0]!, minValue: 0, maxValue: 10 }, 5, 7, `0 ${value} 10`))
      .toEqual({ levelValues: null, error: 'Lv6 的数值超出属性范围。' });
  });

  it('preserves exact backend cell paths for expansion and highlighting', () => {
    const error = new ApiRequestError('角色属性值不合法', 400, '400.ATTRIBUTE_VALUE_INVALID', {
      fieldIssues: [
        { field: '/levelValues/3/armor', code: 'INTEGER_REQUIRED', message: '该属性只允许整数' }
      ]
    });
    expect(characterFieldIssues(error)).toEqual([
      { field: '/levelValues/3/armor', code: 'INTEGER_REQUIRED', message: '该属性只允许整数' }
    ]);
  });
});
