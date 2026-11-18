import { simulationBasicAttackContribution } from './simulationBasicAttackContribution';
import { simulationActiveSample } from './simulationActiveSkill';
import { syncSimulationSkillSources } from './simulationSkillSources';
import { naturalRuleKeys, plannedSkillRuleKeys } from '../../src/engine/simulation/sources/description';
import { fixedValue } from '../../src/types/numericValue';
import type { SkillConfiguration } from '../../src/types/skillConfiguration';
import type { SkillTriggerRuleDetail } from '../../src/types/skillTriggerRule';
import type { SkillProcessMoment } from '../../src/types/skillProcess';

/** 独立机制向量：单一武装可由普攻或明确技能消费，另一个计数附伤跟随同击阻挡。 */
export function simulationConditionalHitComposition(background = true, contact = true, follower = true, targetShield = false) {
  const { snapshot, configuration: window } = simulationBasicAttackContribution('armed_bonus', 'parent_attack');
  const primary = snapshot.skillConfigurations[0]!.effects[1]!.results[0]!;
  if (primary.resultType !== 'DAMAGE') throw new Error('fixture primary');
  primary.detail.attackDamageRole = 'PRIMARY';
  const active = simulationActiveSample();
  const activeConfiguration = active.skillConfigurations.find(row => row.skill.skillKey === 'sample_active')!;
  const contactConfiguration = JSON.parse(JSON.stringify(activeConfiguration).replaceAll('sample_active', 'contact_spell')) as SkillConfiguration;
  contactConfiguration.effects[0]!.results[0]!.spellShieldBlockScope = 'SKILL';
  snapshot.catalogs.skillCategories.push({ ...snapshot.catalogs.skillCategories[0]!, skillCategoryKey: 'active', name: '主动' });
  window.skill.skillCategoryKeys = ['active'];
  const owner = { kind: 'CHARACTER' as const, characterKey: snapshot.selection.sourceCharacterKey };
  const moment = (momentType: SkillProcessMoment['momentType'], stepKey: string | null = null): SkillProcessMoment => ({ momentType, stepKey, failureReason: null });
  const metadata = { gameId: snapshot.gameId, skillKey: window.skill.skillKey, createdAt: '', updatedAt: '', description: null, sortOrder: 0 };
  const counterCondition = (skillKey: string, stateKey: string, value: number) => ({ conditionKey: stateKey, conditionType: 'INTERNAL_STATE_CHECK' as const,
    sortOrder: 0, detail: { stateSkillKey: skillKey, stateKey, valueKind: 'VALUE' as const, optionKey: null, expectedBoolean: null,
      comparator: 'EQ' as const, comparisonValue: fixedValue(value) } });
  const rule = (ruleKey: string, eventSource: SkillTriggerRuleDetail['eventSource'], actions: SkillTriggerRuleDetail['actions'], armed = true): SkillTriggerRuleDetail => ({
    ruleKey, name: ruleKey, description: null, sortOrder: 0, eventSource, actions, oncePerUse: null, perTargetCooldown: null, maxTriggersPerProcess: null,
    conditionGroups: [{ groupKey: 'state', name: '自身当前计数', sortOrder: 0,
      conditions: [counterCondition('armed_bonus', 'armed', armed ? 1 : 0)] }]
  });
  const action = (actionType: 'EXECUTE_EFFECT' | 'START_PROCESS', key: string): SkillTriggerRuleDetail['actions'][number] => actionType === 'EXECUTE_EFFECT'
    ? { actionKey: key, name: key, actionType, sortOrder: 0, targetContext: 'CURRENT_TARGET', detail: { effectKey: key }, runtimeInputBindings: [], resultModifiers: [] }
    : { actionKey: key, name: key, actionType, sortOrder: 0, targetContext: 'CURRENT_TARGET', detail: { processKey: key }, runtimeInputBindings: [], resultModifiers: [] };
  const damage = window.effects[0]!.results[0]!;
  if (damage.resultType !== 'DAMAGE') throw new Error('fixture damage');
  damage.detail.deliveryKind = 'SKILL'; damage.detail.critical = { mode: 'DISALLOWED', multiplierValue: null };
  damage.spellShieldBlockScope = 'RESULT';
  window.effects.push({ ...metadata, effectKey: 'reset', name: '重置', lifecycle: null, results: [{ resultKey: 'reset', name: '重置', description: null,
    sortOrder: 0, resultType: 'ATTACK_TIMER_RESET', target: 'SOURCE', valueRule: null, detail: {}, lifecycleBehavior: null, spellShieldBlockScope: null }] },
  { ...metadata, effectKey: 'end_cooldown', name: '窗口结束冷却', lifecycle: null, results: [{ resultKey: 'cooldown', name: '冷却', description: null, sortOrder: 0,
    resultType: 'COOLDOWN_CHANGE', target: 'SOURCE', valueRule: { value: fixedValue(700.49), fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
    detail: { operation: 'SET_REMAINING', affectedSkillScope: { mode: 'SKILLS', skillKeys: ['armed_bonus'], skillCategoryKeys: [] } },
    lifecycleBehavior: null, spellShieldBlockScope: null }] });
  window.internalStates = [{ ...metadata, stateKey: 'armed', name: '一次武装', stateType: 'COUNTER', scope: 'SKILL',
    detail: { initialValue: fixedValue(0), maxValue: fixedValue(1), durationValue: fixedValue(500) } }];
  const instant = { stepKey: 'instant', name: '即时', description: null, sortOrder: 0, stepType: 'IMMEDIATE' as const, occupiesAction: false, detail: {} };
  const state = (value: number) => ({ operationKey: 'set', name: '设置', sortOrder: 0, stateSkillKey: 'armed_bonus', stateKey: 'armed',
    moment: moment('STEP_EXECUTION', 'instant'), operation: 'SET' as const, value: fixedValue(value), optionKey: null });
  window.processes = [{ ...metadata, processKey: 'cast', name: '武装', activationType: 'ACTIVE', cooldown: null, steps: [instant],
    stateOperations: [state(1)], effectBindings: [{ bindingKey: 'reset', effectKey: 'reset', sortOrder: 0, moment: moment('PROCESS_START') }] },
  { ...metadata, processKey: 'consume', name: '消费', activationType: 'PASSIVE', cooldown: null, steps: [structuredClone(instant)], stateOperations: [state(0)],
    effectBindings: [{ bindingKey: 'cooldown', effectKey: 'end_cooldown', sortOrder: 1, moment: moment('STEP_EXECUTION', 'instant') }] }];
  const initial = rule('cast', { eventType: 'SKILL_USED', detail: { sourceSkillKey: 'armed_bonus', useKind: 'ACTIVE', castPhase: 'INITIAL' } }, [action('START_PROCESS', 'cast')], false);
  initial.conditionGroups[0]!.conditions.unshift({ conditionKey: 'self', conditionType: 'EXPLICIT_TARGET_IS_SOURCE', sortOrder: -1, detail: {} });
  window.triggerRules = [initial,
    rule('basic_damage', { eventType: 'BASIC_ATTACK_HIT', detail: {} }, [action('EXECUTE_EFFECT', 'extra')]),
    rule('contact_damage', { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'contact_spell' } }, [action('EXECUTE_EFFECT', 'extra')]),
    rule('basic_consume', { eventType: 'BASIC_ATTACK_HIT', detail: {} }, [action('START_PROCESS', 'consume')]),
    rule('contact_consume', { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'contact_spell' } }, [action('START_PROCESS', 'consume')]),
    { ...rule('expire', { eventType: 'INTERNAL_STATE_CHANGED', detail: { stateSkillKey: 'armed_bonus', stateKey: 'armed', changeKind: 'VALUE_CHANGED' } }, [action('EXECUTE_EFFECT', 'end_cooldown')]),
      conditionGroups: [{ groupKey: 'end', name: '冻结1至0', sortOrder: 0, conditions: [
        { conditionKey: 'before', conditionType: 'EVENT_VALUE_COMPARE', sortOrder: 0, detail: { eventValueKey: 'STATE_BEFORE', comparator: 'EQ', comparisonValue: fixedValue(1) } },
        { conditionKey: 'after', conditionType: 'EVENT_VALUE_COMPARE', sortOrder: 1, detail: { eventValueKey: 'STATE_AFTER', comparator: 'EQ', comparisonValue: fixedValue(0) } }
      ] }] }];
  snapshot.skillConfigurations.push(contactConfiguration);
  snapshot.source.attachedSkills.push({ ...snapshot.source.attachedSkills[0]!, skillKey: 'contact_spell', skillName: '明确接触技能' });
  snapshot.selection.sourceSkillSettings.push({ origin: owner, skillKey: 'contact_spell', enabled: contact, skillLevel: 1 });
  snapshot.selection.plannedSkills = [{ origin: owner, skillKey: 'armed_bonus', skillLevel: 2, phaseKinds: ['INITIAL'] },
    ...(contact ? [{ origin: owner, skillKey: 'contact_spell', skillLevel: 1, phaseKinds: ['INITIAL' as const] }] : [])];
  if (!background) { snapshot.selection.basicAttackSkillKey = null; snapshot.selection.basicAttackLevel = null; }
  if (follower) {
    const bonus = simulationBasicAttackContribution('follow_bonus').configuration;
    bonus.internalStates = [{ ...metadata, skillKey: 'follow_bonus', stateKey: 'ready', name: '自身计数', stateType: 'COUNTER', scope: 'SKILL',
      detail: { initialValue: fixedValue(1), maxValue: fixedValue(1), durationValue: null } }];
    bonus.triggerRules[0]!.conditionGroups = [{ groupKey: 'ready', name: '自身条件', sortOrder: 0, conditions: [counterCondition('follow_bonus', 'ready', 1)] }];
    const followDamage = bonus.effects[0]!.results[0]!;
    if (followDamage.resultType !== 'DAMAGE') throw new Error('fixture follower');
    followDamage.detail.critical = { mode: 'DISALLOWED', multiplierValue: null };
    followDamage.detail.spellShieldFollowResult = { skillKey: 'armed_bonus', effectKey: 'extra', resultKey: 'damage' };
    snapshot.skillConfigurations.push(bonus);
    snapshot.source.attachedSkills.push({ ...snapshot.source.attachedSkills[0]!, skillKey: 'follow_bonus', skillName: '同击跟随附伤' });
    snapshot.selection.sourceSkillSettings.push({ origin: owner, skillKey: 'follow_bonus', enabled: true, skillLevel: 2 });
  }
  if (targetShield) {
    const guard: SkillConfiguration = { skill: { ...window.skill, skillKey: 'guard', maxLevel: 1, skillCategoryKeys: ['passive'] },
      parameters: [], formulas: [], processes: [], internalStates: [], baseDigest: 'independent_guard', effects: [
        { ...metadata, skillKey: 'guard', effectKey: 'shield', name: '自身单层法盾', lifecycle: { durationValue: null,
          maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1), instanceScope: 'SOURCE', reapplicationStackMode: 'KEEP',
          reapplicationDurationMode: null, expiryMode: 'EXPLICIT_ONLY', periodicIntervalValue: null, firstPeriodicExecution: null },
          results: [{ resultKey: 'shield', name: '法盾', description: null, sortOrder: 0, resultType: 'SPELL_SHIELD', target: 'SOURCE',
            spellShieldBlockScope: null, valueRule: null, detail: {}, lifecycleBehavior: { moment: 'PERSISTENT', valueReadMode: null,
              stackValueMode: null, reapplicationValueMode: null, periodicExecutionMode: null } }] },
        { ...metadata, skillKey: 'guard', effectKey: 'consume', name: '消费被冻结的盾', lifecycle: null, results: [{ resultKey: 'remove', name: '消费',
          description: null, sortOrder: 0, resultType: 'LIFECYCLE_OPERATION', target: 'SOURCE', valueRule: null, spellShieldBlockScope: null,
          lifecycleBehavior: null, detail: { targetEffectKey: 'shield', operation: 'REMOVE' } }] }
      ], triggerRules: [
        { ...rule('initialize', { eventType: 'SOURCE_INITIALIZED', detail: {} }, [action('EXECUTE_EFFECT', 'shield')]), conditionGroups: [] },
        { ...rule('consume', { eventType: 'SPELL_SHIELD_BLOCKED', detail: { shieldEffectKey: 'shield' } }, [action('EXECUTE_EFFECT', 'consume')]), conditionGroups: [] }
      ] };
    guard.triggerRules[0]!.actions[0]!.targetContext = 'EVENT_SOURCE';
    snapshot.skillConfigurations.push(guard);
    snapshot.target.attachedSkills.push({ ...snapshot.target.attachedSkills[0]!, skillKey: 'guard', skillName: '独立单层法盾' });
    snapshot.selection.targetSkillSettings.push({ origin: { kind: 'CHARACTER', characterKey: snapshot.selection.targetCharacterKey },
      skillKey: 'guard', enabled: true, skillLevel: 1 });
  }
  syncSimulationSkillSources(snapshot);
  for (const source of snapshot.source.skillSources) {
    const plan = snapshot.selection.plannedSkills.find(row => row.skillKey === source.skillKey);
    const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === source.skillKey)!;
    if (plan && source.inactiveReason === null) source.enabledRuleKeys = [...new Set([
      ...naturalRuleKeys(snapshot, configuration, 'source', source), ...plannedSkillRuleKeys(configuration, plan.phaseKinds)
    ])].sort();
  }
  return { snapshot, window, contact: contactConfiguration };
}
