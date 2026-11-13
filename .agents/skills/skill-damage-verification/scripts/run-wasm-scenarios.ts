import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createMaintenanceEngine } from '../../../../tools/maintenance/engine-client';
import { validateSimulationSnapshot } from '../../../../web/src/services/simulationSnapshotClient';
import { inspectSimulationSnapshot, prepareSimulation, SIMULATION_ADAPTER_VERSION } from '../../../../web/src/engine/simulationAdapter';
import type { SimulationCastCostRef } from '../../../../web/src/engine/simulationActiveSkills';
import { preflightSkillFormulas } from '../../../../web/src/engine/skillFormulaPreflight';
import { validateApprovedFormulaValues, validateConsumedFormulaValues } from '../../../../web/src/engine/approvedFormulaValues';
import { skillActionRequest, type SkillActionInput } from '../../../../web/src/engine/skillActionRequest';
import { continuousAttackRequest } from '../../../../web/src/engine/continuousAttackRequest';
import { assessSkillActionResult } from '../../../../web/src/engine/skillActionResult';
import { assessContinuousAttackResult } from '../../../../web/src/engine/continuousAttackResult';
import type { GenericEngineClient } from '../../../../web/src/engine/genericEngineClient';
import type { CompileResult, DoneResult, GenericReleaseDonePayload, RunRequest } from '../../../../web/src/types/genericEngine';
import type { SceneInitialParameterInput } from '../../../../web/src/engine/sceneInitialParameterInput';
import type {
  SimulationAttributeInputs, SimulationEquipmentAssumption, SimulationInitialHealth,
  SimulationInitialResourceInput, SimulationMechanicStateInput, SimulationSnapshot
} from '../../../../web/src/types/simulationSnapshot';

type Scenario = {
  id: string; snapshotFile: string; attributeInputs: SimulationAttributeInputs;
  initialHealth: SimulationInitialHealth; durationMs: number; mode: 'fixed' | 'continuous';
  actions?: SkillActionInput[]; equipmentAssumptions?: SimulationEquipmentAssumption[];
  mechanicStateInputs?: SimulationMechanicStateInput[]; sceneParameterInputs?: SceneInitialParameterInput[];
  initialResourceInputs?: SimulationInitialResourceInput[]; ignoredCastCosts?: SimulationCastCostRef[];
};
type Engine = Awaited<ReturnType<typeof createMaintenanceEngine>>;
type Evidence = {
  id: string; complete: boolean; scene: Scenario; adapterVersion: string; wasmSha256: string; wasmBytes: number;
  snapshotFileSha256?: string; snapshotDigest?: string;
  preflight?: Awaited<ReturnType<typeof preflightSkillFormulas>>;
  prepared?: Awaited<ReturnType<typeof prepareSimulation>>; compiled?: CompileResult;
  runRequest?: RunRequest; done?: DoneResult;
  assessment?: ReturnType<typeof assessSkillActionResult> | ReturnType<typeof assessContinuousAttackResult>;
  repeatIdentical?: boolean; runs?: number; release?: GenericReleaseDonePayload;
  error?: { stage: string; message: string }; releaseError?: string;
};
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const writeNew = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });

function finiteFields(value: unknown, label: string) {
  requireValue(record(value), `${label}必须是对象。`);
  for (const [key, amount] of Object.entries(value)) {
    requireValue(typeof amount === 'number' && Number.isFinite(amount), `${label}.${key}必须是明确有限数值。`);
  }
}

