import type { CompileRequest, DoneResult, OperationDefinition, ProviderDefinition, RunRequest } from '../types/genericEngine';
import { tryFoldConstant } from './numericAdapter';

type Side = 'source' | 'target';
type Mount = { side: Side; providerRef: string; definitionRef: string };
export type PermanentHealthInitializer = { owner: Side; source: Side; target: Side; sourceProviderRef: string;
  sourceDefinitionRef: string; listenerKey: string; opRef: string; opPath: string; abilityRef: null; useRef: null;
  definitionRef: string; modifierKey: string; value: number };
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
function fail(path: string, reason: string): never { throw new Error(`${path}: ${reason}`); }
function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '需要完整对象');
  return value as Record<string, unknown>;
}
function exact(value: unknown, keys: readonly string[], path: string) {
  const row = record(value, path);
  if (Object.keys(row).length !== keys.length || keys.some(key => !own(row, key))) fail(path, '字段缺失或含未支持字段');
  return row;
}
function amount(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(path, '需要有限非负数');
  return value;
}

/** 授权源于实际挂载的来源初始化监听；永久生命不获得普通施加入口。 */
export function permanentHealthInitializers(providers: readonly ProviderDefinition[], mounts: readonly Mount[]): PermanentHealthInitializer[] {
  const definitions = providers.filter(provider => provider.modifiers?.some(modifier => modifier.currentValuePolicy === 'preserve_initial_current'));
  if (!definitions.length) return [];
  const expected: PermanentHealthInitializer[] = [], authorized = new Set<OperationDefinition>();
  for (const definition of definitions) {
    const modifier = definition.modifiers?.[0];
    const value = modifier && tryFoldConstant(modifier.value);
    if (providers.filter(row => row.providerKey === definition.providerKey).length !== 1 || definition.kind !== 'status' || !text(definition.skillKey)
      || !text(definition.stableId) || definition.modifiers?.length !== 1 || modifier?.kind !== 'resource_max'
      || modifier.currentValuePolicy !== 'preserve_initial_current' || modifier.target !== 'self.attr.hp'
      || modifier.valuePolicy !== 'add' || typeof value !== 'number' || !Number.isFinite(value) || value < 0
      || Object.keys(modifier).some(key => !['modifierKey', 'kind', 'target', 'valuePolicy', 'value', 'currentValuePolicy'].includes(key))
      || definition.lifecycle || definition.types?.length || definition.abilities?.length || definition.listeners?.length || definition.processes?.length
      || Object.keys(definition.initialStateSchema ?? {}).length || mounts.some(mount => mount.definitionRef === definition.providerKey)) {
      fail(`sharedProviders.${definition.providerKey}`, '永久生命需要单个静态非负自身容量平加和真实冷初始化授权');
    }
    let references = 0;
    for (const [providerIndex, parent] of providers.entries()) for (const [listenerIndex, listener] of (parent.listeners ?? []).entries()) {
      for (const [operationIndex, operation] of (listener.operations ?? []).entries()) {
        if (operation.providerDefinitionRef !== definition.providerKey) continue;
        references++;
        const actualMounts = mounts.filter(mount => mount.definitionRef === parent.providerKey);
        const matcher = listener.eventMatcher;
        if (parent.kind !== 'character' || parent.skillKey !== definition.skillKey || !text(parent.stableId)
          || Object.keys(listener).some(key => !['listenerKey', 'eventMatcher', 'operations', 'maxTriggersPerEvent'].includes(key))
          || Object.keys(matcher).length !== 1 || !Array.isArray(matcher.all) || matcher.all.length !== 2
          || !matcher.all.includes('event/source_initialized') || !matcher.all.includes('event/source_owner')
          || listener.maxTriggersPerEvent !== 1 || !text(listener.listenerKey) || actualMounts.length !== 1
          || operation.operation !== 'apply_provider' || operation.target !== 'self' || !text(operation.ref) || !text(operation.providerRef)
          || Object.keys(operation).some(key => !['operation', 'target', 'ref', 'providerRef', 'providerDefinitionRef'].includes(key))) {
          fail(`sharedProviders[${providerIndex}].listeners[${listenerIndex}]`, '永久生命必须由唯一真实角色自身初始化操作安装');
        }
        const mount = actualMounts[0]!;
        expected.push({ owner: mount.side, source: mount.side, target: mount.side, sourceProviderRef: mount.providerRef,
          sourceDefinitionRef: parent.providerKey, listenerKey: listener.listenerKey, opRef: operation.ref,
          opPath: `sharedProviders[${providerIndex}].listeners[${listenerIndex}].operations[${operationIndex}]`, abilityRef: null, useRef: null,
          definitionRef: definition.providerKey, modifierKey: modifier.modifierKey, value });
        authorized.add(operation);
      }
    }
    if (references !== 1) fail(`sharedProviders.${definition.providerKey}`, '永久生命定义须恰有一个实际初始化消费者');
  }
  const visit = (value: unknown, path: string): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach((child, index) => visit(child, `${path}[${index}]`)); return; }
    const row = value as OperationDefinition;
    if (definitions.some(definition => row.providerDefinitionRef === definition.providerKey) && !authorized.has(row)) fail(path, '永久生命不能被普通能力、过程或其它监听再次施加');
    Object.entries(value).forEach(([key, child]) => visit(child, `${path}.${key}`));
  };
  providers.forEach((provider, index) => visit(provider, `sharedProviders[${index}]`));
  const identities = new Set<string>();
  for (const row of expected) {
    const key = `${row.owner}/${row.definitionRef}`;
    if (identities.has(key)) fail(key, '永久生命实例身份重复');
    identities.add(key);
  }
  return expected.sort((a, b) => a.opPath < b.opPath ? -1 : a.opPath > b.opPath ? 1 : 0);
}

