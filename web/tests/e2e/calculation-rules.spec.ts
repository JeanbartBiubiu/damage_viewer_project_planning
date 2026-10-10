import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import type { SimulationSnapshot } from '../../src/types/simulationSnapshot';
import { equipmentSimulationSample } from '../fixtures/simulationEquipment';
import { readIsolatedSimulationSnapshot, simulationComparisonSelection } from '../fixtures/simulationSnapshotRequests';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';

const api = process.env.SIMULATION_API_BASE || 'http://127.0.0.1:18084';
const builder = pathToFileURL('C:/project/damage_wasm_dev/wasm/tinygo_engine_v2/scripts/calculation-rules-input.mjs').href;

async function archive(info: TestInfo, value: unknown) {
  const path = info.outputPath('final-worker.json');
  writeFileSync(path, JSON.stringify({ wasm: WASM_IDENTITY, value }, null, 2));
  await info.attach('计算规则最终证据', { path, contentType: 'application/json' });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(api => {
    localStorage.setItem('damage-viewer.web.api-base-url', api);
    localStorage.setItem('damage-viewer.web.admin-token', 'local-calculation-verification');
  }, api);
  await page.goto('/#/simulation/basic-attack');
  const bytes = await page.evaluate(async () => [...new Uint8Array(await (await fetch('/src/engine/wasm/tinygo_engine_v2.wasm')).arrayBuffer())]);
  expect(bytes.length).toBe(WASM_IDENTITY.bytes);
  expect(createHash('sha256').update(Uint8Array.from(bytes)).digest('hex')).toBe(WASM_IDENTITY.sha256);
});

