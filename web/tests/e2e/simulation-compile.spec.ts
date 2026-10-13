import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { simulationSample } from '../fixtures/simulationSnapshot';
import { chooseSimulationEntity, chooseSimulationLevel, installSimulationSelectionApi } from '../fixtures/simulationSelection';
import type { SimulationSnapshot } from '../../src/types/simulationSnapshot';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';
import { confirmSimulationConfiguration, readIsolatedSimulationSnapshot, simulationComparisonSelection, simulationSnapshotWithSelection } from '../fixtures/simulationSnapshotRequests';

const expectedWasm = WASM_IDENTITY;

test.beforeEach(async ({ page }) => {
  const wasm = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  expect(wasm.length).toBe(expectedWasm.bytes);
  expect(createHash('sha256').update(wasm).digest('hex')).toBe(expectedWasm.sha256);
  await page.route('**/api/games', route => route.fulfill({ json: [{ gameId: 'demo', gameName: '独立用例', representativeImageKey: null }] }));
  await installSimulationSelectionApi(page, '**', 'demo');
  await page.goto('/#/simulation/basic-attack');
});

async function compileSnapshot(page: Page, snapshot: SimulationSnapshot, testInfo: TestInfo) {
  const result = await page.evaluate(async (snapshot) => {
    const adapterPath = '/src/engine/simulationAdapter.ts';
    const clientPath = '/src/engine/genericEngineClient.ts';
    const { inspectSimulationSnapshot, prepareSimulation, singleAttackRequest } = await import(adapterPath);
    const { GenericEngineClient } = await import(clientPath);
    const preflightPath = '/src/engine/skillFormulaPreflight.ts', proofPath = '/src/engine/approvedFormulaValues.ts';
    const { preflightSkillFormulas } = await import(preflightPath);
    const { validateConsumedFormulaValues, validateApprovedFormulaValues } = await import(proofPath);
    const client = new GenericEngineClient();
    const formulaPreflight = await preflightSkillFormulas(snapshot, client);
    const inspection = inspectSimulationSnapshot(snapshot);
    const inputs: { source: Record<string, number>; target: Record<string, number> } = { source: {}, target: {} };
    for (const row of inspection.requirements) {
      if (row.storedValue === undefined) inputs[row.side as 'source' | 'target'][row.attribute.attributeKey] = 0;
    }
    // 明确的场景输入，不宣称这些零值已录入角色。非零概率只证明声明被编译。
    if ('critical_strike_chance' in inputs.source) inputs.source.critical_strike_chance = 0.25;
    const initialHealth = { source: snapshot.source.selectedLevelValues.hp, target: snapshot.target.selectedLevelValues.hp };
    const prepared = await prepareSimulation(snapshot, inputs, initialHealth);
    let compileResult;
    let released = false;
    let secondReleaseRejected = false;
    try {
      compileResult = await client.compile(prepared.compileRequest);
      if (!compileResult.ok || !compileResult.sessionId) return { prepared, compileResult, released };
      validateConsumedFormulaValues(prepared.approvedFormulaValues, prepared.compileRequest.formulas ?? [], compileResult.metadata?.approvedStaticValues ?? {});
      validateApprovedFormulaValues(prepared.compileRequest.formulas ?? [], compileResult.metadata?.approvedStaticValues ?? {});
      const singleRequest = singleAttackRequest(prepared.compileRequest, compileResult.sessionId);
      released = (await client.release(compileResult.sessionId, prepared.compileRequest.rulesHash)).released;
      try { await client.release(compileResult.sessionId, prepared.compileRequest.rulesHash); }
      catch { secondReleaseRejected = true; }
      return { prepared, formulaPreflight, compileResult, singleRequest, released, secondReleaseRejected };
    } finally {
      if (!released && compileResult?.sessionId) {
        await client.release(compileResult.sessionId, prepared.compileRequest.rulesHash).catch(() => undefined);
      }
      client.terminate();
    }
  }, snapshot);
  const archivePath = testInfo.outputPath('compile-archive.json');
  mkdirSync(dirname(archivePath), { recursive: true });
  writeFileSync(archivePath, JSON.stringify({ snapshot, ...result, wasm: expectedWasm }, null, 2));
  await testInfo.attach('编译接入档案.json', { path: archivePath, contentType: 'application/json' });
  return result;
}

test('完整独立作者配置进入实际Worker与最终Wasm，编译、释放且身份模板不丢挂载', async ({ page }, testInfo) => {
  const result = await compileSnapshot(page, simulationSample(), testInfo);
  expect(result.compileResult.ok, JSON.stringify(result.compileResult.errors)).toBe(true);
  expect(result.compileResult.metadata).toMatchObject({ combatantCount: 2 });
  expect(result.compileResult.metadata.abilityCount).toBeGreaterThanOrEqual(3);
  expect(result.released).toBe(true);
  expect(result.secondReleaseRejected).toBe(true);
  expect(result.prepared.compileRequest.rules.triggerRules).toBeUndefined();
  expect(result.singleRequest.initialSnapshot.combatants[0].providers).toHaveLength(1);
  expect(result.singleRequest.attackStartFacts[0].useRef).toBe(result.singleRequest.skillHitFacts[0].useRef);
});

