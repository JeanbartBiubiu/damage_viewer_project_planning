import { fulfillAuthSession } from '../fixtures/authSession';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { test, expect, type TestInfo } from '@playwright/test';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';
import { createExplicitDamageInput } from '../fixtures/formulaPhase4AuthorInput';

async function archive(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
  const path = testInfo.outputPath(name);
  writeFileSync(path, JSON.stringify(value, null, 2));
  await testInfo.attach(name, { path, contentType: 'application/json' });
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/me', route => fulfillAuthSession(route, false).then(() => undefined));
  await page.route('**/api/games', route => route.fulfill({ json: [] }));
  await page.goto('/#/simulation/basic-attack');
  const bytes = await page.evaluate(async () => [...new Uint8Array(await (await fetch('/src/engine/wasm/tinygo_engine_v2.wasm')).arrayBuffer())]);
  expect(bytes.length).toBe(WASM_IDENTITY.bytes);
  expect(createHash('sha256').update(Uint8Array.from(bytes)).digest('hex')).toBe(WASM_IDENTITY.sha256);
});

test('正式Worker区分零与非零缺定义、未知原键、未使用目录和明确零倍率', async ({ page }, testInfo) => {
  const workers: string[] = [];
  page.on('worker', worker => workers.push(worker.url()));
  const result = await page.evaluate(async input => {
    const { GenericEngineClient } = await import(/* @vite-ignore */ '/src/engine/genericEngineClient.ts');
    const client = new GenericEngineClient();
    try {
      const rejected = [];
      for (const raw of [0, 100]) {
        const request = structuredClone(input.compileRequest);
        request.sharedProviders[0].abilities[0].params.baseDamage = raw;
        request.rules.damageTypeFormulas = [];
        rejected.push({ raw, compiled: await client.compile(request) });
      }
      const unknownRequest = structuredClone(input.compileRequest);
      unknownRequest.sharedProviders[0].abilities[0].operations[0].damageType = 'outside.original/key';
      const unknown = await client.compile(unknownRequest);
      const successes = [];
      for (const kind of ['unused-catalog', 'no-damage', 'authored-zero'] as const) {
        const request = structuredClone(input.compileRequest);
        if (kind === 'unused-catalog') request.typeCatalog.types.push({ key: 'unused.original/type', domain: 'damage' });
        if (kind === 'no-damage') {
          request.sharedProviders[0].abilities[0].operations = [];
          request.rules.damageTypeFormulas = [];
          request.typeCatalog.types = request.typeCatalog.types.filter(row => row.domain !== 'damage');
        }
        if (kind === 'authored-zero') request.rules.damageTypeFormulas[0].formula.stages[0].expression.value = '0';
        const compiled = await client.compile(request);
        if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
        const done = await client.run({ ...input.runRequest, sessionId: compiled.sessionId, expectedRulesHash: compiled.rulesHash });
        const released = await client.release(compiled.sessionId, compiled.rulesHash);
        successes.push({ kind, compiled, done, released });
      }
      return { rejected, unknown, successes };
    } finally { client.terminate(); }
  }, createExplicitDamageInput());
  expect(workers).toHaveLength(1);
  expect(workers[0]).toContain('genericEngineWorker');
  for (const row of result.rejected) {
    expect(row.compiled.ok).toBe(false);
    expect(row.compiled.sessionId).toBeFalsy();
    expect(row.compiled.errors).toContainEqual(expect.objectContaining({
      phase: 'compile', code: 'missing_damage_type_formula',
      path: 'sharedProviders[0].abilities[0].operations[0].damageType', ref: 'damage/physical'
    }));
  }
  expect(result.unknown.ok).toBe(false);
  expect(result.unknown.errors).toContainEqual(expect.objectContaining({
    phase: 'compile', code: 'unknown_type_key',
    path: 'sharedProviders[0].abilities[0].operations[0].damageType[0]', ref: 'outside.original/key'
  }));
  for (const row of result.successes) {
    expect(row.done.summary.targetFinalHp).toBe(row.kind === 'unused-catalog' ? 900 : 1000);
    expect(row.done.summary.sourceDamageDealt).toBe(row.kind === 'unused-catalog' ? 100 : 0);
    expect(row.released.released).toBe(true);
    if (row.kind === 'authored-zero') {
      const damage = row.done.evidence.items.find(item => item.kind === 'damage')!.data;
      expect(damage.resistanceFactor).toBe(0);
      for (const key of ['resistanceBeforePenetration', 'penetrationPercent', 'penetrationFlat', 'effectiveResistance']) expect(damage).not.toHaveProperty(key);
    }
  }
  await archive(testInfo, '准入与零倍率真实Worker.json', { ...result, workers, wasm: WASM_IDENTITY });
});

test('正式Worker冻结编译数据、200次完整一致、错误后恢复、释放与重新编译', async ({ page }, testInfo) => {
  const workers: string[] = [];
  page.on('worker', worker => workers.push(worker.url()));
  const result = await page.evaluate(async input => {
    const { GenericEngineClient } = await import(/* @vite-ignore */ '/src/engine/genericEngineClient.ts');
    const client = new GenericEngineClient();
    const fresh = structuredClone(input);
    try {
      const compiled = await client.compile(input.compileRequest);
      if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
      const request = { ...input.runRequest, sessionId: compiled.sessionId, expectedRulesHash: compiled.rulesHash };
      const baseline = await client.run(request);
      const signature = JSON.stringify(baseline);
      input.compileRequest.sharedProviders[0].abilities[0].params.baseDamage = 999;
      input.compileRequest.rules.damageTypeFormulas[0].formula.stages[0].expression.value = '0';
      let equalRuns = 0;
      const check = async () => {
        if (JSON.stringify(await client.run(request)) !== signature) throw new Error('同会话结果发生变化');
        equalRuns++;
      };
      for (let index = 0; index < 100; index++) await check();
      let hashError = '';
      try { await client.run({ ...request, expectedRulesHash: 'incorrect_rules_hash' }); }
      catch (error) { hashError = String(error); }
      if (!client.hasLiveWorker) throw new Error('可恢复错误终止了工作线程');
      for (let index = 0; index < 100; index++) await check();
      const released = await client.release(compiled.sessionId, compiled.rulesHash);
      let releasedError = '';
      try { await client.run(request); } catch (error) { releasedError = String(error); }
      const next = await client.compile(fresh.compileRequest);
      if (!next.ok || !next.sessionId) throw new Error(JSON.stringify(next.errors));
      const recompiled = await client.run({ ...fresh.runRequest, sessionId: next.sessionId, expectedRulesHash: next.rulesHash });
      if (JSON.stringify(recompiled) !== signature) throw new Error('释放重编译未恢复完整结果');
      const nextReleased = await client.release(next.sessionId, next.rulesHash);
      return { baseline, equalRuns, hashError, released, releasedError, next, recompiled, nextReleased };
    } finally { client.terminate(); }
  }, createExplicitDamageInput());
  expect(workers).toHaveLength(1);
  expect(workers[0]).toContain('genericEngineWorker');
  expect(result.baseline.summary).toMatchObject({ targetFinalHp: 900, sourceDamageDealt: 100, abilityCastCount: 1 });
  expect(result.equalRuns).toBe(200);
  expect(result.hashError).toContain('hash_mismatch');
  expect(result.released.released).toBe(true);
  expect(result.releasedError).toContain('session_not_found');
  expect(result.recompiled).toEqual(result.baseline);
  expect(result.nextReleased.released).toBe(true);
  await archive(testInfo, '冻结数据和200次恢复重编译.json', { ...result, workers, wasm: WASM_IDENTITY });
});
