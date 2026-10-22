import type { AbilityDefinition, CompileRequest, DoneResult, GenericFormulaExpr, OperationDefinition, ProviderDefinition, RunRequest } from '../types/genericEngine';
import type { OperationOrigin } from './simulationAdapter';
import { tryFoldConstant } from './numericAdapter';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const close = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const beforePrefix = 'event.provider_target_state_before.';
function compiledAt(input: CompileRequest, path: string): unknown {
  let row: unknown = input;
  for (const key of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (!object(row) && !Array.isArray(row)) return undefined;
    row = (row as Record<string, unknown>)[key];
  }
  return row;
}
function matcherAccepts(input: CompileRequest, keys: readonly string[], consumer: AbilityDefinition) {
  const types = new Set(keys);
  let changed = true;
  while (changed) {
    changed = false;
    for (const relation of input.typeCatalog.relations) if (types.has(relation.child) && !types.has(relation.parent)) { types.add(relation.parent); changed = true; }
  }
  const matcher = consumer.listenerSpec!.eventMatcher;
  return (matcher.all ?? []).every(type => types.has(type)) && (!matcher.any?.length || matcher.any.some(type => types.has(type)))
    && !(matcher.none ?? []).some(type => types.has(type));
}
function actualAbility(input: CompileRequest, reference: unknown): AbilityDefinition | undefined {
  if (typeof reference !== 'string') return undefined;
  const match = /^(source|target)\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$/.exec(reference);
  const actor = match && input.combatants.find(row => row.key === match[1]);
  const mount = actor && actor.providers.find(row => row.providerRef === match![2]);
  return mount ? input.sharedProviders?.find(row => row.providerKey === mount.definitionRef)?.abilities?.find(row => row.abilityKey === match![3]) : undefined;
}
function damageOperations(value: unknown): OperationDefinition[] {
  if (Array.isArray(value)) return value.flatMap(damageOperations);
  if (!object(value)) return [];
  return [...(value.operation === 'damage' ? [value as OperationDefinition] : []), ...Object.values(value).flatMap(damageOperations)];
}
function eventMatches(input: CompileRequest, ability: AbilityDefinition, damage: NonNullable<DoneResult['damageRecords']>[number], consumer: AbilityDefinition) {
  const operation = compiledAt(input, damage.operationPath);
  return object(operation) && operation.operation === 'damage' && operation.ref === damage.operationRef
    && matcherAccepts(input, ['event/damage_instance', 'event/source_owner', damage.damageType, ...(ability.types ?? []),
      ...(Array.isArray(operation.types) ? operation.types.filter((row): row is string => typeof row === 'string') : [])], consumer);
}
function foldPredicate(expression: GenericFormulaExpr): number | null {
  const direct = tryFoldConstant(expression);
  if (direct !== null) return direct;
  const args = expression.args?.map(foldPredicate);
  if (!args || args.some(value => value === null)) return null;
  const values = args as number[];
  if (values.length === 2) {
    const [a, b] = values as [number, number];
    switch (expression.op) {
      case 'eq': return Number(a === b); case 'ne': return Number(a !== b);
      case 'lt': return Number(a < b); case 'lte': return Number(a <= b);
      case 'gt': return Number(a > b); case 'gte': return Number(a >= b);
    }
  }
  return tryFoldConstant({ ...expression, args: values.map(value => ({ op: 'const', value })) });
}
function reads(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(reads);
  if (!object(value)) return [];
  return [...(value.op === 'read' && typeof value.path === 'string' ? [value.path] : []), ...Object.values(value).flatMap(reads)];
}
function scalar(expression: GenericFormulaExpr | undefined, ability: AbilityDefinition): number | null {
  if (!expression) return null;
  const bind = (row: GenericFormulaExpr): GenericFormulaExpr => row.op === 'read' && row.path?.startsWith('ability.param.')
    && typeof ability.params?.[row.path.slice(14)] === 'number' ? { op: 'const', value: ability.params[row.path.slice(14)] }
    : { ...row, ...(row.args ? { args: row.args.map(bind) } : {}) };
  return tryFoldConstant(bind(expression));
}

