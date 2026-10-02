import { describe, expect, it } from 'vitest';
import { simulationSample } from '../../tests/fixtures/simulationSnapshot';
import type { AttackRecord, DamageRecord, DoneResult } from '../types/genericEngine';
import { assembleSimulation, inspectSimulationSnapshot } from './simulationAdapter';
import { continuousAttackRequest } from './continuousAttackRequest';
import { assessContinuousAttackResult } from './continuousAttackResult';

async function sample() {
  const snapshot = simulationSample();
  snapshot.source.selectedLevelValues.attack_speed = 1;
  const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) inputs[row.side][row.attribute.attributeKey] = 0;
  const prepared = assembleSimulation(snapshot, inputs, { source: 650, target: 250 });
  const { runRequest: request } = await continuousAttackRequest(prepared, snapshot, { durationMs: 30000, attackSpeedInputMax: 1 }, 'session');
  const plan = request.driverPlan.basicAttack!;
  const origin = prepared.operationOrigins.find(row => row.resultKey === 'damage')!;
  const attackRecords: AttackRecord[] = [];
  const damageRecords: DamageRecord[] = [];
  for (let index = 1; index <= 3; index++) {
    const hpBefore = 250 - (index - 1) * 100;
    const actualHpLoss = Math.min(100, hpBefore);
    attackRecords.push({ planKey: plan.planKey, attackIndex: index, useRef: `use_${index}`, source: 'source', target: 'target', skillKey: plan.skillKey,
      startAtMs: (index - 1) * 1000, hitAtMs: (index - 1) * 1000, readyAtMs: index * 1000,
      nextStartAtMs: index === 3 ? null : index * 1000, attackSpeed: 1, postDefenseDamage: 100, actualHpLoss,
      sourceHpAfter: 650, targetHpAfter: hpBefore - actualHpLoss, completed: true });
    damageRecords.push({ damageId: index, attackIndex: index, useRef: `use_${index}`, timeMs: (index - 1) * 1000,
      owner: 'source', source: 'source', target: 'target', abilityRef: plan.hitAbilityRef, castInstanceId: index * 3,
      operationRef: origin.operationRef, operationPath: origin.compiledPaths[0]!, damageType: 'damage/physics',
      rawAmount: 100, postDefenseDamage: 100, shieldAbsorbed: 0, actualHpLoss, overkillDamage: 100 - actualHpLoss, hpBefore, hpAfter: hpBefore - actualHpLoss,
      resistanceBeforePenetration: 0, penetrationPercent: 0, penetrationFlat: 0, effectiveResistance: 0, resistanceFactor: 1,
      normalPartPostResistance: 100, critPartPostResistance: 0, eligible: true, policy: 'expected', baseRawAmount: 100,
      originalCritChance: 0, effectiveCritChance: 0, multiplier: 2, normalPart: 100, critPart: 0, critAdjustedRawAmount: 100 });
  }
  const finalSnapshot = structuredClone(request.initialSnapshot);
  finalSnapshot.timeMs = 2000;
  finalSnapshot.combatants[1]!.attributes.hp!.current = 0;
  finalSnapshot.processInstances = [1, 2, 3].map(index => ({ owner: 'source', target: 'target', providerRef: 'selected_basic_attack',
    processKey: 'attack', skillKey: plan.skillKey, useKey: `use_${index}`, stepKey: 'begin', stepVersion: 1,
    startedAtMs: (index - 1) * 1000, stepStartedAtMs: (index - 1) * 1000, advanceAtMs: (index - 1) * 1000,
    expiresAtMs: null, actualCosts: {}, cooldownStarted: true, status: 'complete', failureReason: null, finishedAtMs: (index - 1) * 1000 }));
  const done: DoneResult = { ok: true,
    summary: { durationMs: 2000, stopReason: 'target_dead', sourceFinalHp: 650, targetFinalHp: 0,
      sourceDamageDealt: 300, targetDamageTaken: 300, sourceDamageTaken: 0, targetDamageDealt: 0,
      sourceHpLoss: 0, targetHpLoss: 250, abilityAttemptCount: 6, abilityCastCount: 9, attemptSkippedCount: 0,
      warningCount: 0, evidenceTruncated: false, seriesDownsampled: false, abilityStats: [],
      basicAttack: { planKey: plan.planKey, startedCount: 3, hitCount: 3, completedCount: 3 },
      execution: { requestedDurationMs: 30000, complete: true, incompleteReason: null, budgetCause: null, targetKilled: true, targetKilledAtMs: 2000 },
      damageBreakdown: [{ owner: 'source', source: 'source', target: 'target', abilityRef: plan.hitAbilityRef,
        operationRef: origin.operationRef, damageType: 'damage/physics', damageCount: 3, postDefenseDamage: 300, shieldAbsorbed: 0, actualHpLoss: 250, overkillDamage: 50 }] },
    finalSnapshot, attackRecords, damageRecords,
    recording: { attackRecordCount: 3, returnedAttackRecords: 3, droppedAttackRecords: 0, attackRecordsTruncated: false,
      damageRecordCount: 3, returnedDamageRecords: 3, droppedDamageRecords: 0, damageRecordsTruncated: false },
    evidence: { items: [], truncated: false, truncatedEvidenceCount: 0, countsByKind: {} }, warnings: [], series: [],
    seriesSamplingEvidence: { requestedSampleEveryMs: 100, effectiveSampleEveryMs: 0, requestedPointCount: 0, finalPointCount: 0, maxSeriesPoints: 5000, downsampled: false, method: 'disabled' } };
  return { prepared, request, done };
}
const assess = (item: Awaited<ReturnType<typeof sample>>) => assessContinuousAttackResult(item.prepared.compileRequest, item.request, item.done, item.prepared.operationOrigins);

describe('连续可靠结果解释', () => {
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
      damageRecordCount: 3, returnedDamageRecords: 0, droppedDamageRecords: 3, damageRecordsTruncated: true };
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
  it.each(['execution', 'basicAttack', 'sourceHpLoss', 'targetHpLoss', 'damageBreakdown'])('缺少可靠字段%s拒绝而不补0', async field => {
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
