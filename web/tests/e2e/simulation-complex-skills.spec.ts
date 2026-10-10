import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { SimulationSkillPhase, SimulationSnapshot } from '../../src/types/simulationSnapshot';
import { simulationComplexSample, type ComplexSampleKind } from '../fixtures/simulationComplexSkills';
import { syncSimulationSkillSources } from '../fixtures/simulationSkillSources';
import { chooseSimulationEntity, chooseSimulationLevel } from '../fixtures/simulationSelection';
import { confirmSimulationConfiguration } from '../fixtures/simulationSnapshotRequests';
import { readMixedLiveSnapshot } from '../fixtures/simulationMixedLive';

const output = resolve('output/phase6c');
function wasmIdentity() {
  const bytes = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  const identity = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    status: process.env.SIMULATION_EXPECTED_WASM_SHA256 ? 'final' : 'candidate' };
  if (process.env.SIMULATION_EXPECTED_WASM_SHA256) expect(identity.sha256).toBe(process.env.SIMULATION_EXPECTED_WASM_SHA256.toLowerCase());
  return identity;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  const served = await page.evaluate(async () => {
    const bytes = await (await fetch('/src/engine/wasm/tinygo_engine_v2.wasm')).arrayBuffer();
    return { bytes: bytes.byteLength, sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('') };
  });
  const identity = wasmIdentity();
  expect(served).toEqual({ bytes: identity.bytes, sha256: identity.sha256 });
});

async function runConstruct(page: Page, kind: ComplexSampleKind,
  options: { phase?: Exclude<SimulationSkillPhase, 'INITIAL'>; atMs?: number; controls?: number[]; maximumRelease?: boolean;
    firstExecution?: 'IMMEDIATE' | 'AFTER_INTERVAL'; count?: number; miss?: boolean; durationMs?: number; zeroCharge?: boolean } = {}) {
  const result = await page.evaluate(async ({ kind, options }) => {
    const fixturePath = '/tests/fixtures/simulationComplexSkills.ts';
    const workerPath = '/tests/fixtures/simulationMixedWorker.ts';
    const { simulationComplexSample, complexAction, complexInputs } = await import(fixturePath) as typeof import('../fixtures/simulationComplexSkills');
    const { runMixedWorkerCase } = await import(workerPath) as typeof import('../fixtures/simulationMixedWorker');
    const snapshot = simulationComplexSample(kind);
    const step = snapshot.skillConfigurations[1]!.processes[0]!.steps[1]!;
    if (step.stepType === 'CHARGE' && options.maximumRelease !== undefined) step.detail.releaseAtMaximum = options.maximumRelease;
    if (step.stepType === 'CHARGE' && options.zeroCharge) {
      step.detail.minimumChargeValue = { kind: 'FIXED', value: 0 };
      snapshot.skillConfigurations[1]!.processes[0]!.steps = [step];
    }
    if (step.stepType === 'CHANNEL' && options.firstExecution) step.detail.firstExecution = options.firstExecution;
    if (step.stepType === 'MULTI_HIT' && options.count !== undefined) step.detail.repeatCountValue = { kind: 'FIXED', value: options.count };
    const initial = complexAction(snapshot, 'first', 0);
    if (options.miss) initial.hitPreset = 'MISS';
    const actions = [initial];
    if (options.phase) for (const [index, atMs] of (options.controls ?? [options.atMs!]).entries()) {
      actions.push(complexAction(snapshot, `control_${index}`, atMs, options.phase, 'first', index + 1));
    }
    const inputs = complexInputs(actions, options.durationMs ?? 1200);
    return { snapshot, result: await runMixedWorkerCase(snapshot, inputs) };
  }, { kind, options });
  const label = `construct-${kind.toLowerCase()}-${options.phase?.toLowerCase() ?? 'timed'}-${options.controls?.join('_') ?? options.atMs ?? options.firstExecution ?? options.count ?? 'default'}${options.miss ? '-miss' : ''}${options.maximumRelease ? '-maximum' : ''}${options.zeroCharge ? '-zero-charge' : ''}`;
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, `${label}-compile-run.json`), JSON.stringify({ wasm: wasmIdentity(), snapshot: result.snapshot,
    compileRequest: result.result.prepared.compileRequest, runRequest: result.result.runRequest, runVariants: result.result.runVariants }, null, 2));
  writeFileSync(resolve(output, `${label}-worker-proof.json`), JSON.stringify({ wasm: wasmIdentity(), ...result }, null, 2));
  return result.result;
}

