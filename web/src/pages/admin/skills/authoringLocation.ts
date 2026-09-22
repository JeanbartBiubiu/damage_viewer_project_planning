import { isLocationObject } from '../../../services/authoringLocation';
import type {
  AuthoringLocation, AuthoringLocationPrecision, AuthoringLocationReason, AuthoringLocationSegment
} from '../../../types/authoringLocation';

export type ResolvedAuthoringLocation = {
  precision: AuthoringLocationPrecision;
  reason: AuthoringLocationReason | null;
  /** 当前详情里的路径，只由成功匹配的结构段产生，不读取原 fieldPath 下标。 */
  path: (string | number)[];
  matchedSegments: AuthoringLocationSegment[];
  originalFieldPath: string;
  reportChanged: boolean;
};

function has(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/** 比较保存表达式，而不是编辑草稿的 left/right；对象属性次序不改变语义。 */
export function sameAuthoringJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => sameAuthoringJson(value, right[index]));
  }
  if (!isLocationObject(left) || !isLocationObject(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => has(right, key) && sameAuthoringJson(left[key], right[key]));
}

/** 纯读取。成功定位也不代表 UI 已有对应锚点；消费页面须再核对实际控件。 */
export function resolveAuthoringLocation(location: AuthoringLocation, detail: unknown): ResolvedAuthoringLocation {
  const path: (string | number)[] = [];
  const matchedSegments: AuthoringLocationSegment[] = [];
  const result = (precision: AuthoringLocationPrecision, reason: AuthoringLocationReason | null, reportChanged = false): ResolvedAuthoringLocation => ({
    precision, reason, path: [...path], matchedSegments: [...matchedSegments], originalFieldPath: location.fieldPath, reportChanged
  });
  if (location.precision === 'NONE') return result('NONE', location.degradeReason);
  if (!isLocationObject(detail)) return result('OBJECT', 'OBJECT_MISSING');
  if (location.formulaSnapshot !== null && !sameAuthoringJson(location.formulaSnapshot, detail.expression)) {
    return result('OBJECT', 'TYPE_CHANGED', true);
  }
  if (location.precision !== 'FIELD') return result('OBJECT', location.degradeReason);
  let current: unknown = detail;
  for (const segment of location.segments) {
    if (!isLocationObject(current)) return result('OBJECT', 'NODE_MISSING');
    switch (segment.kind) {
      case 'EXPECT_VALUE':
        if (!has(current, segment.field) || current[segment.field] !== segment.value) return result('OBJECT', 'TYPE_CHANGED');
        break;
      case 'FIELD':
        if (!has(current, segment.field)) return result('OBJECT', 'UNKNOWN_FIELD');
        current = current[segment.field];
        path.push(segment.field);
        break;
      case 'KEYED_CHILD': {
        const children = current[segment.collection];
        if (!Array.isArray(children)) return result('OBJECT', 'NODE_MISSING');
        const matches = children.map((child, index) => ({ child, index }))
          .filter(({ child }) => isLocationObject(child) && has(child, segment.keyField) && child[segment.keyField] === segment.key);
        if (matches.length !== 1) return result('OBJECT', matches.length ? 'DUPLICATE_KEY' : 'MISSING_KEY');
        const match = matches[0];
        path.push(segment.collection, match.index);
        current = match.child;
        break;
      }
      case 'VALUE_CHILD': {
        const children = current[segment.collection];
        if (!Array.isArray(children)) return result('OBJECT', 'NODE_MISSING');
        const indexes = children.flatMap((value, index) => value === segment.value ? [index] : []);
        if (indexes.length !== 1) return result('OBJECT', indexes.length ? 'DUPLICATE_KEY' : 'MISSING_KEY');
        path.push(segment.collection, indexes[0]);
        current = children[indexes[0]];
        break;
      }
      case 'FORMULA_OPERAND': {
        if (current.nodeType !== 'OPERATION' || !Array.isArray(current.operands) || current.operands.length !== 2) return result('OBJECT', 'TYPE_CHANGED');
        current = current.operands[segment.operand];
        path.push('operands', segment.operand);
        break;
      }
    }
    matchedSegments.push(segment);
  }
  return result('FIELD', null);
}
