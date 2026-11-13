import { describe, expect, it } from 'vitest';
import type { CompileRequest, DamageRecord, DoneResult, ProcessDefinition, ProcessInstanceSnapshot, ProviderDefinition,
  RunRequest, SkillActionBinding } from '../types/genericEngine';
import { assertPassiveProcessOutputShape, inspectPassiveProcessFacts, passiveProcessDamagePath, passiveProcessOperation } from './passiveProcessFacts';
import { indexAutomaticPresentation } from './automaticSkillPresentation';
import { inspectSimulationProcessFacts } from './simulationProcessFacts';

const stage = { hitBindingKey: 'contact', stepKey: 'cast', timeMs: 500, released: true, contact: true as const, completed: true,
  hitSequence: 1, hitOccurrenceId: 7, hitBlocked: 0 as const };
const baseProcess: ProcessInstanceSnapshot = {
  owner: 'source', target: 'target', providerRef: 'active', processKey: 'cast', skillKey: 'sample_e', useKey: 'skill:first',
  stepKey: 'cast', stepVersion: 1, stepExecutionIndex: 1, lastExecutionAtMs: 500, stepCompletedAtMs: 500,
  startedAtMs: 0, stepStartedAtMs: 0, advanceAtMs: 500, expiresAtMs: null, actualCosts: {}, cooldownStarted: true,
  status: 'complete', failureReason: null, finishedAtMs: 500, repeat: null, actionOccupancies: [], skillHitStages: [stage]
};
function fixture(end = 800) {
  const definition: ProcessDefinition = { processKey: 'later', skillKey: 'sample_w', entryKind: 'SKILL_HIT_PASSIVE',
    steps: [{ stepKey: 'wait', stepType: 'DELAY', occupiesAction: false, delayMs: { op: 'const', value: 300 } }],
    costs: [], cooldown: null, momentOperations: [{ moment: { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null },
      operations: [{ operation: 'damage', target: 'target', amount: { op: 'const', value: 20 }, damageType: 'magic', ref: 'tail_damage' }] }] };
  const provider: ProviderDefinition = { providerKey: 'passive_def', stableId: 'natural_passive', kind: 'character', skillKey: 'sample_w',
    processes: [definition], abilities: [{ abilityKey: 'on_e_hit', kind: 'passive_listener', skillKey: 'sample_w',
      listenerSpec: { listenerKey: 'on_e_hit', maxTriggersPerEvent: 1,
        eventMatcher: { all: ['event/skill_hit', 'event/source_owner', 'ability/skill/sample_e'] },
        operations: [{ operation: 'start_passive_process', target: 'self', processKey: 'later' }] } }] };
  const original = structuredClone(baseProcess);
  const passive: ProcessInstanceSnapshot = { ...structuredClone(baseProcess), providerRef: 'passive', processKey: 'later', skillKey: 'sample_w',
    useKey: 'passive:1', passiveOrigin: { useSource: 'source', useKey: 'skill:first', useSkillKey: 'sample_e',
      hitAbilityRef: 'source.provider[active].ability[hit]', hitSequence: 1, hitOccurrenceId: 7 },
    stepKey: 'wait', startedAtMs: 500, stepStartedAtMs: 500, advanceAtMs: 800, expiresAtMs: 800, cooldownStarted: false,
    status: end < 800 ? 'active' : 'complete', finishedAtMs: end < 800 ? null : 800,
    lastExecutionAtMs: end < 800 ? null : 800, stepCompletedAtMs: end < 800 ? null : 800,
    stepExecutionIndex: end < 800 ? 0 : 1, skillHitStages: undefined };
  const originalDefinition: ProcessDefinition = { processKey: 'cast', skillKey: 'sample_e', costs: [], cooldown: null,
    steps: [{ stepKey: 'cast', stepType: 'DELAY', occupiesAction: false, delayMs: { op: 'const', value: 500 } }], momentOperations: [] };
  const binding: SkillActionBinding = { bindingKey: 'e', source: 'source', providerRef: 'active', providerDefinitionRef: 'active_def', skillKey: 'sample_e',
    controls: [{ action: 'INITIAL', processKey: 'cast', abilityRef: 'source.provider[active].ability[start]' }],
    hitBindings: [{ hitBindingKey: 'contact', processKey: 'cast', hitAbilityRef: 'source.provider[active].ability[hit]',
      moment: { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null } }] };
  const compile = { combatants: [{ key: 'source', providers: [{ providerRef: 'active', definitionRef: 'active_def' },
    { providerRef: 'passive', definitionRef: 'passive_def' }] }], sharedProviders: [{ providerKey: 'active_def', skillKey: 'sample_e',
      kind: 'character', stableId: 'active', processes: [originalDefinition] }, provider], rules: { skillActionBindings: [binding] } } as CompileRequest;
  const request = { driverPlan: { entries: [], conditionRecheckIntervalMs: 1, skillActions: [{ instructionKey: 'first', bindingKey: 'e',
    abilityRef: 'source.provider[active].ability[start]', action: 'INITIAL', source: 'source', target: 'target', firstAtMs: 0,
    hitBindings: [{ hitBindingKey: 'contact', preset: 'TARGET_HIT' }] }] } } as RunRequest;
  const done = { ok: true, summary: { durationMs: end }, finalSnapshot: { processInstances: [original, passive] },
    recording: { skillActionRecordsTruncated: false }, skillActionRecords: [{ outcome: 'ACCEPTED', useRef: 'skill:first', instructionKey: 'first' }] } as DoneResult;
  const damage = { owner: 'source', source: 'source', target: 'target', abilityRef: 'source.provider[passive].ability[on_e_hit]',
    operationRef: 'tail_damage', operationPath: 'sharedProviders[1].processes[0].momentOperations[0].operations[0]', damageType: 'magic',
    useRef: 'skill:first', instructionKey: 'first', hitRef: 'hit:7', attackIndex: null, timeMs: 800 } as DamageRecord;
  return { compile, request, done, original, passive, provider, definition, damage };
}

