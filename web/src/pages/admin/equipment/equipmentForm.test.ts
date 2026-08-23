import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../../services/apiClient';
import type { Attribute } from '../../../types/attribute';
import {
  equipmentFieldIssues,
  isEquipmentAttributeConfigured,
  normalizeEquipmentAttributeValues,
  removeEquipmentAttribute,
  validateEquipmentDraft
} from './equipmentForm';

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

describe('equipment form and direct attribute map', () => {
  it('validates stable keys and required names', () => {
    expect(validateEquipmentDraft({ equipmentKey: 'LongSword', name: '', description: '' }, true)).toEqual({
      equipmentKey: '小写字母开头，只能包含小写字母、数字和下划线',
      name: '装备名称不能为空'
    });
    expect(validateEquipmentDraft({ equipmentKey: 'long_sword', name: '长剑', description: '' }, true)).toEqual({});
  });

  it('keeps only current configured attributes and preserves explicit zero', () => {
    const values = normalizeEquipmentAttributeValues(ATTRIBUTES, { hp: 100, armor: 0, old: 8 });
    expect(values).toEqual({ hp: 100, armor: 0 });
    expect(isEquipmentAttributeConfigured(values, 'armor')).toBe(true);
    expect(removeEquipmentAttribute(values, 'hp')).toEqual({ armor: 0 });
  });

  it('preserves backend attribute paths for row errors', () => {
    const error = new ApiRequestError('装备属性值不合法', 400, '400.ATTRIBUTE_VALUE_INVALID', {
      fieldIssues: [
        { field: '/attributeValues/armor', code: 'INTEGER_REQUIRED', message: '该属性只允许整数' }
      ]
    });
    expect(equipmentFieldIssues(error)).toEqual([
      { field: '/attributeValues/armor', code: 'INTEGER_REQUIRED', message: '该属性只允许整数' }
    ]);
  });
});
