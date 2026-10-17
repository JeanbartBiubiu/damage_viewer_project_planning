import { describe, expect, it } from 'vitest';
import type { DoneResult } from '../types/genericEngine';
import { preparedActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import { automaticSkillRequest } from './automaticSkillRequest';
import { assessAutomaticSkillResult } from './automaticSkillResult';
import { buildAutomaticSkillArchive } from './continuousAttackArchive';
import { initialAutomaticSkillView } from './automaticSkillPresentation';

async function sample() {
  const { prepared, snapshot } = preparedActiveSample(true);
  const request = (await automaticSkillRequest(prepared, snapshot, {
    rules: [{ ...snapshot.selection.plannedSkills[0]!, ruleKey: 'a', sortOrder: 0, targetSide: 'source', hitPreset: null,
      waitForCooldowns: [], releaseAfterRuleKey: null }], durationMs: 200, recordTimeSeries: false,
    maxAutomaticSkillRecords: 1000, maxHealingRecords: 256, outputMode: 'detailed'
  })).runRequest;
  const binding = prepared.compileRequest.rules.skillActionBindings![0]!;
  const useRef = 'auto_use_1';
  const finalSnapshot = structuredClone(request.initialSnapshot);
  finalSnapshot.timeMs = 200;
  finalSnapshot.combatants[0]!.attributes.hp!.current = 310;
  finalSnapshot.processInstances = [{ owner: 'source', target: 'source', providerRef: binding.providerRef, processKey: 'cast', skillKey: binding.skillKey,
    useKey: useRef, stepKey: 'delay', stepVersion: 1, stepExecutionIndex: 1, lastExecutionAtMs: 100, stepCompletedAtMs: 100,
    startedAtMs: 0, stepStartedAtMs: 0, advanceAtMs: 100, expiresAtMs: null, actualCosts: {}, cooldownStarted: true,
    status: 'complete', failureReason: null, finishedAtMs: 100, repeat: null,
    actionOccupancies: [{ stepKey: 'delay', stepVersion: 1, startedAtMs: 0, expectedEndAtMs: 100, finishedAtMs: 100 }] }];
  const counts = { attemptCount: 1, startedCount: 1, rejectedCount: 0, abortedBeforeStartCount: 0, completedCount: 1, failedCount: 0, inFlightCount: 0 };
  const done: DoneResult = { ok: true, summary: {
    durationMs: 200, stopReason: 'duration_reached', sourceFinalHp: 310, targetFinalHp: 500,
    sourceDamageDealt: 0, targetDamageDealt: 0, sourceDamageTaken: 0, targetDamageTaken: 0,
    abilityAttemptCount: 1, abilityCastCount: 1, attemptSkippedCount: 0, warningCount: 0, evidenceTruncated: false, seriesDownsampled: false,
    sourceHpLoss: 0, targetHpLoss: 0, sourceVampHealing: 0, targetVampHealing: 0, sourceDirectHealing: 60, targetDirectHealing: 0,
    skillUses: { startedCount: 1, releasedCount: 1, hitCount: 0, completedCount: 1, failedCount: 0, inFlightCount: 0,
      stepEnteredCount: 1, stepExecutedCount: 1, stepCompletedCount: 1 },
    execution: { requestedDurationMs: 200, complete: true, incompleteReason: null, budgetCause: null, targetKilled: false, targetKilledAtMs: null }, damageBreakdown: [], abilityStats: [] },
    finalSnapshot, series: [], warnings: [], evidence: { items: [], truncated: false, truncatedEvidenceCount: 0, countsByKind: {} },
    seriesSamplingEvidence: { requestedSampleEveryMs: 100, effectiveSampleEveryMs: 0, requestedPointCount: 0, finalPointCount: 0, maxSeriesPoints: 5000, downsampled: false, method: 'disabled' },
    attackRecords: [], damageRecords: [], mechanicRecords: [],
    healingRecords: [{ timeMs: 0, source: 'source', target: 'source', abilityRef: `source.provider[${binding.providerRef}].ability[listen_heal_1]`,
      operationRef: 'skills.sample_active.effects.heal_1.results.heal', instructionKey: 'auto_a_1', useRef,
      rawAmount: 60, healingAfterDone: 60, healingAfterModifiers: 60, actualHealing: 60, overheal: 0, hpBefore: 250, hpAfter: 310 }],
    recording: { attackRecordCount: 0, returnedAttackRecords: 0, droppedAttackRecords: 0, attackRecordsTruncated: false,
      damageRecordCount: 0, returnedDamageRecords: 0, droppedDamageRecords: 0, damageRecordsTruncated: false,
      mechanicRecordCount: 0, returnedMechanicRecords: 0, droppedMechanicRecords: 0, mechanicRecordsTruncated: false,
      healingRecordCount: 1, returnedHealingRecords: 1, droppedHealingRecords: 0, healingRecordsTruncated: false },
    automaticSkillSummary: { ...counts, ruleCount: 1, rules: [{ ...counts, ruleKey: 'a', waiting: { reason: 'OWN_COOLDOWN', relatedRuleKeys: [], nextCheckAtMs: 1000 } }], qualifications: [] },
    automaticSkillRecords: [
      { sequence: 1, timeMs: 0, kind: 'STARTED', ruleKey: 'a', useRef, relatedRuleKey: null, relatedUseRef: null, reason: null, nextCheckAtMs: null },
      { sequence: 2, timeMs: 100, kind: 'COMPLETED', ruleKey: 'a', useRef, relatedRuleKey: null, relatedUseRef: null, reason: null, nextCheckAtMs: null },
      { sequence: 3, timeMs: 100, kind: 'WAIT_CHANGED', ruleKey: 'a', useRef: null, relatedRuleKey: null, relatedUseRef: null, reason: 'OWN_COOLDOWN', nextCheckAtMs: 1000 }
    ], automaticSkillRecording: { totalCount: 3, returnedCount: 3, omittedCount: 0, droppedCount: 0, truncated: false }
  };
  return { prepared, request, done };
}

describe('自动模式完整累计与严格记录契约', () => {
  it('无需手动instructionKey和固定时刻即可核对真实自动使用、过程和生命账', async () => {
    const { prepared, request, done } = await sample();
    expect(request.driverPlan.skillActions).toEqual([]);
    expect(assessAutomaticSkillResult(prepared.compileRequest, request, done)).toEqual({ complete: true, factsValid: true, detailIdentityVerified: true, identityGaps: [], issues: [] });
    done.healingRecords![0]!.instructionKey = 'internal_auto_identity_changed';
    expect(assessAutomaticSkillResult(prepared.compileRequest, request, done).complete).toBe(true);
  });
  it.each([0, 1])('预算%s只保留真实前缀，不改变完整累计和过程证明', async maximum => {
    const { prepared, request, done } = await sample();
    request.recordBudget!.maxAutomaticSkillRecords = maximum;
    done.automaticSkillRecords = done.automaticSkillRecords!.slice(0, maximum);
    done.automaticSkillRecording = { totalCount: 3, returnedCount: maximum, omittedCount: 0, droppedCount: 3 - maximum, truncated: true };
    expect(assessAutomaticSkillResult(prepared.compileRequest, request, done)).toMatchObject({ complete: true, detailIdentityVerified: false });
    expect(done.automaticSkillSummary!.startedCount).toBe(1);
  });
  it('汇总模式的空数组表示未请求，完整规则和数值继续核对', async () => {
    const { prepared, request, done } = await sample();
    request.outputMode = 'summary'; done.outputMode = 'summary';
    done.automaticSkillRecords = []; done.healingRecords = [];
    done.automaticSkillRecording = { totalCount: 3, returnedCount: 0, omittedCount: 3, droppedCount: 0, truncated: false };
    expect(assessAutomaticSkillResult(prepared.compileRequest, request, done)).toMatchObject({ complete: true, detailIdentityVerified: false });
    done.summary.sourceDirectHealing = 0;
    expect(assessAutomaticSkillResult(prepared.compileRequest, request, done).issues.join(';')).toContain('生命账');
  });
  it('自动冻结导出保留真实计划与资格，过滤连接及鉴权信息', async () => {
    const { prepared, request, done } = await sample();
    const archive = buildAutomaticSkillArchive({ taskKind: 'automatic_skill', compileRequest: prepared.compileRequest, runRequest: request,
      runResult: done, runInputHash: 'frozen', adminToken: 'private', error: 'Bearer private', cleanup: 'released' }, initialAutomaticSkillView(200));
    expect(JSON.stringify(archive)).not.toContain('private');
    expect(archive.runRequest).toMatchObject({ driverPlan: { skillActions: [], automaticSkills: { rules: [{ ruleKey: 'a' }] } } });
    expect(archive.runResult).toMatchObject({ automaticSkillSummary: { ruleCount: 1 }, automaticSkillRecords: done.automaticSkillRecords });
  });
  it.each(['count', 'counter_sum', 'unknown_rule', 'unknown_field', 'sequence', 'timestamp', 'fake_use', 'wait_use', 'omitted', 'manual', 'duplicate_qualification', 'wrong_mode'] as const)
    ('拒绝协议伪造：%s', async kind => {
      const { prepared, request, done } = await sample();
      if (kind === 'count') done.automaticSkillSummary!.attemptCount = 2;
      if (kind === 'counter_sum') done.automaticSkillSummary!.rules[0]!.attemptCount = 2;
      if (kind === 'unknown_rule') done.automaticSkillSummary!.rules[0]!.ruleKey = 'unknown';
      if (kind === 'unknown_field') (done.automaticSkillRecords![0] as unknown as Record<string, unknown>).extra = true;
      if (kind === 'sequence') done.automaticSkillRecords![1]!.sequence = 3;
      if (kind === 'timestamp') done.automaticSkillRecords![1]!.timeMs = 101;
      if (kind === 'fake_use') done.automaticSkillRecords![0]!.useRef = 'borrowed';
      if (kind === 'wait_use') done.automaticSkillRecords![2]!.useRef = 'auto_use_1';
      if (kind === 'omitted') done.automaticSkillRecording!.omittedCount = 1;
      if (kind === 'manual') done.skillActionRecords = [];
      if (kind === 'duplicate_qualification') done.automaticSkillSummary!.qualifications.push({ grantorRuleKey: 'a', consumerRuleKey: 'a', grantedCount: 1, consumedCount: 0, remainingCount: 1, lastGrantUseRef: 'auto_use_1', lastConsumeUseRef: null });
      if (kind === 'wrong_mode') done.outputMode = 'summary';
      expect(assessAutomaticSkillResult(prepared.compileRequest, request, done).factsValid).toBe(false);
    });
});
