import { describe, expect, it } from 'vitest';
import { simulationActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { fixedValue } from '../types/numericValue';
import { processSkillHitStages, automaticProcessStepsAllowed } from './processSkillHitStages';
import { assembleActiveSkills } from './simulationActiveSkills';
import type { SkillTriggerRuleDetail } from '../types/skillTriggerRule';

function sample() {
  const snapshot = simulationActiveSample();
  const configuration = snapshot.skillConfigurations.find(row => row.skill.skillKey === 'sample_active')!;
  const process = configuration.processes[0]!;
  process.steps = [250, 750, 750].map((delay, index) => ({ stepKey: `stage_${index}`, name: '有限阶段', description: null,
    sortOrder: index, occupiesAction: index === 0, stepType: 'DELAY', detail: { delayValue: fixedValue(delay) } }));
  const original = configuration.triggerRules.find(row => row.eventSource.eventType === 'SKILL_HIT')!;
  const rules: SkillTriggerRuleDetail[] = process.steps.map((step, index) => ({ ...structuredClone(original), ruleKey: `hit_${index}`,
    sortOrder: index, eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: configuration.skill.skillKey,
      processMoment: { processKey: process.processKey, moment: { momentType: 'STEP_EXECUTION', stepKey: step.stepKey }, requiresPriorStepKey: index ? 'stage_0' : null } } } }));
  configuration.triggerRules = [configuration.triggerRules[0]!, ...rules];
  snapshot.source.skillSources.find(row => row.skillKey === configuration.skill.skillKey)!.enabledRuleKeys = configuration.triggerRules.map(rule => rule.ruleKey).sort();
  return { snapshot, configuration, process, rules };
}

