import { isDeepStrictEqual } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { TinyGoV2Bridge } from '../../src/engine/tinygoV2Bridge';
import { parseCompileResult, parseDoneResult, parseReleaseResult, type GenericEngineClient } from '../../src/engine/genericEngineClient';
import { registerFormulaForApprovedReads, validateApprovedFormulaValues, validateConsumedFormulaValues } from '../../src/engine/approvedFormulaValues';
import { assertResourceRecordBudget } from '../../src/engine/resourceChangeContract';
import { inspectSimulationSnapshot, prepareSimulation, type OperationOrigin } from '../../src/engine/simulationAdapter';
import { simulationAutomaticCastCosts } from '../../src/engine/simulationActiveSkills';
import { preflightSkillFormulas } from '../../src/engine/skillFormulaPreflight';
import { automaticSkillRequest } from '../../src/engine/automaticSkillRequest';
import { assessAutomaticSkillResult } from '../../src/engine/automaticSkillResult';
import { skillActionRequest } from '../../src/engine/skillActionRequest';
import { assessSkillActionResult } from '../../src/engine/skillActionResult';
import { continuousAttackRequest } from '../../src/engine/continuousAttackRequest';
import { assessContinuousAttackResult } from '../../src/engine/continuousAttackResult';
import { validateSimulationSnapshot } from '../../src/services/simulationSnapshotClient';
import type { CompileRequest, CompileResult, DamageRecord, DoneResult, GenericReleaseDonePayload, RunRequest } from '../../src/types/genericEngine';
import type { MechanismCase, MechanismExpectation, MechanismProjection } from './mechanismCase';
import { projectRestorations } from './restorationProjection';
import { projectEmpoweredWindows, projectInitializations } from './initializationProjection';
import { projectFinalStatuses } from './statusProjection';
import { projectUseTriggerLedger } from './useTriggerProjection';
import { projectShieldAbsorptions, projectShieldWaits } from './shieldAbsorptionProjection';

export const WASM_PATH = new URL('../../src/engine/wasm/tinygo_engine_v2.wasm', import.meta.url);

/** 与正式工作线程客户端相同的解析与公式登记，只把传输换成同进程桥接。 */
class NodeEngineClient {
  constructor(private readonly bridge: TinyGoV2Bridge) {}
  get hasLiveWorker() { return true; }
  async compile(request: CompileRequest): Promise<CompileResult> {
    const result = parseCompileResult(this.bridge.compile(request));
    if (result.ok) for (const formula of request.formulas ?? []) registerFormulaForApprovedReads(formula);
    return result;
  }
  async run(request: RunRequest): Promise<DoneResult> {
    assertResourceRecordBudget(request);
    return parseDoneResult(this.bridge.run(request));
  }
  async release(sessionId: string, expectedRulesHash?: string): Promise<GenericReleaseDonePayload> {
    const result = parseReleaseResult(this.bridge.releaseSession(sessionId, expectedRulesHash));
    if (result.sessionId !== sessionId) throw new Error('释放响应不属于请求会话');
    return result;
  }
  terminate() {}
}

let shared: { client: NodeEngineClient; wasmSha256: string; wasmBytes: number } | null = null;
export async function mechanismEngine() {
  if (shared) return shared;
  const bytes = readFileSync(WASM_PATH);
  const bridge = await TinyGoV2Bridge.create({ wasmUrl: 'data:application/wasm;base64,' + bytes.toString('base64') });
  shared = { client: new NodeEngineClient(bridge), wasmSha256: createHash('sha256').update(bytes).digest('hex'), wasmBytes: bytes.length };
  return shared;
}

export type MechanismRun = { prepared: Awaited<ReturnType<typeof prepareSimulation>>; runRequest: RunRequest; done: DoneResult; projection: MechanismProjection };

