import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../../services/apiClient';
import type { Attribute } from '../../../types/attribute';
import {
  characterFieldIssues,
  describeAttributeProgression,
  generateIncrementingLevelValues,
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
