import type { AbilityDefinition, CompileRequest, DamageRecord, DoneResult, EvidenceItem, GenericFormulaExpr, OperationDefinition, ProviderDefinition, RunRequest } from '../types/genericEngine';
import type { OperationOrigin } from './simulationAdapter';

type Owner = 'source' | 'target';
type Located = { owner: Owner; providerRef: string; provider: ProviderDefinition; ability: AbilityDefinition; operation: OperationDefinition };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const close = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const empty = (value: unknown) => value === undefined || value === null;
const keys = (value: object, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));

/** 必须同时来自真实编译挂载、原始初态挂载和唯一作者操作；不按能力名推测定义。 */
function locate(input: CompileRequest, request: RunRequest, row: DamageRecord, origins: readonly OperationOrigin[]): Located | undefined {
  const transport = row as DamageRecord & { providerRef?: unknown; phantom?: unknown; phase?: unknown; traits?: unknown };
  if (row.owner !== 'source' && row.owner !== 'target' || row.source !== row.owner
    || row.target !== (row.owner === 'source' ? 'target' : 'source') || !positive(row.castInstanceId)
    || row.useRef !== '' || !empty(row.instructionKey) || !empty(row.hitRef)
    || transport.phantom !== false || transport.phase !== 'original') return undefined;
  const owner = row.owner;
  const mixed = !!request.driverPlan.skillActions?.length || !!request.driverPlan.automaticSkills;
  if (row.attackIndex !== (mixed ? null : 0)) return undefined;
  const match = /^(source|target)\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$/.exec(row.abilityRef);
  const path = /^sharedProviders\[(\d+)\]\.abilities\[(\d+)\]\.(tickSpec\.onTick|listenerSpec\.operations)\[(\d+)\]$/.exec(row.operationPath);
  if (!match || match[1] !== owner || match[2] !== transport.providerRef || !path) return undefined;
  const actors = input.combatants.filter(actor => actor.key === owner);
  const mounts = actors[0]?.providers.filter(mount => mount.providerRef === match[2]) ?? [];
  const provider = input.sharedProviders?.[Number(path[1])], ability = provider?.abilities?.[Number(path[2])];
  if (actors.length !== 1 || mounts.length !== 1 || !provider || !ability || !provider.skillKey || !provider.stableId
    || mounts[0]!.definitionRef !== provider.providerKey || ability.abilityKey !== match[3] || ability.skillKey !== provider.skillKey
    || provider.lifecycle || !['character', 'build'].includes(provider.kind)
    || input.sharedProviders?.filter(p => p.providerKey === provider.providerKey).length !== 1
    || input.combatants.flatMap(actor => actor.providers.filter(m => m.definitionRef === provider.providerKey)).length !== 1
    || row.providerDefinitionRef !== undefined && row.providerDefinitionRef !== provider.providerKey) return undefined;
  const initial = request.initialSnapshot.combatants.filter(actor => actor.key === owner);
  const actual = initial[0]?.providers.filter(mount => mount.providerRef === match[2]) ?? [];
  if (request.initialSnapshot.timeMs !== 0 || initial.length !== 1 || actual.length !== 1
    || actual[0]!.definitionRef !== provider.providerKey || actual[0]!.owner !== owner || actual[0]!.source !== owner
    || actual[0]!.stacks !== 1 || actual[0]!.expireAt !== null || Object.keys(actual[0]!.state).length
    || request.initialSnapshot.combatants.flatMap(actor => actor.providers.filter(m => m.definitionRef === provider.providerKey)).length !== 1) return undefined;
  const operation = (path[3] === 'tickSpec.onTick' ? ability.tickSpec?.onTick : ability.listenerSpec?.operations)?.[Number(path[4])];
  const author = origins.filter(origin => origin.abilityRef === row.abilityRef && origin.operationRef === row.operationRef
    && origin.skillKey === provider.skillKey && origin.operationRef === `skills.${origin.skillKey}.effects.${origin.effectKey}.results.${origin.resultKey}`
    && (origin.providerDefinitionRef === undefined || origin.providerDefinitionRef === provider.providerKey)
    && origin.compiledPaths.includes(row.operationPath));
  if (!operation || operation.operation !== 'damage' || operation.ref !== row.operationRef || operation.damageType !== row.damageType
    || operation.target !== 'target' || operation.condition || operation.repeatCount !== undefined || operation.repeatDelayMs !== undefined
    || operation.repeatScope || operation.critEligible !== false || operation.vampQualification !== 'RESOLVED'
    || operation.vampOverrides?.length || !operation.amount || author.length !== 1
    || !keys(operation, ['operation', 'target', 'ref', 'damageType', 'amount', 'critEligible', 'types', 'vampQualification', 'vampOverrides'])
    || JSON.stringify([...(operation.types ?? [])].sort()) !== JSON.stringify(['damage_trait/delivery_skill', 'damage_trait/origin_direct'].sort())
    || !Array.isArray(transport.traits) || JSON.stringify([...transport.traits].sort()) !== JSON.stringify([...(operation.types ?? [])].sort())
    || !positive(row.damageId)) return undefined;
  return { owner, providerRef: match[2]!, provider, ability, operation };
}