test('未知暴击字段与共同循环引用不被Wasm静默忽略，合法前向引用可编译', async ({ page }) => {
  const result = await page.evaluate(async (snapshot) => {
    const adapterPath = '/src/engine/simulationAdapter.ts'; const clientPath = '/src/engine/genericEngineClient.ts';
    const { prepareSimulation, inspectSimulationSnapshot } = await import(adapterPath);
    const { GenericEngineClient } = await import(clientPath);
    const preflightPath = '/src/engine/skillFormulaPreflight.ts', proofPath = '/src/engine/approvedFormulaValues.ts';
    const { preflightSkillFormulas } = await import(preflightPath);
    const { validateConsumedFormulaValues, validateApprovedFormulaValues } = await import(proofPath);
    const client = new GenericEngineClient();
    await preflightSkillFormulas(snapshot, client);
    const inputs: { source: Record<string, number>; target: Record<string, number> } = { source: {}, target: {} };
    for (const row of inspectSimulationSnapshot(snapshot).requirements) {
      if (row.storedValue === undefined) inputs[row.side as 'source' | 'target'][row.attribute.attributeKey] = 0;
    }
    const prepared = await prepareSimulation(snapshot, inputs, { source: 650, target: 590 });
    try {
      const request = structuredClone(prepared.compileRequest);
      const damage = request.sharedProviders[0].abilities[2].operations[0].skillHit.candidates[0].operations[0];
      delete damage.critMultiplier;
      const missingPair = await client.compile(request);
      const forward = structuredClone(prepared.compileRequest);
      const definition = forward.rules.damageTypeFormulas[0].formula;
      definition.stages.reverse();
      const forwardResult = await client.compile(forward);
      if (forwardResult.ok) {
        validateConsumedFormulaValues(prepared.approvedFormulaValues, forward.formulas ?? [], forwardResult.metadata?.approvedStaticValues ?? {});
        validateApprovedFormulaValues(forward.formulas ?? [], forwardResult.metadata?.approvedStaticValues ?? {});
        await client.release(forwardResult.sessionId, forward.rulesHash);
      }
      const cycle = structuredClone(prepared.compileRequest);
      cycle.rules.damageTypeFormulas[0].formula.stages[0].expression = { op: 'ref', stageKey: 'factor' };
      const cycleResult = await client.compile(cycle);
      return { missingPair, forwardResult, cycleResult };
    } finally { client.terminate(); }
  }, simulationSample());
  expect(result.missingPair.ok).toBe(false);
  expect(JSON.stringify(result.missingPair.errors)).toMatch(/critChance|critMultiplier/);
  expect(result.forwardResult.ok, JSON.stringify(result.forwardResult.errors)).toBe(true);
  expect(result.cycleResult.ok).toBe(false);
  expect(JSON.stringify(result.cycleResult.errors)).toMatch(/FORMULA_CYCLE/);
});

test('编译检查仍独立释放，不自动运行单次或连续普攻且不提供图表', async ({ page }) => {
  const snapshot = simulationSample();
  await page.route('**/api/admin/games/demo/simulation-snapshot', route => {
    expect(route.request().method()).toBe('POST');
    return route.fulfill({ json: simulationSnapshotWithSelection(snapshot, route.request().postDataJSON()) });
  });
  await chooseSimulationEntity(page, '攻击方角色', 'actor_a');
  await chooseSimulationLevel(page, '攻击方等级', 1);
  await chooseSimulationEntity(page, '目标角色', 'actor_b');
  await chooseSimulationLevel(page, '目标等级', 1);
  await chooseSimulationEntity(page, '普攻技能', 'sample_basic_attack');
  await chooseSimulationLevel(page, '普攻技能等级', 1);
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  await confirmSimulationConfiguration(page);
  await expect(page.getByRole('button', { name: '将缺失属性填写为0', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '将缺失属性填写为0', exact: true }).click();
  await page.getByRole('button', { name: '双方以满生命开始', exact: true }).click();
  await page.getByRole('button', { name: '编译验证', exact: true }).click();
  await expect(page.getByText('仅编译验证通过，不代表单次/连续计算通过。', { exact: true })).toBeVisible();
  await page.getByText('调试详情：编译请求、原始结果与引用覆盖', { exact: true }).click();
  await expect(page.getByRole('button', { name: '下载编译档案', exact: true })).toBeEnabled();
  await expect(page.getByRole('region', { name: '单次普攻结果', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '连续普攻结果', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '连续普攻', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /图表/ })).toHaveCount(0);
});

test('真实接口A/B等级属性及完整共享普攻，经同一快照进入最终浏览器Wasm编译与释放', async ({ page, request }, testInfo) => {
  test.skip(process.env.SIMULATION_LIVE_API !== '1', '真实服务专项需显式启用；跳过不是通过证据');
  const apiBase = process.env.SIMULATION_LIVE_API_BASE_URL || 'http://127.0.0.1:8080';
  const token = process.env.SIMULATION_LIVE_ADMIN_TOKEN;
  const { snapshot } = await readIsolatedSimulationSnapshot(request, apiBase, simulationComparisonSelection(), token);
  const result = await compileSnapshot(page, snapshot, testInfo);
  const basicAttack = snapshot.skillConfigurations.find(configuration => configuration.skill.skillKey === snapshot.selection.basicAttackSkillKey)!;
  expect(basicAttack.triggerRules).toHaveLength(2);
  expect(basicAttack.effects).toHaveLength(2);
  expect(result.compileResult.ok, JSON.stringify(result.compileResult.errors)).toBe(true);
  expect(result.released).toBe(true);
  expect(result.secondReleaseRejected).toBe(true);
  expect(result.prepared.compileRequest.combatants[0].attributes.hp.max).toBe(650);
  expect(result.prepared.compileRequest.combatants[1].attributes.hp.max).toBe(590);
  expect(result.prepared.coverage.some((row: { authorPath: string }) => row.authorPath === 'damageTypes.physics.formula')).toBe(true);
});
