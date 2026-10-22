import { describe, expect, it } from 'vitest';
import type { DoneResult, ProcessDefinition, ProcessInstanceSnapshot, SkillActionBinding, SkillActionPlan } from '../types/genericEngine';
import { inspectProcessSkillHitStages, processSkillHitTimes } from './processSkillHitStageFacts';

function sample() {
  const definition: ProcessDefinition = { processKey: 'cast', skillKey: 'staged', steps: [250, 750, 750].map((delay, index) => ({
    stepKey: `phase_${index}`, stepType: 'DELAY', occupiesAction: index === 0, delayMs: { op: 'const', value: delay }
  })) };
  const binding: SkillActionBinding = { bindingKey: 'actual', source: 'source', providerRef: 'mounted', providerDefinitionRef: 'definition', skillKey: 'staged',
    controls: [{ action: 'INITIAL', processKey: 'cast', abilityRef: 'source.provider[mounted].ability[start]' }],
    hitBindings: definition.steps.map((step, index) => ({ hitBindingKey: `hit_${index}`, processKey: 'cast',
      moment: { momentType: 'STEP_EXECUTION', stepKey: step.stepKey, failureReason: null }, hitAbilityRef: `source.provider[mounted].ability[hit_${index}]`,
      ...(index ? { requiresPriorHitBindingKey: 'hit_0' } : {}) })) };
  const process: ProcessInstanceSnapshot = { owner: 'source', providerRef: 'mounted', processKey: 'cast', skillKey: 'staged', useKey: 'original_use', target: 'target',
    startedAtMs: 0, stepKey: 'phase_2', stepVersion: 3, stepExecutionIndex: 1, lastExecutionAtMs: 1750, stepCompletedAtMs: 1750,
    stepStartedAtMs: 1000, advanceAtMs: 1750, expiresAtMs: null, actualCosts: {}, cooldownStarted: true, status: 'complete', failureReason: null,
    finishedAtMs: 1750, repeat: null, actionOccupancies: [], skillHitStages: [250, 1000, 1750].map((timeMs, index) => ({
      hitBindingKey: `hit_${index}`, stepKey: `phase_${index}`, timeMs, released: true, contact: true, completed: true
    })) };
  const presets: SkillActionPlan['hitBindings'] = binding.hitBindings.map(hit => ({ hitBindingKey: hit.hitBindingKey, preset: 'TARGET_HIT' }));
  return { binding, definition, process, presets };
}

