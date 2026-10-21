import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadMechanismCases } from '../../tests/mechanisms/mechanismCase';
import { mechanismEngine } from '../../tests/mechanisms/mechanismRunner';
import { preflightSkillFormulas } from './skillFormulaPreflight';
import { inspectSimulationSnapshot, prepareSimulation } from './simulationAdapter';
import { simulationAutomaticCastCosts } from './simulationActiveSkills';
import { skillActionRequest } from './skillActionRequest';
import type { GenericEngineClient } from './genericEngineClient';
import { validateSimulationSnapshot } from '../services/simulationSnapshotClient';

const definitions = loadMechanismCases().filter(row => row.caseKey.startsWith('moment_slow_'));
describe('有期普通减速固定JSON的生产准备链（不宣称新模式已运行）', () => {
  it.each(definitions.map(row => [row.caseKey, row] as const))('%s', async (_key, definition) => {
    const snapshot = definition.buildSnapshot(), scene = definition.scenario;
    validateSimulationSnapshot(snapshot, snapshot.gameId, snapshot.selection);
    const { client } = await mechanismEngine();
    await preflightSkillFormulas(snapshot, client as unknown as GenericEngineClient, () => true);
    const ignored = simulationAutomaticCastCosts(snapshot), inspection = inspectSimulationSnapshot(snapshot, ignored);
    expect(inspection.requirements.filter(row => row.storedValue === undefined)).toEqual([]);
    const prepared = await prepareSimulation(snapshot, { source: {}, target: {} }, scene.initialHealth, [], [], ignored);
    const built = await skillActionRequest(prepared, snapshot, { durationMs: scene.durationMs, recordTimeSeries: false, attackSpeedInputMax: scene.attackSpeedInputMax,
      actions: scene.actions!, maxSkillActionRecords: 1000, maxSkillUseRecords: 1000, maxHealingRecords: 1000 }, 'adapter-probe-session');
    expect(built.runRequest.driverPlan?.basicAttack).toBeDefined();
    const contributions = prepared.compileRequest.sharedProviders!.flatMap(provider => provider.statusContributions ?? []);
    expect(contributions.length).toBeGreaterThan(0);
    expect(contributions.every(row => row.valueReadMode === undefined || row.valueReadMode === 'MOMENT_EVALUATION')).toBe(true);
    if (process.env.Q_ADAPTER_EXPORT === '1') {
      const directory = new URL('../../../output/skill-adaptation-20261021-chogath/q-adapter/', import.meta.url);
      mkdirSync(directory, { recursive: true });
      writeFileSync(new URL(`${definition.caseKey}.compile.json`, directory), JSON.stringify(prepared.compileRequest, null, 2) + '\n');
      writeFileSync(new URL(`${definition.caseKey}.run.json`, directory), JSON.stringify(built.runRequest, null, 2) + '\n');
    }
  }, 60000);
});