export function permanentHealthIncreases(providers: readonly ProviderDefinition[], mounts: readonly Mount[]): Record<Side, number> {
  const result = { source: 0, target: 0 };
  for (const row of permanentHealthInitializers(providers, mounts)) {
    result[row.owner] += row.value;
    if (!Number.isFinite(result[row.owner])) fail('permanentHealth', '永久生命贡献合计溢出');
  }
  return result;
}

function healthAnchor(compile: CompileRequest, side: Side): number {
  const actor = compile.combatants.find(actor => actor.key === side);
  let anchor = amount(actor?.attributes.hp?.base, 'combatants.hp.base');
  for (const mount of actor!.providers) {
    const provider = compile.sharedProviders?.find(provider => provider.providerKey === mount.definitionRef);
    for (const modifier of provider?.modifiers ?? []) if (modifier.target === 'self.attr.hp') {
      const value = tryFoldConstant(modifier.value);
      if (provider!.kind !== 'item' || modifier.kind !== 'attribute' || modifier.valuePolicy !== 'add'
        || typeof value !== 'number' || !Number.isFinite(value) || modifier.condition || modifier.stage || modifier.currentValuePolicy) {
        fail('combatants.hp', '初始生命只允许真实装备静态平加与已授权永久初始化贡献');
      }
      anchor += value;
    }
  }
  if (!Number.isFinite(anchor) || anchor <= 0) fail('combatants.hp', '真实生命锚点必须是有限正数');
  return anchor;
}