export function validateScenarioPlan(value: unknown): Scenario[] {
  requireValue(record(value) && Array.isArray(value.cases) && value.cases.length > 0, '计划需要非空cases数组。');
  requireValue(Object.keys(value).every(key => key === 'cases'), '计划顶层只接受cases。');
  const ids = new Set<string>();
  const allowed = new Set(['id', 'snapshotFile', 'attributeInputs', 'initialHealth', 'durationMs', 'mode', 'actions',
    'equipmentAssumptions', 'mechanicStateInputs', 'sceneParameterInputs', 'initialResourceInputs', 'ignoredCastCosts']);
  for (const [index, row] of value.cases.entries()) {
    const label = `cases[${index}]`;
    requireValue(record(row) && Object.keys(row).every(key => allowed.has(key)), `${label}包含未知字段或不是对象。`);
    requireValue(typeof row.id === 'string' && /^[a-z0-9][a-z0-9_-]{0,95}$/.test(row.id)
      && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(row.id), `${label}.id须为可用于文件名的唯一小写标识。`);
    requireValue(!ids.has(row.id), `${label}.id重复。`);
    ids.add(row.id);
    requireValue(typeof row.snapshotFile === 'string' && row.snapshotFile.trim().length > 0, `${label}.snapshotFile不能为空。`);
    requireValue(row.mode === 'fixed' || row.mode === 'continuous', `${label}.mode只接受fixed或continuous。`);
    requireValue(typeof row.durationMs === 'number' && Number.isSafeInteger(row.durationMs)
      && row.durationMs >= 1 && row.durationMs <= 600000, `${label}.durationMs须为1～600000整数毫秒。`);
    requireValue(record(row.attributeInputs) && Object.keys(row.attributeInputs).length === 2
      && 'source' in row.attributeInputs && 'target' in row.attributeInputs, `${label}.attributeInputs须明确提供source和target。`);
    finiteFields(row.attributeInputs.source, `${label}.attributeInputs.source`);
    finiteFields(row.attributeInputs.target, `${label}.attributeInputs.target`);
    finiteFields(row.initialHealth, `${label}.initialHealth`);
    requireValue(record(row.initialHealth) && Object.keys(row.initialHealth).length === 2
      && typeof row.initialHealth.source === 'number' && row.initialHealth.source >= 0
      && typeof row.initialHealth.target === 'number' && row.initialHealth.target >= 0,
    `${label}.initialHealth须明确提供双方非负当前生命。`);
    for (const key of ['actions', 'equipmentAssumptions', 'mechanicStateInputs', 'sceneParameterInputs', 'initialResourceInputs', 'ignoredCastCosts']) {
      requireValue(row[key] === undefined || Array.isArray(row[key]), `${label}.${key}须为数组。`);
    }
    requireValue(row.mode !== 'fixed' || Array.isArray(row.actions) && row.actions.length > 0,
      `${label}.actions在fixed模式下不能为空。`);
    requireValue(row.mode !== 'continuous' || row.actions === undefined || Array.isArray(row.actions) && row.actions.length === 0,
      `${label}.actions不能在continuous模式中被忽略。`);
  }
  return value.cases as Scenario[];
}

async function runScenario(scene: Scenario, planDirectory: string, engine: Engine): Promise<Evidence> {
  const client = engine.client as unknown as GenericEngineClient;
  const evidence: Evidence = { id: scene.id, complete: false, scene: structuredClone(scene),
    adapterVersion: SIMULATION_ADAPTER_VERSION, wasmSha256: engine.wasmSha256, wasmBytes: engine.wasmBytes };
  let stage = '读取快照', sessionId: string | null = null;
  try {
    const bytes = readFileSync(resolve(planDirectory, scene.snapshotFile));
    evidence.snapshotFileSha256 = hash(bytes);
    const input: unknown = JSON.parse(bytes.toString('utf8'));
    requireValue(record(input) && typeof input.gameId === 'string' && record(input.selection), '快照缺少游戏及场景选择。');
    const snapshot = validateSimulationSnapshot(input, input.gameId, input.selection as SimulationSnapshot['selection']);
    const original = structuredClone(snapshot);
    evidence.snapshotDigest = snapshot.snapshotDigest;
    const sceneInputs = scene.sceneParameterInputs ?? [];
    const ignoredCosts = scene.ignoredCastCosts ?? [];
    stage = '公式预检';
    evidence.preflight = await preflightSkillFormulas(snapshot, client, () => true, sceneInputs);
    stage = '装配场景';
    const inspection = inspectSimulationSnapshot(snapshot, ignoredCosts, sceneInputs);
    const missing = inspection.requirements.filter(row => row.storedValue === undefined
      && !Object.prototype.hasOwnProperty.call(scene.attributeInputs[row.side], row.attribute.attributeKey));
    requireValue(!missing.length, '缺少必要属性，不填默认值：' + missing.map(row => `${row.side}.${row.attribute.attributeKey}`).join('、'));
    evidence.prepared = await prepareSimulation(snapshot, structuredClone(scene.attributeInputs), structuredClone(scene.initialHealth),
      scene.equipmentAssumptions ?? [], scene.mechanicStateInputs ?? [], ignoredCosts, sceneInputs, scene.initialResourceInputs ?? []);
    requireValue(isDeepStrictEqual(snapshot, original), '场景装配修改了输入快照。');
    stage = '编译';
    evidence.compiled = await client.compile(evidence.prepared.compileRequest);
    sessionId = evidence.compiled.sessionId ?? null;
    requireValue(evidence.compiled.ok && sessionId, 'Wasm编译失败：' + JSON.stringify(evidence.compiled.errors ?? []));
    validateConsumedFormulaValues(evidence.prepared.approvedFormulaValues, evidence.prepared.compileRequest.formulas ?? [],
      evidence.compiled.metadata?.approvedStaticValues ?? {});
    validateApprovedFormulaValues(evidence.prepared.compileRequest.formulas ?? [], evidence.compiled.metadata?.approvedStaticValues ?? {});
    stage = '生成运行请求';
    const common = { durationMs: scene.durationMs, recordTimeSeries: false, attackSpeedInputMax: 10 };
    const built = scene.mode === 'fixed'
      ? await skillActionRequest(evidence.prepared, snapshot, { ...common, actions: scene.actions!, maxSkillActionRecords: 1000,
        maxSkillUseRecords: 2000, maxHealingRecords: 2000, maxResourceChangeRecords: 2000 }, sessionId)
      : await continuousAttackRequest(evidence.prepared, snapshot, common, sessionId);
    evidence.runRequest = built.runRequest;
    stage = '运行';
    evidence.done = await client.run(built.runRequest);
    stage = '检查完整性';
    evidence.assessment = scene.mode === 'fixed'
      ? assessSkillActionResult(evidence.prepared.compileRequest, built.runRequest, evidence.done, evidence.prepared.operationOrigins)
      : assessContinuousAttackResult(evidence.prepared.compileRequest, built.runRequest, evidence.done, evidence.prepared.operationOrigins);
    requireValue(evidence.assessment.complete && evidence.assessment.issues.length === 0,
      '结果检查失败：' + evidence.assessment.issues.join('；'));
    requireValue(evidence.done.summary.execution?.complete === true && evidence.done.summary.execution.budgetCause === null,
      '执行未完成或耗尽预算。');
    const recording = evidence.done.recording;
    requireValue(recording, '结果缺少记录完整性信息。');
    requireValue(!Object.entries(recording).some(([key, value]) => key.endsWith('Truncated') && value === true),
      '结果明细发生截断，无法用于完整对照。');
    stage = '同会话重复运行';
    const repeated = await client.run(built.runRequest);
    evidence.runs = 2;
    evidence.repeatIdentical = isDeepStrictEqual(evidence.done, repeated);
    requireValue(evidence.repeatIdentical, '同会话两次运行结果不一致。');
    requireValue(isDeepStrictEqual(snapshot, original), '运行修改了输入快照。');
  } catch (error) {
    evidence.error = { stage, message: message(error) };
  } finally {
    if (sessionId) {
      try {
        evidence.release = await client.release(sessionId, evidence.prepared?.compileRequest.rulesHash);
        requireValue(evidence.release.released && evidence.release.sessionId === sessionId, '释放未确认或会话身份不符。');
      } catch (error) { evidence.releaseError = message(error); }
    }
  }
  evidence.complete = evidence.error === undefined && evidence.releaseError === undefined
    && evidence.release?.released === true && evidence.repeatIdentical === true;
  return evidence;
}