test('独立构造：有限多段原生绝对时点、同一使用与冷却、连续占用及Worker100次', async ({ page }) => {
  const result = await runConstruct(page, 'MULTI_HIT');
  expect(result.baseline.skillUseRecords!.filter(row => row.kind === 'HIT').map(row => row.timeMs)).toEqual([100, 200, 300]);
  expect(result.baseline.summary.skillUses).toMatchObject({ startedCount: 1, releasedCount: 3, hitCount: 3, completedCount: 1,
    stepEnteredCount: 2, stepExecutedCount: 4, stepCompletedCount: 2 });
  expect(new Set(result.baseline.skillUseRecords!.map(row => row.useRef)).size).toBe(1);
  expect(result.baseline.summary.basicAttack!.initialActionReadyAtMs).toBe(300);
  expect(result.baseline.attackRecords![0]!.startAtMs).toBe(300);
  expect(result.baseline.finalSnapshot.processInstances!.find(process => process.skillKey === 'sample_active')!.repeat)
    .toMatchObject({ executionCount: 3, executionIndex: 3, intervalMs: 100, nextExecutionAtMs: null });
  expect(result.release.released).toBe(true);
});

test('独立构造：64段有界，首段即时；未命中仍释放每段且不造命中', async ({ page }) => {
  const result = await runConstruct(page, 'MULTI_HIT', { count: 64, durationMs: 6500, miss: true });
  expect(result.baseline.summary.skillUses).toMatchObject({ startedCount: 1, releasedCount: 64, hitCount: 0, completedCount: 1 });
  const executions = result.baseline.skillUseRecords!.filter(row => row.kind === 'STEP_EXECUTED' && row.stepKey === 'complex');
  expect(executions).toHaveLength(64);
  expect(executions.map(row => row.executionIndex)).toEqual(Array.from({ length: 64 }, (_, index) => index + 1));
  expect(executions[0]!.timeMs).toBe(100);
  expect(executions[63]!.timeMs).toBe(6400);
});

test('独立构造：真实技能命中只推进指定同角色来源，不泛化装备普攻命中', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const fixturePath = '/tests/fixtures/simulationComplexSkills.ts';
    const workerPath = '/tests/fixtures/simulationMixedWorker.ts';
    const { simulationComplexNaturalSample, complexAction, complexInputs } = await import(fixturePath) as typeof import('../fixtures/simulationComplexSkills');
    const { runMixedWorkerCase } = await import(workerPath) as typeof import('../fixtures/simulationMixedWorker');
    const snapshot = simulationComplexNaturalSample();
    return { snapshot, result: await runMixedWorkerCase(snapshot, complexInputs([complexAction(snapshot, 'first', 0)])) };
  });
  const linked = result.result.baseline.damageRecords!.filter(row => row.operationRef.startsWith('skills.sample_counter.'));
  expect(linked).toHaveLength(1);
  expect(linked[0]!).toMatchObject({ timeMs: 300, attackIndex: null, instructionKey: 'first' });
  const original = result.result.baseline.skillUseRecords!.find(row => row.kind === 'HIT' && row.timeMs === 300)!;
  expect(linked[0]!.useRef).toBe(original.useRef);
  expect(linked[0]!.hitRef).toBe(original.hitRef);
  const equipment = result.result.baseline.damageRecords!.filter(row => row.operationRef.startsWith('skills.item_1043_passive.'));
  expect(equipment).toHaveLength(result.result.baseline.summary.basicAttack!.hitCount);
  expect(equipment.every(row => row.attackIndex !== null && row.instructionKey === undefined)).toBe(true);
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, 'construct-selected-hit-source-compile-run.json'), JSON.stringify({ wasm: wasmIdentity(), snapshot: result.snapshot,
    compileRequest: result.result.prepared.compileRequest, runRequest: result.result.runRequest, runVariants: result.result.runVariants }, null, 2));
  writeFileSync(resolve(output, 'construct-selected-hit-source-worker-proof.json'), JSON.stringify(result, null, 2));
});

