import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { describe, expect, it } from 'vitest';
import { simulationSample } from '../../tests/fixtures/simulationSnapshot';
import type { AbilityDefinition, AttackRecord, DamageRecord, DoneResult, GenericFormulaExpr, OperationDefinition, ProviderDefinition } from '../types/genericEngine';
import { assembleSimulation as raw_assembleSimulation, inspectSimulationSnapshot as raw_inspectSimulationSnapshot } from './simulationAdapter';
import { continuousAttackRequest } from './continuousAttackRequest';
import { assessContinuousAttackResult } from './continuousAttackResult';

async function sample() {
  const snapshot = simulationSample();
  snapshot.source.selectedLevelValues.attack_speed = 1;
  const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) inputs[row.side][row.attribute.attributeKey] = 0;
  const prepared = assembleSimulation(snapshot, inputs, { source: 650, target: 250 });
  const { runRequest: request } = await continuousAttackRequest(prepared, snapshot, { durationMs: 30000, attackSpeedInputMax: 1, recordTimeSeries: false }, 'session');
  const plan = request.driverPlan.basicAttack!;
  const origin = prepared.operationOrigins.find(row => row.resultKey === 'damage')!;
  const attackRecords: AttackRecord[] = [];
  const damageRecords: DamageRecord[] = [];
  for (let index = 1; index <= 3; index++) {
    const hpBefore = 250 - (index - 1) * 100;
    const actualHpLoss = Math.min(100, hpBefore);
    attackRecords.push({ planKey: plan.planKey, attackIndex: index, useRef: `use_${index}`, source: 'source', target: 'target', skillKey: plan.skillKey,
      startAtMs: (index - 1) * 1000, hitAtMs: (index - 1) * 1000, readyAtMs: index * 1000,
      finalReadyAtMs: index * 1000, mechanicReadyAtMs: null, actionReadyAtMs: null, nextStartAtMs: index === 3 ? null : index * 1000, attackSpeed: 1, postDefenseDamage: 100, actualHpLoss,
      sourceHpAfter: 650, targetHpAfter: hpBefore - actualHpLoss, completed: true });
    damageRecords.push({ damageId: index, attackIndex: index, useRef: `use_${index}`, timeMs: (index - 1) * 1000,
      owner: 'source', source: 'source', target: 'target', abilityRef: plan.hitAbilityRef, castInstanceId: index * 3,
      operationRef: origin.operationRef, operationPath: origin.compiledPaths[0]!, damageType: 'physics',
      rawAmount: 100, postDefenseDamage: 100, shieldAbsorbed: 0, actualHpLoss, overkillDamage: 100 - actualHpLoss, hpBefore, hpAfter: hpBefore - actualHpLoss,
      sourceHpBefore: 650, sourceHpAfter: 650,
      resistanceFactor: 1,
      normalPartPostResistance: 100, critPartPostResistance: 0, eligible: true, policy: 'expected', baseRawAmount: 100,
      originalCritChance: 0, effectiveCritChance: 0, multiplier: 2, normalPart: 100, critPart: 0, critAdjustedRawAmount: 100 });
  }
  const finalSnapshot = structuredClone(request.initialSnapshot);
  finalSnapshot.timeMs = 2000;
  finalSnapshot.combatants[1]!.attributes.hp!.current = 0;
  finalSnapshot.processInstances = [1, 2, 3].map(index => ({ owner: 'source', target: 'target', providerRef: 'selected_basic_attack',
    processKey: 'attack', skillKey: plan.skillKey, useKey: `use_${index}`, stepKey: 'begin', stepVersion: 1,
    stepExecutionIndex: 1, lastExecutionAtMs: (index - 1) * 1000, stepCompletedAtMs: (index - 1) * 1000,
    startedAtMs: (index - 1) * 1000, stepStartedAtMs: (index - 1) * 1000, advanceAtMs: (index - 1) * 1000,
    expiresAtMs: null, actualCosts: {}, cooldownStarted: true, status: 'complete', failureReason: null, finishedAtMs: (index - 1) * 1000,
    repeat: null, actionOccupancies: [] }));
  const done: DoneResult = { ok: true,
    summary: { durationMs: 2000, stopReason: 'target_dead', sourceFinalHp: 650, targetFinalHp: 0,
      sourceDamageDealt: 300, targetDamageTaken: 300, sourceDamageTaken: 0, targetDamageDealt: 0,
      sourceHpLoss: 0, targetHpLoss: 250, sourceVampHealing: 0, targetVampHealing: 0, abilityAttemptCount: 6, abilityCastCount: 9, attemptSkippedCount: 0,
      warningCount: 0, evidenceTruncated: false, seriesDownsampled: false, abilityStats: [],
      basicAttack: { planKey: plan.planKey, startedCount: 3, hitCount: 3, completedCount: 3, initialActionReadyAtMs: null },
      execution: { requestedDurationMs: 30000, complete: true, incompleteReason: null, budgetCause: null, targetKilled: true, targetKilledAtMs: 2000 },
      damageBreakdown: [{ owner: 'source', source: 'source', target: 'target', abilityRef: plan.hitAbilityRef,
        operationRef: origin.operationRef, damageType: 'physics', damageCount: 3, postDefenseDamage: 300, shieldAbsorbed: 0, actualHpLoss: 250, overkillDamage: 50 }] },
    finalSnapshot, attackRecords, damageRecords, mechanicRecords: [],
    recording: { attackRecordCount: 3, returnedAttackRecords: 3, droppedAttackRecords: 0, attackRecordsTruncated: false,
      damageRecordCount: 3, returnedDamageRecords: 3, droppedDamageRecords: 0, damageRecordsTruncated: false,
      mechanicRecordCount: 0, returnedMechanicRecords: 0, droppedMechanicRecords: 0, mechanicRecordsTruncated: false },
    evidence: { items: [], truncated: false, truncatedEvidenceCount: 0, countsByKind: {} }, warnings: [], series: [],
    seriesSamplingEvidence: { requestedSampleEveryMs: 100, effectiveSampleEveryMs: 0, requestedPointCount: 0, finalPointCount: 0, maxSeriesPoints: 5000, downsampled: false, method: 'disabled' } };
  return { prepared, request, done };
}
const assess = (item: Awaited<ReturnType<typeof sample>>) => assessContinuousAttackResult(item.prepared.compileRequest, item.request, item.done, item.prepared.operationOrigins);

