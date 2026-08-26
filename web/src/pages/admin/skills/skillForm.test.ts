import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../../services/apiClient';
import type { Skill } from '../../../types/skill';
import {
  SKILL_KEY_PATTERN,
  buildCreateSkillRequest,
  buildUpdateSkillRequest,
  createEmptySkillDraft,
  mapSkillFieldIssues,
  skillToDraft,
  validateSkillDraft,
  type SkillDraft
} from './skillForm';

const SKILL: Skill = {
  gameId: 'demo',
  skillKey: 'ezreal_q',
  name: '秘术射击',
  description: null,
  maxLevel: 5,
  status: 'ENABLED',
  sortOrder: 10,
  skillCategoryKeys: ['active', 'single_target'],
  createdAt: '2026-08-26T00:00:00Z',
  updatedAt: '2026-08-26T00:00:00Z'
};

function validDraft(overrides: Partial<SkillDraft> = {}): SkillDraft {
  return {
    skillKey: 'ezreal_q',
    name: '秘术射击',
    description: '',
    maxLevel: '5',
    status: 'ENABLED',
    sortOrder: '10',
    skillCategoryKeys: ['active', 'single_target'],
    ...overrides
  };
}

describe('skill form defaults and conversion', () => {
  it('creates the stable empty draft defaults', () => {
    expect(createEmptySkillDraft()).toEqual({
      skillKey: '',
      name: '',
      description: '',
      maxLevel: '1',
      status: 'ENABLED',
      sortOrder: '0',
      skillCategoryKeys: []
    });
  });

  it('converts a Skill into an editable draft', () => {
    const draft = skillToDraft(SKILL);
    expect(draft).toEqual({
      skillKey: 'ezreal_q',
      name: '秘术射击',
      description: '',
      maxLevel: '5',
      status: 'ENABLED',
      sortOrder: '10',
      skillCategoryKeys: ['active', 'single_target']
    });
    draft.skillCategoryKeys.push('extra');
    expect(SKILL.skillCategoryKeys).toEqual(['active', 'single_target']);
  });
});

describe('skill form normalization and request shapes', () => {
  it('trims text and category keys, parses integers and turns a blank description into null', () => {
    const result = validateSkillDraft(
      validDraft({
        skillKey: '  ezreal_q  ',
        name: '  秘术射击  ',
        description: '   ',
        maxLevel: ' 5 ',
        sortOrder: ' 10 ',
        skillCategoryKeys: ['  active  ', 'single_target']
      }),
      true
    );

    expect(result).toEqual({
      ok: true,
      normalized: {
        skillKey: 'ezreal_q',
        name: '秘术射击',
        description: null,
        maxLevel: 5,
        status: 'ENABLED',
        sortOrder: 10,
        skillCategoryKeys: ['active', 'single_target']
      }
    });
  });

  it('preserves category order when building create and update bodies', () => {
    const validated = validateSkillDraft(
      validDraft({ skillCategoryKeys: ['single_target', 'active'] }),
      true
    );
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      throw new Error('expected valid draft');
    }

    expect(buildCreateSkillRequest(validated.normalized)).toEqual({
      skillKey: 'ezreal_q',
      name: '秘术射击',
      description: null,
      maxLevel: 5,
      status: 'ENABLED',
      sortOrder: 10,
      skillCategoryKeys: ['single_target', 'active']
    });
    expect(buildUpdateSkillRequest(validated.normalized)).toEqual({
      name: '秘术射击',
      description: null,
      maxLevel: 5,
      status: 'ENABLED',
      sortOrder: 10,
      skillCategoryKeys: ['single_target', 'active']
    });
    expect(buildUpdateSkillRequest(validated.normalized)).not.toHaveProperty('skillKey');
  });

  it('accepts an empty category array', () => {
    const result = validateSkillDraft(validDraft({ skillCategoryKeys: [] }), true);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('expected valid draft');
    }
    expect(result.normalized.skillCategoryKeys).toEqual([]);
  });
});

