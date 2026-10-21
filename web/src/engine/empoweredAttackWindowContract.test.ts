import { describe, expect, it } from 'vitest';
import type { CompileRequest, DoneResult, ProcessInstanceSnapshot, RunRequest, SkillUseRecord } from '../types/genericEngine';
import { empoweredAttackBinding, empoweredConsumptionIssue, empoweredDamageProcess, empoweredUseRecordIssue, inspectEmpoweredAttackFacts } from './empoweredAttackContract';

const constant = (value: number) => ({ op: 'const' as const, value });
function sample() {
  const payloadRef = 'source.provider[window_mount].ability[payload]';
  const compile = { combatants: [{ key: 'source', providers: [{ providerRef: 'window_mount', definitionRef: 'window' }, { providerRef: 'basic_mount', definitionRef: 'basic' }] }],
    sharedProviders: [{ providerKey: 'window', kind: 'character', stableId: 'window', skillKey: 'window_skill', processes: [{ processKey: 'cast', skillKey: 'window_skill',
      steps: [{ stepKey: 'wait', stepType: 'EMPOWERED_BASIC_ATTACK', occupiesAction: false, windowMs: constant(6000), consumeMoment: 'ATTACK_START', maximumAttackCount: constant(3) }] }],
    abilities: [{ abilityKey: 'activate', skillKey: 'window_skill', kind: 'active', processControl: { processKey: 'cast', action: 'INITIAL' } },
      { abilityKey: 'payload', skillKey: 'window_skill', kind: 'active', operations: [{ operation: 'resolve_skill_hit', skillHit: { skillKey: 'window_skill', candidates: [{
        candidateKey: 'damage', semantic: { resultType: 'DAMAGE', moment: 'INSTANT' }, operations: [{ operation: 'damage', target: 'target', amount: constant(10) }] }] } }] }] },
    { providerKey: 'basic', skillKey: 'basic_skill', abilities: [{ abilityKey: 'initial', kind: 'active', skillKey: 'basic_skill',
      processControl: { action: 'INITIAL', processKey: 'attack', useRefFromEvent: true } }, { abilityKey: 'start', kind: 'active', skillKey: 'basic_skill' },
    { abilityKey: 'hit', kind: 'active', skillKey: 'basic_skill', operations: [{ operation: 'resolve_skill_hit', skillHit: { skillKey: 'basic_skill', candidates: [] } }] }],
    processes: [{ processKey: 'attack', skillKey: 'basic_skill', cooldown: { durationMs: constant(1000), startMoment: { momentType: 'PROCESS_START', stepKey: null } } }] }],
    rules: { skillActionBindings: [{ bindingKey: 'window', source: 'source', providerRef: 'window_mount', providerDefinitionRef: 'window', skillKey: 'window_skill',
      controls: [{ action: 'INITIAL', processKey: 'cast', abilityRef: 'source.provider[window_mount].ability[activate]' }],
      hitBindings: [{ hitBindingKey: 'payload', processKey: 'cast', hitAbilityRef: payloadRef, moment: { momentType: 'STEP_EXECUTION', stepKey: 'wait', failureReason: null } }] }] }
  } as unknown as CompileRequest;
  const request = { stopPolicy: { durationMs: 4000 }, driverPlan: { basicAttack: { source: 'source', target: 'target', skillKey: 'basic_skill',
    initialControlAbilityRef: 'source.provider[basic_mount].ability[initial]', startAbilityRef: 'source.provider[basic_mount].ability[start]', hitAbilityRef: 'source.provider[basic_mount].ability[hit]' } } } as RunRequest;
  const process = { owner: 'source', target: 'source', providerRef: 'window_mount', skillKey: 'window_skill', processKey: 'cast', useKey: 'activation', stepKey: 'wait',
    stepVersion: 1, stepExecutionIndex: 0, lastExecutionAtMs: null, stepCompletedAtMs: 3000, startedAtMs: 0, stepStartedAtMs: 0, advanceAtMs: 0,
    expiresAtMs: 6000, status: 'complete', failureReason: null, finishedAtMs: 3000, actionOccupancies: [], repeat: null, cooldownStarted: true, actualCosts: {},
    empoweredAttackWindow: { maximumAttackCount: 3, consumptionCount: 3, pendingHitCount: 0, consumptions: [1000, 2000, 3000].map((startedAtMs, index) => ({
      consumptionIndex: index + 1, useRef: `attack_${index + 1}`, target: 'target', startedAtMs, hitRef: `hit_${index + 1}`, hitSequence: 1,
      resolvedAtMs: index === 2 ? 3500 : startedAtMs })) } } as ProcessInstanceSnapshot;
  const basics = process.empoweredAttackWindow!.consumptions.map(row => ({ ...structuredClone(process), useKey: row.useRef, target: 'target', providerRef: 'basic_mount',
    skillKey: 'basic_skill', processKey: 'attack', startedAtMs: row.startedAtMs, finishedAtMs: row.resolvedAtMs, empoweredAttackWindow: undefined } as ProcessInstanceSnapshot));
  const damageRecords = process.empoweredAttackWindow!.consumptions.flatMap((row, index) => [
    { damageId: index * 2 + 1, abilityRef: request.driverPlan.basicAttack!.hitAbilityRef, useRef: row.useRef, hitRef: row.hitRef, timeMs: row.resolvedAtMs!,
      source: 'source', target: 'target', attackIndex: index + 1 },
    { damageId: index * 2 + 2, abilityRef: payloadRef, useRef: process.useKey, hitRef: row.hitRef, timeMs: row.resolvedAtMs!, source: 'source', target: 'target',
      attackIndex: index + 1, empoweredAttack: { useRef: row.useRef, hitRef: row.hitRef!, target: row.target } }
  ]);
  const done = { summary: { durationMs: 4000, execution: { complete: true } }, finalSnapshot: { processInstances: [process, ...basics] },
    attackRecords: process.empoweredAttackWindow!.consumptions.map((row, index) => ({ attackIndex: index + 1, source: 'source', target: 'target', skillKey: 'basic_skill',
      useRef: row.useRef, startAtMs: row.startedAtMs, hitAtMs: row.resolvedAtMs, completed: true })),
    damageRecords, recording: { damageRecordsTruncated: false, attackRecordsTruncated: false }, skillUseRecords: [] } as unknown as DoneResult;
  return { compile, request, process, done, payloadRef };
}