function purePeriod(found: Located, row: DamageRecord): boolean {
  const { provider, ability } = found, tick = ability.tickSpec;
  if (provider.kind !== 'character' || provider.abilities?.length !== 1 || provider.abilities[0] !== ability
    || provider.processes?.length || provider.listeners?.length || provider.modifiers?.length || provider.statusContributions?.length
    || Object.keys(provider.initialStateSchema ?? {}).length || provider.linkedShieldDefinitionRef
    || ability.kind !== 'tick' || ability.operations?.length || ability.listenerSpec || ability.processControl || ability.targetExpirySpec
    || ability.cost || ability.cooldown || ability.castCondition || !tick || !positive(tick.intervalMs)
    || tick.startDelayMs !== tick.intervalMs || !keys(tick, ['intervalMs', 'startDelayMs', 'onTick'])
    || tick.onTick.length !== 1 || tick.onTick[0] !== found.operation
    || !Number.isSafeInteger(row.timeMs) || row.timeMs < tick.startDelayMs || (row.timeMs - tick.startDelayMs) % tick.intervalMs !== 0
    || row.providerActivatedAtMs !== undefined && row.providerActivatedAtMs !== 0) return false;
  return !('baseRawAmount' in row) || close(row.baseRawAmount!, row.rawAmount);
}

/** 事件没有operationPath字段时，路径由唯一编译能力/操作闭合；不补造运输字段。 */
function committedDamageEvent(item: EvidenceItem, row: DamageRecord): boolean {
  const data = item.data;
  if (item.kind !== 'emitted_event' || item.ref !== 'event/damage_instance' || item.timeMs !== row.timeMs || !data
    || data.eventType !== 'event/damage_instance' || data.source !== row.source || data.target !== row.target
    || data.abilityRef !== row.abilityRef || data.operationRef !== row.operationRef || data.castInstanceId !== row.castInstanceId
    || data.damageType !== row.damageType || data.phantom !== false || (data.useRef ?? '') !== row.useRef
    || !empty(data.instructionKey) || !empty(data.hitRef) || !object(data.damage)
    || typeof data.damage.baseRawAmount !== 'number' || !close(data.damage.baseRawAmount, row.rawAmount)
    || typeof data.damage.mitigatedAmount !== 'number' || !close(data.damage.mitigatedAmount, row.postDefenseDamage)) return false;
  return (!Object.prototype.hasOwnProperty.call(data, 'damageId') || data.damageId === row.damageId)
    && (!Object.prototype.hasOwnProperty.call(data, 'operationPath') || data.operationPath === row.operationPath);
}

/** 没注册逐伤事件的纯周期图不会发DI；仍须用真实伤害提交与本次tick双重核对Ci。 */
function committedBareTick(done: DoneResult, found: Located, row: DamageRecord): boolean {
  const damage = done.evidence.items.filter(item => {
    const data = item.data;
    return item.kind === 'damage' && item.ref === row.abilityRef && item.timeMs === row.timeMs && !!data
      && data.damageId === row.damageId && data.castInstanceId === row.castInstanceId && data.abilityRef === row.abilityRef
      && data.operationRef === row.operationRef && data.providerRef === found.providerRef && data.source === row.source && data.target === row.target
      && data.damageType === row.damageType && data.phantom === false && data.phase === 'original'
      && typeof data.rawAmount === 'number' && close(data.rawAmount, row.rawAmount)
      && typeof data.postDefenseDamage === 'number' && close(data.postDefenseDamage, row.postDefenseDamage)
      && (!Object.prototype.hasOwnProperty.call(data, 'operationPath') || data.operationPath === row.operationPath);
  });
  const ticks = done.evidence.items.filter(item => item.kind === 'provider_tick' && item.timeMs === row.timeMs
    && item.ref === found.providerRef && item.data?.providerRef === found.providerRef
    && item.data.combatantKey === found.owner && item.data.definitionRef === found.provider.providerKey);
  return damage.length === 1 && ticks.length === 1;
}

