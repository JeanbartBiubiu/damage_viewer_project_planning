import { describe, expect, it } from 'vitest';
import type { AuthoringLocation, AuthoringLocationSegment } from '../../../types/authoringLocation';
import { resolveAuthoringLocation, sameAuthoringJson } from './authoringLocation';

function location(segments: AuthoringLocationSegment[], overrides: Partial<AuthoringLocation> = {}): AuthoringLocation {
  return { skillKey: 'q', objectType: 'EFFECT', objectKey: 'hit', editor: 'EFFECT',
    fieldPath: 'results[0].detail.attributeKey', precision: 'FIELD', degradeReason: null,
    formulaSnapshot: null, segments, ...overrides };
}

const damagePath: AuthoringLocationSegment[] = [
  { kind: 'KEYED_CHILD', collection: 'results', keyField: 'resultKey', key: 'damage' },
  { kind: 'EXPECT_VALUE', field: 'resultType', value: 'DAMAGE' },
  { kind: 'FIELD', field: 'detail' }, { kind: 'FIELD', field: 'attributeKey' }
];
const damage = { resultKey: 'damage', resultType: 'DAMAGE', sortOrder: 30, detail: { attributeKey: 'ad' } };
const healing = { resultKey: 'heal', resultType: 'DIRECT_HEAL', sortOrder: 0, detail: {} };

describe('authoring location resolution against fresh saved details', () => {
  it('finds the stable key after storage order changes, retaining old path only as explanation', () => {
    const result = resolveAuthoringLocation(location(damagePath), { results: [healing, damage] });
    expect(result.precision).toBe('FIELD');
    expect(result.path).toEqual(['results', 1, 'detail', 'attributeKey']);
    expect(result.originalFieldPath).toBe('results[0].detail.attributeKey');
  });
  it('does not pick a duplicate key or use the old index when the key vanished', () => {
    expect(resolveAuthoringLocation(location(damagePath), { results: [healing] }).reason).toBe('MISSING_KEY');
    const duplicate = resolveAuthoringLocation(location(damagePath), { results: [damage, damage] });
    expect(duplicate).toMatchObject({ precision: 'OBJECT', reason: 'DUPLICATE_KEY', path: [] });
  });
  it('stops before entering detail when the same result key changed type', () => {
    const changed = { ...damage, resultType: 'NORMAL_SHIELD' };
    expect(resolveAuthoringLocation(location(damagePath), { results: [changed] })).toMatchObject({
      precision: 'OBJECT', reason: 'TYPE_CHANGED', path: ['results', 0]
    });
  });
  it('checks the parent reference so a reused result key in another effect is not selected', () => {
    const segments: AuthoringLocationSegment[] = [
      { kind: 'FIELD', field: 'eventSource' }, { kind: 'EXPECT_VALUE', field: 'eventType', value: 'RESULT_AVAILABLE' },
      { kind: 'FIELD', field: 'detail' }, { kind: 'EXPECT_VALUE', field: 'effectKey', value: 'first' },
      { kind: 'FIELD', field: 'resultKey' }
    ];
    expect(resolveAuthoringLocation(location(segments), {
      eventSource: { eventType: 'RESULT_AVAILABLE', detail: { effectKey: 'second', resultKey: 'damage' } }
    })).toMatchObject({ precision: 'OBJECT', reason: 'TYPE_CHANGED', path: ['eventSource', 'detail'] });
  });
  it('walks nested groups, conditions and bindings by their own keys', () => {
    const segments: AuthoringLocationSegment[] = [
      { kind: 'KEYED_CHILD', collection: 'actions', keyField: 'actionKey', key: 'apply' },
      { kind: 'KEYED_CHILD', collection: 'runtimeInputBindings', keyField: 'bindingKey', key: 'strength' },
      { kind: 'EXPECT_VALUE', field: 'sourceType', value: 'EVENT_VALUE' },
      { kind: 'FIELD', field: 'source' }
    ];
    expect(resolveAuthoringLocation(location(segments), { actions: [
      { actionKey: 'other' }, { actionKey: 'apply', runtimeInputBindings: [
        { bindingKey: 'unused' }, { bindingKey: 'strength', sourceType: 'EVENT_VALUE', source: { eventValueKey: 'HIT_INDEX' } }
      ] }
    ] }).path).toEqual(['actions', 1, 'runtimeInputBindings', 1, 'source']);
  });
  it.each([
    ['vampOverrides', 'vampType', 'OMNIVAMP'], ['resultModifiers', 'resultKey', 'damage'],
    ['options', 'optionKey', 'ready'], ['conditions', 'conditionKey', 'first']
  ])('resolves %s by its declared identity after reordering', (collection, keyField, key) => {
    const result = resolveAuthoringLocation(location([{ kind: 'KEYED_CHILD', collection, keyField, key }]), {
      [collection]: [{ [keyField]: 'other' }, { [keyField]: key }]
    });
    expect(result).toMatchObject({ precision: 'FIELD', path: [collection, 1] });
  });
  it('uses unique string identity for affected skills and refuses duplicates', () => {
    const valueLocation = location([{ kind: 'VALUE_CHILD', collection: 'skillKeys', value: 'w' }]);
    expect(resolveAuthoringLocation(valueLocation, { skillKeys: ['e', 'w', 'q'] }).path).toEqual(['skillKeys', 1]);
    expect(resolveAuthoringLocation(valueLocation, { skillKeys: ['w', 'w'] }).reason).toBe('DUPLICATE_KEY');
  });
  it('does not interpret a missing field as a default or another field', () => {
    expect(resolveAuthoringLocation(location(damagePath), { results: [{ ...damage, detail: {} }] }))
      .toMatchObject({ precision: 'OBJECT', reason: 'UNKNOWN_FIELD', path: ['results', 0, 'detail'] });
  });
  it('keeps zero, false and null as actual field values', () => {
    for (const value of [0, false, null]) {
      const focus = location([{ kind: 'EXPECT_VALUE', field: 'mode', value }, { kind: 'FIELD', field: 'value' }]);
      expect(resolveAuthoringLocation(focus, { mode: value, value })).toMatchObject({ precision: 'FIELD', path: ['value'] });
    }
  });
  it('preserves an explicit backend fallback and cannot upgrade it by reading old indexes', () => {
    const focus = location(damagePath, { precision: 'OBJECT', degradeReason: 'MISSING_KEY' });
    expect(resolveAuthoringLocation(focus, { results: [damage] })).toMatchObject({ precision: 'OBJECT', path: [], reason: 'MISSING_KEY' });
    expect(resolveAuthoringLocation(location(damagePath), null).reason).toBe('OBJECT_MISSING');
  });
  it('does not mutate fresh detail or the navigation request', () => {
    const focus = location(damagePath);
    const detail = { results: [healing, damage] };
    const before = JSON.stringify({ focus, detail });
    resolveAuthoringLocation(focus, detail);
    expect(JSON.stringify({ focus, detail })).toBe(before);
  });
});