/** New timer damage is authorized by an explicit mounted compiled anchor, not by any anchored tick. */
export function targetTimingDamageOriginMatches(input: CompileRequest, provider: ProviderDefinition, ability: AbilityDefinition,
  origin: OperationOrigin, operation: OperationDefinition): boolean {
  const tick = ability.tickSpec, expiry = ability.targetExpirySpec;
  const key = tick?.phasePolicy === 'preserve_on_extend' ? tick.anchorStateKey : expiry?.anchorStateKey;
  const field = key && provider.initialStateSchema?.[key];
  const mounts = input.combatants.flatMap(actor => actor.providers.filter(mount => mount.definitionRef === provider.providerKey)
    .map(mount => ({ actor, mount })));
  if (!key || !object(field) || !['character', 'build'].includes(provider.kind) || !provider.stableId
    || provider.skillKey !== origin.skillKey || ability.skillKey !== origin.skillKey || mounts.length !== 1
    || mounts[0]!.actor.key !== 'source' || field.valueType !== 'integer' || field.defaultValue !== 0 || field.maxValue !== 1
    || !integer(field.durationMs) || field.durationMs === 0 || field.refreshPolicy !== 'refresh_on_write'
    || ability.cost || ability.cooldown || ability.castCondition || ability.operations?.length || ability.listenerSpec || ability.processControl
    || operation.operation !== 'damage' || operation.target !== 'target' || operation.condition || operation.critEligible !== false
    || operation.vampQualification !== 'RESOLVED' || operation.ref !== origin.operationRef
    || origin.operationRef !== `skills.${origin.skillKey}.effects.${origin.effectKey}.results.${origin.resultKey}`
    || origin.abilityRef !== `source.provider[${mounts[0]!.mount.providerRef}].ability[${ability.abilityKey}]`) return false;
  const actualOrigins = input.rules.skillActionBindings ?? [];
  const hitListeners = provider.abilities?.filter(row => row.listenerSpec?.eventMatcher.all?.includes('event/skill_hit')) ?? [];
  if (!hitListeners.length || hitListeners.some(row => {
    const matcher = row.listenerSpec!.eventMatcher;
    const identity = matcher.all?.filter(type => type.startsWith('ability/skill/')) ?? [];
    if (identity.length !== 1 || matcher.any?.length || !matcher.all?.includes('event/source_owner')) return true;
    const bindings = actualOrigins.filter(binding => binding.source === 'source' && `ability/skill/${binding.skillKey}` === identity[0]);
    return bindings.length !== 1 || !matcher.all?.includes(`ability/target_timing_hit/${bindings[0]!.providerRef}`);
  })) return false;
  if (tick) return !expiry && ability.kind === 'tick' && tick.phasePolicy === 'preserve_on_extend'
    && tick.anchorScope === 'state_scope/provider_target' && tick.startDelayMs === 0 && integer(tick.intervalMs) && tick.intervalMs > 0
    && tick.onTick.length === 1 && tick.onTick[0] === operation;
  return !!expiry && ability.kind === 'stateful' && expiry.anchorScope === 'state_scope/provider_target'
    && expiry.onExpire.includes(operation) && expiry.onExpire.length <= 12
    && expiry.onExpire.filter(row => row.operation === 'damage').length === 1
    && expiry.onExpire.every(row => row === operation || row.operation === 'state_change' && row.target === 'self'
      && row.valuePolicy === 'set' && JSON.stringify(row.types) === '["state_scope/provider_target"]'
      && !!row.ref && object(provider.initialStateSchema?.[row.ref]));
}

