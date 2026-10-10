import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { test, expect, type TestInfo } from '@playwright/test';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';
import { createDamageEventInput } from '../fixtures/formulaPhase5AuthorInput';
import { renamedPermanentEquipmentSimulationSample, permanentEquipmentSimulationSample, addPermanentEquipmentSibling } from '../fixtures/simulationPermanentEquipment';
import { syncSimulationSkillSources } from '../fixtures/simulationSkillSources';

async function archive(info: TestInfo, value: unknown) {
  const path = info.outputPath('final-worker.json');
  writeFileSync(path, JSON.stringify({ wasm: WASM_IDENTITY, value }, null, 2));
  await info.attach('最终工作线程证据', { path, contentType: 'application/json' });
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/games', route => route.fulfill({ json: [] }));
  await page.goto('/#/simulation/basic-attack');
  const bytes = await page.evaluate(async () => [...new Uint8Array(await (await fetch('/src/engine/wasm/tinygo_engine_v2.wasm')).arrayBuffer())]);
  expect(bytes.length).toBe(WASM_IDENTITY.bytes);
  expect(createHash('sha256').update(Uint8Array.from(bytes)).digest('hex')).toBe(WASM_IDENTITY.sha256);
});

for (const mixed of [false, true]) test(`新原键聚合${mixed ? '混合类型' : '单类型'}一次且逐笔事件不重复，实际同Worker100次与释放重编`, async ({ page }, info) => {
  const workers: string[] = [];
  page.on('worker', worker => workers.push(worker.url()));
  const result = await page.evaluate(async input => {
    const { GenericEngineClient } = await import(/* @vite-ignore */ '/src/engine/genericEngineClient.ts');
    const client = new GenericEngineClient();
    try {
      const compiled = await client.compile(input.compileRequest);
      if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
      const request = { ...input.runRequest, sessionId: compiled.sessionId, expectedRulesHash: compiled.rulesHash };
      const done = await client.run(request);
      for (let iteration = 0; iteration < 100; iteration++) if (JSON.stringify(await client.run(request)) !== JSON.stringify(done)) throw new Error(`重复运行差异${iteration}`);
      const released = await client.release(compiled.sessionId, compiled.rulesHash);
      const again = await client.compile(input.compileRequest);
      if (!again.ok || !again.sessionId) throw new Error(JSON.stringify(again.errors));
      const recompiled = await client.run({ ...input.runRequest, sessionId: again.sessionId, expectedRulesHash: again.rulesHash });
      const secondRelease = await client.release(again.sessionId, again.rulesHash);
      return { done, recompiled, released, secondRelease, sameSessionRuns: 101 };
    } finally { client.terminate(); }
  }, createDamageEventInput({ mixed }));
  expect(workers).toHaveLength(1);
  expect(result.recompiled).toEqual(result.done);
  expect(result.released.released).toBe(true);
  expect(result.secondRelease.released).toBe(true);
  const events = result.done.evidence.items.filter(row => row.kind === 'emitted_event' && row.ref === 'event/damage_dealt');
  expect(events).toHaveLength(1);
  expect(events[0]!.data.damageTypes).toEqual(mixed ? ['damage/physical', 'heat'] : ['heat']);
  expect(events[0]!.data.rawAmount).toBe(mixed ? 150 : 50);
  expect(events[0]!.data.mitigatedAmount).toBe(mixed ? 100 : 50);
  expect(Object.hasOwn(events[0]!.data, 'damageType')).toBe(!mixed);
  const source = result.done.finalSnapshot.combatants.find(row => row.key === 'source')!;
  const target = result.done.finalSnapshot.combatants.find(row => row.key === 'target')!;
  expect(source.attributes.heat_frames!.resolved).toBe(1);
  expect(source.attributes.physical_frames!.resolved).toBe(Number(mixed));
  expect(source.attributes.damage_instances!.resolved).toBe(mixed ? 4 : 3);
  expect(target.attributes.damage_received!.resolved).toBe(mixed ? 4 : 3);
  await archive(info, { ...result, workers });
});

for (const sameType of [false, true]) test(`聚合${sameType ? '同类型' : '跨类型'}溢出在提交前拒绝，同线程恢复且可释放`, async ({ page }, info) => {
  const workers: string[] = [];
  page.on('worker', worker => workers.push(worker.url()));
  const result = await page.evaluate(async input => {
    const { GenericEngineClient } = await import(/* @vite-ignore */ '/src/engine/genericEngineClient.ts');
    const client = new GenericEngineClient();
    try {
      const compiled = await client.compile(input.compileRequest);
      if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
      const request = { ...input.runRequest, sessionId: compiled.sessionId, expectedRulesHash: compiled.rulesHash };
      const errors: string[] = [];
      for (let iteration = 0; iteration < 2; iteration++) {
        try { await client.run(request); throw new Error('非法聚合通过'); }
        catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
      }
      const liveAfterError = client.hasLiveWorker;
      const recovered = await client.run({ ...request, driverPlan: { entries: [] } });
      const released = await client.release(compiled.sessionId, compiled.rulesHash);
      return { errors, liveAfterError, recovered, released };
    } finally { client.terminate(); }
  }, createDamageEventInput({ overflow: true, sameType }));
  expect(workers).toHaveLength(1);
  expect(result.liveAfterError).toBe(true);
  for (const error of result.errors) expect(error).toContain('runtime_invariant_failed');
  expect(result.recovered.summary.targetFinalHp).toBe(1000);
  expect(result.recovered.summary.sourceDamageDealt).toBe(0);
  expect(result.released.released).toBe(true);
  await archive(info, { ...result, workers });
});