describe('有限被动过程的结果因果', () => {
  it.each([799, 800])('观察%s毫秒保留原命中与独立实例，不提前尾行为', end => {
    const { compile, request, done, passive, damage } = fixture(end);
    const facts = inspectPassiveProcessFacts(compile, request, done);
    expect(facts.issues).toEqual([]);
    expect(facts.processes).toEqual([passive]);
    expect(passiveProcessOperation(facts.facts, damage) !== null).toBe(end === 800);
  });
  it.each([null, 799, 801, -1, 800.5, NaN, Infinity])('拒绝改写真实DELAY截止：%s', expiresAtMs => {
    const { compile, request, done, passive } = fixture();
    passive.expiresAtMs = expiresAtMs;
    expect(inspectPassiveProcessFacts(compile, request, done).issues.join(';')).toContain('延迟截止');
  });
  it('不同原使用的两个预约可并存，不能按供值器覆盖', () => {
    const { compile, request, done, original, passive } = fixture();
    const second = { ...structuredClone(original), useKey: 'skill:second', startedAtMs: 100, stepStartedAtMs: 100,
      advanceAtMs: 600, lastExecutionAtMs: 600, stepCompletedAtMs: 600, finishedAtMs: 600,
      skillHitStages: [{ ...stage, timeMs: 600, hitOccurrenceId: 8 }] };
    const waiting = { ...structuredClone(passive), useKey: 'passive:2', startedAtMs: 600, stepStartedAtMs: 600,
      advanceAtMs: 900, expiresAtMs: 900, stepExecutionIndex: 0, lastExecutionAtMs: null, stepCompletedAtMs: null, finishedAtMs: null,
      status: 'active' as const, passiveOrigin: { ...passive.passiveOrigin!, useKey: second.useKey, hitOccurrenceId: 8 } };
    done.finalSnapshot.processInstances!.push(second, waiting);
    request.driverPlan.skillActions!.push({ ...request.driverPlan.skillActions![0]!, instructionKey: 'second', firstAtMs: 100 });
    done.skillActionRecords!.push({ ...done.skillActionRecords![0]!, instructionKey: 'second', useRef: second.useKey });
    const facts = inspectPassiveProcessFacts(compile, request, done);
    expect(facts.issues).toEqual([]);
    expect(facts.processes).toHaveLength(2);
  });
  it('共同校验只把真实主动纳入次数，被动单独交付且未知过程拒绝', () => {
    const { compile, request, done, original, passive } = fixture();
    const facts = inspectSimulationProcessFacts(compile, request, done);
    expect(facts.issues).toEqual([]);
    expect(facts.processes).toEqual([original]);
    expect(facts.passiveProcesses).toEqual([passive]);
    done.finalSnapshot.processInstances!.push({ ...structuredClone(original), providerRef: 'unknown', useKey: 'forged' });
    expect(inspectSimulationProcessFacts(compile, request, done).issues.join(';')).toContain('未知过程');
  });
  it('第二绑定复用同一命中能力时，按真实阶段和发生编号匹配续接', () => {
    const { compile, request, done, original, passive } = fixture();
    const binding = compile.rules.skillActionBindings![0]!;
    const hit = binding.hitBindings[0]!;
    binding.hitBindings = [{ ...hit, hitBindingKey: 'early', moment: { momentType: 'STEP_EXECUTION', stepKey: 'early', failureReason: null } },
      { ...hit, moment: { momentType: 'STEP_EXECUTION', stepKey: 'cast', failureReason: null } }];
    compile.sharedProviders![0]!.processes![0]!.steps = ['early', 'cast'].map(stepKey => ({ stepKey, stepType: 'DELAY',
      occupiesAction: false, delayMs: { op: 'const', value: 250 } }));
    original.stepVersion = 2; original.stepStartedAtMs = 250;
    original.skillHitStages = [{ ...stage, hitBindingKey: 'early', stepKey: 'early', timeMs: 250, hitOccurrenceId: 3 },
      { ...stage, hitSequence: 2 }];
    passive.passiveOrigin!.hitSequence = 2;
    request.driverPlan.skillActions![0]!.hitBindings = binding.hitBindings.map(hit => ({ hitBindingKey: hit.hitBindingKey, preset: 'TARGET_HIT' }));
    const facts = inspectPassiveProcessFacts(compile, request, done);
    expect(facts.issues).toEqual([]);
    expect(facts.processes).toEqual([passive]);
  });
  it.each(['owner', 'target', 'use', 'ability', 'occurrence', 'blocked', 'duplicate', 'active_disguise', 'missing_origin'] as const)(
    '拒绝被动因果伪造：%s', kind => {
      const { compile, request, done, passive, original } = fixture();
      if (kind === 'owner') passive.owner = 'target';
      if (kind === 'target') passive.target = 'source';
      if (kind === 'use') passive.passiveOrigin!.useKey = 'skill:unknown';
      if (kind === 'ability') passive.passiveOrigin!.hitAbilityRef = 'source.provider[active].ability[other]';
      if (kind === 'occurrence') passive.passiveOrigin!.hitOccurrenceId = 99;
      if (kind === 'blocked') Object.assign(original.skillHitStages![0]!, { hitBlocked: 1 });
      if (kind === 'duplicate') done.finalSnapshot.processInstances!.push(structuredClone(passive));
      if (kind === 'active_disguise') original.passiveOrigin = passive.passiveOrigin;
      if (kind === 'missing_origin') delete passive.passiveOrigin;
      expect(inspectPassiveProcessFacts(compile, request, done).issues.length).toBeGreaterThan(0);
    });
  it('尾伤只接真实过程叶路径、执行时刻和原HIT身份', () => {
    const { compile, request, done, damage } = fixture();
    const facts = inspectPassiveProcessFacts(compile, request, done);
    expect(passiveProcessDamagePath(compile, damage.operationPath)).toBe(true);
    expect(passiveProcessOperation(facts.facts, damage)).not.toBeNull();
    for (const row of [{ ...damage, timeMs: 500 }, { ...damage, hitRef: 'hit:99' },
      { ...damage, operationPath: 'sharedProviders[1].abilities[0].listenerSpec.operations[0]' }]) {
      expect(passiveProcessOperation(facts.facts, row)).toBeNull();
    }
  });
  it('解析层拒绝缺失、未知字段及非法正整数因果', () => {
    const { done, passive } = fixture();
    assertPassiveProcessOutputShape(done);
    for (const origin of [null, { ...passive.passiveOrigin, hitSequence: 0 }, { ...passive.passiveOrigin, hitOccurrenceId: Infinity },
      { ...passive.passiveOrigin, extra: true }, { useKey: 'only' }]) {
      const value = structuredClone(done);
      Object.assign(value.finalSnapshot.processInstances![1]!, { passiveOrigin: origin });
      expect(() => assertPassiveProcessOutputShape(value)).toThrow(/passiveOrigin/);
    }
  });
  it('展示将被动续接附到原使用，不冒充主动过程', () => {
    const { done, original, passive } = fixture();
    const index = indexAutomaticPresentation(done);
    expect(index.byUse.get(original.useKey)?.processes).toEqual([original]);
    expect(index.byUse.get(original.useKey)?.passiveProcesses).toEqual([passive]);
    expect(index.byUse.has(passive.useKey)).toBe(false);
  });
});
