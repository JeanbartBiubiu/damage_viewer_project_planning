import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { preparedActiveSample } from '../fixtures/simulationActiveSkill';
import type { DoneResult, MechanicRecord, ProcessInstanceSnapshot, SkillActionRecord } from '../../src/types/genericEngine';
import { skillActionRequest } from '../../src/engine/skillActionRequest';
import { drivenActiveAmmo } from '../../src/engine/simulationAmmoMechanics';
import { projectActiveAmmo } from './ammoProjection';
import { compareMechanismExpectation, projectMechanismResult } from './mechanismRunner';
import { parseMechanismCase, type MechanismExpectation, type MechanismProjection } from './mechanismCase';

/** 真实静态主动装配和请求构造后的纯内存事实；不调用公式客户端、编译或引擎。 */
async function synthetic(firstDeadline = 16000, secondDeadline = 32000) {
  const { snapshot, prepared } = preparedActiveSample();
  const compile = prepared.compileRequest, binding = compile.rules.skillActionBindings![0]!;
  const provider = compile.sharedProviders!.find(row => row.providerKey === binding.providerDefinitionRef)!;
  provider.initialStateSchema = { stock: { valueType: 'integer', stateKind: 'ammo', defaultValue: 2, maxValue: 2,
    ammoRecovery: { intervalMs: { op: 'ref', ref: 'dynamic_current_haste_interval' }, mode: 'one_by_one', startCondition: 'after_consume', initialRemainingMs: 0 } } };
  provider.processes![0]!.momentOperations.unshift({ moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null },
    operations: [{ operation: 'state_change', target: 'self', ref: 'stock', valuePolicy: 'add', amount: { op: 'const', value: -1 }, types: ['state_scope/provider'] }] });
  const planned = snapshot.selection.plannedSkills[0]!;
  const request = (await skillActionRequest(prepared, snapshot, {
    actions: [0, 3000].map((atMs, index) => ({ ...planned, instructionKey: index ? 'ammo_two' : 'ammo_one', atMs,
      sortOrder: index, phaseKind: 'INITIAL', targetSide: 'target', hitPreset: 'MISS', parentInstructionKey: null })),
    durationMs: secondDeadline + 1, recordTimeSeries: false, maxSkillActionRecords: 100, maxSkillUseRecords: 100, maxHealingRecords: 0
  })).runRequest;
  const context = drivenActiveAmmo(compile, request.driverPlan)[0]!;
  const process = (useKey: string, timeMs: number): ProcessInstanceSnapshot => ({ owner: 'source', target: 'target',
    providerRef: context.providerRef, skillKey: context.skillKey, processKey: context.processKey, useKey, startedAtMs: timeMs,
    stepKey: 'delay', stepVersion: 1, stepExecutionIndex: 1, lastExecutionAtMs: timeMs + 100, stepCompletedAtMs: timeMs + 100,
    stepStartedAtMs: timeMs, advanceAtMs: timeMs + 100, expiresAtMs: null, actualCosts: {}, cooldownStarted: true,
    status: 'complete', failureReason: null, finishedAtMs: timeMs + 100, repeat: null, actionOccupancies: [] });
  const processes = [process('skill:ammo_one', 0), process('skill:ammo_two', 3000)];
  const actions: SkillActionRecord[] = request.driverPlan.skillActions!.map((plan, index) => ({ instructionKey: plan.instructionKey,
    requestedAtMs: plan.firstAtMs, actualAtMs: plan.firstAtMs, action: 'INITIAL', source: 'source', target: 'target',
    parentInstructionKey: null, skillKey: context.skillKey, bindingKey: binding.bindingKey, providerRef: context.providerRef,
    providerDefinitionRef: context.providerDefinitionRef, outcome: 'ACCEPTED', reason: null, useRef: processes[index]!.useKey }));
  const record = (kind: MechanicRecord['kind'], timeMs: number, beforeValue: number, afterValue: number,
    useRef: string | null, readyAtMs: number | null): MechanicRecord => ({ owner: 'source', providerRef: context.providerRef,
    providerDefinitionRef: context.providerDefinitionRef, skillKey: context.skillKey, stateKey: context.stateKey,
    kind, timeMs, beforeValue, afterValue, useRef, readyAtMs, operationRef: useRef ? context.consumptionPath : context.recoveryPath });
  const records = [record('STATE_CHANGED', 0, 2, 1, processes[0]!.useKey, null), record('WAIT_STARTED', 0, 1, 1, null, firstDeadline),
    record('STATE_CHANGED', 3000, 1, 0, processes[1]!.useKey, null), record('STATE_CHANGED', firstDeadline, 0, 1, null, firstDeadline),
    record('WAIT_ENDED', firstDeadline, 0, 1, null, firstDeadline), record('WAIT_STARTED', firstDeadline, 1, 1, null, secondDeadline),
    record('STATE_CHANGED', secondDeadline, 1, 2, null, secondDeadline), record('WAIT_ENDED', secondDeadline, 1, 2, null, secondDeadline)];
  const finalSnapshot = structuredClone(request.initialSnapshot);
  finalSnapshot.timeMs = secondDeadline + 1; finalSnapshot.processInstances = processes;
  finalSnapshot.combatants.find(row => row.key === 'source')!.providerState[context.providerRef] = { state: { stock: 2 } };
  const done = { summary: { durationMs: secondDeadline + 1 }, finalSnapshot, mechanicRecords: records, skillActionRecords: actions,
    evidence: { items: [], truncated: false, truncatedEvidenceCount: 0, countsByKind: {} },
    recording: { mechanicRecordCount: 8, returnedMechanicRecords: 8, droppedMechanicRecords: 0, mechanicRecordsTruncated: false,
      skillActionRecordCount: 2, returnedSkillActionRecords: 2, droppedSkillActionRecords: 0, skillActionRecordsTruncated: false } } as unknown as DoneResult;
  return { prepared, compile, request, done, context, provider, binding, processes };
}

