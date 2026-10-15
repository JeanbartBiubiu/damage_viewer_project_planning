import type { AutomaticSkillInputs } from '../../src/engine/automaticSkillRequest';
import { simulationMixedSample } from './simulationMixedSkills';

/** 独立构造仅验证正式宿主和原生机制，不代表真实英雄作者数据。 */
export function simulationAutomaticSample(backgroundAttack = false, count = 2) {
  if (!Number.isSafeInteger(count) || count < 2 || count > 16) throw new Error('自动专项需要2～16项来源');
  const snapshot = simulationMixedSample(backgroundAttack, true);
  const second = snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === 'sample_second')!;
  for (let index = 2; index < count; index++) {
    const skillKey = `sample_chain_${index}`;
    const configuration = JSON.parse(JSON.stringify(second).replaceAll('sample_second', skillKey)) as typeof second;
    configuration.skill.name = `链项${index + 1}`;
    snapshot.skillConfigurations.push(configuration);
    snapshot.source.attachedSkills.push({ ...snapshot.source.attachedSkills[1]!, skillKey, skillName: configuration.skill.name });
    snapshot.source.skillSources.push({ ...snapshot.source.skillSources[1]!, skillKey, skillName: configuration.skill.name,
      enabledRuleKeys: configuration.triggerRules.map(rule => rule.ruleKey).sort() });
    snapshot.selection.plannedSkills.push({ ...snapshot.selection.plannedSkills[0]!, skillKey });
    snapshot.selection.sourceSkillSettings.push({ ...snapshot.selection.sourceSkillSettings[0]!, skillKey });
  }
  return snapshot;
}

export function automaticInputs(snapshot: ReturnType<typeof simulationAutomaticSample>, durationMs = 2600): AutomaticSkillInputs {
  return { rules: snapshot.selection.plannedSkills.map((plan, index) => ({ ...plan, ruleKey: `rule_${index}`, sortOrder: index,
    targetSide: index === 0 ? 'target' : 'source', hitPreset: index === 0 ? 'TARGET_HIT' : null,
    waitForCooldowns: index === 0 ? snapshot.selection.plannedSkills.slice(1).map((_, position) => `rule_${position + 1}`) : [],
    releaseAfterRuleKey: index === 0 ? null : `rule_${index - 1}` })),
    durationMs, recordTimeSeries: false, attackSpeedInputMax: 10, maxAutomaticSkillRecords: 1000, maxHealingRecords: 1000, outputMode: 'detailed' };
}
