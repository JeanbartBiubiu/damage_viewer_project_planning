import type { CompileRequest, DoneResult, OperationDefinition, RunRequest } from '../../src/types/genericEngine';
import { simulationAbility, type OperationOrigin } from '../../src/engine/simulationAdapter';
import type { ProjectedRestoration } from './mechanismCase';

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
  if ((restoreAbilities.size > 0 || evidence.some(row => row.kind === 'resource_restore')) && done.evidence.truncated) {
    fail('恢复证据被截断，不能以最终值代替完整逐笔列表');
  }
  return evidence.flatMap(item => {
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
      if (!actual.ability.listenerSpec.eventMatcher.all?.includes('event/source_initialized')) fail('非初始化恢复缺少真实原使用');
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
