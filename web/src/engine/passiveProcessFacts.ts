import type { CompileRequest, DamageRecord, DoneResult, HealingRecord, OperationDefinition, ProcessDefinition,
  ProcessInstanceSnapshot, ProcessMomentDefinition, ProviderDefinition, RunRequest } from '../types/genericEngine';
import { tryFoldConstant } from './numericAdapter';
import { processForSkillUse, recastUseOrdinal } from './finiteRecast';
import { assertProcessSkillHitStagesOutputShape } from './processSkillHitStageShape';

export type PassiveProcessFact = {
  instance: ProcessInstanceSnapshot; definition: ProcessDefinition; provider: ProviderDefinition;
  providerIndex: number; processIndex: number; originProcess: ProcessInstanceSnapshot;
  listenerRefs: string[]; instructionKey: string; hitTimeMs: number;
};
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && typeof value === 'number' && value > 0;
const time = (value: unknown): value is number => Number.isSafeInteger(value) && typeof value === 'number' && value >= 0;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const originFields = ['useSource', 'useKey', 'useSkillKey', 'hitAbilityRef', 'hitSequence', 'hitOccurrenceId'];

/** 只检查新增输出形状；真实拥有者、原使用及原命中由共同过程校验核对。 */
export function assertPassiveProcessOutputShape(value: unknown): void {
  if (!object(value) || !object(value.finalSnapshot) || !Array.isArray(value.finalSnapshot.processInstances)) return;
  for (const [index, row] of value.finalSnapshot.processInstances.entries()) {
    if (!object(row) || !hasOwn(row, 'passiveOrigin')) continue;
    const origin = row.passiveOrigin;
    if (!object(origin) || Object.keys(origin).length !== originFields.length || originFields.some(key => !hasOwn(origin, key))
      || !['source', 'target'].includes(String(origin.useSource))
      || ['useKey', 'useSkillKey', 'hitAbilityRef'].some(key => typeof origin[key] !== 'string' || !origin[key])
      || !positive(origin.hitSequence) || !positive(origin.hitOccurrenceId)) {
      throw new Error(`processInstances[${index}].passiveOrigin: 缺少完整有限原命中身份`);
    }
  }
}

function ownedProcess(compile: CompileRequest, instance: ProcessInstanceSnapshot) {
  const mounts = compile.combatants.find(actor => actor.key === instance.owner)?.providers.filter(mount => mount.providerRef === instance.providerRef) ?? [];
  const providerIndex = mounts.length === 1 ? compile.sharedProviders?.findIndex(provider => provider.providerKey === mounts[0]?.definitionRef) ?? -1 : -1;
  const provider = compile.sharedProviders?.[providerIndex];
  const processIndex = provider?.processes?.findIndex(process => process.processKey === instance.processKey) ?? -1;
  return { provider, providerIndex, definition: provider?.processes?.[processIndex], processIndex };
}

function processEntryListeners(provider: ProviderDefinition, owner: string, providerRef: string, processKey: string, skillKey: string) {
  return (provider.abilities ?? []).flatMap(ability => {
    const listener = ability.listenerSpec, all = listener?.eventMatcher.all ?? [], any = listener?.eventMatcher.any ?? [];
    const skillType = `ability/skill/${skillKey}`;
    if (ability.kind !== 'passive_listener' || ability.processControl || ability.cost || ability.cooldown || !listener
      || !all.includes('event/skill_hit') || !all.includes('event/source_owner')
      || all.some(type => type.startsWith('ability/skill/') && type !== skillType)
      || any.some(type => type.startsWith('ability/skill/')) && !any.includes(skillType)) return [];
    return (listener.operations ?? []).filter(operation => operation.operation === 'start_passive_process'
      && operation.target === 'self' && operation.processKey === processKey)
      .map(() => `${owner}.provider[${providerRef}].ability[${ability.abilityKey}]`);
  });
}