/** 独立冷初始化事实不进入战斗生命顺序；截断只能报告证明缺口，保留项仍完整核验。 */
export function inspectPermanentHealthInitialization(compile: CompileRequest, request: RunRequest, done: DoneResult) {
  const issues: string[] = [], identityGaps: string[] = [];
  try {
    const initializers = permanentHealthInitializers(compile.sharedProviders ?? [], compile.combatants.flatMap(actor => actor.providers.map(mount =>
      ({ side: actor.key as Side, providerRef: mount.providerRef, definitionRef: mount.definitionRef }))));
    const facts = (done.evidence?.items ?? []).filter(item => item.kind === 'resource_max_initialized');
    if (!initializers.length) {
      if (facts.length) fail('resource_max_initialized', '本编译没有永久生命初始化授权');
      return { issues, identityGaps };
    }
    if (!done.evidence || !Array.isArray(done.evidence.items)) fail('resource_max_initialized', '缺少真实冷初始化证据通道');
    if (request.initialSnapshot.timeMs !== 0 || (request.initialSnapshot.processInstances ?? []).length
      || (request.initialSnapshot.useTriggerLedger ?? []).length) fail('initialSnapshot', '永久生命只接全新0毫秒冷初始化');
    for (const row of initializers) if (request.initialSnapshot.combatants.some(actor => actor.providers.some(provider => provider.definitionRef === row.definitionRef))) {
      fail('initialSnapshot.providers', '永久生命实例不能预装在外部快照');
    }
    const owners = new Set(initializers.map(row => row.owner));
    if (done.evidence.countsByKind?.resource_max_initialized !== owners.size) fail('resource_max_initialized.count', '冷初始化可靠次数须等于实际拥有者数');
    const instances = new Map<string, string>();
    for (const row of initializers) {
      const actual = done.finalSnapshot.combatants.flatMap(actor => actor.providers.filter(provider => provider.definitionRef === row.definitionRef)
        .map(provider => ({ actor, provider })));
      if (actual.length !== 1 || actual[0]!.actor.key !== row.owner || actual[0]!.provider.owner !== row.owner || actual[0]!.provider.source !== row.owner
        || actual[0]!.provider.stacks !== 1 || actual[0]!.provider.expireAt !== null || !text(actual[0]!.provider.providerRef)
        || [...instances.values()].includes(actual[0]!.provider.providerRef)) fail('resource_max_initialized.provider', '实际永久实例缺失、重复或拥有者、来源、期限不符');
      instances.set(row.opPath, actual[0]!.provider.providerRef);
    }
    for (const fact of facts) if (!owners.has(fact.data?.owner as Side)) fail('resource_max_initialized', '冷初始化包含外来拥有者');
    for (const side of owners) {
      const expected = initializers.filter(row => row.owner === side), rows = facts.filter(item => item.data?.owner === side);
      const hp = request.initialSnapshot.combatants.find(actor => actor.key === side)?.attributes.hp;
      if (!hp) fail('initialSnapshot.hp', '缺少明确生命初值');
      const compiledHp = compile.combatants.find(actor => actor.key === side)?.attributes.hp;
      if (!compiledHp || ['base', 'max', 'current', 'resolved'].some(key => hp[key as keyof typeof hp] !== compiledHp[key as keyof typeof compiledHp])) {
        fail('initialSnapshot.hp', '冷初始化生命四槽必须保持本次编译的明确初值');
      }
      const increase = expected.reduce((total, row) => total + row.value, 0);
      const expectedAnchor = healthAnchor(compile, side);
      if (!close(expectedAnchor + increase, hp.max) || hp.resolved !== hp.max || !Number.isFinite(hp.current) || hp.current < 0 || hp.current > hp.max) fail('initialSnapshot.hp', '冷初始化必须使用真实容量和明确合法当前值');
      const summaryOnly = request.outputMode === 'summary' && done.outputMode === 'summary';
      if (!rows.length && (done.evidence.truncated || summaryOnly)) { identityGaps.push(`${side}永久生命冷初始化明细未保留，不能独立交叉核实完整来源证据`); continue; }
      if (rows.length !== 1 || rows[0]!.timeMs !== 0 || rows[0]!.ref !== side) fail('resource_max_initialized', '每个实际拥有者须保留唯一0毫秒初始化事实');
      const data = exact(rows[0]!.data, ['resourceKey', 'owner', 'target', 'anchorMax', 'permanentIncrease', 'max', 'current', 'contributions'], 'resource_max_initialized.data');
      if (data.resourceKey !== 'hp' || data.target !== side) fail('resource_max_initialized', '资源或接收者与拥有者不一致');
      const anchor = amount(data.anchorMax, 'anchorMax');
      if (!close(anchor, expectedAnchor) || !close(amount(data.permanentIncrease, 'permanentIncrease'), increase) || !close(amount(data.max, 'max'), hp.max)
        || !close(amount(data.current, 'current'), hp.current) || !close(anchor + increase, hp.max)
        || hp.resolved !== hp.max || hp.current > hp.max) fail('resource_max_initialized', '初始容量或显式当前生命不守恒');
      if (!Array.isArray(data.contributions) || data.contributions.length !== expected.length) fail('resource_max_initialized.contributions', '贡献完整列表缺失或多出');
      const used = new Set<string>();
      for (const value of data.contributions) {
        const row = exact(value, ['owner', 'source', 'target', 'sourceProviderRef', 'sourceDefinitionRef', 'listenerKey', 'opRef', 'opPath',
          'abilityRef', 'useRef', 'providerRef', 'definitionRef', 'modifierKey', 'value'], 'resource_max_initialized.contributions');
        const actual = expected.filter(entry => entry.opPath === row.opPath && entry.sourceProviderRef === row.sourceProviderRef);
        if (actual.length !== 1 || used.has(actual[0]!.opPath)) fail('resource_max_initialized.contributions', '贡献实际来源缺失、重复或外来');
        const author = actual[0]!;
        for (const key of Object.keys(author) as (keyof PermanentHealthInitializer)[]) if (row[key] !== author[key]) fail(`resource_max_initialized.${key}`, '贡献未对应真实挂载、定义、监听、操作及显式空使用身份');
        used.add(author.opPath);
        if (!text(row.providerRef) || row.providerRef !== instances.get(author.opPath)) fail('resource_max_initialized.provider', '证据必须指向真实新安装的唯一永久实例，不能猜测实例标识');
      }
    }
  } catch (error) { issues.push(error instanceof Error ? error.message : String(error)); }
  return { issues, identityGaps };
}
