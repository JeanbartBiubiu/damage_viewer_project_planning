import { GenericEngineClient } from '../../src/engine/genericEngineClient';
import { inspectSimulationSnapshot, prepareSimulation } from '../../src/engine/simulationAdapter';
import { simulationCastCostCandidates } from '../../src/engine/simulationActiveSkills';
import { simulationHealthLimit } from '../../src/engine/simulationEquipment';
import { preflightSkillFormulas } from '../../src/engine/skillFormulaPreflight';
import { validateApprovedFormulaValues, validateConsumedFormulaValues } from '../../src/engine/approvedFormulaValues';
import { automaticSkillRequest, type AutomaticSkillInput } from '../../src/engine/automaticSkillRequest';
import { assessAutomaticSkillResult } from '../../src/engine/automaticSkillResult';
import { continuousAttackRequest } from '../../src/engine/continuousAttackRequest';
import { assessContinuousAttackResult } from '../../src/engine/continuousAttackResult';
import { skillActionRequest, type SkillActionInput } from '../../src/engine/skillActionRequest';
import { assessSkillActionResult } from '../../src/engine/skillActionResult';
import { validateSimulationSnapshot } from '../../src/services/simulationSnapshotClient';
import type { SimulationAttributeInputs, SimulationInitialResourceInput, SimulationSelection, SimulationSnapshot } from '../../src/types/simulationSnapshot';
import type { DoneResult, RunRequest } from '../../src/types/genericEngine';
import { describeCombatSkill, reconcileCombatRules } from '../../src/pages/simulation/combatSkillRoster';
import type { SimulationCharacterSkillOption } from '../../src/pages/simulation/simulationSelectionOptions';
import type { SkillConfiguration } from '../../src/types/skillConfiguration';
import { simulationSkillSourceIdentity } from '../../src/services/simulationSkillSourceIdentity';
import type { SceneInitialParameterInput } from '../../src/engine/sceneInitialParameterInput';

export type FirstHeroOptions = {
  mode: 'automatic' | 'fixed' | 'continuous';
  durationMs: number;
  iterations?: number;
  actions?: SkillActionInput[];
  automaticRules?: AutomaticSkillInput[];
  ruleOrder?: 'ui' | 'reverse';
  attributeInputs?: SimulationAttributeInputs;
  sceneParameterInputs?: SceneInitialParameterInput[];
  initialResourceInputs?: SimulationInitialResourceInput[];
  initialHealthRatios?: { source: number; target: number };
  expectedStartedSkillKeys?: string[];
  checkRecordVariants?: boolean;
};

/** 与页面相同：先按真实角色绑定生成选项，再由生产规则整理器处理开关、等级和目标。 */
export function firstHeroCombatRules(input: {
  characterKey: string; relations: SimulationSnapshot['source']['attachedSkills']; configurations: readonly SkillConfiguration[];
  basicAttackCategoryKey: string | null; settings: SimulationSelection['sourceSkillSettings'];
}, ruleOrder: FirstHeroOptions['ruleOrder'] = 'ui') {
  if (ruleOrder !== 'ui' && ruleOrder !== 'reverse') throw new Error('只接受页面顺序或其反序');
  const options: SimulationCharacterSkillOption[] = input.relations.filter(row => row.skillStatus === 'ENABLED').flatMap(relation => {
    if (relation.characterKey !== input.characterKey) throw new Error('规则选项必须属于真实角色绑定');
    const configuration = input.configurations.find(row => row.skill.skillKey === relation.skillKey);
    if (!configuration) throw new Error('规则选项缺少真实已绑定技能配置：' + relation.skillKey);
    if (configuration.skill.status !== 'ENABLED') return [];
    const basicAttack = input.basicAttackCategoryKey !== null && configuration.skill.skillCategoryKeys.includes(input.basicAttackCategoryKey);
    return [{ key: relation.skillKey, name: configuration.skill.name, kind: 'skill', maxLevel: configuration.skill.maxLevel,
      basicAttack, combat: describeCombatSkill(configuration, basicAttack) }];
  });
  const roster = reconcileCombatRules(options, input.characterKey, [], input.settings, {});
  if (roster.issues.length) throw new Error('真实页面自动规则未通过：' + roster.issues.join('；'));
  const rules = ruleOrder === 'reverse' ? [...roster.enabledRules].reverse() : roster.enabledRules;
  return { options, rules: rules.map((rule, sortOrder) => ({ ...rule, sortOrder })) };
}

