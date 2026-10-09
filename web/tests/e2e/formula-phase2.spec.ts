import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';

const fixture = JSON.parse(readFileSync(resolve('../wasm/tinygo_engine_v2/internal/testkit/fixtures/generic_p0_basic_damage.json'), 'utf8'));

test.beforeEach(async ({ page }) => {
  await page.route('**/api/games', route => route.fulfill({ json: [] }));
  await page.goto('/#/simulation/basic-attack');
  const bytes = await page.evaluate(async () => [...new Uint8Array(await (await fetch('/src/engine/wasm/tinygo_engine_v2.wasm')).arrayBuffer())]);
  expect(bytes.length).toBe(WASM_IDENTITY.bytes);
  expect(createHash('sha256').update(Uint8Array.from(bytes)).digest('hex')).toBe(WASM_IDENTITY.sha256);
});

test('最终正式Wasm通过真实Worker执行固定样例、同会话20次、释放和后续拒绝', async ({ page }, testInfo) => {
  const workers: string[] = [];
  page.on('worker', worker => workers.push(worker.url()));
  const result = await page.evaluate(async (input) => {
    const modulePath = '/src/engine/genericEngineClient.ts';
    const { GenericEngineClient } = await import(modulePath);
    const client = new GenericEngineClient();
    const summaries = [];
    let released = false, rejected = '';
    try {
      const compiled = await client.compile(input.compileRequest);
      if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
      const request = { ...input.runRequest, sessionId: compiled.sessionId, expectedRulesHash: compiled.rulesHash };
      for (let index = 0; index < 20; index++) summaries.push((await client.run(request)).summary);
      released = (await client.release(compiled.sessionId, compiled.rulesHash)).released;
      try { await client.run(request); } catch (error) { rejected = String(error); }
      client.terminate();
      return { compiled, summaries, released, rejected, aliveAfterTerminate: client.hasLiveWorker };
    } finally { client.terminate(); }
  }, fixture);
  expect(workers.some(url => url.includes('genericEngineWorker'))).toBe(true);
  expect(result.summaries).toHaveLength(20);
  for (const summary of result.summaries) {
    expect(summary).toMatchObject(fixture.expectedSummarySubset);
    expect(summary).toEqual(result.summaries[0]);
  }
  expect(result.released).toBe(true);
  expect(result.rejected).toContain('session_not_found');
  expect(result.aliveAfterTerminate).toBe(false);
  await testInfo.attach('真实工作线程往返.json', { body: JSON.stringify({ ...result, workers, wasm: WASM_IDENTITY }, null, 2), contentType: 'application/json' });
});

test('驱动临时程序与失败后重跑不污染同一Worker会话', async ({ page }, testInfo) => {
  const result = await page.evaluate(async (input) => {
    const modulePath = '/src/engine/genericEngineClient.ts';
    const { GenericEngineClient } = await import(modulePath);
    const client = new GenericEngineClient();
    try {
      const compiled = await client.compile(input.compileRequest);
      if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
      const original = { ...input.runRequest, sessionId: compiled.sessionId, expectedRulesHash: compiled.rulesHash };
      const baseline = await client.run(original);
      const request = structuredClone(original);
      request.driverPlan.entries[0].condition = { op: 'const', value: 1 };
      const repeated = [];
      for (let i = 0; i < 20; i++) repeated.push((await client.run(request)).summary);
      request.driverPlan.entries[0].condition = { op: 'div', args: [{ op: 'const', value: 1 }, { op: 'const', value: 0 }] };
      let rejection = '';
      try { await client.run(request); } catch (error) { rejection = String(error); }
      const afterFailure = await client.run(original);
      const released = await client.release(compiled.sessionId, compiled.rulesHash);
      return { baseline: baseline.summary, repeated, rejection, afterFailure: afterFailure.summary, released };
    } finally { client.terminate(); }
  }, fixture);
  for (const summary of result.repeated) expect(summary).toEqual(result.baseline);
  expect(result.rejection).toMatch(/division by zero/);
  expect(result.afterFailure).toEqual(result.baseline);
  expect(result.released.released).toBe(true);
  await testInfo.attach('临时公式与失败恢复.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
});

test('独立纯公式产物在浏览器执行11项与同程序20次变化输入', async ({ page }, testInfo) => {
  await page.addScriptTag({ url: '/formula-phase2/wasm_exec.js' });
  const result = await page.evaluate(async () => {
    const response = await fetch('/formula-phase2/formula_probe.wasm');
    if (!response.ok) throw new Error('独立纯公式产物读取失败');
    const bytes = await response.arrayBuffer();
    // 独立探针复用本次TinyGo原始运行库，不新增业务桥接或冒充正式战斗ABI。
    const runtime = globalThis as typeof globalThis & { Go: new () => { importObject: WebAssembly.Imports; run(instance: WebAssembly.Instance): Promise<void> } };
    const go = new runtime.Go();
    const result = await WebAssembly.instantiate(bytes, go.importObject);
    const exports = result.instance.exports;
    await Promise.race([go.run(result.instance), Promise.resolve()]);
    const check = exports.formula_probe_check as (index: number) => number;
    const cases = Array.from({ length: 11 }, (_, i) => check(i));
    const repeated = Array.from({ length: 20 }, (_, i) => check(i % 3));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    return { cases, repeated, sha256, sizeBytes: bytes.byteLength, memoryBytes: (exports.memory as WebAssembly.Memory).buffer.byteLength };
  });
  expect(result.cases).toEqual(Array(11).fill(0));
  expect(result.repeated).toEqual(Array(20).fill(0));
  expect(result.sizeBytes).toBe(394394);
  expect(result.sha256).toBe('f66301e2ee9f07c5998ba4dc2b4da3b18fec23165872185a19288b91d952b0f8');
  expect(result.memoryBytes).toBe(256 * 1024 * 1024);
  await testInfo.attach('独立纯公式浏览器.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
});
