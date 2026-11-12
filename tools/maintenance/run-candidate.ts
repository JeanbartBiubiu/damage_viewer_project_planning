import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { TinyGoV2Bridge } from '../../web/src/engine/tinygoV2Bridge';
import { parseCompileResult, parseDoneResult, parseReleaseResult, type GenericEngineClient } from '../../web/src/engine/genericEngineClient';
import { registerFormulaForApprovedReads, validateApprovedFormulaValues, validateConsumedFormulaValues } from '../../web/src/engine/approvedFormulaValues';
import { validateSimulationSnapshot } from '../../web/src/services/simulationSnapshotClient';
import { preflightSkillFormulas } from '../../web/src/engine/skillFormulaPreflight';
import { inspectSimulationSnapshot, prepareSimulation, SIMULATION_ADAPTER_VERSION } from '../../web/src/engine/simulationAdapter';
import { continuousAttackRequest } from '../../web/src/engine/continuousAttackRequest';
import { skillActionRequest, type SkillActionInput } from '../../web/src/engine/skillActionRequest';
import { assessContinuousAttackResult } from '../../web/src/engine/continuousAttackResult';
import { assessSkillActionResult } from '../../web/src/engine/skillActionResult';
import { WASM_IDENTITY } from '../../web/src/engine/wasmIdentity';
import type { CompileRequest, RunRequest } from '../../web/src/types/genericEngine';
import type { SimulationSnapshot, SimulationAttributeInputs, SimulationInitialHealth, SimulationEquipmentAssumption,
  SimulationMechanicStateInput, SimulationInitialResourceInput } from '../../web/src/types/simulationSnapshot';
import type { SimulationCastCostRef } from '../../web/src/engine/simulationActiveSkills';
import type { SceneInitialParameterInput } from '../../web/src/engine/sceneInitialParameterInput';
import { validateCandidate, candidateSnapshot } from './candidate.mjs';

type Scenario = { mode: 'fixed' | 'continuous'; durationMs: number; attributeInputs: SimulationAttributeInputs;
  initialHealth: SimulationInitialHealth; actions?: SkillActionInput[]; equipmentAssumptions?: SimulationEquipmentAssumption[];
  mechanicStateInputs?: SimulationMechanicStateInput[]; sceneParameterInputs?: SceneInitialParameterInput[];
  initialResourceInputs?: SimulationInitialResourceInput[]; ignoredCastCosts?: SimulationCastCostRef[] };
