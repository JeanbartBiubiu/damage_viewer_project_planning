import type {
  AuthoringEditor,
  AuthoringLocation,
  AuthoringLocationReason,
  AuthoringLocationSegment
} from '../../../types/authoringLocation';
import { normalizeFormulaNodePath } from './formulaExpression';

export const AUTHORING_UNSAVED_CONFIRM = '当前修改尚未保存，确定要离开吗？';
export const AUTHORING_CANNOT_LOCATE = '无法精确定位';
export const AUTHORING_UNSUPPORTED_ANCHOR = '当前编辑器没有对应控件锚点';
export const AUTHORING_NOT_BATTLE_VERIFIED = '本页只汇总已保存配置，不表示机制已核对或战斗运行已验证。';
export const RESOURCE_DECREASE_REVIEW_NOTE = '资源扣减，是否属于施放消耗需按来源核对';

export type AuthoringNavigationRequest = {
  requestId: string;
  location: AuthoringLocation;
};

export function createAuthoringRequestId(): string {
  return `authoring-nav-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createAuthoringNavigationRequest(location: AuthoringLocation): AuthoringNavigationRequest {
  return { requestId: createAuthoringRequestId(), location };
}

export function authoringLocationFor(
  skillKey: string | null,
  objectType: string,
  objectKey: string,
  editor: AuthoringEditor,
  fieldPath: string,
  segments: AuthoringLocationSegment[] = []
): AuthoringLocation {
  return {
    skillKey,
    objectType,
    objectKey,
    fieldPath,
    editor,
    precision: 'FIELD',
    degradeReason: null,
    segments,
    formulaSnapshot: null
  };
}

export function keyedChildren(segments: readonly AuthoringLocationSegment[]): Array<{ collection: string; key: string }> {
  return segments.flatMap((segment) => (
    segment.kind === 'KEYED_CHILD' ? [{ collection: segment.collection, key: segment.key }] : []
  ));
}

export function keyedChildKey(
  segments: readonly AuthoringLocationSegment[],
  collection: string
): string | undefined {
  return keyedChildren(segments).find((item) => item.collection === collection)?.key;
}

export function valueChildren(segments: readonly AuthoringLocationSegment[]): Array<{ collection: string; value: string }> {
  return segments.flatMap((segment) => (
    segment.kind === 'VALUE_CHILD' ? [{ collection: segment.collection, value: segment.value }] : []
  ));
}

export function lastFieldName(segments: readonly AuthoringLocationSegment[]): string | null {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment?.kind === 'FIELD') return segment.field;
  }
  return null;
}

export function resolvedPathToDotted(path: readonly (string | number)[]): string {
  let dotted = '';
  for (const part of path) {
    if (typeof part === 'number') dotted += `[${part}]`;
    else dotted += dotted ? `.${part}` : part;
  }
  return dotted;
}

export function formulaNodePathFromResolved(path: readonly (string | number)[]): string {
  return normalizeFormulaNodePath(resolvedPathToDotted(path));
}

const DEGRADE_REASON_TEXT: Record<AuthoringLocationReason, string> = {
  MISSING_KEY: '当前详情中找不到该子项',
  DUPLICATE_KEY: '子项键不唯一，不能按序号猜测另一行',
  TYPE_CHANGED: '当前类型、父级引用或公式表达式已变化',
  NODE_MISSING: '当前结构缺少该节点',
  UNKNOWN_FIELD: '当前对象没有该字段',
  OBJECT_MISSING: '对象不存在',
  CORRUPT_OBJECT: '对象已损坏，只能打开可读取入口'
};

export function authoringLocateMessage(options: {
  originalFieldPath: string;
  reason?: AuthoringLocationReason | null;
  unsupportedAnchor?: boolean;
  reportChanged?: boolean;
  missingObject?: boolean;
}): string {
  const details: string[] = [];
  if (options.unsupportedAnchor) details.push(AUTHORING_UNSUPPORTED_ANCHOR);
  if (options.missingObject) details.push(DEGRADE_REASON_TEXT.OBJECT_MISSING);
  if (options.reportChanged) details.push('公式表达式已变化，报告可能已过期');
  if (options.reason) details.push(DEGRADE_REASON_TEXT[options.reason]);
  const detailText = details.length ? details.join('；') : '当前无法打开对应字段';
  return `${AUTHORING_CANNOT_LOCATE}：${detailText}。原路径：${options.originalFieldPath}`;
}

const SUPPORTED_FIELDS: Record<AuthoringEditor, ReadonlySet<string>> = {
  CHARACTER_BASIC: new Set(['characterKey', 'name', 'description']),
  CHARACTER_ATTRIBUTES: new Set(['attributes', 'level', 'value']),
  CHARACTER_RELATIONS: new Set(['skills', 'skillKey']),
  SKILL_BASIC: new Set(['skillKey', 'name', 'description', 'maxLevel', 'status', 'sortOrder', 'skillCategoryKeys']),
  PARAMETER: new Set([
    'parameterKey', 'name', 'description', 'valueType', 'valueMode', 'fixedValue', 'levelValues', 'sortOrder'
  ]),
  FORMULA: new Set([
    'formulaKey', 'name', 'description', 'sortOrder', 'expression', 'nodeType', 'operation', 'operands',
    'parameterKey', 'attributeKey', 'attributeOwner', 'attributeValueKind'
  ]),
  EFFECT: new Set([
    'effectKey', 'name', 'description', 'sortOrder', 'lifecycle', 'results', 'resultKey', 'resultType', 'target',
    'detail', 'valueRule', 'value', 'attributeKey', 'damageTypeKey', 'operation', 'statusKey', 'targetEffectKey',
    'affectedSkillScope', 'skillKeys', 'skillCategoryKeys', 'vampOverrides', 'vampType', 'modifierZoneKey',
    'lifecycleBehavior', 'moment', 'spellShieldBlockScope', 'deliveryKind', 'originKind', 'direction',
    'fixedMultiplier', 'fixedMinValue', 'fixedMaxValue', 'durationValue', 'maxStacksValue', 'applicationStacksValue',
    'instanceScope', 'expiryMode', 'periodicIntervalValue'
  ]),
  PROCESS: new Set([
    'processKey', 'name', 'description', 'activationType', 'sortOrder', 'cooldown', 'durationValue', 'startMoment',
    'steps', 'stepKey', 'stepType', 'effectBindings', 'bindingKey', 'effectKey', 'stateOperations', 'operationKey',
    'stateKey', 'operation', 'optionKey', 'moment', 'momentType', 'failureReason', 'value'
  ]),
  INTERNAL_STATE: new Set([
    'stateKey', 'name', 'description', 'scope', 'stateType', 'sortOrder', 'detail', 'options', 'optionKey',
    'initial', 'initialValue', 'maxValue', 'initialEnabled', 'durationValue', 'recoveryIntervalValue', 'recoveryMode'
  ]),
  TRIGGER_RULE: new Set([
    'ruleKey', 'name', 'description', 'sortOrder', 'eventSource', 'eventType', 'detail', 'castPhase', 'useKind',
    'sourceSkillKey', 'processKey', 'stepKey', 'effectKey', 'resultKey', 'moment', 'conditionGroups', 'groupKey',
    'conditions', 'conditionKey', 'conditionType', 'actions', 'actionKey', 'actionType', 'runtimeInputBindings',
    'bindingKey', 'sourceType', 'parameterKey', 'eventValueKey', 'attributeKey', 'stateKey', 'optionKey',
    'perTargetCooldown', 'maxTriggersPerProcess', 'oncePerUse', 'targetContext', 'failureReason', 'scope'
  ])
};

export function isSupportedAuthoringField(editor: AuthoringEditor, field: string): boolean {
  return SUPPORTED_FIELDS[editor].has(field);
}

export function shouldDegradeUnsupportedAnchor(
  editor: AuthoringEditor | null,
  matchedSegments: readonly AuthoringLocationSegment[],
  precision: 'FIELD' | 'OBJECT' | 'NONE'
): boolean {
  if (precision !== 'FIELD' || !editor) return false;
  const field = lastFieldName(matchedSegments);
  if (field === null) return false;
  return !isSupportedAuthoringField(editor, field);
}
