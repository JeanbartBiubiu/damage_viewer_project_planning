import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { fulfillAuthSession } from '../fixtures/authSession';
import { parseMechanismCase } from '../mechanisms/mechanismCase';
import type { DamageRecord, ProcessInstanceSnapshot } from '../../src/types/genericEngine';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';

const keys = ['before', 'at', 'miss', 'parallel'] as const;
const definitions = keys.map(key => {
  const file = resolve(`tests/mechanisms/cases/skill_hit_passive_delay_${key}.json`);
  return { key, definition: parseMechanismCase(readFileSync(file), file) };
});

type WorkerObservation = { type: string; rulesHash: string | null };
declare global { interface Window { passiveDelayMessages: WorkerObservation[] } }
const pageErrors = new WeakMap<Page, string[]>();

async function archive(testInfo: TestInfo, name: string, value: unknown) {
  const text = JSON.stringify(value, null, 2);
  expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  expect(text).not.toMatch(/"(?:authorization|grant|cookie|csrf|privateKey)"\s*:/i);
  const file = testInfo.outputPath(name);
  writeFileSync(file, text + '\n');
  await testInfo.attach(name, { path: file, contentType: 'application/json' });
}

function closeAmount(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(expected)));
}

function expectedNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`固定期望缺少有限数值：${path}`);
  return value;
}

function originalProcessFor(passive: ProcessInstanceSnapshot, processes: ProcessInstanceSnapshot[]) {
  const origin = passive.passiveOrigin;
  expect(origin).toBeDefined();
  if (!origin) throw new Error('被动实例缺少原始使用身份');
  const parents = processes.filter(process => process.owner === origin.useSource && process.useKey === origin.useKey
    && process.skillKey === origin.useSkillKey && process.passiveOrigin === undefined);
  expect(parents).toHaveLength(1);
  const hits = parents[0]!.skillHitStages?.filter(stage => stage.contact && stage.hitSequence === origin.hitSequence
    && stage.hitOccurrenceId === origin.hitOccurrenceId);
  expect(hits).toHaveLength(1);
  const hit = hits![0]!;
  expect(hit).toMatchObject({ released: true, contact: true, completed: true, hitBlocked: 0 });
  expect(passive.startedAtMs).toBe(hit.timeMs);
  expect(passive.target).toBe(parents[0]!.target);
  expect(passive.useKey).not.toBe(origin.useKey);
  expect(Object.keys(origin).sort()).toEqual(['useSource', 'useKey', 'useSkillKey', 'hitAbilityRef', 'hitSequence', 'hitOccurrenceId'].sort());
  return { parent: parents[0]!, hit, origin };
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const scope = window;
    scope.passiveDelayMessages = [];
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...options) {
      if (message && typeof message === 'object' && ['compile', 'run', 'release'].includes(message.type)) {
        scope.passiveDelayMessages.push({ type: message.type, rulesHash: message.request?.rulesHash ?? message.expectedRulesHash ?? null });
      }
      return Reflect.apply(original, this, [message, ...options]);
    };
  });
  await page.route('**/api/**', async route => {
    if (await fulfillAuthSession(route)) return;
    if (route.request().method() !== 'GET') throw new Error('合成浏览器验收不得写业务数据');
    if (new URL(route.request().url()).pathname === '/api/games') await route.fulfill({ json: [] });
    else await route.fulfill({ json: { items: [], total: 0 } });
  });
  await page.goto('/#/simulation/combat-analysis');
});