/** 沿分析页顺序：快照校验、公式预检、装配、编译、按模式生成运行请求、运行、完整性核对、同会话重放、释放。 */
export async function runMechanismCase(definition: MechanismCase): Promise<MechanismRun> {
  const { client: node } = await mechanismEngine();
  const client = node as unknown as GenericEngineClient;
  const snapshot = definition.buildSnapshot();
  validateSimulationSnapshot(snapshot, snapshot.gameId, snapshot.selection);
  const scenario = definition.scenario;
  const ignoredCosts = simulationAutomaticCastCosts(snapshot);
  await preflightSkillFormulas(snapshot, client, () => true, scenario.sceneParameterInputs ?? []);
  const inspection = inspectSimulationSnapshot(snapshot, ignoredCosts, scenario.sceneParameterInputs ?? []);
  const attributes = structuredClone(scenario.attributeInputs ?? { source: {}, target: {} });
  const absent = inspection.requirements.filter(row => row.storedValue === undefined && attributes[row.side][row.attribute.attributeKey] === undefined);
  if (absent.length) throw new Error('用例缺少必要属性，须在角色等级属性或 scenario.attributeInputs 中写明：'
    + absent.map(row => `${row.side}.${row.attribute.attributeKey}`).join(','));
  const prepared = await prepareSimulation(snapshot, attributes, scenario.initialHealth, scenario.equipmentAssumptions ?? [], scenario.mechanicStateInputs ?? [], ignoredCosts, scenario.sceneParameterInputs ?? [], scenario.initialResourceInputs ?? []);
  const compiled = await client.compile(prepared.compileRequest);
  if (!compiled.ok || !compiled.sessionId) throw new Error('编译未通过：' + JSON.stringify(compiled.errors ?? compiled));
  const sessionId = compiled.sessionId;
  try {
    validateConsumedFormulaValues(prepared.approvedFormulaValues, prepared.compileRequest.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
    validateApprovedFormulaValues(prepared.compileRequest.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
    const common = { durationMs: scenario.durationMs, recordTimeSeries: false, attackSpeedInputMax: scenario.attackSpeedInputMax ?? 10 };
    const built = scenario.mode === 'automatic_skill'
      ? await automaticSkillRequest(prepared, snapshot, { ...common, rules: scenario.automaticRules ?? [], outputMode: 'detailed',
        maxAutomaticSkillRecords: 1000, maxHealingRecords: 1000, maxResourceChangeRecords: 1000 }, sessionId)
      : scenario.mode === 'skill_action'
        ? await skillActionRequest(prepared, snapshot, { ...common, actions: scenario.actions ?? [],
          maxSkillActionRecords: 1000, maxSkillUseRecords: 1000, maxHealingRecords: 1000, maxResourceChangeRecords: 1000 }, sessionId)
        : await continuousAttackRequest(prepared, snapshot, common, sessionId);
    const runRequest: RunRequest = { ...built.runRequest, sessionId, runtimeOptions: { ...built.runRequest.runtimeOptions,
      equipmentAssumptions: prepared.equipmentAssumptions, skillOrigins: prepared.skillOrigins, mechanicStateInputs: prepared.mechanicStateInputs } };
    const done = await client.run(runRequest);
    const assessment = scenario.mode === 'automatic_skill'
      ? assessAutomaticSkillResult(prepared.compileRequest, runRequest, done, prepared.operationOrigins)
      : scenario.mode === 'skill_action'
        ? assessSkillActionResult(prepared.compileRequest, runRequest, done, prepared.operationOrigins)
        : assessContinuousAttackResult(prepared.compileRequest, runRequest, done, prepared.operationOrigins);
    if (!assessment.complete || assessment.issues.length) {
      const directory = new URL('../../output/mechanisms/', import.meta.url);
      mkdirSync(directory, { recursive: true });
      writeFileSync(new URL(`${definition.caseKey}.assessment-failure.json`, directory), JSON.stringify({ prepared, runRequest, done, assessment }, null, 2) + '\n');
      throw new Error('结果完整性核对未通过：' + JSON.stringify(assessment.issues));
    }
    if (done.summary.execution && done.summary.execution.budgetCause !== null) throw new Error('运行耗尽预算：' + done.summary.execution.budgetCause);
    const repeated = await client.run(runRequest);
    if (!isDeepStrictEqual(repeated, done)) throw new Error('同会话重复运行结果不一致');
    return { prepared, runRequest, done, projection: projectMechanismResult(prepared.operationOrigins, prepared.compileRequest, runRequest, done) };
  } finally {
    const released = await client.release(sessionId, prepared.compileRequest.rulesHash);
    if (!released.released) throw new Error('引擎未释放实际会话');
  }
}

function automaticRuleSkill(compileRequest: CompileRequest, runRequest: RunRequest, ruleKey: string): string {
  const rule = runRequest.driverPlan.automaticSkills?.rules.find(row => row.ruleKey === ruleKey);
  const binding = compileRequest.rules.skillActionBindings?.find(row => row.bindingKey === rule?.bindingKey);
  if (!binding) throw new Error(`自动规则 ${ruleKey} 找不到真实技能绑定`);
  return binding.skillKey;
}

/** 只保留业务可手算的语义字段，避免内部引用、编号和记录形状变化影响回归。 */
export function projectMechanismResult(origins: readonly OperationOrigin[], compileRequest: CompileRequest, runRequest: RunRequest,
  done: DoneResult): MechanismProjection {
  const originOf = (record: DamageRecord) => {
    const matches = origins.filter(row => row.operationRef === record.operationRef && (row.abilityRef === record.abilityRef
      || !!record.providerDefinitionRef && row.providerDefinitionRef === record.providerDefinitionRef
        && row.abilityRef.startsWith(`${record.owner}.provider[`)));
    if (matches.length !== 1) throw new Error(`伤害记录找不到唯一作者来源：${record.abilityRef}/${record.operationRef}`);
    return matches[0]!;
  };
  const summary = done.summary;
  const finalProviders = done.finalSnapshot.combatants.flatMap(row => row.providers.map(provider => {
    if (provider.owner !== row.key || !['source', 'target'].includes(provider.source)
      || typeof provider.definitionRef !== 'string' || !provider.definitionRef.trim()
      || !Number.isSafeInteger(provider.stacks) || provider.stacks < 1
      || provider.expireAt !== null && (!Number.isSafeInteger(provider.expireAt) || provider.expireAt < 0)) {
      throw new Error('finalProviders: 实例归属、定义、层数或期限事实缺失或非法');
    }
    return { owner: provider.owner, source: provider.source, definitionRef: provider.definitionRef,
      stacks: provider.stacks, expireAt: provider.expireAt };
  })).sort((a, b) => a.owner.localeCompare(b.owner) || a.source.localeCompare(b.source)
    || a.definitionRef.localeCompare(b.definitionRef) || (a.expireAt ?? -1) - (b.expireAt ?? -1) || a.stacks - b.stacks);
  return {
    summary: {
      stopReason: summary.stopReason, sourceFinalHp: summary.sourceFinalHp, targetFinalHp: summary.targetFinalHp,
      sourceDamageDealt: summary.sourceDamageDealt, targetHpLoss: summary.targetHpLoss ?? 0,
      sourceDirectHealing: summary.sourceDirectHealing ?? 0, sourceVampHealing: summary.sourceVampHealing ?? 0,
      targetKilledAtMs: summary.execution?.targetKilledAtMs ?? null,
      basicAttackStarted: summary.basicAttack?.startedCount ?? 0, basicAttackHits: summary.basicAttack?.hitCount ?? 0,
      ...(done.targetMarkSummary ? { targetMarkConsumed: done.targetMarkSummary.consumedCount,
        targetMarkAttackConsumed: done.targetMarkSummary.attackCount, targetMarkSkillConsumed: done.targetMarkSummary.skillCount,
        targetMarkDamageBlocked: done.targetMarkSummary.damageBlockedCount } : {})
    },
    damage: [...(done.damageRecords ?? [])].sort((a, b) => a.timeMs - b.timeMs || a.damageId - b.damageId).map(row => {
      const origin = originOf(row);
      return { timeMs: row.timeMs, source: row.source, target: row.target, skillKey: origin?.skillKey ?? null,
        effectKey: origin?.effectKey ?? null, resultKey: origin?.resultKey ?? null, damageType: row.damageType,
        rawAmount: row.rawAmount, postDefenseDamage: row.postDefenseDamage, shieldAbsorbed: row.shieldAbsorbed, actualHpLoss: row.actualHpLoss };
    }),
    healing: (done.healingRecords ?? []).map(row => ({ timeMs: row.timeMs, source: row.source, target: row.target,
      rawAmount: row.rawAmount, actualHealing: row.actualHealing, overheal: row.overheal })),
    skillStarts: done.automaticSkillRecords
      ? done.automaticSkillRecords.filter(row => row.kind === 'STARTED')
        .map(row => ({ timeMs: row.timeMs, skillKey: automaticRuleSkill(compileRequest, runRequest, row.ruleKey) }))
      : (done.skillUseRecords ?? []).filter(row => row.kind === 'STARTED').map(row => ({ timeMs: row.timeMs, skillKey: row.skillKey })),
    attackStarts: (done.attackRecords ?? []).map(row => row.startAtMs),
    finalResources: done.finalSnapshot.combatants.flatMap(row => Object.entries({ hp: row.attributes.hp!, ...row.resources })
      .sort(([a], [b]) => a.localeCompare(b)).map(([attributeKey, slot]) => ({ owner: row.key, attributeKey, current: slot.current, max: slot.max }))),
    resourceChanges: (done.resourceChangeRecords ?? []).map(row => ({ timeMs: row.timeMs, target: row.target, resourceKey: row.resourceKey,
      currentBefore: row.currentBefore, currentAfter: row.currentAfter, currentDelta: row.currentDelta,
      maxBefore: row.maxBefore, maxAfter: row.maxAfter, maxDelta: row.maxDelta })),
    finalAttributes: Object.fromEntries(done.finalSnapshot.combatants.flatMap(row => Object.entries(row.attributes)
      .map(([key, slot]) => [`${row.key}.${key}`, slot.resolved]))),
    finalProviders,
    shieldAbsorptions: projectShieldAbsorptions(compileRequest, runRequest, done),
    finalShieldWaits: projectShieldWaits(compileRequest, done),
    finalUseTriggerLedger: projectUseTriggerLedger(compileRequest, runRequest, done),
    ...projectFinalStatuses(compileRequest, done),
    restorations: projectRestorations(origins, compileRequest, runRequest, done),
    initializations: projectInitializations(compileRequest, runRequest, done),
    ...projectEmpoweredWindows(compileRequest, runRequest, done),
    finalCooldowns: done.finalSnapshot.combatants.flatMap(actor => Object.entries(actor.cooldowns).map(([abilityRef, value]) => {
      if (!value || typeof value !== 'object' || !Number.isSafeInteger((value as Record<string, unknown>).readyAtMs)
        || !Number.isSafeInteger((value as Record<string, unknown>).remainingMs)
        || Number((value as Record<string, unknown>).readyAtMs) < 0 || Number((value as Record<string, unknown>).remainingMs) < 0) throw new Error('finalCooldowns: 缺少实际冷却期限');
      const row = value as { readyAtMs: number; remainingMs: number };
      return { owner: actor.key, abilityRef, readyAtMs: row.readyAtMs, remainingMs: row.remainingMs };
    })).sort((a, b) => a.owner.localeCompare(b.owner) || a.abilityRef.localeCompare(b.abilityRef))
  };
}

const TOLERANCE = 1e-9;
function same(actual: unknown, expected: unknown): boolean {
  if (typeof expected === 'number' && typeof actual === 'number') {
    return Math.abs(actual - expected) <= TOLERANCE * Math.max(1, Math.abs(expected));
  }
  return isDeepStrictEqual(actual, expected);
}

/** 返回全部差异；空数组表示与手算期望一致。 */
export function compareMechanismExpectation(actual: MechanismProjection, expected: MechanismExpectation): string[] {
  const issues: string[] = [];
  const fields = (path: string, actualRow: Record<string, unknown>, expectedRow: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(expectedRow)) {
      if (!(key in actualRow)) issues.push(`${path}.${key}: 投影没有该字段`);
      else if (!same(actualRow[key], value)) issues.push(`${path}.${key}: 实际 ${JSON.stringify(actualRow[key])}，期望 ${JSON.stringify(value)}`);
    }
  };
  if (expected.summary) fields('summary', actual.summary, expected.summary);
  if (expected.finalAttributes) fields('finalAttributes', actual.finalAttributes, expected.finalAttributes);
  for (const list of ['damage', 'healing', 'skillStarts', 'finalResources', 'resourceChanges', 'finalProviders', 'restorations', 'initializations', 'empoweredWindows', 'empoweredConsumptions', 'finalCooldowns', 'finalStatusContributions', 'finalEffectiveStatuses', 'finalUseTriggerLedger', 'shieldAbsorptions', 'finalShieldWaits'] as const) {
    const wanted = expected[list];
    if (!wanted) continue;
    const rows = actual[list] as unknown as Record<string, unknown>[];
    if (rows.length !== wanted.length) issues.push(`${list}: 实际 ${rows.length} 条，期望 ${wanted.length} 条`);
    wanted.forEach((row, index) => {
      if (rows[index]) fields(`${list}[${index}]`, rows[index]!, row as Record<string, unknown>);
    });
  }
  if (expected.attackStarts && !isDeepStrictEqual(actual.attackStarts, expected.attackStarts)) {
    issues.push(`attackStarts: 实际 ${JSON.stringify(actual.attackStarts)}，期望 ${JSON.stringify(expected.attackStarts)}`);
  }
  return issues;
}