for (const scenario of ['renamed', 'siblings', 'only-sibling'] as const) test(`通用永久装备${scenario}实际护盾金额、对手攻速及重复释放`, async ({ page }, info) => {
  let snapshot = scenario === 'renamed' ? renamedPermanentEquipmentSimulationSample()
    : addPermanentEquipmentSibling(permanentEquipmentSimulationSample(['item_3065']), 'source', 'item_3065', 'item_3065_passive', 'sibling_recovery', .1);
  if (scenario === 'only-sibling') {
    snapshot.selection.sourceSkillSettings.push({ origin: { kind: 'EQUIPMENT', equipmentKey: 'item_3065' }, skillKey: 'item_3065_passive', enabled: false });
    snapshot = syncSimulationSkillSources(snapshot);
  }
  snapshot.source.selectedLevelValues.attack_speed = 1.2;
  const workers: string[] = [];
  page.on('worker', worker => workers.push(worker.url()));
  const result = await page.evaluate(async snapshot => {
    const { GenericEngineClient } = await import(/* @vite-ignore */ '/src/engine/genericEngineClient.ts');
    const { preflightSkillFormulas } = await import(/* @vite-ignore */ '/src/engine/skillFormulaPreflight.ts');
    const { prepareSimulation, inspectSimulationSnapshot } = await import(/* @vite-ignore */ '/src/engine/simulationAdapter.ts');
    const { simulationInitialSnapshot } = await import(/* @vite-ignore */ '/src/engine/simulationInitialSnapshot.ts');
    const { equipmentRangeRequirements } = await import(/* @vite-ignore */ '/src/engine/simulationEquipmentRange.ts');
    const { validateConsumedFormulaValues } = await import(/* @vite-ignore */ '/src/engine/approvedFormulaValues.ts');
    const client = new GenericEngineClient();
    try {
      const preflight = await preflightSkillFormulas(snapshot, client);
      const workerLiveAfterPreflight = client.hasLiveWorker;
      const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
      for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) inputs[row.side][row.attribute.attributeKey] = row.attribute.attributeKey === 'attack_speed_ratio' ? 1 : 0;
      const assumptions = equipmentRangeRequirements(snapshot).map(row => ({ owner: row.owner, equipmentKey: row.equipmentKey, target: row.owner === 'source' ? 'target' as const : 'source' as const, inRange: true as const }));
      const prepared = await prepareSimulation(snapshot, inputs, { source: 650, target: 590 }, assumptions);
      const definition = 'explicit_received_probe';
      prepared.compileRequest.sharedProviders!.push({ providerKey: definition, kind: 'generic', stableId: definition, abilities: [{ abilityKey: 'guard', kind: 'active', operations: [
        { operation: 'shield', target: 'source', shieldRef: 'source_guard', amount: { op: 'const', value: 100 } },
        { operation: 'shield', target: 'target', shieldRef: 'target_guard', amount: { op: 'const', value: 100 } }
      ] }] });
      prepared.compileRequest.combatants[0]!.providers.push({ providerRef: definition, definitionRef: definition });
      const compiled = await client.compile(prepared.compileRequest);
      if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
      validateConsumedFormulaValues(prepared.approvedFormulaValues, prepared.compileRequest.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
      const request = { sessionId: compiled.sessionId, expectedRulesHash: compiled.rulesHash, initialSnapshot: simulationInitialSnapshot(prepared.compileRequest),
        driverPlan: { entries: [{ entryKey: 'probe', abilityRef: `source.provider[${definition}].ability[guard]`, source: 'source', target: 'target', firstAtMs: 0 }] },
        stopPolicy: { durationMs: 1, stopWhenNoEvents: true, stopOnTargetDeath: true } };
      const done = await client.run(request);
      for (let iteration = 0; iteration < 20; iteration++) if (JSON.stringify(await client.run(request)) !== JSON.stringify(done)) throw new Error(`永久重跑差异${iteration}`);
      const released = await client.release(compiled.sessionId, compiled.rulesHash);
      return { done, released, preflight, workerLiveAfterPreflight, sameSessionRuns: 21,
        assumptions, skillOrigins: prepared.skillOrigins, coverage: prepared.coverage };
    } finally { client.terminate(); }
  }, snapshot);
  await archive(info, { ...result, workers });
  expect(result.preflight.compileCount).toBe(1);
  expect(result.preflight.released).toBe(true);
  expect(result.workerLiveAfterPreflight).toBe(false);
  // 预检明确释放并终止线程；正式编译及21次运行共用第二个线程。
  expect(workers).toHaveLength(2);
  expect(result.released.released).toBe(true);
  const source = result.done.finalSnapshot.combatants.find(row => row.key === 'source')!;
  const target = result.done.finalSnapshot.combatants.find(row => row.key === 'target')!;
  expect(source.shields).toHaveLength(1);
  expect(source.shields![0]!.remaining).toBeCloseTo(scenario === 'siblings' ? 135 : scenario === 'only-sibling' ? 110 : 125, 9);
  expect(target.shields![0]!.remaining).toBe(100);
  if (scenario === 'renamed') {
    expect(source.attributes.attack_speed!.resolved).toBeCloseTo(.96, 12);
    expect(result.assumptions).toEqual([{ owner: 'target', equipmentKey: 'authored_aura_item', target: 'source', inRange: true }]);
  } else expect(result.assumptions).toEqual([]);
});
