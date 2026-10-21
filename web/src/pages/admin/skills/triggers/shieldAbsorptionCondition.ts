import type { SkillEffect } from '../../../../types/skillEffect';
import type { SkillTriggerEventType, SkillTriggerEventValueCompareDetail } from '../../../../types/skillTriggerRule';
import type { SkillParameter } from '../../../../types/skillParameter';
import { staticNumericValues } from '../numericValueForm';

export function ownShieldAbsorptionResults(effects: readonly SkillEffect[], skillKey: string, parameters: readonly SkillParameter[] = []) {
  return effects.flatMap(effect => {
    const shields = effect.results.filter(result => result.resultType === 'NORMAL_SHIELD');
    const shield = shields[0];
    const life = effect.lifecycle;
    const behavior = shield?.lifecycleBehavior;
    // 仅就已知静态值排除多层；公式的全等级单层证明由后端最终图校验负责。
    const single = [life?.maxStacksValue, life?.applicationStacksValue].every(value => {
      if (!value) return false;
      const values = staticNumericValues(value, parameters);
      return values === null || values.length > 0 && values.every(value => value === 1);
    });
    return effect.skillKey === skillKey && effect.lifecycle?.instanceScope === 'SOURCE'
      && shields.length === 1 && shield?.target === 'SOURCE'
      && effect.lifecycle.endWhenShieldEndsResultKey === shield.resultKey
      && single && behavior?.moment === 'PERSISTENT' && behavior.valueReadMode === 'APPLICATION_SNAPSHOT'
      && behavior.stackValueMode === 'SHARED' && behavior.reapplicationValueMode === 'REPLACE'
      && behavior.periodicExecutionMode === null
      ? [{ effect, result: shield }] : [];
  });
}

export function shieldAbsorptionConditionError(
  detail: SkillTriggerEventValueCompareDetail,
  eventType: SkillTriggerEventType,
  skillKey: string | undefined,
  effects: readonly SkillEffect[],
  parameters: readonly SkillParameter[] = []
): string | null {
  if (!Object.prototype.hasOwnProperty.call(detail, 'shieldResult')) return null;
  const selected = detail.shieldResult;
  if (eventType !== 'DAMAGE_TAKEN' || detail.eventValueKey !== 'SHIELD_ABSORBED') return '指定自身盾吸收量只允许受到伤害事件的吸收量条件。';
  if (!selected || typeof selected !== 'object' || Array.isArray(selected)
    || Object.keys(selected).length !== 3
    || Object.keys(selected).some(key => !['skillKey', 'effectKey', 'resultKey'].includes(key))
    || [selected.skillKey, selected.effectKey, selected.resultKey].some(key => typeof key !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(key))) return '请选择完整的自身护盾结果。';
  if (!skillKey || selected.skillKey !== skillKey) return '护盾必须属于当前技能。';
  if (!ownShieldAbsorptionResults(effects, skillKey, parameters).some(row => row.effect.effectKey === selected.effectKey
    && row.result.resultKey === selected.resultKey)) return '请选择本技能自身普通盾的唯一关联终止结果；目录未加载成功时请重试。';
  return null;
}
