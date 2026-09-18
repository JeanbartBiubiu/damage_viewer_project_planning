import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../../services/apiClient';
import type { GameStatus } from '../../../types/status';
import {
  STATUS_KEY_PATTERN,
  buildCreateStatusRequest,
  buildUpdateStatusRequest,
  createEmptyStatusDraft,
  mapStatusFieldIssues,
  statusToDraft,
  validateStatusDraft,
  type StatusDraft
} from './statusForm';

const STATUS: GameStatus = {
  gameId: 'demo',
  statusKind: 'STUN',
  statusKey: 'stun',
  name: '眩晕',
  description: null,
  status: 'DISABLED',
  sortOrder: 10,
  createdAt: '2026-08-27T00:00:00Z',
  updatedAt: '2026-08-27T00:00:00Z'
};

function validDraft(overrides: Partial<StatusDraft> = {}): StatusDraft {
  return {
    statusKind: 'STUN',
    statusKey: 'stun',
    name: '眩晕',
    description: '',
    sortOrder: '10',
    ...overrides
  };
}

describe('status form defaults and conversion', () => {
  it('creates the stable empty draft defaults', () => {
    expect(createEmptyStatusDraft()).toEqual({
      statusKind: '',
      statusKey: '',
      name: '',
      description: '',
      sortOrder: '0'
    });
  });

  it('converts a GameStatus into an editable draft without exposing status', () => {
    expect(statusToDraft(STATUS)).toEqual({
      statusKind: 'STUN',
      statusKey: 'stun',
      name: '眩晕',
      description: '',
      sortOrder: '10'
    });
  });
});

describe('status form normalization', () => {
  it('trims text, parses sort order and turns a blank description into null', () => {
    const result = validateStatusDraft(
      validDraft({
        statusKey: '  stun  ',
        name: '  眩晕  ',
        description: '   ',
        sortOrder: ' 10 '
      }),
      true
    );

    expect(result).toEqual({
      ok: true,
      normalized: {
        statusKind: 'STUN',
        statusKey: 'stun',
        name: '眩晕',
        description: null,
        sortOrder: 10
      }
    });
  });

  it('defaults create payload status to ENABLED and keeps sortOrder 0', () => {
    const result = validateStatusDraft(
      {
        statusKind: 'MOVEMENT_SLOW',
        statusKey: 'slow',
        name: '减速',
        description: '',
        sortOrder: '0'
      },
      true
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('expected valid draft');
    }
    expect(buildCreateStatusRequest(result.normalized)).toEqual({
      statusKind: 'MOVEMENT_SLOW',
      statusKey: 'slow',
      name: '减速',
      description: null,
      status: 'ENABLED',
      sortOrder: 0
    });
  });

  it('builds an update body without statusKey and preserves the current record status', () => {
    const result = validateStatusDraft(validDraft(), false);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('expected valid draft');
    }
    expect(buildUpdateStatusRequest(result.normalized, STATUS.status)).toEqual({
      statusKind: 'STUN',
      name: '眩晕',
      description: null,
      status: 'DISABLED',
      sortOrder: 10
    });
    expect(buildUpdateStatusRequest(result.normalized, STATUS.status)).not.toHaveProperty('statusKey');
  });
});

describe('status form validation', () => {
  it('新增必须显式选择种类，修改和启停请求保留原种类', () => {
    expect(validateStatusDraft(validDraft({ statusKind: '' }), true).ok).toBe(false);
    for (const statusKind of ['STUN', 'MOVEMENT_SLOW'] as const) {
      const validation = validateStatusDraft(statusToDraft({ ...STATUS, statusKind }), false);
      if (!validation.ok) throw new Error('expected valid status');
      expect(buildUpdateStatusRequest(validation.normalized, 'DISABLED').statusKind).toBe(statusKind);
    }
    expect(mapStatusFieldIssues({ fieldIssues: [{ field: 'statusKind', message: '状态种类不可更改' }] }))
      .toMatchObject({ fieldErrors: { statusKind: '状态种类不可更改' } });
  });
  it('accepts only the frozen lowercase stable-key grammar on create', () => {
    expect(STATUS_KEY_PATTERN.test('stun')).toBe(true);
    expect(STATUS_KEY_PATTERN.test('s')).toBe(true);
    expect(STATUS_KEY_PATTERN.test('Stun')).toBe(false);
    expect(STATUS_KEY_PATTERN.test('2stun')).toBe(false);
    expect(STATUS_KEY_PATTERN.test('stun-cc')).toBe(false);

    const invalid = validateStatusDraft(validDraft({ statusKey: 'Stun-CC' }), true);
    expect(invalid.ok).toBe(false);
    if (invalid.ok) {
      throw new Error('expected invalid draft');
    }
    expect(invalid.fieldErrors.statusKey).toBeDefined();

    const skippedOnEdit = validateStatusDraft(validDraft({ statusKey: 'Stun-CC' }), false);
    expect(skippedOnEdit.ok).toBe(true);
  });

  it('rejects empty name, overlong description and negative sort order', () => {
    const result = validateStatusDraft(
      validDraft({
        statusKey: 'Stun-CC',
        name: ' ',
        description: 'x'.repeat(2001),
        sortOrder: '-1'
      }),
      true
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected invalid draft');
    }
    expect(Object.keys(result.fieldErrors).sort()).toEqual([
      'description',
      'name',
      'sortOrder',
      'statusKey'
    ]);
    expect(result.fieldErrors.name).toBe('状态名称不能为空');
    expect(result.fieldErrors.description).toBe('说明不能超过2000个字符');
    expect(result.fieldErrors.sortOrder).toBe('排序必须是大于等于0的整数');
  });
});

describe('status API field issue mapping', () => {
  it('maps statusKey, name, description and sortOrder and surfaces other messages', () => {
    const error = new ApiRequestError('状态信息不合法', 400, '400.VALIDATION_FAILED', {
      fieldIssues: [
        { field: 'statusKey', code: 'FORMAT_INVALID', message: ' 状态标识不合法 ' },
        { field: 'name', code: 'LENGTH_INVALID', message: '状态名称不能超过 100 个字符' },
        { field: 'description', code: 'LENGTH_INVALID', message: '说明过长' },
        { field: 'sortOrder', code: 'RANGE_INVALID', message: '排序必须大于等于 0' },
        { field: 'gameId', code: 'NOT_FOUND', message: '游戏不存在' }
      ]
    });

    expect(mapStatusFieldIssues(error)).toEqual({
      fieldErrors: {
        statusKey: '状态标识不合法',
        name: '状态名称不能超过 100 个字符',
        description: '说明过长',
        sortOrder: '排序必须大于等于 0'
      },
      unmappedMessages: ['游戏不存在']
    });
  });

  it('ignores malformed details and supplies a stable fallback for an empty issue message', () => {
    expect(mapStatusFieldIssues(null)).toEqual({
      fieldErrors: {},
      unmappedMessages: []
    });
    expect(
      mapStatusFieldIssues({
        fieldIssues: [null, { field: 'name', code: 'INVALID', message: '   ' }]
      })
    ).toEqual({
      fieldErrors: { name: '字段值不合法。' },
      unmappedMessages: []
    });
  });
});
