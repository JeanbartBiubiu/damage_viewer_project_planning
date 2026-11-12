import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { simulationComplexSample } from '../../tests/fixtures/simulationComplexSkills';
import { simulationActiveSample } from '../../tests/fixtures/simulationActiveSkill';
import { syncSimulationSkillSources } from '../../tests/fixtures/simulationSkillSources';
import { approveSnapshotFixture } from '../../tests/fixtures/nativeFormulaProof';
import { skillFormulaDefinition } from '../../tests/fixtures/skillFormulaDefinition';
import { fixedValue, formulaValue } from '../types/numericValue';
import type { DoneResult } from '../types/genericEngine';
import { assembleSimulation, inspectSimulationSnapshot } from './simulationAdapter';
import { automaticSkillRequest } from './automaticSkillRequest';
import { assessAutomaticSkillResult } from './automaticSkillResult';
import { TinyGoV2Bridge } from '../../tests/fixtures/authorizedBridge';
import { parseCompileResult, parseDoneResult, parseReleaseResult } from './genericEngineClient';
import { describeCombatSkill } from '../pages/simulation/combatSkillRoster';

let bridge: TinyGoV2Bridge;
beforeAll(async () => {
  const bytes = readFileSync(process.env.PHASE3B_WASM_PATH || new URL('./wasm/tinygo_engine_v2.wasm', import.meta.url));
  bridge = await TinyGoV2Bridge.create({ wasmUrl: 'data:application/wasm;base64,' + bytes.toString('base64') });
});

function sample(dynamic = false, background = true) {
  const snapshot = simulationComplexSample('CHANNEL', background);
  const configuration = snapshot.skillConfigurations[1]!;
  const process = configuration.processes[0]!;
  process.steps = [{ ...process.steps[1]!, sortOrder: 0 }];
  process.cooldown!.startMoment = { momentType: 'PROCESS_COMPLETE', stepKey: null, failureReason: null };
  configuration.triggerRules = configuration.triggerRules.filter(rule => rule.eventSource.eventType !== 'PROCESS_CANCEL_REQUESTED');
  snapshot.selection.plannedSkills[0]!.phaseKinds = ['INITIAL'];
  if (dynamic) {
    configuration.parameters.push({ gameId: snapshot.gameId, skillKey: configuration.skill.skillKey, parameterKey: 'scene_segments',
      name: '本次明确次数', description: null, sortOrder: 0, valueMode: 'RUNTIME_INPUT', valueType: 'INTEGER',
      fixedValue: null, levelValues: null, createdAt: '', updatedAt: '' });
    snapshot.catalogs.attributes.push({ ...snapshot.catalogs.attributes[0]!, attributeKey: 'scene_channel_count', name: '本次场景圈数', valueType: 'DECIMAL' });
    snapshot.source.selectedLevelValues.scene_channel_count = 3;
    snapshot.source.attributes.levelValues['1'] = { ...snapshot.source.selectedLevelValues };
    configuration.triggerRules[0]!.actions[0]!.runtimeInputBindings.push({ bindingKey: 'scene_binding', parameterKey: 'scene_segments',
      sourceType: 'SCENE_ATTRIBUTE_SNAPSHOT', detail: { subject: 'SOURCE', attributeKey: 'scene_channel_count', sources: ['CHARACTER_LEVEL', 'EQUIPMENT_DIRECT'] } });
    configuration.formulas.push({ gameId: snapshot.gameId, skillKey: configuration.skill.skillKey, formulaKey: 'actual_segment_count',
      name: '真实场景次数', description: null, sortOrder: 0, createdAt: '', updatedAt: '',
      expression: skillFormulaDefinition(configuration.skill.skillKey, { nodeType: 'PARAMETER', parameterKey: 'scene_segments' }) });
    const step = process.steps[0]!;
    if (step.stepType !== 'CHANNEL') throw new Error('样例需要引导');
    step.detail.executionCountValue = formulaValue('actual_segment_count');
  }
  return syncSimulationSkillSources(snapshot);
}