describe('skill form validation', () => {
  it('accepts only the frozen lowercase stable-key grammar on create', () => {
    expect(SKILL_KEY_PATTERN.test('ezreal_q')).toBe(true);
    expect(SKILL_KEY_PATTERN.test('q')).toBe(true);
    expect(SKILL_KEY_PATTERN.test('EzrealQ')).toBe(false);
    expect(SKILL_KEY_PATTERN.test('2_skill')).toBe(false);
    expect(SKILL_KEY_PATTERN.test('ezreal-q')).toBe(false);

    const invalid = validateSkillDraft(validDraft({ skillKey: 'Ezreal-Q' }), true);
    expect(invalid.ok).toBe(false);
    if (invalid.ok) {
      throw new Error('expected invalid draft');
    }
    expect(invalid.fieldErrors.skillKey).toBeDefined();

    const skippedOnEdit = validateSkillDraft(validDraft({ skillKey: 'Ezreal-Q' }), false);
    expect(skippedOnEdit.ok).toBe(true);
  });

  it('locates integer, range, length and status problems on their form fields', () => {
    const result = validateSkillDraft(
      validDraft({
        skillKey: 'Ezreal-Q',
        name: 'x'.repeat(101),
        description: 'x'.repeat(2001),
        maxLevel: '0',
        status: 'REMOVED' as SkillDraft['status'],
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
      'maxLevel',
      'name',
      'skillKey',
      'sortOrder',
      'status'
    ]);
  });

  it('rejects empty, non-integer and out-of-range maxLevel and sortOrder', () => {
    expect(validateSkillDraft(validDraft({ maxLevel: ' ' }), true)).toEqual({
      ok: false,
      fieldErrors: { maxLevel: '最高等级不能为空。' }
    });
    expect(validateSkillDraft(validDraft({ maxLevel: '1.5' }), true)).toEqual({
      ok: false,
      fieldErrors: { maxLevel: '最高等级必须是大于等于 1 的整数。' }
    });
    expect(validateSkillDraft(validDraft({ maxLevel: '0' }), true)).toEqual({
      ok: false,
      fieldErrors: { maxLevel: '最高等级必须是大于等于 1 的整数。' }
    });
    expect(validateSkillDraft(validDraft({ sortOrder: '' }), true)).toEqual({
      ok: false,
      fieldErrors: { sortOrder: '排序不能为空。' }
    });
    expect(validateSkillDraft(validDraft({ sortOrder: '1.5' }), true)).toEqual({
      ok: false,
      fieldErrors: { sortOrder: '排序必须是大于等于 0 的整数。' }
    });
    expect(validateSkillDraft(validDraft({ maxLevel: '1', sortOrder: '0' }), true).ok).toBe(true);
  });

  it('rejects blank and duplicate category keys without throwing', () => {
    expect(validateSkillDraft(validDraft({ skillCategoryKeys: ['active', '  '] }), true)).toEqual({
      ok: false,
      fieldErrors: { skillCategoryKeys: '技能分类不能包含空项。' }
    });
    expect(validateSkillDraft(
      validDraft({ skillCategoryKeys: ['active', ' active '] }),
      true
    )).toEqual({
      ok: false,
      fieldErrors: { skillCategoryKeys: '技能分类不能重复。' }
    });
  });
});

describe('skill API field issue mapping', () => {
  it('maps known fields, indexed category paths and unknown messages separately', () => {
    const error = new ApiRequestError('技能分类不合法', 400, '400.UNKNOWN_SKILL_CATEGORY', {
      fieldIssues: [
        { field: 'name', code: 'LENGTH_INVALID', message: ' 技能名称不能超过 100 个字符 ' },
        { field: 'skillCategoryKeys', code: 'DUPLICATE', message: '技能分类不能重复' },
        { field: '/skillCategoryKeys/1', code: 'UNKNOWN_SKILL_CATEGORY', message: '未知技能分类' },
        { field: '/skillCategoryKeys/0', code: 'FORMAT_INVALID', message: '分类标识不合法' },
        { field: 'gameId', code: 'NOT_FOUND', message: '游戏不存在' }
      ]
    });

    expect(mapSkillFieldIssues(error)).toEqual({
      fieldErrors: {
        name: '技能名称不能超过 100 个字符',
        skillCategoryKeys: '技能分类不能重复'
      },
      categoryIndexErrors: [
        { index: 1, message: '未知技能分类' },
        { index: 0, message: '分类标识不合法' }
      ],
      unmappedMessages: ['游戏不存在']
    });
  });

  it('preserves the exact backend category index for multi-select mapping', () => {
    expect(
      mapSkillFieldIssues({
        fieldIssues: [
          { field: '/skillCategoryKeys/2', code: 'UNKNOWN_SKILL_CATEGORY', message: '未知技能分类' }
        ]
      })
    ).toEqual({
      fieldErrors: {},
      categoryIndexErrors: [{ index: 2, message: '未知技能分类' }],
      unmappedMessages: []
    });
  });

  it('ignores malformed details and supplies a stable fallback for an empty issue message', () => {
    expect(mapSkillFieldIssues(null)).toEqual({
      fieldErrors: {},
      categoryIndexErrors: [],
      unmappedMessages: []
    });
    expect(
      mapSkillFieldIssues({
        fieldIssues: [null, { field: 'maxLevel', code: 'INVALID', message: '   ' }]
      })
    ).toEqual({
      fieldErrors: { maxLevel: '字段值不合法。' },
      categoryIndexErrors: [],
      unmappedMessages: []
    });
  });
});
