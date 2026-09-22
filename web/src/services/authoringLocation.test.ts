import { describe, expect, it } from 'vitest';
import { parseAuthoringLocation } from './authoringLocation';
import type { AuthoringLocation } from '../types/authoringLocation';

const location: AuthoringLocation = {
  skillKey: 'q', objectType: 'EFFECT', objectKey: 'hit', fieldPath: 'results[0].detail.attributeKey',
  editor: 'EFFECT', precision: 'FIELD', degradeReason: null, formulaSnapshot: null,
  segments: [
    { kind: 'KEYED_CHILD', collection: 'results', keyField: 'resultKey', key: 'damage' },
    { kind: 'EXPECT_VALUE', field: 'resultType', value: 'DAMAGE' },
    { kind: 'FIELD', field: 'detail' }, { kind: 'FIELD', field: 'attributeKey' }
  ]
};

describe('authoring location response contract', () => {
  it('retains original display path and structured identities without interpreting its index', () => {
    expect(parseAuthoringLocation(location, location)).toEqual(location);
  });
  it.each(['skillKey', 'objectType', 'objectKey', 'fieldPath'] as const)('rejects mismatched %s instead of opening a different object', key => {
    expect(() => parseAuthoringLocation({ ...location, [key]: 'other' }, location)).toThrow('定位信息不完整');
  });
  it('rejects absent location, unknown fields and malformed segments rather than falling back to fieldPath', () => {
    for (const value of [undefined, null, {}, { ...location, segments: null },
      { ...location, legacyIndex: 0 }, { ...location, segments: [{ kind: 'INDEX', index: 0 }] },
      { ...location, segments: [{ kind: 'FIELD', field: 'detail.attributeKey' }] },
      { ...location, segments: [{ kind: 'FIELD', field: '__proto__' }] },
      { ...location, segments: [{ kind: 'KEYED_CHILD', collection: 'results', keyField: 'name', key: 'damage' }] },
      { ...location, segments: [{ kind: 'KEYED_CHILD', collection: 'results', keyField: 'resultKey', key: '' }] },
      { ...location, segments: [{ kind: 'VALUE_CHILD', collection: 'results', value: 'damage' }] },
      { ...location, segments: [{ kind: 'EXPECT_VALUE', field: 'resultType', value: {} }] },
      { ...location, segments: [{ kind: 'FIELD', field: 'name', index: 1 }] }
    ]) expect(() => parseAuthoringLocation(value, location)).toThrow('定位信息不完整');
  });
  it('keeps diagnosed corrupt objects reportable with an explicit object fallback', () => {
    const fallback = { ...location, precision: 'OBJECT', degradeReason: 'CORRUPT_OBJECT', segments: [] };
    expect(parseAuthoringLocation(fallback, location)).toEqual(fallback);
    expect(parseAuthoringLocation({ ...fallback, precision: 'NONE', editor: null }, location).precision).toBe('NONE');
  });
  it('rejects contradictory precision and editor/reason pairs', () => {
    for (const patch of [
      { editor: null }, { precision: 'NONE' }, { precision: 'OBJECT', degradeReason: null },
      { degradeReason: 'TYPE_CHANGED' }, { precision: 'NEAREST_EDITOR' },
      { precision: 'OBJECT', degradeReason: 'invented' }
    ]) expect(() => parseAuthoringLocation({ ...location, ...patch }, location)).toThrow('定位信息不完整');
  });
  it('allows structural formula slots only with their full expression snapshot', () => {
    const formula = { ...location, editor: 'FORMULA', objectType: 'FORMULA',
      formulaSnapshot: { nodeType: 'PARAMETER', parameterKey: 'value' },
      segments: [{ kind: 'FORMULA_OPERAND', operand: 0 }] };
    expect(parseAuthoringLocation(formula, formula).segments).toEqual(formula.segments);
    for (const patch of [
      { formulaSnapshot: null }, { formulaSnapshot: [] }, { editor: 'EFFECT' },
      { segments: [{ kind: 'FORMULA_OPERAND', operand: 2 }] }
    ]) expect(() => parseAuthoringLocation({ ...formula, ...patch }, formula)).toThrow('定位信息不完整');
  });
});
