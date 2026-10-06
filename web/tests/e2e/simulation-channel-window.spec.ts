import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const output = resolve('output/phase6c/channel-window');

for (const scenario of [
  { name: 'custom-window', duration: 20, count: 4, first: 2, last: 13, firstExecution: 'CUSTOM_WINDOW', times: [102, 106, 109, 113] },
  { name: 'custom-one-ms', duration: 1, count: 2, first: 0, last: 1, firstExecution: 'CUSTOM_WINDOW', times: [100, 101] },
  { name: 'custom-single', duration: 20, count: 1, first: 5, last: 5, firstExecution: 'CUSTOM_WINDOW', times: [105] },
  { name: 'legacy-immediate-rounding', duration: 15, count: 4, first: 0, last: 11, firstExecution: 'IMMEDIATE', times: [100, 104, 108, 111] },
  { name: 'legacy-after-rounding', duration: 15, count: 4, first: 4, last: 15, firstExecution: 'AFTER_INTERVAL', times: [104, 108, 111, 115] }
] as const) test(`最终通用构造${scenario.name}：实际Worker100次、冻结进度、完整占用及记录变体`, async ({ page }) => {
  await page.goto('/');
  const wasmBytes = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  const wasm = { bytes: wasmBytes.length, sha256: createHash('sha256').update(wasmBytes).digest('hex'),
    status: process.env.SIMULATION_EXPECTED_WASM_SHA256 ? 'final' : 'candidate' };
  expect(wasm.bytes).toBe(1296076);
  expect(wasm.sha256).toBe(process.env.SIMULATION_EXPECTED_WASM_SHA256?.toLowerCase()
    ?? '2673db53f6b21d4ac6b95c77f45859e76b479cdc465e142c5c62c0b99652bc6c');
  const result = await page.evaluate(async scenario => {
    const bytes = await (await fetch('/src/engine/wasm/tinygo_engine_v2.wasm')).arrayBuffer();
    const served = { bytes: bytes.byteLength, sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('') };
    const fixtures = '/tests/fixtures/simulationComplexSkills.ts';
    const worker = '/tests/fixtures/simulationMixedWorker.ts';
    const { simulationComplexSample, complexAction, complexInputs } = await import(fixtures) as typeof import('../fixtures/simulationComplexSkills');
    const { runMixedWorkerCase } = await import(worker) as typeof import('../fixtures/simulationMixedWorker');
    const snapshot = simulationComplexSample('CHANNEL');
    const channel = snapshot.skillConfigurations[1]!.processes[0]!.steps[1]!;
    if (channel.stepType !== 'CHANNEL') throw new Error('样例步骤不符');
    channel.detail = { firstExecution: scenario.firstExecution, durationValue: { kind: 'FIXED', value: scenario.duration },
      executionCountValue: { kind: 'FIXED', value: scenario.count }, ...(scenario.firstExecution === 'CUSTOM_WINDOW' ? {
        firstExecutionOffsetValue: { kind: 'FIXED', value: scenario.first }, lastExecutionOffsetValue: { kind: 'FIXED', value: scenario.last }
      } : {}) };
    const inputs = complexInputs([complexAction(snapshot, 'first', 0)], 1200);
    const inFlight = complexInputs(inputs.actions, 100 + scenario.last);
    const run = await runMixedWorkerCase(snapshot, inputs, 100, [], undefined, undefined, [inFlight]);
    return { snapshot, run, served };
  }, scenario);
  expect(result.served).toEqual({ bytes: wasm.bytes, sha256: wasm.sha256 });
  expect(result.run.iterations).toBe(100);
  expect(result.run.release.ok).toBe(true);
  expect(result.run.baseline.skillUseRecords!.filter(row => row.kind === 'HIT').map(row => row.timeMs)).toEqual(scenario.times);
  expect(result.run.baseline.summary.basicAttack!.initialActionReadyAtMs).toBe(100 + scenario.duration);
  expect(result.run.baseline.attackRecords![0]!.startAtMs).toBe(100 + scenario.duration);
  const processSnapshot = result.run.baseline.finalSnapshot.processInstances!.find(instance => instance.skillKey === 'sample_active')!;
  expect(processSnapshot.repeat).toMatchObject({ executionCount: scenario.count, executionIndex: scenario.count, intervalMs: 0,
    firstExecutionOffsetMs: scenario.first, lastExecutionOffsetMs: scenario.last, nextExecutionAtMs: null });
  expect(processSnapshot.stepCompletedAtMs).toBe(100 + scenario.duration);
  expect(processSnapshot.actionOccupancies[1]).toMatchObject({ startedAtMs: 100, expectedEndAtMs: 100 + scenario.duration, finishedAtMs: 100 + scenario.duration });
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, `${scenario.name}-compile-run.json`), JSON.stringify({ wasm, snapshot: result.snapshot,
    compileRequest: result.run.prepared.compileRequest, runRequest: result.run.runRequest, runVariants: result.run.runVariants }, null, 2));
  writeFileSync(resolve(output, `${scenario.name}-worker-proof.json`), JSON.stringify({ wasm, ...result }, null, 2));
});