describe('发动配额与真实原普攻的完整有界事实', () => {
  it('第三次START3000结束窗口，3500真实HIT仍保留激活use与原普攻use双身份', () => {
    const { compile, request, process, done } = sample();
    expect(empoweredAttackBinding(compile, compile.rules.skillActionBindings![0]!)!.maximumAttackCount).toBe(3);
    expect(empoweredConsumptionIssue(compile, request, process)).toBeNull();
    expect(inspectEmpoweredAttackFacts(compile, request, done)).toEqual([]);
    expect(empoweredDamageProcess(compile, done, done.damageRecords![5]!)).toBe(process);
    done.damageRecords![5]!.empoweredAttack!.useRef = 'attack_2';
    expect(empoweredDamageProcess(compile, done, done.damageRecords![5]!)).toBeNull();
  });
  it('待飞行不因窗口完成填MISS，真实未命中仍消费且不退还', () => {
    const { compile, request, process, done } = sample(), window = process.empoweredAttackWindow!;
    const second = window.consumptions[1]!, third = window.consumptions[2]!;
    second.hitRef = second.hitSequence = null; second.resolvedAtMs = 2200;
    third.hitRef = third.hitSequence = third.resolvedAtMs = null; window.pendingHitCount = 1;
    request.stopPolicy.durationMs = done.summary.durationMs = 3200;
    done.attackRecords![1]!.hitAtMs = null;
    done.attackRecords![2]!.hitAtMs = null; done.attackRecords![2]!.completed = false;
    done.damageRecords = done.damageRecords!.slice(0, 2);
    expect(empoweredConsumptionIssue(compile, request, process)).toBeNull();
    expect(inspectEmpoweredAttackFacts(compile, request, done)).toEqual([]);
    expect(window.consumptionCount).toBe(3);
    done.attackRecords![1]!.hitAtMs = 2000;
    expect(inspectEmpoweredAttackFacts(compile, request, done).join(' ')).toContain('未命中终结');
    done.attackRecords![1]!.hitAtMs = null;
    done.attackRecords![2]!.completed = true; done.attackRecords![2]!.hitAtMs = 3100;
    expect(inspectEmpoweredAttackFacts(compile, request, done).join(' ')).toContain('仍待命中');
  });
  it('6000精确到期正常完成；同刻新START不能消费旧窗口', () => {
    const { compile, request, process } = sample(), window = process.empoweredAttackWindow!;
    window.consumptions.pop(); window.consumptionCount = 2;
    process.finishedAtMs = process.stepCompletedAtMs = 6000; request.stopPolicy.durationMs = 6000;
    expect(empoweredConsumptionIssue(compile, request, process)).toBeNull();
    window.consumptions[1]!.startedAtMs = 6000;
    expect(empoweredConsumptionIssue(compile, request, process)).not.toBeNull();
  });
  it.each(['missing', 'count', 'duplicate', 'pending', 'late', 'step', 'top', 'target', 'sequence', 'completed_early'] as const)('拒绝伪造窗口 %s', kind => {
    const { compile, request, process } = sample(), window = process.empoweredAttackWindow!;
    if (kind === 'missing') delete (window.consumptions[0] as unknown as Record<string, unknown>).resolvedAtMs;
    if (kind === 'count') window.consumptionCount = 2;
    if (kind === 'duplicate') window.consumptions[1]!.useRef = window.consumptions[0]!.useRef;
    if (kind === 'pending') window.pendingHitCount = 1;
    if (kind === 'late') window.consumptions[2]!.startedAtMs = 6000;
    if (kind === 'step') process.stepExecutionIndex = 3;
    if (kind === 'top') process.empoweredAttack = { useRef: 'attack_1', hitRef: 'hit_1', target: 'target' };
    if (kind === 'target') window.consumptions[0]!.target = 'source';
    if (kind === 'sequence') window.consumptions[0]!.hitSequence = 0;
    if (kind === 'completed_early') process.finishedAtMs = process.stepCompletedAtMs = 2000;
    expect(empoweredConsumptionIssue(compile, request, process)).not.toBeNull();
  });
  it('各负载事实保持零executionIndex，窗口完成事实不冒充命中', () => {
    const { compile, process, done } = sample();
    const association = { useRef: 'attack_3', hitRef: 'hit_3', target: 'target' };
    for (const kind of ['STEP_EXECUTED', 'RELEASED', 'HIT'] as const) {
      const row = { kind, source: 'source', target: 'target', providerRef: 'window_mount', useRef: process.useKey, stepKey: 'wait', stepVersion: 1,
        executionIndex: 0, timeMs: 3500, hitRef: kind === 'HIT' ? 'hit_3' : null, empoweredAttack: association } as SkillUseRecord;
      expect(empoweredUseRecordIssue(compile, done, row)).toBeNull();
      row.executionIndex = 3;
      expect(empoweredUseRecordIssue(compile, done, row)).not.toBeNull();
    }
    expect(empoweredUseRecordIssue(compile, done, { kind: 'COMPLETED', source: 'source', target: 'source', providerRef: 'window_mount', useRef: process.useKey,
      stepKey: 'wait', stepVersion: 1, executionIndex: 0, timeMs: 3000 } as SkillUseRecord)).toBeNull();
  });
  it('summary与零预算仍核完整消费，不依赖逐刀保留', () => {
    const { compile, request, done } = sample();
    request.outputMode = done.outputMode = 'summary'; request.recordBudget = { maxDamageRecords: 0, maxAttackRecords: 0 };
    done.damageRecords = []; done.attackRecords = []; done.recording!.damageRecordsTruncated = done.recording!.attackRecordsTruncated = true;
    expect(inspectEmpoweredAttackFacts(compile, request, done)).toEqual([]);
    done.finalSnapshot.processInstances![0]!.empoweredAttackWindow!.consumptions[0]!.useRef = 'invented';
    expect(inspectEmpoweredAttackFacts(compile, request, done).join(' ')).toContain('真实普攻');
  });
});