function parseArguments(args: string[]) {
  if (args.length === 0 || args.length === 1 && args[0] === '--help') return null;
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    requireValue(['--plan', '--output', '--grant-file'].includes(key) && !values.has(key) && value && !value.startsWith('--'),
      '只接受一次--plan、--output和--grant-file，且均须提供路径。');
    values.set(key, resolve(value));
  }
  requireValue(values.size === 3, '需要--plan、--output和--grant-file。');
  return { plan: values.get('--plan')!, output: values.get('--output')!, grantFile: values.get('--grant-file')! };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options) {
    console.log('按给定快照及明确输入运行Wasm场景；不生成预期或写业务数据。\n'
      + '在web目录执行：\nnode node_modules/vite-node/vite-node.mjs ../.agents/skills/skill-damage-verification/scripts/run-wasm-scenarios.ts '
      + '--plan <场景计划.json> --output <新的证据目录> --grant-file <后端维护计算票据文件>');
    return;
  }
  const planBytes = readFileSync(options.plan);
  const scenes = validateScenarioPlan(JSON.parse(planBytes.toString('utf8')));
  mkdirSync(options.output);
  const results: { id: string; file: string }[] = [];
  const summary: { complete: boolean; requested: number; completed: number; planSha256: string;
    cases: { id: string; complete: boolean; error?: Evidence['error']; releaseError?: string }[];
    initializationError?: string } = { complete: false, requested: scenes.length, completed: 0, planSha256: hash(planBytes), cases: [] };
  try {
    const engine = await createMaintenanceEngine(options.grantFile);
    for (const scene of scenes) {
      const evidence = await runScenario(scene, dirname(options.plan), engine);
      const file = `${scene.id}.json`;
      writeNew(resolve(options.output, file), evidence);
      results.push({ id: scene.id, file });
      summary.cases.push({ id: scene.id, complete: evidence.complete, ...(evidence.error ? { error: evidence.error } : {}),
        ...(evidence.releaseError ? { releaseError: evidence.releaseError } : {}) });
      if (!evidence.complete) throw new Error(`${scene.id}未完成：${evidence.error?.message ?? evidence.releaseError ?? '缺少运行或释放结果'}`);
      summary.completed++;
      console.log(JSON.stringify({ id: scene.id, complete: true, runs: 2, released: true }));
    }
    summary.complete = true;
  } catch (error) {
    if (!summary.cases.length) summary.initializationError = message(error);
    throw error;
  } finally {
    writeNew(resolve(options.output, 'results.json'), { cases: results });
    writeNew(resolve(options.output, 'summary.json'), summary);
  }
}

try { await main(); }
catch (error) { console.error(message(error)); process.exitCode = 1; }
