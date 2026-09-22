import type { SkillEffectValueRule } from './skillEffect';

/** 只核对可静态取得的数值；遵守结果固定倍率、最小值、最大值的顺序，不夹取作者原值。 */
export function isValidHealingRatioMaxDecrease(value: number, rule: SkillEffectValueRule): boolean {
  if (!Number.isFinite(value) || !Number.isFinite(rule.fixedMultiplier) || rule.fixedMultiplier < 0) return false;
  if (rule.fixedMinValue !== null && !Number.isFinite(rule.fixedMinValue)) return false;
  if (rule.fixedMaxValue !== null && !Number.isFinite(rule.fixedMaxValue)) return false;
  if (rule.fixedMinValue !== null && rule.fixedMaxValue !== null && rule.fixedMinValue > rule.fixedMaxValue) return false;
  let ratio = value * rule.fixedMultiplier;
  if (rule.fixedMinValue !== null) ratio = Math.max(ratio, rule.fixedMinValue);
  if (rule.fixedMaxValue !== null) ratio = Math.min(ratio, rule.fixedMaxValue);
  return Number.isFinite(ratio) && ratio >= 0 && ratio <= 1;
}