/** Join frozen state, actual damage ID and the recovery's real trigger without inventing missing details. */
export function inspectDamageStateBefore(input: CompileRequest, request: RunRequest, done: DoneResult) {
  const issues: string[] = [], identityGaps: string[] = [];
  const check = (valid: unknown, message: string) => { if (!valid) issues.push(`damageStateBefore: ${message}`); };
  const consumers: Array<{ owner: string; providerRef: string; definitionRef: string; ability: AbilityDefinition;
    abilityRef: string; abilityPath: string; states: string[] }> = [];
  for (const actor of input.combatants) for (const mount of actor.providers) {
    const provider = input.sharedProviders?.find(row => row.providerKey === mount.definitionRef);
    for (const ability of provider?.abilities ?? []) {
      const states = [...new Set(reads(ability.listenerSpec?.condition).filter(path => path.startsWith(beforePrefix)).map(path => path.slice(beforePrefix.length)))];
      if (!states.length) continue;
      const matcher = ability.listenerSpec?.eventMatcher;
      check(ability.kind === 'passive_listener' && matcher?.all?.includes('event/damage_instance')
        && matcher.all.includes('event/source_owner') && !matcher.any?.length && !ability.targetExpirySpec && !ability.tickSpec,
      '前值读取必须属于真实自身逐伤监听');
      for (const key of states) {
        const field = provider?.initialStateSchema?.[key];
        check(object(field) && field.valueType === 'integer' && !field.stateKind
          && !provider?.abilities?.some(row => row.tickSpec?.anchorStateKey === key || row.targetExpirySpec?.anchorStateKey === key), '读取状态不是本来源普通整数目标计数');
      }
      consumers.push({ owner: actor.key, providerRef: mount.providerRef, definitionRef: mount.definitionRef, ability,
        abilityRef: `${actor.key}.provider[${mount.providerRef}].ability[${ability.abilityKey}]`,
        abilityPath: `sharedProviders[${input.sharedProviders!.indexOf(provider!)}].abilities[${provider!.abilities!.indexOf(ability)}]`, states });
    }
  }
  const facts = done.evidence.items.map((item, index) => ({ item, index })).filter(({ item }) => item.kind === 'damage_state_before');
  if (!consumers.length) {
    check(facts.length === 0 && !(done.evidence.countsByKind.damage_state_before > 0), '无实际读取者却出现前值证据');
    check(!done.evidence.items.some(item => item.kind === 'resource_restore' && item.data && 'triggerDamageId' in item.data), '旧恢复混入新逐伤因果字段');
    return { issues, identityGaps };
  }
  const unavailable = request.outputMode === 'summary' || done.evidence.truncated;
  if (unavailable || done.recording?.damageRecordsTruncated) identityGaps.push('逐伤前值或伤害明细被省略/截断，只保留真实累计，不能签完整逐笔因果');
  const count = done.evidence.countsByKind.damage_state_before ?? 0;
  check(integer(count) && count >= facts.length && (unavailable || count === facts.length), '前值证据累计与保留前缀不一致');
  const seen = new Set<string>();
  for (const { item } of facts) {
    const data = item.data;
    if (!data) { check(false, '前值证据缺少数据'); continue; }
    check(Object.keys(data).length === 7 && Object.keys(data).every(key => ['damageId', 'owner', 'providerRef', 'definitionRef', 'stateKey', 'target', 'beforeValue'].includes(key))
      && integer(data.damageId) && data.damageId > 0 && integer(data.beforeValue), '前值证据不是严格七字段及实际正整数编号');
    const authorized = consumers.filter(row => row.owner === data.owner && row.providerRef === data.providerRef
      && row.definitionRef === data.definitionRef && row.states.includes(String(data.stateKey)));
    if (authorized.length) {
      const provider = input.sharedProviders?.find(row => row.providerKey === data.definitionRef);
      const field = provider?.initialStateSchema?.[String(data.stateKey)];
      const maximum = object(field) ? typeof field.maxValue === 'number' ? field.maxValue
        : object(field.maxValue) ? scalar(field.maxValue as GenericFormulaExpr, authorized[0]!.ability) : null : null;
      check(maximum !== null && integer(maximum) && Number(data.beforeValue) <= maximum, '冻结前值超过该真实状态的完整静态容量');
    }
    const key = JSON.stringify([data.damageId, data.owner, data.providerRef, data.definitionRef, data.stateKey, data.target]);
    check(authorized.length > 0 && item.ref === data.providerRef && !seen.has(key), '前值来源外来、重复或与真实挂载不符'); seen.add(key);
    const damage = done.damageRecords?.find(row => row.damageId === data.damageId);
    if (damage) check(damage.source === data.owner && damage.target === data.target && damage.timeMs === item.timeMs, '前值与同一编号伤害的双方/时刻不符');
    else if (!done.recording?.damageRecordsTruncated && request.outputMode !== 'summary') check(false, '前值没有实际保留伤害');
    const events = done.evidence.items.filter(row => row.kind === 'emitted_event' && row.ref === 'event/damage_instance' && row.data?.damageId === data.damageId);
    if (events.length) check(events.length === 1 && events[0]!.timeMs === item.timeMs && events[0]!.data?.source === data.owner
      && events[0]!.data?.target === data.target && (!damage || object(events[0]!.data?.damage)
        && events[0]!.data!.damage.killed === (damage.hpBefore > 0 && damage.hpAfter === 0 ? 1 : 0)), '逐伤事件编号、击杀或双方关联不正确');
    else if (!unavailable) check(false, '前值没有同编号真实逐伤事件');
  }
  const declarations = new Map<string, typeof consumers[number]>();
  for (const consumer of consumers) for (const stateKey of consumer.states) {
    const identity = JSON.stringify([consumer.owner, consumer.providerRef, consumer.definitionRef, stateKey]);
    if (!declarations.has(identity)) declarations.set(identity, { ...consumer, states: [stateKey] });
  }
  for (const item of done.evidence.items) if (item.kind === 'resource_restore' && item.data
    && ['triggerDamageId', 'triggerDamageSource', 'triggerDamageTarget'].some(key => key in item.data!)) {
    const data = item.data;
    const owners = consumers.filter(consumer => consumer.abilityRef === data.abilityRef && consumer.owner === data.owner
      && consumer.providerRef === data.providerRef && consumer.definitionRef === data.providerDefinitionRef
      && consumer.ability.listenerSpec?.operations?.some(operation => operation.operation === 'resource_change' && operation.ref === data.operationRef));
    check(owners.length === 1, '带新逐伤因果字段的恢复必须属于唯一真实读取监听及作者操作，不能被筛掉后忽略');
  }
  if (!unavailable && !done.recording?.damageRecordsTruncated) for (const declaration of declarations.values()) {
    for (const damage of done.damageRecords ?? []) if (damage.source === declaration.owner) {
      const packet = done.evidence.items.find(item => item.kind === 'damage' && item.data?.damageId === damage.damageId);
      if (packet?.data?.phantom === true) continue;
      // Only the actual packet acquires a frozen scalar; copied on-hit payloads retain their existing evidence.
      check(facts.some(({ item }) => item.data?.damageId === damage.damageId && item.data?.owner === declaration.owner
        && item.data?.providerRef === declaration.providerRef && item.data?.definitionRef === declaration.definitionRef
        && item.data?.stateKey === declaration.states[0] && item.data?.target === damage.target), '完整伤害缺少其真实声明前值，不得以删掉事实和累计一起绕过');
    }
  }
  for (const consumer of consumers) for (const [operationIndex, operation] of (consumer.ability.listenerSpec?.operations ?? []).entries()) {
    if (operation.operation !== 'resource_change') continue;
    const restores = done.evidence.items.filter(item => item.kind === 'resource_restore' && item.data?.abilityRef === consumer.abilityRef
      && item.data.operationRef === operation.ref);
    const seenDamage = new Set<number>();
    for (const restore of restores) {
      const data = restore.data!;
      const id = data.triggerDamageId;
      check(integer(id) && id > 0 && !seenDamage.has(id), '恢复缺少真实且未重复的触发伤害编号'); if (integer(id)) seenDamage.add(id);
      check(data.owner === consumer.owner && data.providerRef === consumer.providerRef && data.providerDefinitionRef === consumer.definitionRef
        && data.target === consumer.owner && data.triggerDamageSource === consumer.owner && data.source === consumer.owner
        && data.resourceKey === operation.resourceKey, '恢复的实际来源、接收者或触发方向不正确');
      check(data.operationPath === `${consumer.abilityPath}.listenerSpec.operations[${operationIndex}]`
        && Object.prototype.hasOwnProperty.call(data, 'useRef') && (data.useRef === null || typeof data.useRef === 'string' && data.useRef.length > 0),
      '恢复缺少真实编译叶路径或明确原使用');
      const damage = done.damageRecords?.find(row => row.damageId === id);
      const triggerEvent = done.evidence.items.find(item => item.kind === 'emitted_event' && item.ref === 'event/damage_instance' && item.data?.damageId === id);
      if (damage) check(damage.target === data.triggerDamageTarget && damage.timeMs === restore.timeMs && damage.hpBefore > 0 && damage.hpAfter === 0
        && data.useRef === (damage.useRef || null), '回蓝未连接同一实际致死伤害及其原使用');
      else if (!done.recording?.damageRecordsTruncated && request.outputMode !== 'summary') check(false, '回蓝缺少实际致死伤害');
      if (triggerEvent) {
        check(data.useRef === (triggerEvent.data?.useRef ?? null), '恢复原使用与仍保留的同编号逐伤事件矛盾');
        if (!damage && object(triggerEvent.data?.damage)) check(triggerEvent.data.damage.killed === 1, '仍保留的逐伤事件明确不是致死');
      }
      if (damage) {
        const ability = actualAbility(input, damage.abilityRef);
        check(!!ability && eventMatches(input, ability, damage, consumer.ability), '实际根伤能力/操作的事件类型不匹配恢复监听');
      } else if (triggerEvent?.data) {
        const event = triggerEvent.data;
        const ability = actualAbility(input, event.abilityRef);
        const operations = ability && damageOperations(ability).filter(operation => operation.ref === event.operationRef && operation.damageType === event.damageType);
        check(!!ability && !!operations?.length && Array.isArray(event.traits), '保留逐伤事件的实际能力、伤害类型或操作无法连接');
        if (ability && operations?.length && Array.isArray(event.traits)) {
          const traits = event.traits.filter((row): row is string => typeof row === 'string');
          check(operations.some(operation => JSON.stringify([...(operation.types ?? [])].sort()) === JSON.stringify([...traits].sort())), '保留逐伤事件特征与实际编译操作不符');
          check(matcherAccepts(input, ['event/damage_instance', 'event/source_owner', String(event.damageType), ...(ability.types ?? []), ...traits], consumer.ability),
            '保留逐伤事件的实际能力/操作类型明确不匹配恢复监听');
        }
      }
      for (const key of consumer.states) if (!facts.some(({ item }) => !!item.data && item.data.damageId === id && item.data.owner === consumer.owner
        && item.data.providerRef === consumer.providerRef && item.data.stateKey === key && item.data.target === data.triggerDamageTarget)) {
        if (!unavailable) check(false, '恢复未连接本监听声明的真实冻结前值');
      }
      const resolvePredicate = (expression: GenericFormulaExpr): GenericFormulaExpr | null => {
        if (expression.op === 'read') {
          if (expression.path?.startsWith(beforePrefix)) {
            const key = expression.path.slice(beforePrefix.length);
            const fact = facts.find(({ item }) => item.data?.damageId === id && item.data?.owner === consumer.owner
              && item.data?.providerRef === consumer.providerRef && item.data?.stateKey === key && item.data?.target === data.triggerDamageTarget);
            return fact && integer(fact.item.data?.beforeValue) ? { op: 'const', value: fact.item.data.beforeValue } : null;
          }
          if (expression.path === 'event.damage.killed') {
            const event = done.evidence.items.find(item => item.kind === 'emitted_event' && item.ref === 'event/damage_instance' && item.data?.damageId === id);
            const killed = damage ? damage.hpBefore > 0 && damage.hpAfter === 0 ? 1 : 0 : object(event?.data?.damage) ? event.data.damage.killed : undefined;
            return killed === 0 || killed === 1 ? { op: 'const', value: killed } : null;
          }
          if (expression.path?.startsWith('ability.param.')) {
            const value = consumer.ability.params?.[expression.path.slice(14)];
            return typeof value === 'number' ? { op: 'const', value } : null;
          }
          return null;
        }
        const args = expression.args?.map(resolvePredicate);
        if (args?.some(row => row === null)) return null;
        return { ...expression, ...(args ? { args: args as GenericFormulaExpr[] } : {}) };
      };
      const predicate = consumer.ability.listenerSpec?.condition;
      const resolved = predicate ? resolvePredicate(predicate) : { op: 'const', value: 1 };
      const qualification = resolved && foldPredicate(resolved);
      if (qualification !== null) check(qualification === 1, '恢复对应逐伤监听的真实冻结条件不成立');
      else if (unavailable || done.recording?.damageRecordsTruncated) identityGaps.push('恢复对应逐伤条件明细缺失，不能补默认值');
      else check(false, '恢复逐伤条件不能由实际保留事实闭合');
      for (const key of ['requestedAmount', 'currentBefore', 'currentAfter', 'actualDelta', 'overflow']) check(typeof data[key] === 'number' && Number.isFinite(data[key]) && Number(data[key]) >= 0, `恢复${key}不合法`);
      check(close(Number(data.currentAfter) - Number(data.currentBefore), Number(data.actualDelta))
        && close(Number(data.actualDelta) + Number(data.overflow), Number(data.requestedAmount)), '资源前后值及溢出不守恒');
      const expected = scalar(operation.amount, consumer.ability);
      if (expected !== null) check(close(expected, Number(data.requestedAmount)), '恢复金额不等于当前真实能力静态参数');
    }
  }
  const resources = new Set(consumers.flatMap(consumer => (consumer.ability.listenerSpec?.operations ?? [])
    .filter(operation => operation.operation === 'resource_change' && !!operation.resourceKey)
    .map(operation => `${consumer.owner}:${operation.resourceKey}`)));
  for (const identity of resources) {
    const [owner, resourceKey] = identity.split(':') as [string, string];
    const before = request.initialSnapshot.combatants.find(actor => actor.key === owner)?.resources[resourceKey];
    const after = done.finalSnapshot.combatants.find(actor => actor.key === owner)?.resources[resourceKey];
    const validSlot = (slot: typeof before) => !!slot && Number.isFinite(slot.max) && slot.max > 0
      && Number.isFinite(slot.current) && slot.current >= 0 && slot.current <= slot.max;
    check(validSlot(before) && validSlot(after), '回蓝缺少明确初末当前资源和有限正容量');
    if (!before || !after) continue;
    if (unavailable) { identityGaps.push(`${owner}.${resourceKey}恢复事实省略/截断，无法完整闭合资源账`); continue; }
    const restores = done.evidence.items.filter(item => item.kind === 'resource_restore' && item.data?.target === owner && item.data.resourceKey === resourceKey);
    const restored = restores.reduce((sum, item) => sum + Number(item.data!.actualDelta), 0);
    const costs = (done.finalSnapshot.processInstances ?? []).filter(process => process.owner === owner)
      .reduce((sum, process) => sum + (process.actualCosts[resourceKey] ?? 0), 0);
    let uncertain = false;
    const inspectWrites = (value: unknown, ability?: AbilityDefinition): void => {
      if (Array.isArray(value)) { value.forEach(row => inspectWrites(row, ability)); return; }
      if (!object(value)) return;
      if (value.operation === 'resource_change' && value.resourceKey === resourceKey) {
        const amount = ability && object(value.amount) ? scalar(value.amount as GenericFormulaExpr, ability) : null;
        if (amount === null || amount < 0) uncertain = true;
      }
      if (value.kind === 'resource_max' && value.attributeKey === resourceKey || object(value.cost) && value.cost.resourceKey === resourceKey) uncertain = true;
      for (const row of Object.values(value)) inspectWrites(row, ability);
    };
    for (const actor of input.combatants) if (actor.key === owner) for (const mount of actor.providers) {
      const provider = input.sharedProviders?.find(row => row.providerKey === mount.definitionRef);
      for (const ability of provider?.abilities ?? []) inspectWrites(ability, ability);
      inspectWrites(provider?.modifiers);
    }
    if (uncertain || before.max !== after.max) identityGaps.push(`${owner}.${resourceKey}存在其它未闭合资源写入，不能只按回蓝推终值`);
    else {
      check(close(after.current, before.current - costs + restored), '最终当前资源与真实费用和所有已提交恢复不守恒');
      if (costs > 0) identityGaps.push(`${owner}.${resourceKey}实际费用没有逐笔时点，不能独立签逐次恢复前值`);
      else {
        let current = before.current;
        for (const item of restores) {
          const data = item.data!;
          const requested = Number(data.requestedAmount), start = Number(data.currentBefore), end = Number(data.currentAfter);
          const delta = Number(data.actualDelta), overflow = Number(data.overflow);
          check([requested, start, end, delta, overflow].every(value => Number.isFinite(value) && value >= 0)
            && start <= before.max && end <= before.max && close(start, current)
            && close(delta, Math.min(requested, before.max - start)) && close(end, start + delta)
            && close(overflow, requested - delta), '单笔资源恢复未沿真实前值或超容量，夹取/溢出不可能');
          current = end;
        }
        check(close(current, after.current), '逐次资源链与最终当前值不相等');
      }
    }
  }
  return { issues, identityGaps };
}
