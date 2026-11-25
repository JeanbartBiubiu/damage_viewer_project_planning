import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';
import { readIsolatedSimulationSnapshot, simulationComparisonSelection, isolateCharacterSourcesOnPage } from '../fixtures/simulationSnapshotRequests';
import { chooseSimulationEntity, chooseSimulationLevel } from '../fixtures/simulationSelection';
import { chooseSimulationEquipment } from '../fixtures/simulationEquipmentPicker';
import { simulationSkillSourceIdentity } from '../../src/services/simulationSkillSourceIdentity';

const api = process.env.SIMULATION_API_BASE || 'http://127.0.0.1:8080';

test.beforeEach(async () => {
  test.skip(process.env.SIMULATION_LIVE_API !== '1', '需要真实后端与最终Wasm');
  const bytes = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  expect(bytes.length).toBe(WASM_IDENTITY.bytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(WASM_IDENTITY.sha256);
});

test('真实三相双方配置按本场入口编译，同会话重复模拟并释放', async ({ request, page }) => {
  const { snapshot } = await readIsolatedSimulationSnapshot(request, api, simulationComparisonSelection({
    sourceCharacterKey: 'champion_jax', sourceLevel: 18, targetCharacterKey: 'champion_malphite', targetLevel: 18,
    sourceEquipmentKeys: ['item_3078'], targetEquipmentKeys: ['item_3078']
  }));
  expect(snapshot.target.skillSources.find(row => row.skillKey === 'item_3078_passive')).toMatchObject({ inactiveReason: 'NO_AUTONOMOUS_ATTACK', enabledRuleKeys: [] });
  await page.goto('/');
  const evidence = await page.evaluate(async snapshot => {
    const adapterPath = '/src/engine/simulationAdapter.ts';
    const clientPath = '/src/engine/genericEngineClient.ts';
    const continuousPath = '/src/engine/continuousAttackRequest.ts';
    const equipmentPath = '/src/engine/simulationEquipment.ts';
    const assessmentPath = '/src/engine/continuousAttackResult.ts';
    const { prepareSimulation, inspectSimulationSnapshot } = await import(adapterPath) as typeof import('../../src/engine/simulationAdapter');
    const { GenericEngineClient } = await import(clientPath) as typeof import('../../src/engine/genericEngineClient');
    const { continuousAttackRequest } = await import(continuousPath) as typeof import('../../src/engine/continuousAttackRequest');
    const { simulationHealthLimit } = await import(equipmentPath) as typeof import('../../src/engine/simulationEquipment');
    const { assessContinuousAttackResult } = await import(assessmentPath) as typeof import('../../src/engine/continuousAttackResult');
    const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    // 本专项明确供值，生产页面继续要求用户填写，不写角色数据或设置默认值。
    for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) {
      inputs[row.side][row.attribute.attributeKey] = row.attribute.attributeKey === 'attack_speed_ratio' ? .651 : 0;
    }
    const prepared = await prepareSimulation(snapshot, inputs, { source: simulationHealthLimit(snapshot, 'source')!, target: simulationHealthLimit(snapshot, 'target')! });
    const client = new GenericEngineClient();
    let sessionId: string | undefined;
    try {
      const compile = await client.compile(prepared.compileRequest);
      if (!compile.ok || !compile.sessionId) throw new Error(JSON.stringify(compile.errors));
      sessionId = compile.sessionId;
      const continuous = await continuousAttackRequest(prepared, snapshot, { durationMs: 2000, attackSpeedInputMax: 10 }, sessionId);
      const done = await client.run(continuous.runRequest);
      const assessment = assessContinuousAttackResult(prepared.compileRequest, continuous.runRequest, done, prepared.operationOrigins);
      if (!assessment.complete) throw new Error(JSON.stringify(assessment.issues));
      for (let i = 0; i < 2; i++) if (JSON.stringify(await client.run(continuous.runRequest)) !== JSON.stringify(done)) throw new Error('同会话重复运行不一致');
      const release = await client.release(sessionId, prepared.compileRequest.rulesHash);
      sessionId = undefined;
      return { snapshot, prepared, compile, done, assessment, release, iterations: 3 };
    } finally {
      if (sessionId && client.hasLiveWorker) await client.release(sessionId, prepared.compileRequest.rulesHash);
      client.terminate();
    }
  }, snapshot);
  expect(evidence.release.released).toBe(true);
  expect(evidence.done.finalSnapshot.combatants[0]!.attributes.move_speed!.resolved).toBe(370);
  expect(evidence.done.finalSnapshot.combatants[1]!.attributes.move_speed!.resolved).toBe(335);
  expect(evidence.prepared.skillOrigins.find(row => row.side === 'target' && row.skillKey === 'item_3078_passive')?.providerRef).toBeUndefined();
  expect(evidence.prepared.operationOrigins.some(row => row.skillKey === 'item_3078_passive' && row.resultKey === 'damage')).toBe(false);
  expect(evidence.prepared.coverage).toContainEqual(expect.objectContaining({ authorPath: 'skills.item_3078_passive.effects.spellblade_damage', note: expect.stringContaining('没有可达入口') }));
  mkdirSync(resolve('output/source-admission'), { recursive: true });
  writeFileSync(resolve('output/source-admission/real-trinity-worker.json'), JSON.stringify({ wasm: WASM_IDENTITY, ...evidence }, null, 2));
});