/** 只接现行有界原额乘除树；唯一事件读取不能作除数，也不能藏在偏移/其它动态读取里。 */
function rawCoefficient(expression: GenericFormulaExpr, ability: AbilityDefinition): number | undefined {
  let reads = 0, nodes = 0;
  const visit = (node: GenericFormulaExpr, depth = 0): { value: number; raw: boolean } | undefined => {
    if (++nodes > 256 || depth > 32) return undefined;
    if (node.op === 'read') {
      if (!keys(node, ['op', 'path'])) return undefined;
      if (node.path === 'event.damage.baseRawAmount') { reads++; return { value: 1, raw: true }; }
      const value = node.path?.startsWith('ability.param.') ? ability.params?.[node.path.slice(14)] : undefined;
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? { value, raw: false } : undefined;
    }
    if (node.op === 'const') return keys(node, ['op', 'value']) && typeof node.value === 'number' && Number.isFinite(node.value) && node.value >= 0
      ? { value: node.value, raw: false } : undefined;
    if (!['mul', 'div'].includes(node.op) || !keys(node, ['op', 'args']) || node.args?.length !== 2) return undefined;
    const left = visit(node.args[0]!, depth + 1), right = visit(node.args[1]!, depth + 1);
    if (!left || !right || left.raw && right.raw || node.op === 'div' && (right.raw || right.value <= 0)) return undefined;
    const value = node.op === 'mul' ? left.value * right.value : left.value / right.value;
    return Number.isFinite(value) && value >= 0 ? { value, raw: left.raw || right.raw } : undefined;
  };
  let expressionBody = expression;
  if (expression.op === 'max' && keys(expression, ['op', 'args']) && expression.args?.length === 2) {
    const zero = expression.args.findIndex(arg => arg.op === 'const' && keys(arg, ['op', 'value']) && arg.value === 0);
    if (zero < 0) return undefined;
    expressionBody = expression.args[1 - zero]!;
  }
  const result = visit(expressionBody);
  return result?.raw && reads === 1 ? result.value : undefined;
}

function rawChild(input: CompileRequest, done: DoneResult, found: Located, parent: DamageRecord, row: DamageRecord,
  parentLocated: Located): boolean {
  const { ability, provider, operation, owner, providerRef } = found, listener = ability.listenerSpec;
  if (ability.kind !== 'passive_listener' || ability.operations?.length || ability.tickSpec || ability.targetExpirySpec || ability.processControl
    || ability.castCondition || ability.cost || ability.cooldown || !listener || listener.listenerKey !== ability.abilityKey
    || listener.maxTriggersPerEvent !== 1 || listener.abilityRef || listener.oncePerUse !== undefined || listener.chainLimitKey !== undefined
    || listener.perCastThrottleMs !== undefined || listener.operations?.length !== 1 || listener.operations[0] !== operation
    || !listener.eventMatcher.all?.includes('event/damage_instance') || !listener.eventMatcher.all.includes('event/source_owner')
    || listener.eventMatcher.any?.length || listener.eventMatcher.none?.length
    || row.owner !== parent.owner || row.source !== parent.source || row.target !== parent.target || row.timeMs !== parent.timeMs
    || row.damageId !== parent.damageId + 1
    || row.castInstanceId !== parent.castInstanceId || row.attackIndex !== parent.attackIndex || row.useRef !== parent.useRef
    || (row.instructionKey ?? null) !== (parent.instructionKey ?? null) || (row.hitRef ?? null) !== (parent.hitRef ?? null)
    || done.evidence.truncated || done.recording?.damageRecordsTruncated !== false) return false;
  const types = new Set(['event/damage_instance', 'event/source_owner', parent.damageType,
    ...(parentLocated.ability.types ?? []), ...(parentLocated.operation.types ?? [])]);
  let changed = true;
  while (changed) { changed = false; for (const relation of input.typeCatalog.relations) if (types.has(relation.child) && !types.has(relation.parent)) { types.add(relation.parent); changed = true; } }
  if (!listener.eventMatcher.all.every(type => types.has(type))) return false;
  const predicate = listener.condition;
  if (predicate?.op !== 'eq' || !keys(predicate, ['op', 'args']) || predicate.args?.length !== 2
    || predicate.args[0]?.op !== 'read' || !keys(predicate.args[0], ['op', 'path'])
    || !predicate.args[0].path?.startsWith('event.provider_target_state_before.')
    || predicate.args[1]?.op !== 'const' || !keys(predicate.args[1], ['op', 'value']) || predicate.args[1].value !== 1) return false;
  const stateKey = predicate.args[0].path.slice('event.provider_target_state_before.'.length), field = provider.initialStateSchema?.[stateKey];
  if (!object(field) || field.valueType !== 'integer' || field.defaultValue !== 0 || field.maxValue !== 1
    || !positive(field.durationMs) || field.refreshPolicy !== 'refresh_on_write' || field.stateKind) return false;
  const facts = done.evidence.items.filter(item => item.kind === 'damage_state_before' && item.timeMs === parent.timeMs
    && item.ref === providerRef && item.data?.damageId === parent.damageId && item.data.owner === owner
    && item.data.providerRef === providerRef && item.data.definitionRef === provider.providerKey
    && item.data.stateKey === stateKey && item.data.target === parent.target);
  if (facts.length !== 1 || facts[0]!.data?.beforeValue !== 1) return false;
  const coefficient = rawCoefficient(operation.amount!, ability);
  return coefficient !== undefined && close(row.rawAmount, parent.rawAmount * coefficient);
}

