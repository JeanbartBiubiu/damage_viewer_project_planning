import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { describe, expect, it } from 'vitest';
import type { DoneResult, EvidenceItem, ProcessInstanceSnapshot } from '../types/genericEngine';
import { assembleSimulation as raw_assembleSimulation, inspectSimulationSnapshot as raw_inspectSimulationSnapshot, singleAttackRequest } from './simulationAdapter';
import { assessSingleAttackResult } from './singleAttackResult';
import { simulationSample } from '../../tests/fixtures/simulationSnapshot';

const mount = 'selected_basic_attack';
const startAbility = `source.provider[${mount}].ability[attack_start]`;
const hitAbility = `source.provider[${mount}].ability[attack_hit]`;
const attackLinkPath = 'sharedProviders[0].processes[0].momentOperations[0].operations[0]';
const hitLinkPath = 'sharedProviders[0].abilities[2].operations[0].skillHit.candidates[1].operations[0]';

/** 独立构造当前 Go 原生输出字段，不使用伤害 useRef 或逐笔剩余生命。 */
function sample(options: { damage?: number; hp?: number; hitCount?: number; attackCount?: number } = {}) {
  const damage = options.damage ?? 50;
  const hp = options.hp ?? 300;
  const snapshot = simulationSample();
  const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) inputs[row.side][row.attribute.attributeKey] = 0;
  const { compileRequest } = assembleSimulation(snapshot, inputs, { source: 650, target: hp });
  const runRequest = singleAttackRequest(compileRequest, 'session');
  const provider = compileRequest.sharedProviders![0]!;
  const process = provider.processes![0]!;
  const controlRef = `source.provider[${mount}].ability[process_${process.processKey}]`;
  const identity = { source: 'source', target: 'target', useRef: 'first_attack_use', skillKey: 'sample_basic_attack' };
  const processIdentity = { owner: 'source', target: 'target', providerRef: mount, processKey: process.processKey,
    skillKey: 'sample_basic_attack', useKey: 'first_attack_use', stepKey: process.steps[0]!.stepKey, stepVersion: 1, failureReason: null };
  const actualHpLoss = Math.min(hp, damage);
  const finalHp = hp - actualHpLoss;
  const finalSnapshot = structuredClone(runRequest.initialSnapshot);
  const source = finalSnapshot.combatants.find(row => row.key === 'source')!;
  const target = finalSnapshot.combatants.find(row => row.key === 'target')!;
  target.attributes.hp!.current = finalHp;
  target.attributes.hp!.resolved = finalHp;
  source.cooldowns[controlRef] = { readyAtMs: 1500, remainingMs: 1500 };
  const instance: ProcessInstanceSnapshot = { ...processIdentity, owner: 'source', target: 'target', startedAtMs: 0,
    stepStartedAtMs: 0, advanceAtMs: 0, expiresAtMs: null, actualCosts: {}, cooldownStarted: true,
    status: 'complete', finishedAtMs: 0, repeat: null, actionOccupancies: [], stepExecutionIndex: 1, lastExecutionAtMs: 0, stepCompletedAtMs: 0 };
  finalSnapshot.processInstances = [instance];
  const evidence: EvidenceItem[] = [
    { timeMs: 0, kind: 'emitted_event', ref: 'event/basic_attack_start', data: { ...identity, eventType: 'event/basic_attack_start', castInstanceId: 1 } },
    { timeMs: 0, kind: 'process_moment', ref: controlRef, data: { ...processIdentity, moment: 'PROCESS_START', status: 'active' } },
    { timeMs: 0, kind: 'process_moment', ref: controlRef, data: { ...processIdentity, moment: 'PROCESS_COMPLETE', status: 'complete' } },
    { timeMs: 0, kind: 'skill_hit', ref: hitAbility, path: 'driverPlan.entries[first_attack_hit]', data: { ...identity, occurrenceId: 1, blocked: 0, reused: false } },
    { timeMs: 0, kind: 'emitted_event', ref: 'event/basic_attack_hit', data: { ...identity, eventType: 'event/basic_attack_hit', occurrenceId: 1, blocked: 0, reused: false } },
    { timeMs: 0, kind: 'damage', ref: hitAbility, data: {
      phase: 'original', phantom: false, source: 'source', target: 'target', damageType: 'physics',
      abilityRef: hitAbility, operationRef: 'skills.sample_basic_attack.effects.hit.results.damage', castInstanceId: 3, damageId: 1,
      rawAmount: damage * 2, mitigatedAmount: damage, postDefenseDamage: damage, shieldAbsorbed: 0,
      actualHpLoss, overkillDamage: damage - actualHpLoss,
      resistanceBeforePenetration: 100, penetrationPercent: 0, penetrationFlat: 0, effectiveResistance: 100,
      resistanceFactor: 0.5, normalPartPostResistance: damage, critPartPostResistance: 0,
      eligible: true, policy: 'expected', baseRawAmount: damage * 2, originalCritChance: 0, effectiveCritChance: 0,
      multiplier: 2, normalPart: damage * 2, critPart: 0, critAdjustedRawAmount: damage * 2
    } }
  ];
  function addLinks(path: string, ref: string, eventType: string, count: number) {
    evidence.push({ timeMs: 0, kind: 'link_application', ref, path, data: { ...identity, eventType, count } });
    for (let index = 1; index <= count; index++) evidence.push({ timeMs: 0, kind: 'emitted_event', ref: eventType, path,
      data: { ...identity, eventType, LINK_INDEX: index, LINK_COUNT: count } });
  }
  addLinks(attackLinkPath, 'skills.sample_basic_attack.effects.start.results.attack_link', 'event/attack_link_applied', options.attackCount ?? 1);
  addLinks(hitLinkPath, 'skills.sample_basic_attack.effects.hit.results.hit_link', 'event/hit_link_applied', options.hitCount ?? 1);
  const done: DoneResult = {
    ok: true,
    summary: { durationMs: 0, stopReason: finalHp === 0 ? 'target_dead' : 'no_events', sourceFinalHp: 650,
      targetFinalHp: finalHp, sourceDamageDealt: damage, sourceDamageTaken: 0, targetDamageDealt: 0,
      targetDamageTaken: damage, abilityAttemptCount: 2, abilityCastCount: 3, attemptSkippedCount: 0,
      warningCount: 0, evidenceTruncated: false, seriesDownsampled: false,
      abilityStats: [
        { abilityRef: startAbility, attemptCount: 1, castCount: 1, skipCount: 0 },
        { abilityRef: controlRef, attemptCount: 0, castCount: 1, skipCount: 0 },
        { abilityRef: hitAbility, attemptCount: 1, castCount: 1, skipCount: 0, damageDealt: damage }
      ] },
    finalSnapshot, series: [], warnings: [],
    evidence: { items: evidence, truncated: false, truncatedEvidenceCount: 0, countsByKind: {} },
    seriesSamplingEvidence: { requestedSampleEveryMs: 100, effectiveSampleEveryMs: 100, requestedPointCount: 0, finalPointCount: 0, maxSeriesPoints: 10, downsampled: false, method: 'uniform_time' }
  };
  recount(done);
  return { compileRequest, runRequest, done, controlRef };
}

