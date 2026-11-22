import { fulfillComputeAuthorization } from '../fixtures/computeAuthorization';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

for (const [backgroundAttack, count] of [[false, 2], [true, 2], [false, 3], [false, 4], [false, 16]] as const) {
  test(`正式自动Worker：${count}项链，背景普攻${backgroundAttack}，重复／汇总／预算／错误恢复／释放重编`, async ({ page }) => {
    const bytes = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
    const wasm = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    if (process.env.SIMULATION_EXPECTED_WASM_SHA256) expect(wasm.sha256).toBe(process.env.SIMULATION_EXPECTED_WASM_SHA256.toLowerCase());
    await page.route('**/api/auth/wasm-grant', async route => {
      if (!await fulfillComputeAuthorization(route)) await route.fallback();
    });
    await page.goto('/');
    const observedWasm = await page.evaluate(async () => {
      const response = await fetch('/src/engine/wasm/tinygo_engine_v2.wasm');
      if (!response.ok) throw new Error(`Wasm请求失败：${response.status}`);
      const bytes = await response.arrayBuffer();
      return { bytes: bytes.byteLength, sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map(byte => byte.toString(16).padStart(2, '0')).join('') };
    });
    expect(observedWasm).toEqual(wasm);
    const result = await page.evaluate(async ({ backgroundAttack, count }) => {
      const fixturePath = '/tests/fixtures/simulationAutomaticSkills.ts';
      const workerPath = '/tests/fixtures/simulationAutomaticWorker.ts';
      const { simulationAutomaticSample, automaticInputs } = await import(fixturePath) as typeof import('../fixtures/simulationAutomaticSkills');
      const { runAutomaticWorkerCase } = await import(workerPath) as typeof import('../fixtures/simulationAutomaticWorker');
      const snapshot = simulationAutomaticSample(backgroundAttack, count);
      return { snapshot, result: await runAutomaticWorkerCase(snapshot, automaticInputs(snapshot, count > 4 ? 2000 : 2600)) };
    }, { backgroundAttack, count });
    const automatic = result.result.baseline.automaticSkillSummary!;
    expect(automatic.ruleCount).toBe(count);
    expect(automatic.qualifications).toHaveLength(count - 1);
    expect(automatic.startedCount).toBeGreaterThanOrEqual(count);
    expect(result.result.baseline.summary.skillActions).toBeUndefined();
    expect(result.result.baseline.skillActionRecords).toBeUndefined();
    for (const edge of automatic.qualifications) {
      expect(edge.grantedCount).toBe(edge.consumedCount + edge.remainingCount);
      expect(edge.remainingCount).toBeLessThanOrEqual(1);
      expect(edge.consumedCount).toBe(automatic.rules.find(rule => rule.ruleKey === edge.consumerRuleKey)!.startedCount);
    }
    expect(result.result.release.released).toBe(true);
    const output = resolve('output/automatic-skills'); mkdirSync(output, { recursive: true });
    writeFileSync(resolve(output, `worker-${count}-${backgroundAttack ? 'mixed' : 'pure'}.json`), JSON.stringify({ wasm, observedWasm, ...result }, null, 2));
  });
}
