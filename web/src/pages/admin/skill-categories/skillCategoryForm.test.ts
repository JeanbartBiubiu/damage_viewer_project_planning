import { describe, expect, it } from 'vitest';
import { validateSkillCategoryDraft } from './skillCategoryForm';

describe('skillCategoryForm', () => {
  it('accepts a normalized editable draft', () => {
    expect(validateSkillCategoryDraft({
      skillCategoryKey: 'active',
      name: '主动技能',
      description: '',
      sortOrder: '10'
    }, true)).toEqual({});
  });

  it('locates invalid key, name, description and sort order', () => {
    expect(validateSkillCategoryDraft({
      skillCategoryKey: 'Active-Skill',
      name: ' ',
      description: 'x'.repeat(2001),
      sortOrder: '-1'
    }, true)).toMatchObject({
      skillCategoryKey: expect.any(String),
      name: expect.any(String),
      description: expect.any(String),
      sortOrder: expect.any(String)
    });
  });
});
