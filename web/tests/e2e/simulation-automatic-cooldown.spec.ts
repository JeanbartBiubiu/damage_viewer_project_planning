import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { GenericFormulaExpr, ProviderStateFieldSchema } from '../../src/types/genericEngine';
import type { NativeAutomaticInput } from '../fixtures/simulationAutomaticNativeWorker';

type NativeConstructor = { createAutomaticSkillsInput: (count: number) => NativeAutomaticInput;
  syncAutomaticInitialSnapshot: (input: NativeAutomaticInput) => void };
const nativeConstructorPath = fileURLToPath(new URL('../../../wasm/tinygo_engine_v2/scripts/automatic-skills-input.mjs', import.meta.url));
const constant = (value: number): GenericFormulaExpr => ({ op: 'const', value });

async function makeInput(count: number) {
  const native = await import(pathToFileURL(nativeConstructorPath).href) as NativeConstructor;
  return { native, input: native.createAutomaticSkillsInput(count) };
}
async function execute(page: Page, input: NativeAutomaticInput, label: string) {
  const bytes = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  const wasm = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  if (process.env.SIMULATION_EXPECTED_WASM_SHA256) expect(wasm.sha256).toBe(process.env.SIMULATION_EXPECTED_WASM_SHA256.toLowerCase());
  await page.goto('/');
  const observedWasm = await page.evaluate(async () => {
    const response = await fetch('/src/engine/wasm/tinygo_engine_v2.wasm');
    if (!response.ok) throw new Error(`Wasm请求失败：${response.status}`);
    const bytes = await response.arrayBuffer();
    return { bytes: bytes.byteLength, sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('') };
  });
  expect(observedWasm).toEqual(wasm);
  const result = await page.evaluate(async input => {
    const workerPath = '/tests/fixtures/simulationAutomaticNativeWorker.ts';
    const { runNativeAutomaticWorkerCase } = await import(workerPath) as typeof import('../fixtures/simulationAutomaticNativeWorker');
    return runNativeAutomaticWorkerCase(input);
  }, input);
  const output = resolve('output/automatic-skills'); mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, `cooldown-${label}.json`), JSON.stringify({ wasm, observedWasm, constructorPath: nativeConstructorPath,
    input, result, boundary: '独立原生作者输入与正式浏览器工作线程；不代表真实英雄作者数据' }, null, 2));
  expect(result.release.released).toBe(true);
  return result.done;
}

for (const [remainingMs, nextStartMs] of [[200, 202], [1500, 1502], [0, 100]] as const) {
  test(`共同冷却：真实被动将B剩余CD改为${remainingMs}毫秒后A第二次开始${nextStartMs}`, async ({ page }) => {
    const { input, native } = await makeInput(2);
    const compile = input.compileRequest;
    compile.sharedProviders![0]!.processes![0]!.cooldown!.durationMs = constant(100);
    compile.combatants[0]!.providers.push({ providerRef: 'changer', definitionRef: 'cooldown_changer' });
    compile.sharedProviders!.push({ providerKey: 'cooldown_changer', kind: 'equipment', stableId: 'changer', listeners: [{
      listenerKey: 'change', eventMatcher: { all: ['event/skill_hit', 'ability/rule1'] }, operations: [{ operation: 'cooldown_change', target: 'self',
        abilityRef: 'source.provider[mount_rule1].ability[initial]', valuePolicy: 'set_remaining', amount: constant(remainingMs) }]
    }] });
    input.runRequest.stopPolicy.durationMs = 1800;
    native.syncAutomaticInitialSnapshot(input);
    const done = await execute(page, input, `related-${remainingMs}`);
    const starts = done.automaticSkillRecords!.filter(row => row.kind === 'STARTED' && row.ruleKey === 'rule0').map(row => row.timeMs);
    expect(starts[0]).toBe(0); expect(starts[1]).toBe(nextStartMs);
    expect(new Set(starts).size).toBe(starts.length);
    expect(done.automaticSkillSummary!.qualifications[0]!.grantedCount).toBe(done.automaticSkillSummary!.qualifications[0]!.consumedCount
      + done.automaticSkillSummary!.qualifications[0]!.remainingCount);
    expect(done.summary.basicAttack).toBeUndefined();
  });
}

