import { describe, expect, it } from 'vitest';
import { preparedActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import type { DoneResult, MechanicRecord, ProcessInstanceSnapshot } from '../types/genericEngine';
import { skillActionRequest } from './skillActionRequest';
import { automaticSkillRequest } from './automaticSkillRequest';
import { drivenActiveAmmo, inspectActiveAmmoMechanics } from './simulationAmmoMechanics';

async function sample(oneByOne = true) {
  const { snapshot, prepared } = preparedActiveSample();
  const compile = prepared.compileRequest;
  const binding = compile.rules.skillActionBindings![0]!;
  const provider = compile.sharedProviders!.find(row => row.providerKey === binding.providerDefinitionRef)!;
  provider.initialStateSchema = { stock: { valueType: 'integer', stateKind: 'ammo', defaultValue: 0, maxValue: 4,
    ammoRecovery: { intervalMs: { op: 'const', value: oneByOne ? 20000 : 8000 }, mode: oneByOne ? 'one_by_one' : 'all_at_once',
      startCondition: oneByOne ? 'after_consume' : 'when_empty', ...(oneByOne ? { initialRemainingMs: 20000 } : {}) } } };
  provider.processes![0]!.momentOperations.unshift({ moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null }, operations: [
    { operation: 'state_change', target: 'self', ref: 'stock', valuePolicy: 'add', amount: { op: 'const', value: -1 }, types: ['state_scope/provider'] }
  ] });
  const plan = snapshot.selection.plannedSkills[0]!;
  const request = (await skillActionRequest(prepared, snapshot, { actions: [{ ...plan, instructionKey: 'shot', atMs: 8000, sortOrder: 0,
    phaseKind: 'INITIAL', targetSide: 'target', hitPreset: 'TARGET_HIT', parentInstructionKey: null }], durationMs: 9000,
    recordTimeSeries: false, maxSkillActionRecords: 100, maxSkillUseRecords: 100, maxHealingRecords: 0 })).runRequest;
  const context = drivenActiveAmmo(compile, request.driverPlan)[0]!;
  const row = (kind: MechanicRecord['kind'], timeMs: number, beforeValue: number, afterValue: number, useRef: string | null, readyAtMs: number | null): MechanicRecord => ({
    kind, timeMs, beforeValue, afterValue, useRef, readyAtMs, owner: context.owner, providerRef: context.providerRef,
    providerDefinitionRef: context.providerDefinitionRef, skillKey: context.skillKey, stateKey: context.stateKey,
    operationRef: useRef === null ? context.recoveryPath : context.consumptionPath
  });
  const process: ProcessInstanceSnapshot = { owner: 'source', target: 'target', providerRef: binding.providerRef, skillKey: binding.skillKey,
    processKey: context.processKey, useKey: 'active_shot_1', startedAtMs: 8000, stepKey: 'delay', stepVersion: 1, stepExecutionIndex: 1,
    lastExecutionAtMs: 8100, stepCompletedAtMs: 8100, stepStartedAtMs: 8000, advanceAtMs: 8100, expiresAtMs: null,
    actualCosts: {}, cooldownStarted: true, status: 'complete', failureReason: null, finishedAtMs: 8100, repeat: null, actionOccupancies: [] };
  // 真实失败包的通用序列：20秒初充被退款提前到8秒；恢复后继续回充，再由同刻首次过程消费。
  const records = [row('WAIT_STARTED', 0, 0, 0, null, oneByOne ? 20000 : 8000),
    row('STATE_CHANGED', 8000, 0, oneByOne ? 1 : 4, null, 8000), row('WAIT_ENDED', 8000, 0, oneByOne ? 1 : 4, null, 8000),
    ...(oneByOne ? [row('WAIT_STARTED', 8000, 1, 1, null, 28000)] : []),
    row('STATE_CHANGED', 8000, oneByOne ? 1 : 4, oneByOne ? 0 : 3, process.useKey, null)];
  const finalSnapshot = structuredClone(request.initialSnapshot);
  finalSnapshot.timeMs = 9000; finalSnapshot.processInstances = [process];
  finalSnapshot.combatants.find(row => row.key === 'source')!.providerState[binding.providerRef] = { state: { stock: oneByOne ? 0 : 3 } };
  const done = { summary: { durationMs: 9000 }, finalSnapshot, mechanicRecords: records,
    recording: { mechanicRecordCount: records.length, returnedMechanicRecords: records.length, droppedMechanicRecords: 0, mechanicRecordsTruncated: false } } as DoneResult;
  return { prepared, snapshot, compile, request, done, process, context, row };
}

