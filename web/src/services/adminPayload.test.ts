import { describe, expect, it } from 'vitest';
import {
  AdminPayloadError,
  assertExactlyOneEffectDetail,
  sanitizeAdminPayload
} from './adminPayload';

describe('sanitizeAdminPayload', () => {
  it('strips forbidden keys in camelCase and snake_case', () => {
    const result = sanitizeAdminPayload({
      attrKey: 'atk',
      changeRevision: 9,
      change_revision: 8,
      currentRevision: 3,
      current_revision: 2,
      publishedRevision: 1,
      published_revision: 0,
      versionId: 10,
      version_id: 11,
      versionCode: 'v1',
      version_code: 'v2',
      startVersionId: 1,
      start_version_id: 2,
      endVersionId: 3,
      end_version_id: 4,
      isCurrent: true,
      is_current: false,
      dataHash: 'abc',
      data_hash: 'def',
      updatedAt: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      valueKind: 'flat'
    });

    expect(result).toEqual({
      attrKey: 'atk',
      valueKind: 'flat'
    });
  });

  it('strips forbidden keys recursively in nested objects and arrays', () => {
    const result = sanitizeAdminPayload({
      sequenceId: 'seq-1',
      changeRevision: 1,
      steps: [
        {
          stepOrder: 1,
          currentRevision: 5,
          nested: {
            updatedAt: 'x',
            keep: true
          }
        }
      ],
      meta: {
        published_revision: 2,
        label: 'ok'
      }
    });

    expect(result).toEqual({
      sequenceId: 'seq-1',
      steps: [
        {
          stepOrder: 1,
          nested: {
            keep: true
          }
        }
      ],
      meta: {
        label: 'ok'
      }
    });
  });

  it('keeps expression objects as objects (never stringified)', () => {
    const expression = { op: 'add', args: [{ ref: 'atk' }, { const: 1 }] };
    const result = sanitizeAdminPayload({
      formulaKey: 'dmg',
      expression,
      changeRevision: 1
    });

    expect(result).toEqual({
      formulaKey: 'dmg',
      expression
    });
    expect(typeof result.expression).toBe('object');
    expect(result.expression).not.toBeNull();
  });
});

describe('assertExactlyOneEffectDetail', () => {
  it('rejects zero detail keys', () => {
    expect(() =>
      assertExactlyOneEffectDetail({
        sequenceId: 'seq',
        stepOrder: 1,
        operationTypeId: 1,
        targetSelectorTypeId: 1
      })
    ).toThrow(AdminPayloadError);

    try {
      assertExactlyOneEffectDetail({
        sequenceId: 'seq',
        stepOrder: 1,
        operationTypeId: 1,
        targetSelectorTypeId: 1
      });
    } catch (error) {
      expect(error).toMatchObject({
        name: 'AdminPayloadError',
        path: 'detail'
      });
      expect((error as Error).message).toContain('found 0');
    }
  });

  it('rejects multiple detail keys', () => {
    expect(() =>
      assertExactlyOneEffectDetail({
        damageDetail: { amountFormulaKey: 'a', damageTypeId: 1, valuePolicyTypeId: 1 },
        healDetail: { amountFormulaKey: 'b', valuePolicyTypeId: 1 }
      })
    ).toThrow(AdminPayloadError);

    try {
      assertExactlyOneEffectDetail({
        damageDetail: { amountFormulaKey: 'a', damageTypeId: 1, valuePolicyTypeId: 1 },
        healDetail: { amountFormulaKey: 'b', valuePolicyTypeId: 1 }
      });
    } catch (error) {
      expect((error as Error).message).toContain('found 2');
      expect((error as Error).message).toContain('damageDetail');
      expect((error as Error).message).toContain('healDetail');
    }
  });

  it('accepts exactly one detail key and returns it', () => {
    const key = assertExactlyOneEffectDetail({
      sequenceId: 'seq',
      stepOrder: 1,
      operationTypeId: 1,
      targetSelectorTypeId: 1,
      damageDetail: { amountFormulaKey: 'a', damageTypeId: 1, valuePolicyTypeId: 1 }
    });
    expect(key).toBe('damageDetail');
  });
});
