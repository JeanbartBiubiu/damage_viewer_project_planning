import { describe, expect, it } from 'vitest';
import {
  AUTHORING_CANNOT_LOCATE,
  AUTHORING_UNSUPPORTED_ANCHOR,
  authoringLocateMessage,
  formulaNodePathFromResolved,
  isSupportedAuthoringField,
  keyedChildKey,
  keyedChildren,
  lastFieldName,
  shouldDegradeUnsupportedAnchor
} from './authoringFocus';
import type { AuthoringLocationSegment } from '../../../types/authoringLocation';

describe('authoring focus helpers', () => {
  it('extracts keyed children and the last field without reading old indexes', () => {
    const segments: AuthoringLocationSegment[] = [
      { kind: 'KEYED_CHILD', collection: 'results', keyField: 'resultKey', key: 'damage' },
      { kind: 'EXPECT_VALUE', field: 'resultType', value: 'DAMAGE' },
      { kind: 'FIELD', field: 'detail' },
      { kind: 'FIELD', field: 'attributeKey' }
    ];
    expect(keyedChildren(segments)).toEqual([{ collection: 'results', key: 'damage' }]);
    expect(keyedChildKey(segments, 'results')).toBe('damage');
    expect(keyedChildKey(segments, 'steps')).toBeUndefined();
    expect(lastFieldName(segments)).toBe('attributeKey');
  });

  it('maps formula slots onto the existing tree editor path', () => {
    expect(formulaNodePathFromResolved(['expression', 'operands', 1, 'parameterKey'])).toBe('expression.operands[1]');
  });

  it('keeps unknown controls as an explicit degrade instead of pretending they were focused', () => {
    expect(isSupportedAuthoringField('EFFECT', 'inventedControl')).toBe(false);
    expect(shouldDegradeUnsupportedAnchor('EFFECT', [{ kind: 'FIELD', field: 'inventedControl' }], 'FIELD')).toBe(true);
    expect(authoringLocateMessage({
      originalFieldPath: 'results[0].inventedControl',
      unsupportedAnchor: true
    })).toContain(AUTHORING_CANNOT_LOCATE);
    expect(authoringLocateMessage({
      originalFieldPath: 'results[0].inventedControl',
      unsupportedAnchor: true
    })).toContain(AUTHORING_UNSUPPORTED_ANCHOR);
  });
});