describe('不可截断阶段提交事实', () => {
  it.each(['owner', 'providerRef', 'skillKey', 'processKey'] as const)('拒绝外来过程身份：%s', field => {
    const { binding, definition, process, presets } = sample();
    (process as unknown as Record<string, unknown>)[field] = field === 'owner' ? 'target' : 'foreign';
    expect(() => inspectProcessSkillHitStages(binding, definition, process, presets, 2000)).toThrow('实际拥有者');
  });
  it('逐阶段绑定真实时点，旧最后时刻不能替代早期命中', () => {
    const { binding, definition, process, presets } = sample();
    const facts = inspectProcessSkillHitStages(binding, definition, process, presets, 2000);
    expect(facts?.map(fact => fact.timeMs)).toEqual([250, 1000, 1750]);
    expect(processSkillHitTimes(process, binding.hitBindings[0]!)).toEqual([250]);
    expect(processSkillHitTimes(process, binding.hitBindings[1]!)).toEqual([1000]);
  });

  it('首段MISS只释放首段，后续步骤可以执行但不得发布释放或接触', () => {
    const { binding, definition, process, presets } = sample();
    presets[0]!.preset = 'MISS'; process.skillHitStages![0]!.contact = false;
    for (const fact of process.skillHitStages!.slice(1)) { fact.contact = false; fact.released = false; }
    expect(inspectProcessSkillHitStages(binding, definition, process, presets, 2000)?.filter(fact => fact.released)).toHaveLength(1);
    expect(processSkillHitTimes(process, binding.hitBindings[1]!)).toEqual([]);
  });

  it('首段真实接触后失败未完整提交，不授予后续资格', () => {
    const { binding, definition, process, presets } = sample();
    process.status = 'active'; process.finishedAtMs = null;
    process.skillHitStages![0]!.completed = false;
    for (const fact of process.skillHitStages!.slice(1)) { fact.contact = false; fact.released = false; }
    expect(inspectProcessSkillHitStages(binding, definition, process, presets, 2000)?.[0]).toMatchObject({ contact: true, completed: false });
    process.skillHitStages![1]!.released = true;
    expect(() => inspectProcessSkillHitStages(binding, definition, process, presets, 2000)).toThrow('前置资格');
  });

  function sameTimeDeath() {
    const { binding, definition, process, presets } = sample();
    for (const hit of binding.hitBindings) delete hit.requiresPriorHitBindingKey;
    process.skillHitStages![1]!.timeMs = 1750;
    Object.assign(process.skillHitStages![2]!, { contact: false, completed: false });
    const done = { ok: true, summary: { stopReason: 'target_dead', durationMs: 1750, targetFinalHp: 0,
      execution: { requestedDurationMs: 2000, complete: true, incompleteReason: null, budgetCause: null, targetKilled: true, targetKilledAtMs: 1750 } },
      finalSnapshot: { timeMs: 1750, combatants: [{ key: 'target', attributes: { hp: { current: 0, max: 1000 } } }] } } as DoneResult;
    return { binding, definition, process, presets, done };
  }

  it('同刻前段致死后的独立阶段保留释放而没有接触，过程仍真实完成', () => {
    const { binding, definition, process, presets, done } = sameTimeDeath();
    const stages = inspectProcessSkillHitStages(binding, definition, process, presets, 1750, done);
    expect(stages?.[2]).toEqual({ hitBindingKey: 'hit_2', stepKey: 'phase_2', timeMs: 1750, released: true, contact: false, completed: false });
    expect(stages?.filter(stage => stage.contact)).toHaveLength(2);
  });

  it.each(['alive', 'wrong_stop', 'incomplete', 'budget', 'killed_false', 'kill_time', 'final_time', 'summary_time',
    'different_target', 'duplicate_target', 'finished_time', 'step_completed_time', 'earlier_stage', 'contact_true'])(
    '同刻死亡豁免仍拒绝不完整或不相符的停止证明：%s', kind => {
      const { binding, definition, process, presets, done } = sameTimeDeath();
      if (kind === 'alive') done.finalSnapshot.combatants[0]!.attributes.hp!.current = 1;
      if (kind === 'wrong_stop') done.summary.stopReason = 'duration_reached';
      if (kind === 'incomplete') done.summary.execution!.complete = false;
      if (kind === 'budget') done.summary.execution!.budgetCause = 'max_events';
      if (kind === 'killed_false') done.summary.execution!.targetKilled = false;
      if (kind === 'kill_time') done.summary.execution!.targetKilledAtMs = 1749;
      if (kind === 'final_time') done.finalSnapshot.timeMs = 1751;
      if (kind === 'summary_time') done.summary.durationMs = 1751;
      if (kind === 'different_target') process.target = 'source';
      if (kind === 'duplicate_target') done.finalSnapshot.combatants.push(structuredClone(done.finalSnapshot.combatants[0]!));
      if (kind === 'finished_time') process.finishedAtMs = 1751;
      if (kind === 'step_completed_time') process.stepCompletedAtMs = 1751;
      if (kind === 'earlier_stage') process.skillHitStages![2]!.timeMs = 1749;
      if (kind === 'contact_true') process.skillHitStages![2]!.contact = true;
      expect(() => inspectProcessSkillHitStages(binding, definition, process, presets, 1750, done)).toThrow('skillHitStages');
    });

  it.each(['missing', 'duplicate', 'foreign', 'wrong_step', 'future_time', 'reversed', 'extra_field', 'missing_completed', 'absent_progress'])(
    '拒绝缺失、跨阶段或伪造的原生事实：%s', kind => {
      const { binding, definition, process, presets } = sample();
      if (kind === 'missing') process.skillHitStages = undefined;
      if (kind === 'duplicate') process.skillHitStages!.push({ ...process.skillHitStages![0]! });
      if (kind === 'foreign') process.skillHitStages![0]!.hitBindingKey = 'foreign';
      if (kind === 'wrong_step') process.skillHitStages![0]!.stepKey = 'phase_1';
      if (kind === 'future_time') process.skillHitStages![2]!.timeMs = 2001;
      if (kind === 'reversed') process.skillHitStages!.reverse();
      if (kind === 'extra_field') (process.skillHitStages![0] as unknown as Record<string, unknown>).extra = 1;
      if (kind === 'missing_completed') delete (process.skillHitStages![0] as unknown as Record<string, unknown>).completed;
      if (kind === 'absent_progress') process.skillHitStages!.pop();
      expect(() => inspectProcessSkillHitStages(binding, definition, process, presets, 2000)).toThrow('skillHitStages');
    }
  );

  it('首段前保留明确空数组，旧隐式末尾不要求新字段', () => {
    const { binding, definition, process, presets } = sample();
    process.stepKey = 'phase_0'; process.stepVersion = 1; process.stepExecutionIndex = 0; process.skillHitStages = [];
    process.status = 'active'; process.lastExecutionAtMs = null; process.finishedAtMs = null;
    expect(inspectProcessSkillHitStages(binding, definition, process, presets, 2000)).toEqual([]);
    binding.hitBindings = [{ ...binding.hitBindings[0]!, moment: { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null } }];
    process.skillHitStages = undefined;
    expect(inspectProcessSkillHitStages(binding, definition, process, presets, 2000)).toBeUndefined();
  });
});