describe('主动弹药完整机制投影（纯内存，不运行引擎）', () => {
  it.each([[16000, 32000], [14545, 29090], [16000, 24000]])('严格保留手算%s/%s及八笔原顺序，不静态折叠动态interval', async (first, second) => {
    const f = await synthetic(first, second), projection = projectActiveAmmo(f.compile, f.request, f.done);
    expect(projection.ammoMechanics.map(row => [row.timeMs, row.kind, row.beforeValue, row.afterValue, row.useRef, row.readyAtMs])).toEqual([
      [0, 'STATE_CHANGED', 2, 1, 'skill:ammo_one', null], [0, 'WAIT_STARTED', 1, 1, null, first],
      [3000, 'STATE_CHANGED', 1, 0, 'skill:ammo_two', null], [first, 'STATE_CHANGED', 0, 1, null, first],
      [first, 'WAIT_ENDED', 0, 1, null, first], [first, 'WAIT_STARTED', 1, 1, null, second],
      [second, 'STATE_CHANGED', 1, 2, null, second], [second, 'WAIT_ENDED', 1, 2, null, second]
    ]);
    expect(projection.ammoMechanics.map(row => row.operationRole)).toEqual(['consume', 'recovery', 'consume', 'recovery', 'recovery', 'recovery', 'recovery', 'recovery']);
    expect(projection.finalAmmo).toEqual([{ owner: 'source', source: 'source', providerRef: f.context.providerRef,
      providerDefinitionRef: f.context.providerDefinitionRef, bindingKey: f.binding.bindingKey, skillKey: f.context.skillKey,
      processKey: f.context.processKey, stateKey: 'stock', inventory: 2, maximum: 2, waiting: false, readyAtMs: null }]);
    expect(projection.ammoMechanics.every(row => !Object.prototype.hasOwnProperty.call(row, 'castInstanceId'))).toBe(true);
  });
  it.each(['owner', 'providerRef', 'providerDefinitionRef', 'skillKey', 'stateKey', 'operationRef', 'useRef', 'consume_time',
    'inventory', 'recovery_pair', 'missing_record', 'extra_record', 'reversed', 'wrong_final', 'no_mount', 'finite_mount',
    'wrong_source', 'fake_instruction', 'wrong_binding', 'wrong_control', 'wrong_target', 'wrong_parent', 'wrong_requested',
    'missing_accepted', 'duplicate_accepted', 'wrong_outcome', 'duplicate_process', 'mechanic_truncated', 'action_truncated',
    'mechanic_count', 'action_count', 'mechanic_dropped', 'action_dropped'] as const)('拒绝篡改%s，不补造或筛掉记录', async kind => {
    const f = await synthetic(), record = f.done.mechanicRecords![0]!, accepted = f.done.skillActionRecords![0]!;
    if (['owner', 'providerRef', 'providerDefinitionRef', 'skillKey', 'stateKey', 'operationRef', 'useRef'].includes(kind)) {
      (record as unknown as Record<string, unknown>)[kind] = kind === 'owner' ? 'target' : 'foreign';
    }
    if (kind === 'consume_time') record.timeMs = 1;
    if (kind === 'inventory') record.beforeValue = 1;
    if (kind === 'recovery_pair') f.done.mechanicRecords!.splice(4, 1);
    if (kind === 'missing_record') f.done.mechanicRecords!.pop();
    if (kind === 'extra_record') f.done.mechanicRecords!.push(structuredClone(record));
    if (kind === 'reversed') f.done.mechanicRecords!.reverse();
    const actor = f.done.finalSnapshot.combatants.find(row => row.key === 'source')!;
    if (kind === 'wrong_final') actor.providerState[f.context.providerRef] = { state: { stock: 1 } };
    if (kind === 'no_mount') actor.providers = actor.providers.filter(row => row.providerRef !== f.context.providerRef);
    if (kind === 'finite_mount') actor.providers.find(row => row.providerRef === f.context.providerRef)!.expireAt = 40000;
    if (kind === 'wrong_source') actor.providers.find(row => row.providerRef === f.context.providerRef)!.source = 'target';
    if (kind === 'fake_instruction') accepted.instructionKey = 'never_planned';
    if (kind === 'wrong_binding') accepted.bindingKey = 'foreign';
    if (kind === 'wrong_control') f.request.driverPlan.skillActions![0]!.abilityRef = 'foreign';
    if (kind === 'wrong_target') accepted.target = 'source';
    if (kind === 'wrong_parent') accepted.parentInstructionKey = 'never_planned';
    if (kind === 'wrong_requested') accepted.requestedAtMs = 1;
    if (kind === 'missing_accepted') f.done.skillActionRecords!.splice(0, 1);
    if (kind === 'duplicate_accepted') f.done.skillActionRecords!.push(structuredClone(accepted));
    if (kind === 'wrong_outcome') accepted.outcome = 'REJECTED';
    if (kind === 'duplicate_process') f.processes.push(structuredClone(f.processes[0]!));
    if (kind === 'mechanic_truncated') f.done.recording!.mechanicRecordsTruncated = true;
    if (kind === 'action_truncated') f.done.recording!.skillActionRecordsTruncated = true;
    if (kind === 'mechanic_count') f.done.recording!.mechanicRecordCount = 7;
    if (kind === 'action_count') f.done.recording!.returnedSkillActionRecords = 1;
    if (kind === 'mechanic_dropped') f.done.recording!.droppedMechanicRecords = 1;
    if (kind === 'action_dropped') f.done.recording!.droppedSkillActionRecords = 1;
    expect(() => projectActiveAmmo(f.compile, f.request, f.done)).toThrow('ammoProjection');
  });
  it('一致平移至晚一毫秒的合法记录仍与冻结期望严格不同', async () => {
    const f = await synthetic(14545, 29090), exact = projectActiveAmmo(f.compile, f.request, f.done);
    const late = await synthetic(14546, 29092), projection = projectActiveAmmo(late.compile, late.request, late.done);
    expect(compareMechanismExpectation(exact as MechanismProjection, exact)).toEqual([]);
    expect(compareMechanismExpectation(projection as MechanismProjection, exact)).toEqual([expect.stringContaining('ammoMechanics:')]);
    const changed = structuredClone(exact); changed.finalAmmo[0]!.inventory = 1;
    expect(compareMechanismExpectation(changed as MechanismProjection, exact).join(';')).toContain('finalAmmo:');
  });
  it('没有显式成对期望的旧例不进入新投影；声明半对立即拒绝', async () => {
    const f = await synthetic();
    f.done.mechanicRecords = undefined; f.done.skillActionRecords = undefined;
    const gated = { finalAmmo: [] } as MechanismExpectation;
    expect(() => projectMechanismResult([], f.compile, f.request, f.done, gated)).toThrow('成对声明');
    // 若旧例误进入新门，会在缺失记录处抛出ammoProjection；以下只触发旧伤害投影的空明细即可。
    const noAmmo = projectMechanismResult([], f.compile, f.request, f.done);
    expect(noAmmo.ammoMechanics).toEqual([]); expect(noAmmo.finalAmmo).toEqual([]);
  });
});