test('真实页面目标三相保持开启，读取、确认与连续模拟通过', async ({ request, page }) => {
  const { snapshot } = await readIsolatedSimulationSnapshot(request, api, simulationComparisonSelection({
    sourceCharacterKey: 'champion_jax', sourceLevel: 18, targetCharacterKey: 'champion_malphite', targetLevel: 18,
    targetEquipmentKeys: ['item_3078']
  }));
  await page.addInitScript(api => {
  }, api);
  await page.goto('/#/simulation/basic-attack');
  await chooseSimulationEntity(page, '攻击方角色', 'champion_jax');
  await chooseSimulationLevel(page, '攻击方等级', 18);
  await chooseSimulationEntity(page, '目标角色', 'champion_malphite');
  await chooseSimulationLevel(page, '目标等级', 18);
  await chooseSimulationEntity(page, '普攻技能', 'shared_basic_attack');
  await chooseSimulationLevel(page, '普攻技能等级', 1);
  await chooseSimulationEquipment(page, '目标装备', 'item_3078');
  await page.getByRole('button', { name: '读取场景快照', exact: true }).click();
  await isolateCharacterSourcesOnPage(page, snapshot);
  await expect(page.getByRole('checkbox', { name: `目标来源 ${simulationSkillSourceIdentity({ kind: 'EQUIPMENT', equipmentKey: 'item_3078' }, 'item_3078_passive')} 开启`, exact: true })).toBeChecked();
  await expect(page.getByText(/编译准入检查未通过/)).toHaveCount(0);
  await page.getByRole('button', { name: '将缺失属性填写为0', exact: true }).click();
  const ratio = page.getByRole('spinbutton', { name: '目标补充属性 attack_speed_ratio', exact: true });
  if (await ratio.count()) await ratio.fill('0.651');
  await page.getByRole('button', { name: '双方以满生命开始', exact: true }).click();
  await page.getByRole('spinbutton', { name: '观察时长（毫秒）', exact: true }).fill('2000');
  const speedMax = page.getByRole('spinbutton', { name: '攻速输入上界', exact: true });
  if (await speedMax.count()) await speedMax.fill('10');
  await page.getByRole('button', { name: '连续普攻', exact: true }).click();
  await expect(page.getByText('完整观察，目标未被击杀', { exact: true })).toBeVisible();
  await expect(page.getByText(/会话已正常释放/)).toBeVisible();
});

test('真实大天使保留可达初始化，未接入常驻仍明确拒绝', async ({ request, page }) => {
  const { snapshot } = await readIsolatedSimulationSnapshot(request, api, simulationComparisonSelection({
    sourceCharacterKey: 'champion_jax', sourceLevel: 18, targetCharacterKey: 'champion_malphite', targetLevel: 18,
    sourceEquipmentKeys: ['item_3003']
  }));
  expect(snapshot.source.skillSources.find(row => row.skillKey === 'item_3003_passive')).toMatchObject({
    inactiveReason: null, enabledRuleKeys: ['initialize_ap_from_bonus_mana']
  });
  await page.goto('/');
  const error = await page.evaluate(async snapshot => {
    const path = '/src/engine/simulationAdapter.ts';
    const { inspectSimulationSnapshot } = await import(path) as typeof import('../../src/engine/simulationAdapter');
    try { inspectSimulationSnapshot(snapshot); return null; }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  }, snapshot);
  expect(error).toMatch(/item_3003_passive.*可达的永久常驻效果尚未接入/);
});