describe('formula structural slots', () => {
  const left = { nodeType: 'PARAMETER', parameterKey: 'left' };
  const right = { nodeType: 'PARAMETER', parameterKey: 'right' };
  const expression = { nodeType: 'OPERATION', operation: 'ADD', operands: [left, right] };
  const focus = location([
    { kind: 'FIELD', field: 'expression' }, { kind: 'EXPECT_VALUE', field: 'nodeType', value: 'OPERATION' },
    { kind: 'FORMULA_OPERAND', operand: 1 }, { kind: 'EXPECT_VALUE', field: 'nodeType', value: 'PARAMETER' },
    { kind: 'FIELD', field: 'parameterKey' }
  ], { editor: 'FORMULA', objectType: 'FORMULA', formulaSnapshot: expression });

  it('uses the exact structural slot after comparing the whole expression, ignoring object key order', () => {
    const reorderedProperties = { operands: [{ parameterKey: 'left', nodeType: 'PARAMETER' }, right], operation: 'ADD', nodeType: 'OPERATION' };
    expect(resolveAuthoringLocation(focus, { expression: reorderedProperties }))
      .toMatchObject({ precision: 'FIELD', path: ['expression', 'operands', 1, 'parameterKey'] });
  });
  it('rejects same-type node swaps rather than finding a matching parameter elsewhere', () => {
    expect(resolveAuthoringLocation(focus, { expression: { ...expression, operands: [right, left] } }))
      .toMatchObject({ precision: 'OBJECT', reason: 'TYPE_CHANGED', reportChanged: true, path: [] });
  });
  it('keeps repeated equal nodes at their requested slot', () => {
    const repeated = { ...expression, operands: [left, left] };
    expect(resolveAuthoringLocation({ ...focus, formulaSnapshot: repeated }, { expression: repeated }).path)
      .toEqual(['expression', 'operands', 1, 'parameterKey']);
  });
  it('distinguishes arrays, absent fields and scalar types when comparing snapshots', () => {
    expect(sameAuthoringJson({ value: 0 }, { value: '0' })).toBe(false);
    expect(sameAuthoringJson({ value: null }, {})).toBe(false);
    expect(sameAuthoringJson([], {})).toBe(false);
    expect(sameAuthoringJson([1, 2], [2, 1])).toBe(false);
  });
});
