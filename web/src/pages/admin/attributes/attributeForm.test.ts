import { describe, expect, it } from 'vitest';
import type { Attribute } from '../../../types/attribute';
import {
  ATTRIBUTE_KEY_PATTERN,
  attributeToDraft,
  buildCreateAttributeRequest,
  buildUpdateAttributeRequest,
  createEmptyAttributeDraft,
  isAttributeDraftDirty,
  mapAttributeFieldIssues,
  validateAttributeDraft,
  type AttributeFormDraft
} from './attributeForm';

const ATTRIBUTE: Attribute = {
  gameId: 'demo',
  attributeKey: 'move_speed',
  name: '移动速度',
  valueType: 'DECIMAL',
  minValue: 0,
  maxValue: null,
  description: null,
  status: 'ENABLED',
  sortOrder: 100,
  createdAt: '2026-08-22T09:00:00Z',
  updatedAt: '2026-08-22T09:00:00Z'
};

function validDraft(overrides: Partial<AttributeFormDraft> = {}): AttributeFormDraft {
  return {
    attributeKey: 'move_speed',
    name: '移动速度',
    valueType: 'DECIMAL',
    minValue: '0',
    maxValue: '',
    description: '',
    status: 'ENABLED',
    sortOrder: '100',
    ...overrides
  };
}

describe('attribute form normalization', () => {
  it('creates the stable empty draft defaults', () => {
    expect(createEmptyAttributeDraft()).toEqual({
      attributeKey: '',
      name: '',
      valueType: 'DECIMAL',
      minValue: '',
      maxValue: '',
      description: '',
      status: 'ENABLED',
      sortOrder: '0'
    });
  });

  it('converts nullable response values to editable strings', () => {
    expect(attributeToDraft(ATTRIBUTE)).toEqual({
      attributeKey: 'move_speed',
      name: '移动速度',
      valueType: 'DECIMAL',
      minValue: '0',
      maxValue: '',
      description: '',
      status: 'ENABLED',
      sortOrder: '100'
    });
  });

  it('trims text, parses numbers and turns blank optional values into null', () => {
    const result = validateAttributeDraft(
      validDraft({
        attributeKey: '  move_speed  ',
        name: '  移动速度  ',
        minValue: ' 0 ',
        maxValue: '  900.5 ',
        description: '   ',
        sortOrder: ' 100 '
      }),
      'create'
    );

    expect(result).toEqual({
      ok: true,
      normalized: {
        attributeKey: 'move_speed',
        name: '移动速度',
        valueType: 'DECIMAL',
        minValue: 0,
        maxValue: 900.5,
        description: null,
        status: 'ENABLED',
        sortOrder: 100
      }
    });
  });

  it('builds create and update bodies while keeping the key immutable on update', () => {
    const validated = validateAttributeDraft(validDraft(), 'edit');
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      throw new Error('expected valid draft');
    }

    expect(buildCreateAttributeRequest(validated.normalized)).toEqual(validated.normalized);
    expect(buildUpdateAttributeRequest(validated.normalized)).toEqual({
      name: '移动速度',
      valueType: 'DECIMAL',
      minValue: 0,
      maxValue: null,
      description: null,
      status: 'ENABLED',
      sortOrder: 100
    });
    expect(buildUpdateAttributeRequest(validated.normalized)).not.toHaveProperty('attributeKey');
  });
});

describe('attribute form validation and dirty state', () => {
  it('accepts only the frozen lowercase stable-key grammar', () => {
    expect(ATTRIBUTE_KEY_PATTERN.test('move_speed')).toBe(true);
    expect(ATTRIBUTE_KEY_PATTERN.test('armor_pen_2')).toBe(true);
    expect(ATTRIBUTE_KEY_PATTERN.test('MoveSpeed')).toBe(false);
    expect(ATTRIBUTE_KEY_PATTERN.test('2_move_speed')).toBe(false);
    expect(ATTRIBUTE_KEY_PATTERN.test('move-speed')).toBe(false);
  });

  it('locates format, range and length problems on their form fields', () => {
    const result = validateAttributeDraft(
      validDraft({
        attributeKey: 'Move-Speed',
        name: 'x'.repeat(101),
        valueType: 'BOOLEAN' as AttributeFormDraft['valueType'],
        minValue: 'not-a-number',
        maxValue: 'also-not-a-number',
        description: 'x'.repeat(2001),
        status: 'REMOVED' as AttributeFormDraft['status'],
        sortOrder: '-1'
      }),
      'create'
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected invalid draft');
    }
    expect(Object.keys(result.fieldErrors).sort()).toEqual([
      'attributeKey',
      'description',
      'maxValue',
      'minValue',
      'name',
      'sortOrder',
      'status',
      'valueType'
    ]);
  });

  it('locates a reversed numeric range on maxValue', () => {
    const result = validateAttributeDraft(validDraft({ minValue: '10', maxValue: '9' }), 'edit');
    expect(result).toEqual({
      ok: false,
      fieldErrors: { maxValue: '最大值不能小于最小值。' }
    });
  });

  it('treats any changed draft field as unsaved and an identical copy as clean', () => {
    const baseline = validDraft();
    expect(isAttributeDraftDirty({ ...baseline }, baseline)).toBe(false);
    expect(isAttributeDraftDirty({ ...baseline, name: `${baseline.name} ` }, baseline)).toBe(true);
    expect(isAttributeDraftDirty({ ...baseline, status: 'DISABLED' }, baseline)).toBe(true);
  });
});

describe('attribute API field issue mapping', () => {
  it('maps known fields and leaves unknown issues for the form-level error area', () => {
    expect(
      mapAttributeFieldIssues({
        fieldIssues: [
          { field: 'maxValue', code: 'RANGE_INVALID', message: ' 最大值不能小于最小值 ' },
          { field: 'attributeKey', code: 'FORMAT_INVALID', message: '稳定标识格式不合法' },
          { field: 'gameId', code: 'NOT_FOUND', message: '游戏不存在' }
        ]
      })
    ).toEqual({
      fieldErrors: {
        maxValue: '最大值不能小于最小值',
        attributeKey: '稳定标识格式不合法'
      },
      unmappedMessages: ['游戏不存在']
    });
  });

  it('ignores malformed details and supplies a stable fallback for an empty issue message', () => {
    expect(mapAttributeFieldIssues(null)).toEqual({ fieldErrors: {}, unmappedMessages: [] });
    expect(
      mapAttributeFieldIssues({
        fieldIssues: [null, { field: 'name', code: 'INVALID', message: '   ' }]
      })
    ).toEqual({
      fieldErrors: { name: '字段值不合法。' },
      unmappedMessages: []
    });
  });
});