for (const failureReason of ['ACTIVE_CANCELLED', 'EVENT_ABORTED'] as const) test(`最终通用构造${failureReason}：失败尾部本技能冷却3000，不拆保存或补自动释放`, async ({ page }) => {
  await page.goto('/');
  const bytes = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  const wasm = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    status: process.env.SIMULATION_EXPECTED_WASM_SHA256 ? 'final' : 'candidate' };
  expect(wasm.sha256).toBe(process.env.SIMULATION_EXPECTED_WASM_SHA256?.toLowerCase()
    ?? '2673db53f6b21d4ac6b95c77f45859e76b479cdc465e142c5c62c0b99652bc6c');
  const result = await page.evaluate(async failureReason => {
    const fixtures = '/tests/fixtures/simulationComplexSkills.ts';
    const worker = '/tests/fixtures/simulationMixedWorker.ts';
    const { simulationComplexSample, complexAction, complexInputs } = await import(fixtures) as typeof import('../fixtures/simulationComplexSkills');
    const { runMixedWorkerCase } = await import(worker) as typeof import('../fixtures/simulationMixedWorker');
    const snapshot = simulationComplexSample('CHARGE');
    const configuration = snapshot.skillConfigurations[1]!;
    const process = configuration.processes[0]!;
    process.steps[0] = { ...process.steps[0]!, stepType: 'IMMEDIATE', detail: {} };
    const charge = process.steps[1]!;
    if (charge.stepType !== 'CHARGE') throw new Error('样例步骤不符');
    charge.detail = { minimumChargeValue: { kind: 'FIXED', value: 0 }, maximumChargeValue: { kind: 'FIXED', value: 6000 }, releaseAtMaximum: false };
    process.cooldown = { durationValue: { kind: 'FIXED', value: 8000 }, startMoment: { momentType: 'STEP_EXECUTION', stepKey: charge.stepKey, failureReason: null } };
    configuration.effects.push({ ...structuredClone(configuration.effects[0]!), effectKey: 'cancel_cooldown', results: [{
      resultKey: 'cancel_cooldown', name: '失败剩余冷却', resultType: 'COOLDOWN_CHANGE', target: 'SOURCE', description: null, sortOrder: 0,
      lifecycleBehavior: null, spellShieldBlockScope: null, valueRule: { value: { kind: 'FIXED', value: 3000 }, fixedMultiplier: 1, fixedMinValue: null, fixedMaxValue: null },
      detail: { operation: 'SET_REMAINING', affectedSkillScope: { mode: 'SKILLS', skillKeys: [configuration.skill.skillKey], skillCategoryKeys: [] } }
    }] });
    for (const reason of ['ACTIVE_CANCELLED', 'EVENT_ABORTED'] as const) process.effectBindings.push({ bindingKey: `failed_${reason.toLowerCase()}`,
      effectKey: 'cancel_cooldown', moment: { momentType: 'PROCESS_FAILURE', stepKey: null, failureReason: reason }, sortOrder: process.effectBindings.length });
    const failedAt = failureReason === 'ACTIVE_CANCELLED' ? 400 : 6000;
    const readyAt = failedAt + 3000;
    const actions = [complexAction(snapshot, 'first', 0),
      ...(failureReason === 'ACTIVE_CANCELLED' ? [complexAction(snapshot, 'cancel', failedAt, 'CANCEL', 'first')] : []),
      complexAction(snapshot, 'too_early', readyAt - 1), complexAction(snapshot, 'next', readyAt),
      complexAction(snapshot, 'release_next', readyAt, 'CHARGE_RELEASE', 'next', 1)];
    const run = await runMixedWorkerCase(snapshot, complexInputs(actions, readyAt + 100), 100);
    return { snapshot, run, failedAt, readyAt };
  }, failureReason);
  expect(result.run.iterations).toBe(100);
  expect(result.run.release.ok).toBe(true);
  expect(result.run.baseline.skillActionRecords!.find(row => row.instructionKey === 'too_early')).toMatchObject({ outcome: 'REJECTED', reason: 'cooldown_not_ready' });
  expect(result.run.baseline.skillActionRecords!.find(row => row.instructionKey === 'next')).toMatchObject({ outcome: 'ACCEPTED', actualAtMs: result.readyAt });
  expect(result.run.baseline.summary.skillUses).toMatchObject({ startedCount: 2, releasedCount: 1, hitCount: 1, completedCount: 1, failedCount: 1 });
  expect(result.run.baseline.finalSnapshot.processInstances!.find(instance => instance.startedAtMs === 0)).toMatchObject({
    failureReason, finishedAtMs: result.failedAt, cooldownStarted: false });
  mkdirSync(output, { recursive: true });
  const name = `failure-cooldown-${failureReason.toLowerCase()}`;
  writeFileSync(resolve(output, `${name}-compile-run.json`), JSON.stringify({ wasm, snapshot: result.snapshot,
    compileRequest: result.run.prepared.compileRequest, runRequest: result.run.runRequest, runVariants: result.run.runVariants }, null, 2));
  writeFileSync(resolve(output, `${name}-worker-proof.json`), JSON.stringify({ wasm, ...result }, null, 2));
});
