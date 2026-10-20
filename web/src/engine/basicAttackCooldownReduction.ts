import type { OperationDefinition, ProviderDefinition, SkillActionBinding } from '../types/genericEngine';
import type { SkillConfiguration } from '../types/skillConfiguration';
import type { SkillEffectResult } from '../types/skillEffect';
import type { SkillTriggerAction } from '../types/skillTriggerRule';
import { NumericAdaptationError } from './numericAdapter';

export type BasicAttackCooldownReduction = {
  side: 'source' | 'target'; providerRef: string; definitionRef: string; skillKey: string;
  authorPath: string; operation: OperationDefinition;
};

/** 未计划主动时，仅忽略本技能的纯冷却维护动作；混合效果不因此消失。 */
export function isOwnCooldownReductionResult(result: SkillEffectResult, skillKey: string): boolean {
  if (result.resultType !== 'COOLDOWN_CHANGE' || result.detail.operation !== 'REDUCE'
    || result.target !== 'SOURCE' || result.lifecycleBehavior !== null || result.spellShieldBlockScope !== null) return false;
  const scope = result.detail.affectedSkillScope;
  return scope.mode === 'SKILLS' && scope.skillKeys.length === 1 && scope.skillKeys[0] === skillKey
    && scope.skillCategoryKeys.length === 0;
}

export function isOwnCooldownMaintenanceAction(configuration: SkillConfiguration, action: SkillTriggerAction): boolean {
  if (action.actionType !== 'EXECUTE_EFFECT' || action.targetContext !== 'CURRENT_TARGET'
    || action.runtimeInputBindings.length || action.resultModifiers.length) return false;
  const effects = configuration.effects.filter(effect => effect.effectKey === action.detail.effectKey);
  return effects.length === 1 && effects[0]!.lifecycle === null && effects[0]!.results.length > 0
    && effects[0]!.results.every(result => isOwnCooldownReductionResult(result, configuration.skill.skillKey));
}

/** 只消费本场同来源已装配的真实首次控制引用，不按技能名称拼接能力。 */
export function bindBasicAttackCooldownReductions(pending: readonly BasicAttackCooldownReduction[],
  bindings: readonly SkillActionBinding[], providers: readonly ProviderDefinition[]): void {
  for (const item of pending) {
    const fail = (message: string): never => { throw new NumericAdaptationError(item.authorPath, message); };
    const matches = bindings.filter(binding => binding.source === item.side && binding.skillKey === item.skillKey
      && binding.providerRef === item.providerRef && binding.providerDefinitionRef === item.definitionRef);
    if (item.side !== 'source' || matches.length !== 1) fail('普攻减冷却必须绑定同拥有者、同实际来源的唯一已计划主动技能');
    const binding = matches[0]!;
    const initials = binding.controls.filter(control => control.action === 'INITIAL');
    const definitions = providers.filter(provider => provider.providerKey === binding.providerDefinitionRef);
    const initial = initials[0];
    const processes = definitions[0]?.processes?.filter(process => process.processKey === initial?.processKey) ?? [];
    const abilities = definitions[0]?.abilities?.filter(ability => initial?.abilityRef
      === `${binding.source}.provider[${binding.providerRef}].ability[${ability.abilityKey}]`) ?? [];
    const ability = abilities[0], process = processes[0];
    if (initials.length !== 1 || definitions.length !== 1 || processes.length !== 1 || !process?.cooldown
      || process.skillKey !== item.skillKey || abilities.length !== 1 || ability?.skillKey !== item.skillKey
      || ability.kind !== 'active' || ability.processControl?.action !== 'INITIAL'
      || ability.processControl.processKey !== process.processKey || ability.processControl.useRefFromEvent === true) {
      fail('普攻减冷却需要同来源真实INITIAL能力及其普通过程冷却');
    }
    item.operation.abilityRef = initial!.abilityRef;
  }
}
