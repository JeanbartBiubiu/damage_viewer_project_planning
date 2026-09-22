/** 管理录入检查的定位契约，见规划 authoring-p8-r2。 */
export const AUTHORING_EDITORS = [
  'CHARACTER_BASIC', 'CHARACTER_ATTRIBUTES', 'CHARACTER_RELATIONS', 'SKILL_BASIC',
  'PARAMETER', 'FORMULA', 'EFFECT', 'PROCESS', 'INTERNAL_STATE', 'TRIGGER_RULE'
] as const;
export type AuthoringEditor = typeof AUTHORING_EDITORS[number];

export const AUTHORING_LOCATION_REASONS = [
  'MISSING_KEY', 'DUPLICATE_KEY', 'TYPE_CHANGED', 'NODE_MISSING', 'UNKNOWN_FIELD',
  'OBJECT_MISSING', 'CORRUPT_OBJECT'
] as const;
export type AuthoringLocationReason = typeof AUTHORING_LOCATION_REASONS[number];
export type AuthoringLocationPrecision = 'FIELD' | 'OBJECT' | 'NONE';
export type AuthoringScalar = string | number | boolean | null;

export const AUTHORING_COLLECTION_KEYS = {
  results: 'resultKey', steps: 'stepKey', effectBindings: 'bindingKey',
  stateOperations: 'operationKey', options: 'optionKey', conditionGroups: 'groupKey',
  conditions: 'conditionKey', actions: 'actionKey', runtimeInputBindings: 'bindingKey',
  vampOverrides: 'vampType', resultModifiers: 'resultKey'
} as const;

export type AuthoringLocationSegment =
  | { kind: 'FIELD'; field: string }
  | { kind: 'KEYED_CHILD'; collection: string; keyField: string; key: string }
  | { kind: 'VALUE_CHILD'; collection: 'skillKeys' | 'skillCategoryKeys'; value: string }
  | { kind: 'FORMULA_OPERAND'; operand: 0 | 1 }
  | { kind: 'EXPECT_VALUE'; field: string; value: AuthoringScalar };

export type AuthoringLocationIdentity = {
  skillKey: string | null;
  objectType: string;
  objectKey: string;
  fieldPath: string;
};

export type AuthoringLocation = AuthoringLocationIdentity & {
  editor: AuthoringEditor | null;
  precision: AuthoringLocationPrecision;
  degradeReason: AuthoringLocationReason | null;
  segments: AuthoringLocationSegment[];
  formulaSnapshot: Record<string, unknown> | null;
};