for (const firstExecution of ['IMMEDIATE', 'AFTER_INTERVAL'] as const) test(`独立构造：引导${firstExecution}首段，最后命中不提前结束全程占用`, async ({ page }) => {
  const result = await runConstruct(page, 'CHANNEL', { firstExecution });
  expect(result.baseline.skillUseRecords!.filter(row => row.kind === 'HIT').map(row => row.timeMs))
    .toEqual(firstExecution === 'IMMEDIATE' ? [100, 300, 500] : [300, 500, 700]);
  expect(result.baseline.summary.basicAttack!.initialActionReadyAtMs).toBe(700);
  expect(result.baseline.attackRecords![0]!.startAtMs).toBe(700);
  expect(result.baseline.summary.skillUses).toMatchObject({ startedCount: 1, releasedCount: 3, hitCount: 3, completedCount: 1 });
});

test('独立构造：蓄力过早拒绝、最短释放、后续旧控制拒绝，实际时长读值不补零', async ({ page }) => {
  const result = await runConstruct(page, 'CHARGE', { phase: 'CHARGE_RELEASE', controls: [299, 300, 400] });
  expect(result.baseline.summary.skillActions).toMatchObject({ plannedCount: 4, acceptedCount: 2, rejectedCount: 2 });
  expect(result.baseline.summary.skillUses).toMatchObject({ startedCount: 1, releasedCount: 1, hitCount: 1, completedCount: 1 });
  expect(result.baseline.summary.basicAttack!.initialActionReadyAtMs).toBe(300);
  expect(result.baseline.damageRecords!.find(row => row.instructionKey)!.rawAmount).toBe(300);
  expect(result.baseline.skillActionRecords!.filter(row => row.outcome === 'ACCEPTED').map(row => row.useRef))
    .toEqual([result.baseline.skillActionRecords![0]!.useRef, result.baseline.skillActionRecords![0]!.useRef]);
});

test('独立构造：作者明确允许0毫秒释放，同刻原首次后控制沿同一使用且真实0不等缺失', async ({ page }) => {
  const result = await runConstruct(page, 'CHARGE', { zeroCharge: true, phase: 'CHARGE_RELEASE', atMs: 0 });
  expect(result.baseline.summary.skillActions).toMatchObject({ plannedCount: 2, acceptedCount: 2, rejectedCount: 0 });
  expect(result.baseline.summary.skillUses).toMatchObject({ startedCount: 1, releasedCount: 1, hitCount: 1, completedCount: 1 });
  expect(result.baseline.skillUseRecords!.find(row => row.kind === 'HIT')!.timeMs).toBe(0);
  expect(result.baseline.damageRecords!.find(row => row.instructionKey)!.rawAmount).toBe(100);
  expect(result.baseline.attackRecords![0]!.startAtMs).toBe(0);
  expect(result.baseline.summary.basicAttack!.initialActionReadyAtMs).toBeNull();
});

