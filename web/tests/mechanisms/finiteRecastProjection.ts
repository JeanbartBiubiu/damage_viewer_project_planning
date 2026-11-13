import type { CompileRequest, DoneResult, ProcessInstanceSnapshot, RunRequest, SkillActionPlan } from '../../src/types/genericEngine';
import { finiteRecastControls, finiteRecastDefinition, recastUseOrdinal, recastUseRef } from '../../src/engine/finiteRecast';
import { inspectProcessSkillHitStages } from '../../src/engine/processSkillHitStageFacts';

export type ProjectedFiniteRecastWindow = Pick<ProcessInstanceSnapshot, 'owner' | 'providerRef' | 'processKey' | 'skillKey' | 'useKey' | 'target'
  | 'stepKey' | 'stepVersion' | 'stepExecutionIndex' | 'lastExecutionAtMs' | 'stepCompletedAtMs' | 'startedAtMs' | 'stepStartedAtMs'
  | 'advanceAtMs' | 'expiresAtMs' | 'actualCosts' | 'cooldownStarted' | 'status' | 'failureReason' | 'finishedAtMs' | 'repeat' | 'actionOccupancies'>
  & { bindingKey: string; providerDefinitionRef: string; maximumRecastCount: number; intervalMs: number; windowMs: number };
export type ProjectedFiniteRecastStage = { owner: string; providerRef: string; bindingKey: string; skillKey: string; processKey: string;
  windowUseRef: string; useRef: string; executionOrdinal: number; hitBindingKey: string; stepKey: string; timeMs: number;
  released: boolean; contact: boolean; completed: boolean };
export type ProjectedFiniteRecastWitness = { owner: string; providerRef: string; providerDefinitionRef: string; skillKey: string;
  groupKey: string; stateKey: string; value: number };

function fail(message: string): never { throw new Error(`finiteRecast: ${message}`); }
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const time = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function one<T>(rows: T[], name: string): T {
  if (rows.length !== 1) fail(`${name}必须唯一`);
  return rows[0]!;
}

