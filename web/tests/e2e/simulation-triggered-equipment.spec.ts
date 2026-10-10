import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { SimulationSnapshot } from '../../src/types/simulationSnapshot';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';
import { triggeredEquipmentSimulationSample } from '../fixtures/simulationTriggeredEquipment';
import { equipmentSimulationSample } from '../fixtures/simulationEquipment';
import { readIsolatedSimulationSnapshot, simulationComparisonSelection } from '../fixtures/simulationSnapshotRequests';

test.beforeEach(async ({ page }) => {
  const bytes = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  expect(bytes.length).toBe(WASM_IDENTITY.bytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(WASM_IDENTITY.sha256);
  await page.goto('/');
});

async function runSnapshot(page: import('@playwright/test').Page, snapshot: SimulationSnapshot) {
  return page.evaluate(async snapshot => {
    const adapterPath = '/src/engine/simulationAdapter.ts';
    const clientPath = '/src/engine/genericEngineClient.ts';
    const continuousPath = '/src/engine/continuousAttackRequest.ts';
    const singleResultPath = '/src/engine/singleAttackResult.ts';
    const continuousResultPath = '/src/engine/continuousAttackResult.ts';
    const { prepareSimulation, inspectSimulationSnapshot, singleAttackRequest } = await import(adapterPath) as typeof import('../../src/engine/simulationAdapter');
    const { GenericEngineClient } = await import(clientPath) as typeof import('../../src/engine/genericEngineClient');
    const { continuousAttackRequest } = await import(continuousPath) as typeof import('../../src/engine/continuousAttackRequest');
    const { assessSingleAttackResult } = await import(singleResultPath) as typeof import('../../src/engine/singleAttackResult');
    const { assessContinuousAttackResult } = await import(continuousResultPath) as typeof import('../../src/engine/continuousAttackResult');
    const preflightPath = '/src/engine/skillFormulaPreflight.ts', proofPath = '/src/engine/approvedFormulaValues.ts';
    const { preflightSkillFormulas } = await import(preflightPath) as typeof import('../../src/engine/skillFormulaPreflight');
    const { validateConsumedFormulaValues, validateApprovedFormulaValues } = await import(proofPath) as typeof import('../../src/engine/approvedFormulaValues');
    const client = new GenericEngineClient();
    const formulaPreflight = await preflightSkillFormulas(snapshot, client);
    const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) {
      inputs[row.side][row.attribute.attributeKey] = row.attribute.attributeKey === 'attack_speed_ratio' ? .651
        : row.side === 'source' && row.attribute.attributeKey === 'life_steal_percent' ? .1 : 0;
    }
    const initialHealth = { source: Math.min(500, snapshot.source.selectedLevelValues.hp!), target: snapshot.target.selectedLevelValues.hp! };
    const assumptions = (['source', 'target'] as const).filter(owner => snapshot.selection[`${owner}EquipmentKeys`].includes('item_3110'))
      .map(owner => ({ owner, equipmentKey: 'item_3110', target: owner === 'source' ? 'target' as const : 'source' as const, inRange: true }));
    const prepared = await prepareSimulation(snapshot, inputs, initialHealth, assumptions);
    let release;
    let compiled;
    try {
      compiled = await client.compile(prepared.compileRequest);
      if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
      validateConsumedFormulaValues(prepared.approvedFormulaValues, prepared.compileRequest.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
      validateApprovedFormulaValues(prepared.compileRequest.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
      const singleRequest = singleAttackRequest(prepared.compileRequest, compiled.sessionId);
      singleRequest.runtimeOptions = { ...singleRequest.runtimeOptions, equipmentAssumptions: assumptions, skillOrigins: prepared.skillOrigins };
      const single = await client.run(singleRequest);
      const singleAssessment = assessSingleAttackResult(prepared.compileRequest, singleRequest, single);
      const continuousInput = await continuousAttackRequest(prepared, snapshot, { durationMs: 2000, attackSpeedInputMax: 10, recordTimeSeries: true }, compiled.sessionId);
      const continuous = await client.run(continuousInput.runRequest);
      const continuousAssessment = assessContinuousAttackResult(prepared.compileRequest, continuousInput.runRequest, continuous, prepared.operationOrigins);
      const repeated = await client.run(continuousInput.runRequest);
      const truncatedRequest = { ...continuousInput.runRequest, recordBudget: { maxAttackRecords: 0, maxDamageRecords: 0 } };
      const truncated = await client.run(truncatedRequest);
      const truncatedAssessment = assessContinuousAttackResult(prepared.compileRequest, truncatedRequest, truncated, prepared.operationOrigins);
      release = await client.release(compiled.sessionId, prepared.compileRequest.rulesHash);
      client.terminate();
      return { snapshot, prepared, formulaPreflight, inputs, initialHealth, single, singleAssessment, continuous, continuousAssessment, repeated, truncated, truncatedAssessment, release, liveWorker: client.hasLiveWorker };
    } finally {
      if (compiled?.sessionId && client.hasLiveWorker) await client.release(compiled.sessionId, prepared.compileRequest.rulesHash);
      client.terminate();
    }
  }, snapshot);
}

for (const targetKeys of [[], ['item_1043']] as string[][]) {
  test(`4C独立结构反曲命中附伤、双方来源隔离、截断与重复释放 ${targetKeys.join(',')}`, async ({ page }, testInfo) => {
    const result = await runSnapshot(page, triggeredEquipmentSimulationSample(['item_1043'], targetKeys));
    await testInfo.attach('4C独立结构运行', { body: JSON.stringify(result), contentType: 'application/json' });
    expect(result.singleAssessment.issues).toEqual([]);
    expect(result.continuousAssessment.issues).toEqual([]);
    expect(result.truncatedAssessment.issues).toEqual([]);
    expect(result.repeated).toEqual(result.continuous);
    expect(result.truncated.summary.sourceDamageDealt).toBe(result.continuous.summary.sourceDamageDealt);
    expect(result.continuous.summary.targetDamageDealt).toBe(0);
    expect(result.release.released).toBe(true);
    expect(result.liveWorker).toBe(false);
  });
}

test('4C真实反曲、振奋与冰心完整配置进入实际Worker并独立验证吸血', async ({ page, request }, testInfo) => {
  test.skip(process.env.SIMULATION_LIVE_API !== '1', '需要显式真实只读服务');
  const base = process.env.SIMULATION_LIVE_API_BASE_URL ?? 'http://127.0.0.1:8080';
  const { snapshot } = await readIsolatedSimulationSnapshot(request, base, simulationComparisonSelection({
    sourceEquipmentKeys: ['item_1043', 'item_3065'], targetEquipmentKeys: ['item_3110']
  }), process.env.SIMULATION_LIVE_ADMIN_TOKEN);
  const result = await runSnapshot(page, snapshot);
  await testInfo.attach('4C真实完整运行', { body: JSON.stringify(result), contentType: 'application/json' });
  const folder = resolve('output/phase4c-2026-10-03');
  mkdirSync(folder, { recursive: true });
  writeFileSync(resolve(folder, 'actual-recurve-vigor-iceheart.json'), JSON.stringify({ ...result, wasm: WASM_IDENTITY }));
  expect(result.singleAssessment.issues).toEqual([]);
  expect(result.continuousAssessment.issues).toEqual([]);
  expect(result.truncatedAssessment.issues).toEqual([]);
  expect(result.repeated).toEqual(result.continuous);
  const effects = result.continuous.damageRecords!.filter(row => row.operationRef.includes('item_1043_passive'));
  expect(effects.length).toBe(result.continuous.summary.basicAttack!.completedCount);
  expect(effects.every(row => row.rawAmount === 15 && row.source === 'source' && row.target === 'target')).toBe(true);
  const expectedHealing = result.continuous.summary.sourceDamageDealt * .1 * 1.25;
  expect(result.continuous.summary.sourceFinalHp).toBeCloseTo(result.initialHealth.source + expectedHealing, 8);
  expect(result.release.released).toBe(true);
  expect(result.liveWorker).toBe(false);
});

test('4C通用构造来源叠层400毫秒到期，实际Worker按剩余比例更新同一冷却', async ({ page }, testInfo) => {
  const result = await page.evaluate(async snapshot => {
    const adapterPath = '/src/engine/simulationAdapter.ts';
    const clientPath = '/src/engine/genericEngineClient.ts';
    const initialPath = '/src/engine/simulationInitialSnapshot.ts';
    const { prepareSimulation, inspectSimulationSnapshot } = await import(adapterPath) as typeof import('../../src/engine/simulationAdapter');
    const { GenericEngineClient } = await import(clientPath) as typeof import('../../src/engine/genericEngineClient');
    const { simulationInitialSnapshot } = await import(initialPath) as typeof import('../../src/engine/simulationInitialSnapshot');
    const preflightPath = '/src/engine/skillFormulaPreflight.ts', proofPath = '/src/engine/approvedFormulaValues.ts';
    const { preflightSkillFormulas } = await import(preflightPath) as typeof import('../../src/engine/skillFormulaPreflight');
    const { validateConsumedFormulaValues, validateApprovedFormulaValues } = await import(proofPath) as typeof import('../../src/engine/approvedFormulaValues');
    const client = new GenericEngineClient();
    const formulaPreflight = await preflightSkillFormulas(snapshot, client);
    const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
    for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) inputs[row.side][row.attribute.attributeKey] = 0;
    const prepared = await prepareSimulation(snapshot, inputs, { source: 650, target: 590 });
    const input = prepared.compileRequest;
    input.rulesHash = 'explicit-timed-stack-mechanism-not-real-equipment';
    input.combatants[0]!.attributes.attack_speed = { base: 1, current: 1, max: 1, resolved: 1 };
    input.combatants[0]!.attributes.attack_speed_ratio = { base: 1, current: 1, max: 1, resolved: 1 };
    input.rules.attributeDerivations = [{ combatantKey: 'source', attributeKey: 'attack_speed', valuePolicy: 'set', valueType: 'DECIMAL', value: {
      op: 'add', args: [{ op: 'read', path: 'source.attr.attack_speed.base' }, { op: 'mul', args: [
        { op: 'read', path: 'source.attr.attack_speed_ratio.resolved' }, { op: 'sub', args: [
          { op: 'read', path: 'source.attr.bonus_attack_speed_percent.resolved' }, { op: 'read', path: 'source.attr.bonus_attack_speed_percent.base' }
        ] }
      ] }]
    } }];
    input.typeCatalog.types.push({ key: 'state_scope/provider', domain: 'state_scope' });
    input.sharedProviders!.push({ providerKey: 'mechanism_fixed', stableId: 'mechanism_fixed', kind: 'item',
      modifiers: [{ modifierKey: 'hp-zero', kind: 'attribute', target: 'self.attr.hp', valuePolicy: 'add', value: { op: 'const', value: 0 } }] },
    { providerKey: 'mechanism_passive', stableId: 'mechanism_fixed', kind: 'item',
      initialStateSchema: { stacks: { valueType: 'number', defaultValue: 0, maxValue: 4, durationMs: 400, refreshPolicy: 'refresh_on_write' } },
      modifiers: [{ modifierKey: 'timed-speed', kind: 'attribute', target: 'self.attr.bonus_attack_speed_percent', valuePolicy: 'add', value: { op: 'read', path: 'provider.state.stacks' } }],
      listeners: [{ listenerKey: 'timed-stacks', maxTriggersPerEvent: 1,
        eventMatcher: { all: ['event/basic_attack_hit', 'event/source_owner'] }, operations: [{ operation: 'state_change', target: 'self', ref: 'stacks',
          types: ['state_scope/provider'], valuePolicy: 'add', amount: { op: 'const', value: 1 } }] }]
    });
    input.combatants[0]!.providers.push({ providerRef: 'mechanism_fixed', definitionRef: 'mechanism_fixed' }, { providerRef: 'mechanism_passive', definitionRef: 'mechanism_passive' });
    let compiled;
    try {
      compiled = await client.compile(input);
      if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
      validateConsumedFormulaValues(prepared.approvedFormulaValues, input.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
      validateApprovedFormulaValues(input.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
      const request: import('../../src/types/genericEngine').RunRequest = {
        sessionId: compiled.sessionId, expectedRulesHash: input.rulesHash, schemaVersion: input.schemaVersion, schemaHash: input.schemaHash, rulesHash: input.rulesHash,
        initialSnapshot: simulationInitialSnapshot(input), driverPlan: { conditionRecheckIntervalMs: 100, entries: [], basicAttack: { ...prepared.basicAttackBinding, planKey: 'timed-stack-construct', attackSpeedInputMax: 10 } },
        stopPolicy: { durationMs: 1200, stopOnTargetDeath: true, stopWhenNoEvents: true }, sampling: { disabled: true, sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 5000 }
      };
      const done = await client.run(request);
      const repeated = await client.run(request);
      const release = await client.release(compiled.sessionId, input.rulesHash);
      client.terminate();
      return { input, formulaPreflight, request, done, repeated, release, liveWorker: client.hasLiveWorker };
    } finally {
      if (compiled?.sessionId && client.hasLiveWorker) await client.release(compiled.sessionId, input.rulesHash);
      client.terminate();
    }
  }, equipmentSimulationSample());
  await testInfo.attach('4C通用构造非真实装备', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.done.attackRecords!.map(row => row.startAtMs)).toEqual([0, 600, 1200]);
  expect(result.done.attackRecords![0]).toMatchObject({ attackSpeed: 1, readyAtMs: 1000, finalReadyAtMs: 600, nextStartAtMs: 600 });
  expect(result.done.summary.execution!.complete).toBe(true);
  expect(result.done.evidence.items.some(row => row.kind === 'provider_state_expired' && row.timeMs === 400)).toBe(true);
  expect(result.repeated).toEqual(result.done);
  expect(result.release.released).toBe(true);
  expect(result.liveWorker).toBe(false);
});