function foldedDurations(definition: ProcessDefinition): Array<number | null> {
  return definition.steps.map(step => step.stepType === 'IMMEDIATE' ? 0 : step.delayMs ? tryFoldConstant(step.delayMs) : null);
}
function momentTime(fact: PassiveProcessFact, moment: ProcessMomentDefinition): number | null {
  const process = fact.instance;
  if (moment.failureReason != null || moment.momentType === 'PROCESS_FAILURE' || moment.momentType === 'STEP_TIMEOUT') return null;
  if (moment.momentType === 'PROCESS_START' && moment.stepKey == null) return process.startedAtMs;
  if (moment.momentType === 'PROCESS_COMPLETE' && moment.stepKey == null) return process.status === 'complete' ? process.finishedAtMs : null;
  const index = fact.definition.steps.findIndex(step => step.stepKey === moment.stepKey);
  if (index < 0 || index >= process.stepVersion) return null;
  if (index === process.stepVersion - 1) {
    if (moment.momentType === 'STEP_START') return process.stepStartedAtMs;
    if (moment.momentType === 'STEP_EXECUTION') return process.stepExecutionIndex === 1 ? process.lastExecutionAtMs : null;
    if (moment.momentType === 'STEP_COMPLETE') return process.stepCompletedAtMs;
  }
  const durations = foldedDurations(fact.definition);
  let at = process.startedAtMs;
  for (let i = 0; i <= index; i++) {
    if (i === index && moment.momentType === 'STEP_START') return at;
    const duration = durations[i];
    if (duration === null || duration === undefined || !time(duration) || !time(at + duration)) return null;
    at += duration;
  }
  return at;
}

