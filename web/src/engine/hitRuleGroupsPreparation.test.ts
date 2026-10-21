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

const cases = loadMechanismCases().filter(row => row.caseKey.startsWith('hit_rule_group_'));
describe('同次使用命中规则组固定JSON的生产准备链', () => {
  it.each(cases.map(row => [row.caseKey, row] as const))('%s', async (_key, definition) => {
    const snapshot = definition.buildSnapshot(), scene = definition.scenario;
    validateSimulationSnapshot(snapshot, snapshot.gameId, snapshot.selection);
    const { client } = await mechanismEngine();
    await preflightSkillFormulas(snapshot, client as unknown as GenericEngineClient, () => true);
    const ignored = simulationAutomaticCastCosts(snapshot), inspection = inspectSimulationSnapshot(snapshot, ignored);
    expect(inspection.requirements.filter(row => row.storedValue === undefined)).toEqual([]);
    const prepared = await prepareSimulation(snapshot, { source: {}, target: {} }, scene.initialHealth, [], [], ignored);
    const built = await skillActionRequest(prepared, snapshot, { durationMs: scene.durationMs, recordTimeSeries: false,
      attackSpeedInputMax: scene.attackSpeedInputMax, actions: scene.actions!, maxSkillActionRecords: 1000, maxSkillUseRecords: 1000,
      maxHealingRecords: 1000, maxResourceChangeRecords: 1000 }, 'adapter-probe-session');
    expect(built.runRequest.driverPlan.basicAttack).toBeDefined();
    const groups = prepared.compileRequest.sharedProviders!.flatMap(provider => provider.abilities ?? [])
      .flatMap(ability => ability.operations ?? []).flatMap(operation => operation.skillHit?.ruleGroups ?? []);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every(group => group.candidateKeys.length > 0)).toBe(true);
    for (const group of groups) expect(prepared.coverage.some(row => row.authorPath.endsWith(`.triggerRules.${group.ruleKey}.oncePerUse`))).toBe(true);
    if (process.env.Q_RULE_GROUP_EXPORT === '1') {
      const directory = new URL('../../../output/skill-adaptation-20261021-chogath/q-rule-groups/', import.meta.url);
      mkdirSync(directory, { recursive: true });
      writeFileSync(new URL(`${definition.caseKey}.compile.json`, directory), JSON.stringify(prepared.compileRequest, null, 2) + '\n');
      writeFileSync(new URL(`${definition.caseKey}.run.json`, directory), JSON.stringify(built.runRequest, null, 2) + '\n');
    }
  }, 60000);
});