describe('完整主动过程分阶段命中合同', () => {
  it('保持原作者对象，按真实步骤合并候选并降低严格更早依赖', () => {
    const { configuration, process, rules } = sample();
    const extra = { ...structuredClone(rules[0]!), ruleKey: 'another_first', sortOrder: 10 };
    const original = structuredClone([process, rules, extra]);
    const stages = processSkillHitStages(configuration.skill.skillKey, process, [...rules].reverse().concat(extra));
    expect(stages).toHaveLength(3);
    expect(stages[0]!.rules.map(rule => rule.ruleKey)).toEqual(['hit_0', 'another_first']);
    expect(stages.map(stage => stage.moment.stepKey)).toEqual(['stage_0', 'stage_1', 'stage_2']);
    expect(stages.map(stage => stage.requiresPriorHitBindingKey)).toEqual([undefined, 'selected_skill_release_hit_0', 'selected_skill_release_hit_0']);
    expect(stages.flatMap(stage => stage.rules).every(rule => !('processMoment' in rule.eventSource.detail))).toBe(true);
    expect([process, rules, extra]).toEqual(original);
  });

  it.each(['legacy', 'null_source', 'foreign_skill', 'foreign_process', 'missing_step', 'self', 'forward', 'no_hit', 'extra_moment', 'null_phase', 'mixed_dependency', 'ambiguous_order', 'too_many'])(
    '拒绝不完整或含糊的阶段图：%s', kind => {
      const { configuration, process, rules } = sample();
      const second = rules[1]!.eventSource;
      if (second.eventType !== 'SKILL_HIT' || !second.detail.processMoment) throw new Error('fixture');
      const phase = second.detail.processMoment;
      if (kind === 'legacy') delete second.detail.processMoment;
      if (kind === 'null_source') second.detail.sourceSkillKey = null;
      if (kind === 'foreign_skill') second.detail.sourceSkillKey = 'other';
      if (kind === 'foreign_process') phase.processKey = 'other';
      if (kind === 'missing_step') phase.moment.stepKey = 'missing';
      if (kind === 'self') phase.requiresPriorStepKey = 'stage_1';
      if (kind === 'forward') phase.requiresPriorStepKey = 'stage_2';
      if (kind === 'no_hit') rules.splice(0, 1);
      if (kind === 'extra_moment') (phase.moment as unknown as Record<string, unknown>).failureReason = null;
      if (kind === 'null_phase') (second.detail as unknown as Record<string, unknown>).processMoment = null;
      if (kind === 'mixed_dependency') {
        const extra = structuredClone(rules[1]!); extra.ruleKey = 'different_dependency'; extra.sortOrder = 20;
        if (extra.eventSource.eventType === 'SKILL_HIT') extra.eventSource.detail.processMoment!.requiresPriorStepKey = null;
        rules.push(extra);
      }
      if (kind === 'ambiguous_order') process.steps[1]!.sortOrder = 0;
      if (kind === 'too_many') process.steps = Array.from({ length: 65 }, (_, index) => ({ ...process.steps[0]!, stepKey: `step_${index}`, sortOrder: index }));
      expect(() => processSkillHitStages(configuration.skill.skillKey, process, rules)).toThrow();
    }
  );

  it('普通单末尾保持旧绑定，直接独立阶段不得吞隐式自然规则', () => {
    const { snapshot, configuration, process, rules } = sample();
    const legacy = structuredClone(rules[0]!);
    if (legacy.eventSource.eventType === 'SKILL_HIT') { legacy.eventSource.detail = { sourceSkillKey: null }; }
    const single = processSkillHitStages(configuration.skill.skillKey, process, [legacy]);
    expect(single[0]).toMatchObject({ abilityKey: 'selected_skill_hit', moment: { momentType: 'PROCESS_COMPLETE', stepKey: null } });
    configuration.triggerRules.push({ ...legacy, ruleKey: 'implicit_listener' });
    expect(() => assembleActiveSkills(snapshot)).toThrow(/混合/);
  });

  it('仅新增多步显式阶段要求真实延时，保留旧单即时入口', () => {
    const { configuration, process, rules } = sample();
    process.steps = process.steps.map(step => ({ ...step, stepType: 'IMMEDIATE' as const, detail: {} }));
    expect(() => processSkillHitStages(configuration.skill.skillKey, process, rules)).toThrow();
    process.steps = process.steps.slice(0, 1);
    expect(processSkillHitStages(configuration.skill.skillKey, process, rules.slice(0, 1))).toHaveLength(1);
  });

  it('生产装配每阶段建立实际能力来源，同阶段仍只有一个hitBinding', () => {
    const { snapshot, configuration } = sample();
    approveSnapshotFixture(snapshot);
    const result = assembleActiveSkills(snapshot);
    expect(result.bindings[0]!.hitBindings.map(hit => hit.moment.stepKey)).toEqual(['stage_0', 'stage_1', 'stage_2']);
    expect(result.operationOrigins).toHaveLength(3);
    expect(new Set(result.operationOrigins.map(origin => origin.abilityRef)).size).toBe(3);
    expect(result.operationOrigins.every(origin => origin.skillKey === configuration.skill.skillKey)).toBe(true);
  });

  it('自动准入新增有正延时的普通链，原单即时合法、复杂多步仍拒绝', () => {
    const immediate = { stepKey: 'now', stepType: 'IMMEDIATE' as const, occupiesAction: false };
    const delay = { stepKey: 'wait', stepType: 'DELAY' as const, occupiesAction: true, delayMs: { op: 'const', value: 250 } };
    expect(automaticProcessStepsAllowed({ steps: [immediate] })).toBe(true);
    expect(automaticProcessStepsAllowed({ steps: [immediate, delay] })).toBe(true);
    expect(automaticProcessStepsAllowed({ steps: [immediate, { ...immediate, stepKey: 'two' }] })).toBe(false);
    expect(automaticProcessStepsAllowed({ steps: [immediate, { ...delay, delayMs: { op: 'const', value: 0 } }] })).toBe(false);
    expect(automaticProcessStepsAllowed({ steps: [delay, { stepKey: 'complex', stepType: 'CHANNEL' }] })).toBe(false);
  });
});