const ensure: (value: unknown, message: string) => asserts value = (value, message) => { if (!value) throw new Error(message); };
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i], value = process.argv[i + 1];
  ensure(['--candidate', '--output', '--grant-file'].includes(name) && value && !args.has(name), '参数错误。');
  args.set(name, value);
}
ensure(args.has('--candidate') && args.has('--output'), '缺少候选或输出目录。');
const candidate = validateCandidate(JSON.parse(readFileSync(args.get('--candidate')!, 'utf8')));
const bytes = readFileSync(new URL('../../web/src/engine/wasm/tinygo_engine_v2.wasm', import.meta.url));
const engineDigest = createHash('sha256').update(bytes).digest('hex');
ensure(engineDigest === WASM_IDENTITY.sha256 && bytes.length === WASM_IDENTITY.bytes, '引擎分发身份不符。');
let grant: string | undefined;
if (WASM_IDENTITY.authorizationRequired) {
  ensure(args.has('--grant-file'), '正式候选计算需要维护计算票据文件。');
  const input: unknown = JSON.parse(readFileSync(args.get('--grant-file')!, 'utf8'));
  ensure(input && typeof input === 'object' && 'grant' in input && typeof input.grant === 'string', '计算票据文件无效。');
  grant = input.grant;
  const parts = grant.split('.');
  ensure(parts.length === 3, '维护票据格式错误。');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
  ensure(claims.subjectType === 'MAINTENANCE' && claims.sub === candidate.principalId && claims.authorizationVersion === 2,
    '票据不属于本次维护主体。');
}
const bridge = await TinyGoV2Bridge.create({ wasmUrl: `data:application/wasm;base64,${bytes.toString('base64')}` });
const node = {
  hasLiveWorker: true,
  async compile(request: CompileRequest) {
    const response = parseCompileResult(bridge.compile({ ...request, ...(grant ? { authorization: grant } : {}) }));
    if (response.ok) for (const formula of request.formulas ?? []) registerFormulaForApprovedReads(formula);
    return response;
  },
  async run(request: RunRequest) { return parseDoneResult(bridge.run({ ...request, ...(grant ? { authorization: grant } : {}) })); },
  async release(sessionId: string, expectedRulesHash?: string) { return parseReleaseResult(bridge.releaseSession(sessionId, expectedRulesHash)); }
};
const client = node as unknown as GenericEngineClient;
const files: { id: string; file: string; sha256: string }[] = [];
let completed = 0;
const directory = resolve(args.get('--output')!);
try {
  for (const scene of candidate.scenes) {
    const scenario = scene.scenario as Scenario;
    ensure(Number.isSafeInteger(scenario.durationMs) && scenario.durationMs > 0 && scenario.durationMs <= 600_000, '场景时长错误。');
    const snapshot = candidateSnapshot(candidate, scene) as SimulationSnapshot;
    validateSimulationSnapshot(snapshot, candidate.gameId, snapshot.selection);
    const original = structuredClone(snapshot);
    const inputs = scenario.sceneParameterInputs ?? [], ignored = scenario.ignoredCastCosts ?? [];
    await preflightSkillFormulas(snapshot, client, () => true, inputs);
    const inspection = inspectSimulationSnapshot(snapshot, ignored, inputs);
    ensure(inspection.requirements.every(row => row.storedValue !== undefined
      || Object.hasOwn(scenario.attributeInputs[row.side], row.attribute.attributeKey)), '场景存在未提供的必要属性。');
    const prepared = await prepareSimulation(snapshot, structuredClone(scenario.attributeInputs), structuredClone(scenario.initialHealth),
      scenario.equipmentAssumptions ?? [], scenario.mechanicStateInputs ?? [], ignored, inputs, scenario.initialResourceInputs ?? []);
    let sessionId: string | null = null;
    let done: Awaited<ReturnType<typeof node.run>> | undefined;
    let request: RunRequest | undefined;
    let released = false;
    try {
      const compiled = await node.compile(prepared.compileRequest);
      ensure(compiled.ok && compiled.sessionId, '候选编译失败。');
      sessionId = compiled.sessionId;
      validateConsumedFormulaValues(prepared.approvedFormulaValues, prepared.compileRequest.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
      validateApprovedFormulaValues(prepared.compileRequest.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
      const common = { durationMs: scenario.durationMs, recordTimeSeries: false, attackSpeedInputMax: 10 };
      const built = scenario.mode === 'fixed'
        ? await skillActionRequest(prepared, snapshot, { ...common, actions: scenario.actions ?? [], maxSkillActionRecords: 2000,
          maxSkillUseRecords: 2000, maxHealingRecords: 2000, maxResourceChangeRecords: 2000 }, sessionId)
        : await continuousAttackRequest(prepared, snapshot, common, sessionId);
      ensure(scenario.mode !== 'fixed' || scenario.actions?.length, '固定技能场景不能为空。');
      request = built.runRequest;
      done = await node.run(request);
      const assessment = scenario.mode === 'fixed'
        ? assessSkillActionResult(prepared.compileRequest, request, done, prepared.operationOrigins)
        : assessContinuousAttackResult(prepared.compileRequest, request, done, prepared.operationOrigins);
      ensure(assessment.complete && assessment.issues.length === 0 && done.summary.execution?.complete
        && done.summary.execution.budgetCause === null, '候选执行不完整。');
      ensure(done.recording && !Object.entries(done.recording).some(([key, value]) => key.endsWith('Truncated') && value === true), '候选记录被截断。');
      ensure(isDeepStrictEqual(done, await node.run(request)) && isDeepStrictEqual(snapshot, original), '候选运行不确定或修改了输入。');
    } finally {
      if (sessionId) {
        const release = await node.release(sessionId, prepared.compileRequest.rulesHash);
        ensure(release.released && release.sessionId === sessionId, '候选会话释放未确认。');
        released = true;
      }
    }
    ensure(done && request && released, '缺少真实运行或释放。');
    const result = { id: scene.id, complete: true, candidateDigest: candidate.candidateDigest, engineDigest,
      adapterVersion: SIMULATION_ADAPTER_VERSION, snapshotDigest: snapshot.snapshotDigest, runRequest: request, done, released, runs: 2 };
    const text = `${JSON.stringify(result, null, 2)}\n`, filename = `${scene.id}.json`;
    writeFileSync(resolve(directory, filename), text, { flag: 'wx', mode: 0o600 });
    files.push({ id: scene.id, file: filename, sha256: createHash('sha256').update(text).digest('hex') });
    completed++;
  }
} finally {
  writeFileSync(resolve(directory, 'summary.json'), `${JSON.stringify({ complete: completed === candidate.scenes.length,
    requested: candidate.scenes.length, completed, candidateDigest: candidate.candidateDigest, engineDigest,
    adapterVersion: SIMULATION_ADAPTER_VERSION, authorizationRequired: WASM_IDENTITY.authorizationRequired,
    authorizationVersion: WASM_IDENTITY.authorizationVersion, files }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}
