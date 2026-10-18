import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { CompileRequest, DoneResult, RunRequest } from '../types/genericEngine';
import type { OperationOrigin } from './simulationAdapter';
import { assessContinuousAttackResult } from './continuousAttackResult';

type Regression = { key: string; compileRequest: CompileRequest; request: RunRequest; done: DoneResult; origins: OperationOrigin[];
  originalAssessment: { factsValid: boolean; issues: string[] } };
const fixture = JSON.parse(readFileSync(new URL('../../tests/fixtures/firstAttackWaitGap.json', import.meta.url), 'utf8')) as {
  kind: string; wasmSha256: string; cases: Regression[];
};
const sample = (key = 'historical_gap') => structuredClone(fixture.cases.find(row => row.key === key)!);
const assess = (row: Regression) => assessContinuousAttackResult(row.compileRequest, row.request, row.done, row.origins);
const firstWaitIssues = (row: Regression) => assess(row).issues.filter(issue => issue.startsWith('summary.basicAttack.firstWait'));

describe('完整零刀观察必须有连续首刀等待依据', () => {
  it('旧v18真实异名坏输出曾通过核对，后续占用不能掩盖3435～9435毫秒空档', () => {
    const row = sample();
    expect(fixture.wasmSha256).toBe('0705af85c9f5f471c3e3f46d6df1d1b399aa4dc241a5303cece89e36c602289b');
    expect(JSON.stringify(fixture)).not.toContain('garen');
    expect(row.originalAssessment).toEqual({ factsValid: true, issues: [] });
    expect(row.done.summary.basicAttack).toMatchObject({ startedCount: 0, initialActionReadyAtMs: 12435 });
    expect(assess(row).factsValid).toBe(false);
    expect(firstWaitIssues(row)).toHaveLength(1);
  });

  it('真实完全连续占用超过观察窗口仍合法，行动贡献字段保持原含义', () => {
    const row = sample('continuous_occupancy');
    expect(row.done.summary.basicAttack).toMatchObject({ startedCount: 0, initialActionReadyAtMs: 12435 });
    expect(assess(row).issues).toEqual([]);
  });

  it.each([0, 11000, { readyAtMs: 11000, remainingMs: 11000 }, { readyAtMs: 0, remainingMs: 0 }])('初态普通冷却%s即使是具名0仍按原生准入拒绝', initialCooldown => {
    const row = sample();
    row.request.initialSnapshot.combatants[0]!.cooldowns[row.request.driverPlan.basicAttack!.initialControlAbilityRef] = initialCooldown;
    expect(assess(row).factsValid).toBe(false);
    expect(assess(row).issues.some(issue => issue.includes('空初态冷却'))).toBe(true);
  });

  it('目标方或无关能力含初态冷却也不能借连续占用标成合法', () => {
    const row = sample('continuous_occupancy');
    row.request.initialSnapshot.combatants[1]!.cooldowns['target.provider[unrelated].ability[initial]'] = 0;
    expect(assess(row).factsValid).toBe(false);
    expect(assess(row).issues.some(issue => issue.includes('initialSnapshot.combatants.target.cooldowns'))).toBe(true);
  });

  it('观察截止与真实就绪同刻不能解释为仍在等待；截止之前持续占用仍合法', () => {
    const row = sample('continuous_occupancy');
    const process = row.done.finalSnapshot.processInstances!.find(process => process.skillKey === 'block_delta')!;
    const occupiedStep = row.compileRequest.sharedProviders!.find(provider => provider.skillKey === 'block_delta')!.processes![0]!.steps[0]!;
    occupiedStep.delayMs = { op: 'const', value: row.done.summary.durationMs - process.startedAtMs };
    process.advanceAtMs = process.expiresAtMs = row.done.summary.durationMs;
    process.actionOccupancies[0]!.expectedEndAtMs = row.done.summary.durationMs;
    row.done.summary.basicAttack!.initialActionReadyAtMs = row.done.summary.durationMs;
    expect(firstWaitIssues(row)).toHaveLength(1);
    process.advanceAtMs++;
    process.expiresAtMs++;
    process.actionOccupancies[0]!.expectedEndAtMs++;
    occupiedStep.delayMs.value!++;
    row.done.summary.basicAttack!.initialActionReadyAtMs!++;
    expect(firstWaitIssues(row)).toEqual([]);
    expect(assess(row).factsValid).toBe(true);
  });

  it('零弹未来恢复是独立合法等待起点，不用0当成初次就绪', () => {
    const row = sample();
    const plan = row.request.driverPlan.basicAttack!;
    const mount = row.compileRequest.combatants[0]!.providers.find(mount => plan.startAbilityRef.includes(`[${mount.providerRef}]`))!;
    const provider = row.compileRequest.sharedProviders!.find(provider => provider.providerKey === mount.definitionRef)!;
    provider.initialStateSchema = { rounds: { valueType: 'integer', defaultValue: 0, maxValue: 4, stateKind: 'ammo',
      ammoRecovery: { intervalMs: { op: 'const', value: 11000 }, mode: 'all_at_once', startCondition: 'when_empty' } } };
    row.done.summary.basicAttack!.initialMechanicReadyAtMs = 11000;
    row.request.recordBudget!.maxMechanicRecords = 0;
    row.done.recording!.mechanicRecordCount = row.done.recording!.droppedMechanicRecords = 1;
    row.done.recording!.returnedMechanicRecords = 0;
    row.done.recording!.mechanicRecordsTruncated = true;
    expect(assess(row).issues).toEqual([]);
    row.done.summary.basicAttack!.initialMechanicReadyAtMs = 6000;
    expect(firstWaitIssues(row)).toHaveLength(1);
  });

  it('预算中断不被完整零刀断言伪装成已经应当发生的首刀', () => {
    const row = sample();
    row.done.summary.stopReason = 'budget_exceeded';
    row.done.summary.execution!.complete = false;
    row.done.summary.execution!.incompleteReason = 'budget_exceeded';
    row.done.summary.execution!.budgetCause = 'max_events';
    expect(assess(row).factsValid).toBe(true);
    expect(firstWaitIssues(row)).toEqual([]);
  });

  it('其它未核定普通冷却写入不默认无效，不擅自用占用替代其动态就绪', () => {
    const row = sample();
    const reset = row.compileRequest.sharedProviders!.find(provider => provider.skillKey === 'empowered_gamma')!.processes![0]!.momentOperations[0]!.operations[0]!;
    reset.valuePolicy = 'extend'; reset.amount = { op: 'const', value: 12000 };
    expect(firstWaitIssues(row)).toEqual([]);
  });
});
