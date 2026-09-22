import { ApiRequestError } from './apiClient';
import {
  AUTHORING_COLLECTION_KEYS, AUTHORING_EDITORS, AUTHORING_LOCATION_REASONS,
  type AuthoringLocation, type AuthoringLocationIdentity, type AuthoringLocationSegment
} from '../types/authoringLocation';

export function isLocationObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function own(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => own(value, key));
}

function field(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(value)
    && !['constructor', 'prototype', '__proto__'].includes(value);
}

const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const scalar = (value: unknown) => value === null || typeof value === 'string' || typeof value === 'boolean'
  || typeof value === 'number' && Number.isFinite(value);

function validSegment(value: unknown): value is AuthoringLocationSegment {
  if (!isLocationObject(value)) return false;
  switch (value.kind) {
    case 'FIELD':
      return exactKeys(value, ['kind', 'field']) && field(value.field);
    case 'KEYED_CHILD':
      return exactKeys(value, ['kind', 'collection', 'keyField', 'key'])
        && typeof value.collection === 'string'
        && own(AUTHORING_COLLECTION_KEYS, value.collection)
        && AUTHORING_COLLECTION_KEYS[value.collection as keyof typeof AUTHORING_COLLECTION_KEYS] === value.keyField
        && nonempty(value.key);
    case 'VALUE_CHILD':
      return exactKeys(value, ['kind', 'collection', 'value'])
        && (value.collection === 'skillKeys' || value.collection === 'skillCategoryKeys') && nonempty(value.value);
    case 'FORMULA_OPERAND':
      return exactKeys(value, ['kind', 'operand']) && (value.operand === 0 || value.operand === 1);
    case 'EXPECT_VALUE':
      return exactKeys(value, ['kind', 'field', 'value']) && field(value.field) && scalar(value.value);
    default:
      return false;
  }
}

/** 缺少新字段是契约错误，不能拿旧 fieldPath 下标作兼容导航。 */
export function parseAuthoringLocation(value: unknown, expected: AuthoringLocationIdentity): AuthoringLocation {
  const invalid = (): never => {
    throw new ApiRequestError('角色录入检查定位信息不完整，请重新检查。', 502, 'INVALID_AUTHORING_CHECK_RESPONSE');
  };
  if (!isLocationObject(value)
    || !exactKeys(value, ['skillKey', 'objectType', 'objectKey', 'editor', 'fieldPath', 'precision', 'degradeReason', 'segments', 'formulaSnapshot'])
    || !['skillKey', 'objectType', 'objectKey', 'fieldPath'].every(key => value[key] === expected[key as keyof AuthoringLocationIdentity])
    || !(value.editor === null || AUTHORING_EDITORS.some(editor => editor === value.editor))
    || !['FIELD', 'OBJECT', 'NONE'].includes(String(value.precision))
    || !(value.degradeReason === null || AUTHORING_LOCATION_REASONS.some(reason => reason === value.degradeReason))
    || !Array.isArray(value.segments) || !value.segments.every(validSegment)
    || !(value.formulaSnapshot === null || isLocationObject(value.formulaSnapshot))) return invalid();
  if (value.precision === 'NONE' ? value.editor !== null : value.editor === null) return invalid();
  if (value.precision === 'FIELD' ? value.degradeReason !== null : value.degradeReason === null) return invalid();
  if (value.formulaSnapshot !== null && value.editor !== 'FORMULA') return invalid();
  if (value.segments.some(segment => segment.kind === 'FORMULA_OPERAND') && value.formulaSnapshot === null) return invalid();
  return value as AuthoringLocation;
}