describe('固定弹药期望必须成对且完整', () => {
  const file = new URL('./cases/ammo_dynamic_haste0.json', import.meta.url);
  const original = JSON.parse(readFileSync(file, 'utf8'));
  const parse = (expected: unknown) => parseMechanismCase(Buffer.from(JSON.stringify({ ...original, expected })), file.pathname);
  it.each(['ammo_dynamic_haste0', 'ammo_dynamic_haste10', 'ammo_dynamic_haste_change'])('固定%s形状和八笔声明完整', name => {
    const path = new URL(`./cases/${name}.json`, import.meta.url), fixture = parseMechanismCase(readFileSync(path), path.pathname);
    expect(fixture.expected.ammoMechanics).toHaveLength(8); expect(fixture.expected.finalAmmo).toHaveLength(1);
    expect(fixture.expected.ammoMechanics![0]!.useRef).toBe('skill:ammo_one');
  });
  it('少一节、少任一列、未知列和非整数/错误空值都拒绝', () => {
    const expected = structuredClone(original.expected);
    expect(() => parse(expected)).not.toThrow();
    for (const section of ['ammoMechanics', 'finalAmmo']) {
      const missingSection = structuredClone(expected); delete missingSection[section]; expect(() => parse(missingSection)).toThrow('成对声明');
      for (const key of Object.keys(expected[section][0])) {
        const changed = structuredClone(expected); delete changed[section][0][key]; expect(() => parse(changed), `${section}.${key}`).toThrow();
      }
      const extra = structuredClone(expected); extra[section][0].extra = 0; expect(() => parse(extra)).toThrow('未定义字段');
    }
    for (const [section, index, field, value] of [['ammoMechanics', 0, 'timeMs', 0.5], ['ammoMechanics', 1, 'readyAtMs', null],
      ['ammoMechanics', 0, 'useRef', null], ['ammoMechanics', 1, 'useRef', 'fake'], ['ammoMechanics', 0, 'owner', 'target'],
      ['ammoMechanics', 0, 'kind', 'unknown'], ['ammoMechanics', 0, 'operationRole', 'unknown'], ['finalAmmo', 0, 'waiting', 0],
      ['finalAmmo', 0, 'readyAtMs', 1], ['finalAmmo', 0, 'inventory', 3], ['finalAmmo', 0, 'maximum', 0]] as const) {
      const changed = structuredClone(expected); changed[section][index][field] = value; expect(() => parse(changed), `${section}.${field}`).toThrow();
    }
  });
});