describe('6B新增行动事实不放宽既有严格核对', () => {
  it('无贡献须显式null，字段缺失不被旧记录或默认值代替', async () => {
    const input = await sample();
    delete (input.done.summary.basicAttack as unknown as Record<string, unknown>).initialActionReadyAtMs;
    expect(() => assess(input)).toThrow(/initialActionReadyAtMs/);
    input.done.summary.basicAttack!.initialActionReadyAtMs = null;
    delete (input.done.attackRecords![0] as unknown as Record<string, unknown>).actionReadyAtMs;
    expect(() => assess(input)).toThrow(/actionReadyAtMs/);
  });

  it('没有显式主动计划不接受非空行动贡献，旧刀号身份仍严格', async () => {
    const input = await sample();
    input.done.attackRecords![0]!.actionReadyAtMs = 1000;
    expect(assess(input).factsValid).toBe(false);
    input.done.attackRecords![0]!.actionReadyAtMs = null;
    input.done.attackRecords![1]!.attackIndex = 1;
    expect(assess(input).factsValid).toBe(false);
  });

  it('真实占用到2000毫秒不能被空贡献及1000毫秒假下一刀隐藏，截断行动记录也不能绕过', async () => {
    const input = await sample();
    input.done.summary.sourceDirectHealing = 0;
    input.done.summary.targetDirectHealing = 0;
    input.done.healingRecords = [];
    const binding = { bindingKey: 'locked_binding', source: 'source', providerRef: 'locked', providerDefinitionRef: 'locked_definition', skillKey: 'locked_spell',
      controls: [{ action: 'INITIAL', processKey: 'cast', abilityRef: 'source.provider[locked].ability[initial]' }], hitBindings: [] };
    input.prepared.compileRequest.rules.skillActionBindings = [binding];
    input.prepared.compileRequest.sharedProviders!.push({ providerKey: binding.providerDefinitionRef, kind: 'character', stableId: 'locked_spell',
      processes: [{ processKey: 'cast', skillKey: 'locked_spell', steps: [{ stepKey: 'delay', stepType: 'DELAY', delayMs: { op: 'const', value: 1500 }, occupiesAction: true }],
        costs: [], cooldown: null, momentOperations: [] }] });
    input.request.driverPlan.skillActions = [{ instructionKey: 'locked', firstAtMs: 500, sortOrder: 0, source: 'source', target: 'target',
      skillKey: binding.skillKey, bindingKey: binding.bindingKey, abilityRef: binding.controls[0]!.abilityRef, action: 'INITIAL', hitBindings: [] }];
    input.done.finalSnapshot.processInstances!.push({ owner: 'source', target: 'target', providerRef: binding.providerRef, processKey: 'cast', skillKey: binding.skillKey,
      useKey: 'skill:locked', stepKey: 'delay', stepVersion: 1, startedAtMs: 500, stepStartedAtMs: 500, advanceAtMs: 2000, expiresAtMs: 2000,
      stepExecutionIndex: 1, lastExecutionAtMs: 2000, stepCompletedAtMs: 2000,
      actualCosts: {}, cooldownStarted: false, status: 'complete', failureReason: null, finishedAtMs: 2000, repeat: null,
      actionOccupancies: [{ stepKey: 'delay', stepVersion: 1, startedAtMs: 500, expectedEndAtMs: 2000, finishedAtMs: 2000 }] });
    input.done.skillActionRecords = [{ instructionKey: 'locked', parentInstructionKey: null, requestedAtMs: 500, actualAtMs: 500, source: 'source', target: 'target',
      skillKey: binding.skillKey, bindingKey: binding.bindingKey, providerRef: binding.providerRef, providerDefinitionRef: binding.providerDefinitionRef,
      action: 'INITIAL', outcome: 'ACCEPTED', reason: null, useRef: 'skill:locked' }];
    for (const truncated of [false, true]) {
      input.done.recording!.skillActionRecordsTruncated = truncated;
      if (truncated) input.done.skillActionRecords = [];
      const result = assess(input);
      expect(result.factsValid).toBe(false);
      expect(result.issues.some(issue => issue.includes('actionReadyAtMs'))).toBe(true);
    }
  });
});
type Sample = Awaited<ReturnType<typeof sample>>;
type Side = 'source' | 'target';

async function ammoTimingSample(initialAmmo: 0 | 1) {
  const input = await sample();
  const definition = input.prepared.compileRequest.sharedProviders![0]!;
  definition.initialStateSchema = { rounds: { valueType: 'integer', defaultValue: initialAmmo, maxValue: 4, stateKind: 'ammo',
    ammoRecovery: { intervalMs: { op: 'const', value: 2500 }, mode: 'all_at_once', startCondition: 'when_empty' } } };
  const providerRef = input.prepared.compileRequest.combatants[0]!.providers[0]!.providerRef;
  input.done.summary.basicAttack!.initialMechanicReadyAtMs = initialAmmo === 0 ? 2500 : null;
  for (const row of input.done.attackRecords!) {
    const offset = initialAmmo === 0 ? 2500 : row.attackIndex === 1 ? 0 : 1500;
    row.startAtMs += offset; row.hitAtMs! += offset; row.readyAtMs! += offset; row.finalReadyAtMs! += offset;
    if (row.nextStartAtMs !== null) row.nextStartAtMs += initialAmmo === 0 ? 2500 : 1500;
    if (initialAmmo === 1 && row.attackIndex === 1) row.mechanicReadyAtMs = 2500;
  }
  input.done.damageRecords!.forEach(row => { row.timeMs = input.done.attackRecords![row.attackIndex - 1]!.hitAtMs!; });
  input.done.finalSnapshot.processInstances!.forEach(process => {
    const attack = input.done.attackRecords!.find(row => row.useRef === process.useKey)!;
    process.startedAtMs = process.stepStartedAtMs = process.advanceAtMs = process.finishedAtMs = attack.startAtMs;
  });
  const wait = { owner: 'source' as const, providerRef, providerDefinitionRef: definition.providerKey,
    skillKey: input.request.driverPlan.basicAttack!.skillKey, stateKey: 'rounds', operationRef: 'ammo_recovery', beforeValue: 0 };
  input.done.mechanicRecords = [
    { ...wait, kind: 'WAIT_STARTED', timeMs: 0, afterValue: 0, useRef: initialAmmo === 0 ? null : 'use_1', readyAtMs: 2500 },
    { ...wait, kind: 'WAIT_ENDED', timeMs: 2500, afterValue: 4, useRef: null, readyAtMs: 2500 }
  ];
  refreshFacts(input, input.done.attackRecords![2]!.startAtMs);
  input.done.recording = { ...input.done.recording!, mechanicRecordCount: 2, returnedMechanicRecords: 2,
    droppedMechanicRecords: 0, mechanicRecordsTruncated: false };
  return input;
}

function mechanism(input: Sample, side: Side, key: string, kind: 'passive_listener' | 'tick', condition?: GenericFormulaExpr) {
  const providerIndex = input.prepared.compileRequest.sharedProviders!.length;
  const providerRef = `${side}_${key}`;
  const operationRef = `skills.${key}.effects.passive.results.damage`;
  const operation: OperationDefinition = { operation: 'damage', target: 'target', amount: { op: 'const', value: 15 },
    damageType: 'physics', ref: operationRef, condition };
  const ability: AbilityDefinition = { abilityKey: 'passive', kind, skillKey: key };
  if (kind === 'passive_listener') ability.listenerSpec = { listenerKey: key,
    eventMatcher: { all: ['event/basic_attack_hit', 'event/source_owner'] }, maxTriggersPerEvent: 1, operations: [operation] };
  else ability.tickSpec = { intervalMs: 1000, startDelayMs: 500, onTick: [operation] };
  const provider: ProviderDefinition = { providerKey: providerRef, stableId: providerRef, kind: 'item', abilities: [ability] };
  input.prepared.compileRequest.sharedProviders!.push(provider);
  input.prepared.compileRequest.combatants.find(actor => actor.key === side)!.providers.push({ providerRef, definitionRef: providerRef });
  const operationPath = `sharedProviders[${providerIndex}].abilities[0].${kind === 'passive_listener' ? 'listenerSpec.operations[0]' : 'tickSpec.onTick[0]'}`;
  const origin = { abilityRef: `${side}.provider[${providerRef}].ability[passive]`, operationRef,
    skillKey: key, effectKey: 'passive', resultKey: 'damage', compiledPaths: [operationPath] };
  input.prepared.operationOrigins.push(origin);
  const sourceHp = input.request.initialSnapshot.combatants.find(actor => actor.key === side)!.attributes.hp!.current;
  const record = (attackIndex: number, timeMs: number, amount = 15): DamageRecord => ({ ...input.done.damageRecords![0]!,
    owner: side, source: side, target: side === 'source' ? 'target' : 'source', abilityRef: origin.abilityRef,
    operationRef, operationPath: origin.compiledPaths[0]!, attackIndex, useRef: attackIndex ? `use_${attackIndex}` : '', timeMs,
    rawAmount: amount, postDefenseDamage: amount, baseRawAmount: amount, normalPart: amount, critAdjustedRawAmount: amount,
    sourceHpBefore: sourceHp, sourceHpAfter: sourceHp,
    normalPartPostResistance: amount });
  return { provider, ability, operation, origin, record };
}