test('独立构造：父首次普通拒绝时，合法父引用的控制到达后只拒绝，不造新使用', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const fixturePath = '/tests/fixtures/simulationComplexSkills.ts';
    const workerPath = '/tests/fixtures/simulationMixedWorker.ts';
    const { simulationComplexSample, complexAction, complexInputs } = await import(fixturePath) as typeof import('../fixtures/simulationComplexSkills');
    const { runMixedWorkerCase } = await import(workerPath) as typeof import('../fixtures/simulationMixedWorker');
    const snapshot = simulationComplexSample();
    const inputs = complexInputs([complexAction(snapshot, 'first', 0), complexAction(snapshot, 'refused_first', 50),
      complexAction(snapshot, 'refused_parent_cancel', 60, 'CANCEL', 'refused_first')]);
    return { snapshot, result: await runMixedWorkerCase(snapshot, inputs) };
  });
  expect(result.result.baseline.summary.skillActions).toMatchObject({ plannedCount: 3, acceptedCount: 1, rejectedCount: 2 });
  expect(result.result.baseline.skillActionRecords!.find(row => row.instructionKey === 'refused_parent_cancel'))
    .toMatchObject({ outcome: 'REJECTED', useRef: null, reason: 'parent_not_accepted', parentInstructionKey: 'refused_first' });
  expect(result.result.baseline.summary.skillUses!.startedCount).toBe(1);
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, 'construct-rejected-parent-compile-run.json'), JSON.stringify({ wasm: wasmIdentity(), snapshot: result.snapshot,
    compileRequest: result.result.prepared.compileRequest, runRequest: result.result.runRequest, runVariants: result.result.runVariants }, null, 2));
  writeFileSync(resolve(output, 'construct-rejected-parent-worker-proof.json'), JSON.stringify({ wasm: wasmIdentity(), ...result }, null, 2));
});

test('独立构造：未释放蓄力不自动满蓄力，超时失败没有释放或命中', async ({ page }) => {
  const result = await runConstruct(page, 'CHARGE');
  expect(result.baseline.summary.skillUses).toMatchObject({ startedCount: 1, releasedCount: 0, hitCount: 0, failedCount: 1 });
  expect(result.baseline.skillUseRecords!.find(row => row.kind === 'FAILED')!.reason).toBe('EVENT_ABORTED');
  expect(result.baseline.summary.basicAttack!.initialActionReadyAtMs).toBe(1100);
});

test('独立构造：作者明确最大释放才释放，同刻控制不得抢在到期之前', async ({ page }) => {
  const result = await runConstruct(page, 'CHARGE', { phase: 'CHARGE_RELEASE', controls: [1100], maximumRelease: true });
  expect(result.baseline.summary.skillActions).toMatchObject({ acceptedCount: 1, rejectedCount: 1 });
  expect(result.baseline.summary.skillUses).toMatchObject({ startedCount: 1, releasedCount: 1, hitCount: 1, completedCount: 1 });
  expect(result.baseline.damageRecords!.find(row => row.instructionKey)!.rawAmount).toBe(1100);
});

test('独立构造：原多段使用主动取消，实际提前解锁，旧段事件不再执行', async ({ page }) => {
  const result = await runConstruct(page, 'MULTI_HIT', { phase: 'CANCEL', atMs: 150 });
  expect(result.baseline.summary.skillUses).toMatchObject({ startedCount: 1, releasedCount: 1, hitCount: 1, failedCount: 1 });
  expect(result.baseline.skillUseRecords!.find(row => row.kind === 'FAILED')!.reason).toBe('ACTIVE_CANCELLED');
  expect(result.baseline.summary.basicAttack!.initialActionReadyAtMs).toBe(150);
  expect(result.baseline.attackRecords![0]!.startAtMs).toBe(150);
});

test('独立构造：重施在窗口内关联原使用，窗口边界先到期且不补释放', async ({ page }) => {
  const success = await runConstruct(page, 'RECAST', { phase: 'RECAST', atMs: 599 });
  expect(success.baseline.summary.skillUses).toMatchObject({ startedCount: 1, completedCount: 1, releasedCount: 1, hitCount: 1 });
  const expired = await runConstruct(page, 'RECAST', { phase: 'RECAST', atMs: 600 });
  expect(expired.baseline.summary.skillActions).toMatchObject({ acceptedCount: 1, rejectedCount: 1 });
  expect(expired.baseline.summary.skillUses).toMatchObject({ startedCount: 1, failedCount: 1, releasedCount: 0, hitCount: 0 });
});