async function runSnapshot(page: Page, snapshot: SimulationSnapshot) {
  return page.evaluate(async snapshot => {
    const { GenericEngineClient } = await import(/* @vite-ignore */ '/src/engine/genericEngineClient.ts');
    const { preflightSkillFormulas } = await import(/* @vite-ignore */ '/src/engine/skillFormulaPreflight.ts');
    const { prepareSimulation, inspectSimulationSnapshot, singleAttackRequest } = await import(/* @vite-ignore */ '/src/engine/simulationAdapter.ts');
    const { continuousAttackRequest } = await import(/* @vite-ignore */ '/src/engine/continuousAttackRequest.ts');
    const { assessContinuousAttackResult } = await import(/* @vite-ignore */ '/src/engine/continuousAttackResult.ts');
    const { validateConsumedFormulaValues, validateApprovedFormulaValues } = await import(/* @vite-ignore */ '/src/engine/approvedFormulaValues.ts');
    const client = new GenericEngineClient();
    try {
      const preflight = await preflightSkillFormulas(snapshot, client);
      const workerAfterPreflight = client.hasLiveWorker;
      const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
      // 专项明确供给独立输入：收益来源0.5/0.7，其余未储存普通属性取明确0。
      for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) {
        inputs[row.side][row.attribute.attributeKey] = ['saved_yield', 'attack_speed_ratio'].includes(row.attribute.attributeKey)
          ? row.side === 'source' ? .5 : .7 : 0;
      }
      const prepared = await prepareSimulation(snapshot, inputs, {
        source: snapshot.source.selectedLevelValues.hp!, target: snapshot.target.selectedLevelValues.hp!
      });
      const compiled = await client.compile(prepared.compileRequest);
      if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
      validateConsumedFormulaValues(prepared.approvedFormulaValues, prepared.compileRequest.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
      validateApprovedFormulaValues(prepared.compileRequest.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
      const single = await client.run(singleAttackRequest(prepared.compileRequest, compiled.sessionId));
      const continuous = await continuousAttackRequest(prepared, snapshot, { durationMs: 2000, attackSpeedInputMax: 10, recordTimeSeries: true }, compiled.sessionId);
      const done = await client.run(continuous.runRequest);
      const assessment = assessContinuousAttackResult(prepared.compileRequest, continuous.runRequest, done, prepared.operationOrigins);
      for (let iteration = 0; iteration < 100; iteration++) {
        if (JSON.stringify(await client.run(continuous.runRequest)) !== JSON.stringify(done)) throw new Error(`重复运行差异${iteration}`);
      }
      const release = await client.release(compiled.sessionId, compiled.rulesHash);
      const again = await client.compile(prepared.compileRequest);
      if (!again.ok || !again.sessionId) throw new Error(JSON.stringify(again.errors));
      const recompiled = await client.run({ ...continuous.runRequest, sessionId: again.sessionId, expectedRulesHash: again.rulesHash });
      const secondRelease = await client.release(again.sessionId, again.rulesHash);
      return { preflight, workerAfterPreflight, inputs, prepared, compiled, single, done, assessment, recompiled, release, secondRelease, sameSessionRuns: 101 };
    } finally { client.terminate(); }
  }, snapshot);
}

function renamedSnapshot() {
  const mapping = { attack_speed: 'saved_tempo', attack_speed_ratio: 'saved_yield', bonus_attack_speed_percent: 'saved_extra', critical_strike_chance: 'saved_odds' };
  let json = JSON.stringify(equipmentSimulationSample(['item_1042'], ['item_1042']));
  for (const [from, to] of Object.entries(mapping)) json = json.replaceAll(`"${from}"`, `"${to}"`);
  const snapshot = JSON.parse(json) as SimulationSnapshot;
  snapshot.source.selectedLevelValues.saved_odds = .25;
  snapshot.source.attributes.levelValues['1']!.saved_odds = .25;
  return snapshot;
}

test('真实管理页保存结果、独立HTTP和场景快照完整一致，最终Worker运行作者攻速公式', async ({ page, request }, info) => {
  const response = await request.get(`${api}/api/admin/games/lol/calculation-rules`);
  expect(response.status()).toBe(200);
  const rules = await response.json();
  expect(rules.configuration).toMatchObject({ criticalChanceAttributeKey: 'critical_strike_chance', criticalMultiplierMin: 1, attackSpeedAttributeKey: 'attack_speed' });
  expect(rules.configuration.attributeDerivations).toHaveLength(1);
  await page.goto('/#/game-settings');
  await expect(page.getByLabel('暴击概率属性', { exact: true })).toContainText('critical_strike_chance');
  await expect(page.getByLabel('暴击倍率下限', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('派生1规则标识', { exact: true })).toHaveValue('attack_speed_from_bonus');
  await expect(page.getByLabel('公式结果1名称', { exact: true })).toHaveValue('攻速派生');
  const { snapshot } = await readIsolatedSimulationSnapshot(request, api, simulationComparisonSelection({ sourceEquipmentKeys: ['item_1042'] }));
  expect(snapshot.catalogs.calculationRules).toEqual(rules);
  for (const key of ['attack_speed', 'attack_speed_ratio', 'bonus_attack_speed_percent', 'critical_strike_chance']) {
    expect(snapshot.catalogs.attributes.some(row => row.attributeKey === key && row.status === 'ENABLED')).toBe(true);
  }
  const workers: string[] = []; page.on('worker', worker => workers.push(worker.url()));
  const result = await runSnapshot(page, snapshot);
  expect(workers).toHaveLength(2); // 独立预检释放线程，正式编译/运行/重编共用下一线程。
  expect(result.workerAfterPreflight).toBe(false);
  expect(result.assessment.complete).toBe(true);
  const base = snapshot.source.selectedLevelValues.attack_speed!;
  const bonus = snapshot.source.selectedEquipment[0]!.attributes.attributeValues.bonus_attack_speed_percent!;
  expect(result.done.finalSnapshot.combatants.find(row => row.key === 'source')!.attributes.attack_speed!.resolved).toBeCloseTo(base + .5 * bonus, 10);
  expect(result.recompiled).toEqual(result.done);
  expect(result.release.released && result.secondRelease.released).toBe(true);
  await archive(info, { rules, snapshot, workers, ...result });
});

test('概率、速度、收益和加成完整改名删除旧属性后，双方派生与101次真实运行保持原数学', async ({ page }, info) => {
  const snapshot = renamedSnapshot();
  for (const key of ['attack_speed', 'attack_speed_ratio', 'bonus_attack_speed_percent', 'critical_strike_chance']) {
    expect(snapshot.catalogs.attributes.some(row => row.attributeKey === key)).toBe(false);
  }
  const workers: string[] = []; page.on('worker', worker => workers.push(worker.url()));
  const result = await runSnapshot(page, snapshot);
  expect(workers).toHaveLength(2);
  const source = result.done.finalSnapshot.combatants.find(row => row.key === 'source')!;
  const target = result.done.finalSnapshot.combatants.find(row => row.key === 'target')!;
  expect(source.attributes.saved_tempo!.resolved).toBeCloseTo(.701, 10);
  expect(target.attributes.saved_tempo!.resolved).toBeCloseTo(.738, 10);
  expect(result.single.summary.sourceDamageDealt).toBeCloseTo(60 * 1.25 * 100 / 121, 8);
  expect(result.assessment.complete).toBe(true);
  expect(result.recompiled).toEqual(result.done);
  expect(result.release.released && result.secondRelease.released).toBe(true);
  expect(result.prepared.compileRequest.formulas!.filter(row => row.scope === 'game')).toHaveLength(2);
  await archive(info, { snapshot, workers, ...result });
});

test('只替换完整作者派生公式即可改成双方速度2.5，最终Worker和释放重编一致', async ({ page }, info) => {
  const snapshot = renamedSnapshot();
  snapshot.catalogs.attributes.push({ ...snapshot.catalogs.attributes.find(row => row.attributeKey === 'saved_tempo')!, attributeKey: 'unused_probe', name: '未使用声明' });
  snapshot.catalogs.calculationRules.configuration!.attributeDerivations[0]!.formula = {
    inputs: [{ key: 'unused', binding: { kind: 'attribute', object: 'source', attributeKey: 'unused_probe', valueKind: 'TOTAL', view: 'current_frame' } }],
    stages: [{ key: 'chosen', name: '作者明确常量', expression: { op: 'const', value: '2.5' } }], outputStageKey: 'chosen'
  };
  const result = await runSnapshot(page, snapshot);
  for (const actor of result.done.finalSnapshot.combatants) expect(actor.attributes.saved_tempo!.resolved).toBe(2.5);
  expect(result.inputs.source).not.toHaveProperty('unused_probe');
  expect(result.inputs.target).not.toHaveProperty('unused_probe');
  expect(result.assessment.complete).toBe(true);
  expect(result.recompiled).toEqual(result.done);
  expect(result.done.summary.sourceDamageDealt).toBeGreaterThan(result.single.summary.sourceDamageDealt * 2);
  await archive(info, { snapshot, ...result });
});

test('显式新概率与无下限、0、1和2.5下限，以及游戏拥有方归属经最终Worker结算', async ({ page }, info) => {
  const { createCalculationCriticalInput, createCalculationGameDerivationInput } = await import(builder);
  const inputs = [
    ...[{ chance: .25, multiplier: 2 }, { chance: 0, multiplier: 2 }, { chance: 1, multiplier: .5 },
      { chance: 1, multiplier: .5, minimum: 0 }, { chance: 1, multiplier: .5, minimum: 1 }, { chance: 1, multiplier: .5, minimum: 2.5 }]
      .map(row => createCalculationCriticalInput(row)), createCalculationGameDerivationInput()
  ];
  const results = await page.evaluate(async inputs => {
    const { GenericEngineClient } = await import(/* @vite-ignore */ '/src/engine/genericEngineClient.ts');
    const client = new GenericEngineClient();
    try {
      const results = [];
      for (const input of inputs) {
        const compiled = await client.compile(input.compileRequest);
        if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
        const done = await client.run({ ...input.runRequest, sessionId: compiled.sessionId, expectedRulesHash: compiled.rulesHash });
        const released = await client.release(compiled.sessionId, compiled.rulesHash);
        results.push({ compiled, done, released });
      }
      return results;
    } finally { client.terminate(); }
  }, inputs);
  expect(results.slice(0, 6).map(row => row.done.summary.sourceDamageDealt)).toEqual([125, 100, 50, 50, 100, 250]);
  expect(results[6]!.done.finalSnapshot.combatants.map(row => row.attributes.force!.resolved)).toEqual([2, 4]);
  for (const row of results) expect(row.released.released).toBe(true);
  await archive(info, results);
});

test('有限大倍率下限导致金额溢出时明确拒绝、同一线程101次恢复及释放重编', async ({ page }, info) => {
  const { createCalculationCriticalInput } = await import(builder);
  const input = createCalculationCriticalInput({ overflow: true });
  const workers: string[] = []; page.on('worker', worker => workers.push(worker.url()));
  const result = await page.evaluate(async input => {
    const { GenericEngineClient, GenericEngineClientError } = await import(/* @vite-ignore */ '/src/engine/genericEngineClient.ts');
    const client = new GenericEngineClient();
    try {
      const compiled = await client.compile(input.compileRequest);
      if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
      const request = { ...input.runRequest, sessionId: compiled.sessionId, expectedRulesHash: compiled.rulesHash };
      const errors = [];
      for (let iteration = 0; iteration < 2; iteration++) {
        try { await client.run(request); throw new Error('溢出被接受'); }
        catch (error) {
          errors.push({ message: error instanceof Error ? error.message : String(error),
            engineError: error instanceof GenericEngineClientError ? error.engineError : undefined });
        }
      }
      const liveAfterError = client.hasLiveWorker;
      request.initialSnapshot.combatants.find(row => row.key === 'source')!.attributes.hit_probability = { base: 0, current: 0, max: 0, resolved: 0 };
      const recovered = await client.run(request);
      for (let iteration = 0; iteration < 100; iteration++) {
        if (JSON.stringify(await client.run(request)) !== JSON.stringify(recovered)) throw new Error(`恢复重复差异${iteration}`);
      }
      const released = await client.release(compiled.sessionId, compiled.rulesHash);
      const again = await client.compile(input.compileRequest);
      if (!again.ok || !again.sessionId) throw new Error(JSON.stringify(again.errors));
      const recompiled = await client.run({ ...request, sessionId: again.sessionId, expectedRulesHash: again.rulesHash });
      const secondRelease = await client.release(again.sessionId, again.rulesHash);
      return { errors, liveAfterError, recovered, recompiled, released, secondRelease, sameSessionRuns: 101 };
    } finally { client.terminate(); }
  }, input);
  expect(workers).toHaveLength(1);
  expect(result.liveAfterError).toBe(true);
  for (const error of result.errors) {
    expect(error.message).toContain('runtime_invariant_failed');
    expect(error.engineError).toMatchObject({ code: 'runtime_invariant_failed', path: 'sharedProviders[0].abilities[0].operations[1].critMultiplier' });
  }
  expect(result.recovered.summary.sourceDamageDealt).toBe(100);
  expect(result.recovered.summary.targetFinalHp).toBe(950);
  expect(result.recompiled).toEqual(result.recovered);
  expect(result.released.released && result.secondRelease.released).toBe(true);
  await archive(info, { workers, ...result });
});
