import { describe, expect, it } from 'vitest';
import type { DoneResult, ProcessInstanceSnapshot } from '../types/genericEngine';
import { fixedValue, parameterValue, formulaValue } from '../types/numericValue';
import { simulationComplexSample, complexAction, complexInputs } from '../../tests/fixtures/simulationComplexSkills';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import { prepareSimulation } from './simulationAdapter';
import { skillActionRequest } from './skillActionRequest';
import { plannedSkillsFromAutomaticRules, automaticSkillRequest } from './automaticSkillRequest';
import { inspectProcessSkillHitStages, processSkillHitTimes } from './processSkillHitStageFacts';
import { finiteRecastDefinition, processForSkillUse, recastUseOrdinal, recastUseRef } from './finiteRecast';
import { assessSkillActionResult } from './skillActionResult';
import { assessAutomaticSkillResult } from './automaticSkillResult';
import { automaticUseOrigin, indexAutomaticPresentation } from './automaticSkillPresentation';

function authored(background = false) {
  const snapshot = simulationComplexSample('RECAST', background, false), config = snapshot.skillConfigurations[1]!, process = config.processes[0]!;
  process.steps[0] = { ...process.steps[0]!, stepType: 'IMMEDIATE', detail: {} };
  const tail = process.steps[1]!;
  if (tail.stepType !== 'RECAST') throw Error('fixture');
  tail.detail = { windowValue: fixedValue(15000), maximumRecastCountValue: fixedValue(2), intervalValue: fixedValue(1000) };
  process.cooldown = { durationValue: fixedValue(100000), startMoment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null } };
  snapshot.selection.plannedSkills[0]!.phaseKinds = ['INITIAL', 'RECAST'];
  config.triggerRules = config.triggerRules.filter(r => r.eventSource.eventType !== 'PROCESS_CANCEL_REQUESTED');
  const hit = config.triggerRules.find(r => r.eventSource.eventType === 'SKILL_HIT')!;
  config.triggerRules = config.triggerRules.filter(r => r !== hit);
  for (const [i, step] of process.steps.entries()) config.triggerRules.push({ ...structuredClone(hit), ruleKey: `hit_phase_${i}`, sortOrder: 10 + i,
    eventSource: { eventType: 'SKILL_HIT', detail: { sourceSkillKey: config.skill.skillKey,
      processMoment: { processKey: process.processKey, moment: { momentType: 'STEP_EXECUTION', stepKey: step.stepKey }, requiresPriorStepKey: null } } } });
  for (const side of ['source', 'target'] as const) {
    Object.assign(snapshot[side].selectedLevelValues, { armor_pen_flat: 0, armor_pen_percent: 0, magic_pen_flat: 0, magic_pen_percent: 0,
      life_steal_percent: 0, omnivamp_percent: 0, critical_strike_chance: 0, critical_strike_damage_bonus_percent: 0 });
    snapshot[side].attributes.levelValues['1'] = { ...snapshot[side].selectedLevelValues };
  }
  syncSimulationSkillSources(snapshot);
  return { snapshot, config, tail };
}
async function prepared() {
  const { snapshot } = authored(); approveSnapshotFixture(snapshot);
  const result = await prepareSimulation(snapshot, { source: {}, target: {} }, { source: 1000, target: 5000 });
  const binding = result.compileRequest.rules.skillActionBindings![0]!;
  const definition = result.compileRequest.sharedProviders!.find(p => p.providerKey === binding.providerDefinitionRef)!.processes![0]!;
  return { snapshot, prepared: result, binding, definition };
}
function state(binding: Awaited<ReturnType<typeof prepared>>['binding'], definition: Awaited<ReturnType<typeof prepared>>['definition'], u0 = 'skill:first'): ProcessInstanceSnapshot {
  return { owner: 'source', providerRef: binding.providerRef, processKey: definition.processKey, skillKey: binding.skillKey, useKey: u0, target: 'target',
    stepKey: definition.steps[1]!.stepKey, stepVersion: 2, stepExecutionIndex: 2, startedAtMs: 0, stepStartedAtMs: 0, advanceAtMs: 3000,
    expiresAtMs: 15000, lastExecutionAtMs: 2000, stepCompletedAtMs: 2000, actualCosts: {}, cooldownStarted: true,
    status: 'complete', finishedAtMs: 2000, failureReason: null, repeat: null, actionOccupancies: [],
    skillHitStages: [0, 1000, 2000].map((timeMs, i) => ({ hitBindingKey: binding.hitBindings[i ? 1 : 0]!.hitBindingKey,
      stepKey: definition.steps[i ? 1 : 0]!.stepKey, timeMs, released: true, contact: false, completed: true })) };
}
async function doneSample(automatic: boolean) {
  const sample = await prepared(), { snapshot, prepared: p, binding, definition } = sample;
  const actions = [complexAction(snapshot, 'first', 0), complexAction(snapshot, 'again', 1000, 'RECAST', 'first'), complexAction(snapshot, 'last', 2000, 'RECAST', 'first')];
  actions[0]!.hitPreset = 'MISS';
  const autoInputs = { rules: [{ ...snapshot.selection.plannedSkills[0]!, ruleKey: 'r', sortOrder: 0, targetSide: 'target' as const, hitPreset: 'MISS' as const,
    waitForCooldowns: [], releaseAfterRuleKey: null }], durationMs: 2001, recordTimeSeries: false, maxAutomaticSkillRecords: 0, maxHealingRecords: 0, outputMode: 'summary' as const };
  const request = automatic ? (await automaticSkillRequest(p, snapshot, autoInputs)).runRequest
    : (await skillActionRequest(p, snapshot, { ...complexInputs(actions, 2001), recordTimeSeries: false, maxSkillActionRecords: 0, maxSkillUseRecords: 0, maxHealingRecords: 0 })).runRequest;
  const finalSnapshot = structuredClone(request.initialSnapshot); finalSnapshot.timeMs = 2001;
  finalSnapshot.processInstances = [state(binding, definition, automatic ? 'skill:auto_r_1' : 'skill:first')];
  const counts = { attemptCount: 1, startedCount: 1, rejectedCount: 0, abortedBeforeStartCount: 0, completedCount: 1, failedCount: 0, inFlightCount: 0 };
  const done: DoneResult = { ok: true, summary: { durationMs: 2001, stopReason: 'duration_reached', sourceFinalHp: 1000, targetFinalHp: 5000,
    sourceDamageDealt: 0, targetDamageDealt: 0, sourceDamageTaken: 0, targetDamageTaken: 0, abilityAttemptCount: 3, abilityCastCount: 3, attemptSkippedCount: 0,
    warningCount: 0, evidenceTruncated: false, seriesDownsampled: false, sourceHpLoss: 0, targetHpLoss: 0, sourceVampHealing: 0, targetVampHealing: 0,
    sourceDirectHealing: 0, targetDirectHealing: 0, skillUses: { startedCount: 1, releasedCount: 3, hitCount: 0, completedCount: 1, failedCount: 0, inFlightCount: 0,
      stepEnteredCount: 2, stepExecutedCount: 3, stepCompletedCount: 2 },
    ...(!automatic ? { skillActions: { plannedCount: 3, reachedCount: 3, acceptedCount: 3, rejectedCount: 0, abortedBeforeAcceptCount: 0, unreachedCount: 0 } } : {}),
    execution: { requestedDurationMs: 2001, complete: true, incompleteReason: null, budgetCause: null, targetKilled: false, targetKilledAtMs: null }, damageBreakdown: [], abilityStats: [] },
    finalSnapshot, series: [], warnings: [], evidence: { items: [], truncated: false, truncatedEvidenceCount: 0, countsByKind: {} },
    seriesSamplingEvidence: { requestedSampleEveryMs: 100, effectiveSampleEveryMs: 0, requestedPointCount: 0, finalPointCount: 0, maxSeriesPoints: 5000, downsampled: false, method: 'disabled' },
    attackRecords: [], damageRecords: [], mechanicRecords: [], healingRecords: [],
    ...(!automatic ? { skillActionRecords: [], skillUseRecords: [] } : { outputMode: 'summary' as const,
      automaticSkillSummary: { ...counts, ruleCount: 1, rules: [{ ...counts, ruleKey: 'r', waiting: { reason: 'OWN_COOLDOWN' as const, relatedRuleKeys: [], nextCheckAtMs: 100000 } }], qualifications: [] },
      automaticSkillRecords: [], automaticSkillRecording: { totalCount: 3, returnedCount: 0, omittedCount: 3, droppedCount: 0, truncated: false } }),
    recording: { attackRecordCount: 0, returnedAttackRecords: 0, droppedAttackRecords: 0, attackRecordsTruncated: false,
      damageRecordCount: 0, returnedDamageRecords: 0, droppedDamageRecords: 0, damageRecordsTruncated: false,
      mechanicRecordCount: 0, returnedMechanicRecords: 0, droppedMechanicRecords: 0, mechanicRecordsTruncated: false,
      healingRecordCount: 0, returnedHealingRecords: 0, droppedHealingRecords: 0, healingRecordsTruncated: false,
      ...(!automatic ? { skillActionRecordCount: 3, returnedSkillActionRecords: 0, droppedSkillActionRecords: 3, skillActionRecordsTruncated: true,
        skillUseRecordCount: 12, returnedSkillUseRecords: 0, droppedSkillUseRecords: 12, skillUseRecordsTruncated: true } : {}) } };
  return { ...sample, request, done };
}

