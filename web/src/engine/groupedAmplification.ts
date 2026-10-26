import type { DamageType } from '../types/damageType';
import type { ModifierDefinition } from '../types/genericEngine';
import type { ModifierZone } from '../types/modifierZone';
import type { SkillEffectResult, SkillEffectValueRule } from '../types/skillEffect';
import { constExpr, NumericAdaptationError, type NumericCompileState } from './numericAdapter';
import { staticEffectAmount, staticEffectValue } from './staticEffectValue';

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }

export function staticGroupedAmplificationAmount(rule: SkillEffectValueRule, path: string, state: NumericCompileState): number {
  if (!Number.isFinite(rule.fixedMultiplier) || rule.fixedMultiplier < 0
    || staticEffectValue(rule.value, `${path}.value`, state) < 0) fail(path, '同组增幅的原比例和固定倍率必须为有限非负数，不能反转减少方向');
  const ratio = staticEffectAmount(rule, path, state);
  if (ratio < 0 || !Number.isFinite(1 + ratio)) fail(path, '同组增幅修正后的比例必须为有限非负数');
  return ratio;
}

export function groupedAmplificationFields(key: string, ratio: number, path: string) {
  if (typeof key !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(key)) fail(`${path}.detail.modifierZoneKey`, '同组增幅需要合法的真实修正区域标识');
  if (!Number.isFinite(ratio) || ratio < 0 || !Number.isFinite(1 + ratio)) fail(`${path}.valueRule`, '同组增幅比例必须为有限非负数');
  return { multiplierGroupKey: key, valuePolicy: 'multiply', value: constExpr(1 + ratio) };
}

/** 静态伤害增幅只接明确类型与拥有方方向，保留原次数范围。 */
export function compileGroupedDamageModifier(result: SkillEffectResult, zones: readonly ModifierZone[],
  damageTypes: readonly DamageType[], gameId: string, ratio: number, path: string): ModifierDefinition {
  if (result.resultType !== 'DAMAGE_MODIFIER' || result.target !== 'SOURCE') fail(path, '伤害增幅只接拥有方的完整伤害修正结果');
  const detail = result.detail;
  for (const key of Object.keys(detail)) if (!['modifierZoneKey', 'direction', 'operation', 'damageTypeKey', 'deliveryKind', 'originKind', 'criticalFilter', 'condition'].includes(key)) fail(`${path}.detail.${key}`, '同组伤害增幅未接入该过滤或条件');
  if (detail.operation !== 'INCREASE' || !['DEALT', 'TAKEN'].includes(detail.direction)
    || detail.deliveryKind !== 'ANY' || detail.originKind !== 'ANY' || detail.criticalFilter !== 'ANY'
    || detail.condition != null || !detail.damageTypeKey) fail(`${path}.detail`, '同组伤害增幅需要明确方向和伤害类型，只接全部产生方式、来源及暴击分支且无条件');
  const selectedTypes = damageTypes.filter(row => row.damageTypeKey === detail.damageTypeKey);
  if (selectedTypes.length !== 1 || selectedTypes[0]!.gameId !== gameId || selectedTypes[0]!.status !== 'ENABLED'
    || !/^[a-z][a-z0-9_]{0,63}$/.test(detail.damageTypeKey)) fail(`${path}.detail.damageTypeKey`, '伤害增幅缺少唯一真实启用的伤害类型');
  const selectedZones = zones.filter(row => row.modifierZoneKey === detail.modifierZoneKey);
  const zone = selectedZones[0];
  const outgoing = detail.direction === 'DEALT';
  if (selectedZones.length !== 1 || !zone || zone.gameId !== gameId || zone.status !== 'ENABLED' || zone.domain !== 'DAMAGE'
    || zone.calculationMode !== 'RATIO_GROUP_ADD' || zone.applicationStage !== (outgoing ? 'DAMAGE_PRE_DEFENSE' : 'DAMAGE_POST_DEFENSE')) fail(`${path}.detail.modifierZoneKey`, '同组伤害增幅需要造成方向的防御前区域或承受方向的防御后区域');
  return { modifierKey: result.resultKey, kind: 'pipeline', command: 'damage', channel: 'all_damage',
    stage: outgoing ? 'outgoing_pre_mitigation' : 'incoming_post_mitigation', bucket: 'all_instances',
    ...groupedAmplificationFields(zone.modifierZoneKey, ratio, path),
    condition: { op: 'read', path: `damage.type.${detail.damageTypeKey}` } };
}