/** 核定被动实例与原技能命中的有限关系；不把实例计入主动使用或普攻累计。 */
export function inspectPassiveProcessFacts(compile: CompileRequest, request: RunRequest, done: DoneResult) {
  const issues: string[] = [], facts: PassiveProcessFact[] = [];
  const instances = done.finalSnapshot.processInstances ?? [], seen = new Set<string>(), admissions = new Map<string, number>();
  const bindings = compile.rules.skillActionBindings ?? [];
  const definitions = (compile.sharedProviders ?? []).flatMap(provider => provider.processes ?? []).filter(process => process.entryKind !== 'SKILL_HIT_PASSIVE');
  const originals = instances.filter(process => !process.passiveOrigin && bindings.some(binding => binding.providerRef === process.providerRef
    && binding.source === process.owner && binding.skillKey === process.skillKey));
  const check = (condition: boolean, path: string, message: string) => { if (!condition) issues.push(`${path}: ${message}`); };
  try { assertPassiveProcessOutputShape(done); } catch (error) { issues.push(error instanceof Error ? error.message : String(error)); }
  try { assertProcessSkillHitStagesOutputShape(done); } catch (error) { issues.push(error instanceof Error ? error.message : String(error)); }
  for (const instance of instances) {
    const path = `processInstances.${instance.useKey}`;
    check(typeof instance.useKey === 'string' && !!instance.useKey && !seen.has(instance.useKey), path, '全部过程使用身份必须唯一');
    seen.add(instance.useKey);
    const owned = ownedProcess(compile, instance), { provider, definition, providerIndex, processIndex } = owned;
    if (definition?.entryKind !== 'SKILL_HIT_PASSIVE' && instance.passiveOrigin === undefined) continue;
    const before = issues.length, origin = instance.passiveOrigin;
    check(!!provider && !!definition && definition.entryKind === 'SKILL_HIT_PASSIVE' && !!origin
      && definition.skillKey === instance.skillKey && provider.skillKey === instance.skillKey
      && ['character', 'item', 'build'].includes(provider.kind) && !provider.lifecycle,
    path, '被动实例必须属于真实静态挂载及专用过程定义，原主动过程不能伪装');
    if (!provider || !definition || !origin) continue;
    const listeners = processEntryListeners(provider, instance.owner, instance.providerRef, definition.processKey, origin.useSkillKey);
    check(definition.costs.length === 0 && definition.cooldown === null && definition.steps.some(step => step.stepType === 'DELAY')
      && definition.steps.every(step => ['IMMEDIATE', 'DELAY'].includes(step.stepType) && step.occupiesAction === false)
      && definition.momentOperations.some(group => group.operations.length > 0)
      && !provider.abilities?.some(ability => ability.processControl?.processKey === definition.processKey)
      && listeners.length > 0, path, '被动过程仅接无费用冷却占用的有限步骤与真实同拥有者技能命中监听');
    check(origin.useSource === instance.owner && origin.useKey !== instance.useKey && positive(origin.hitSequence)
      && positive(origin.hitOccurrenceId), path, '被动实例和原技能使用因果必须分离且拥有者一致');
    const original = processForSkillUse(originals, definitions, origin.useKey);
    const binding = original && bindings.find(row => row.source === original.owner && row.providerRef === original.providerRef && row.skillKey === original.skillKey);
    const originalDefinition = original && ownedProcess(compile, original).definition;
    const hitBindings = binding?.hitBindings.filter(row => row.hitAbilityRef === origin.hitAbilityRef) ?? [];
    const contacts = (original?.skillHitStages ?? []).filter(stage => hitBindings.some(hit => hit.hitBindingKey === stage.hitBindingKey)
      && stage.timeMs === instance.startedAtMs && stage.released && stage.contact && stage.completed
      && stage.hitSequence === origin.hitSequence && stage.hitOccurrenceId === origin.hitOccurrenceId && stage.hitBlocked === 0);
    const hit = contacts.length === 1 ? hitBindings.find(hit => hit.hitBindingKey === contacts[0]?.hitBindingKey) : undefined;
    check(!!original && !!binding && !!originalDefinition && original.skillKey === origin.useSkillKey && original.target === instance.target
      && original.owner === instance.owner && !!hit, path, '被动原使用、实际目标与真实命中能力不一致');
    if (!original || !binding || !originalDefinition || !hit) continue;
    const ordinal = recastUseOrdinal(original, originalDefinition, origin.useKey);
    const initial = (request.driverPlan.skillActions ?? []).find(action => action.action === 'INITIAL'
      && action.bindingKey === binding.bindingKey && action.source === instance.owner && action.target === instance.target
      && action.firstAtMs === original.startedAtMs);
    const automatic = request.driverPlan.automaticSkills?.rules.find(rule => rule.bindingKey === binding.bindingKey && rule.target === instance.target);
    check(!!initial || !!automatic, path, '被动原使用缺少本场真实手动或自动驱动');
    let instructionKey = '';
    if (initial) {
      const action = origin.useKey === original.useKey ? initial : (request.driverPlan.skillActions ?? []).find(action => action.action === 'RECAST'
        && action.parentInstructionKey === initial.instructionKey && action.bindingKey === binding.bindingKey && action.firstAtMs === instance.startedAtMs);
      instructionKey = action?.instructionKey ?? '';
      if (done.recording?.skillActionRecordsTruncated === false) check(done.skillActionRecords?.some(row => row.outcome === 'ACCEPTED'
        && row.useRef === origin.useKey && row.instructionKey === instructionKey) === true, path, '被动原指令没有真实接受事实');
    } else if (automatic) {
      const start = original.useKey.startsWith('skill:') ? original.useKey.slice(6) : '';
      instructionKey = ordinal !== null && ordinal > 0 ? `${start}:recast:${ordinal}` : start;
      if (done.automaticSkillRecording?.truncated === false) check(done.automaticSkillRecords?.some(row => row.kind === 'STARTED'
        && row.ruleKey === automatic.ruleKey && row.useRef === original.useKey && row.timeMs === original.startedAtMs) === true,
      path, '被动原使用没有真实自动开始事实');
    }
    check(contacts.length === 1, path, '被动预约缺少唯一不可截断的原命中、未阻挡事实和发生编号');
    if (done.recording?.skillUseRecordsTruncated === false && Array.isArray(done.skillUseRecords)) {
      check(done.skillUseRecords.some(row => row.kind === 'HIT' && row.useRef === origin.useKey
        && row.instructionKey === instructionKey && row.source === instance.owner && row.target === instance.target
        && row.skillKey === origin.useSkillKey && row.providerRef === original.providerRef && row.timeMs === instance.startedAtMs
        && row.hitRef === `hit:${origin.hitOccurrenceId}`), path, '被动原命中发生编号与完整真实HIT记录不符');
    }
    check(origin.useKey === original.useKey || ordinal !== null && ordinal > 0, path, '被动因果不是原首次或已提交重施');
    const duration = done.summary.durationMs;
    check(time(instance.startedAtMs) && instance.startedAtMs >= original.startedAtMs && instance.startedAtMs <= duration
      && time(instance.stepStartedAtMs) && instance.stepStartedAtMs >= instance.startedAtMs && instance.stepStartedAtMs <= duration
      && time(instance.advanceAtMs) && instance.advanceAtMs >= instance.stepStartedAtMs,
    path, '被动过程进入时刻或推进期限不合法');
    check(object(instance.actualCosts) && Object.keys(instance.actualCosts).length === 0 && instance.cooldownStarted === false
      && Array.isArray(instance.actionOccupancies) && instance.actionOccupancies.length === 0 && instance.repeat === null
      && instance.empoweredAttack === undefined && instance.empoweredAttackWindow === undefined
      && instance.empoweredPredecessorUseRef === undefined && instance.skillHitStages === undefined,
    path, '被动续接不能产生主动费用冷却、占用、强化待击或第二份技能命中');
    const currentIndex = definition.steps.findIndex(step => step.stepKey === instance.stepKey);
    const prefix = instance.stepKey === '' && instance.stepVersion === 0;
    check(prefix || currentIndex >= 0 && instance.stepVersion === currentIndex + 1, path, '被动步骤标识与版本不一致');
    check(instance.expiresAtMs === (definition.steps[currentIndex]?.stepType === 'DELAY' ? instance.advanceAtMs : null),
    path, '被动延迟截止必须等于真实冻结推进时刻，即时步骤和未进入前缀不另造期限');
    check(time(instance.stepExecutionIndex) && instance.stepExecutionIndex <= 1
      && (instance.stepExecutionIndex === 0 ? instance.lastExecutionAtMs === null : time(instance.lastExecutionAtMs)
        && instance.lastExecutionAtMs >= instance.stepStartedAtMs && instance.lastExecutionAtMs <= duration)
      && (instance.stepCompletedAtMs === null || instance.stepExecutionIndex === 1 && time(instance.stepCompletedAtMs)
        && instance.stepCompletedAtMs === instance.lastExecutionAtMs), path, '被动步骤真实执行与完成进度不一致');
    check(instance.status === 'active' ? instance.finishedAtMs === null && instance.failureReason === null && instance.stepCompletedAtMs === null
      : instance.status === 'complete' ? currentIndex === definition.steps.length - 1 && instance.failureReason === null
        && instance.finishedAtMs === instance.stepCompletedAtMs && time(instance.finishedAtMs)
        : instance.status === 'failed' && time(instance.finishedAtMs) && instance.finishedAtMs >= instance.stepStartedAtMs
          && instance.finishedAtMs === duration && (instance.failureReason === 'SOURCE_DIED'
            ? done.summary[instance.owner === 'source' ? 'sourceFinalHp' : 'targetFinalHp'] === 0
            : instance.failureReason === 'TARGET_UNTARGETABLE' && done.summary[instance.target === 'source' ? 'sourceFinalHp' : 'targetFinalHp'] === 0),
    path, '被动过程终态与真实末步完成或失败时点不一致');
    if (!prefix && currentIndex >= 0) {
      const delays = foldedDurations(definition), currentDelay = delays[currentIndex];
      if (currentDelay !== null && currentDelay !== undefined) check(time(currentDelay)
        && instance.advanceAtMs === instance.stepStartedAtMs + currentDelay, path, '被动推进期限改写了明确作者延迟');
      if (instance.stepExecutionIndex === 1) check(instance.lastExecutionAtMs === instance.advanceAtMs, path, '被动步骤不能提前或重复执行');
      if (delays.slice(0, currentIndex).every(value => value !== null && time(value))) {
        check(instance.stepStartedAtMs === instance.startedAtMs + delays.slice(0, currentIndex).reduce<number>((n, value) => n + (value ?? 0), 0),
          path, '被动步骤进入时刻不符合原有限步骤顺序');
      }
    } else check(instance.status !== 'complete' && instance.stepExecutionIndex === 0 && instance.stepStartedAtMs === instance.startedAtMs,
      path, '未进入首步的被动前缀不能伪造完成');
    const admissionKey = JSON.stringify([instance.owner, instance.providerRef, instance.processKey, origin.hitOccurrenceId]);
    const count = (admissions.get(admissionKey) ?? 0) + 1; admissions.set(admissionKey, count);
    check(count <= listeners.length, path, '同原命中启动的被动实例超过真实作者启动操作数');
    if (issues.length === before) facts.push({ instance, definition, provider, providerIndex, processIndex, originProcess: original,
      listenerRefs: [...new Set(listeners)], instructionKey, hitTimeMs: instance.startedAtMs });
  }
  return { issues, facts, processes: facts.map(fact => fact.instance) };
}

