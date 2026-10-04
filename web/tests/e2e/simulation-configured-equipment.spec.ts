import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { SimulationSnapshot } from '../../src/types/simulationSnapshot';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';

const scenarios = [
  { name: 'ghost', source: ['item_3124'], target: [], duration: 12000 },
  { name: 'ghost_recurve_thorns', source: ['item_3124', 'item_1043'], target: ['item_3075'], duration: 12000 },
  { name: 'source_period', source: ['item_3068'], target: [], duration: 7000 },
  { name: 'target_period', source: [], target: ['item_3068'], duration: 7000 },
  { name: 'combined', source: ['item_3124', 'item_1043', 'item_3065'], target: ['item_3075', 'item_3068'], duration: 12000 }
];

for (const scenario of scenarios) test(`4C配置驱动真实装备 ${scenario.name}`, async ({ page, request }, testInfo) => {
  test.skip(process.env.SIMULATION_LIVE_API !== '1', '需要真实管理服务');
  const bytes = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  expect(bytes.length).toBe(WASM_IDENTITY.bytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(WASM_IDENTITY.sha256);
  const query = new URLSearchParams({ sourceCharacterKey: 'champion_aatrox', sourceLevel: '1', targetCharacterKey: 'champion_ahri', targetLevel: '18',
    basicAttackSkillKey: 'shared_basic_attack', basicAttackLevel: '1' });
  for (const key of scenario.source) query.append('sourceEquipmentKeys', key);
  for (const key of scenario.target) query.append('targetEquipmentKeys', key);
  const response = await request.get(`http://127.0.0.1:8080/api/admin/games/lol/simulation-snapshot?${query}`);
  expect(response.status()).toBe(200);
  const snapshot = await response.json() as SimulationSnapshot;
  await page.goto('/');
  const result = await page.evaluate(async ({ snapshot, duration }) => {
    const adapterPath = '/src/engine/simulationAdapter.ts';
    const clientPath = '/src/engine/genericEngineClient.ts';
    const continuousPath = '/src/engine/continuousAttackRequest.ts';
    const assessmentPath = '/src/engine/continuousAttackResult.ts';
    const singlePath = '/src/engine/singleAttackResult.ts';
    const equipmentPath = '/src/engine/simulationEquipment.ts';
    const passivePath = '/src/engine/simulationEquipmentPassives.ts';
    const { inspectSimulationSnapshot, prepareSimulation, singleAttackRequest } = await import(adapterPath) as typeof import('../../src/engine/simulationAdapter');
    const { GenericEngineClient } = await import(clientPath) as typeof import('../../src/engine/genericEngineClient');
    const { continuousAttackRequest } = await import(continuousPath) as typeof import('../../src/engine/continuousAttackRequest');
    const { assessContinuousAttackResult } = await import(assessmentPath) as typeof import('../../src/engine/continuousAttackResult');
    const { assessSingleAttackResult } = await import(singlePath) as typeof import('../../src/engine/singleAttackResult');
    const { simulationHealthLimit } = await import(equipmentPath) as typeof import('../../src/engine/simulationEquipment');
    const { equipmentRangeRequirements } = await import(passivePath) as typeof import('../../src/engine/simulationEquipmentPassives');
    const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) {
      inputs[row.side][row.attribute.attributeKey] = row.attribute.attributeKey === 'attack_speed_ratio' ? .651 : row.attribute.attributeKey === 'life_steal_percent' && row.side === 'source' ? .1 : 0;
    }
    const assumptions = equipmentRangeRequirements(snapshot).map(({ owner, equipmentKey }) => ({ owner, equipmentKey,
      target: owner === 'source' ? 'target' as const : 'source' as const, inRange: true }));
    const health = { source: simulationHealthLimit(snapshot, 'source')! - 100, target: simulationHealthLimit(snapshot, 'target')! };
    const prepared = await prepareSimulation(snapshot, inputs, health, assumptions);
    const client = new GenericEngineClient();
    let sessionId: string | undefined;
    try {
      const compiled = await client.compile(prepared.compileRequest);
      if (!compiled.ok || !compiled.sessionId) throw new Error(`compile: ${JSON.stringify(compiled.errors)}`);
      sessionId = compiled.sessionId;
      const singleRequest = singleAttackRequest(prepared.compileRequest, sessionId);
      const single = await client.run(singleRequest);
      const singleAssessment = assessSingleAttackResult(prepared.compileRequest, singleRequest, single);
      const preparedRun = await continuousAttackRequest(prepared, snapshot, { durationMs: duration, attackSpeedInputMax: 10, recordTimeSeries: true }, sessionId);
      const done = await client.run(preparedRun.runRequest);
      const assessment = assessContinuousAttackResult(prepared.compileRequest, preparedRun.runRequest, done, prepared.operationOrigins);
      const repeated = await client.run(preparedRun.runRequest);
      const truncatedRequest = { ...preparedRun.runRequest, recordBudget: { maxAttackRecords: 0, maxDamageRecords: 0 } };
      const truncated = await client.run(truncatedRequest);
      const truncatedAssessment = assessContinuousAttackResult(prepared.compileRequest, truncatedRequest, truncated, prepared.operationOrigins);
      const release = await client.release(sessionId, prepared.compileRequest.rulesHash);
      client.terminate();
      return { snapshot, prepared, request: preparedRun.runRequest, single, singleAssessment, done, assessment, repeated, truncated, truncatedAssessment, release, liveWorker: client.hasLiveWorker };
    } finally {
      if (sessionId && client.hasLiveWorker) await client.release(sessionId, prepared.compileRequest.rulesHash);
      client.terminate();
    }
  }, { snapshot, duration: scenario.duration });
  const output = resolve('output/phase4c-configured-2026-10-04');
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, `${scenario.name}.json`), JSON.stringify(result, null, 2));
  await testInfo.attach('真实作者树与最终工作线程', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.singleAssessment.issues).toEqual([]);
  expect(result.assessment.issues).toEqual([]);
  expect(result.truncatedAssessment.issues).toEqual([]);
  expect(result.done.summary.execution!.complete).toBe(true);
  expect(result.repeated).toEqual(result.done);
  expect(result.truncated.summary).toEqual(result.done.summary);
  expect(result.release.released).toBe(true);
  expect(result.liveWorker).toBe(false);
  if (scenario.source.includes('item_3124')) {
    const extra = result.done.damageRecords!.filter(row => row.operationRef.includes('item_3124_passive') && row.abilityRef.includes('linked_damage_only'));
    expect(extra[0]?.attackIndex).toBe(7);
    expect(extra.every(row => (row.attackIndex - 7) % 3 === 0)).toBe(true);
    expect(result.done.attackRecords![1]!.attackSpeed).toBeGreaterThan(result.done.attackRecords![0]!.attackSpeed);
  }
  if (scenario.target.includes('item_3075')) {
    const reflected = result.done.damageRecords!.filter(row => row.operationRef.includes('item_3075_passive.effects.thorn_damage'));
    expect(reflected.length).toBe(result.done.summary.basicAttack!.hitCount);
    expect(reflected.every(row => row.source === 'target' && row.target === 'source')).toBe(true);
  }
  if (scenario.source.includes('item_3068') || scenario.target.includes('item_3068')) {
    const periods = result.done.damageRecords!.filter(row => row.providerDefinitionRef?.includes('item_3068'));
    expect(periods.length).toBeGreaterThan(0);
    expect(periods[0]!.timeMs).toBe(1000);
    expect(periods.every(row => row.attackIndex === 0 && row.useRef === '' && row.timeMs % 1000 === 0)).toBe(true);
  }
});
