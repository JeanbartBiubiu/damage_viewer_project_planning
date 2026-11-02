import type { CompileRequest, DoneResult, GenericFormulaExpr, OperationDefinition, RunRequest } from '../../src/types/genericEngine';
import { simulationAbility } from '../../src/engine/simulationAdapter';
import type { OperationOrigin } from '../../src/engine/simulation/model';
import type { ProjectedRestoration } from './mechanismCase';
import { inspectDamageStateBefore } from '../../src/engine/targetTimingResultContract';
import { finiteImmediatePeriodicDamageSource } from '../../src/engine/finiteImmediatePeriodicContract';
import { tryFoldConstant } from '../../src/engine/numericAdapter';

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
function fail(message: string): never { throw new Error(`restorations: ${message}`); }
function atPath(compile: CompileRequest, path: string): OperationDefinition {
  let value: unknown = compile;
  for (const key of path.replace(/\[(\d+)\]/g, (_match, index: string) => `.${index}`).split('.')) {
    if (!value || typeof value !== 'object' || !own(value, key)) fail('操作路径缺少真实编译节点');
    value = (value as Record<string, unknown>)[key];
  }
  if (!value || typeof value !== 'object') fail('缺少真实恢复操作');
  return value as OperationDefinition;
}
function finite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(`${name}缺失或不是有限非负值`);
  return value;
}
function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(`${name}真实身份缺失`);
  return value;
}
function agrees(a: number, b: number) { return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)); }

/** 本笔金额的私有运算树；不让当前属性或其它事件值借空useRef获得治疗因果。 */
function readsOneSettledAmount(expression: GenericFormulaExpr | undefined, params: Record<string, number> = {}): boolean {
  const scalar = (node: GenericFormulaExpr) => {
    const bind = (value: GenericFormulaExpr): GenericFormulaExpr => value.op === 'read' && value.path?.startsWith('ability.param.')
      && Object.prototype.hasOwnProperty.call(params, value.path.slice('ability.param.'.length))
      ? { op: 'const', value: params[value.path.slice('ability.param.'.length)] }
      : { ...value, ...(value.args ? { args: value.args.map(bind) } : {}) };
    const value = tryFoldConstant(bind(node));
    return value !== null && value >= 0 ? value : null;
  };
  const count = (node: GenericFormulaExpr, outer: boolean): number | null => {
    if (node.op === 'read' && node.path === 'event.damage.mitigatedAmount') return 1;
    if (scalar(node) !== null) return 0;
    if (!node.args || node.args.length !== 2) return null;
    if (outer && node.op === 'max') {
      const index = node.args.findIndex(value => scalar(value) === 0);
      return index < 0 ? null : count(node.args[1 - index]!, false);
    }
    if (!['mul', 'div'].includes(node.op)) return null;
    const left = count(node.args[0]!, false), right = count(node.args[1]!, false);
    if (left === null || right === null || left + right > 1 || node.op === 'div' && (right !== 0 || scalar(node.args[1]!) === 0)) return null;
    return left + right;
  };
  return !!expression && count(expression, true) === 1;
}

