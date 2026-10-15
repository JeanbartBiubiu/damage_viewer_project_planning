import { GenericEngineClient } from '../../src/engine/genericEngineClient';
import { assessAutomaticSkillResult } from '../../src/engine/automaticSkillResult';
import type { CompileRequest, DriverPlan, InitialSnapshot, RunRequest, SamplingConfig, StopPolicy } from '../../src/types/genericEngine';

/** 原生构造允许省略宿主传输默认项；业务字段与原始作者输入保持。 */
export type NativeAutomaticInput = {
  compileRequest: CompileRequest;
  runRequest: Omit<Partial<RunRequest>, 'driverPlan' | 'sampling'> & { initialSnapshot: InitialSnapshot; stopPolicy: StopPolicy;
    driverPlan: Partial<DriverPlan> & Pick<DriverPlan, 'entries'>; sampling?: Partial<SamplingConfig> };
};

/** 正式工作线程直接执行通用协议，不经过英雄作者闭包适配。 */
export async function runNativeAutomaticWorkerCase(input: NativeAutomaticInput) {
  const client = new GenericEngineClient();
  let sessionId: string | null = null;
  try {
    const compiled = await client.compile(input.compileRequest);
    if (!compiled.ok || !compiled.sessionId || compiled.rulesHash !== input.compileRequest.rulesHash
      || compiled.schemaHash !== input.compileRequest.schemaHash) throw new Error(`原生构造编译失败或摘要不一致：${JSON.stringify(compiled)}`);
    sessionId = compiled.sessionId;
    const request: RunRequest = { ...input.runRequest, sessionId, expectedRulesHash: compiled.rulesHash,
      schemaVersion: input.compileRequest.schemaVersion, schemaHash: input.compileRequest.schemaHash, rulesHash: input.compileRequest.rulesHash,
      driverPlan: { ...input.runRequest.driverPlan, conditionRecheckIntervalMs: input.runRequest.driverPlan.conditionRecheckIntervalMs ?? 100 },
      sampling: { sampleEveryMs: 100, dpsWindowMs: 1000, maxSeriesPoints: 5000, ...input.runRequest.sampling } };
    const done = await client.run(request);
    const assessment = assessAutomaticSkillResult(input.compileRequest, request, done);
    if (!assessment.complete) throw new Error(`通用自动结果不完整：${JSON.stringify({ assessment, request, done })}`);
    const release = await client.release(sessionId, input.compileRequest.rulesHash);
    if (!release.released || release.sessionId !== sessionId) throw new Error('原生构造会话释放未通过');
    sessionId = null;
    return { compiled, request, done, assessment, release };
  } finally {
    if (sessionId && client.hasLiveWorker) await client.release(sessionId, input.compileRequest.rulesHash);
    client.terminate();
  }
}
