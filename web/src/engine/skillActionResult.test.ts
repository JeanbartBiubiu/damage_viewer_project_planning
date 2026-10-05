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
  const done: DoneResult = { ok: true, summary: {
    durationMs: 200, stopReason: 'duration_reached', sourceFinalHp: 310, targetFinalHp: 500,
    sourceDamageDealt: 0, targetDamageDealt: 0, sourceDamageTaken: 0, targetDamageTaken: 0,
    abilityAttemptCount: 1, abilityCastCount: 1, attemptSkippedCount: 0, warningCount: 0, evidenceTruncated: false, seriesDownsampled: false,
    sourceHpLoss: 0, targetHpLoss: 0, sourceVampHealing: 0, targetVampHealing: 0, sourceDirectHealing: 60, targetDirectHealing: 0,
    skillActions: { plannedCount: 1, reachedCount: 1, acceptedCount: 1, rejectedCount: 0, abortedBeforeAcceptCount: 0, unreachedCount: 0 },
    skillUses: { startedCount: 1, releasedCount: 1, hitCount: 0, completedCount: 1, failedCount: 0, inFlightCount: 0 },
    execution: { requestedDurationMs: 200, complete: true, incompleteReason: null, budgetCause: null, targetKilled: false, targetKilledAtMs: null }, damageBreakdown: [], abilityStats: [] },
    finalSnapshot, series: [], warnings: [], evidence: { items: [], truncated: false, truncatedEvidenceCount: 0, countsByKind: {} },
    seriesSamplingEvidence: { requestedSampleEveryMs: 100, effectiveSampleEveryMs: 0, requestedPointCount: 0, finalPointCount: 0, maxSeriesPoints: 5000, downsampled: false, method: 'disabled' },
    attackRecords: [], damageRecords: [], mechanicRecords: [],
    skillActionRecords: [{ instructionKey: 'first_cast', requestedAtMs: 0, actualAtMs: 0, action: 'INITIAL', source: 'source', target: 'source',
      skillKey: binding.skillKey, bindingKey: binding.bindingKey, providerRef: binding.providerRef, providerDefinitionRef: binding.providerDefinitionRef,
      outcome: 'ACCEPTED', reason: null, useRef }],
    skillUseRecords: (['STARTED', 'RELEASED', 'COMPLETED'] as const).map(kind => ({ instructionKey: 'first_cast', timeMs: kind === 'STARTED' ? 0 : 100,
      kind, source: 'source', target: 'source', skillKey: binding.skillKey, providerRef: binding.providerRef, processKey: 'cast', useRef, hitRef: null, reason: null })),
    healingRecords: [{ timeMs: 0, source: 'source', target: 'source', abilityRef: `source.provider[${binding.providerRef}].ability[listen_heal_1]`,
      operationRef: 'skills.sample_active.effects.heal_1.results.heal', instructionKey: 'first_cast', useRef,
      rawAmount: 60, healingAfterDone: 60, healingAfterModifiers: 60, actualHealing: 60, overheal: 0, hpBefore: 250, hpAfter: 310 }],
    recording: { attackRecordCount: 0, returnedAttackRecords: 0, droppedAttackRecords: 0, attackRecordsTruncated: false,
      damageRecordCount: 0, returnedDamageRecords: 0, droppedDamageRecords: 0, damageRecordsTruncated: false,
      mechanicRecordCount: 0, returnedMechanicRecords: 0, droppedMechanicRecords: 0, mechanicRecordsTruncated: false,
      skillActionRecordCount: 1, returnedSkillActionRecords: 1, droppedSkillActionRecords: 0, skillActionRecordsTruncated: false,
      skillUseRecordCount: 3, returnedSkillUseRecords: 3, droppedSkillUseRecords: 0, skillUseRecordsTruncated: false,
      healingRecordCount: 1, returnedHealingRecords: 1, droppedHealingRecords: 0, healingRecordsTruncated: false }
  };
  return { prepared, request, done };
}

describe('6A原生事实与冻结导出核对', () => {
  it('多条同来源首次累计守恒，真实使用不能跨指令互借', async () => {
    const { prepared, request, done } = await sample();
    const second = { ...request.driverPlan.skillActions![0]!, instructionKey: 'second_cast', firstAtMs: 1000 };
    request.driverPlan.skillActions!.push(second);
    request.stopPolicy.durationMs = 1200;
    done.summary.durationMs = done.finalSnapshot.timeMs = 1200;
    done.summary.execution!.requestedDurationMs = 1200;
    done.summary.skillActions = { plannedCount: 2, reachedCount: 2, acceptedCount: 2, rejectedCount: 0, abortedBeforeAcceptCount: 0, unreachedCount: 0 };
    done.summary.skillUses = { startedCount: 2, releasedCount: 2, hitCount: 0, completedCount: 2, failedCount: 0, inFlightCount: 0 };
    done.skillActionRecords!.push({ ...done.skillActionRecords![0]!, instructionKey: 'second_cast', requestedAtMs: 1000, actualAtMs: 1000, useRef: 'skill:second_cast' });
    done.skillUseRecords!.push(...done.skillUseRecords!.map(row => ({ ...row, instructionKey: 'second_cast', useRef: 'skill:second_cast', timeMs: row.timeMs + 1000 })));
    done.healingRecords!.push({ ...done.healingRecords![0]!, instructionKey: 'second_cast', useRef: 'skill:second_cast', timeMs: 1000,
      abilityRef: done.healingRecords![0]!.abilityRef.replace('heal_1', 'heal_0'), operationRef: done.healingRecords![0]!.operationRef.replace('heal_1', 'heal_0'),
      rawAmount: 40, healingAfterDone: 40, healingAfterModifiers: 40, actualHealing: 40, hpBefore: 310, hpAfter: 350 });
    done.summary.sourceDirectHealing = 100;
    done.summary.sourceFinalHp = done.finalSnapshot.combatants[0]!.attributes.hp!.current = 350;
    done.recording = { ...done.recording!, skillActionRecordCount: 2, returnedSkillActionRecords: 2, skillUseRecordCount: 6, returnedSkillUseRecords: 6,
      healingRecordCount: 2, returnedHealingRecords: 2 };
    expect(assessSkillActionResult(prepared.compileRequest, request, done).complete).toBe(true);
    done.skillUseRecords![3]!.useRef = 'skill:first_cast';
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
    for (const [kind, total] of [['skillAction', 1], ['skillUse', 3], ['healing', 1]] as const) {
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
    done.skillUseRecords = done.skillUseRecords!.slice(0, 1);
    done.recording!.skillUseRecordCount = done.recording!.returnedSkillUseRecords = 1;
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
