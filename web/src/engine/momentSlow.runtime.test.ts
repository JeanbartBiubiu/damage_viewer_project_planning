import { beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadMechanismCases } from '../../tests/mechanisms/mechanismCase';
import { mechanismEngine, runMechanismCase, type MechanismRun } from '../../tests/mechanisms/mechanismRunner';
import { projectFinalStatuses } from '../../tests/mechanisms/statusProjection';
import { simulationInitialSnapshot } from './simulationInitialSnapshot';
import { assessSkillActionResult } from './skillActionResult';
import { automaticSkillRequest } from './automaticSkillRequest';
import { assessAutomaticSkillResult } from './automaticSkillResult';
import type { CompileRequest, DoneResult, RunRequest } from '../types/genericEngine';

const definitions = loadMechanismCases();
let reference: MechanismRun;
beforeAll(async () => {
  reference = await runMechanismCase(definitions.find(row => row.caseKey === 'moment_slow_landing')!);
  save('reference', reference.prepared.compileRequest, reference.runRequest, reference.done);
}, 60000);

function save(name: string, input: CompileRequest, request: RunRequest, done: DoneResult) {
  const directory = new URL('../../../output/skill-adaptation-20261021-chogath/q-adapter/', import.meta.url);
  mkdirSync(directory, { recursive: true });
  writeFileSync(new URL(`${name}.actual.json`, directory), JSON.stringify({ input, request, done }, null, 2) + '\n');
}
async function fresh(name: string, input: CompileRequest, amend: (request: RunRequest) => void = () => {}) {
  const { client } = await mechanismEngine();
  input.rulesHash += `/${name}`;
  const compiled = await client.compile(input);
  expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true);
  try {
    const request = structuredClone(reference.runRequest);
    Object.assign(request, { sessionId: compiled.sessionId!, expectedRulesHash: input.rulesHash, rulesHash: input.rulesHash,
      initialSnapshot: simulationInitialSnapshot(input) });
    amend(request);
    const done = await client.run(request); save(name, input, request, done);
    expect(done.ok, JSON.stringify(done.errors)).toBe(true);
    expect(await client.run(request)).toEqual(done);
    return done;
  } finally { expect((await client.release(compiled.sessionId!, input.rulesHash)).released).toBe(true); }
}