export function firstHeroAutomaticRules(snapshot: SimulationSnapshot, ruleOrder: FirstHeroOptions['ruleOrder'] = 'ui') {
  const { rules } = firstHeroCombatRules({ characterKey: snapshot.selection.sourceCharacterKey,
    relations: snapshot.source.attachedSkills, configurations: snapshot.skillConfigurations,
    basicAttackCategoryKey: snapshot.catalogs.calculationRules.configuration?.basicAttackCategoryKey ?? null,
    settings: snapshot.selection.sourceSkillSettings }, ruleOrder);
  // 受控单主动场景保持原计划；页面开关、未学或缺少真实计划的来源不自动加入。
  for (const plan of snapshot.selection.plannedSkills) if (plan.origin.characterKey !== snapshot.selection.sourceCharacterKey
    || !snapshot.source.attachedSkills.some(relation => relation.skillKey === plan.skillKey && relation.skillStatus === 'ENABLED')) {
    throw new Error('自动计划不属于真实角色绑定：' + plan.skillKey);
  }
  const planned = new Map(snapshot.selection.plannedSkills.map(plan => [simulationSkillSourceIdentity(plan.origin, plan.skillKey), plan]));
  const selected = rules.filter(rule => planned.has(simulationSkillSourceIdentity(rule.origin, rule.skillKey)));
  for (const rule of selected) if (rule.skillLevel !== planned.get(simulationSkillSourceIdentity(rule.origin, rule.skillKey))!.skillLevel) {
    throw new Error('页面规则等级与真实计划不一致：' + rule.skillKey);
  }
  return selected.map((rule, sortOrder) => ({ ...rule, sortOrder }));
}

let retainedClient: GenericEngineClient | null = null;
let lastFailure: Record<string, unknown> | null = null;
export function firstHeroFailure() { return lastFailure ? structuredClone(lastFailure) : null; }

