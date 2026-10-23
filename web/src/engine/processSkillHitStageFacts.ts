import type { CompileRequest, DoneResult, ProcessDefinition, ProcessInstanceSnapshot, SkillActionBinding, SkillActionPlan } from '../types/genericEngine';
import { finiteRecastShape, recastDefinition, recastUseOrdinal } from './finiteRecast';
import { inspectSkillHitChainStageTimes } from './skillHitChainResult';

type Hit = SkillActionBinding['hitBindings'][number];
export type SkillHitStageFact = NonNullable<ProcessInstanceSnapshot['skillHitStages']>[number];

/** 只接受不可截断的同刻死亡停止证明；同步尾部不伪造已不存在目标的接触。 */
export function skillHitStageStoppedByTargetDeath(process: ProcessInstanceSnapshot, fact: SkillHitStageFact, done?: DoneResult): boolean {
  if (!done?.ok || !fact.released || fact.contact || fact.completed || process.target !== 'target') return false;
  const execution = done.summary.execution, targets = done.finalSnapshot.combatants.filter(actor => actor.key === process.target);
  const time = fact.timeMs;
  return Number.isSafeInteger(time) && time >= 0 && done.summary.stopReason === 'target_dead'
    && execution?.complete === true && execution.incompleteReason === null && execution.budgetCause === null
    && execution.targetKilled === true && execution.targetKilledAtMs === time
    && done.summary.durationMs === time && done.finalSnapshot.timeMs === time
    && done.summary.targetFinalHp === 0 && targets.length === 1 && targets[0]!.attributes.hp?.current === 0
    && (process.status !== 'complete' || process.stepCompletedAtMs === time && process.finishedAtMs === time);
}

export function hasProcessSkillHitStages(binding: SkillActionBinding, process: ProcessDefinition): boolean {
  return (process.steps.every(step => ['IMMEDIATE', 'DELAY'].includes(step.stepType)) || recastDefinition(process) !== null)
    && binding.hitBindings.some(hit => hit.moment.momentType === 'STEP_EXECUTION');
}

