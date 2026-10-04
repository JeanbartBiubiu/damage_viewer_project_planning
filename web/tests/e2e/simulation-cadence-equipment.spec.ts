import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { WASM_IDENTITY } from '../../src/engine/wasmIdentity';
import { equipmentSimulationSample } from '../fixtures/simulationEquipment';
import type { CadenceScenario } from '../fixtures/simulationEquipmentCadence';

test.beforeEach(async ({ page }) => {
  const bytes = readFileSync(resolve('src/engine/wasm/tinygo_engine_v2.wasm'));
  expect(bytes.length).toBe(WASM_IDENTITY.bytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(WASM_IDENTITY.sha256);
  await page.goto('/');
});

for (const scenario of ['counter', 'cooldown', 'periodic', 'target_death', 'source_death', 'vamp', 'periodic_speed'] as const) {
  test(`4C通用机制非整件装备 ${scenario}：最终Worker、可靠结果、截断、重复与释放`, async ({ page }, testInfo) => {
    const result = await page.evaluate(async ({ snapshot, scenario }: { snapshot: ReturnType<typeof equipmentSimulationSample>; scenario: CadenceScenario }) => {
      const adapterPath = '/src/engine/simulationAdapter.ts';
      const initialPath = '/src/engine/simulationInitialSnapshot.ts';
      const clientPath = '/src/engine/genericEngineClient.ts';
      const assessmentPath = '/src/engine/continuousAttackResult.ts';
      const constructPath = '/tests/fixtures/simulationEquipmentCadence.ts';
      const { prepareSimulation, inspectSimulationSnapshot } = await import(adapterPath) as typeof import('../../src/engine/simulationAdapter');
      const { simulationInitialSnapshot } = await import(initialPath) as typeof import('../../src/engine/simulationInitialSnapshot');
      const { GenericEngineClient } = await import(clientPath) as typeof import('../../src/engine/genericEngineClient');
      const { assessContinuousAttackResult } = await import(assessmentPath) as typeof import('../../src/engine/continuousAttackResult');
      const { equipmentCadenceConstruct } = await import(constructPath) as typeof import('../fixtures/simulationEquipmentCadence');
      const inputs = { source: {} as Record<string, number>, target: {} as Record<string, number> };
      for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) inputs[row.side][row.attribute.attributeKey] = 0;
      const prepared = await prepareSimulation(snapshot, inputs, { source: 500, target: 590 });
      const construct = await equipmentCadenceConstruct(prepared, scenario);
      const client = new GenericEngineClient();
      let compiled;
      try {
        compiled = await client.compile(construct.input);
        if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
        const request: import('../../src/types/genericEngine').RunRequest = {
          sessionId: compiled.sessionId, expectedRulesHash: construct.input.rulesHash, schemaVersion: construct.input.schemaVersion,
          schemaHash: construct.input.schemaHash, rulesHash: construct.input.rulesHash, initialSnapshot: simulationInitialSnapshot(construct.input),
          driverPlan: { conditionRecheckIntervalMs: 100, entries: [], basicAttack: { ...construct.binding, planKey: `construct-${scenario}`, attackSpeedInputMax: 10 } },
          stopPolicy: { durationMs: construct.durationMs, stopOnTargetDeath: true, stopWhenNoEvents: true },
          sampling: { disabled: false, sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 5000 }
        };
        const done = await client.run(request);
        const assessment = assessContinuousAttackResult(construct.input, request, done, construct.origins);
        const repeated = await client.run(request);
        const truncatedRequest = { ...request, recordBudget: { maxDamageRecords: 0 } };
        const truncated = await client.run(truncatedRequest);
        const truncatedAssessment = assessContinuousAttackResult(construct.input, truncatedRequest, truncated, construct.origins);
        const release = await client.release(compiled.sessionId, construct.input.rulesHash);
        client.terminate();
        return { scope: '通用机制构造，非真实装备作者配置', construct, request, done, assessment, repeated, truncated, truncatedAssessment, release, liveWorker: client.hasLiveWorker };
      } finally {
        if (compiled?.sessionId && client.hasLiveWorker) await client.release(compiled.sessionId, construct.input.rulesHash);
        client.terminate();
      }
    }, { snapshot: equipmentSimulationSample(), scenario });
    const output = resolve('output/phase4c-scheduling-2026-10-03');
    mkdirSync(output, { recursive: true });
    writeFileSync(resolve(output, `${scenario}.json`), JSON.stringify(result, null, 2));
    await testInfo.attach('4C通用机制构造非真实装备', { body: JSON.stringify(result), contentType: 'application/json' });
    expect(result.assessment.issues).toEqual([]);
    expect(result.truncatedAssessment.issues).toEqual([]);
    expect(result.repeated).toEqual(result.done);
    expect(result.truncated.summary).toEqual(result.done.summary);
    expect(result.truncated.damageRecords).toEqual([]);
    expect(result.release.released).toBe(true);
    expect(result.liveWorker).toBe(false);
    expect(result.done.summary.execution!.complete).toBe(true);
    if (scenario === 'counter') {
      expect(result.done.summary.sourceDamageDealt).toBe(170);
      expect(result.done.attackRecords!.map(row => row.postDefenseDamage)).toEqual([15, 15, 55, 15, 15, 55]);
    } else if (scenario === 'cooldown') {
      expect(result.done.summary.sourceDamageDealt).toBe(95);
      expect(result.done.attackRecords!.map(row => row.postDefenseDamage)).toEqual([40, 15, 40]);
    } else if (scenario === 'periodic' || scenario === 'vamp') {
      expect(result.done.summary.sourceDamageDealt).toBe(45);
      expect(result.done.attackRecords!.map(row => row.postDefenseDamage)).toEqual([10, 10, 10]);
      expect(result.done.damageRecords!.filter(row => row.attackIndex === 0).map(row => row.timeMs)).toEqual([500, 1500, 2500]);
      expect(result.done.summary.sourceFinalHp).toBe(scenario === 'vamp' ? 504.5 : 500);
      expect(result.done.summary.sourceVampHealing).toBe(scenario === 'vamp' ? 4.5 : 0);
    } else if (scenario === 'target_death' || scenario === 'source_death') {
      expect(result.done.summary.stopReason).toBe(scenario === 'target_death' ? 'target_dead' : 'source_dead');
      expect(result.done.summary.basicAttack!.completedCount).toBe(2);
      expect(result.done.finalSnapshot.timeMs).toBe(1500);
      expect(result.done.attackRecords!.at(-1)!.nextStartAtMs).toBeNull();
      expect(result.done.summary.execution!.targetKilled).toBe(scenario === 'target_death');
      if (scenario === 'target_death') expect(result.done.summary.execution!.targetKilledAtMs).toBe(1500);
    } else {
      expect(result.done.attackRecords!.map(row => row.startAtMs)).toEqual([0, 700]);
      expect(result.done.attackRecords![1]!.finalReadyAtMs).toBe(1500);
      expect(result.done.summary.sourceDamageDealt).toBe(30);
    }
  });
}