async function preparedSample(options: { dynamic?: boolean; background?: boolean; outputMode?: 'detailed' | 'summary'; maximum?: number;
  preset?: 'TARGET_HIT' | 'MISS'; duration?: number; successor?: boolean; customWindow?: boolean; targetHealth?: number } = {}) {
  const snapshot = sample(options.dynamic, options.background);
  if (options.customWindow) {
    const step = snapshot.skillConfigurations[1]!.processes[0]!.steps[0]!;
    if (step.stepType !== 'CHANNEL') throw new Error('样例需要引导');
    step.detail = { ...step.detail, firstExecution: 'CUSTOM_WINDOW', firstExecutionOffsetValue: fixedValue(50), lastExecutionOffsetValue: fixedValue(550) };
  }
  if (options.successor) {
    const original = simulationActiveSample().skillConfigurations[1]!;
    const next = JSON.parse(JSON.stringify(original).replaceAll(original.skill.skillKey, 'sample_successor')) as typeof original;
    snapshot.skillConfigurations.push(next);
    snapshot.source.attachedSkills.push({ ...snapshot.source.attachedSkills[1]!, skillKey: next.skill.skillKey, skillName: next.skill.name });
    snapshot.selection.plannedSkills.push({ ...snapshot.selection.plannedSkills[0]!, skillKey: next.skill.skillKey });
    snapshot.selection.sourceSkillSettings.push({ ...snapshot.selection.sourceSkillSettings.find(row => row.skillKey === original.skill.skillKey)!, skillKey: next.skill.skillKey });
    syncSimulationSkillSources(snapshot);
  }
  approveSnapshotFixture(snapshot);
  const attributes = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) attributes[row.side][row.attribute.attributeKey] = 0;
  const prepared = assembleSimulation(snapshot, attributes, { source: 1000, target: options.targetHealth ?? 5000 });
  const request = (await automaticSkillRequest(prepared, snapshot, { rules: snapshot.selection.plannedSkills.map((selected, index) => ({ ...selected,
    ruleKey: index ? 'after_channel' : 'finite_channel', sortOrder: index, targetSide: 'target', hitPreset: options.preset ?? 'TARGET_HIT',
    waitForCooldowns: [], releaseAfterRuleKey: index ? 'finite_channel' : null })), durationMs: options.duration ?? 1500,
  attackSpeedInputMax: 10, recordTimeSeries: false, maxAutomaticSkillRecords: options.maximum ?? 1000, maxHealingRecords: 0,
  outputMode: options.outputMode ?? 'detailed' })).runRequest;
  if (options.maximum !== undefined) request.recordBudget!.maxDamageRecords = options.maximum;
  return { snapshot, prepared, request };
}

function run(prepared: Awaited<ReturnType<typeof preparedSample>>['prepared'], request: Awaited<ReturnType<typeof preparedSample>>['request']) {
  const compiled = parseCompileResult(bridge.compile(prepared.compileRequest));
  expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true);
  if (!compiled.sessionId) throw new Error('缺少实际会话');
  request.sessionId = compiled.sessionId;
  try { return parseDoneResult(bridge.run(request)); }
  finally { expect(parseReleaseResult(bridge.releaseSession(compiled.sessionId, prepared.compileRequest.rulesHash)).released).toBe(true); }
}

