import type { DamageType } from '../types/damageType';
import type { ModifierZone } from '../types/modifierZone';
import type { SkillEffect } from '../types/skillEffect';
import type { NumericCompileState } from './numericAdapter';
import { NumericAdaptationError } from './numericAdapter';
import { compileSelfSingleLayerLifecycle } from './timedAttributeEffectAdapter';
import { compileGroupedDamageModifier, staticGroupedAmplificationAmount } from './groupedAmplification';

function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }

/** 有限增幅沿现有真实施加入口，组本身不另建计时器或使用额度。 */
export function compileTimedDamageAmplification(effect: SkillEffect, state: NumericCompileState, zones: readonly ModifierZone[],
  damageTypes: readonly DamageType[], parentDefinition = `process_${state.skillKey}`) {
  const root = `skills.${state.skillKey}.effects.${effect.effectKey}`;
  for (const key of Object.keys(effect)) if (!['gameId', 'skillKey', 'effectKey', 'name', 'description', 'sortOrder', 'lifecycle', 'results', 'createdAt', 'updatedAt'].includes(key)) fail(`${root}.${key}`, '未接入的有限增幅字段');
  if (effect.results.length !== 1) fail(root, '有限伤害增幅只接完整单结果效果，不拆分共同生命周期');
  const lifecycle = compileSelfSingleLayerLifecycle(effect, state);
  const result = effect.results[0]!;
  const path = `${root}.results.${result.resultKey}`;
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(result.resultKey)) fail(path, '有限增幅结果身份非法');
  for (const key of Object.keys(result)) if (!['resultKey', 'name', 'resultType', 'target', 'description', 'sortOrder', 'lifecycleBehavior', 'spellShieldBlockScope', 'valueRule', 'detail'].includes(key)) fail(`${path}.${key}`, '未接入的有限增幅结果字段');
  const behavior = result.lifecycleBehavior;
  if (result.resultType !== 'DAMAGE_MODIFIER' || result.spellShieldBlockScope !== null || !result.valueRule || !behavior
    || behavior.moment !== 'PERSISTENT' || behavior.valueReadMode !== 'MOMENT_EVALUATION' || behavior.stackValueMode !== 'SHARED'
    || behavior.reapplicationValueMode !== null || behavior.periodicExecutionMode !== null) fail(path, '有限伤害增幅只接自身持续共享的静态完整依赖');
  for (const key of Object.keys(behavior)) if (!['moment', 'valueReadMode', 'stackValueMode', 'reapplicationValueMode', 'periodicExecutionMode'].includes(key)) fail(`${path}.lifecycleBehavior.${key}`, '未接入的有限增幅读取方式');
  const modifier = compileGroupedDamageModifier(result, zones, damageTypes, state.gameId,
    staticGroupedAmplificationAmount(result.valueRule, `${path}.valueRule`, state), path);
  const key = `amplification/${parentDefinition}/${state.skillKey}/${effect.effectKey}/${result.resultKey}`;
  return { providers: [{ providerKey: key, skillKey: state.skillKey, stableId: key, kind: 'status', lifecycle, modifiers: [modifier] }],
    operations: [{ operation: 'apply_provider', target: 'self', providerDefinitionRef: key, ref: path }],
    typeEntries: [{ key: result.detail.damageTypeKey!, domain: 'damage' }] };
}
