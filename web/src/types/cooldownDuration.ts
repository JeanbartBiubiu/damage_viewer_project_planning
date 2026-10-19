import type { SkillEffectValueRule } from './skillEffect';

/** 可证明的完整固定值按倍率、下界、上界依次解释；参数与公式由实际数值层核定。 */
export function isValidCooldownDurationValueRule(rule: SkillEffectValueRule): boolean {
  if (!Number.isFinite(rule.fixedMultiplier) || rule.fixedMinValue !== null && !Number.isFinite(rule.fixedMinValue)
    || rule.fixedMaxValue !== null && !Number.isFinite(rule.fixedMaxValue)
    || rule.fixedMinValue !== null && rule.fixedMaxValue !== null && rule.fixedMinValue > rule.fixedMaxValue) return false;
  if (rule.value.kind !== 'FIXED') return true;
  let value = rule.value.value * rule.fixedMultiplier;
  if (rule.fixedMinValue !== null) value = Math.max(value, rule.fixedMinValue);
  if (rule.fixedMaxValue !== null) value = Math.min(value, rule.fixedMaxValue);
  return Number.isFinite(value) && value > 0;
}
