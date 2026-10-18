import type { SkillEffect } from '../types/skillEffect';
import type { ModifierZone } from '../types/modifierZone';
import type { DamageType } from '../types/damageType';
import type { OperationDefinition, ProviderDefinition } from '../types/genericEngine';
import { constExpr, NumericAdaptationError, type NumericCompileState } from './numericAdapter';
import { staticEffectAmount, staticEffectValue } from './staticEffectValue';

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }
function exact(value: object, keys: readonly string[], path: string) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${path}.${key}`, '未接入的有限承受伤害修正字段');
}

/** 首增量只接一个作者结果的完整效果，不拆分共同生命周期来迁就来源核对。 */
export function compileTimedDamageReduction(effect: SkillEffect, state: NumericCompileState, zones: readonly ModifierZone[],
  damageTypes: readonly DamageType[], parentDefinition = `process_${state.skillKey}`) {
  const root = `skills.${state.skillKey}.effects.${effect.effectKey}`;
  const life = effect.lifecycle;
  if (!life || effect.gameId !== state.gameId || effect.skillKey !== state.skillKey || effect.results.length !== 1) fail(root, '减伤需要同技能完整有限效果，首增量只接单结果');
  exact(effect, ['gameId', 'skillKey', 'effectKey', 'name', 'description', 'sortOrder', 'lifecycle', 'results', 'createdAt', 'updatedAt'], root);
  exact(life, ['durationValue', 'maxStacksValue', 'applicationStacksValue', 'instanceScope', 'reapplicationStackMode', 'reapplicationDurationMode',
    'expiryMode', 'periodicIntervalValue', 'firstPeriodicExecution', 'endWhenShieldEndsResultKey'], `${root}.lifecycle`);
  if (life.instanceScope !== 'SOURCE' || life.expiryMode !== 'ALL_AT_ONCE' || life.reapplicationStackMode !== 'KEEP'
    || life.reapplicationDurationMode !== 'REFRESH_ALL' || life.periodicIntervalValue !== null || life.firstPeriodicExecution !== null
    || life.endWhenShieldEndsResultKey != null || !life.durationValue) fail(`${root}.lifecycle`, '减伤只接入自身单层、有限全部刷新、无周期且不关联盾的效果');
  for (const key of ['maxStacksValue', 'applicationStacksValue'] as const) if (staticEffectValue(life[key], `${root}.lifecycle.${key}`, state) !== 1) fail(`${root}.lifecycle.${key}`, '减伤只接入单层');
  const duration = staticEffectValue(life.durationValue, `${root}.lifecycle.durationValue`, state);
  if (!Number.isSafeInteger(duration) || duration <= 0) fail(`${root}.lifecycle.durationValue`, '减伤时长必须为明确正整数');
  const seen = new Set<string>();
  const seenTypes = new Set<string>();
  const providers: ProviderDefinition[] = [];
  const operations: OperationDefinition[] = [];
  for (const result of [...effect.results].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const path = `${root}.results.${result.resultKey}`;
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(result.resultKey) || seen.has(result.resultKey)) fail(path, '减伤结果身份非法或重复');
    seen.add(result.resultKey);
    exact(result, ['resultKey', 'name', 'resultType', 'target', 'description', 'sortOrder', 'lifecycleBehavior', 'spellShieldBlockScope', 'valueRule', 'detail'], path);
    const behavior = result.lifecycleBehavior;
    if (result.resultType !== 'DAMAGE_MODIFIER' || result.target !== 'SOURCE' || result.spellShieldBlockScope !== null || !result.valueRule
      || !behavior || behavior.moment !== 'PERSISTENT' || behavior.valueReadMode !== 'MOMENT_EVALUATION' || behavior.stackValueMode !== 'SHARED'
      || behavior.reapplicationValueMode !== null || behavior.periodicExecutionMode !== null) fail(path, '减伤只接入自身持续共享的静态完整依赖，不扩展施加快照行为');
    exact(behavior, ['moment', 'valueReadMode', 'stackValueMode', 'reapplicationValueMode', 'periodicExecutionMode'], `${path}.lifecycleBehavior`);
    const detail = result.detail;
    exact(detail, ['modifierZoneKey', 'direction', 'operation', 'damageTypeKey', 'deliveryKind', 'originKind', 'criticalFilter', 'condition'], `${path}.detail`);
    if (detail.direction !== 'TAKEN' || detail.operation !== 'DECREASE' || detail.deliveryKind !== 'ANY' || detail.originKind !== 'ANY'
      || detail.criticalFilter !== 'ANY' || detail.condition != null || !detail.damageTypeKey) fail(`${path}.detail`, '减伤仅接入明确伤害类型的承受减少，不扩展其它过滤或条件');
    const catalogs = damageTypes.filter(row => row.damageTypeKey === detail.damageTypeKey);
    if (catalogs.length !== 1 || catalogs[0]!.gameId !== state.gameId || catalogs[0]!.status !== 'ENABLED'
      || !/^[a-z][a-z0-9_]{0,63}$/.test(detail.damageTypeKey) || seenTypes.has(detail.damageTypeKey)) fail(`${path}.detail.damageTypeKey`, '减伤需要唯一启用的真实类型，各结果类型必须互斥');
    seenTypes.add(detail.damageTypeKey);
    const zonesForResult = zones.filter(row => row.modifierZoneKey === detail.modifierZoneKey);
    const zone = zonesForResult[0];
    if (zonesForResult.length !== 1 || !zone || zone.gameId !== state.gameId || zone.status !== 'ENABLED' || zone.domain !== 'DAMAGE'
      || zone.calculationMode !== 'RATIO_MULTIPLY' || zone.applicationStage !== 'DAMAGE_POST_DEFENSE') fail(`${path}.detail.modifierZoneKey`, '减伤需要明确的防御后伤害比例乘算区域');
    const ratio = staticEffectAmount(result.valueRule, `${path}.valueRule`, state);
    if (ratio < 0 || ratio > 1) fail(`${path}.valueRule`, '减伤比例必须在0与1之间');
    const key = `reduction/${parentDefinition}/${state.skillKey}/${effect.effectKey}/${result.resultKey}`;
    providers.push({ providerKey: key, skillKey: state.skillKey, stableId: key, kind: 'status',
      lifecycle: { durationMs: constExpr(duration), maxStacks: 1, refreshPolicy: 'replace', instanceScope: 'source_target' },
      modifiers: [{ modifierKey: result.resultKey, kind: 'pipeline', command: 'damage', channel: 'all_damage', stage: 'incoming_post_mitigation',
        bucket: 'all_instances', valuePolicy: 'multiply', value: constExpr(1 - ratio), condition: { op: 'read', path: `damage.type.${detail.damageTypeKey}` } }] });
    operations.push({ operation: 'apply_provider', target: 'self', providerDefinitionRef: key, ref: path });
  }
  return { providers, operations, typeEntries: [...seenTypes].map(key => ({ key, domain: 'damage' })) };
}