function recount(done: DoneResult) {
  done.evidence.countsByKind = {};
  for (const row of done.evidence.items) done.evidence.countsByKind[row.kind] = (done.evidence.countsByKind[row.kind] ?? 0) + 1;
}
function assess(input: ReturnType<typeof sample>) {
  return assessSingleAttackResult(input.compileRequest, input.runRequest, input.done);
}

describe('5C单次条件主体完整分支核对', () => {
  it('只接受唯一真实分支的完整并列伤害与联动，不要求未选分支也执行', () => {
    const input = sample();
    const candidates = input.compileRequest.sharedProviders![0]!.abilities![2]!.operations![0]!.skillHit!.candidates;
    for (const candidate of candidates) candidate.participationCondition = { op: 'const', value: 1 };
    candidates.push(...structuredClone(candidates).map(candidate => ({ ...candidate, candidateKey: `other:${candidate.candidateKey}`,
      effectOccurrenceKey: 'other', participationCondition: { op: 'const', value: 0 }, operations: candidate.operations.map(operation => ({ ...operation, ref: `${operation.ref}_other` })) })));
    expect(assess(input).issues).toEqual([]);
    input.done.evidence.items = input.done.evidence.items.filter(row => row.kind !== 'damage');
    recount(input.done);
    expect(assess(input).complete).toBe(false);
  });
});
function damage(input: ReturnType<typeof sample>) {
  return input.done.evidence.items.find(row => row.kind === 'damage')!;
}