function refreshFacts(input: Sample, durationMs = 2000) {
  const rows = input.done.damageRecords!;
  rows.sort((first, second) => first.timeMs - second.timeMs);
  const hp = { source: input.request.initialSnapshot.combatants[0]!.attributes.hp!.current,
    target: input.request.initialSnapshot.combatants[1]!.attributes.hp!.current };
  const lastDamageByAttack = new Map<number, number>();
  rows.forEach((row, index) => { if (row.attackIndex) lastDamageByAttack.set(row.attackIndex, index); });
  rows.forEach((row, index) => {
    const source = row.source as Side;
    const side = row.target as Side;
    const vampHealing = (row.sourceHpAfter as number) - (row.sourceHpBefore as number);
    row.damageId = index + 1;
    row.sourceHpBefore = hp[source];
    row.hpBefore = hp[side];
    row.actualHpLoss = Math.min(row.postDefenseDamage, hp[side]);
    row.overkillDamage = row.postDefenseDamage - row.actualHpLoss;
    hp[side] -= row.actualHpLoss;
    row.hpAfter = hp[side];
    hp[source] += vampHealing;
    row.sourceHpAfter = hp[source];
    if (lastDamageByAttack.get(row.attackIndex) === index) {
      const attack = input.done.attackRecords!.find(attack => attack.attackIndex === row.attackIndex)!;
      attack.sourceHpAfter = hp.source; attack.targetHpAfter = hp.target;
    }
  });
  input.done.attackRecords!.forEach((attack, index, attacks) => {
    const amounts = rows.filter(row => row.attackIndex === attack.attackIndex && row.source === 'source' && row.target === 'target');
    attack.postDefenseDamage = amounts.reduce((total, row) => total + row.postDefenseDamage, 0);
    attack.actualHpLoss = amounts.reduce((total, row) => total + row.actualHpLoss, 0);
    attack.nextStartAtMs = attacks[index + 1]?.startAtMs ?? null;
  });
  input.done.summary.damageBreakdown = [];
  for (const row of rows) {
    let group = input.done.summary.damageBreakdown.find(group => group.source === row.source && group.target === row.target
      && group.abilityRef === row.abilityRef && group.operationRef === row.operationRef && group.damageType === row.damageType);
    if (!group) {
      group = { owner: row.owner, source: row.source, target: row.target, abilityRef: row.abilityRef, operationRef: row.operationRef,
        damageType: row.damageType, damageCount: 0, postDefenseDamage: 0, actualHpLoss: 0, shieldAbsorbed: 0, overkillDamage: 0 };
      input.done.summary.damageBreakdown.push(group);
    }
    group.damageCount++;
    for (const field of ['postDefenseDamage', 'actualHpLoss', 'shieldAbsorbed', 'overkillDamage'] as const) group[field] += row[field];
  }
  const summary = input.done.summary;
  for (const side of ['source', 'target'] as const) {
    summary[`${side}FinalHp`] = hp[side];
    summary[`${side}DamageDealt`] = rows.filter(row => row.source === side).reduce((total, row) => total + row.postDefenseDamage, 0);
    summary[`${side}DamageTaken`] = rows.filter(row => row.target === side).reduce((total, row) => total + row.postDefenseDamage, 0);
    summary[`${side}HpLoss`] = rows.filter(row => row.target === side).reduce((total, row) => total + row.actualHpLoss, 0);
    summary[`${side}VampHealing`] = rows.filter(row => row.source === side)
      .reduce((total, row) => total + (row.sourceHpAfter as number) - (row.sourceHpBefore as number), 0);
    input.done.finalSnapshot.combatants.find(actor => actor.key === side)!.attributes.hp!.current = hp[side];
  }
  summary.durationMs = durationMs;
  input.done.finalSnapshot.timeMs = durationMs;
  summary.stopReason = hp.source === 0 ? hp.target === 0 ? 'both_dead' : 'source_dead' : hp.target === 0 ? 'target_dead' : 'duration_reached';
  summary.execution!.targetKilled = hp.target === 0;
  summary.execution!.targetKilledAtMs = rows.find(row => row.target === 'target' && row.hpBefore > 0 && row.hpAfter === 0)?.timeMs ?? null;
  const attackCount = input.done.attackRecords!.length;
  summary.basicAttack = { ...summary.basicAttack!, startedCount: attackCount, hitCount: attackCount, completedCount: attackCount };
  input.done.finalSnapshot.processInstances = input.done.finalSnapshot.processInstances!.slice(0, attackCount);
  input.done.recording = { attackRecordCount: attackCount, returnedAttackRecords: attackCount, droppedAttackRecords: 0, attackRecordsTruncated: false,
    damageRecordCount: rows.length, returnedDamageRecords: rows.length, droppedDamageRecords: 0, damageRecordsTruncated: false,
    mechanicRecordCount: 0, returnedMechanicRecords: 0, droppedMechanicRecords: 0, mechanicRecordsTruncated: false };
}
function retainRecords(input: Sample, maxAttackRecords: number, maxDamageRecords: number) {
  input.request.recordBudget = { maxAttackRecords, maxDamageRecords };
  input.done.attackRecords = input.done.attackRecords!.slice(0, maxAttackRecords);
  input.done.damageRecords = input.done.damageRecords!.slice(0, maxDamageRecords);
  const recording = input.done.recording!;
  recording.returnedAttackRecords = input.done.attackRecords.length;
  recording.droppedAttackRecords = recording.attackRecordCount - recording.returnedAttackRecords;
  recording.attackRecordsTruncated = recording.droppedAttackRecords > 0;
  recording.returnedDamageRecords = input.done.damageRecords.length;
  recording.droppedDamageRecords = recording.damageRecordCount - recording.returnedDamageRecords;
  recording.damageRecordsTruncated = recording.droppedDamageRecords > 0;
}
async function vampPeriodicSample() {
  const input = await sample();
  input.request.initialSnapshot.combatants[0]!.attributes.hp!.current = 600;
  input.request.initialSnapshot.combatants[1]!.attributes.hp!.current = 550;
  input.request.stopPolicy.durationMs = input.done.summary.execution!.requestedDurationMs = 2500;
  for (const actor of [input.prepared.compileRequest.combatants[0]!, input.request.initialSnapshot.combatants[0]!, input.done.finalSnapshot.combatants[0]!]) {
    actor.attributes.life_steal_percent = { base: 0.1, current: 0.1, max: 1, resolved: 0.1 };
  }
  input.done.damageRecords!.forEach(row => { row.sourceHpAfter = (row.sourceHpBefore as number) + 10; });
  const periodic = mechanism(input, 'source', 'retained_vamp_periodic', 'tick');
  periodic.ability.tickSpec!.startDelayMs = 2500;
  periodic.operation.vampOverrides = [{ vampType: 'LIFE_STEAL', mode: 'OVERRIDE', basisOutputKind: 'POST_DEFENSE_DAMAGE', efficiency: { op: 'const', value: 1 } }];
  const row = periodic.record(0, 2500, 100);
  row.sourceHpAfter = (row.sourceHpBefore as number) + 10;
  input.done.damageRecords!.push(row);
  refreshFacts(input, 2500);
  return input;
}