describe('实际驱动主动弹药的有限机制事实', () => {
  it.each([true, false])('识别逐枚%s与整匣恢复，真实消费不借用普攻身份', async oneByOne => {
    const { compile, request, done, process } = await sample(oneByOne);
    expect(inspectActiveAmmoMechanics(compile, request, done, [process])).toEqual([]);
  });
  it.each([0, 1, 2, 3, 4])('截断只核保留的前%s条，不伪造未返回的恢复配对或消费', async length => {
    const { compile, request, done, process } = await sample();
    done.mechanicRecords = done.mechanicRecords!.slice(0, length);
    done.recording!.mechanicRecordsTruncated = true;
    expect(inspectActiveAmmoMechanics(compile, request, done, [process])).toEqual([]);
  });
  it.each([1, 8000, 20001])('首次等待期限%s必须准确对应显式初充余时，不能仅靠后续恢复补证', async deadline => {
    const { compile, request, done, process } = await sample();
    done.mechanicRecords![0]!.readyAtMs = deadline;
    expect(inspectActiveAmmoMechanics(compile, request, done, [process]).length).toBeGreaterThan(0);
    done.mechanicRecords = done.mechanicRecords!.slice(0, 1); done.recording!.mechanicRecordsTruncated = true;
    expect(inspectActiveAmmoMechanics(compile, request, done, [process]).length).toBeGreaterThan(0);
  });
  it('每一轮恢复只能提前，不能晚于配对等待的原截止时间', async () => {
    const { compile, request, done, process, row } = await sample();
    done.mechanicRecords![3]!.readyAtMs = 8500;
    done.mechanicRecords!.push(row('STATE_CHANGED', 8600, 0, 1, null, 8600), row('WAIT_ENDED', 8600, 0, 1, null, 8600),
      row('WAIT_STARTED', 8600, 1, 1, null, 28600));
    (done.finalSnapshot.combatants[0]!.providerState[process.providerRef] as { state: Record<string, number> }).state.stock = 1;
    expect(inspectActiveAmmoMechanics(compile, request, done, [process]).length).toBeGreaterThan(0);
    done.mechanicRecords = done.mechanicRecords!.slice(0, 6); done.recording!.mechanicRecordsTruncated = true;
    expect(inspectActiveAmmoMechanics(compile, request, done, [process]).length).toBeGreaterThan(0);
  });
  it('允许早于或恰好位于原等待期限的逐枚恢复，显式零余时仍成立', async () => {
    const { compile, request, done, process, context } = await sample();
    const field = compile.sharedProviders!.find(row => row.providerKey === context.providerDefinitionRef)!.initialStateSchema!.stock;
    if (typeof field !== 'object') throw new Error('样例声明失效');
    field.ammoRecovery!.initialRemainingMs = 8000; done.mechanicRecords![0]!.readyAtMs = 8000;
    expect(inspectActiveAmmoMechanics(compile, request, done, [process])).toEqual([]);
    field.ammoRecovery!.initialRemainingMs = 0; done.mechanicRecords![0]!.readyAtMs = 0;
    for (const row of done.mechanicRecords!.slice(1)) {
      row.timeMs -= 8000;
      if (row.readyAtMs !== null) row.readyAtMs -= 8000;
    }
    process.startedAtMs = 0;
    expect(inspectActiveAmmoMechanics(compile, request, done, [process])).toEqual([]);
  });
  it.each([8500, 9000])('完整观察不能尾留截止于%s的等待，终点到期事件也必须执行', async deadline => {
    const { compile, request, done, process } = await sample();
    done.mechanicRecords![3]!.readyAtMs = deadline;
    done.summary.execution = { requestedDurationMs: 9000, complete: true, incompleteReason: null, budgetCause: null,
      targetKilled: false, targetKilledAtMs: null };
    expect(inspectActiveAmmoMechanics(compile, request, done, [process]).length).toBeGreaterThan(0);
  });
  it.each(['truncated', 'incomplete', 'source_dead', 'target_dead', 'unmounted', 'different_definition', 'future_deadline'] as const)(
    '尾部等待不能误拒允许边界：%s', async boundary => {
      const { compile, request, done, process } = await sample();
      done.mechanicRecords![3]!.readyAtMs = 9000;
      done.summary.execution = { requestedDurationMs: 9000, complete: true, incompleteReason: null, budgetCause: null,
        targetKilled: false, targetKilledAtMs: null };
      const source = done.finalSnapshot.combatants.find(row => row.key === 'source')!;
      if (boundary === 'truncated') done.recording!.mechanicRecordsTruncated = true;
      if (boundary === 'incomplete') done.summary.execution.complete = false;
      if (boundary === 'source_dead') source.attributes.hp!.current = 0;
      if (boundary === 'target_dead') done.finalSnapshot.combatants.find(row => row.key === 'target')!.attributes.hp!.current = 0;
      if (boundary === 'unmounted') source.providers = source.providers.filter(row => row.providerRef !== process.providerRef);
      if (boundary === 'different_definition') source.providers.find(row => row.providerRef === process.providerRef)!.definitionRef = 'different_definition';
      if (boundary === 'future_deadline') done.mechanicRecords![3]!.readyAtMs = 9001;
      expect(inspectActiveAmmoMechanics(compile, request, done, [process])).toEqual([]);
    });
  it.each(['owner', 'providerRef', 'providerDefinitionRef', 'skillKey', 'stateKey', 'operationRef', 'useRef', 'consume_time',
    'inventory', 'recovery_amount', 'recovery_pair', 'duplicate_consume', 'missing_consume', 'missing_wait', 'reversed', 'final_inventory'] as const)(
    '拒绝主动库存身份或提交链篡改：%s', async kind => {
      const { compile, request, done, process } = await sample();
      const records = done.mechanicRecords!; const consume = records[4]!;
      if (['owner', 'providerRef', 'providerDefinitionRef', 'skillKey', 'stateKey', 'operationRef', 'useRef'].includes(kind)) {
        (consume as unknown as Record<string, unknown>)[kind] = kind === 'owner' ? 'target' : 'foreign_identity';
      }
      if (kind === 'consume_time') consume.timeMs = 8001;
      if (kind === 'inventory') consume.beforeValue = 2;
      if (kind === 'recovery_amount') records[1]!.afterValue = 2;
      if (kind === 'recovery_pair') records[2]!.timeMs = 8001;
      if (kind === 'duplicate_consume') records.push(structuredClone(consume));
      if (kind === 'missing_consume') records.pop();
      if (kind === 'missing_wait') records.splice(0, 1);
      if (kind === 'reversed') records.reverse();
      if (kind === 'final_inventory') (done.finalSnapshot.combatants[0]!.providerState[consume.providerRef] as { state: Record<string, number> }).state.stock = 1;
      expect(inspectActiveAmmoMechanics(compile, request, done, [process]).length).toBeGreaterThan(0);
    });
  it('截断不能接受中间缺失或错误保留事实，恢复完成不能伪装消费', async () => {
    const { compile, request, done, process } = await sample();
    done.recording!.mechanicRecordsTruncated = true;
    done.mechanicRecords!.splice(1, 1);
    expect(inspectActiveAmmoMechanics(compile, request, done, [process]).length).toBeGreaterThan(0);
  });
  it('整匣恢复不能提前或只补一枚，主动逐枚模式不套用整匣规则', async () => {
    const { compile, request, done, process } = await sample(false);
    done.mechanicRecords![0]!.readyAtMs = 20000;
    expect(inspectActiveAmmoMechanics(compile, request, done, [process]).length).toBeGreaterThan(0);
  });
  it('没有实际首次的已声明供值器和未驱动目标不能产生主动库存记录', async () => {
    const { compile, request, done, process } = await sample();
    request.driverPlan.skillActions = [];
    expect(drivenActiveAmmo(compile, request.driverPlan)).toEqual([]);
    expect(inspectActiveAmmoMechanics(compile, request, done, [process]).length).toBeGreaterThan(0);
  });
  it.each(['wrong_moment', 'conditional', 'wrong_scope', 'wrong_amount', 'duplicate'] as const)('消费路径必须唯一且无条件：%s', async kind => {
    const { compile, request, context } = await sample();
    const group = compile.sharedProviders!.find(row => row.providerKey === context.providerDefinitionRef)!.processes![0]!.momentOperations[0]!;
    const operation = group.operations[0]!;
    if (kind === 'wrong_moment') group.moment.momentType = 'PROCESS_COMPLETE';
    if (kind === 'conditional') operation.condition = { op: 'const', value: 1 };
    if (kind === 'wrong_scope') operation.types = ['state_scope/provider_target'];
    if (kind === 'wrong_amount') operation.amount = { op: 'const', value: -2 };
    if (kind === 'duplicate') group.operations.push(structuredClone(operation));
    expect(() => drivenActiveAmmo(compile, request.driverPlan)).toThrow(/消费/);
  });
  it('仅真实主动弹药的无普攻详细请求申请机制预算，汇总保持零', async () => {
    const { prepared, snapshot, request } = await sample();
    expect(request.recordBudget!.maxMechanicRecords).toBe(2000);
    const input = { rules: [{ ...snapshot.selection.plannedSkills[0]!, ruleKey: 'auto_stock', sortOrder: 0, targetSide: 'target' as const,
      hitPreset: 'TARGET_HIT' as const, waitForCooldowns: [], releaseAfterRuleKey: null }], durationMs: 9000, recordTimeSeries: false,
      maxAutomaticSkillRecords: 100, maxHealingRecords: 0, outputMode: 'detailed' as const };
    const detailed = (await automaticSkillRequest(prepared, snapshot, input)).runRequest;
    const summary = (await automaticSkillRequest(prepared, snapshot, { ...input, outputMode: 'summary' })).runRequest;
    expect(detailed.recordBudget!.maxMechanicRecords).toBe(2000);
    expect(summary.recordBudget!.maxMechanicRecords).toBe(0);
    const { prepared: plain, snapshot: plainSnapshot } = preparedActiveSample();
    const plainRequest = (await automaticSkillRequest(plain, plainSnapshot, input)).runRequest;
    expect(plainRequest.recordBudget!.maxMechanicRecords).toBe(0);
  });
});