describe('有限重施的真实作者、Ui及不可截断关系', () => {
  it('真实作者两步图同时进入手动与自动闭包，次数和静态间隔不丢失，后台普攻可保留', async () => {
    const { snapshot, config } = authored(true); approveSnapshotFixture(snapshot);
    const p = await prepareSimulation(snapshot, { source: {}, target: {} }, { source: 1000, target: 5000 });
    expect(p.basicAttackBinding).toBeTruthy();
    const process = p.compileRequest.sharedProviders!.find(p => p.processes?.some(x => x.skillKey === config.skill.skillKey))!.processes![0]!;
    expect(finiteRecastDefinition(process)).toEqual({ maximum: 2, interval: 1000, window: 15000 });
    const rules = [{ ...snapshot.selection.plannedSkills[0]!, ruleKey: 'r', sortOrder: 0, targetSide: 'target' as const, hitPreset: 'TARGET_HIT' as const, waitForCooldowns: [], releaseAfterRuleKey: null }];
    expect(plannedSkillsFromAutomaticRules(rules, snapshot.skillConfigurations)[0]!.phaseKinds).toEqual(['INITIAL', 'RECAST']);
    expect(() => plannedSkillsFromAutomaticRules(rules, [])).toThrow('作者');
  });
  it.each([undefined, null])('作者间隔%s都降为字段省略，不发送原生null', async value => {
    const { snapshot, tail } = authored(); if (tail.stepType !== 'RECAST') throw Error('fixture');
    tail.detail.intervalValue = value; approveSnapshotFixture(snapshot);
    const p = await prepareSimulation(snapshot, { source: {}, target: {} }, { source: 1000, target: 5000 });
    expect(p.compileRequest.sharedProviders!.flatMap(x => x.processes ?? []).flatMap(p => p.steps).find(s => s.stepType === 'RECAST')).not.toHaveProperty('intervalMs');
  });
  it.each([0, 64, 1.5, -1])('拒绝额外次数%s', async count => {
    const { snapshot, tail } = authored(); if (tail.stepType !== 'RECAST') throw Error('fixture'); tail.detail.maximumRecastCountValue = fixedValue(count); approveSnapshotFixture(snapshot);
    await expect(prepareSimulation(snapshot, { source: {}, target: {} }, { source: 1000, target: 5000 })).rejects.toThrow(/重施/);
  });
  it('其它等级的非法静态次数不能借当前合法等级通过', async () => {
    const { snapshot, config, tail } = authored(); if (tail.stepType !== 'RECAST') throw Error('fixture');
    config.skill.maxLevel = 2;
    config.parameters.push({ gameId: snapshot.gameId, skillKey: config.skill.skillKey, parameterKey: 'recasts', name: '重施数', description: null,
      valueMode: 'SKILL_LEVEL', valueType: 'INTEGER', fixedValue: null, levelValues: { '1': 2, '2': 64 }, sortOrder: 1, createdAt: '', updatedAt: '' });
    tail.detail.maximumRecastCountValue = parameterValue('recasts'); approveSnapshotFixture(snapshot);
    await expect(prepareSimulation(snapshot, { source: {}, target: {} }, { source: 1000, target: 5000 })).rejects.toThrow(/重施/);
  });
  it('静态共同公式的逐等级核定值保留到最终编译，不以JS重算替代原生预检', async () => {
    const { snapshot, config, tail } = authored(); if (tail.stepType !== 'RECAST') throw Error('fixture');
    config.skill.maxLevel = 2;
    config.parameters.push({ gameId: snapshot.gameId, skillKey: config.skill.skillKey, parameterKey: 'recasts', name: '重施数', description: null,
      valueMode: 'SKILL_LEVEL', valueType: 'INTEGER', fixedValue: null, levelValues: { '1': 2, '2': 3 }, sortOrder: 1, createdAt: '', updatedAt: '' });
    config.formulas.push({ gameId: snapshot.gameId, skillKey: config.skill.skillKey, formulaKey: 'recast_count', name: '静态次数', description: null,
      sortOrder: 1, createdAt: '', updatedAt: '', expression: { inputs: [{ key: 'count', binding: { kind: 'parameter', skillKey: config.skill.skillKey, parameterKey: 'recasts' } }],
        stages: [{ key: 'out', name: '次数', expression: { op: 'read', inputKey: 'count' } }], outputStageKey: 'out' } });
    tail.detail.maximumRecastCountValue = formulaValue('recast_count'); approveSnapshotFixture(snapshot);
    const p = await prepareSimulation(snapshot, { source: {}, target: {} }, { source: 1000, target: 5000 });
    expect(p.compileRequest.sharedProviders!.flatMap(x => x.processes ?? []).flatMap(p => p.steps).find(s => s.stepType === 'RECAST')!.maximumRecastCount).toEqual({ op: 'const', value: 2 });
    expect(new Set(p.approvedFormulaValues.map(v => v.value))).toEqual(new Set([2, 3]));
    for (const value of p.approvedFormulaValues) expect(p.compileRequest.formulas!.some(f => f.key === value.formula.key)).toBe(true);
  });
  it.each([false, true])('记录0的%s模式仍核三发与一个窗口，不按Ui别名重复累计', async automatic => {
    const { prepared, request, done } = await doneSample(automatic);
    const assess = automatic ? assessAutomaticSkillResult : assessSkillActionResult;
    expect(assess(prepared.compileRequest, request, done).issues).toEqual([]);
    done.summary.skillUses!.hitCount = 1;
    expect(assess(prepared.compileRequest, request, done).factsValid).toBe(false);
  });
  it.each([
    [false, 'lastExecutionAtMs'], [true, 'lastExecutionAtMs'],
    [false, 'completion'], [true, 'completion'],
  ] as const)('记录0的%s模式拒绝与末条真实阶段不符的%s时刻', async (automatic, field) => {
    const { prepared, request, done } = await doneSample(automatic);
    const p = done.finalSnapshot.processInstances![0]!;
    if (field === 'lastExecutionAtMs') p.lastExecutionAtMs = 1999;
    else { p.stepCompletedAtMs = 2001; p.finishedAtMs = 2001; }
    const assess = automatic ? assessAutomaticSkillResult : assessSkillActionResult;
    expect(assess(prepared.compileRequest, request, done).factsValid).toBe(false);
  });
  it('手动控制记录使用Ui，全部STEP与生命周期仍U0；旧父别名和错逐发指令拒绝', async () => {
    const { prepared, request, done, binding, definition } = await doneSample(false);
    const p = done.finalSnapshot.processInstances![0]!, u0 = p.useKey;
    request.recordBudget!.maxSkillActionRecords = 64; request.recordBudget!.maxSkillUseRecords = 128;
    done.skillActionRecords = request.driverPlan.skillActions!.map((a, i) => ({ instructionKey: a.instructionKey, parentInstructionKey: a.parentInstructionKey ?? null,
      requestedAtMs: a.firstAtMs, actualAtMs: a.firstAtMs, action: a.action, source: a.source, target: a.target, skillKey: binding.skillKey,
      bindingKey: binding.bindingKey, providerRef: binding.providerRef, providerDefinitionRef: binding.providerDefinitionRef,
      outcome: 'ACCEPTED', reason: null, useRef: recastUseRef(u0, i) }));
    const make = (kind: NonNullable<DoneResult['skillUseRecords']>[number]['kind'], step: number, ordinal: number, timeMs: number) => ({
      kind, timeMs, source: 'source', target: 'target', skillKey: binding.skillKey, providerRef: binding.providerRef, processKey: definition.processKey,
      instructionKey: kind === 'RELEASED' ? ['first', 'again', 'last'][ordinal]! : 'first',
      useRef: kind === 'RELEASED' ? recastUseRef(u0, ordinal) : u0, hitRef: null, reason: null,
      stepKey: step < 0 ? '' : definition.steps[step]!.stepKey, stepVersion: step + 1, executionIndex: kind === 'STARTED' || kind === 'STEP_ENTERED' ? 0 : step === 0 ? 1 : ordinal });
    done.skillUseRecords = [make('STARTED', -1, 0, 0), make('STEP_ENTERED', 0, 0, 0), make('STEP_EXECUTED', 0, 0, 0), make('RELEASED', 0, 0, 0), make('STEP_COMPLETED', 0, 0, 0),
      make('STEP_ENTERED', 1, 0, 0), make('STEP_EXECUTED', 1, 1, 1000), make('RELEASED', 1, 1, 1000), make('STEP_EXECUTED', 1, 2, 2000), make('RELEASED', 1, 2, 2000), make('STEP_COMPLETED', 1, 2, 2000), make('COMPLETED', 1, 2, 2000)];
    Object.assign(done.recording!, { returnedSkillActionRecords: 3, droppedSkillActionRecords: 0, skillActionRecordsTruncated: false,
      returnedSkillUseRecords: 12, droppedSkillUseRecords: 0, skillUseRecordsTruncated: false });
    expect(assessSkillActionResult(prepared.compileRequest, request, done).issues).toEqual([]);
    done.skillActionRecords![2]!.useRef = u0;
    expect(assessSkillActionResult(prepared.compileRequest, request, done).factsValid).toBe(false);
    done.skillActionRecords![2]!.useRef = recastUseRef(u0, 2);
    done.skillUseRecords![9]!.instructionKey = 'again';
    expect(assessSkillActionResult(prepared.compileRequest, request, done).factsValid).toBe(false);
  });
  it('零间隔、记录0的两个同刻重施仍按执行序号核接受总数', async () => {
    const { prepared, request, done, definition } = await doneSample(false);
    delete definition.steps[1]!.intervalMs;
    request.driverPlan.skillActions!.forEach((a, i) => { a.firstAtMs = 0; a.sortOrder = i; });
    const p = done.finalSnapshot.processInstances![0]!;
    p.lastExecutionAtMs = 0; p.stepCompletedAtMs = 0; p.finishedAtMs = 0; p.advanceAtMs = 0;
    p.skillHitStages!.forEach(f => { f.timeMs = 0; });
    expect(assessSkillActionResult(prepared.compileRequest, request, done).issues).toEqual([]);
    done.summary.skillActions!.acceptedCount = 2;
    expect(assessSkillActionResult(prepared.compileRequest, request, done).factsValid).toBe(false);
  });
  it('既有单次纯控制重施没有命中阶段时，仍用实际执行时刻核Ui及父窗口', async () => {
    const { snapshot, config, tail } = authored();
    config.processes[0]!.steps[0] = { ...config.processes[0]!.steps[0]!, stepType: 'DELAY', detail: { delayValue: fixedValue(100) } };
    if (tail.stepType !== 'RECAST') throw Error('fixture');
    tail.detail.maximumRecastCountValue = fixedValue(1); delete tail.detail.intervalValue;
    config.triggerRules = config.triggerRules.filter(r => r.eventSource.eventType !== 'SKILL_HIT');
    syncSimulationSkillSources(snapshot); approveSnapshotFixture(snapshot);
    const p = await prepareSimulation(snapshot, { source: {}, target: {} }, { source: 1000, target: 5000 });
    const binding = p.compileRequest.rules.skillActionBindings![0]!;
    expect(binding.hitBindings).toEqual([]);
    const definition = p.compileRequest.sharedProviders!.find(p => p.providerKey === binding.providerDefinitionRef)!.processes![0]!;
    const actions = [complexAction(snapshot, 'first', 0), complexAction(snapshot, 'again', 1000, 'RECAST', 'first')]
      .map(a => ({ ...a, targetSide: 'source' as const, hitPreset: null }));
    const request = (await skillActionRequest(p, snapshot, { ...complexInputs(actions, 2001), recordTimeSeries: false,
      maxSkillUseRecords: 0, maxHealingRecords: 0 })).runRequest;
    const { done } = await doneSample(false);
    done.finalSnapshot = structuredClone(request.initialSnapshot); done.finalSnapshot.timeMs = 2001;
    const instance: ProcessInstanceSnapshot = { owner: 'source', providerRef: binding.providerRef, processKey: definition.processKey,
      skillKey: binding.skillKey, useKey: 'skill:first', target: 'source', stepKey: definition.steps[1]!.stepKey, stepVersion: 2,
      stepExecutionIndex: 1, startedAtMs: 0, stepStartedAtMs: 100, advanceAtMs: 1000, expiresAtMs: 15100,
      lastExecutionAtMs: 1000, stepCompletedAtMs: 1000, actualCosts: {}, cooldownStarted: true, status: 'complete',
      finishedAtMs: 1000, failureReason: null, repeat: null, actionOccupancies: [] };
    done.finalSnapshot.processInstances = [instance];
    Object.assign(done.summary, { abilityAttemptCount: 2, abilityCastCount: 2 });
    Object.assign(done.summary.skillUses!, { releasedCount: 0, stepExecutedCount: 2 });
    Object.assign(done.summary.skillActions!, { plannedCount: 2, reachedCount: 2, acceptedCount: 2 });
    done.skillActionRecords = request.driverPlan.skillActions!.map((a, i) => ({ instructionKey: a.instructionKey,
      parentInstructionKey: a.parentInstructionKey ?? null, requestedAtMs: a.firstAtMs, actualAtMs: a.firstAtMs,
      action: a.action, source: a.source, target: a.target, skillKey: binding.skillKey, bindingKey: binding.bindingKey,
      providerRef: binding.providerRef, providerDefinitionRef: binding.providerDefinitionRef, outcome: 'ACCEPTED', reason: null,
      useRef: recastUseRef(instance.useKey, i) }));
    Object.assign(done.recording!, { skillActionRecordCount: 2, returnedSkillActionRecords: 2, droppedSkillActionRecords: 0,
      skillActionRecordsTruncated: false, skillUseRecordCount: 8, droppedSkillUseRecords: 8 });
    expect(assessSkillActionResult(p.compileRequest, request, done).issues).toEqual([]);
    done.skillActionRecords![1]!.useRef = instance.useKey;
    expect(assessSkillActionResult(p.compileRequest, request, done).factsValid).toBe(false);
    done.skillActionRecords![1]!.useRef = recastUseRef(instance.useKey, 1); instance.lastExecutionAtMs = 1100;
    expect(assessSkillActionResult(p.compileRequest, request, done).factsValid).toBe(false);
  });
  it('Ui只由真实父窗口和已提交序号导出；错误父、缺阶段和伪重复拒绝', async () => {
    const { binding, definition } = await prepared(), p = state(binding, definition);
    const presets = binding.hitBindings.map(h => ({ hitBindingKey: h.hitBindingKey, preset: 'MISS' as const }));
    expect(inspectProcessSkillHitStages(binding, definition, p, presets, 2001)).toHaveLength(3);
    expect(recastUseOrdinal(p, definition, recastUseRef(p.useKey, 2))).toBe(2);
    expect(recastUseOrdinal(p, definition, 'recast:skill:foreign:1')).toBeNull();
    expect(recastUseOrdinal(p, definition, 'recast:skill:first:01')).toBeNull();
    expect(processForSkillUse([p], [definition], 'recast:skill:foreign:1')).toBeUndefined();
    expect(processSkillHitTimes(p, binding.hitBindings[1]!, recastUseRef(p.useKey, 1), definition)).toEqual([]);
    p.skillHitStages!.pop(); expect(() => inspectProcessSkillHitStages(binding, definition, p, presets, 2001)).toThrow('序号');
  });
  it('未配置间隔的同毫秒相同末尾事实不能按值去重，仍为两个Ui', async () => {
    const { binding, definition } = await prepared(); delete definition.steps[1]!.intervalMs;
    const p = state(binding, definition); p.lastExecutionAtMs = 0; p.stepCompletedAtMs = 0; p.finishedAtMs = 0;
    p.skillHitStages!.forEach(f => { f.timeMs = 0; });
    const presets = binding.hitBindings.map(h => ({ hitBindingKey: h.hitBindingKey, preset: 'MISS' as const }));
    expect(inspectProcessSkillHitStages(binding, definition, p, presets, 1)).toHaveLength(3);
    expect(recastUseRef(p.useKey, 1)).not.toBe(recastUseRef(p.useKey, 2));
    p.skillHitStages!.push({ ...p.skillHitStages![2]! });
    expect(() => inspectProcessSkillHitStages(binding, definition, p, presets, 1)).toThrow('序号');
  });
  it('首发MISS不阻止后发，尚有额度的死亡停止保留active且原窗口不续期', async () => {
    const { binding, definition } = await prepared(), p = state(binding, definition);
    const presets = binding.hitBindings.map((h, i) => ({ hitBindingKey: h.hitBindingKey, preset: i === 0 ? 'MISS' as const : 'TARGET_HIT' as const }));
    p.skillHitStages![1]!.contact = true; p.skillHitStages![2]!.contact = true;
    expect(inspectProcessSkillHitStages(binding, definition, p, presets, 2001)).toHaveLength(3);
    p.skillHitStages!.pop(); p.stepExecutionIndex = 1; p.lastExecutionAtMs = 1000; p.status = 'active'; p.finishedAtMs = null; p.stepCompletedAtMs = null; p.advanceAtMs = 2000;
    expect(inspectProcessSkillHitStages(binding, definition, p, presets, 1000)).toHaveLength(2);
    p.expiresAtMs = 16000;
    expect(() => inspectProcessSkillHitStages(binding, definition, p, presets, 1000)).toThrow('窗口');
  });
  it('来源追溯将Ui定位到该窗口RECAST控制，不能把Ui当作第二个过程', async () => {
    const { prepared, request, done, binding } = await doneSample(true);
    const u0 = done.finalSnapshot.processInstances![0]!.useKey, ui = recastUseRef(u0, 1);
    const index = indexAutomaticPresentation(done);
    index.byUse.set(ui, { useRef: ui, automatic: [], attacks: [], damage: [], healing: [], resources: [], processes: [] });
    const origin = automaticUseOrigin(prepared.compileRequest, request, index, ui);
    expect(origin.issue).toBeNull(); expect(origin.origin!.control.action).toBe('RECAST');
    expect(origin.origin!.instance.useKey).toBe(u0); expect(origin.origin!.binding).toBe(binding);
    expect(automaticUseOrigin(prepared.compileRequest, request, index, 'recast:skill:foreign:1').origin).toBeNull();
  });
});
