import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { describe, expect, it } from 'vitest';
import type { DoneResult } from '../types/genericEngine';
import { complexAction, complexInputs, simulationComplexSample } from '../../tests/fixtures/simulationComplexSkills';
import { inspectSimulationSnapshot as raw_inspectSimulationSnapshot, prepareSimulation } from './simulationAdapter';
import { skillActionRequest } from './skillActionRequest';
import { inspectSimulationProcessFacts, simulationActionContribution } from './simulationProcessFacts';

async function sample(kind: 'CHARGE' | 'CHANNEL' | 'MULTI_HIT' = 'CHARGE') {
  const snapshot = simulationComplexSample(kind, false);
  const attributes = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) attributes[row.side][row.attribute.attributeKey] = 0;
  const prepared = await prepareSimulation(snapshot, attributes, { source: 1000, target: 5000 });
  const request = (await skillActionRequest(prepared, snapshot, complexInputs([complexAction(snapshot, 'first', 0),
    ...(kind === 'CHARGE' ? [complexAction(snapshot, 'release', 400, 'CHARGE_RELEASE', 'first')] : [])]))).runRequest;
  const binding = prepared.compileRequest.rules.skillActionBindings![0]!;
  const done = { summary: { durationMs: 1200, skillUses: { startedCount: 1, completedCount: 1, failedCount: 0, inFlightCount: 0,
    stepEnteredCount: 2, stepExecutedCount: 2, stepCompletedCount: 2 } },
    finalSnapshot: { processInstances: [{ owner: 'source', providerRef: binding.providerRef, processKey: 'cast', skillKey: binding.skillKey,
      useKey: 'use_first', target: 'target', stepKey: 'complex', stepVersion: 2, startedAtMs: 0, stepStartedAtMs: 100,
      stepExecutionIndex: 1, lastExecutionAtMs: 400, stepCompletedAtMs: 400,
      advanceAtMs: 300, expiresAtMs: null, actualCosts: {}, cooldownStarted: true, status: 'complete', failureReason: null, finishedAtMs: 400,
      repeat: null, actionOccupancies: [
        { stepKey: 'delay', stepVersion: 1, startedAtMs: 0, expectedEndAtMs: 100, finishedAtMs: 100 },
        { stepKey: 'complex', stepVersion: 2, startedAtMs: 100, expectedEndAtMs: 1100, finishedAtMs: 400 }
      ] }] }, recording: { skillActionRecordsTruncated: true }, skillActionRecords: [] } as unknown as DoneResult;
  return { prepared, request, done };
}