function finitePeriodHealCause(compile: CompileRequest, done: DoneResult, itemIndex: number, operation: OperationDefinition,
  actual: NonNullable<ReturnType<typeof simulationAbility>>): boolean {
  const item = done.evidence.items[itemIndex]!, data = item.data!, listener = actual.ability.listenerSpec!;
  if (item.kind !== 'heal' || data.source !== data.owner || data.target !== data.owner || actual.provider.kind !== 'character' || actual.provider.lifecycle || !actual.provider.stableId
    || actual.ability.kind !== 'passive_listener' || actual.ability.processControl || actual.ability.tickSpec || actual.ability.cost || actual.ability.cooldown
    || listener.operations?.length !== 1 || listener.operations[0] !== operation || listener.maxTriggersPerEvent !== 1 || listener.abilityRef
    || listener.oncePerUse || listener.perCastThrottleMs || !listener.eventMatcher.all?.includes('event/damage_instance')
    || !listener.eventMatcher.all.includes('event/source_owner') || !readsOneSettledAmount(operation.amount, actual.ability.params)
    || done.recording?.damageRecordsTruncated !== false || done.recording.healingRecordsTruncated !== false) return false;
  const candidates = (done.damageRecords ?? []).filter(row => row.timeMs === item.timeMs && row.source === data.owner && row.useRef === ''
    && !row.instructionKey && !row.hitRef);
  if (candidates.length !== 1 || !finiteImmediatePeriodicDamageSource(compile, candidates[0]!, done.finalSnapshot.processInstances)) return false;
  const damage = candidates[0]!;
  const definition = compile.sharedProviders!.find(provider => provider.providerKey === damage.providerDefinitionRef)!, sender = definition.abilities![0]!;
  const damageOperation = atPath(compile, damage.operationPath);
  const eventTypes = new Set(['event/damage_instance', 'event/source_owner', damage.damageType, ...(sender.types ?? []), ...(damageOperation.types ?? [])]);
  if (listener.eventMatcher.all!.some(key => !eventTypes.has(key)) || listener.eventMatcher.any?.length && !listener.eventMatcher.any.some(key => eventTypes.has(key))
    || listener.eventMatcher.none?.some(key => eventTypes.has(key))) return false;
  const heals = (done.healingRecords ?? []).filter(row => row.timeMs === item.timeMs && row.abilityRef === data.abilityRef
    && row.operationRef === operation.ref && row.useRef === null && row.source === data.owner && row.target === data.owner
    && row.hpBefore === data.hpBefore && row.hpAfter === data.hpAfter && row.rawAmount === data.healingBeforeModifiers
    && row.actualHealing === data.actualHealing && row.overheal === data.overheal);
  if (heals.length !== 1 || damage.sourceHpAfter === null || !agrees(heals[0]!.hpBefore, damage.sourceHpAfter)) return false;
  for (const value of [data, heals[0]!]) for (const [key, expected] of [['triggerDamageId', damage.damageId],
    ['triggerDamageSource', damage.source], ['triggerDamageTarget', damage.target]] as const) {
    if (own(value, key) && (value as Record<string, unknown>)[key] !== expected) return false;
  }
  const healing = heals[0]!;
  if (done.evidence.items.filter(fact => fact.kind === 'heal' && fact.timeMs === item.timeMs && fact.data && fact.data.abilityRef === data.abilityRef
    && fact.data.operationRef === data.operationRef && fact.data.operationPath === data.operationPath && fact.data.hpBefore === data.hpBefore
    && fact.data.hpAfter === data.hpAfter && fact.data.healingBeforeModifiers === data.healingBeforeModifiers).length !== 1) return false;
  if (damage.healthOrder !== undefined || healing.healthOrder !== undefined) {
    if (!Number.isSafeInteger(damage.healthOrder) || !Number.isSafeInteger(healing.healthOrder)
      || damage.healthOrder! < 1 || damage.healthOrder! >= healing.healthOrder!) return false;
  }
  const facts = done.evidence.items.map((fact, index) => ({ fact, index }));
  const damageFacts = facts.filter(({ fact }) => fact.kind === 'damage' && fact.data?.damageId === damage.damageId);
  if (damageFacts.length !== 1) return false;
  const { fact, index } = damageFacts[0]!;
  const damageData = fact.data;
  if (!damageData || index >= itemIndex || fact.timeMs !== item.timeMs || fact.ref !== damage.abilityRef || damageData.abilityRef !== damage.abilityRef
    || damageData.operationRef !== damage.operationRef || damageData.castInstanceId !== damage.castInstanceId
    || damageData.source !== damage.source || damageData.target !== damage.target) return false;
  const vamp = facts.filter(({ fact }) => fact.kind === 'vamp' && fact.data?.damageId === damage.damageId);
  if (compile.rules.vampRules?.length) {
    if (vamp.length !== 1 || vamp[0]!.index <= index || vamp[0]!.index >= itemIndex) return false;
    const value = vamp[0]!.fact;
    if (value.timeMs !== damage.timeMs || value.ref !== damage.operationRef || value.data?.abilityRef !== damage.abilityRef
      || value.data.operationRef !== damage.operationRef || value.data.castInstanceId !== damage.castInstanceId
      || value.data.source !== damage.source || value.data.target !== damage.source || value.data.damageTarget !== damage.target
      || typeof value.data.actualHealing !== 'number' || damage.sourceHpBefore === null
      || !agrees(damage.sourceHpAfter - damage.sourceHpBefore, value.data.actualHealing)) return false;
  } else if (vamp.length || damage.sourceHpBefore !== damage.sourceHpAfter) return false;
  return true;
}

