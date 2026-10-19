import { describe, expect, it } from 'vitest';
import type { CompileRequest, DamageRecord, DoneResult, HealingRecord, ResourceChangeRecord, RunRequest } from '../types/genericEngine';
import { assertResourceChangeOutputShape, assertResourceRecordBudget, inspectResourceChangeContract } from './resourceChangeContract';
import { inspectSimulationHealthLedger } from './simulationHealthLedger';
import { parseDoneResult } from './genericEngineClient';
import { OUTBOX_GENERIC_DONE } from './tinygoV2Bridge';

function sample() {
  const hp = (current: number, max: number) => ({ base: max, current, max, resolved: current });
  const initialSnapshot = { schemaHash: 's', rulesHash: 'r', timeMs: 0, combatants: [
    { key: 'source', attributes: { hp: hp(250, 1000) }, resources: {}, providers: [], cooldowns: {} },
    { key: 'target', attributes: { hp: hp(500, 500) }, resources: {}, providers: [], cooldowns: {} }
  ], processInstances: [] };
  const compile = { schemaVersion: 'generic-p0', schemaHash: 's', rulesHash: 'r', typeCatalog: { types: [], relations: [] }, rules: {},
    combatants: structuredClone(initialSnapshot.combatants), sharedProviders: [{ providerKey: 'finite_health', stableId: 'finite_health', kind: 'status',
      modifiers: [{ modifierKey: 'health', kind: 'resource_max', target: 'self.attr.hp', valuePolicy: 'add', value: { op: 'const', value: 300 }, currentValuePolicy: 'grant_positive_delta_clamp' }] }] } as CompileRequest;
  const request = { schemaVersion: 'generic-p0', schemaHash: 's', rulesHash: 'r', sessionId: 'real', initialSnapshot,
    driverPlan: { entries: [], conditionRecheckIntervalMs: 100 }, stopPolicy: { durationMs: 200, stopOnTargetDeath: true, stopWhenNoEvents: false },
    sampling: { disabled: true, sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 5 } } as RunRequest;
  const contributor = { source: 'source' as const, providerRef: 'actual_mount_opaque', definitionRef: 'finite_health', modifierKey: 'health', reason: 'apply' as const };
  const resources: ResourceChangeRecord[] = [
    { healthOrder: 1, timeMs: 0, target: 'source', resourceKey: 'hp', currentBefore: 250, currentAfter: 550, currentDelta: 300,
      maxBefore: 1000, maxAfter: 1300, maxDelta: 300, contributors: [contributor] },
    { healthOrder: 4, timeMs: 150, target: 'source', resourceKey: 'hp', currentBefore: 580, currentAfter: 580, currentDelta: 0,
      maxBefore: 1300, maxAfter: 1000, maxDelta: -300, contributors: [{ ...contributor, reason: 'expire' }] }
  ];
  const done = { ok: true, summary: { durationMs: 200, stopReason: 'duration_reached', sourceFinalHp: 580, targetFinalHp: 400,
    sourceHpLoss: 0, targetHpLoss: 100, sourceVampHealing: 10, targetVampHealing: 0, sourceDirectHealing: 20, targetDirectHealing: 0 },
    finalSnapshot: structuredClone(initialSnapshot), attackRecords: [], damageRecords: [{ healthOrder: 2, timeMs: 50, source: 'source', target: 'target', useRef: 'ba',
      sourceHpBefore: 550, sourceHpAfter: 560, hpBefore: 500, hpAfter: 400, actualHpLoss: 100 } as DamageRecord],
    healingRecords: [{ healthOrder: 3, timeMs: 50, source: 'source', target: 'source', useRef: null, hpBefore: 560, hpAfter: 580, actualHealing: 20 } as HealingRecord],
    resourceChangeRecords: resources, resourceChangeSummary: { changeCount: 2, source: { currentIncrease: 300, currentDecrease: 0, maxIncrease: 300, maxDecrease: 300, finalMax: 1000 },
      target: { currentIncrease: 0, currentDecrease: 0, maxIncrease: 0, maxDecrease: 0, finalMax: 500 } },
    recording: { damageRecordsTruncated: false, healingRecordsTruncated: false, resourceChangeRecordCount: 2, returnedResourceChangeRecords: 2,
      droppedResourceChangeRecords: 0, resourceChangeRecordsTruncated: false } } as DoneResult;
  done.finalSnapshot.timeMs = 200;
  done.finalSnapshot.combatants[0]!.attributes.hp = hp(580, 1000); done.finalSnapshot.combatants[1]!.attributes.hp = hp(400, 500);
  return { compile, request, done };
}
const inspect = (value: ReturnType<typeof sample>) => inspectSimulationHealthLedger(value.compile, value.request, value.done);