describe('6C完整过程占用事实独立于有限明细', () => {
  async function channelFacts(firstExecution: 'IMMEDIATE' | 'AFTER_INTERVAL' | 'CUSTOM_WINDOW', duration = 20,
    count = 4, first = 2, last = 13, index = count) {
    const result = await sample('CHANNEL');
    const { prepared, done } = result;
    const step = prepared.compileRequest.sharedProviders!.flatMap(provider => provider.processes ?? [])[0]!.steps[1]!;
    Object.assign(step, { firstExecution, durationMs: { op: 'const', value: duration }, executionCount: { op: 'const', value: count },
      ...(firstExecution === 'CUSTOM_WINDOW' ? { firstExecutionOffsetMs: { op: 'const', value: first }, lastExecutionOffsetMs: { op: 'const', value: last } } : {}) });
    const process = done.finalSnapshot.processInstances![0]!;
    const executionAt = (ordinal: number) => Math.round(100 + (firstExecution === 'CUSTOM_WINDOW'
      ? first + (count === 1 ? 0 : (last - first) * (ordinal - 1) / (count - 1))
      : duration * (ordinal - 1 + (firstExecution === 'AFTER_INTERVAL' ? 1 : 0)) / count));
    const summary = done.summary.skillUses!;
    Object.assign(summary, { completedCount: 0, inFlightCount: 1, stepExecutedCount: 1 + index, stepCompletedCount: 1 });
    Object.assign(process, { status: 'active', finishedAtMs: null, advanceAtMs: 100 + duration, expiresAtMs: 100 + duration,
      stepExecutionIndex: index, stepCompletedAtMs: null, lastExecutionAtMs: index ? executionAt(index) : null,
      repeat: { executionCount: count, executionIndex: index, intervalMs: 0,
        firstExecutionOffsetMs: executionAt(1) - 100, lastExecutionOffsetMs: executionAt(count) - 100,
        nextExecutionAtMs: index === count ? null : executionAt(index + 1) } });
    done.summary.durationMs = index ? executionAt(index) : 100;
    Object.assign(process.actionOccupancies[1]!, { expectedEndAtMs: 100 + duration, finishedAtMs: null });
    return { ...result, process, step };
  }
  it.each(['IMMEDIATE', 'AFTER_INTERVAL'] as const)('15毫秒4段的旧%s继续按完整时长舍入，不按整数端点插值', async firstExecution => {
    const { prepared, request, done, process } = await channelFacts(firstExecution, 15, 4, 0, 0, 2);
    expect(process.repeat!.firstExecutionOffsetMs).toBe(firstExecution === 'IMMEDIATE' ? 0 : 4);
    expect(process.repeat!.lastExecutionOffsetMs).toBe(firstExecution === 'IMMEDIATE' ? 11 : 15);
    expect(inspectSimulationProcessFacts(prepared.compileRequest, request, done).issues).toEqual([]);
    process.repeat!.nextExecutionAtMs = firstExecution === 'IMMEDIATE' ? 107 : 112;
    expect(inspectSimulationProcessFacts(prepared.compileRequest, request, done).issues.join(';')).toContain('绝对时点');
  });
  it.each([0, 1, 2, 3, 4])('指定窗口逐段快照和预算恢复前缀%s，末段结束仍保持完整占用', async index => {
    const { prepared, request, done, process } = await channelFacts('CUSTOM_WINDOW', 20, 4, 2, 13, index);
    const facts = inspectSimulationProcessFacts(prepared.compileRequest, request, done);
    expect(facts.issues).toEqual([]);
    expect(simulationActionContribution(facts.occupancies, 0, 119)).toBe(120);
    if (index === 4) {
      process.stepCompletedAtMs = process.finishedAtMs = 113;
      expect(inspectSimulationProcessFacts(prepared.compileRequest, request, done).issues.join(';')).toContain('提前完成');
    }
  });
  it.each([[1, 2, 0, 1], [20, 1, 5, 5]])('指定窗口支持1毫秒两段或单段：%s/%s/%s/%s', async (duration, count, first, last) => {
    const { prepared, request, done } = await channelFacts('CUSTOM_WINDOW', duration, count, first, last);
    expect(inspectSimulationProcessFacts(prepared.compileRequest, request, done).issues).toEqual([]);
  });
  it.each([2, 3, 4, 7, 64])('指定窗口%s段在安全整数上界保持原生精确舍入及逐段进度', async count => {
    const duration = Number.MAX_SAFE_INTEGER - 100;
    const first = 50;
    const last = duration;
    const { prepared, request, done, process } = await channelFacts('CUSTOM_WINDOW', duration, count, first, last, 0);
    const executionAt = (ordinal: number) => 100 + first + Number((BigInt(last - first) * BigInt(ordinal - 1) * 2n
      + BigInt(count - 1)) / (BigInt(count - 1) * 2n));
    process.repeat!.firstExecutionOffsetMs = first;
    process.repeat!.lastExecutionOffsetMs = last;
    for (let ordinal = 1; ordinal <= count; ordinal++) {
      process.stepExecutionIndex = process.repeat!.executionIndex = ordinal;
      process.lastExecutionAtMs = done.summary.durationMs = executionAt(ordinal);
      process.repeat!.nextExecutionAtMs = ordinal === count ? null : executionAt(ordinal + 1);
      done.summary.skillUses!.stepExecutedCount = 1 + ordinal;
      expect(inspectSimulationProcessFacts(prepared.compileRequest, request, done).issues).toEqual([]);
      if (ordinal < count) {
        process.repeat!.nextExecutionAtMs! -= 1;
        expect(inspectSimulationProcessFacts(prepared.compileRequest, request, done).issues.join(';')).toContain('下一段');
        process.repeat!.nextExecutionAtMs = executionAt(ordinal + 1);
      }
    }
  });
  it('非常量窗口只按冻结值证明，不重读作者参数；完整期限仍核对占用', async () => {
    const { prepared, request, done, process, step } = await channelFacts('CUSTOM_WINDOW');
    step.firstExecutionOffsetMs = { op: 'read', path: 'param.changed_first' };
    step.lastExecutionOffsetMs = { op: 'read', path: 'param.changed_last' };
    step.durationMs = { op: 'read', path: 'param.changed_duration' };
    expect(inspectSimulationProcessFacts(prepared.compileRequest, request, done).issues).toEqual([]);
    process.actionOccupancies[1]!.expectedEndAtMs = 113;
    expect(inspectSimulationProcessFacts(prepared.compileRequest, request, done).issues.join(';')).toContain('冻结完整期限');
  });
  it.each(['missing_first', 'fractional_last', 'unsafe_last', 'inverted', 'span', 'range', 'last_execution', 'author', 'terminated_next'] as const)(
    '零明细仍拒绝损坏窗口、进度与恢复期限：%s', async kind => {
      const { prepared, request, done, process } = await channelFacts('CUSTOM_WINDOW', 20, 4, 2, 13, 2);
      const repeat = process.repeat!;
      if (kind === 'missing_first') delete (repeat as Partial<typeof repeat>).firstExecutionOffsetMs;
      if (kind === 'fractional_last') repeat.lastExecutionOffsetMs = 13.5;
      if (kind === 'unsafe_last') repeat.lastExecutionOffsetMs = Number.MAX_SAFE_INTEGER + 1;
      if (kind === 'inverted') repeat.firstExecutionOffsetMs = 14;
      if (kind === 'span') repeat.lastExecutionOffsetMs = 4;
      if (kind === 'range') repeat.lastExecutionOffsetMs = 21;
      if (kind === 'last_execution') process.lastExecutionAtMs = 105;
      if (kind === 'author') repeat.firstExecutionOffsetMs = 1;
      if (kind === 'terminated_next') { process.status = 'failed'; process.finishedAtMs = done.summary.durationMs; }
      expect(inspectSimulationProcessFacts(prepared.compileRequest, request, done).issues.length).toBeGreaterThan(0);
    });
  it('提前释放使用实际结束期限，不保留最大蓄力等待，截断记录仍核对所有占用', async () => {
    const { prepared, request, done } = await sample();
    const facts = inspectSimulationProcessFacts(prepared.compileRequest, request, done);
    expect(facts.issues).toEqual([]);
    expect(simulationActionContribution(facts.occupancies, 0, 400)).toBe(400);
    expect(facts.occupancies.some(occupancy => 50 >= occupancy.startedAtMs && 50 < (occupancy.finishedAtMs ?? occupancy.expectedEndAtMs))).toBe(true);
  });
  it.each(['omit', 'window', 'version', 'closed', 'foreign'] as const)('截断也拒绝伪造完整历史：%s', async kind => {
    const { prepared, request, done } = await sample();
    const process = done.finalSnapshot.processInstances![0]!;
    if (kind === 'omit') process.actionOccupancies.shift();
    if (kind === 'window') process.actionOccupancies[1]!.startedAtMs = 101;
    if (kind === 'version') process.actionOccupancies[1]!.stepVersion = 1;
    if (kind === 'closed') process.actionOccupancies[1]!.finishedAtMs = null;
    if (kind === 'foreign') process.skillKey = 'foreign';
    expect(inspectSimulationProcessFacts(prepared.compileRequest, request, done).issues.length).toBeGreaterThan(0);
  });
  it('引导完整进度不依赖截断明细，拒绝未来已提交段及错下一绝对时点', async () => {
    const { prepared, request, done } = await sample('CHANNEL');
    const process = done.finalSnapshot.processInstances![0]!;
    done.summary.durationMs = 150;
    done.summary.skillUses!.completedCount = 0;
    done.summary.skillUses!.inFlightCount = 1;
    process.status = 'active'; process.finishedAtMs = null; process.advanceAtMs = 700; process.expiresAtMs = 700;
    process.stepCompletedAtMs = null; process.lastExecutionAtMs = 100;
    done.summary.skillUses!.stepCompletedCount = 1;
    process.repeat = { executionCount: 3, executionIndex: 1, intervalMs: 0, firstExecutionOffsetMs: 0, lastExecutionOffsetMs: 400, nextExecutionAtMs: 300 };
    process.actionOccupancies[1]!.expectedEndAtMs = 700;
    process.actionOccupancies[1]!.finishedAtMs = null;
    expect(inspectSimulationProcessFacts(prepared.compileRequest, request, done).issues).toEqual([]);
    process.repeat.executionIndex = 2; process.repeat.nextExecutionAtMs = 500;
    expect(inspectSimulationProcessFacts(prepared.compileRequest, request, done).issues.join(';')).toContain('最后已提交段');
    process.repeat.executionIndex = 1; process.repeat.nextExecutionAtMs = 301;
    expect(inspectSimulationProcessFacts(prepared.compileRequest, request, done).issues.join(';')).toContain('绝对时点');
  });
  it('多段原完整期限须与冻结次数和间隔一致，非常量作者间隔也不能跳过', async () => {
    const { prepared, request, done } = await sample('MULTI_HIT');
    const process = done.finalSnapshot.processInstances![0]!;
    process.repeat = { executionCount: 3, executionIndex: 3, intervalMs: 100, firstExecutionOffsetMs: 0, lastExecutionOffsetMs: 200, nextExecutionAtMs: null };
    process.stepExecutionIndex = 3; process.lastExecutionAtMs = process.stepCompletedAtMs = process.finishedAtMs = process.advanceAtMs = 300;
    process.actionOccupancies[1]!.expectedEndAtMs = process.actionOccupancies[1]!.finishedAtMs = 300;
    done.summary.skillUses!.stepExecutedCount = 4;
    const binding = prepared.compileRequest.rules.skillActionBindings![0]!;
    const provider = prepared.compileRequest.sharedProviders!.find(provider => provider.providerKey === binding.providerDefinitionRef)!;
    provider.processes![0]!.steps[1]!.intervalMs = { op: 'read', path: 'param.dynamic_interval' };
    expect(inspectSimulationProcessFacts(prepared.compileRequest, request, done).issues).toEqual([]);
    process.actionOccupancies[1]!.expectedEndAtMs = 301;
    expect(inspectSimulationProcessFacts(prepared.compileRequest, request, done).issues.join(';')).toContain('多段完整期限必须对应冻结次数与间隔');
  });
  it.each(['zero_deadline', 'early_exit_without_control'] as const)('非常量完整时长仍核对真实正期限与提前退出佐证：%s', async kind => {
    const { prepared, request, done } = await sample();
    const binding = prepared.compileRequest.rules.skillActionBindings![0]!;
    const provider = prepared.compileRequest.sharedProviders!.find(provider => provider.providerKey === binding.providerDefinitionRef)!;
    provider.processes![0]!.steps[1]!.maximumChargeMs = { op: 'read', path: 'param.dynamic_maximum' };
    expect(inspectSimulationProcessFacts(prepared.compileRequest, request, done).issues).toEqual([]);
    const process = done.finalSnapshot.processInstances![0]!;
    if (kind === 'zero_deadline') {
      process.actionOccupancies[1]!.expectedEndAtMs = 100;
      expect(inspectSimulationProcessFacts(prepared.compileRequest, request, done).issues.join(';')).toContain('真实完整期限必须为正');
    } else {
      process.finishedAtMs = process.stepCompletedAtMs = process.lastExecutionAtMs = process.actionOccupancies[1]!.finishedAtMs = 401;
      expect(inspectSimulationProcessFacts(prepared.compileRequest, request, done).issues.join(';')).toContain('提前退出必须有原使用真实控制或死亡终结佐证');
    }
  });
  it.each(['active', 'failed'] as const)('已接受首次但进入首步之前%s，保留合法零步骤前缀', async status => {
    const { prepared, request, done } = await sample();
    const process = done.finalSnapshot.processInstances![0]!;
    done.summary.skillUses!.stepEnteredCount = done.summary.skillUses!.completedCount = 0;
    done.summary.skillUses!.stepExecutedCount = done.summary.skillUses!.stepCompletedCount = 0;
    done.summary.skillUses!.inFlightCount = status === 'active' ? 1 : 0;
    done.summary.skillUses!.failedCount = status === 'failed' ? 1 : 0;
    process.stepKey = ''; process.stepVersion = 0; process.stepStartedAtMs = process.startedAtMs;
    process.stepExecutionIndex = 0; process.lastExecutionAtMs = process.stepCompletedAtMs = null;
    process.repeat = null; process.actionOccupancies = []; process.status = status;
    process.finishedAtMs = status === 'failed' ? 0 : null; process.failureReason = status === 'failed' ? 'SOURCE_DIED' : null;
    expect(inspectSimulationProcessFacts(prepared.compileRequest, request, done).issues).toEqual([]);
    process.actionOccupancies.push({ stepKey: 'delay', stepVersion: 1, startedAtMs: 0, expectedEndAtMs: 100, finishedAtMs: 100 });
    expect(inspectSimulationProcessFacts(prepared.compileRequest, request, done).issues.length).toBeGreaterThan(0);
  });
});

const inspectSimulationSnapshot = (...args: Parameters<typeof raw_inspectSimulationSnapshot>): ReturnType<typeof raw_inspectSimulationSnapshot> => { approveSnapshotFixture(args[0]); return raw_inspectSimulationSnapshot(...args); };