describe('连续可靠结果解释', () => {
  it('0弹首刀必须由初态、真实等待和恢复记录解释，普通场景不放宽首刀时刻', async () => {
    const zero = await ammoTimingSample(0);
    expect(assess(zero).issues).toEqual([]);
    zero.done.mechanicRecords![1]!.timeMs = 2400;
    expect(assess(zero).complete).toBe(false);
    const ordinary = await sample();
    ordinary.done.attackRecords![0]!.startAtMs = ordinary.done.attackRecords![0]!.hitAtMs = 1;
    expect(assess(ordinary).complete).toBe(false);
  });
  it('下一刀取普通冷却与机制就绪较晚者，不相加也不忽略机制', async () => {
    const limited = await ammoTimingSample(1);
    expect(assess(limited).issues).toEqual([]);
    limited.done.attackRecords![0]!.nextStartAtMs = 1000;
    expect(assess(limited).complete).toBe(false);
    limited.done.attackRecords![0]!.nextStartAtMs = 3500;
    expect(assess(limited).complete).toBe(false);
  });
  it('机制记录禁用／截断不影响实际初次就绪汇总，缺事实仍拒绝', async () => {
    const limited = await ammoTimingSample(1);
    limited.request.recordBudget!.maxMechanicRecords = 0;
    limited.done.mechanicRecords = [];
    limited.done.recording = { ...limited.done.recording!, returnedMechanicRecords: 0, droppedMechanicRecords: 2, mechanicRecordsTruncated: true };
    expect(assess(limited).complete).toBe(true);
    const zero = await ammoTimingSample(0);
    zero.request.recordBudget!.maxMechanicRecords = 0; zero.done.mechanicRecords = [];
    zero.done.recording = { ...zero.done.recording!, returnedMechanicRecords: 0, droppedMechanicRecords: 2, mechanicRecordsTruncated: true };
    expect(assess(zero).complete).toBe(true);
    zero.done.summary.basicAttack!.initialMechanicReadyAtMs = null;
    expect(assess(zero).complete).toBe(false);
  });
  it('计时等待允许空使用身份，但不接受其它攻击身份', async () => {
    const input = await ammoTimingSample(1);
    input.done.mechanicRecords[0]!.useRef = null;
    expect(assess(input).complete).toBe(true);
    input.done.mechanicRecords[0]!.useRef = 'other_attack';
    expect(assess(input).complete).toBe(false);
  });
  it('真实条件主体伤害有原生结算事实即可，不要求无条件分支', async () => {
    const input = await sample();
    const hit = input.prepared.compileRequest.sharedProviders![0]!.abilities!.find(row => row.abilityKey === 'attack_hit')!;
    hit.operations![0]!.skillHit!.candidates[0]!.participationCondition = { op: 'const', value: 1 };
    expect(assess(input).complete).toBe(true);
  });
  it('恢复不能伪造攻击使用身份，错误容量或记录说明拒绝', async () => {
    const input = await ammoTimingSample(1);
    input.done.mechanicRecords![1]!.useRef = 'use_2';
    expect(assess(input).complete).toBe(false);
    input.done.mechanicRecords![1]!.useRef = null;
    input.done.mechanicRecords![1]!.afterValue = 3;
    expect(assess(input).complete).toBe(false);
    input.done.mechanicRecords![1]!.afterValue = 4;
    input.done.recording!.returnedMechanicRecords = 1;
    expect(assess(input).complete).toBe(false);
  });
  it.each([
    { attacks: 0, damages: 0 }, { attacks: 3, damages: 0 }, { attacks: 3, damages: 2 }, { attacks: 0, damages: 4 }
  ])('吸血周期记录预算攻击$attacks／伤害$damages保留严格汇总，不强求最后一刀等于最终生命', async ({ attacks, damages }) => {
    const input = await vampPeriodicSample();
    retainRecords(input, attacks, damages);
    expect(assess(input)).toMatchObject({ complete: true, factsValid: true, issues: [], sourceFinalHp: 640, targetFinalHp: 150 });
    input.done.summary.sourceVampHealing = 41;
    expect(assess(input).issues.join(';')).toContain('最终生命收支');
  });
  it.each([0, 2000])('零伤害及伤害记录预算%d仍保留合法观察和真实零吸血', async maximum => {
    const input = await sample();
    input.request.stopPolicy.durationMs = input.done.summary.execution!.requestedDurationMs = 2000;
    for (const actor of [input.prepared.compileRequest.combatants[0]!, input.request.initialSnapshot.combatants[0]!, input.done.finalSnapshot.combatants[0]!]) {
      actor.attributes.attack_damage = { base: 0, current: 0, max: 0, resolved: 0 };
    }
    const periodic = mechanism(input, 'source', 'zero_damage_tick', 'tick');
    periodic.operation.amount = { op: 'const', value: 0 };
    input.done.damageRecords!.push(periodic.record(0, 500, 0));
    for (const row of input.done.damageRecords!) {
      row.rawAmount = row.postDefenseDamage = row.baseRawAmount = row.normalPart = row.critAdjustedRawAmount = row.normalPartPostResistance = 0;
    }
    refreshFacts(input);
    retainRecords(input, 3, maximum);
    expect(assess(input)).toMatchObject({ complete: true, factsValid: true, issues: [], damageDealt: 0, hpLoss: 0,
      sourceFinalHp: 650, targetFinalHp: 250 });
    expect(input.done.summary).toMatchObject({ sourceVampHealing: 0, targetVampHealing: 0 });
  });
  it('B周期自吸血归实际B来源，总收支不再把B扣血误等同净生命差', async () => {
    const input = await sample();
    input.request.initialSnapshot.combatants[1]!.attributes.hp!.current = 550;
    input.request.stopPolicy.durationMs = input.done.summary.execution!.requestedDurationMs = 2500;
    const periodic = mechanism(input, 'target', 'target_self_vamp', 'tick');
    periodic.ability.tickSpec!.startDelayMs = 2500;
    const row = periodic.record(0, 2500, 40);
    row.sourceHpAfter = (row.sourceHpBefore as number) + 20;
    input.done.damageRecords!.push(row);
    refreshFacts(input, 2500);
    expect(input.done.summary).toMatchObject({ sourceVampHealing: 0, targetVampHealing: 20, sourceHpLoss: 40, targetHpLoss: 300 });
    expect(assess(input)).toMatchObject({ complete: true, issues: [], sourceFinalHp: 610, targetFinalHp: 270 });
    retainRecords(input, 3, 3);
    expect(assess(input)).toMatchObject({ complete: true, factsValid: true, issues: [], sourceFinalHp: 610, targetFinalHp: 270 });
  });
  it('完整明细来源增量必须归正确一侧，不能用相符的伪造最终快照替代', async () => {
    const input = await vampPeriodicSample();
    input.done.summary.sourceVampHealing = 30; input.done.summary.targetVampHealing = 10;
    input.done.summary.sourceFinalHp = input.done.finalSnapshot.combatants[0]!.attributes.hp!.current = 630;
    input.done.summary.targetFinalHp = input.done.finalSnapshot.combatants[1]!.attributes.hp!.current = 160;
    expect(assess(input).issues.join(';')).toContain('完整逐笔来源吸血增量');
  });
  it('保留明细的生命链和入账前缀不能因截断而放宽', async () => {
    const input = await vampPeriodicSample();
    retainRecords(input, 3, 2);
    input.done.damageRecords![1]!.sourceHpBefore = 611;
    expect(assess(input).issues.join(';')).toContain('连续可靠生命链');
    input.done.damageRecords![1]!.sourceHpBefore = 610;
    input.done.summary.sourceVampHealing = 10;
    input.done.summary.sourceFinalHp = input.done.finalSnapshot.combatants[0]!.attributes.hp!.current = 610;
    expect(assess(input).issues.join(';')).toContain('已保留逐笔吸血或扣血超过完整汇总');
  });
  it.each(['sourceHpBefore', 'sourceHpAfter'] as const)('连续模式的%s缺失、null、非有限或负值不兼容补零', async field => {
    for (const value of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, -1, '0']) {
      const input = await sample();
      (input.done.damageRecords![0] as unknown as Record<string, unknown>)[field] = value;
      expect(() => assess(input)).toThrow(field);
    }
  });
  it('明确0来源生命、倒减受量、越界受量不能伪装成合法自吸血', async () => {
    const input = await sample();
    const row = input.done.damageRecords![0]!;
    row.sourceHpBefore = row.sourceHpAfter = 0;
    expect(assess(input).issues.join(';')).toContain('连续可靠生命链');
    row.sourceHpBefore = 650; row.sourceHpAfter = 649;
    expect(assess(input).issues.join(';')).toContain('来源生命受量减少');
    row.sourceHpAfter = 651;
    expect(assess(input).issues.join(';')).toContain('初始上限');
  });
  it('缺少或非法吸血总字段不能从能力统计、调试证据或生命差补造', async () => {
    for (const field of ['sourceVampHealing', 'targetVampHealing'] as const) {
      for (const value of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
        const input = await vampPeriodicSample();
        input.done.summary.abilityStats = [{ abilityRef: input.request.driverPlan.basicAttack!.hitAbilityRef, attemptCount: 3, castCount: 3, skipCount: 0, healingDone: 40 }];
        (input.done.summary as unknown as Record<string, unknown>)[field] = value;
        expect(() => assess(input)).toThrow(field);
      }
    }
  });
  it('原有同次过程开始伤害仍是逐刀必需结果，不误归为条件装备', async () => {
    const input = await sample();
    const plan = input.request.driverPlan.basicAttack!;
    const process = input.prepared.compileRequest.sharedProviders![0]!.processes![0]!;
    const momentIndex = process.momentOperations.length;
    const operationRef = `skills.${plan.skillKey}.effects.process_start.results.damage`;
    const operationPath = `sharedProviders[0].processes[0].momentOperations[${momentIndex}].operations[0]`;
    process.momentOperations.push({ moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null },
      operations: [{ operation: 'damage', target: 'target', ref: operationRef, damageType: 'physics', amount: { op: 'const', value: 5 } }] });
    input.prepared.operationOrigins.push({ abilityRef: plan.initialControlAbilityRef, operationRef, skillKey: plan.skillKey,
      effectKey: 'process_start', resultKey: 'damage', compiledPaths: [operationPath] });
    input.done.damageRecords!.unshift(...[1, 2, 3].map(index => ({ ...input.done.damageRecords![0]!, attackIndex: index, useRef: `use_${index}`,
      timeMs: (index - 1) * 1000, abilityRef: plan.initialControlAbilityRef, operationRef, operationPath, postDefenseDamage: 5 })));
    refreshFacts(input);
    expect(assess(input)).toMatchObject({ complete: true, issues: [], damageDealt: 315 });
    input.done.damageRecords = input.done.damageRecords!.filter(row => row.operationPath !== operationPath || row.attackIndex !== 2);
    refreshFacts(input);
    expect(assess(input).issues.join(';')).toContain('第2刀缺少完整作者伤害结果');
  });
  it('无条件命中附伤每刀必需，条件结果不削弱主体完整性', async () => {
    const input = await sample();
    const onHit = mechanism(input, 'source', 'on_hit', 'passive_listener');
    input.done.damageRecords!.push(...[1, 2, 3].map(index => onHit.record(index, (index - 1) * 1000)));
    refreshFacts(input);
    expect(assess(input)).toMatchObject({ complete: true, issues: [], damageDealt: 345 });
    input.done.damageRecords = input.done.damageRecords!.filter(row => row.abilityRef !== onHit.origin.abilityRef || row.attackIndex !== 2);
    refreshFacts(input);
    expect(assess(input).issues.join(';')).toContain('第2刀缺少完整作者伤害结果');
  });
  it('每N阈值及消费沿来源状态和操作条件，只有第3刀有附伤', async () => {
    const input = await sample();
    const condition: GenericFormulaExpr = { op: 'gte', args: [{ op: 'read', path: 'provider.state.hits' }, { op: 'const', value: 3 }] };
    const counter = mechanism(input, 'source', 'every_third', 'passive_listener', condition);
    counter.provider.initialStateSchema = { hits: 0 };
    counter.ability.listenerSpec!.operations = [
      { operation: 'state_change', target: 'self', types: ['state_scope/provider'], ref: 'hits', valuePolicy: 'add', amount: { op: 'const', value: 1 } },
      counter.operation,
      { operation: 'state_change', target: 'self', types: ['state_scope/provider'], ref: 'hits', valuePolicy: 'override', amount: { op: 'const', value: 0 }, condition }
    ];
    counter.origin.compiledPaths[0] = counter.origin.compiledPaths[0]!.replace('operations[0]', 'operations[1]');
    input.done.damageRecords!.push(counter.record(3, 2000));
    refreshFacts(input);
    expect(assess(input)).toMatchObject({ complete: true, issues: [], completedCount: 3, damageDealt: 315 });
    expect(input.done.finalSnapshot.processInstances).toHaveLength(3);
    input.done.damageRecords = input.done.damageRecords!.filter(row => row.attackIndex !== 2);
    refreshFacts(input);
    expect(assess(input).issues.join(';')).toContain('第2刀缺少完整作者伤害结果');
  });
  it.each([999, 1000, 1001, 1500])('内部冷却%d毫秒的操作条件不要求逐刀附伤', async durationMs => {
    const input = await sample();
    const condition: GenericFormulaExpr = { op: 'eq', args: [{ op: 'read', path: 'provider.state.blocked' }, { op: 'const', value: 0 }] };
    const internalCooldown = mechanism(input, 'source', `internal_cooldown_${durationMs}`, 'passive_listener', condition);
    internalCooldown.provider.initialStateSchema = { blocked: { valueType: 'number', defaultValue: 0, durationMs, refreshPolicy: 'refresh_on_write' } };
    internalCooldown.ability.listenerSpec!.operations!.push({ operation: 'state_change', target: 'self', types: ['state_scope/provider'],
      ref: 'blocked', valuePolicy: 'override', amount: { op: 'const', value: 1 }, condition });
    const triggered = durationMs <= 1000 ? [1, 2, 3] : [1, 3];
    input.done.damageRecords!.push(...triggered.map(index => internalCooldown.record(index, (index - 1) * 1000)));
    refreshFacts(input);
    expect(assess(input)).toMatchObject({ complete: true, issues: [], completedCount: 3, damageDealt: 300 + triggered.length * 15 });
  });
  it('同名多方来源不串身份，B的拥有方命中监听不是A每刀必需结果', async () => {
    const input = await sample();
    const condition: GenericFormulaExpr = { op: 'gte', args: [{ op: 'read', path: 'provider.state.hits' }, { op: 'const', value: 3 }] };
    const source = mechanism(input, 'source', 'shared_counter', 'passive_listener', condition);
    const target = mechanism(input, 'target', 'shared_counter', 'passive_listener', condition);
    source.provider.initialStateSchema = target.provider.initialStateSchema = { hits: 0 };
    input.done.damageRecords!.push(source.record(3, 2000));
    refreshFacts(input);
    expect(assess(input)).toMatchObject({ complete: true, issues: [] });
    input.done.damageRecords!.push(target.record(3, 2000));
    refreshFacts(input);
    expect(assess(input).issues.join(';')).toContain('独立周期与攻击关联不一致');
  });
  it('操作条件不能重复结算，也不能作为接受未知编译节点的借口', async () => {
    const input = await sample();
    const conditional = mechanism(input, 'source', 'conditional', 'passive_listener', { op: 'const', value: 1 });
    input.done.damageRecords!.push(conditional.record(3, 2000), conditional.record(3, 2000));
    refreshFacts(input);
    expect(assess(input).issues.join(';')).toContain('重复结算');
    input.done.damageRecords!.pop(); refreshFacts(input);
    expect(assess(input).complete).toBe(true);
    conditional.ability.listenerSpec!.condition = { op: 'const', value: 1 };
    expect(assess(input).complete).toBe(true);
    delete conditional.ability.listenerSpec!.condition;
    conditional.ability.kind = 'unknown';
    expect(assess(input).complete).toBe(false);
  });
  it('两刀之间和观察终点的周期无刀号，不进入最近一刀金额', async () => {
    const input = await sample();
    input.request.initialSnapshot.combatants[1]!.attributes.hp!.current = 550;
    input.request.stopPolicy.durationMs = input.done.summary.execution!.requestedDurationMs = 2500;
    const periodic = mechanism(input, 'source', 'periodic', 'tick');
    input.done.damageRecords!.push(...[500, 1500, 2500].map(time => periodic.record(0, time, 20)));
    refreshFacts(input, 2500);
    expect(assess(input)).toMatchObject({ complete: true, issues: [], damageDealt: 360, hpLoss: 360, targetFinalHp: 190 });
    expect(input.done.attackRecords!.map(row => row.postDefenseDamage)).toEqual([100, 100, 100]);
    expect(input.done.attackRecords![2]!.targetHpAfter).toBe(210);
    const row = input.done.damageRecords!.find(row => row.attackIndex === 0)!;
    row.attackIndex = 1; row.useRef = 'use_1';
    expect(assess(input).complete).toBe(false);
  });
  it.each([0, undefined])('周期首延迟%s沿编译默认第一间隔，不视为立即执行', async startDelayMs => {
    const input = await sample();
    const periodic = mechanism(input, 'source', 'default_tick_delay', 'tick');
    periodic.ability.tickSpec!.startDelayMs = startDelayMs;
    const row = periodic.record(0, 1000);
    input.done.damageRecords!.push(row);
    refreshFacts(input);
    expect(assess(input)).toMatchObject({ complete: true, issues: [] });
    row.timeMs = 0;
    refreshFacts(input);
    expect(assess(input).issues.join(';')).toContain('编译后的正首间隔');
  });
  it('周期拒绝负首延迟和偏离静态周期的可靠记录', async () => {
    const input = await sample();
    const periodic = mechanism(input, 'source', 'invalid_tick_delay', 'tick');
    const row = periodic.record(0, 500);
    input.done.damageRecords!.push(row);
    refreshFacts(input);
    expect(assess(input).complete).toBe(true);
    periodic.ability.tickSpec!.startDelayMs = -1;
    expect(assess(input).issues.join(';')).toContain('尚未核定');
    periodic.ability.tickSpec!.startDelayMs = 500;
    row.timeMs = 501;
    refreshFacts(input);
    expect(assess(input).issues.join(';')).toContain('静态周期');
  });
  it('周期在最后一刀后独立致死，真实击杀时刻不贴到最后命中', async () => {
    const input = await sample();
    input.request.initialSnapshot.combatants[1]!.attributes.hp!.current = 350;
    const periodic = mechanism(input, 'source', 'lethal_periodic', 'tick');
    periodic.ability.tickSpec!.startDelayMs = 2500;
    input.done.damageRecords!.push(periodic.record(0, 2500, 100));
    refreshFacts(input, 2500);
    expect(assess(input)).toMatchObject({ complete: true, issues: [], damageDealt: 400, hpLoss: 350, durationMs: 2500,
      execution: { targetKilled: true, targetKilledAtMs: 2500 } });
    expect(input.done.attackRecords![2]!.targetHpAfter).toBe(50);
    input.done.summary.execution!.targetKilledAtMs = 2000;
    expect(assess(input).complete).toBe(false);
  });
  it('同刻独立周期在最后一刀之后提交，按可靠明细顺序核对尾部', async () => {
    const input = await sample();
    input.request.initialSnapshot.combatants[1]!.attributes.hp!.current = 350;
    const periodic = mechanism(input, 'source', 'same_time_periodic', 'tick');
    periodic.ability.tickSpec!.startDelayMs = 2000;
    input.done.damageRecords!.push(periodic.record(0, 2000, 100));
    refreshFacts(input);
    expect(assess(input)).toMatchObject({ complete: true, issues: [], targetFinalHp: 0, execution: { targetKilledAtMs: 2000 } });
    expect(input.done.attackRecords![2]!.targetHpAfter).toBe(50);
  });
  it('已死亡后不能开启另一独立周期，即使它与同步尾部时间相同', async () => {
    const input = await sample();
    const periodic = mechanism(input, 'source', 'after_death', 'tick');
    periodic.ability.tickSpec!.startDelayMs = 2000;
    input.done.damageRecords!.push(periodic.record(0, 2000));
    refreshFacts(input);
    expect(assess(input).issues.join(';')).toContain('真实死亡以后出现新的攻击或独立周期');
  });
  it('周期的同一真实施放可提交多个伤害结果，不冒充下一事件', async () => {
    const input = await sample();
    input.request.initialSnapshot.combatants[1]!.attributes.hp!.current = 350;
    const periodic = mechanism(input, 'source', 'periodic_multi_result', 'tick');
    periodic.ability.tickSpec!.startDelayMs = 2500;
    periodic.ability.tickSpec!.onTick.push(structuredClone(periodic.operation));
    periodic.origin.compiledPaths.push(periodic.origin.compiledPaths[0]!.replace('onTick[0]', 'onTick[1]'));
    const first = periodic.record(0, 2500, 100);
    const second = periodic.record(0, 2500);
    second.operationPath = periodic.origin.compiledPaths[1]!;
    input.done.damageRecords!.push(first, second);
    refreshFacts(input, 2500);
    expect(assess(input)).toMatchObject({ complete: true, issues: [], damageDealt: 415, targetFinalHp: 0 });
    second.castInstanceId++;
    expect(assess(input).complete).toBe(false);
  });
  it('周期仍拒绝主动施放、过程、锚定状态和未核定节点类型', async () => {
    const input = await sample();
    input.request.initialSnapshot.combatants[1]!.attributes.hp!.current = 350;
    const periodic = mechanism(input, 'source', 'periodic_boundary', 'tick');
    periodic.ability.tickSpec!.startDelayMs = 2500;
    input.done.damageRecords!.push(periodic.record(0, 2500, 100));
    refreshFacts(input, 2500);
    expect(assess(input).complete).toBe(true);
    periodic.ability.castCondition = { op: 'const', value: 1 };
    expect(assess(input).complete).toBe(false);
    delete periodic.ability.castCondition;
    periodic.ability.processControl = { processKey: 'unopened', action: 'INITIAL', useRefFromEvent: true };
    expect(assess(input).complete).toBe(false);
    delete periodic.ability.processControl;
    periodic.ability.tickSpec!.anchorScope = 'state_scope/provider_target';
    periodic.ability.tickSpec!.anchorStateKey = 'unopened';
    expect(assess(input).complete).toBe(false);
    delete periodic.ability.tickSpec!.anchorScope; delete periodic.ability.tickSpec!.anchorStateKey;
    periodic.ability.kind = 'passive_tick';
    expect(assess(input).complete).toBe(false);
    periodic.ability.kind = 'tick';
    periodic.operation.operation = 'heal';
    expect(assess(input).complete).toBe(false);
  });
  it('B周期可以在最后一刀后击杀A，A→B刀额与终止事实独立', async () => {
    const input = await sample();
    input.request.initialSnapshot.combatants[1]!.attributes.hp!.current = 550;
    const periodic = mechanism(input, 'target', 'reverse_periodic', 'tick');
    periodic.ability.tickSpec!.startDelayMs = 2500;
    input.done.damageRecords!.push(periodic.record(0, 2500, 700));
    refreshFacts(input, 2500);
    expect(assess(input)).toMatchObject({ complete: true, issues: [], stopReason: 'source_dead', sourceFinalHp: 0,
      targetFinalHp: 250, damageDealt: 300, execution: { targetKilled: false, targetKilledAtMs: null } });
    input.done.summary.stopReason = 'duration_reached';
    input.request.stopPolicy.durationMs = input.done.summary.execution!.requestedDurationMs = 2500;
    expect(assess(input).issues.join(';')).toContain('真实死亡');
  });
  it.each([
    { matcher: ['event/basic_attack_hit', 'event/source_opponent'] },
    { matcher: ['event/damage_dealt', 'event/source_owner'] },
    { matcher: ['event/damage_dealt/basic_attack', 'event/source_owner'] },
    { matcher: ['event/basic_attack_hit', 'event/source_owner', 'event/damage_dealt'] }
  ])('未准入监听$matcher不因同刀方向金额一致而通过', async ({ matcher }) => {
    const input = await sample();
    const reverse = mechanism(input, 'target', 'reverse_direction', 'passive_listener');
    reverse.ability.listenerSpec!.eventMatcher.all = matcher;
    input.done.damageRecords!.push(...[1, 2, 3].map(index => reverse.record(index, (index - 1) * 1000, 40)));
    refreshFacts(input);
    expect(assess(input)).toMatchObject({ complete: false, sourceFinalHp: 530, damageDealt: 300 });
    expect(assess(input).issues.join(';')).toContain('尚未核定');
    expect(input.done.attackRecords!.map(row => row.postDefenseDamage)).toEqual([100, 100, 100]);
  });
  it('逐笔生命断链拒绝，尾部明细截断仍按完整生命收支核对', async () => {
    const input = await sample();
    input.request.initialSnapshot.combatants[1]!.attributes.hp!.current = 350;
    const periodic = mechanism(input, 'source', 'tail_evidence', 'tick');
    periodic.ability.tickSpec!.startDelayMs = 2500;
    input.done.damageRecords!.push(periodic.record(0, 2500, 100));
    refreshFacts(input, 2500);
    const row = input.done.damageRecords![3]!;
    row.hpBefore += 1; row.hpAfter += 1;
    expect(assess(input).issues.join(';')).toContain('连续可靠生命链');
    row.hpBefore -= 1; row.hpAfter -= 1;
    input.request.recordBudget = { maxAttackRecords: 3, maxDamageRecords: 3 };
    input.done.damageRecords!.pop();
    input.done.recording!.returnedDamageRecords = 3; input.done.recording!.droppedDamageRecords = 1; input.done.recording!.damageRecordsTruncated = true;
    expect(assess(input)).toMatchObject({ complete: true, issues: [], targetFinalHp: 0, execution: { targetKilledAtMs: 2500 } });
    input.done.summary.targetHpLoss = 349;
    expect(assess(input).issues.join(';')).toContain('最终生命收支');
  });
  it('缺少周期可靠分类或条件来源的编译路径，不因生命差相符而通过', async () => {
    const input = await sample();
    input.request.initialSnapshot.combatants[1]!.attributes.hp!.current = 350;
    const periodic = mechanism(input, 'source', 'periodic_identity', 'tick');
    periodic.ability.tickSpec!.startDelayMs = 2500;
    input.done.damageRecords!.push(periodic.record(0, 2500, 100));
    refreshFacts(input, 2500);
    input.done.summary.damageBreakdown!.pop();
    expect(assess(input).complete).toBe(false);
    refreshFacts(input, 2500);
    periodic.origin.compiledPaths[0] = input.prepared.operationOrigins[0]!.compiledPaths[0]!;
    expect(assess(input).complete).toBe(false);
  });
  it('已有普攻吸血和最后一刀后的周期吸血按真实逐笔受量闭合', async () => {
    const input = await sample();
    input.request.initialSnapshot.combatants[0]!.attributes.hp!.current = 600;
    input.done.damageRecords!.forEach(row => { row.sourceHpAfter = (row.sourceHpBefore as number) + 10; });
    refreshFacts(input);
    expect(assess(input)).toMatchObject({ complete: true, issues: [] });
    expect(input.done.summary.sourceVampHealing).toBe(30);
    input.request.initialSnapshot.combatants[1]!.attributes.hp!.current = 550;
    input.request.stopPolicy.durationMs = input.done.summary.execution!.requestedDurationMs = 2500;
    const periodic = mechanism(input, 'source', 'vamp_periodic', 'tick');
    periodic.ability.tickSpec!.startDelayMs = 2500;
    periodic.operation.vampOverrides = [{ vampType: 'LIFE_STEAL', mode: 'OVERRIDE', basisOutputKind: 'POST_DEFENSE_DAMAGE', efficiency: { op: 'const', value: 1 } }];
    const row = periodic.record(0, 2500, 100);
    row.sourceHpAfter = (row.sourceHpBefore as number) + 10;
    input.done.damageRecords!.push(row);
    refreshFacts(input, 2500);
    expect(assess(input)).toMatchObject({ complete: true, issues: [], sourceFinalHp: 640, targetFinalHp: 150 });
    expect(input.done.attackRecords![2]!.sourceHpAfter).toBe(630);
    expect(input.done.summary.sourceVampHealing).toBe(40);
    input.done.attackRecords![2]!.sourceHpAfter = 640;
    expect(assess(input).issues.join(';')).toContain('同步尾部检查点');
  });
  it('4B初始化光环按原生最终攻速核对，不把初始化前数值当逐刀事实', async () => {
    const input = await sample();
    input.prepared.compileRequest.typeCatalog.types.push({ key: 'event/source_initialized', domain: 'event' });
    input.request.initialSnapshot.combatants[0]!.attributes.attack_speed!.resolved = 1.25;
    expect(assess(input).complete).toBe(true);
    input.done.finalSnapshot.combatants[0]!.attributes.attack_speed!.resolved = 0.8;
    expect(assess(input).issues.join(';')).toContain('静态原生攻速');
  });
  it('4A派生只按静态原生最终攻速核对逐刀事实，不把固有攻速当装备后总值', async () => {
    const input = await sample();
    input.prepared.compileRequest.rules.attributeDerivations = [{ combatantKey: 'source', attributeKey: 'attack_speed', value: {
      op: 'read', path: 'source.attr.attack_speed.base'
    } }];
    input.request.initialSnapshot.combatants[0]!.attributes.attack_speed!.resolved = 0.5;
    expect(assess(input).complete).toBe(true);
    input.done.finalSnapshot.combatants[0]!.attributes.attack_speed!.resolved = 0.8;
    expect(assess(input).issues.join(';')).toContain('静态原生攻速');
  });
  it('仅曲线说明非法不抹掉独立核对的金额与逐刀事实', async () => {
    const input = await sample(); input.done.seriesSamplingEvidence = null as unknown as DoneResult['seriesSamplingEvidence'];
    const result = assess(input);
    expect(result).toMatchObject({ complete: false, factsValid: true, damageDealt: 300, hpLoss: 250, completedCount: 3 });
    expect(result.seriesIssues.length).toBeGreaterThan(0); expect(result.series).toEqual([]);
    expect(result.damageBreakdown).toEqual(input.done.summary.damageBreakdown);
  });
  it('可靠汇总和原生逐刀记录证明3刀击杀，调试证据不作为计数来源', async () => {
    const input = await sample();
    expect(assess(input)).toMatchObject({ complete: true, issues: [], completedCount: 3, startedCount: 3, hitCount: 3, damageDealt: 300, hpLoss: 250, targetFinalHp: 0, durationMs: 2000 });
    input.done.summary.abilityCastCount = 99;
    expect(assess(input).completedCount).toBe(3);
  });
  it('调试证据及记录截断不丢完整汇总，记录预算为0也能完整击杀', async () => {
    const input = await sample();
    input.request.recordBudget = { maxAttackRecords: 0, maxDamageRecords: 0 };
    input.done.attackRecords = []; input.done.damageRecords = [];
    input.done.recording = { attackRecordCount: 3, returnedAttackRecords: 0, droppedAttackRecords: 3, attackRecordsTruncated: true,
      damageRecordCount: 3, returnedDamageRecords: 0, droppedDamageRecords: 3, damageRecordsTruncated: true,
      mechanicRecordCount: 0, returnedMechanicRecords: 0, droppedMechanicRecords: 0, mechanicRecordsTruncated: false };
    input.done.summary.evidenceTruncated = true;
    input.done.evidence.truncated = true; input.done.evidence.truncatedEvidenceCount = 1;
    input.done.warnings = [{ code: 'evidence_truncated', message: '截断', severity: 'warning' }]; input.done.summary.warningCount = 1;
    expect(assess(input)).toMatchObject({ complete: true, damageDealt: 300, hpLoss: 250, completedCount: 3 });
    input.done.recording.damageRecordCount = 4;
    expect(assess(input).complete).toBe(false);
  });
  it('已提交击杀但尾部未完保留击杀事实；完整尾部恰达预算仍可完整', async () => {
    const input = await sample();
    input.done.summary.stopReason = 'budget_exceeded';
    input.done.summary.execution!.budgetCause = 'max_events';
    expect(assess(input).complete).toBe(true);
    input.done.summary.execution!.complete = false;
    input.done.summary.execution!.incompleteReason = 'unfinished_tail';
    input.done.summary.basicAttack!.completedCount = 2;
    input.done.attackRecords![2]!.completed = false;
    expect(assess(input)).toMatchObject({ complete: false, issues: [], completedCount: 2, execution: { targetKilled: true, targetKilledAtMs: 2000 } });
  });
  it('0毫秒击杀不被当缺值，未杀完整观察必须到请求终点', async () => {
    const input = await sample();
    input.done.summary.execution!.targetKilledAtMs = 0;
    expect(assess(input).execution.targetKilledAtMs).toBe(0);
    expect(assess(input).complete).toBe(false);
    input.done.summary.execution!.targetKilled = false;
    input.done.summary.execution!.targetKilledAtMs = null;
    expect(assess(input).complete).toBe(false);
  });
  it.each(['execution', 'basicAttack', 'sourceHpLoss', 'targetHpLoss', 'sourceVampHealing', 'targetVampHealing', 'damageBreakdown'])('缺少可靠字段%s拒绝而不补0', async field => {
    const input = await sample(); delete (input.done.summary as unknown as Record<string, unknown>)[field];
    expect(() => assess(input)).toThrow();
  });
  it('同刀身份、完整作者路径、金额或未知警告矛盾不能标成完整', async () => {
    for (const mutate of [
      (input: Awaited<ReturnType<typeof sample>>) => { input.done.damageRecords![0]!.operationRef = 'damage'; },
      (input: Awaited<ReturnType<typeof sample>>) => { input.done.damageRecords![0]!.operationPath = 'wrong'; },
      (input: Awaited<ReturnType<typeof sample>>) => { input.done.damageRecords![0]!.useRef = 'other'; },
      (input: Awaited<ReturnType<typeof sample>>) => { input.done.damageRecords![0]!.postDefenseDamage = 101; },
      (input: Awaited<ReturnType<typeof sample>>) => { input.done.attackRecords![1]!.useRef = input.done.attackRecords![0]!.useRef; },
      (input: Awaited<ReturnType<typeof sample>>) => { input.done.summary.warningCount = 1; input.done.warnings = [{ code: 'unknown', message: '未知', severity: 'warning' }]; }
    ]) { const input = await sample(); mutate(input); expect(assess(input).complete).toBe(false); }
  });
});

const assembleSimulation = (...args: Parameters<typeof raw_assembleSimulation>): ReturnType<typeof raw_assembleSimulation> => { approveSnapshotFixture(args[0]); return raw_assembleSimulation(...args); };
const inspectSimulationSnapshot = (...args: Parameters<typeof raw_inspectSimulationSnapshot>): ReturnType<typeof raw_inspectSimulationSnapshot> => { approveSnapshotFixture(args[0]); return raw_inspectSimulationSnapshot(...args); };
