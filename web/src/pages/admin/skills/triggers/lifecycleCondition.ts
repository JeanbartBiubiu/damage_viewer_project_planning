import { LIFECYCLE_CHECK_LABELS } from '../../../../types/skillSystemEnums.generated';
export { LIFECYCLE_CHECK_LABELS };
import { fixedValue } from '../../../../types/numericValue';
import type { SkillEffect } from '../../../../types/skillEffect';
import type { SkillTriggerLifecycleCheckDetail, SkillTriggerLifecycleCheckKind, SkillTriggerSubject } from '../../../../types/skillTriggerRule';
import { numericValueError, type NumericCatalog, type NumericLimits } from '../numericValueForm';

export function lifecycleNeedsSubject(effect: SkillEffect | undefined): boolean {
  return effect?.lifecycle?.instanceScope === 'TARGET' || effect?.lifecycle?.instanceScope === 'SOURCE_TARGET';
}

export function lifecycleConditionEffects(effects: readonly SkillEffect[], skillKey: string): SkillEffect[] {
  void skillKey;
  return effects.filter((effect) => effect.lifecycle !== null);
}

export function changeLifecycleEffect(detail: SkillTriggerLifecycleCheckDetail, effect: SkillEffect): SkillTriggerLifecycleCheckDetail {
  return { ...detail, effectSkillKey: effect.skillKey, effectKey: effect.effectKey,
    subject: lifecycleNeedsSubject(effect) ? detail.subject ?? 'CURRENT_TARGET' : null };
}

export function changeLifecycleCheckKind(detail: SkillTriggerLifecycleCheckDetail, checkKind: SkillTriggerLifecycleCheckKind): SkillTriggerLifecycleCheckDetail {
  const base = { effectSkillKey: detail.effectSkillKey, effectKey: detail.effectKey, subject: detail.subject };
  return checkKind === 'STACKS_COMPARE'
    ? { ...base, checkKind, comparator: detail.comparator ?? 'GTE', comparisonValue: detail.comparisonValue ?? fixedValue(Number.NaN) }
    : { ...base, checkKind, comparator: null, comparisonValue: null };
}

export function lifecycleConditionError(
  detail: SkillTriggerLifecycleCheckDetail,
  effect: SkillEffect | undefined,
  allowedSubjects: readonly SkillTriggerSubject[],
  catalog: NumericCatalog = {},
  limits: Pick<NumericLimits, 'parametersState' | 'formulasState'> = {},
  skillKey?: string
): { field: string; message: string } | null {
  if (!effect?.lifecycle || (skillKey !== undefined && effect.skillKey !== detail.effectSkillKey)) {
    return { field: 'effectKey', message: '请选择已配置生命周期的来源效果；目录未加载成功时请重试。' };
  }
  if (lifecycleNeedsSubject(effect)) {
    if (detail.subject === null || !allowedSubjects.includes(detail.subject)) return { field: 'subject', message: '请选择当前事件可用的生命周期主体。' };
  } else if (detail.subject !== null) {
    return { field: 'subject', message: '该生命周期按技能或来源保存，不需要主体。' };
  }
  if (detail.checkKind === 'STACKS_COMPARE') {
    if (!['EQ', 'NE', 'GT', 'GTE', 'LT', 'LTE'].includes(detail.comparator)) return { field: 'comparator', message: '请选择比较符。' };
    const message = numericValueError(detail.comparisonValue, catalog, { ...limits, integer: true, min: 0, allowRuntimeInput: false });
    if (message) return { field: 'comparisonValue', message };
  } else if (detail.checkKind !== 'PRESENT' && detail.checkKind !== 'ABSENT') {
    return { field: 'checkKind', message: '请选择生命周期检查方式。' };
  } else if (detail.comparator !== null || detail.comparisonValue !== null) {
    return { field: 'comparisonValue', message: '存在与不存在检查不能携带比较符或比较取值。' };
  }
  return null;
}
