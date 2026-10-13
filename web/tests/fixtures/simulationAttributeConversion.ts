import { simulationSample } from './simulationSnapshot';
import { skillFormulaDefinition } from './skillFormulaDefinition';
import type { SkillConfiguration } from '../../src/types/skillConfiguration';
import type { SkillEffectAttributeChangeResult } from '../../src/types/skillEffect';
import { fixedValue, formulaValue, parameterValue } from '../../src/types/numericValue';

export function attributeConversionSample() {
  const snapshot = simulationSample('lol');
  const basic = snapshot.skillConfigurations[0]!;
  const skillKey = 'saved_attribute_conversion';
  const result = (resultKey: string, attributeKey: string, operation: 'INCREASE' | 'SET', modifierZoneKey: string | null,
    value: NonNullable<SkillEffectAttributeChangeResult['valueRule']>['value']): SkillEffectAttributeChangeResult => ({
    resultKey, name: resultKey, resultType: 'ATTRIBUTE_CHANGE', target: 'SOURCE', detail: { attributeKey, operation, modifierZoneKey },
    sortOrder: 0, description: null, spellShieldBlockScope: null,
    valueRule: { value, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null }, lifecycleBehavior: {
      moment: 'PERSISTENT', valueReadMode: operation === 'SET' ? 'APPLICATION_SNAPSHOT' : 'MOMENT_EVALUATION',
      stackValueMode: 'SHARED', reapplicationValueMode: operation === 'SET' ? 'REPLACE' : null, periodicExecutionMode: null
    }
  });
  const configuration: SkillConfiguration = { ...structuredClone(basic), skill: { ...basic.skill, skillKey, skillCategoryKeys: [] },
    parameters: [{ ...basic.parameters[0]!, skillKey, parameterKey: 'saved_speed', fixedValue: null, valueMode: 'CHARACTER_LEVEL', levelValues: { '1': .7, '2': .8 } }],
    formulas: [{ ...basic.formulas[0]!, skillKey, formulaKey: 'conversion_ratio', expression: skillFormulaDefinition('saved_attribute_conversion', { nodeType: 'OPERATION', operation: 'ADD', operands: [
      { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'bonus_attack_speed_percent', attributeValueKind: 'TOTAL' },
      { nodeType: 'ATTRIBUTE', attributeOwner: 'SOURCE', attributeKey: 'critical_strike_chance', attributeValueKind: 'TOTAL' }
    ] }) }], processes: [], internalStates: [],
    effects: [{ ...basic.effects[0]!, skillKey, effectKey: 'permanent', lifecycle: { instanceScope: 'SOURCE', expiryMode: 'EXPLICIT_ONLY',
      durationValue: null, maxStacksValue: fixedValue(1), applicationStacksValue: fixedValue(1), reapplicationStackMode: 'KEEP',
      reapplicationDurationMode: null, periodicIntervalValue: null, firstPeriodicExecution: null, endWhenShieldEndsResultKey: null }, results: [
      result('fixed_speed', 'attack_speed', 'SET', null, parameterValue('saved_speed')),
      result('converted_damage', 'attack_damage', 'INCREASE', 'ratio_multiply', formulaValue('conversion_ratio')),
      result('ordinary_damage', 'attack_damage', 'INCREASE', 'flat_add', fixedValue(7))
    ] }], triggerRules: [{ ...basic.triggerRules[0]!, ruleKey: 'initialize', eventSource: { eventType: 'SOURCE_INITIALIZED', detail: {} },
      actions: [{ ...basic.triggerRules[1]!.actions[0]!, actionType: 'EXECUTE_EFFECT', detail: { effectKey: 'permanent' }, targetContext: 'EVENT_SOURCE' }] }]
  };
  snapshot.skillConfigurations.push(configuration);
  snapshot.catalogs.modifierZones.push(...(['ratio_multiply', 'flat_add'] as const).map(key => ({ gameId: 'lol', modifierZoneKey: key,
    name: key, status: 'ENABLED' as const, domain: 'ATTRIBUTE' as const, calculationMode: key === 'ratio_multiply' ? 'RATIO_MULTIPLY' as const : 'FLAT_ADD' as const,
    applicationStage: key === 'ratio_multiply' ? 'ATTRIBUTE_PERCENT' as const : 'ATTRIBUTE_FLAT' as const, description: null, sortOrder: 0, createdAt: '', updatedAt: '' })));
  snapshot.catalogs.attributes.push({ ...snapshot.catalogs.attributes[0]!, attributeKey: 'bonus_attack_speed_percent' });
  for (const side of ['source', 'target'] as const) {
    snapshot[side].selectedLevelValues.bonus_attack_speed_percent = 0;
    snapshot[side].selectedLevelValues.critical_strike_chance = .25;
    snapshot[side].attachedSkills.push({ ...snapshot[side].attachedSkills[0]!, skillKey });
    snapshot[side].skillSources.push({ origin: { kind: 'CHARACTER', characterKey: snapshot[side].character.characterKey }, skillKey,
      skillName: configuration.skill.name, skillStatus: 'ENABLED', enabled: true, skillLevel: 1, enabledRuleKeys: ['initialize'], inactiveReason: null });
  }
  return { snapshot, configuration };
}