/** 只投影真实编译绑定和不可截断阶段；明细为0也不合成施放编号或补伤害行。 */
export function projectFiniteRecasts(compile: CompileRequest, request: RunRequest, done: DoneResult): {
  finiteRecastWindows: ProjectedFiniteRecastWindow[]; finiteRecastStages: ProjectedFiniteRecastStage[];
  finiteRecastWitnesses: ProjectedFiniteRecastWitness[];
} {
  const definitions = (compile.rules?.skillActionBindings ?? []).flatMap(binding => {
    const actor = one(compile.combatants.filter(a => a.key === binding.source), '编译拥有者');
    one(actor.providers.filter(p => p.providerRef === binding.providerRef && p.definitionRef === binding.providerDefinitionRef), '实际挂载');
    const provider = one((compile.sharedProviders ?? []).filter(p => p.providerKey === binding.providerDefinitionRef), '实际定义');
    if (provider.skillKey !== binding.skillKey) fail('绑定技能与定义不一致');
    return (provider.processes ?? []).filter(p => finiteRecastDefinition(p) !== null).map(definition => {
      if (provider.lifecycle || provider.kind === 'status' || !finiteRecastControls(binding, definition)) fail('不是永久父来源的完整有限重施控制');
      for (const control of binding.controls) {
        const ability = one((provider.abilities ?? []).filter(a => control.abilityRef === `${binding.source}.provider[${binding.providerRef}].ability[${a.abilityKey}]`), '实际控制能力');
        if (ability.skillKey !== binding.skillKey || ability.processControl?.processKey !== definition.processKey
          || ability.processControl.action !== control.action || control.action === 'RECAST'
            && ability.processControl.stepKey !== definition.steps[1]!.stepKey) fail('控制能力不属于本过程');
      }
      for (const hit of binding.hitBindings) {
        const ability = one((provider.abilities ?? []).filter(a => hit.hitAbilityRef === `${binding.source}.provider[${binding.providerRef}].ability[${a.abilityKey}]`), '实际阶段命中能力');
        if (ability.skillKey !== binding.skillKey || !ability.operations?.some(op => op.operation === 'resolve_skill_hit'
          && op.skillHit?.skillKey === binding.skillKey)) fail('阶段命中能力不属于实际来源');
      }
      return { binding, definition };
    });
  });
  const result = { finiteRecastWindows: [] as ProjectedFiniteRecastWindow[], finiteRecastStages: [] as ProjectedFiniteRecastStage[],
    finiteRecastWitnesses: [] as ProjectedFiniteRecastWitness[] };
  if (!definitions.length) return result;
  if (!Array.isArray(done.finalSnapshot.processInstances) || !time(done.finalSnapshot.timeMs)) fail('缺少完整最终过程快照');
  const seen = new Set<string>();
  for (const p of done.finalSnapshot.processInstances) {
    const possible = definitions.filter(({ binding }) => binding.providerRef === p.providerRef && binding.source === p.owner);
    if (!possible.length) {
      if (definitions.some(({ definition }) => definition.processKey === p.processKey && definition.skillKey === p.skillKey)) fail('有限重施快照使用了错误拥有者或挂载');
      continue;
    }
    const { binding, definition } = one(possible.filter(({ definition }) => definition.processKey === p.processKey && definition.skillKey === p.skillKey), '原窗口绑定');
    const actor = one(done.finalSnapshot.combatants.filter(a => a.key === p.owner), '最终窗口拥有者');
    one(actor.providers.filter(m => m.providerRef === binding.providerRef && m.definitionRef === binding.providerDefinitionRef
      && m.owner === p.owner && m.source === p.owner), '最终窗口实际挂载');
    const limits = finiteRecastDefinition(definition)!;
    if (!text(p.useKey) || !p.useKey.startsWith('skill:') || seen.has(p.useKey) || !['source', 'target'].includes(p.target)
      || p.stepKey !== definition.steps[1]!.stepKey || p.stepVersion !== 2 || !time(p.startedAtMs)
      || p.stepStartedAtMs !== p.startedAtMs || p.startedAtMs > done.finalSnapshot.timeMs || !time(p.advanceAtMs)
      || !time(p.expiresAtMs) || p.expiresAtMs !== p.startedAtMs + limits.window
      || !time(p.stepExecutionIndex) || p.stepExecutionIndex > limits.maximum
      || p.repeat !== null || !Array.isArray(p.actionOccupancies) || p.actionOccupancies.length
      || !object(p.actualCosts) || Object.values(p.actualCosts).some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0)
      || typeof p.cooldownStarted !== 'boolean') fail('窗口身份、原期限或完整执行进度不合法');
    const nullableTime = (v: unknown) => v === null || time(v) && v <= done.finalSnapshot.timeMs && v >= p.startedAtMs;
    if (!nullableTime(p.lastExecutionAtMs) || !nullableTime(p.stepCompletedAtMs) || !nullableTime(p.finishedAtMs)
      || !['active', 'complete', 'failed'].includes(p.status)
      || p.status === 'active' && (p.finishedAtMs !== null || p.failureReason !== null || p.stepCompletedAtMs !== null || p.expiresAtMs <= done.finalSnapshot.timeMs)
      || p.status === 'complete' && (p.finishedAtMs === null || p.failureReason !== null || p.stepCompletedAtMs !== p.finishedAtMs)
      || p.status === 'failed' && (p.finishedAtMs === null || !['CONTROLLED', 'SOURCE_DIED', 'TARGET_UNTARGETABLE', 'ACTIVE_CANCELLED', 'EVENT_ABORTED'].includes(p.failureReason ?? ''))
      || p.failureReason === 'EVENT_ABORTED' && (p.finishedAtMs !== p.expiresAtMs || p.stepExecutionIndex >= limits.maximum || p.stepCompletedAtMs !== null)) fail('窗口终结状态和真实时刻不一致');
    seen.add(p.useKey);
    let presets: SkillActionPlan['hitBindings'];
    if (request.driverPlan.automaticSkills) {
      const rule = one(request.driverPlan.automaticSkills.rules.filter(r => r.bindingKey === binding.bindingKey && r.target === p.target), '自动原规则');
      const prefix = `skill:auto_${rule.ruleKey}_`, ordinal = p.useKey.slice(prefix.length);
      if (!p.useKey.startsWith(prefix) || !/^[1-9][0-9]*$/.test(ordinal) || !time(Number(ordinal))
        || Number(ordinal) > (done.automaticSkillSummary?.attemptCount ?? 0)) fail('自动父窗口不是实际首次尝试');
      presets = rule.hitBindings;
    } else {
      const initial = one((request.driverPlan.skillActions ?? []).filter(a => p.useKey === `skill:${a.instructionKey}` && a.action === 'INITIAL'), '手动原首次');
      if (initial.bindingKey !== binding.bindingKey || initial.source !== p.owner || initial.target !== p.target
        || initial.skillKey !== p.skillKey || initial.firstAtMs !== p.startedAtMs || initial.parentInstructionKey != null
        || initial.abilityRef !== binding.controls.find(c => c.action === 'INITIAL')!.abilityRef) fail('原首次不属于实际窗口');
      presets = initial.hitBindings;
    }
    let stages;
    try { stages = inspectProcessSkillHitStages(binding, definition, p, presets, done.finalSnapshot.timeMs, done); }
    catch (error) { fail(error instanceof Error ? error.message : String(error)); }
    if (!stages || stages.length !== p.stepExecutionIndex + 1 || stages.some(s => !s.completed)) fail('缺少同步尾部完整阶段事实');
    for (const [ordinal, stage] of stages.entries()) {
      const useRef = recastUseRef(p.useKey, ordinal);
      if (recastUseOrdinal(p, definition, useRef) !== ordinal) fail('每发身份没有对应已提交序号');
      if (ordinal > 0 && !request.driverPlan.automaticSkills) {
        const actions = (request.driverPlan.skillActions ?? []).filter(a => a.action === 'RECAST' && a.bindingKey === binding.bindingKey
          && a.parentInstructionKey === p.useKey.slice('skill:'.length) && a.source === p.owner && a.target === p.target
          && a.skillKey === p.skillKey && a.firstAtMs === stage.timeMs
          && a.abilityRef === binding.controls.find(c => c.action === 'RECAST')!.abilityRef).sort((a, b) => a.sortOrder - b.sortOrder);
        const sameTimeOrdinal = stages.slice(1, ordinal).filter(s => s.timeMs === stage.timeMs).length;
        if (!actions[sameTimeOrdinal]) fail('手动已接受重施缺少原首次关联和实际排序');
      }
      result.finiteRecastStages.push({ owner: p.owner, providerRef: p.providerRef, bindingKey: binding.bindingKey, skillKey: p.skillKey,
        processKey: p.processKey, windowUseRef: p.useKey, useRef, executionOrdinal: ordinal,
        hitBindingKey: stage.hitBindingKey, stepKey: stage.stepKey, timeMs: stage.timeMs, released: stage.released,
        contact: stage.contact, completed: stage.completed });
    }
    const { skillHitStages: _stages, ...window } = p;
    result.finiteRecastWindows.push({ ...window, bindingKey: binding.bindingKey, providerDefinitionRef: binding.providerDefinitionRef,
      maximumRecastCount: limits.maximum, intervalMs: limits.interval, windowMs: limits.window });
  }
  // Existing on-cast listeners may share one quota group. Their ordinary state
  // is final-snapshot evidence, independent of damage/evidence record budgets.
  for (const actor of compile.combatants) for (const mount of actor.providers) {
    const definition = one((compile.sharedProviders ?? []).filter(p => p.providerKey === mount.definitionRef), '计数实际父定义');
    const groups = new Map<string, Set<string>>();
    for (const ability of definition.abilities ?? []) {
      const listener = ability.listenerSpec;
      if (!listener?.oncePerUse || !listener.eventMatcher.all?.includes('event/ability_started')) continue;
      const eventTypes = listener.eventMatcher.all;
      if (!eventTypes.includes('event/source_owner') || !definitions.some(({ binding }) => binding.source === actor.key
        && eventTypes.includes(`ability/skill/${binding.skillKey}`))) continue;
      if (!Array.isArray(listener.operations)) fail('施放见证缺少完整监听操作');
      for (const op of listener.operations) {
        if (op.operation !== 'state_change' || op.valuePolicy !== 'add' || op.target !== 'self' || !text(op.ref)) continue;
        const field = definition.initialStateSchema?.[op.ref];
        if (!field || typeof field === 'number' || field.stateKind || field.valueType !== 'integer' || field.defaultValue !== 0
          || !time(field.maxValue) || field.durationMs !== 0 || definition.lifecycle || definition.kind === 'status') fail('施放见证不是明确永久自身普通计数');
        const keys = groups.get(listener.oncePerUse.groupKey) ?? new Set<string>(); keys.add(op.ref);
        groups.set(listener.oncePerUse.groupKey, keys);
      }
    }
    for (const [groupKey, keys] of groups) for (const stateKey of keys) {
      const final = one(done.finalSnapshot.combatants.filter(c => c.key === actor.key), '计数最终拥有者');
      one(final.providers.filter(p => p.providerRef === mount.providerRef && p.definitionRef === mount.definitionRef
        && p.owner === actor.key && p.source === actor.key), '计数最终真实挂载');
      const bag = final.providerState[mount.providerRef];
      if (!object(bag) || !object(bag.state) || !time(bag.state[stateKey])) fail('施放见证缺少不可截断真实计数');
      const field = definition.initialStateSchema![stateKey]!;
      if (typeof field === 'number' || !time(field.maxValue) || bag.state[stateKey] > field.maxValue) fail('施放见证计数超过真实声明上限');
      result.finiteRecastWitnesses.push({ owner: actor.key, providerRef: mount.providerRef, providerDefinitionRef: mount.definitionRef,
        skillKey: definition.skillKey!, groupKey, stateKey, value: bag.state[stateKey] });
    }
  }
  result.finiteRecastWindows.sort((a, b) => a.startedAtMs - b.startedAtMs || a.useKey.localeCompare(b.useKey));
  result.finiteRecastStages.sort((a, b) => a.timeMs - b.timeMs || a.windowUseRef.localeCompare(b.windowUseRef) || a.executionOrdinal - b.executionOrdinal);
  result.finiteRecastWitnesses.sort((a, b) => a.owner.localeCompare(b.owner) || a.providerRef.localeCompare(b.providerRef)
    || a.groupKey.localeCompare(b.groupKey) || a.stateKey.localeCompare(b.stateKey));
  return result;
}