/** 真实作者输入只经正式宿主和 Worker；不填缺失属性、不改变等级或关闭来源。 */
export async function runFirstHeroCase(snapshot: SimulationSnapshot, selection: SimulationSelection, options: FirstHeroOptions) {
  lastFailure = null;
  validateSimulationSnapshot(snapshot, 'lol', selection);
  const client = retainedClient ??= new GenericEngineClient();
  const ignoredCosts = simulationCastCostCandidates(snapshot);
  const sceneParameterInputs = options.sceneParameterInputs ?? [];
  const formulaPreflight = await preflightSkillFormulas(snapshot, client, () => true, sceneParameterInputs);
  const inspection = inspectSimulationSnapshot(snapshot, ignoredCosts, sceneParameterInputs);
  const attributes = options.attributeInputs ?? { source: {}, target: {} };
  const absent = inspection.requirements.filter(row => row.storedValue === undefined
    && attributes[row.side][row.attribute.attributeKey] === undefined);
  if (absent.length) throw new Error('真实来源缺少必要属性，不填假0：' + absent.map(row => `${row.side}.${row.attribute.attributeKey}`).join(','));
  const healthLimits = { source: simulationHealthLimit(snapshot, 'source'), target: simulationHealthLimit(snapshot, 'target') };
  if (typeof healthLimits.source !== 'number' || !Number.isFinite(healthLimits.source) || healthLimits.source <= 0
    || typeof healthLimits.target !== 'number' || !Number.isFinite(healthLimits.target) || healthLimits.target <= 0) {
    throw new Error('真实生命上限缺失或非法');
  }
  const ratios = options.initialHealthRatios ?? { source: .5, target: 1 };
  const initialHealth = { source: healthLimits.source * ratios.source, target: healthLimits.target * ratios.target };
  const initialResourceInputs = options.initialResourceInputs ?? [];
  const prepared = await prepareSimulation(snapshot, attributes, initialHealth, [], [], ignoredCosts, sceneParameterInputs, initialResourceInputs);
  const diagnostics: Record<string, unknown> = { snapshot, inspection, attributes, healthLimits, initialHealth,
    formulaPreflight, ignoredCosts, sceneParameterInputs, initialResourceInputs, prepared, options };
  let sessionId: string | null = null;
  const equal = (a: unknown, b: unknown, label: string) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(label);
  };
  try {
    const compiled = await client.compile(prepared.compileRequest);
    diagnostics.compiled = compiled;
    if (!compiled.ok || !compiled.sessionId) throw new Error('真实作者编译失败：' + JSON.stringify(compiled));
    sessionId = compiled.sessionId;
    validateConsumedFormulaValues(prepared.approvedFormulaValues, prepared.compileRequest.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
    validateApprovedFormulaValues(prepared.compileRequest.formulas ?? [], compiled.metadata?.approvedStaticValues ?? {});
    const common = { durationMs: options.durationMs, recordTimeSeries: true, attackSpeedInputMax: 10 };
    const automaticRules = options.automaticRules ?? firstHeroAutomaticRules(snapshot, options.ruleOrder);
    diagnostics.automaticRules = automaticRules;
    const run = options.mode === 'automatic'
      ? await automaticSkillRequest(prepared, snapshot, { ...common, rules: automaticRules, outputMode: 'detailed',
        maxAutomaticSkillRecords: 1000, maxHealingRecords: 2000 }, sessionId)
      : options.mode === 'fixed'
        ? await skillActionRequest(prepared, snapshot, { ...common, actions: options.actions ?? [],
          maxSkillActionRecords: 1000, maxSkillUseRecords: 2000, maxHealingRecords: 2000 }, sessionId)
        : await continuousAttackRequest(prepared, snapshot, common, sessionId);
    diagnostics.runRequest = run.runRequest;
    if (prepared.basicAttackBinding && (run.runRequest.recordBudget?.maxMechanicRecords ?? 0) < 1) {
      throw new Error('真实混合矩阵必须保留被动计数明细预算');
    }
    const inspect = (request: RunRequest, done: DoneResult) => {
      const result = options.mode === 'automatic'
        ? assessAutomaticSkillResult(prepared.compileRequest, request, done, prepared.operationOrigins)
        : options.mode === 'fixed'
          ? assessSkillActionResult(prepared.compileRequest, request, done, prepared.operationOrigins)
          : assessContinuousAttackResult(prepared.compileRequest, request, done, prepared.operationOrigins);
      diagnostics.done = done; diagnostics.assessment = result;
      if (!result.complete || result.issues.length) throw new Error('真实结果核对失败：' + JSON.stringify(result));
      if (done.summary.execution?.complete !== true || done.summary.execution.budgetCause !== null) throw new Error('未完整执行或耗尽预算');
      return result;
    };
    const hostStarted = performance.now();
    const done = await client.run(run.runRequest);
    const hostRunElapsedMs = performance.now() - hostStarted;
    const assessment = inspect(run.runRequest, done);
    const iterations = options.iterations ?? 2;
    if (!Number.isSafeInteger(iterations) || iterations < 2) throw new Error('重复运行数至少2');
    let repeated: DoneResult = done;
    for (let index = 1; index < iterations; index++) {
      repeated = await client.run(run.runRequest);
      inspect(run.runRequest, repeated);
      equal(done, repeated, `同Worker同会话第${index + 1}次结果变化`);
    }
    const actualSkillExecutionFacts = options.mode === 'automatic'
      ? (done.automaticSkillRecords ?? []).filter(row => row.kind === 'STARTED' || row.kind === 'COMPLETED').map(row => {
        const rule = run.runRequest.driverPlan.automaticSkills!.rules.find(rule => rule.ruleKey === row.ruleKey)!;
        const binding = prepared.compileRequest.rules.skillActionBindings!.find(binding => binding.bindingKey === rule.bindingKey)!;
        return { side: binding.source, skillKey: binding.skillKey, kind: row.kind, timeMs: row.timeMs, useRef: row.useRef,
          sourceRecord: 'automaticSkillRecords', ruleKey: row.ruleKey };
      })
      : (done.skillUseRecords ?? []).filter(row => row.kind === 'STARTED' || row.kind === 'COMPLETED').map(row => ({
        side: row.source, skillKey: row.skillKey, kind: row.kind, timeMs: row.timeMs, useRef: row.useRef,
        sourceRecord: 'skillUseRecords', ruleKey: null
      }));
    for (const skillKey of options.expectedStartedSkillKeys ?? []) {
      if (!actualSkillExecutionFacts.some(row => row.side === 'source' && row.skillKey === skillKey && row.kind === 'STARTED')
        || !actualSkillExecutionFacts.some(row => row.side === 'source' && row.skillKey === skillKey && row.kind === 'COMPLETED')) {
        throw new Error(`${skillKey} 未在本次真实主动流程开始并完成`);
      }
    }
    if (prepared.basicAttackBinding && !(done.summary.basicAttack && done.summary.basicAttack.startedCount > 0
      && done.summary.basicAttack.completedCount > 0)) throw new Error('背景普攻未实际开始完成');
    const variants: Array<{ request: RunRequest; done: DoneResult; assessment: ReturnType<typeof inspect> }> = [];
    if (options.checkRecordVariants) for (const outputMode of ['detailed', 'summary'] as const) {
      const request: RunRequest = { ...run.runRequest, outputMode, recordBudget: {
        maxAttackRecords: 0, maxDamageRecords: 0, maxMechanicRecords: 0, maxSkillActionRecords: 0,
        maxSkillUseRecords: 0, maxHealingRecords: 0
      } };
      const variantDone = await client.run(request);
      const variantAssessment = inspect(request, variantDone);
      equal(done.summary, variantDone.summary, '汇总/明细预算改变真实累计');
      equal(done.finalSnapshot, variantDone.finalSnapshot, '汇总/明细预算改变真实最终状态');
      variants.push({ request, done: variantDone, assessment: variantAssessment });
    }
    const release = await client.release(sessionId, prepared.compileRequest.rulesHash);
    if (!release.released || release.sessionId !== sessionId) throw new Error('会话释放未确认');
    sessionId = null;
    return { snapshot, inspection, attributes, healthLimits, initialHealth, formulaPreflight, ignoredCosts, sceneParameterInputs, initialResourceInputs,
      prepared, compiled, automaticRules, runRequest: run.runRequest, runInputHash: run.runInputHash, done, repeated,
      assessment, release, iterations, variants, actualSkillExecutionFacts, hostRunElapsedMs,
      timingNotice: 'hostRunElapsedMs含Worker往返、编码及出口回收，不作为纯计算性能证据' };
  } catch (error) {
    diagnostics.error = error instanceof Error ? error.message : String(error);
    lastFailure = diagnostics;
    throw error;
  } finally {
    if (sessionId && client.hasLiveWorker) diagnostics.failureRelease = await client.release(sessionId, prepared.compileRequest.rulesHash);
  }
}

export function terminateFirstHeroWorker() {
  retainedClient?.terminate();
  retainedClient = null;
}