/** 仅返回已校验实例的精确时点叶操作；普通监听继续保留原同刻规则。 */
export function passiveProcessOperation(facts: readonly PassiveProcessFact[], row: DamageRecord | HealingRecord): OperationDefinition | null {
  const matches: OperationDefinition[] = [];
  for (const fact of facts) {
    const origin = fact.instance.passiveOrigin;
    if (!origin || row.useRef !== origin.useKey || row.instructionKey !== fact.instructionKey || row.source !== fact.instance.owner
      || !fact.listenerRefs.includes(row.abilityRef)) continue;
    if ('owner' in row && (row.owner !== fact.instance.owner || row.hitRef !== `hit:${origin.hitOccurrenceId}` || row.attackIndex !== null)) continue;
    for (const [groupIndex, group] of fact.definition.momentOperations.entries()) {
      if (momentTime(fact, group.moment) !== row.timeMs) continue;
      for (const [operationIndex, operation] of group.operations.entries()) {
        const path = `sharedProviders[${fact.providerIndex}].processes[${fact.processIndex}].momentOperations[${groupIndex}].operations[${operationIndex}]`;
        if (operation.ref !== row.operationRef || row.target !== (operation.target === 'self' ? fact.instance.owner
          : operation.target === 'target' ? fact.instance.target : null)) continue;
        if ('operationPath' in row && (operation.operation !== 'damage' || row.operationPath !== path || operation.damageType !== row.damageType)) continue;
        if (!('operationPath' in row) && operation.operation !== 'heal') continue;
        matches.push(operation);
      }
    }
  }
  return matches.length === 1 ? matches[0]! : null;
}

export function passiveProcessDamagePath(compile: CompileRequest, path: string): boolean {
  const match = /^sharedProviders\[(\d+)\]\.processes\[(\d+)\]\.momentOperations\[(\d+)\]\.operations\[(\d+)\]$/.exec(path);
  if (!match) return false;
  const process = compile.sharedProviders?.[Number(match[1])]?.processes?.[Number(match[2])];
  return process?.entryKind === 'SKILL_HIT_PASSIVE'
    && process.momentOperations[Number(match[3])]?.operations[Number(match[4])]?.operation === 'damage';
}
