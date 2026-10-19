import type { SkillEffect } from '../types/skillEffect';
import type { ProviderDefinition, OperationDefinition } from '../types/genericEngine';
import { compileSelfSingleLayerLifecycle } from './timedAttributeEffectAdapter';
import { staticEffectAmount } from './staticEffectValue';
import { NumericAdaptationError, type NumericCompileState } from './numericAdapter';

export const cooldownDurationProviderKey = (parent: string, skill: string, effect: string) => `cooldown-duration/${parent}/${skill}/${effect}`;
function fail(path: string, message: string): never { throw new NumericAdaptationError(path, message); }

/** 有界生命周期复用现行验证；实际INITIAL范围在所有真实主动绑定完成后展开。 */
export function compileCooldownDurationEffect(effect: SkillEffect, state: NumericCompileState, parent: string) {
  const root = `skills.${state.skillKey}.effects.${effect.effectKey}`;
  if (effect.results.length !== 1 || effect.results[0]?.resultType !== 'COOLDOWN_DURATION_MODIFIER') fail(root, '冷却时长修正只接受单结果有限自身效果');
  const result = effect.results[0], scope = result.detail.affectedSkillScope;
  if (Object.keys(result).some(key => !['resultKey', 'name', 'resultType', 'target', 'description', 'sortOrder', 'lifecycleBehavior', 'spellShieldBlockScope', 'valueRule', 'detail'].includes(key))) fail(root, '冷却时长结果包含未接入字段');
  if (Object.keys(result.detail).length !== 1 || !scope || Object.keys(scope).sort().join(',') !== 'mode,skillCategoryKeys,skillKeys'
    || scope.mode !== 'SKILLS' || !Array.isArray(scope.skillKeys) || !scope.skillKeys.length || new Set(scope.skillKeys).size !== scope.skillKeys.length
    || scope.skillKeys.some(key => !/^[a-z][a-z0-9_]{0,63}$/.test(key)) || !Array.isArray(scope.skillCategoryKeys) || scope.skillCategoryKeys.length) fail(root, '冷却时长范围必须为非空去重的指定技能');
  const amount = staticEffectAmount(result.valueRule, `${root}.results.${result.resultKey}.valueRule`, state);
  if (!Number.isFinite(amount) || amount <= 0) fail(root, '冷却时长倍率必须为静态有限正值，0.5表示原时长一半');
  const behavior = result.lifecycleBehavior;
  if (result.target !== 'SOURCE' || result.spellShieldBlockScope !== null || !behavior
    || Object.keys(behavior).sort().join(',') !== 'moment,periodicExecutionMode,reapplicationValueMode,stackValueMode,valueReadMode'
    || behavior.moment !== 'PERSISTENT' || behavior.valueReadMode !== 'APPLICATION_SNAPSHOT'
    || behavior.stackValueMode !== 'SHARED' || behavior.reapplicationValueMode !== 'REPLACE' || behavior.periodicExecutionMode !== null) fail(root, '冷却时长修正必须为自身无阻挡的静态持续快照');
  const lifecycle = compileSelfSingleLayerLifecycle(effect, state);
  const providerKey = cooldownDurationProviderKey(parent, state.skillKey, effect.effectKey);
  const provider: ProviderDefinition = { providerKey, stableId: providerKey, skillKey: state.skillKey, kind: 'status', lifecycle,
    modifiers: [{ modifierKey: result.resultKey, kind: 'cooldown_duration', target: 'self', valuePolicy: 'multiply', value: { op: 'const', value: amount }, affectedAbilityRefs: [] }] };
  const operation: OperationDefinition = { operation: 'apply_provider', target: 'self', providerDefinitionRef: providerKey, ref: `${root}.results.${result.resultKey}` };
  return { provider, operation, skillKeys: [...scope.skillKeys] };
}
