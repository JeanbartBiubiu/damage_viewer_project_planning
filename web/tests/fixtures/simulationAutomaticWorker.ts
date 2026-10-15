import type { AutomaticSkillInputs } from '../../src/engine/automaticSkillRequest';
import type { SimulationSnapshot } from '../../src/types/simulationSnapshot';
import type { DoneResult, RunRequest } from '../../src/types/genericEngine';
import { prepareSimulation, inspectSimulationSnapshot } from '../../src/engine/simulationAdapter';
import { automaticSkillRequest } from '../../src/engine/automaticSkillRequest';
import { assessAutomaticSkillResult } from '../../src/engine/automaticSkillResult';
import { GenericEngineClient } from '../../src/engine/genericEngineClient';
import { preflightSkillFormulas } from '../../src/engine/skillFormulaPreflight';
import { validateConsumedFormulaValues, validateApprovedFormulaValues } from '../../src/engine/approvedFormulaValues';

export async function runAutomaticWorkerCase(snapshot: SimulationSnapshot, inputs: AutomaticSkillInputs, iterations = 10) {
  const client = new GenericEngineClient();
  const formulaPreflight = await preflightSkillFormulas(snapshot, client);
  const attributes = { source: {} as Record<string, number>, target: {} as Record<string, number> };
  for (const row of inspectSimulationSnapshot(snapshot).requirements) if (row.storedValue === undefined) attributes[row.side][row.attribute.attributeKey] = 0;
  const prepared = await prepareSimulation(snapshot, attributes, { source: 300, target: 5000 });
  let sessionId: string | null = null;
  try {
    const result = await client.compile(prepared.compileRequest);
    if (!result.ok || !result.sessionId) throw new Error(JSON.stringify(result));
    sessionId = result.sessionId;
    validateConsumedFormulaValues(prepared.approvedFormulaValues, prepared.compileRequest.formulas ?? [], result.metadata?.approvedStaticValues ?? {});
    validateApprovedFormulaValues(prepared.compileRequest.formulas ?? [], result.metadata?.approvedStaticValues ?? {});
    const run = await automaticSkillRequest(prepared, snapshot, inputs, sessionId);
    const inspect = (request: RunRequest, done: DoneResult) => {
      const assessment = assessAutomaticSkillResult(prepared.compileRequest, request, done, prepared.operationOrigins);
      if (!assessment.complete) throw new Error(JSON.stringify({ assessment, request, done }));
      return assessment;
    };
    const baseline = await client.run(run.runRequest);
    const assessment = inspect(run.runRequest, baseline);
    for (let iteration = 0; iteration < iterations; iteration++) {
      const repeated = await client.run(run.runRequest);
      inspect(run.runRequest, repeated);
      if (JSON.stringify(repeated) !== JSON.stringify(baseline)) throw new Error('同会话自动运行继承状态或结果发生变化');
    }
    const variants: Array<{ request: RunRequest; done: DoneResult }> = [];
    for (const options of [{ outputMode: 'detailed' as const, maxAutomaticSkillRecords: 0 }, { outputMode: 'summary' as const, maxAutomaticSkillRecords: 1000 }]) {
      const request = (await automaticSkillRequest(prepared, snapshot, { ...inputs, ...options }, sessionId)).runRequest;
      const done = await client.run(request);
      inspect(request, done);
      if (JSON.stringify(done.automaticSkillSummary) !== JSON.stringify(baseline.automaticSkillSummary)
        || JSON.stringify(done.summary) !== JSON.stringify(baseline.summary)) throw new Error('明细模式或预算改变自动完整累计');
      variants.push({ request, done });
    }
    let rejection: string | null = null;
    try { await client.run({ ...run.runRequest, driverPlan: { ...run.runRequest.driverPlan, entries: [{ entryKey: 'illegal', abilityRef: 'unknown', source: 'source', target: 'target', firstAtMs: 0 }] } }); }
    catch (cause) { rejection = cause instanceof Error ? cause.message : String(cause); }
    if (!rejection) throw new Error('自动与外部条目混用未拒绝');
    const recovered = await client.run(run.runRequest);
    inspect(run.runRequest, recovered);
    if (JSON.stringify(recovered) !== JSON.stringify(baseline)) throw new Error('自动错误后重跑继承资格或产生结果变化');
    const released = await client.release(sessionId, prepared.compileRequest.rulesHash);
    sessionId = null;
    if (!released.released) throw new Error('自动会话释放失败');
    const recompiled = await client.compile(prepared.compileRequest);
    if (!recompiled.ok || !recompiled.sessionId) throw new Error('自动释放后重编失败');
    sessionId = recompiled.sessionId;
    const rerun = await client.run({ ...run.runRequest, sessionId });
    inspect({ ...run.runRequest, sessionId }, rerun);
    if (JSON.stringify(rerun) !== JSON.stringify(baseline)) throw new Error('自动释放重编后初态变化');
    const release = await client.release(sessionId, prepared.compileRequest.rulesHash); sessionId = null;
    return { formulaPreflight, prepared, runRequest: run.runRequest, runInputHash: run.runInputHash, baseline, assessment, variants, rejection, release, iterations };
  } finally {
    if (sessionId && client.hasLiveWorker) await client.release(sessionId, prepared.compileRequest.rulesHash);
    client.terminate();
  }
}