describe('实例时间普通减速的正式Wasm补充边界', () => {
  it('500毫秒施法占用后真实普攻恢复，1125只有一次真实接触，不为落地另发hit', () => {
    expect(reference.done.attackRecords![0]!.startAtMs).toBe(500);
    const spells = reference.done.damageRecords!.filter(row => row.operationRef === 'skills.lab_transfer.effects.qualification.results.damage');
    expect(spells).toHaveLength(1); expect(spells[0]!.timeMs).toBe(1125);
    expect(reference.done.skillUseRecords!.filter(row => row.skillKey === 'lab_transfer' && row.kind === 'HIT').map(row => row.timeMs)).toEqual([1125]);
    expect(reference.projection.finalEffectiveStatuses).toEqual([{ owner: 'target', statusKind: 'movement_slow', strength: .6 }]);
  });
  it('初始明确合格的Generic法盾在唯一真实接触阻挡伤害及两状态，不声明作者装备法盾能力', async () => {
    const input = structuredClone(reference.prepared.compileRequest);
    input.typeCatalog.types.push({ key: 'provider/spell_shield', domain: 'provider' });
    input.sharedProviders!.push({ providerKey: 'q_infrastructure_initial_shield', stableId: 'q_infrastructure_initial_shield', kind: 'character', types: ['provider/spell_shield'] });
    input.combatants.find(row => row.key === 'target')!.providers.push({ providerRef: 'q_initial_shield', definitionRef: 'q_infrastructure_initial_shield' });
    const done = await fresh('initial-shield', input);
    expect(done.summary.sourceDamageDealt).toBe(0);
    expect(projectFinalStatuses(input, done)).toEqual({ finalStatusContributions: [], finalEffectiveStatuses: [] });
    expect(done.finalSnapshot.combatants.find(row => row.key === 'target')!.providers.some(row => row.definitionRef.includes('airborne'))).toBe(false);
    expect(done.evidence.items).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'skill_hit',
      data: expect.objectContaining({ skillKey: 'lab_transfer', blocked: 1, blockScope: 'SKILL' }) })]));
  }, 60000);
  it('接触成立后1500毫秒新增Generic法盾不会在2125落地再判定，也不会吞掉已挂的减速', async () => {
    const input = structuredClone(reference.prepared.compileRequest);
    input.typeCatalog.types.push({ key: 'provider/spell_shield', domain: 'provider' });
    input.sharedProviders!.push({ providerKey: 'q_infrastructure_later_shield', stableId: 'q_infrastructure_later_shield', kind: 'status',
      types: ['provider/spell_shield'], lifecycle: { durationMs: { op: 'const', value: 5000 }, maxStacks: 1, refreshPolicy: 'replace', instanceScope: 'source_target' } },
    { providerKey: 'q_infrastructure_grant', stableId: 'q_infrastructure_grant', kind: 'character', skillKey: 'generic_shield_probe',
      abilities: [{ abilityKey: 'grant', kind: 'active', skillKey: 'generic_shield_probe', processControl: { processKey: 'grant', action: 'INITIAL' } }],
      processes: [{ processKey: 'grant', skillKey: 'generic_shield_probe', steps: [{ stepKey: 'grant', stepType: 'IMMEDIATE', occupiesAction: false }],
        costs: [], cooldown: null, momentOperations: [{ moment: { momentType: 'PROCESS_START', stepKey: null, failureReason: null },
          operations: [{ operation: 'apply_provider', target: 'target', providerDefinitionRef: 'q_infrastructure_later_shield' }] }] }] });
    input.combatants.find(row => row.key === 'source')!.providers.push({ providerRef: 'q_grant', definitionRef: 'q_infrastructure_grant' });
    input.rules.skillActionBindings!.push({ bindingKey: 'generic_shield_probe', source: 'source', providerRef: 'q_grant', providerDefinitionRef: 'q_infrastructure_grant',
      skillKey: 'generic_shield_probe', controls: [{ action: 'INITIAL', processKey: 'grant', abilityRef: 'source.provider[q_grant].ability[grant]' }], hitBindings: [] });
    const done = await fresh('later-shield', input, request => request.driverPlan!.skillActions!.push({ instructionKey: 'generic_shield_probe',
      bindingKey: 'generic_shield_probe', skillKey: 'generic_shield_probe', action: 'INITIAL', hitBindings: [], parentInstructionKey: null,
      abilityRef: 'source.provider[q_grant].ability[grant]', source: 'source', target: 'target', firstAtMs: 1500, sortOrder: 1 }));
    expect(done.summary.sourceDamageDealt).toBe(100);
    expect(projectFinalStatuses(input, done).finalEffectiveStatuses).toEqual([{ owner: 'target', statusKind: 'movement_slow', strength: .6 }]);
    expect(done.finalSnapshot.combatants.find(row => row.key === 'target')!.providers.some(row => row.definitionRef === 'q_infrastructure_later_shield')).toBe(true);
  }, 60000);
  it.each(['appliedAtMs', 'source', 'owner', 'strength', 'aggregate', 'missing_aggregate', 'duplicate'])('投影拒绝缺失或矛盾的真实状态事实 %s', kind => {
    const done = structuredClone(reference.done), target = done.finalSnapshot.combatants.find(row => row.key === 'target')!;
    const provider = target.providers.find(row => row.definitionRef === 'status:lab_transfer:landing:slow')!;
    if (['appliedAtMs', 'source', 'owner'].includes(kind)) delete (provider as unknown as Record<string, unknown>)[kind];
    if (kind === 'strength') provider.statusContributions![0]!.strength = 1.1;
    if (kind === 'aggregate') target.effectiveStatuses![0]!.strength = .8;
    if (kind === 'missing_aggregate') target.effectiveStatuses = [];
    if (kind === 'duplicate') provider.statusContributions!.push({ ...provider.statusContributions![0]! });
    expect(() => projectFinalStatuses(reference.prepared.compileRequest, done)).toThrow();
  });
  it('0记录预算仍在安静终点读取实际实例强度，同会话重放且释放', async () => {
    const { client } = await mechanismEngine(), input = reference.prepared.compileRequest, compiled = await client.compile(input);
    expect(compiled.ok).toBe(true);
    try {
        const request = structuredClone(reference.runRequest); request.sessionId = compiled.sessionId!;
        request.recordBudget = Object.fromEntries(Object.keys(request.recordBudget!).map(key => [key, 0]));
        const done = await client.run(request); save('zero-records', input, request, done);
        expect(done.finalSnapshot).toEqual(reference.done.finalSnapshot); expect(done.summary).toEqual(reference.done.summary);
        expect(projectFinalStatuses(input, done)).toEqual(projectFinalStatuses(input, reference.done));
        const assessment = assessSkillActionResult(input, request, done, reference.prepared.operationOrigins);
        expect(assessment.complete, assessment.issues.join(';')).toBe(true);
        expect(await client.run(request)).toEqual(done);
    } finally { expect((await client.release(compiled.sessionId!, input.rulesHash)).released).toBe(true); }
  }, 60000);
  it('正式自动请求入口的详细、summary与0预算保持完整状态和累计，重放后释放', async () => {
    const { client } = await mechanismEngine(), input = reference.prepared.compileRequest, compiled = await client.compile(input);
    expect(compiled.ok).toBe(true);
    try {
      const definition = definitions.find(row => row.caseKey === 'moment_slow_landing')!, snapshot = definition.buildSnapshot();
      const plan = snapshot.selection.plannedSkills[0]!;
      const { runRequest } = await automaticSkillRequest(reference.prepared, snapshot, { durationMs: 2125, recordTimeSeries: false,
        attackSpeedInputMax: 1, outputMode: 'detailed', maxAutomaticSkillRecords: 1000, maxHealingRecords: 1000, maxResourceChangeRecords: 1000,
        rules: [{ origin: plan.origin, skillKey: plan.skillKey, skillLevel: 1, ruleKey: 'timed_slow', sortOrder: 0, targetSide: 'target',
          hitPreset: 'TARGET_HIT', waitForCooldowns: [], releaseAfterRuleKey: null }] }, compiled.sessionId!);
      const detailed = await client.run(runRequest);
      expect(detailed.summary.sourceDamageDealt).toBe(100);
      expect(projectFinalStatuses(input, detailed).finalEffectiveStatuses).toEqual([{ owner: 'target', statusKind: 'movement_slow', strength: .6 }]);
      const assess = (request: RunRequest, done: DoneResult) => {
        const result = assessAutomaticSkillResult(input, request, done, reference.prepared.operationOrigins);
        expect(result.complete, result.issues.join(';')).toBe(true);
      };
      assess(runRequest, detailed);
      for (const summary of [false, true]) {
        const request = structuredClone(runRequest);
        if (summary) request.outputMode = 'summary';
        else request.recordBudget = Object.fromEntries(Object.keys(request.recordBudget!).map(key => [key, 0]));
        const done = await client.run(request); save(summary ? 'automatic-summary' : 'automatic-zero-records', input, request, done);
        expect(done.finalSnapshot).toEqual(detailed.finalSnapshot); expect(done.summary).toEqual(detailed.summary);
        expect(projectFinalStatuses(input, done)).toEqual(projectFinalStatuses(input, detailed));
        assess(request, done); expect(await client.run(request)).toEqual(done);
      }
    } finally { expect((await client.release(compiled.sessionId!, input.rulesHash)).released).toBe(true); }
  }, 60000);
});
