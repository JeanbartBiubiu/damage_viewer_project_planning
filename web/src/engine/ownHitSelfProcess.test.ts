import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseMechanismCase } from '../../tests/mechanisms/mechanismCase';
import { isOwnHitSelfProcessRule } from './ownHitSelfProcess';
import { naturalRuleKeys, plannedSkillRuleKeys } from './simulation/sources/description';

function sample(noBasic = false) {
  const file = fileURLToPath(new URL(`../../tests/mechanisms/cases/own_hit_self_snapshot_${noBasic ? 'hit_without_basic' : 'hit'}.json`, import.meta.url));
  const snapshot = parseMechanismCase(readFileSync(file), file).buildSnapshot();
  const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'lab_transfer')!;
  return { snapshot, configuration, rule: configuration.triggerRules.find(row => row.ruleKey === 'on_hit_self')!,
    process: configuration.processes.find(row => row.processKey === 'self_gain')!,
    effect: configuration.effects.find(row => row.effectKey === 'transfer')! };
}

describe('真实同技能命中后的有限自身过程', () => {
  it.each([false, true])('后台普攻关闭=%s 时也由自然根执行，自身尾部不进入目标命中候选', noBasic => {
    const { snapshot, configuration, rule } = sample(noBasic);
    const source = snapshot.source.skillSources.find(row => row.skillKey === 'lab_transfer')!;
    expect(isOwnHitSelfProcessRule(configuration, rule)).toBe(true);
    expect(plannedSkillRuleKeys(configuration)).toEqual(['first_cast', 'on_hit']);
    expect(naturalRuleKeys(snapshot, configuration, 'source', source)).toContain(rule.ruleKey);
    const foreign = { ...source, origin: { kind: 'CHARACTER' as const, characterKey: 'another_character' } };
    expect(naturalRuleKeys(snapshot, configuration, 'source', foreign)).not.toContain(rule.ruleKey);
  });

  it.each(['foreign_hit', 'foreign_process', 'target_effect', 'active', 'delay', 'occupied', 'mixed_action', 'no_payload', 'phase', 'reachable_target_tail'] as const)('不会将 %s 分类为自身尾部', variant => {
    const { configuration, rule, process, effect } = sample();
    if (variant === 'foreign_hit') rule.eventSource = { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'another_skill' } };
    if (variant === 'foreign_process') process.skillKey = 'another_skill';
    if (variant === 'target_effect') effect.results[0]!.target = 'TARGET';
    if (variant === 'active') process.activationType = 'ACTIVE';
    if (variant === 'delay') process.steps[0] = { ...process.steps[0]!, stepType: 'DELAY', detail: { delayValue: { kind: 'FIXED', value: 1 } } };
    if (variant === 'occupied') process.steps[0]!.occupiesAction = true;
    if (variant === 'mixed_action') rule.actions.push(structuredClone(configuration.triggerRules.find(row => row.ruleKey === 'on_hit')!.actions[0]!));
    if (variant === 'no_payload') process.effectBindings = [];
    if (variant === 'phase') rule.eventSource = { eventType: 'SKILL_HIT', detail: { sourceSkillKey: 'lab_transfer', processMoment: {
      processKey: 'cast', moment: { momentType: 'STEP_EXECUTION', stepKey: 'cast' }, requiresPriorStepKey: null } } };
    if (variant === 'reachable_target_tail') {
      const tail = structuredClone(configuration.triggerRules.find(row => row.ruleKey === 'on_hit')!);
      tail.ruleKey = 'hidden_target_tail';
      tail.eventSource = { eventType: 'PROCESS_MOMENT', detail: { processKey: 'self_gain', moment: { momentType: 'STEP_EXECUTION', stepKey: 'apply' } } };
      configuration.triggerRules.push(tail);
    }
    expect(isOwnHitSelfProcessRule(configuration, rule)).toBe(false);
  });
});
