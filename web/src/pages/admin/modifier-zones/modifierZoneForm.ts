import { ApiRequestError } from '../../../services/apiClient';
import {
  allowedModifierZoneApplicationStages,
  allowedModifierZoneCalculationModes,
  isLegalModifierZoneCombination,
  type ModifierZoneApplicationStage,
  type ModifierZoneCalculationMode,
  type ModifierZoneDomain
} from '../../../types/modifierZone';

export type ModifierZoneDraft = {
  modifierZoneKey: string;
  name: string;
  domain: ModifierZoneDomain | '';
  calculationMode: ModifierZoneCalculationMode | '';
  applicationStage: ModifierZoneApplicationStage | '';
  description: string;
  sortOrder: string;
};

export type ModifierZoneDraftErrors = Partial<Record<keyof ModifierZoneDraft, string>>;

export const DOMAIN_LABELS: Record<ModifierZoneDomain, string> = {
  ATTRIBUTE: '属性',
  DAMAGE: '伤害',
  HEALING: '治疗',
  SHIELD: '护盾'
};

export const CALCULATION_MODE_LABELS: Record<ModifierZoneCalculationMode, string> = {
  FLAT_ADD: '固定值加算',
  RATIO_ADD: '比例加算',
  RATIO_MAX: '比例减少取强'
};

export const APPLICATION_STAGE_LABELS: Record<ModifierZoneApplicationStage, string> = {
  ATTRIBUTE_FLAT: '属性固定值',
  ATTRIBUTE_PERCENT: '属性百分比',
  DAMAGE_PRE_DEFENSE: '防御计算前伤害',
  DAMAGE_POST_DEFENSE: '防御计算后伤害',
  HEALING_RESULT: '治疗结果',
  SHIELD_RESULT: '护盾结果'
};

export function allowedCalculationModes(domain: ModifierZoneDomain | ''): ModifierZoneCalculationMode[] {
  return allowedModifierZoneCalculationModes(domain);
}

export function allowedApplicationStages(
  domain: ModifierZoneDomain | '',
  mode: ModifierZoneCalculationMode | ''
): ModifierZoneApplicationStage[] {
  return allowedModifierZoneApplicationStages(domain, mode);
}

export { isLegalModifierZoneCombination };

export function validateModifierZoneDraft(
  draft: ModifierZoneDraft,
  includeKey: boolean
): ModifierZoneDraftErrors {
  const errors: ModifierZoneDraftErrors = {};
  if (includeKey) {
    if (!draft.modifierZoneKey.trim()) {
      errors.modifierZoneKey = '乘区标识不能为空';
    } else if (!/^[a-z][a-z0-9_]{0,63}$/.test(draft.modifierZoneKey.trim())) {
      errors.modifierZoneKey = '小写字母开头，只能包含小写字母、数字和下划线';
    }
  }
  if (!draft.name.trim()) errors.name = '乘区名称不能为空';
  else if (draft.name.trim().length > 100) errors.name = '乘区名称不能超过100个字符';
  if (!draft.domain) errors.domain = '作用域不能为空';
  if (!draft.calculationMode) errors.calculationMode = '计算方式不能为空';
  else if (draft.domain && !allowedCalculationModes(draft.domain).includes(draft.calculationMode)) {
    errors.calculationMode = '作用域、计算方式和应用阶段组合不合法';
  }
  if (!draft.applicationStage) errors.applicationStage = '应用阶段不能为空';
  else if (!isLegalModifierZoneCombination(draft.domain, draft.calculationMode, draft.applicationStage)) {
    if (draft.calculationMode === 'RATIO_MAX') {
      errors.calculationMode = '作用域、计算方式和应用阶段组合不合法';
    } else {
      errors.applicationStage = '作用域、计算方式和应用阶段组合不合法';
    }
  }
  if (draft.description.trim().length > 2000) errors.description = '说明不能超过2000个字符';
  const sortOrder = Number(draft.sortOrder.trim());
  if (!draft.sortOrder.trim()) errors.sortOrder = '排序不能为空';
  else if (!Number.isInteger(sortOrder) || sortOrder < 0) errors.sortOrder = '排序必须是大于等于0的整数';
  return errors;
}

export function modifierZoneFieldIssues(error: unknown): Array<{ field: string; message: string }> {
  if (!(error instanceof ApiRequestError)) return [];
  const raw = error.details?.fieldIssues;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((issue) => {
    if (!issue || typeof issue !== 'object') return [];
    const value = issue as Record<string, unknown>;
    return typeof value.field === 'string' && typeof value.message === 'string'
      ? [{ field: value.field, message: value.message }]
      : [];
  });
}