for (const { key, definition } of definitions) test(`被动延迟：${definition.title}，正式Worker与有限因果`, async ({ page }, testInfo) => {
  const errors = pageErrors.get(page);
  expect(errors).toBeDefined();
  const workers: string[] = [];
  page.on('worker', worker => workers.push(worker.url()));
  const snapshot = definition.buildSnapshot();
  const scenario = definition.scenario;
  expect(scenario.mode).toBe('skill_action');
  expect(scenario.actions?.length).toBeGreaterThan(0);
  const localBytes = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  const declared = { bytes: WASM_IDENTITY.bytes, sha256: WASM_IDENTITY.sha256 };
  expect({ bytes: localBytes.length, sha256: createHash('sha256').update(localBytes).digest('hex') }).toEqual(declared);
  expect(WASM_IDENTITY.authorizationRequired).toBe(true);
  const observed = await page.evaluate(async ({ snapshot, scenario }) => {
    const wasmResponse = await fetch('/src/engine/wasm/tinygo_engine_v2.wasm');
    if (!wasmResponse.ok) throw new Error('浏览器未读取正式Wasm');
    const bytes = await wasmResponse.arrayBuffer();
    const wasm = { bytes: bytes.byteLength, sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map(value => value.toString(16).padStart(2, '0')).join('') };
    const authPath = '/src/services/authClient.ts';
    const { restoreSession } = await import(authPath) as typeof import('../../src/services/authClient');
    await restoreSession(location.origin);
    const workerPath = '/tests/fixtures/simulationMixedWorker.ts';
    const { runMixedWorkerCase } = await import(workerPath) as typeof import('../fixtures/simulationMixedWorker');
    const result = await runMixedWorkerCase(snapshot, {
      actions: scenario.actions!, durationMs: scenario.durationMs, recordTimeSeries: false,
      attackSpeedInputMax: scenario.attackSpeedInputMax ?? 10, maxSkillActionRecords: 100, maxSkillUseRecords: 100, maxHealingRecords: 100
    }, 2, [], scenario.attributeInputs, scenario.initialHealth);
    return { wasm, result, workerMessages: window.passiveDelayMessages };
  }, { snapshot, scenario });
  expect(observed.wasm).toEqual(declared);
  expect(workers.length).toBeGreaterThan(0);
  expect(workers.some(url => url.includes('genericEngineWorker'))).toBe(true);
  const result = observed.result, done = result.baseline;
  expect(result.compile.ok).toBe(true);
  expect(result.iterations).toBe(2);
  expect(result.release.released).toBe(true);
  expect(result.variants).toHaveLength(3);
  expect(observed.workerMessages.filter(row => row.type === 'run')).toHaveLength(7);
  expect(observed.workerMessages.some(row => row.type === 'release' && row.rulesHash === result.prepared.compileRequest.rulesHash)).toBe(true);
  expect(done.summary.execution).toMatchObject({ complete: true, budgetCause: null });
  expect(done.summary.skillActions).toMatchObject({ plannedCount: scenario.actions!.length, acceptedCount: scenario.actions!.length, rejectedCount: 0 });
  expect(done.summary.skillUses).toMatchObject({ startedCount: scenario.actions!.length, hitCount: key === 'miss' ? 0 : scenario.actions!.length });
  expect(done.skillActionRecords!.map(row => ({ timeMs: row.actualAtMs, skillKey: row.skillKey }))).toEqual(definition.expected.skillStarts);
  const summary = definition.expected.summary;
  if (!summary) throw new Error('固定机制未声明独立累计期望');
  expect(done.summary.basicAttack).toMatchObject({ startedCount: summary.basicAttackStarted, hitCount: summary.basicAttackHits });
  closeAmount(done.summary.sourceDamageDealt, expectedNumber(summary.sourceDamageDealt, 'summary.sourceDamageDealt'));
  closeAmount(done.summary.sourceFinalHp, expectedNumber(summary.sourceFinalHp, 'summary.sourceFinalHp'));
  closeAmount(done.summary.targetFinalHp, expectedNumber(summary.targetFinalHp, 'summary.targetFinalHp'));
  const damage = done.damageRecords ?? [];
  expect(damage).toHaveLength(definition.expected.damage!.length);
  const originOf = (row: DamageRecord) => {
    const matches = result.prepared.operationOrigins.filter(origin => origin.operationRef === row.operationRef && origin.abilityRef === row.abilityRef);
    expect(matches).toHaveLength(1);
    return matches[0]!;
  };
  for (const [index, expected] of definition.expected.damage!.entries()) {
    const row = damage[index]!, origin = originOf(row);
    expect(row).toMatchObject({ timeMs: expected.timeMs, damageType: expected.damageType, source: 'source', target: 'target' });
    expect(origin).toMatchObject({ skillKey: expected.skillKey, effectKey: expected.effectKey, resultKey: expected.resultKey });
    for (const field of ['rawAmount', 'postDefenseDamage', 'shieldAbsorbed', 'actualHpLoss'] as const) closeAmount(row[field], expectedNumber(expected[field], `damage[${index}].${field}`));
  }
  expect(done.attackRecords!.map(row => row.startAtMs)).toEqual(definition.expected.attackStarts);
  const processes = done.finalSnapshot.processInstances!;
  const passives = processes.filter(process => process.passiveOrigin !== undefined).sort((a, b) => a.startedAtMs - b.startedAtMs);
  expect(passives).toHaveLength(key === 'miss' ? 0 : scenario.actions!.length);
  for (const passive of passives) {
    const { parent, hit, origin } = originalProcessFor(passive, processes);
    const bindings = result.prepared.compileRequest.rules.skillActionBindings!.filter(binding => binding.source === parent.owner
      && binding.providerRef === parent.providerRef && binding.skillKey === parent.skillKey);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]!.hitBindings.filter(binding => binding.hitBindingKey === hit.hitBindingKey
      && binding.hitAbilityRef === origin.hitAbilityRef)).toHaveLength(1);
    expect(passive).toMatchObject({ skillKey: 'lab_deferred_strike', cooldownStarted: false, actualCosts: {}, actionOccupancies: [] });
    const finishAtMs = hit.timeMs + 300;
    if (key === 'before') expect(passive).toMatchObject({ status: 'active', finishedAtMs: null, lastExecutionAtMs: null, advanceAtMs: finishAtMs });
    else {
      expect(passive).toMatchObject({ status: 'complete', finishedAtMs: finishAtMs, lastExecutionAtMs: finishAtMs });
      const tails = damage.filter(row => row.timeMs === finishAtMs && originOf(row).skillKey === passive.skillKey
        && row.useRef === origin.useKey && row.hitRef === `hit:${origin.hitOccurrenceId}`);
      expect(tails).toHaveLength(1);
    }
  }
  expect(errors).toEqual([]);
  await archive(testInfo, 'worker-evidence.json', { kind: 'synthetic-browser-worker', caseKey: definition.caseKey,
    sourceCaseSha256: definition.fileSha256, observedWasm: observed.wasm, authorizationRequired: true,
    workerUrls: workers, workerMessages: observed.workerMessages, result, pageErrors: errors,
    boundaries: ['合成固定机制与取票接口替身；正式产物独立验签', '未调用业务写接口或真实英雄验收', '零预算、截断、采样及错误摘要拒绝沿现有测试工具验证'] });
});