/** 从暂存后正式发布的完整证据取值；不从终值猜逐笔，不把缺少身份补成拥有者。 */
export function projectRestorations(origins: readonly OperationOrigin[], compile: CompileRequest, request: RunRequest,
  done: DoneResult): ProjectedRestoration[] {
  const restoreAbilities = new Set(origins.filter(origin => {
    const actual = simulationAbility(compile, origin.abilityRef);
    if (!actual?.ability.listenerSpec || !['character', 'build', 'item'].includes(actual.provider.kind)) return false;
    return origin.compiledPaths.some(path => {
      const operation = atPath(compile, path);
      return operation.target === 'self' && ['heal', 'resource_change'].includes(operation.operation);
    });
  }).map(origin => origin.abilityRef));
  const evidence = done.evidence.items;
  const newCausalEvidence = evidence.some(item => item.kind === 'damage_state_before'
    || item.kind === 'resource_restore' && item.data && 'triggerDamageId' in item.data);
  const before = newCausalEvidence ? inspectDamageStateBefore(compile, request, done) : { issues: [], identityGaps: [] };
  if (before.issues.length) fail(before.issues.join('; '));
  if ((restoreAbilities.size > 0 || evidence.some(row => row.kind === 'resource_restore')) && done.evidence.truncated) {
    fail('恢复证据被截断，不能以最终值代替完整逐笔列表');
  }
  return evidence.flatMap((item, itemIndex) => {
    if (item.kind !== 'resource_restore' && (item.kind !== 'heal'
      || !restoreAbilities.has(item.ref ?? '') && !restoreAbilities.has(String(item.data?.abilityRef ?? '')))) return [];
    const data = item.data;
    if (!data) fail('缺少正式恢复证据');
    const abilityRef = text(data.abilityRef, 'abilityRef');
    const actual = simulationAbility(compile, abilityRef);
    if (item.kind === 'resource_restore' && actual?.ability.kind === 'active' && !actual.ability.listenerSpec) {
      const path = text(data.operationPath, 'operationPath'), operation = atPath(compile, path);
      const providerIndex = compile.sharedProviders!.indexOf(actual.provider), abilityIndex = actual.provider.abilities!.indexOf(actual.ability);
      const process = actual.ability.processControl && actual.provider.processes?.find(row => row.processKey === actual.ability.processControl!.processKey);
      const processIndex = process ? actual.provider.processes!.indexOf(process) : -1;
      const ownedPath = path.startsWith(`sharedProviders[${providerIndex}].abilities[${abilityIndex}].operations[`)
        || processIndex >= 0 && path.startsWith(`sharedProviders[${providerIndex}].processes[${processIndex}].momentOperations[`);
      if (!ownedPath || operation.operation !== 'resource_change' || !['self', 'source'].includes(operation.target)
        || operation.resourceKey !== data.resourceKey || !(operation.ref === data.operationRef || operation.ref === undefined && data.operationRef === '')
        || data.providerRef !== actual.mount.providerRef || data.providerDefinitionRef !== actual.provider.providerKey
        || !abilityRef.startsWith(`${data.owner}.provider[`) || data.target !== data.owner
        || item.ref !== (data.operationRef === '' ? abilityRef : data.operationRef)) fail('范围外主动资源事实仍须对应真实原挂载及恢复操作');
      return [];
    }
    const operationRef = text(data.operationRef, 'operationRef');
    if (!actual?.ability.listenerSpec || !['character', 'build', 'item'].includes(actual.provider.kind)) fail('不是实际挂载的普通监听恢复');
    const owner = text(data.owner, 'owner'), source = text(data.source, 'source'), target = text(data.target, 'target');
    if (!['source', 'target'].includes(owner) || !['source', 'target'].includes(source) || target !== owner
      || !abilityRef.startsWith(`${owner}.provider[`)) fail('普通自身恢复拥有者或接收者不一致');
    const providerRef = text(data.providerRef, 'providerRef'), providerDefinitionRef = text(data.providerDefinitionRef, 'providerDefinitionRef');
    if (providerRef !== actual.mount.providerRef || providerDefinitionRef !== actual.provider.providerKey
      || actual.mount.definitionRef !== providerDefinitionRef) fail('恢复供值器不是同一实际挂载定义');
    const operationPath = text(data.operationPath, 'operationPath');
    const matches = origins.filter(row => row.abilityRef === abilityRef && row.operationRef === operationRef
      && row.compiledPaths.includes(operationPath)
      && (!own(row, 'providerDefinitionRef') || row.providerDefinitionRef === providerDefinitionRef));
    if (matches.length !== 1) fail('恢复操作不能唯一映射作者来源');
    const providerIndex = compile.sharedProviders!.indexOf(actual.provider), abilityIndex = actual.provider.abilities!.indexOf(actual.ability);
    if (!operationPath.startsWith(`sharedProviders[${providerIndex}].abilities[${abilityIndex}].listenerSpec.operations[`)) {
      fail('恢复操作路径不属于同一实际监听能力');
    }
    const operation = atPath(compile, operationPath);
    if (operation.target !== 'self' || operation.ref !== operationRef
      || operation.operation !== (item.kind === 'heal' ? 'heal' : 'resource_change')) fail('证据不是该普通自身恢复操作');
    if (!own(data, 'useRef') || data.useRef !== null && (typeof data.useRef !== 'string' || !data.useRef)) fail('原始使用身份缺失');
    const useRef = data.useRef as string | null;
    if (useRef === null) {
      const causalDamage = item.kind === 'resource_restore' && Number.isSafeInteger(data.triggerDamageId) && Number(data.triggerDamageId) > 0
        && actual.ability.listenerSpec.eventMatcher.all?.includes('event/damage_instance')
        && actual.ability.listenerSpec.eventMatcher.all?.includes('event/source_owner')
        && before.identityGaps.length === 0
        && evidence.some(row => row.kind === 'damage_state_before' && row.data?.damageId === data.triggerDamageId
          && row.data?.owner === owner && row.data?.providerRef === providerRef && row.data?.target === data.triggerDamageTarget);
      if (!actual.ability.listenerSpec.eventMatcher.all?.includes('event/source_initialized') && !causalDamage
        && !finitePeriodHealCause(compile, done, itemIndex, operation, actual)) fail('非初始化恢复缺少真实原使用或完整逐伤冻结关联');
    } else {
      if (!done.attackRecords?.some(row => row.useRef === useRef)
        && !done.finalSnapshot.processInstances?.some(row => row.useKey === useRef)
        && !request.skillUses?.some(row => row.useKey === useRef)) fail('使用身份没有真实攻击、过程或原始使用事实');
      const events = actual.ability.listenerSpec.eventMatcher.all ?? [];
      if (events.includes('event/damage_instance') || events.includes('event/damage_taken')) {
        if (!done.damageRecords?.some(row => row.useRef === useRef && row.timeMs === item.timeMs
          && (events.includes('event/damage_taken') ? row.target : row.source) === owner)) fail('恢复使用身份不属于同刻本方真实伤害事件');
      }
    }
    const heal = item.kind === 'heal', resourceKey = heal ? 'hp' : text(data.resourceKey, 'resourceKey');
    if (!heal && resourceKey !== operation.resourceKey || item.ref !== (heal ? abilityRef : operationRef)) fail('恢复资源或证据引用身份不一致');
    const requestedAmount = finite(heal ? data.healingBeforeModifiers : data.requestedAmount, 'requestedAmount');
    const effectiveAmount = finite(heal ? data.healingAfterModifiers : data.requestedAmount, 'effectiveAmount');
    if (heal) finite(data.healingAfterDone, 'healingAfterDone');
    const currentBefore = finite(heal ? data.hpBefore : data.currentBefore, 'currentBefore');
    const currentAfter = finite(heal ? data.hpAfter : data.currentAfter, 'currentAfter');
    const actualDelta = finite(heal ? data.actualHealing : data.actualDelta, 'actualDelta');
    const overflow = finite(heal ? data.overheal : data.overflow, 'overflow');
    if (!agrees(currentAfter - currentBefore, actualDelta) || !agrees(actualDelta + overflow, effectiveAmount)
      || heal && currentBefore <= 0) fail('恢复前后、实际增量、溢出或存活条件不守恒');
    const timeMs = finite(item.timeMs, 'timeMs');
    if (!Number.isSafeInteger(timeMs) || timeMs > done.finalSnapshot.timeMs) fail('恢复时刻超出真实观察');
    return [{ timeMs, kind: item.kind, owner, source, target, providerRef, providerDefinitionRef, abilityRef, operationRef,
      operationPath, useRef, resourceKey, requestedAmount, effectiveAmount, currentBefore, currentAfter, actualDelta, overflow } as ProjectedRestoration];
  });
}