describe('独立资源事实的严格解码及双生命守恒', () => {
  it('按实际生命顺序连接资源、伤害吸血、同刻直接治疗及无当前值变化的到期', () => {
    const value = sample(), before = JSON.stringify(value);
    expect(assertResourceChangeOutputShape(value.done)).toBe(true); expect(inspect(value)).toEqual([]);
    expect(JSON.stringify(value)).toBe(before);
    expect(parseDoneResult([{ schemaVersion: 1, flags: 0, kind: OUTBOX_GENERIC_DONE, payload: new TextEncoder().encode(JSON.stringify(value.done)) }])).toEqual(value.done);
  });
  it.each([0, 1])('预算%s只验证实际明细前缀，仍核全部Current和Max累计', budget => {
    const value = sample(); value.request.recordBudget = { maxResourceChangeRecords: budget };
    value.done.resourceChangeRecords = value.done.resourceChangeRecords!.slice(0, budget);
    Object.assign(value.done.recording!, { returnedResourceChangeRecords: budget, droppedResourceChangeRecords: 2 - budget, resourceChangeRecordsTruncated: true });
    expect(inspect(value)).toEqual([]);
    value.done.resourceChangeSummary!.source.maxDecrease = 299;
    expect(inspect(value).join(' ')).toContain('上限累计');
  });
  it('汇总采用旧虚拟预算规则，returned0不强迫count=returned+dropped', () => {
    const value = sample(); value.request.outputMode = 'summary'; value.done.outputMode = 'summary';
    value.done.resourceChangeRecords = []; value.done.damageRecords = []; value.done.healingRecords = [];
    value.done.recording!.returnedResourceChangeRecords = 0;
    expect(inspect(value)).toEqual([]);
    value.done.resourceChangeSummary!.source.currentIncrease++;
    expect(inspect(value).join(' ')).toContain('当前生命');
  });
  it('预算0的汇总仍按真实预算丢弃计数', () => {
    const value = sample(); value.request.outputMode = value.done.outputMode = 'summary'; value.request.recordBudget = { maxResourceChangeRecords: 0 };
    value.done.resourceChangeRecords = []; value.done.damageRecords = []; value.done.healingRecords = [];
    Object.assign(value.done.recording!, { returnedResourceChangeRecords: 0, droppedResourceChangeRecords: 2, resourceChangeRecordsTruncated: true });
    expect(inspect(value)).toEqual([]);
  });
  it.each([null, -1, .5, Infinity, 10001, '1'])('拒绝显式非法资源预算%s', value => {
    const request = sample().request; request.recordBudget = { maxResourceChangeRecords: value } as unknown as RunRequest['recordBudget'];
    expect(() => assertResourceRecordBudget(request)).toThrow();
  });
  it('旧会话无新字段且不补默认值；授权会话不得遗漏整组输出', () => {
    const value = sample();
    delete value.done.resourceChangeSummary; delete value.done.resourceChangeRecords;
    for (const row of [...value.done.damageRecords!, ...value.done.healingRecords!]) delete row.healthOrder;
    for (const key of Object.keys(value.done.recording!).filter(key => /resourceChange|ResourceChange/.test(key))) delete (value.done.recording as unknown as Record<string, unknown>)[key];
    expect(inspectResourceChangeContract(value.compile, value.request, value.done).join(' ')).toContain('授权');
    value.compile.sharedProviders = [];
    const before = JSON.stringify(value.done); expect(inspectResourceChangeContract(value.compile, value.request, value.done)).toEqual([]);
    expect(JSON.stringify(value.done)).toBe(before); expect(value.request.recordBudget).toBeUndefined();
  });
  it.each(['missing_summary', 'unknown_summary', 'missing_stats', 'unknown_record', 'null_use', 'wrong_definition', 'wrong_modifier', 'wrong_owner', 'duplicate_order', 'reverse_order', 'null_order', 'wrong_delta', 'heal_disguise', 'resurrection'])('拒绝资源协议负篡改%s', kind => {
    const value = sample(), row = value.done.resourceChangeRecords![0]!, stats = value.done.resourceChangeSummary!;
    if (kind === 'missing_summary') delete value.done.resourceChangeSummary;
    if (kind === 'unknown_summary') Object.assign(stats, { unknown: 0 });
    if (kind === 'missing_stats') delete value.done.recording!.returnedResourceChangeRecords;
    if (kind === 'unknown_record') Object.assign(row, { extra: true });
    if (kind === 'null_use') Object.assign(row.contributors[0]!, { useRef: null });
    if (kind === 'wrong_definition') row.contributors[0]!.definitionRef = 'forged';
    if (kind === 'wrong_modifier') row.contributors[0]!.modifierKey = 'forged';
    if (kind === 'wrong_owner') row.contributors[0]!.source = 'target';
    if (kind === 'duplicate_order') value.done.damageRecords![0]!.healthOrder = 1;
    if (kind === 'reverse_order') value.done.resourceChangeRecords![1]!.healthOrder = 0;
    if (kind === 'null_order') Object.assign(value.done.damageRecords![0]!, { healthOrder: null });
    if (kind === 'wrong_delta') row.currentDelta = 299;
    if (kind === 'heal_disguise') { row.maxDelta = 0; row.maxAfter = row.maxBefore; }
    if (kind === 'resurrection') { row.currentBefore = 0; row.currentDelta = row.currentAfter; }
    expect(inspect(value).length).toBeGreaterThan(0);
  });
  it('同毫秒连接得上也不能替代真实顺序；完整逐刀尾部继续严格核对', () => {
    const value = sample(); value.done.healingRecords![0]!.healthOrder = 5;
    expect(inspect(value).length).toBeGreaterThan(0);
    const tail = sample(); tail.done.attackRecords = [{ useRef: 'ba', sourceHpAfter: 999, targetHpAfter: 400 }] as DoneResult['attackRecords'];
    expect(inspect(tail).join(' ')).toContain('逐刀');
  });
});