/** 使用不可截断的原生提交事实，不由详细记录或初始属性重算动态步骤时刻。 */
export function inspectProcessSkillHitStages(binding: SkillActionBinding, definition: ProcessDefinition, process: ProcessInstanceSnapshot,
  presets: SkillActionPlan['hitBindings'], observationEndMs: number, done?: DoneResult, compile?: CompileRequest): SkillHitStageFact[] | undefined {
  if (!hasProcessSkillHitStages(binding, definition)) return undefined;
  function fail(message: string): never { throw new Error(`processInstances.skillHitStages: ${message}`); }
  if (process.owner !== binding.source || process.providerRef !== binding.providerRef || process.skillKey !== binding.skillKey
    || process.processKey !== definition.processKey || definition.skillKey !== binding.skillKey) fail('阶段过程没有同一实际拥有者、挂载和技能身份');
  const facts = process.skillHitStages;
  if (!Array.isArray(facts) || facts.length > 64 || binding.hitBindings.length > 64) fail('缺少完整有限阶段事实');
  const byKey = new Map<string, Hit>();
  const indices = new Map(definition.steps.map((step, index) => [step.stepKey, index]));
  for (const hit of binding.hitBindings) {
    if (byKey.has(hit.hitBindingKey) || hit.processKey !== definition.processKey || hit.moment.momentType !== 'STEP_EXECUTION'
      || !indices.has(hit.moment.stepKey ?? '')) fail('绑定缺少唯一真实过程执行时点');
    byKey.set(hit.hitBindingKey, hit);
  }
  const byFact = new Map<string, SkillHitStageFact>();
  const recast = recastDefinition(definition);
  const terminal = definition.steps[definition.steps.length - 1]!;
  if (recast && binding.hitBindings.filter(hit => hit.moment.stepKey === terminal.stepKey).length !== 1) fail('重施步骤必须对应唯一真实命中绑定');
  const recastFacts: SkillHitStageFact[] = [];
  let previousIndex = -1, previousAt = process.startedAtMs;
  for (const fact of facts) {
    const hit = byKey.get(fact.hitBindingKey);
    const index = indices.get(fact.stepKey) ?? -1;
    if (Object.keys(fact).length !== 6 || Object.keys(fact).some(key => !['hitBindingKey', 'stepKey', 'timeMs', 'released', 'contact', 'completed'].includes(key))
      || !hit || hit.moment.stepKey !== fact.stepKey
      || (recast && fact.stepKey === terminal.stepKey ? index < previousIndex || !finiteRecastShape(definition.steps) && recastFacts.length > 0
        : byFact.has(fact.hitBindingKey) || index <= previousIndex)
      || !Number.isSafeInteger(fact.timeMs) || fact.timeMs < previousAt || fact.timeMs > observationEndMs
      || typeof fact.released !== 'boolean' || typeof fact.contact !== 'boolean' || typeof fact.completed !== 'boolean') fail('阶段身份、顺序或真实执行时刻不合法');
    const priorKey = hit.requiresPriorHitBindingKey;
    if (recast && finiteRecastShape(definition.steps) && priorKey) fail('有限重施不依赖前段接触');
    const prior = priorKey ? byFact.get(priorKey) : undefined;
    if (priorKey && (!byKey.has(priorKey) || (indices.get(byKey.get(priorKey)!.moment.stepKey ?? '') ?? Infinity) >= index)) fail('前置不是同过程更早命中绑定');
    const eligible = !priorKey || prior?.contact === true && prior.completed === true;
    const preset = presets.find(row => row.hitBindingKey === hit.hitBindingKey);
    if (!preset || !['MISS', 'TARGET_HIT'].includes(preset.preset) || fact.released !== eligible
      || fact.contact && (!fact.released || preset.preset !== 'TARGET_HIT')
      || !fact.completed && (!eligible || preset.preset === 'MISS'
        || process.status === 'complete' && !skillHitStageStoppedByTargetDeath(process, fact, done))) fail('释放、接触与本使用的实际前置资格或命中预设不一致');
    if (recast && fact.stepKey === terminal.stepKey) {
      const before = recastFacts[recastFacts.length - 1]?.timeMs ?? process.stepStartedAtMs;
      if (fact.timeMs < before + recast.interval || fact.timeMs >= process.stepStartedAtMs + recast.window) fail('重施间隔或原截止不一致');
      recastFacts.push(fact);
    }
    byFact.set(fact.hitBindingKey, fact); previousIndex = index; previousAt = fact.timeMs;
  }
  for (const hit of binding.hitBindings) {
    const index = indices.get(hit.moment.stepKey!)!;
    const executed = index + 1 < process.stepVersion || index + 1 === process.stepVersion && process.stepExecutionIndex > 0;
    if (recast && hit.moment.stepKey === terminal.stepKey) {
      const count = process.stepVersion === definition.steps.length ? process.stepExecutionIndex : 0;
      if (recastFacts.length !== count || count > recast.maximum) fail('重施事实数量与真实执行序号不一致');
    } else if (executed !== byFact.has(hit.hitBindingKey)) fail('阶段事实与真实已提交步骤进度不一致');
  }
  if (recast && process.stepVersion === definition.steps.length) {
    const last = recastFacts[recastFacts.length - 1];
    if (process.lastExecutionAtMs !== (last?.timeMs ?? null)) fail('最后实际重施时刻与末条真实阶段不一致');
    if (process.status === 'complete' && (!last || process.stepCompletedAtMs !== last.timeMs
      || process.finishedAtMs !== last.timeMs)) fail('同步重施完成必须与真实最后一发同刻');
  }
  if (recast && finiteRecastShape(definition.steps)) {
    if (!process.useKey.startsWith('skill:') || binding.hitBindings.length !== 2
      || definition.steps.some(step => binding.hitBindings.filter(hit => hit.moment.stepKey === step.stepKey).length !== 1)) fail('有限重施缺少新鲜首次或两步独立绑定');
    if (facts[0] && facts[0].timeMs !== process.startedAtMs) fail('即时首发时刻被改写');
    if (process.stepVersion === 2 && (process.expiresAtMs !== process.stepStartedAtMs + recast.window
      || process.stepStartedAtMs !== process.startedAtMs
      || process.status === 'complete' && process.stepExecutionIndex !== recast.maximum
      || process.status === 'active' && process.stepExecutionIndex >= recast.maximum
      || process.status === 'active' && process.advanceAtMs !== (process.lastExecutionAtMs ?? process.stepStartedAtMs) + recast.interval)) fail('有限重施原窗口、余量或下次时点不一致');
  }
  if (compile) inspectSkillHitChainStageTimes(compile, binding, process);
  return facts;
}

export function processSkillHitTimes(process: ProcessInstanceSnapshot, hit: Hit, useRef?: string, definition?: ProcessDefinition): number[] | undefined {
  if (!process.skillHitStages) return undefined;
  let facts = process.skillHitStages.filter(fact => fact.hitBindingKey === hit.hitBindingKey);
  if (definition && recastDefinition(definition) && useRef) {
    const ordinal = recastUseOrdinal(process, definition, useRef);
    if (ordinal === null) return [];
    facts = hit.moment.stepKey === definition.steps[definition.steps.length - 1]?.stepKey ? ordinal > 0 ? facts.slice(ordinal - 1, ordinal) : [] : ordinal === 0 ? facts : [];
  }
  return facts.filter(fact => fact.contact).map(fact => fact.timeMs);
}
