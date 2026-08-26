import { describe, expect, it } from 'vitest';
import { validateDamageTypeDraft } from './damageTypeForm';

describe('damageTypeForm', () => {
  it('accepts a normalized editable draft', () => {
    expect(validateDamageTypeDraft({
      damageTypeKey: 'physical',
      name: '物理伤害',
      description: '',
      sortOrder: '10'
    }, true)).toEqual({});
  });

  it('locates invalid key, name, description and sort order', () => {
    expect(validateDamageTypeDraft({
      damageTypeKey: 'Physical-Damage',
      name: ' ',
      description: 'x'.repeat(2001),
      sortOrder: '1.5'
    }, true)).toMatchObject({
      damageTypeKey: expect.any(String),
      name: expect.any(String),
      description: expect.any(String),
      sortOrder: expect.any(String)
    });
  });
});
