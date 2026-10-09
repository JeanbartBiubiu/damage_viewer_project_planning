import type { SkillActionInputs } from '../../src/engine/skillActionRequest';
import type { SimulationCastCostRef } from '../../src/engine/simulationActiveSkills';
import type { SimulationSnapshot } from '../../src/types/simulationSnapshot';
import type { DoneResult, RunRequest } from '../../src/types/genericEngine';
import { prepareSimulation, inspectSimulationSnapshot } from '../../src/engine/simulationAdapter';
import { skillActionRequest } from '../../src/engine/skillActionRequest';
import { assessSkillActionResult } from '../../src/engine/skillActionResult';
import { GenericEngineClient } from '../../src/engine/genericEngineClient';
import { preflightSkillFormulas } from '../../src/engine/skillFormulaPreflight';
import { validateConsumedFormulaValues, validateApprovedFormulaValues } from '../../src/engine/approvedFormulaValues';

export async function runMixedWorkerCase(snapshot: SimulationSnapshot, inputs: SkillActionInputs, iterations = 100,
  costs: SimulationCastCostRef[] = [], attributeInputs?: { source: Record<string, number>; target: Record<string, number> },
  initialHealth?: { source: number; target: number }, inputVariants: SkillActionInputs[] = []) {
  const client = new GenericEngineClient();
  const formulaPreflight = await preflightSkillFormulas(snapshot, client);
  const attributes = attributeInputs ?? { source: {} as Record<string, number>, target: {} as Record<string, number> };
  if (!attributeInputs) for (const row of inspectSimulationSnapshot(snapshot, costs).requirements) {
    if (row.storedValue === undefined) attributes[row.side][row.attribute.attributeKey] = 0;
  }
  const prepared = await prepareSimulation(snapshot, attributes, initialHealth ?? { source: snapshot.source.selectedLevelValues.hp! * .3,
    target: snapshot.target.selectedLevelValues.hp! }, [], [], costs);
  let sessionId: string | null = null;
  const compare = (first: unknown, second: unknown, label: string) => {
    if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error(label);
  };
  const checked = (request: RunRequest, done: DoneResult) => {
    const assessment = assessSkillActionResult(prepared.compileRequest, request, done, prepared.operationOrigins);
    if (!assessment.complete) throw new Error(JSON.stringify({ assessment, summary: done.summary, attacks: done.attackRecords, damage: done.damageRecords, healing: done.healingRecords }));
  };
  try {
    const compiled = await client.compile(prepared.compileRequest);
    if (!compiled.ok || !compiled.sessionId) throw new Error(JSON.stringify(compiled.errors));
    sessionId = compiled.sessionId;
    validateConsumedFormulaValues(prepared.approvedFormulaValues, prepared.compileRequest.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
    validateApprovedFormulaValues(prepared.compileRequest.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
    const run = await skillActionRequest(prepared, snapshot, inputs, sessionId);
    const baseline = await client.run(run.runRequest);
    checked(run.runRequest, baseline);
    if (run.runRequest.driverPlan.basicAttack) {
      const mutations: Array<(done: DoneResult) => void> = [
        done => { if (done.attackRecords?.[0]) done.attackRecords[0].attackIndex = 2; },
        done => { delete (done.summary.basicAttack as unknown as Record<string, unknown>).initialActionReadyAtMs; },
        done => { if (done.attackRecords?.[0]) delete (done.attackRecords[0] as unknown as Record<string, unknown>).actionReadyAtMs; },
        done => {
          const first = done.attackRecords?.[0];
          if (first?.nextStartAtMs !== null && first) first.actionReadyAtMs = first.finalReadyAtMs;
        },
        done => {
          const process = done.finalSnapshot.processInstances?.find(process => process.skillKey === run.runRequest.driverPlan.skillActions![0]!.skillKey);
          if (process && done.summary.basicAttack!.initialActionReadyAtMs !== null) process.providerRef = 'forged_occupied_provider';
        },
        done => { if (done.damageRecords?.[0]) done.damageRecords[0].owner = 'target'; },
        done => { const active = done.damageRecords?.find(row => row.instructionKey); if (active) active.attackIndex = 1; },
        done => { const active = done.damageRecords?.find(row => row.instructionKey); if (active) active.useRef = done.attackRecords![0]!.useRef; },
        done => { const active = done.damageRecords?.find(row => row.instructionKey); if (active) active.hitRef = 'forged_hit'; },
        done => { const active = done.damageRecords?.find(row => row.instructionKey); if (active) active.instructionKey = 'unknown_instruction'; }
      ];
      for (const mutation of mutations) {
        const invalid = structuredClone(baseline); mutation(invalid);
        if (JSON.stringify(invalid) === JSON.stringify(baseline)) continue;
        const invalidAssessment = assessSkillActionResult(prepared.compileRequest, run.runRequest, invalid, prepared.operationOrigins);
        if (invalidAssessment.factsValid) throw new Error('不合法刀号、行动字段、拥有者或主动身份未被严格拒绝');
      }
    }
    for (let iteration = 1; iteration < iterations; iteration++) compare(await client.run(run.runRequest), baseline, `同Worker第${iteration + 1}次结果不同`);
    const runVariants: RunRequest[] = [
      { ...run.runRequest, recordBudget: { maxAttackRecords: 0, maxDamageRecords: 0, maxMechanicRecords: 0, maxSkillActionRecords: 0, maxSkillUseRecords: 0, maxHealingRecords: 0 } },
      { ...run.runRequest, recordBudget: { maxAttackRecords: 1, maxDamageRecords: 1, maxMechanicRecords: 1, maxSkillActionRecords: 1, maxSkillUseRecords: 1, maxHealingRecords: 1 } },
      { ...run.runRequest, sampling: { ...run.runRequest.sampling, disabled: true } }
    ];
    const variants = [];
    for (const request of runVariants) {
      const done = await client.run(request);
      checked(request, done);
      compare(done.finalSnapshot, baseline.finalSnapshot, '记录或采样改变真实最终状态');
      compare(done.summary, baseline.summary, '记录或采样改变完整累计');
      variants.push({ recording: done.recording, summary: done.summary });
    }
    const inputVariantResults = [];
    for (const variantInputs of inputVariants) {
      const variant = await skillActionRequest(prepared, snapshot, variantInputs, sessionId);
      const done = await client.run(variant.runRequest);
      checked(variant.runRequest, done);
      runVariants.push(variant.runRequest);
      inputVariantResults.push({ summary: done.summary, skillActionRecords: done.skillActionRecords, attackRecords: done.attackRecords });
    }
    let rejectedHash = false;
    try { await client.run({ ...run.runRequest, expectedRulesHash: 'invalid_rules_hash' }); } catch { rejectedHash = true; }
    if (!rejectedHash) throw new Error('错误摘要没有被拒绝');
    compare(await client.run(run.runRequest), baseline, '错误摘要后未从初态恢复');
    const release = await client.release(sessionId, prepared.compileRequest.rulesHash);
    sessionId = null;
    return { prepared, compile: compiled, formulaPreflight, runRequest: run.runRequest, runInputHash: run.runInputHash, baseline, runVariants, variants, inputVariantResults, iterations, release };
  } finally {
    if (sessionId && client.hasLiveWorker) await client.release(sessionId, prepared.compileRequest.rulesHash);
    client.terminate();
  }
}
