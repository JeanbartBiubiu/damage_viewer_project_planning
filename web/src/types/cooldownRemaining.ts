import type { SkillEffectValueRule } from './skillEffect';

type Decimal = { coefficient: bigint; scale: number };

// 按发送给后端的十进制文本计算，再核对应用倍率和上下界后的有限非负毫秒。
function decimal(value: number): Decimal {
  const [digits, exponent = '0'] = String(value).toLowerCase().split('e');
  const [whole, fraction = ''] = digits.split('.');
  return { coefficient: BigInt(whole + fraction), scale: fraction.length - Number(exponent) };
}

function compare(left: Decimal, right: Decimal): bigint {
  const scale = Math.max(left.scale, right.scale);
  return left.coefficient * 10n ** BigInt(scale - left.scale)
    - right.coefficient * 10n ** BigInt(scale - right.scale);
}

/** 仅验证已知数值；设置为当前时间加所给时长，零表示立即可用。 */
export function isValidCooldownRemainingDuration(value: number, rule: SkillEffectValueRule): boolean {
  if (!Number.isFinite(value) || value < 0 || !Number.isFinite(rule.fixedMultiplier) || rule.fixedMultiplier < 0) return false;
  if (rule.fixedMinValue !== null && !Number.isFinite(rule.fixedMinValue)) return false;
  if (rule.fixedMaxValue !== null && !Number.isFinite(rule.fixedMaxValue)) return false;
  if (rule.fixedMinValue !== null && rule.fixedMaxValue !== null && rule.fixedMinValue > rule.fixedMaxValue) return false;
  const input = decimal(value);
  const multiplier = decimal(rule.fixedMultiplier);
  let duration = { coefficient: input.coefficient * multiplier.coefficient, scale: input.scale + multiplier.scale };
  if (rule.fixedMinValue !== null) {
    const minimum = decimal(rule.fixedMinValue);
    if (compare(duration, minimum) < 0n) duration = minimum;
  }
  if (rule.fixedMaxValue !== null) {
    const maximum = decimal(rule.fixedMaxValue);
    if (compare(duration, maximum) > 0n) duration = maximum;
  }
  return duration.coefficient >= 0n
    && Number.isFinite(Number(`${duration.coefficient}e${-duration.scale}`));
}
