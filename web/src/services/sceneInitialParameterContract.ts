import type { SkillTriggerSceneInitialParameterBinding } from '../types/skillTriggerRule';

export function sceneInitialParameterDetailIssue(value: unknown, integer = false): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '场景初值明细必须完整声明范围。';
  const detail = value as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(detail, 'minValue') || !Object.prototype.hasOwnProperty.call(detail, 'maxValue')
    || Object.keys(detail).some(key => !['minValue', 'maxValue', 'sharedInputKey'].includes(key))) return '场景初值只接受范围及可选共享输入标识。';
  if (typeof detail.minValue !== 'number' || !Number.isFinite(detail.minValue) || typeof detail.maxValue !== 'number'
    || !Number.isFinite(detail.maxValue) || detail.minValue > detail.maxValue) return '场景初值须有有限且有序的上下界。';
  if (integer && (!Number.isSafeInteger(detail.minValue) || !Number.isSafeInteger(detail.maxValue))) return '整数初值边界必须为安全整数。';
  if (Object.prototype.hasOwnProperty.call(detail, 'sharedInputKey') && (typeof detail.sharedInputKey !== 'string'
    || !/^[a-z][a-z0-9_]{0,63}$/.test(detail.sharedInputKey))) return '共享输入标识须明确合法，不能为空或null。';
  return null;
}

export function validSceneInitialParameterDetail(value: unknown, integer = false): value is SkillTriggerSceneInitialParameterBinding['detail'] {
  return sceneInitialParameterDetailIssue(value, integer) === null;
}