describe('有限引导自动入口与正式Wasm结果核对', () => {
  it('独立单步骤引导保留每段真实命中，背景普攻等待完整占用且冷却从完成起算', async () => {
    const { snapshot, prepared, request } = await preparedSample();
    expect(describeCombatSkill(snapshot.skillConfigurations[1]!, false).issue).toBeNull();
    const done = run(prepared, request);
    const process = done.finalSnapshot.processInstances!.find(row => row.skillKey === snapshot.selection.plannedSkills[0]!.skillKey)!;
    expect(process).toMatchObject({ startedAtMs: 0, finishedAtMs: 600, cooldownStarted: true,
      repeat: { executionCount: 3, executionIndex: 3 }, actionOccupancies: [{ startedAtMs: 0, expectedEndAtMs: 600, finishedAtMs: 600 }] });
    expect(done.damageRecords!.filter(row => row.useRef === process.useKey).map(row => row.timeMs)).toEqual([0, 200, 400]);
    expect(done.attackRecords!.map(row => row.startAtMs)).toEqual([600]);
    expect(done.automaticSkillSummary).toMatchObject({ startedCount: 1, completedCount: 1 });
    const assessment = assessAutomaticSkillResult(prepared.compileRequest, request, done, prepared.operationOrigins);
    expect(assessment.factsValid, assessment.issues.join(';')).toBe(true);
  });

  it.each([['detailed', 0], ['detailed', 1], ['summary', 0]] as const)('%s／明细%s仍核对冻结次数与完整累计', async (outputMode, maximum) => {
    const { prepared, request } = await preparedSample({ dynamic: true, outputMode, maximum });
    const done = run(prepared, request);
    expect(done.summary.skillUses).toMatchObject({ releasedCount: 3, hitCount: 3, stepExecutedCount: 3 });
    const assessment = assessAutomaticSkillResult(prepared.compileRequest, request, done, prepared.operationOrigins);
    expect(assessment.factsValid, assessment.issues.join(';')).toBe(true);
  });

  it.each(['TARGET_HIT', 'MISS'] as const)('无背景普攻的%s按实际每段预设核对完整释放和命中累计', async preset => {
    const { prepared, request } = await preparedSample({ background: false, preset });
    const done = run(prepared, request);
    expect(done.summary.skillUses).toMatchObject({ releasedCount: 3, hitCount: preset === 'MISS' ? 0 : 3 });
    expect(assessAutomaticSkillResult(prepared.compileRequest, request, done).factsValid).toBe(true);
  });

  it.each([0, 1, 1000])('引导只在完整600毫秒结束后授予并消费一次后项资格，自动明细预算%s不改执行', async maximum => {
    const { prepared, request } = await preparedSample({ successor: true, dynamic: true, maximum, duration: 1000 });
    const done = run(prepared, request);
    const next = done.finalSnapshot.processInstances!.find(row => row.skillKey === 'sample_successor')!;
    expect(next).toMatchObject({ startedAtMs: 600, finishedAtMs: 700, status: 'complete' });
    expect(done.attackRecords!.map(row => row.startAtMs)).toEqual([700]);
    expect(done.automaticSkillSummary!.qualifications).toEqual([expect.objectContaining({ grantorRuleKey: 'finite_channel', consumerRuleKey: 'after_channel',
      grantedCount: 1, consumedCount: 1, remainingCount: 0 })]);
    const assessment = assessAutomaticSkillResult(prepared.compileRequest, request, done, prepared.operationOrigins);
    expect(assessment.factsValid, assessment.issues.join(';')).toBe(true);
  });

  it.each(['detailed', 'summary'] as const)('观察到第2圈后的%s仍保留活动引导、冻结次数及完整占用', async outputMode => {
    const { prepared, request } = await preparedSample({ dynamic: true, outputMode, duration: 250 });
    const done = run(prepared, request);
    expect(done.summary.skillUses).toMatchObject({ releasedCount: 2, hitCount: 2, inFlightCount: 1, completedCount: 0 });
    expect(done.finalSnapshot.processInstances!.find(row => row.skillKey === 'sample_active')).toMatchObject({ repeat: { executionCount: 3, executionIndex: 2, nextExecutionAtMs: 400 },
      actionOccupancies: [{ startedAtMs: 0, expectedEndAtMs: 600, finishedAtMs: null }] });
    const assessment = assessAutomaticSkillResult(prepared.compileRequest, request, done, prepared.operationOrigins);
    expect(assessment.factsValid, assessment.issues.join(';')).toBe(true);
  });

  it('指定首末窗口逐圈核对，末圈550毫秒不提前结束600毫秒完整占用', async () => {
    const { prepared, request } = await preparedSample({ dynamic: true, customWindow: true });
    const done = run(prepared, request);
    expect(done.damageRecords!.filter(row => row.attackIndex === null).map(row => row.timeMs)).toEqual([50, 300, 550]);
    expect(done.attackRecords!.map(row => row.startAtMs)).toEqual([600]);
    const assessment = assessAutomaticSkillResult(prepared.compileRequest, request, done, prepared.operationOrigins);
    expect(assessment.factsValid, assessment.issues.join(';')).toBe(true);
  });

  it.each(['detailed', 'summary'] as const)('目标第3圈死亡的%s保留真实已执行前缀，不提前授予完整完成资格', async outputMode => {
    const reference = await preparedSample({ dynamic: true, background: false });
    const actualDamage = run(reference.prepared, reference.request).damageRecords![0]!.postDefenseDamage;
    const { prepared, request } = await preparedSample({ dynamic: true, successor: true, targetHealth: actualDamage * 2.5, outputMode });
    const done = run(prepared, request);
    expect(done.summary).toMatchObject({ durationMs: 400, targetFinalHp: 0, stopReason: 'target_dead', skillUses: { releasedCount: 3, hitCount: 3, completedCount: 0 } });
    expect(done.automaticSkillSummary!.qualifications[0]).toMatchObject({ grantedCount: 0, consumedCount: 0, remainingCount: 0 });
    const assessment = assessAutomaticSkillResult(prepared.compileRequest, request, done, prepared.operationOrigins);
    expect(assessment.factsValid, assessment.issues.join(';')).toBe(true);
  });

  it.each([['detailed', 0], ['detailed', 1], ['summary', 0]] as const)('%s明细%s不能掩盖释放／命中或冻结进度篡改', async (outputMode, maximum) => {
    const { prepared, request } = await preparedSample({ dynamic: true, outputMode, maximum });
    const original = run(prepared, request);
    for (const field of ['releasedCount', 'hitCount'] as const) {
      const done = structuredClone(original);
      done.summary.skillUses![field] = 2;
      expect(assessAutomaticSkillResult(prepared.compileRequest, request, done, prepared.operationOrigins).factsValid).toBe(false);
    }
    for (const field of ['executionCount', 'executionIndex', 'firstExecutionOffsetMs', 'lastExecutionOffsetMs'] as const) {
      const done = structuredClone(original);
      const process = done.finalSnapshot.processInstances!.find(row => row.skillKey === 'sample_active')!;
      process.repeat![field]++;
      expect(assessAutomaticSkillResult(prepared.compileRequest, request, done, prepared.operationOrigins).factsValid).toBe(false);
    }
  });

  it.each(['released', 'hit', 'segment_time', 'segment_use', 'hit_ref', 'cross_segment_hit'] as const)('拒绝真实载荷篡改%s', async kind => {
    const { prepared, request } = await preparedSample();
    const done: DoneResult = structuredClone(run(prepared, request));
    if (kind === 'released') done.summary.skillUses!.releasedCount = 2;
    if (kind === 'hit') done.summary.skillUses!.hitCount = 2;
    const damage = done.damageRecords!.find(row => row.attackIndex === null)!;
    if (kind === 'segment_time') damage.timeMs = 1;
    if (kind === 'segment_use') damage.useRef = 'nonexistent';
    if (kind === 'hit_ref') damage.hitRef = null;
    if (kind === 'cross_segment_hit') damage.hitRef = done.damageRecords!.filter(row => row.attackIndex === null)[1]!.hitRef;
    expect(assessAutomaticSkillResult(prepared.compileRequest, request, done, prepared.operationOrigins).factsValid).toBe(false);
  });
});