describe('单次普攻结果解释', () => {
  it('从真实汇总和运行角色快照解释单击，能力计数不冒充攻击数', () => {
    const input = sample();
    expect(assess(input)).toEqual({ complete: true, issues: [], sourceInitialHp: 650, targetInitialHp: 300,
      sourceFinalHp: 650, targetFinalHp: 250, damageDealt: 50, hpLoss: 50, stopReason: 'no_events', durationMs: 0 });
    expect(damage(input).data).not.toHaveProperty('useRef');
    expect(damage(input).data).not.toHaveProperty('providerRef');
    expect(damage(input).data).not.toHaveProperty('targetHpAfter');
    input.done.summary.abilityAttemptCount = 10;
    input.done.summary.abilityCastCount = 8;
    expect(assess(input).complete).toBe(true);
  });

  it('保留过量伤害与实际扣血差异，0毫秒和空序列合法', () => {
    const input = sample({ hp: 20 });
    expect(assess(input)).toMatchObject({ complete: true, damageDealt: 50, hpLoss: 20, targetFinalHp: 0, durationMs: 0, stopReason: 'target_dead' });
    expect(input.done.series).toEqual([]);
  });

  it('零伤害仍可完成；联动次数读原生值，0次也保留应用证据', () => {
    const input = sample({ damage: 0, hitCount: 3, attackCount: 0 });
    expect(assess(input)).toMatchObject({ complete: true, damageDealt: 0, hpLoss: 0, targetFinalHp: 300 });
    const plan = input.compileRequest.sharedProviders![0]!.abilities![2]!.operations![0]!.skillHit!;
    plan.candidates[1]!.operations[0]!.amount = { op: 'read', path: 'source.attr.attack_damage.resolved' };
    expect(assess(input).complete).toBe(true);
    input.done.evidence.items = input.done.evidence.items.filter(row => !(row.kind === 'link_application' && row.path === attackLinkPath));
    recount(input.done);
    expect(assess(input).issues.join('\n')).toContain('零次也须保留');
  });

  it('成功停止码允许观察上限，但预算和来源死亡均不通过', () => {
    const input = sample();
    input.done.summary.stopReason = 'duration_reached';
    expect(assess(input).complete).toBe(true);
    input.done.summary.stopReason = 'budget_exceeded';
    expect(assess(input)).toMatchObject({ complete: false, damageDealt: 50, hpLoss: 50, targetFinalHp: 250 });
    input.done.summary.stopReason = 'source_dead';
    expect(assess(input).complete).toBe(false);
    input.done.summary.stopReason = 'unknown' as never;
    expect(assess(input).issues.join('\n')).toContain('unknown');
  });

  it('预算或截断结果保留实际归零，不伪装完整击杀', () => {
    const input = sample({ hp: 20 });
    input.done.summary.stopReason = 'budget_exceeded';
    input.done.summary.evidenceTruncated = true;
    input.done.evidence.truncated = true;
    input.done.evidence.truncatedEvidenceCount = 2;
    input.done.evidence.items = input.done.evidence.items.slice(0, 6);
    expect(assess(input)).toMatchObject({ complete: false, damageDealt: 50, hpLoss: 20, targetFinalHp: 0 });
  });

  it('只核对已输出汇总，缺事件不靠正伤害或能力计数推定命中', () => {
    const input = sample();
    input.done.evidence.items = input.done.evidence.items.filter(row => row.ref !== 'event/basic_attack_hit');
    recount(input.done);
    expect(assess(input).issues.join('\n')).toContain('event/basic_attack_hit 原生事件应恰好一次');
  });

  it.each(['emitted_event', 'skill_hit', 'link_application'])('%s 必须同次使用且使用运行角色身份', kind => {
    const input = sample();
    const item = input.done.evidence.items.find(row => row.kind === kind)!;
    item.data!.useRef = 'another_use';
    expect(assess(input).complete).toBe(false);
    item.data!.useRef = 'first_attack_use';
    item.data!.source = 'champion_aatrox';
    expect(assess(input).complete).toBe(false);
  });

  it('重发原生攻击事件、目标自主驱动或重复驱动不能通过', () => {
    const input = sample();
    input.done.evidence.items.push(structuredClone(input.done.evidence.items[0]!));
    recount(input.done);
    expect(assess(input).complete).toBe(false);
    const repeat = sample(); repeat.runRequest.driverPlan.entries[0]!.repeat = { intervalMs: 100 };
    expect(assess(repeat).complete).toBe(false);
    const target = sample(); target.runRequest.driverPlan.entries[0]!.source = 'target';
    expect(assess(target).complete).toBe(false);
  });

  it('过程必须成功、同次使用、启动冷却并有完整开始和完成证据', () => {
    const failed = sample();
    failed.done.finalSnapshot.processInstances![0]!.status = 'failed';
    failed.done.finalSnapshot.processInstances![0]!.failureReason = 'CONTROLLED';
    expect(assess(failed).complete).toBe(false);
    const anotherUse = sample(); anotherUse.done.finalSnapshot.processInstances![0]!.useKey = 'another_use';
    expect(assess(anotherUse).complete).toBe(false);
    const cooldown = sample(); cooldown.done.finalSnapshot.processInstances![0]!.cooldownStarted = false;
    expect(assess(cooldown).complete).toBe(false);
    const missing = sample(); missing.done.evidence.items = missing.done.evidence.items.filter(row => row.data?.moment !== 'PROCESS_COMPLETE');
    recount(missing.done);
    expect(assess(missing).complete).toBe(false);
  });

  it('联动次数、序号、实际来源和种类均与应用记录核对', () => {
    const input = sample({ hitCount: 2 });
    const rows = input.done.evidence.items.filter(row => row.kind === 'emitted_event' && row.path === hitLinkPath);
    rows[1]!.data!.LINK_INDEX = 1;
    expect(assess(input).issues.join('\n')).toContain('序号不一致');
    rows[1]!.data!.LINK_INDEX = 2;
    rows[1]!.data!.LINK_COUNT = 1;
    expect(assess(input).complete).toBe(false);
    rows[1]!.data!.LINK_COUNT = 2;
    rows[1]!.data!.useRef = 'another_use';
    expect(assess(input).complete).toBe(false);
  });

  it('完整证据要覆盖全部编译后的所选结果，额外或错挂伤害不通过', () => {
    const missing = sample();
    const hit = missing.compileRequest.sharedProviders![0]!.abilities![2]!.operations![0]!.skillHit!;
    hit.candidates.push({ ...structuredClone(hit.candidates[0]!), candidateKey: 'extra', resultKey: 'extra',
      operations: [{ ...hit.candidates[0]!.operations[0]!, ref: 'extra' }] });
    expect(assess(missing).issues.join('\n')).toContain('缺少所选伤害');
    const wrong = sample(); damage(wrong).data!.providerRef = 'other_mount';
    expect(assess(wrong).complete).toBe(false);
    damage(wrong).data!.providerRef = mount;
    damage(wrong).data!.abilityRef = 'target.provider[selected_basic_attack].ability[attack_hit]';
    expect(assess(wrong).complete).toBe(false);
  });

  it('伤害归属从实际 source 能力引用核对，未知挂载和目标引用不通过', () => {
    const input = sample();
    damage(input).data!.abilityRef = 'source.provider[other_mount].ability[attack_hit]';
    damage(input).ref = damage(input).data!.abilityRef as string;
    expect(assess(input).complete).toBe(false);
    damage(input).data!.abilityRef = hitAbility;
    damage(input).ref = hitAbility;
    damage(input).data!.providerRef = mount;
    expect(assess(input).complete).toBe(true);
    damage(input).data!.providerRef = '';
    expect(() => assess(input)).toThrow(/runResult\.evidence\.items\[5\]\.data\.providerRef/);
  });

  it('逐伤害实际扣血、金额分解、累计伤害和最终生命相互核对', () => {
    const input = sample(); damage(input).data!.actualHpLoss = 40;
    expect(assess(input).issues.join('\n')).toContain('实际扣血累计');
    damage(input).data!.actualHpLoss = 50;
    input.done.summary.sourceDamageDealt = 60;
    expect(assess(input).complete).toBe(false);
    input.done.summary.sourceDamageDealt = 50;
    input.done.finalSnapshot.combatants.find(row => row.key === 'target')!.attributes.hp!.current = 249;
    expect(assess(input).issues.join('\n')).toContain('最终 target 快照不一致');
  });

  it('初值取实际请求，来源吸血变化不会被强制改成初始生命', () => {
    const input = sample();
    input.runRequest.initialSnapshot.combatants.find(row => row.key === 'source')!.attributes.hp!.current = 500;
    expect(assess(input)).toMatchObject({ complete: true, sourceInitialHp: 500, sourceFinalHp: 650 });
    input.done.finalSnapshot.combatants.reverse();
    expect(assess(input).complete).toBe(true);
  });

  it('未知或影响正确性的警告不通过，原警告与汇总不被修改', () => {
    const input = sample();
    input.done.warnings = [{ code: 'future_warning', message: 'unknown', severity: 'warning' }];
    input.done.summary.warningCount = 1;
    const before = structuredClone(input.done);
    expect(assess(input).issues.join('\n')).toContain('future_warning');
    expect(input.done).toEqual(before);
    input.done.warnings[0]!.code = 'series_downsampled';
    input.done.summary.seriesDownsampled = true;
    expect(assess(input).complete).toBe(true);
  });

  it('摘要或完整证据计数矛盾不通过，仍保留返回汇总', () => {
    const input = sample(); input.done.finalSnapshot.rulesHash = 'other';
    expect(assess(input)).toMatchObject({ complete: false, damageDealt: 50, targetFinalHp: 250 });
    input.done.finalSnapshot.rulesHash = input.compileRequest.rulesHash;
    input.done.evidence.countsByKind.damage = 2;
    expect(assess(input).issues.join('\n')).toContain('countsByKind.damage');
  });

  it.each(['rawAmount', 'mitigatedAmount', 'actualHpLoss', 'postDefenseDamage', 'baseRawAmount', 'resistanceFactor'])('伤害 %s 缺失或数字字符串不给默认值', field => {
    const input = sample(); delete damage(input).data![field];
    expect(() => assess(input)).toThrow(new RegExp(`runResult\\.evidence\\.items\\[5\\]\\.data\\.${field}`));
    damage(input).data![field] = '0';
    expect(() => assess(input)).toThrow(/有限数值/);
  });

  it.each([NaN, Infinity, -Infinity, '250', undefined])('非法必要汇总数值 %s 报具体结果路径', value => {
    const input = sample(); input.done.summary.targetFinalHp = value as number;
    expect(() => assess(input)).toThrow(/runResult\.summary\.targetFinalHp/);
  });

  it('缺失角色、生命、证据或警告形状报具体结果路径', () => {
    const missingActor = sample(); missingActor.done.finalSnapshot.combatants.pop();
    expect(() => assess(missingActor)).toThrow(/runResult\.finalSnapshot\.combatants/);
    const missingHp = sample(); delete missingHp.done.finalSnapshot.combatants[0]!.attributes.hp;
    expect(() => assess(missingHp)).toThrow(/runResult\.finalSnapshot\.combatants\.source\.attributes\.hp/);
    const badEvidence = sample(); badEvidence.done.evidence.items = undefined as never;
    expect(() => assess(badEvidence)).toThrow(/runResult\.evidence\.items/);
    const badWarning = sample(); badWarning.done.warnings = undefined as never;
    expect(() => assess(badWarning)).toThrow(/runResult\.warnings/);
  });
});

const assembleSimulation = (...args: Parameters<typeof raw_assembleSimulation>): ReturnType<typeof raw_assembleSimulation> => { approveSnapshotFixture(args[0]); return raw_assembleSimulation(...args); };
const inspectSimulationSnapshot = (...args: Parameters<typeof raw_inspectSimulationSnapshot>): ReturnType<typeof raw_inspectSimulationSnapshot> => { approveSnapshotFixture(args[0]); return raw_inspectSimulationSnapshot(...args); };