for (const budget of [{ maxCommandsPerEvent: 1 }, { maxEvents: 1 }, { maxProcessInstances: 1 }]) test(`独立构造：预算${JSON.stringify(budget)}保持已提交前缀与完整过程历史`, async ({ page }) => {
  const result = await page.evaluate(async budget => {
    const fixturePath = '/tests/fixtures/simulationComplexSkills.ts';
    const workerPath = '/tests/fixtures/simulationMixedWorker.ts';
    const adapterPath = '/src/engine/simulationAdapter.ts';
    const clientPath = '/src/engine/genericEngineClient.ts';
    const requestPath = '/src/engine/skillActionRequest.ts';
    const resultPath = '/src/engine/skillActionResult.ts';
    const { simulationComplexSample, complexAction, complexInputs } = await import(fixturePath) as typeof import('../fixtures/simulationComplexSkills');
    const { prepareSimulation, inspectSimulationSnapshot } = await import(adapterPath) as typeof import('../../src/engine/simulationAdapter');
    const { GenericEngineClient } = await import(clientPath) as typeof import('../../src/engine/genericEngineClient');
    const { skillActionRequest } = await import(requestPath) as typeof import('../../src/engine/skillActionRequest');
    const { assessSkillActionResult } = await import(resultPath) as typeof import('../../src/engine/skillActionResult');
    const snapshot = simulationComplexSample();
    const preflightPath = '/src/engine/skillFormulaPreflight.ts', proofPath = '/src/engine/approvedFormulaValues.ts';
    const { preflightSkillFormulas } = await import(preflightPath) as typeof import('../../src/engine/skillFormulaPreflight');
    const { validateConsumedFormulaValues, validateApprovedFormulaValues } = await import(proofPath) as typeof import('../../src/engine/approvedFormulaValues');
    const client = new GenericEngineClient();
    const formulaPreflight = await preflightSkillFormulas(snapshot, client);
    const attributes = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) attributes[row.side][row.attribute.attributeKey] = 0;
    const prepared = await prepareSimulation(snapshot, attributes, { source: 1000, target: 5000 });
    let sessionId: string | null = null;
    try {
      const compiled = await client.compile(prepared.compileRequest);
      if (!compiled.ok || !compiled.sessionId) throw new Error('实际编译失败');
      sessionId = compiled.sessionId;
      validateConsumedFormulaValues(prepared.approvedFormulaValues, prepared.compileRequest.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
      validateApprovedFormulaValues(prepared.compileRequest.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
      const run = await skillActionRequest(prepared, snapshot, complexInputs([complexAction(snapshot, 'first', 0)]), sessionId);
      const request = { ...run.runRequest, safetyBudget: { ...run.runRequest.safetyBudget, ...budget } };
      const baseline = await client.run(request);
      const assessment = assessSkillActionResult(prepared.compileRequest, request, baseline, prepared.operationOrigins);
      if (!assessment.factsValid) throw new Error(JSON.stringify({ assessment, summary: baseline.summary, processInstances: baseline.finalSnapshot.processInstances }));
      const iterations = 100;
      for (let iteration = 1; iteration < iterations; iteration++) {
        if (JSON.stringify(await client.run(request)) !== JSON.stringify(baseline)) throw new Error('预算运行无法精确恢复初态');
      }
      const runVariants = [...[0, 1].map(maximum => ({ ...request, recordBudget: { maxAttackRecords: maximum, maxDamageRecords: maximum,
        maxMechanicRecords: maximum, maxSkillActionRecords: maximum, maxSkillUseRecords: maximum, maxHealingRecords: maximum } })),
      { ...request, sampling: { ...request.sampling, disabled: true } }];
      for (const variant of runVariants) {
        const done = await client.run(variant);
        if (!assessSkillActionResult(prepared.compileRequest, variant, done, prepared.operationOrigins).factsValid
          || JSON.stringify(done.summary) !== JSON.stringify(baseline.summary)
          || JSON.stringify(done.finalSnapshot) !== JSON.stringify(baseline.finalSnapshot)) throw new Error('预算截断改变已提交事实');
      }
      const release = await client.release(sessionId, prepared.compileRequest.rulesHash); sessionId = null;
      return { snapshot, formulaPreflight, compileRequest: prepared.compileRequest, runRequest: request, runVariants, baseline, assessment, release, iterations };
    } finally {
      if (sessionId && client.hasLiveWorker) await client.release(sessionId, prepared.compileRequest.rulesHash);
      client.terminate();
    }
  }, budget);
  expect(result.assessment.factsValid).toBe(true);
  expect(result.baseline.summary.execution!.complete).toBe(false);
  expect(result.baseline.summary.execution!.incompleteReason).toBe('budget_exceeded');
  expect(result.release.released).toBe(true);
  mkdirSync(output, { recursive: true });
  const label = `construct-budget-${Object.keys(budget)[0]}`;
  writeFileSync(resolve(output, `${label}-compile-run.json`), JSON.stringify({ wasm: wasmIdentity(), ...result }, null, 2));
  writeFileSync(resolve(output, `${label}-worker-proof.json`), JSON.stringify({ wasm: wasmIdentity(), ...result }, null, 2));
});

test('独立页面：真实控制选择、时刻留空、父关联、快照阶段重读、实际Worker结果和导出', async ({ page }) => {
  test.setTimeout(60000);
  const sample = simulationComplexSample('CHARGE');
  let reads = 0;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('damage-viewer.web.api-base-url', 'http://127.0.0.1:19607');
    localStorage.setItem('damage-viewer.web.admin-token', 'independent-readonly-fixture');
  });
  await page.route('**/api/**', async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    const url = new URL(request.url());
    const reply = (data: unknown) => route.fulfill({ json: data });
    if (url.pathname === '/api/games') return reply([{ gameId: 'demo', gameName: '独立复杂过程页面', representativeImageKey: null }]);
    const resource = url.pathname.replace(/^\/api\/admin\/games\/[^/]+\//, '');
    if (resource === 'simulation-snapshot') {
      expect(request.method()).toBe('POST'); reads++;
      const snapshot = structuredClone(sample); snapshot.selection = request.postDataJSON(); snapshot.snapshotDigest = 'c'.repeat(64);
      return reply(syncSimulationSkillSources(snapshot));
    }
    expect(request.method(), '不写任何业务数据').toBe('GET');
    if (resource === 'level-config') return reply(sample.catalogs.levelConfig);
    if (resource === 'characters') return reply({ items: [sample.source.character, sample.target.character], total: 2 });
    if (resource === 'equipment' || resource === 'build-systems') return reply({ items: [], total: 0 });
    if (resource === 'attributes') return reply({ items: sample.catalogs.attributes, total: sample.catalogs.attributes.length });
    if (resource === 'character-skill-relations') {
      const actor = url.searchParams.get('characterKey') === sample.source.character.characterKey ? sample.source : sample.target;
      return reply({ items: actor.attachedSkills, total: actor.attachedSkills.length });
    }
    if (/^skills\/[^/]+$/.test(resource)) return reply(sample.skillConfigurations.find(configuration => configuration.skill.skillKey === resource.split('/')[1])!.skill);
    if (resource.endsWith('/representative-image')) return reply({ image: null });
    throw new Error(`未预期只读请求${resource}`);
  });
  await page.goto('/?phase6c-ui=1#/simulation/basic-attack');
  await chooseSimulationEntity(page, '攻击方角色', 'actor_a'); await chooseSimulationLevel(page, '攻击方等级', 1);
  await chooseSimulationEntity(page, '目标角色', 'actor_b'); await chooseSimulationLevel(page, '目标等级', 1);
  await page.getByRole('checkbox', { name: '指定技能行动计划', exact: true }).locator('xpath=ancestor::label').click();
  await chooseSimulationEntity(page, '攻击方主动技能候选', 'sample_active');
  await page.getByRole('button', { name: '添加首次尝试', exact: true }).click();
  await page.getByRole('button', { name: '添加首次尝试', exact: true }).click();
  const read = page.getByRole('button', { name: '读取场景快照', exact: true });
  await read.click(); await expect(read).toBeEnabled();
  await page.locator('.arco-select[aria-label="技能阶段 skill_instruction_2"]').click();
  await page.getByRole('option', { name: '蓄力释放', exact: true }).click();
  await expect(page.getByLabel('技能尝试时刻 skill_instruction_2', { exact: true })).toHaveValue('');
  await page.getByLabel('技能尝试时刻 skill_instruction_2', { exact: true }).fill('400');
  await page.locator('.arco-select[aria-label="关联首次指令 skill_instruction_2"]').click();
  await page.getByRole('option', { name: /skill_instruction_1/ }).click();
  await page.locator('.arco-select[aria-label="技能命中预设 skill_instruction_1"]').click();
  await page.getByRole('option', { name: '释放后对唯一目标尝试命中', exact: true }).click();
  await read.click(); await expect(read).toBeEnabled(); await confirmSimulationConfiguration(page);
  const before = reads;
  await page.getByLabel('技能尝试时刻 skill_instruction_2', { exact: true }).fill('450');
  expect(reads).toBe(before);
  await page.getByRole('button', { name: '将缺失属性填写为0', exact: true }).click();
  await page.getByLabel('攻击方初始当前生命', { exact: true }).fill('1000');
  await page.getByLabel('目标初始当前生命', { exact: true }).fill('5000');
  await page.getByLabel('观察时长（毫秒）', { exact: true }).fill('1200');
  await page.getByRole('button', { name: '执行指定技能计划', exact: true }).click();
  await expect(page.getByText('指定技能计划观察完成，会话已释放', { exact: false })).toBeVisible();
  expect(reads).toBe(before + 1);
  await expect(page.getByRole('heading', { name: '指定主动技能观察结果', exact: true })).toBeVisible();
  await expect(page.getByText('已提交段号', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载主动冻结档案', exact: true }).click();
  mkdirSync(output, { recursive: true });
  await (await download).saveAs(resolve(output, 'construct-page-archive.json'));
  await page.screenshot({ path: resolve(output, 'construct-control-page.png'), fullPage: true });
  expect(errors).toEqual([]);
});

type LiveCase = { label: string; hero: string; skills: string[]; equipmentKeys?: string[]; naturalSkills?: string[]; phaseKinds: Record<string, SimulationSkillPhase[]>;
  controls: Array<{ skillKey: string; phaseKind: Exclude<SimulationSkillPhase, 'INITIAL'>; atMs: number }>; durationMs: number;
  expectedHitCount?: number; expectedFailureReason?: string };
const liveCases: LiveCase[] = process.env.SIMULATION_COMPLEX_CASES ? JSON.parse(process.env.SIMULATION_COMPLEX_CASES)
  : [{ label: 'vi-q-charge', hero: 'vi', skills: ['vi_q'], phaseKinds: { vi_q: ['INITIAL', 'CHARGE_RELEASE', 'CANCEL'] },
    controls: [{ skillKey: 'vi_q', phaseKind: 'CHARGE_RELEASE', atMs: 625 }], durationMs: 7000 }];

for (const live of liveCases) test(`真实只读组合${live.label}：完整作者、Worker100次、记录与采样一致`, async ({ page, request }) => {
  test.skip(process.env.SIMULATION_LIVE_API !== '1', '真实对象仅由主负责人核定并保存，未启用不算真实验收');
  const snapshot = await readMixedLiveSnapshot(request, process.env.SIMULATION_LIVE_API_BASE_URL || process.env.SIMULATION_API_BASE || 'http://127.0.0.1:8080', live.hero, live.skills,
    live.equipmentKeys ?? [], { phaseKinds: live.phaseKinds, naturalSkills: live.naturalSkills });
  const result = await page.evaluate(async ({ snapshot, live }) => {
    const workerPath = '/tests/fixtures/simulationMixedWorker.ts';
    const adapterPath = '/src/engine/simulationAdapter.ts';
    const costPath = '/src/engine/simulationActiveSkills.ts';
    const { runMixedWorkerCase } = await import(workerPath) as typeof import('../fixtures/simulationMixedWorker');
    const { inspectSimulationSnapshot } = await import(adapterPath) as typeof import('../../src/engine/simulationAdapter');
    const { simulationCastCostCandidates } = await import(costPath) as typeof import('../../src/engine/simulationActiveSkills');
    const clientPath = '/src/engine/genericEngineClient.ts', preflightPath = '/src/engine/skillFormulaPreflight.ts';
    const { GenericEngineClient } = await import(clientPath) as typeof import('../../src/engine/genericEngineClient');
    const { preflightSkillFormulas } = await import(preflightPath) as typeof import('../../src/engine/skillFormulaPreflight');
    const inspectionPreflight = await preflightSkillFormulas(snapshot, new GenericEngineClient());
    const costs = simulationCastCostCandidates(snapshot);
    const attributes = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    for (const row of inspectSimulationSnapshot(snapshot, costs).requirements) if (row.storedValue === undefined) {
      const key = row.attribute.attributeKey;
      if (['ability_power', 'bonus_attack_damage', 'ability_haste', 'critical_strike_chance', 'armor_pen_flat', 'magic_pen_flat'].includes(key)
        || key.endsWith('_percent')) attributes[row.side][key] = 0;
      else throw new Error(`本次真实场景缺少明确输入${row.side}.${key}，不能猜固有值`);
    }
    const actions = snapshot.selection.plannedSkills.map((plan, index) => ({ origin: plan.origin, skillKey: plan.skillKey, skillLevel: plan.skillLevel,
      instructionKey: `real_initial_${index}`, atMs: 0, sortOrder: index, phaseKind: 'INITIAL' as SimulationSkillPhase, parentInstructionKey: null as string | null,
      targetSide: 'target' as const, hitPreset: 'TARGET_HIT' as 'TARGET_HIT' | null }));
    for (const [index, control] of live.controls.entries()) {
      const parent = actions.find(action => action.skillKey === control.skillKey)!;
      if (!parent) throw new Error('真实控制没有同源原首次');
      actions.push({ ...parent, instructionKey: `real_control_${index}`, atMs: control.atMs, sortOrder: index + actions.length,
        phaseKind: control.phaseKind, parentInstructionKey: parent.instructionKey, hitPreset: null });
    }
    return { ...await runMixedWorkerCase(snapshot, { actions, durationMs: live.durationMs, recordTimeSeries: true, attackSpeedInputMax: 10,
      maxSkillActionRecords: 64, maxSkillUseRecords: 512, maxHealingRecords: 256 }, 100, costs, attributes,
    { source: snapshot.source.selectedLevelValues.hp!, target: snapshot.target.selectedLevelValues.hp! }), inspectionPreflight };
  }, { snapshot, live });
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, `real-${live.label}-compile-run.json`), JSON.stringify({ wasm: wasmIdentity(), snapshot,
    compileRequest: result.prepared.compileRequest, runRequest: result.runRequest, runVariants: result.runVariants }, null, 2));
  writeFileSync(resolve(output, `real-${live.label}-worker-proof.json`), JSON.stringify({ wasm: wasmIdentity(), snapshot, result }, null, 2));
  expect(result.iterations).toBe(100);
  expect(result.release.released).toBe(true);
  expect(result.baseline.summary.skillUses!.startedCount).toBeGreaterThan(0);
  if (live.expectedHitCount === undefined) expect(result.baseline.summary.skillUses!.hitCount).toBeGreaterThan(0);
  else expect(result.baseline.summary.skillUses!.hitCount).toBe(live.expectedHitCount);
  if (live.expectedFailureReason) {
    expect(result.baseline.finalSnapshot.processInstances).toContainEqual(expect.objectContaining({
      skillKey: live.skills[0], status: 'failed', failureReason: live.expectedFailureReason
    }));
    expect(result.baseline.damageRecords!.filter(row => live.skills.some(skillKey => row.operationRef.startsWith(`skills.${skillKey}.`)))).toEqual([]);
  }
});
