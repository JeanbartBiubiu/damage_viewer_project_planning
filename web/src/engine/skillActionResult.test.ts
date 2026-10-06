import { describe, expect, it } from 'vitest';
import type { DoneResult } from '../types/genericEngine';
import { preparedActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import { skillActionRequest } from './skillActionRequest';
import { assessSkillActionResult } from './skillActionResult';
import { buildSkillActionArchive, buildSkillActionCsv } from './continuousAttackArchive';

async function sample() {
  const { prepared, snapshot } = preparedActiveSample(true);
  const request = (await skillActionRequest(prepared, snapshot, { actions: [{ ...snapshot.selection.plannedSkills[0]!,
    instructionKey: 'first_cast', atMs: 0, sortOrder: 0, phaseKind: 'INITIAL', parentInstructionKey: null,
    targetSide: 'source', hitPreset: null }], durationMs: 200, recordTimeSeries: false,
    maxSkillActionRecords: 32, maxSkillUseRecords: 128, maxHealingRecords: 256 })).runRequest;
  const binding = prepared.compileRequest.rules.skillActionBindings![0]!;
  const useRef = 'skill:first_cast';
  const finalSnapshot = structuredClone(request.initialSnapshot);
  finalSnapshot.timeMs = 200;
  finalSnapshot.combatants[0]!.attributes.hp!.current = 310;
  finalSnapshot.processInstances = [{ owner: 'source', target: 'source', providerRef: binding.providerRef, processKey: 'cast', skillKey: binding.skillKey,
    useKey: useRef, stepKey: 'delay', stepVersion: 1, stepExecutionIndex: 1, lastExecutionAtMs: 100, stepCompletedAtMs: 100,
    startedAtMs: 0, stepStartedAtMs: 0, advanceAtMs: 100, expiresAtMs: null,
    actualCosts: {}, cooldownStarted: true, status: 'complete', failureReason: null, finishedAtMs: 100, repeat: null,
    actionOccupancies: [{ stepKey: 'delay', stepVersion: 1, startedAtMs: 0, expectedEndAtMs: 100, finishedAtMs: 100 }] }];
  const done: DoneResult = { ok: true, summary: {
    durationMs: 200, stopReason: 'duration_reached', sourceFinalHp: 310, targetFinalHp: 500,
    sourceDamageDealt: 0, targetDamageDealt: 0, sourceDamageTaken: 0, targetDamageTaken: 0,
    abilityAttemptCount: 1, abilityCastCount: 1, attemptSkippedCount: 0, warningCount: 0, evidenceTruncated: false, seriesDownsampled: false,
    sourceHpLoss: 0, targetHpLoss: 0, sourceVampHealing: 0, targetVampHealing: 0, sourceDirectHealing: 60, targetDirectHealing: 0,
    skillActions: { plannedCount: 1, reachedCount: 1, acceptedCount: 1, rejectedCount: 0, abortedBeforeAcceptCount: 0, unreachedCount: 0 },
    skillUses: { startedCount: 1, releasedCount: 1, hitCount: 0, completedCount: 1, failedCount: 0, inFlightCount: 0,
      stepEnteredCount: 1, stepExecutedCount: 1, stepCompletedCount: 1 },
    execution: { requestedDurationMs: 200, complete: true, incompleteReason: null, budgetCause: null, targetKilled: false, targetKilledAtMs: null }, damageBreakdown: [], abilityStats: [] },
    finalSnapshot, series: [], warnings: [], evidence: { items: [], truncated: false, truncatedEvidenceCount: 0, countsByKind: {} },
    seriesSamplingEvidence: { requestedSampleEveryMs: 100, effectiveSampleEveryMs: 0, requestedPointCount: 0, finalPointCount: 0, maxSeriesPoints: 5000, downsampled: false, method: 'disabled' },
    attackRecords: [], damageRecords: [], mechanicRecords: [],
    skillActionRecords: [{ instructionKey: 'first_cast', parentInstructionKey: null, requestedAtMs: 0, actualAtMs: 0, action: 'INITIAL', source: 'source', target: 'source',
      skillKey: binding.skillKey, bindingKey: binding.bindingKey, providerRef: binding.providerRef, providerDefinitionRef: binding.providerDefinitionRef,
      outcome: 'ACCEPTED', reason: null, useRef }],
    skillUseRecords: (['STARTED', 'STEP_ENTERED', 'STEP_EXECUTED', 'RELEASED', 'STEP_COMPLETED', 'COMPLETED'] as const).map(kind => ({ instructionKey: 'first_cast',
      timeMs: kind === 'STARTED' || kind === 'STEP_ENTERED' ? 0 : 100,
      kind, source: 'source', target: 'source', skillKey: binding.skillKey, providerRef: binding.providerRef, processKey: 'cast', useRef, hitRef: null, reason: null,
      stepKey: kind === 'STARTED' ? '' : 'delay', stepVersion: kind === 'STARTED' ? 0 : 1, executionIndex: kind === 'STARTED' || kind === 'STEP_ENTERED' ? 0 : 1 })),
    healingRecords: [{ timeMs: 0, source: 'source', target: 'source', abilityRef: `source.provider[${binding.providerRef}].ability[listen_heal_1]`,
      operationRef: 'skills.sample_active.effects.heal_1.results.heal', instructionKey: 'first_cast', useRef,
      rawAmount: 60, healingAfterDone: 60, healingAfterModifiers: 60, actualHealing: 60, overheal: 0, hpBefore: 250, hpAfter: 310 }],
    recording: { attackRecordCount: 0, returnedAttackRecords: 0, droppedAttackRecords: 0, attackRecordsTruncated: false,
      damageRecordCount: 0, returnedDamageRecords: 0, droppedDamageRecords: 0, damageRecordsTruncated: false,
      mechanicRecordCount: 0, returnedMechanicRecords: 0, droppedMechanicRecords: 0, mechanicRecordsTruncated: false,
      skillActionRecordCount: 1, returnedSkillActionRecords: 1, droppedSkillActionRecords: 0, skillActionRecordsTruncated: false,
      skillUseRecordCount: 6, returnedSkillUseRecords: 6, droppedSkillUseRecords: 0, skillUseRecordsTruncated: false,
      healingRecordCount: 1, returnedHealingRecords: 1, droppedHealingRecords: 0, healingRecordsTruncated: false }
  };
  return { prepared, request, done };
}

describe('6A原生事实与冻结导出核对', () => {
  it.each([false, true])('接受取消必须对应原使用同刻主动取消失败，使用记录截断%s不能仅复用身份', async truncated => {
    const { prepared, request, done } = await sample();
    const binding = prepared.compileRequest.rules.skillActionBindings![0]!;
    const provider = prepared.compileRequest.sharedProviders!.find(provider => provider.providerKey === binding.providerDefinitionRef)!;
    const abilityRef = `source.provider[${binding.providerRef}].ability[cancel]`;
    binding.controls.push({ action: 'CANCEL', processKey: 'cast', abilityRef });
    provider.abilities!.push({ abilityKey: 'cancel', kind: 'active', skillKey: binding.skillKey,
      processControl: { action: 'CANCEL', processKey: 'cast', failureReason: 'ACTIVE_CANCELLED' } });
    request.driverPlan.skillActions!.push({ ...request.driverPlan.skillActions![0]!, instructionKey: 'cancel', action: 'CANCEL',
      abilityRef, firstAtMs: 50, parentInstructionKey: 'first_cast', hitBindings: [] });
    done.skillActionRecords!.push({ ...done.skillActionRecords![0]!, instructionKey: 'cancel', action: 'CANCEL', requestedAtMs: 50,
      actualAtMs: 50, parentInstructionKey: 'first_cast' });
    done.summary.skillActions!.plannedCount = done.summary.skillActions!.reachedCount = done.summary.skillActions!.acceptedCount = 2;
    done.summary.skillUses!.releasedCount = done.summary.skillUses!.completedCount = done.summary.skillUses!.stepExecutedCount = done.summary.skillUses!.stepCompletedCount = 0;
    done.summary.skillUses!.failedCount = 1;
    const process = done.finalSnapshot.processInstances![0]!;
    process.status = 'failed'; process.failureReason = 'ACTIVE_CANCELLED'; process.finishedAtMs = 50;
    process.stepExecutionIndex = 0; process.lastExecutionAtMs = process.stepCompletedAtMs = null;
    process.actionOccupancies[0]!.finishedAtMs = 50;
    done.skillUseRecords = [...done.skillUseRecords!.slice(0, 2), { ...done.skillUseRecords![1]!, kind: 'FAILED', timeMs: 50, reason: 'ACTIVE_CANCELLED' }];
    done.recording!.skillActionRecordCount = done.recording!.returnedSkillActionRecords = 2;
    done.recording!.skillUseRecordCount = done.recording!.returnedSkillUseRecords = 3;
    if (truncated) {
      request.recordBudget = { ...request.recordBudget, maxSkillUseRecords: 0 };
      done.skillUseRecords = [];
      done.recording!.returnedSkillUseRecords = 0; done.recording!.droppedSkillUseRecords = 3;
      done.recording!.skillUseRecordsTruncated = true;
    }
    expect(assessSkillActionResult(prepared.compileRequest, request, done).factsValid).toBe(true);
    process.finishedAtMs = process.actionOccupancies[0]!.finishedAtMs = 51;
    if (!truncated) done.skillUseRecords![2]!.timeMs = 51;
    expect(assessSkillActionResult(prepared.compileRequest, request, done).issues.join(';')).toContain('同刻真实步骤');
  });

  it.each([
    ['stepExecutedCount', 0], ['stepCompletedCount', 0], ['stepExecutedCount', 1], ['stepCompletedCount', 1]
  ] as const)('有限明细伪造完整%s且记录上限%s并同步伪造记录总数仍拒绝', async (field, limit) => {
    const { prepared, request, done } = await sample();
    request.recordBudget = { ...request.recordBudget, maxSkillActionRecords: limit, maxSkillUseRecords: limit, maxHealingRecords: limit };
    done.skillActionRecords = done.skillActionRecords!.slice(0, limit);
    done.skillUseRecords = done.skillUseRecords!.slice(0, limit);
    done.healingRecords = done.healingRecords!.slice(0, limit);
    done.summary.skillUses![field] = 2;
    for (const [kind, total] of [['skillAction', 1], ['skillUse', 7], ['healing', 1]] as const) {
      const recording = done.recording! as unknown as Record<string, unknown>;
      const capital = kind[0]!.toUpperCase() + kind.slice(1);
      recording[`${kind}RecordCount`] = total; recording[`returned${capital}Records`] = limit;
      recording[`dropped${capital}Records`] = total - limit; recording[`${kind}RecordsTruncated`] = total > limit;
    }
    expect(assessSkillActionResult(prepared.compileRequest, request, done).issues.join(';')).toContain(`summary.skillUses.${field}`);
  });
  it('多条同来源首次累计守恒，真实使用不能跨指令互借', async () => {
    const { prepared, request, done } = await sample();
    const second = { ...request.driverPlan.skillActions![0]!, instructionKey: 'second_cast', firstAtMs: 1000 };
    request.driverPlan.skillActions!.push(second);
    request.stopPolicy.durationMs = 1200;
    done.summary.durationMs = done.finalSnapshot.timeMs = 1200;
    done.summary.execution!.requestedDurationMs = 1200;
    done.summary.skillActions = { plannedCount: 2, reachedCount: 2, acceptedCount: 2, rejectedCount: 0, abortedBeforeAcceptCount: 0, unreachedCount: 0 };
    done.summary.skillUses = { startedCount: 2, releasedCount: 2, hitCount: 0, completedCount: 2, failedCount: 0, inFlightCount: 0,
      stepEnteredCount: 2, stepExecutedCount: 2, stepCompletedCount: 2 };
    done.finalSnapshot.processInstances!.push({ ...structuredClone(done.finalSnapshot.processInstances![0]!), useKey: 'skill:second_cast',
      startedAtMs: 1000, stepStartedAtMs: 1000, advanceAtMs: 1100, finishedAtMs: 1100,
      lastExecutionAtMs: 1100, stepCompletedAtMs: 1100,
      actionOccupancies: [{ stepKey: 'delay', stepVersion: 1, startedAtMs: 1000, expectedEndAtMs: 1100, finishedAtMs: 1100 }] });
    done.skillActionRecords!.push({ ...done.skillActionRecords![0]!, instructionKey: 'second_cast', requestedAtMs: 1000, actualAtMs: 1000, useRef: 'skill:second_cast' });
    done.skillUseRecords!.push(...done.skillUseRecords!.map(row => ({ ...row, instructionKey: 'second_cast', useRef: 'skill:second_cast', timeMs: row.timeMs + 1000 })));
    done.healingRecords!.push({ ...done.healingRecords![0]!, instructionKey: 'second_cast', useRef: 'skill:second_cast', timeMs: 1000,
      abilityRef: done.healingRecords![0]!.abilityRef.replace('heal_1', 'heal_0'), operationRef: done.healingRecords![0]!.operationRef.replace('heal_1', 'heal_0'),
      rawAmount: 40, healingAfterDone: 40, healingAfterModifiers: 40, actualHealing: 40, hpBefore: 310, hpAfter: 350 });
    done.summary.sourceDirectHealing = 100;
    done.summary.sourceFinalHp = done.finalSnapshot.combatants[0]!.attributes.hp!.current = 350;
    done.recording = { ...done.recording!, skillActionRecordCount: 2, returnedSkillActionRecords: 2, skillUseRecordCount: 12, returnedSkillUseRecords: 12,
      healingRecordCount: 2, returnedHealingRecords: 2 };
    expect(assessSkillActionResult(prepared.compileRequest, request, done).complete).toBe(true);
    done.skillUseRecords![6]!.useRef = 'skill:first_cast';
    expect(assessSkillActionResult(prepared.compileRequest, request, done).factsValid).toBe(false);
  });
  it('自身治疗与吸血明确分开，完整生命账和有限明细一致', async () => {
    const { prepared, request, done } = await sample();
    expect(assessSkillActionResult(prepared.compileRequest, request, done)).toEqual({ complete: true, factsValid: true, detailIdentityVerified: true, identityGaps: [], issues: [] });
  });

  it('0记录不从证据补造明细、不影响完整观察累计', async () => {
    const { prepared, request, done } = await sample();
    request.recordBudget = { ...request.recordBudget, maxSkillActionRecords: 0, maxSkillUseRecords: 0, maxHealingRecords: 0 };
    done.skillActionRecords = []; done.skillUseRecords = []; done.healingRecords = [];
    for (const [kind, total] of [['skillAction', 1], ['skillUse', 6], ['healing', 1]] as const) {
      const recording = done.recording! as unknown as Record<string, unknown>;
      const capital = kind[0]!.toUpperCase() + kind.slice(1);
      recording[`returned${capital}Records`] = 0; recording[`dropped${capital}Records`] = total; recording[`${kind}RecordsTruncated`] = true;
    }
    expect(assessSkillActionResult(prepared.compileRequest, request, done)).toMatchObject({ complete: true, detailIdentityVerified: false });
    expect(buildSkillActionCsv('healing', [], 'frozen', [0, 200], done.recording).split('\r\n')).toHaveLength(1);
  });

  it('观察完整但尚在途，不假称施法完成；已提交部分预算不改成拒绝', async () => {
    const { prepared, request, done } = await sample();
    request.stopPolicy.durationMs = done.summary.durationMs = done.summary.execution!.requestedDurationMs = 50;
    done.finalSnapshot.timeMs = 50;
    done.summary.skillUses!.completedCount = done.summary.skillUses!.releasedCount = 0;
    done.summary.skillUses!.inFlightCount = 1;
    done.summary.skillUses!.stepExecutedCount = done.summary.skillUses!.stepCompletedCount = 0;
    done.skillUseRecords = done.skillUseRecords!.slice(0, 2);
    done.recording!.skillUseRecordCount = done.recording!.returnedSkillUseRecords = 2;
    const process = done.finalSnapshot.processInstances![0]!;
    process.status = 'active'; process.finishedAtMs = null; process.expiresAtMs = 100; process.actionOccupancies[0]!.finishedAtMs = null;
    process.stepExecutionIndex = 0; process.lastExecutionAtMs = process.stepCompletedAtMs = null;
    expect(assessSkillActionResult(prepared.compileRequest, request, done).complete).toBe(true);
    done.summary.execution = { ...done.summary.execution!, complete: false, incompleteReason: 'budget_exceeded', budgetCause: 'max_events' };
    expect(assessSkillActionResult(prepared.compileRequest, request, done)).toMatchObject({ complete: false, factsValid: true });
  });

  it.each(['ledger', 'delayed', 'fake_hit', 'records', 'missing_zero'] as const)('拒绝伪造或不一致事实：%s', async kind => {
    const { prepared, request, done } = await sample();
    if (kind === 'ledger') done.summary.sourceVampHealing = 1;
    if (kind === 'delayed') done.skillActionRecords![0]!.actualAtMs = 1;
    if (kind === 'fake_hit') done.summary.skillUses!.hitCount = 1;
    if (kind === 'records') done.recording!.droppedHealingRecords = 1;
    if (kind === 'missing_zero') delete done.summary.targetDirectHealing;
    expect(assessSkillActionResult(prepared.compileRequest, request, done).factsValid).toBe(false);
  });

  it('冻结档案保留计划、费用声明与清理，不带连接或鉴权，CSV只导出实际事实', async () => {
    const { prepared, request, done } = await sample();
    const archive = buildSkillActionArchive({ taskKind: 'skill_action', compileRequest: prepared.compileRequest, runRequest: request,
      runResult: done, ignoredCastCosts: [], cleanup: 'released', adminToken: 'private', error: 'Bearer private' }, [0, 200]);
    expect(JSON.stringify(archive)).not.toContain('private');
    expect(archive.runRequest).toMatchObject({ driverPlan: { skillActions: [{ instructionKey: 'first_cast' }] } });
    expect(buildSkillActionCsv('healing', done.healingRecords!, 'frozen', [0, 200], done.recording).split('\r\n')).toHaveLength(2);
  });
});