test('共同内部冷却：纯主动真实命中计数3而非9，到期归零不补旧事件', async ({ page }) => {
  const { input, native } = await makeInput(3);
  const compile = input.compileRequest;
  compile.combatants[0]!.providers.push({ providerRef: 'passive', definitionRef: 'passive_cd' });
  compile.sharedProviders!.push({ providerKey: 'passive_cd', kind: 'equipment', stableId: 'passive_cd', initialStateSchema: {
    internal_cd: { valueType: 'number', stateKind: 'cooldown', defaultValue: 0, maxValue: 1, durationMs: 150, refreshPolicy: 'start_on_first_write' }, accepted: 0
  }, listeners: [{ listenerKey: 'accepted_hits', eventMatcher: { all: ['event/skill_hit'] },
    condition: { op: 'eq', args: [{ op: 'read', path: 'provider.state.internal_cd' }, constant(0)] }, operations: [
      { operation: 'state_change', target: 'self', ref: 'accepted', types: ['state_scope/provider'], valuePolicy: 'add', amount: constant(1) },
      { operation: 'state_change', target: 'self', ref: 'internal_cd', types: ['state_scope/provider'], valuePolicy: 'override', amount: constant(1) }
    ] }] });
  native.syncAutomaticInitialSnapshot(input);
  const done = await execute(page, input, 'passive-internal');
  const state = done.finalSnapshot.combatants.find(actor => actor.key === 'source')!.providerState.passive as { state: { accepted: number; internal_cd: number } };
  expect(state.state.accepted).toBe(3); expect(state.state.internal_cd).toBe(0);
  expect(done.automaticSkillSummary!.startedCount).toBe(9); expect(done.summary.skillUses!.hitCount).toBe(9);
  expect(done.summary.basicAttack).toBeUndefined();
  expect(done.automaticSkillRecords!.filter(row => row.kind === 'STARTED').map(row => row.timeMs)).toEqual([0, 1, 2, 1001, 1002, 1003, 2002, 2003, 2004]);
});

test('普通状态期限：500毫秒清除成本阻挡，在无背景普攻时恢复真实自动尝试', async ({ page }) => {
  const { input, native } = await makeInput(1);
  const compile = input.compileRequest;
  compile.combatants[0]!.resources.energy = { current: 0, max: 1 };
  const provider = compile.sharedProviders![0]!;
  provider.initialStateSchema = { blocked: { valueType: 'number', defaultValue: 0, maxValue: 1, durationMs: 500, refreshPolicy: 'refresh_on_write' } satisfies ProviderStateFieldSchema };
  const process = provider.processes![0]!;
  process.cooldown!.durationMs = constant(200);
  process.costs = [{ resourceKey: 'energy', amount: { op: 'read', path: 'provider.state.blocked' } }];
  process.momentOperations = [{ moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null }, operations: [
    { operation: 'state_change', target: 'self', ref: 'blocked', types: ['state_scope/provider'], valuePolicy: 'override', amount: constant(1) }
  ] }];
  input.runRequest.stopPolicy.durationMs = 1100;
  native.syncAutomaticInitialSnapshot(input);
  const done = await execute(page, input, 'ordinary-state-500');
  expect(done.automaticSkillRecords!.filter(row => row.kind === 'STARTED').map(row => row.timeMs)).toEqual([0, 500, 1000]);
  expect(done.automaticSkillSummary!.startedCount).toBe(3);
  expect(done.automaticSkillSummary!.rules[0]!.waiting?.reason).toBe('OWN_COOLDOWN');
  expect(done.automaticSkillRecords!.some(row => row.kind === 'WAIT_CHANGED' && row.reason === 'MECHANIC_RESOURCE')).toBe(true);
  expect(done.summary.basicAttack).toBeUndefined();
});
