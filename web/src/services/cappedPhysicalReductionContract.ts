import type { NumericValue } from '../types/numericValue';
import { isNumericValue } from '../types/numericValue';
import type { SkillParameter } from '../types/skillParameter';
import type { SkillEffectResult } from '../types/skillEffect';

/** 比例上限独立于点数，不经过结果倍率或绝对值上下界。 */
export function cappedReductionRatioIssue(value: NumericValue | null | undefined, parameters: readonly SkillParameter[],
  skillKey: string, maxLevel?: number, gameId?: string): string | null {
  if (!isNumericValue(value) || value.kind === 'FORMULA') return '最大减免比例必须明确使用固定值或本技能静态参数。';
  let values: unknown[];
  let integer = false;
  if (value.kind === 'FIXED') values = [value.value];
  else {
    const rows = parameters.filter(row => row.parameterKey === value.parameterKey);
    const row = rows[0];
    if (rows.length !== 1 || !row || row.skillKey !== skillKey || gameId !== undefined && row.gameId !== gameId
      || !['FIXED', 'SKILL_LEVEL', 'CHARACTER_LEVEL'].includes(row.valueMode)
      || !['INTEGER', 'DECIMAL'].includes(row.valueType)) return '最大减免比例缺少唯一同技能静态数值参数。';
    integer = row.valueType === 'INTEGER';
    if (row.valueMode === 'FIXED') {
      if (row.levelValues !== null) return '固定比例参数不能夹带等级表。';
      values = [row.fixedValue];
    } else {
      if (row.fixedValue !== null || !row.levelValues || !Object.keys(row.levelValues).length) return '比例参数必须保留完整明确等级表。';
      const keys = Object.keys(row.levelValues);
      if (keys.some(k => !/^[1-9]\d*$/.test(k)) || keys.some((_, i) => !Object.prototype.hasOwnProperty.call(row.levelValues!, String(i + 1)))
        || row.valueMode === 'SKILL_LEVEL' && maxLevel !== undefined
          && (keys.length !== maxLevel || keys.some(k => Number(k) > maxLevel))) return '比例参数的所有声明等级必须连续且完整。';
      values = Object.values(row.levelValues);
    }
  }
  return values.every(v => typeof v === 'number' && Number.isFinite(v) && (!integer || Number.isSafeInteger(v)) && v >= 0 && v <= 1)
    ? null : '最大减免比例的所有等级必须为 0 到 1 的有限数值。';
}

export function isCappedReductionResultShape(result: SkillEffectResult): boolean {
  if (result.resultType !== 'DAMAGE_MODIFIER') return false;
  const d = result.detail, b = result.lifecycleBehavior;
  return result.target === 'SOURCE' && result.spellShieldBlockScope === null && d.direction === 'TAKEN' && d.operation === 'DECREASE'
    && typeof d.damageTypeKey === 'string' && d.damageTypeKey.length > 0 && d.deliveryKind === 'ANY' && d.originKind === 'ANY'
    && d.criticalFilter === 'ANY' && d.condition == null && !!b && b.moment === 'PERSISTENT'
    && b.valueReadMode === 'MOMENT_EVALUATION' && b.stackValueMode === 'SHARED'
    && b.reapplicationValueMode === null && b.periodicExecutionMode === null;
}