/** 只为已核永久周期及其紧邻RAW子包开空使用通道；其它reaction继续走原结果约束。 */
export function inspectPermanentPeriodicResult(input: CompileRequest, request: RunRequest, done: DoneResult, origins: readonly OperationOrigin[]) {
  const roots = new Map<DamageRecord, DamageRecord>(), locations = new Map<DamageRecord, Located>();
  const candidates = new Map<DamageRecord, Located>(), required = new Set<DamageRecord>(), slots = new Map<string, number>();
  let missingCommittedEvidence = false;
  const records = done.damageRecords ?? [];
  const listeners = [...(input.rules.listeners ?? []), ...(input.sharedProviders ?? []).flatMap(provider =>
    [...(provider.listeners ?? []), ...(provider.abilities ?? []).flatMap(ability => ability.listenerSpec ? [ability.listenerSpec] : [])])];
  const noDamageInstanceTransport = !input.typeCatalog.types.some(type => type.key === 'event/damage_instance')
    && !listeners.some(listener => [...(listener.eventMatcher.all ?? []), ...(listener.eventMatcher.any ?? []), ...(listener.eventMatcher.none ?? [])].includes('event/damage_instance'));
  const slot = (row: DamageRecord) => JSON.stringify([row.abilityRef, row.operationPath, row.timeMs]);
  for (const row of records) {
    const found = locate(input, request, row, origins);
    if (found && purePeriod(found, row)) {
      const evidence = done.evidence.items.filter(item => committedDamageEvent(item, row));
      if (done.evidence.truncated || (noDamageInstanceTransport ? evidence.length !== 0 || !committedBareTick(done, found, row) : evidence.length !== 1)) {
        missingCommittedEvidence = true; continue;
      }
      candidates.set(row, found); slots.set(slot(row), (slots.get(slot(row)) ?? 0) + 1);
    }
  }
  const readsCause = (value: unknown): boolean => Array.isArray(value) ? value.some(readsCause) : object(value)
    ? value.op === 'read' && typeof value.path === 'string' && (value.path === 'event.damage.baseRawAmount' || value.path.startsWith('event.provider_target_state_before.'))
      || Object.values(value).some(readsCause) : false;
  for (const [index, row] of records.entries()) {
    const found = locate(input, request, row, origins);
    if (!found) continue;
    if (candidates.has(row)) {
      if (slots.get(slot(row)) === 1) { roots.set(row, row); locations.set(row, found); }
      continue;
    }
    const parent = records[index - 1], parentLocated = parent && locations.get(parent);
    if (found.ability.listenerSpec && (readsCause(found.ability.listenerSpec) || parentLocated)) required.add(row);
    if (parent && roots.get(parent) === parent && parentLocated && rawChild(input, done, found, parent, row, parentLocated)) roots.set(row, parent);
  }
  // 同次RAW子包沿父Ci；其它周期、主动、普攻或非伤害施放事件都不能借用这个独立Ci。
  for (const root of new Set(roots.values())) {
    const group = records.filter(row => roots.get(row) === root);
    const reused = records.some(row => row.castInstanceId === root.castInstanceId && !group.includes(row))
      || done.evidence.items.some(item => item.kind === 'emitted_event' && item.data?.castInstanceId === root.castInstanceId
        && !group.some(row => committedDamageEvent(item, row)));
    if (reused) for (const row of group) roots.delete(row);
  }
  const identityGaps: string[] = [];
  if (missingCommittedEvidence) identityGaps.push('永久周期父包缺少完整且唯一的实际伤害事件施放身份，不能补造或互借Ci');
  if (done.recording?.damageRecordsTruncated && (input.sharedProviders ?? []).some(p => p.kind === 'character' && !p.lifecycle
    && p.abilities?.some(a => a.kind === 'tick' && a.tickSpec && a.tickSpec.startDelayMs === a.tickSpec.intervalMs))) {
    identityGaps.push('永久周期伤害明细省略或截断，不能完整证明逐笔原额派生及同次提交身份');
  }
  return { accepts: (row: DamageRecord) => roots.has(row), requiresProof: (row: DamageRecord) => required.has(row), identityGaps,
    sameCommit: (left: DamageRecord, right: DamageRecord) => roots.has(left) && roots.get(left) === roots.get(right) };
}
