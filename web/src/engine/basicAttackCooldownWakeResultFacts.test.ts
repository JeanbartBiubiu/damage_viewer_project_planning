import { beforeAll, describe, expect, it } from 'vitest';
import { loadMechanismCases } from '../../tests/mechanisms/mechanismCase';
import { mechanismEngine, runMechanismCase, type MechanismRun } from '../../tests/mechanisms/mechanismRunner';
import { assessAutomaticSkillResult } from './automaticSkillResult';

let original: MechanismRun;
beforeAll(async () => {
  const definition = loadMechanismCases().find(row => row.caseKey === 'schedule_basic_attack_reduces_cooldown')!;
  original = await runMechanismCase(definition);
}, 60000);
const assess = (run: MechanismRun) => assessAutomaticSkillResult(run.prepared.compileRequest, run.runRequest, run.done, run.prepared.operationOrigins);
const copy = () => structuredClone(original);

describe('普攻命中同刻减冷却唤醒后的行动占用', () => {
  it('真实Wasm先提交3200毫秒第四刀，再启动占用到3400的第二次主动', () => {
    expect(original.projection.attackStarts).toEqual([200, 1200, 2200, 3200, 4200, 5200]);
    expect(original.projection.skillStarts.map(row => row.timeMs)).toEqual([0, 3200]);
    expect(original.done.attackRecords![3]).toMatchObject({ startAtMs: 3200, hitAtMs: 3200, actionReadyAtMs: 3400 });
    expect(assess(original)).toMatchObject({ complete: true, factsValid: true, detailIdentityVerified: true, identityGaps: [] });
  });

  it.each(['before_hit', 'foreign_use', 'missing_event', 'not_own_cooldown', 'insufficient_reduction', 'not_same_mount'] as const)
  ('同刻不能掩盖缺失或伪造因果：%s', variant => {
    const run = copy(), items = run.done.evidence.items;
    const consumer = run.done.finalSnapshot.processInstances!.find(row => row.skillKey === 'lab_true_strike' && row.startedAtMs === 3200)!;
    const hit = items.findIndex(row => row.timeMs === 3200 && row.kind === 'emitted_event' && row.ref === 'event/basic_attack_hit');
    const started = items.findIndex(row => row.timeMs === 3200 && row.kind === 'process_moment'
      && row.data?.moment === 'PROCESS_START' && row.data.useKey === consumer.useKey);
    if (variant === 'before_hit') [items[hit], items[started]] = [items[started]!, items[hit]!];
    if (variant === 'foreign_use') items[hit]!.data!.useRef = 'different_attack';
    if (variant === 'missing_event') items.splice(hit, 1);
    if (variant === 'not_own_cooldown') {
      const previous = run.done.automaticSkillRecords!.filter(row => row.timeMs < 3200 && row.kind === 'WAIT_CHANGED').at(-1)!;
      previous.reason = 'ACTION_OCCUPIED';
    }
    const binding = run.prepared.compileRequest.rules.skillActionBindings![0]!;
    const provider = run.prepared.compileRequest.sharedProviders!.find(row => row.providerKey === binding.providerDefinitionRef)!;
    const reduction = provider.abilities!.find(row => row.listenerSpec?.operations?.some(op => op.operation === 'cooldown_change'))!.listenerSpec!.operations![0]!;
    if (variant === 'insufficient_reduction') reduction.amount = { op: 'const', value: 100 };
    if (variant === 'not_same_mount') reduction.abilityRef = 'source.provider[another_mount].ability[start]';
    const assessment = assess(run);
    expect(assessment.factsValid).toBe(false);
    expect(assessment.issues.join(';')).toContain('processInstances.actionReady');
  });

  it('真正早于本刀的占用即使记录被裁剪仍拒绝', () => {
    const run = copy();
    const process = run.done.finalSnapshot.processInstances!.find(row => row.skillKey === 'lab_true_strike' && row.startedAtMs === 3200)!;
    process.startedAtMs = process.stepStartedAtMs = process.actionOccupancies[0]!.startedAtMs = 3100;
    run.done.evidence.items = []; run.done.evidence.truncated = true;
    run.done.summary.evidenceTruncated = true;
    expect(assess(run).issues.join(';')).toContain('processInstances.actionReady');
  });

  it('因果证据裁剪只降低明细身份确认，不改变可靠数值与过程完整性', () => {
    const run = copy();
    const cut = run.done.evidence.items.findIndex(row => row.timeMs === 3200);
    const removed = run.done.evidence.items.length - cut;
    run.done.evidence.items = run.done.evidence.items.slice(0, cut);
    run.done.evidence.truncated = true; run.done.evidence.truncatedEvidenceCount = removed;
    run.done.summary.evidenceTruncated = true;
    run.done.summary.warningCount++;
    run.done.warnings.push({ code: 'evidence_truncated', message: '诊断证据仅保留前缀', severity: 'warning' });
    expect(assess(run)).toMatchObject({ complete: true, factsValid: true, detailIdentityVerified: false });
    expect(assess(run).identityGaps.join(';')).toContain('同刻普攻减冷却唤醒');
  });

  it.each(['detailed', 'summary'] as const)('真实Wasm %s零明细预算保留完整计算，明细身份不冒充已验证', async outputMode => {
    const { client } = await mechanismEngine();
    const compiled = await client.compile(original.prepared.compileRequest);
    if (!compiled.ok || !compiled.sessionId) throw new Error('固定用例编译失败');
    try {
      const request = structuredClone(original.runRequest);
      request.sessionId = compiled.sessionId; request.outputMode = outputMode;
      request.recordBudget = { maxAttackRecords: 0, maxDamageRecords: 0, maxMechanicRecords: 0, maxHealingRecords: 0,
        maxAutomaticSkillRecords: 0, maxResourceChangeRecords: 0 };
      const done = await client.run(request);
      expect(done.summary.sourceDamageDealt).toBe(260);
      expect(assessAutomaticSkillResult(original.prepared.compileRequest, request, done, original.prepared.operationOrigins))
        .toMatchObject({ complete: true, factsValid: true, detailIdentityVerified: false });
    } finally { await client.release(compiled.sessionId, original.prepared.compileRequest.rulesHash); }
  });
});
