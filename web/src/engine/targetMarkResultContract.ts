import type {
  AbilityDefinition, CompileRequest, DoneResult, OperationDefinition,
  ProviderDefinition, RunRequest, TargetMarkDefinition
} from '../types/genericEngine';
import type { OperationOrigin } from './simulationAdapter';
import { tryFoldConstant } from './numericAdapter';
import { assertTargetMarkOutputShape, compiledTargetMark } from './targetMarkContract';

type Row = Record<string, unknown>;
type Contract = {
  path: string; damagePath: string; operation: OperationDefinition; mark: TargetMarkDefinition;
  abilityRef: string; ability: AbilityDefinition; provider: ProviderDefinition; providerRef: string;
  ownHit: string; duration: number; writerEnabled: boolean; trigger: ReturnType<typeof mountedAbility> & {};
};
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0;
const integer = (value: unknown): value is number => nonnegative(value) && Number.isSafeInteger(value);
const positive = (value: unknown): value is number => integer(value) && value > 0;
const capacity = (value: unknown): value is number => finite(value) && value > 0;
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);
function literal(value: unknown, expected: number) {
  return object(value) && value.op === 'const' && value.value === expected && Object.keys(value).every(key => ['op', 'value'].includes(key));
}
function blockedGuard(value: unknown): boolean {
  if (!object(value)) return false;
  const args = value.args as unknown[] | undefined;
  return value.op === 'eq' && args?.length === 2 && object(args[0]) && args[0].op === 'read'
    && args[0].path === 'event.skill_hit.blocked' && literal(args[1], 0)
    || value.op === 'min' && !!args?.some(blockedGuard);
}
function writerEnabled(value: unknown): boolean | null {
  if (literal(value, 0)) return false;
  if (literal(value, 1)) return true;
  if (!object(value)) return null;
  if (value.op === 'eq' && blockedGuard(value)) return true;
  if (value.op !== 'min' || !Array.isArray(value.args) || value.args.length !== 2) return null;
  const values = value.args.map(writerEnabled);
  return values.includes(null) ? null : values.every(Boolean);
}
function mountedAbility(input: CompileRequest, ref: string) {
  const parsed = /^source\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$/.exec(ref);
  if (!parsed) return undefined;
  const mounts = input.combatants.find(actor => actor.key === 'source')?.providers.filter(mount => mount.providerRef === parsed[1]) ?? [];
  const providers = input.sharedProviders?.filter(provider => provider.providerKey === mounts[0]?.definitionRef) ?? [];
  const abilities = providers[0]?.abilities?.filter(ability => ability.abilityKey === parsed[2]) ?? [];
  if (mounts.length !== 1 || providers.length !== 1 || abilities.length !== 1) return undefined;
  return { mount: mounts[0]!, provider: providers[0]!, ability: abilities[0]! };
}
function initialHit(input: CompileRequest, providerRef: string, skill: string, expected?: string) {
  const bindings = input.rules.skillActionBindings?.filter(binding => binding.source === 'source' && binding.providerRef === providerRef
    && binding.skillKey === skill && binding.controls.length === 1 && binding.controls[0]!.action === 'INITIAL') ?? [];
  const hits = bindings.flatMap(binding => binding.hitBindings.filter(hit => expected === undefined || hit.hitAbilityRef === expected)
    .map(hit => ({ binding, hit })));
  if (bindings.length !== 1 || hits.length !== 1) return undefined;
  const value = hits[0]!, source = mountedAbility(input, value.hit.hitAbilityRef);
  const control = mountedAbility(input, value.binding.controls[0]!.abilityRef);
  return source && control && source.mount.definitionRef === value.binding.providerDefinitionRef
    && control.mount.definitionRef === value.binding.providerDefinitionRef && control.ability.processControl?.action === 'INITIAL'
    && control.ability.processControl.processKey === value.binding.controls[0]!.processKey ? value : undefined;
}
function eventMatches(input: CompileRequest, ability: AbilityDefinition, trigger: AbilityDefinition, kind: string) {
  const matcher = ability.listenerSpec!.eventMatcher;
  const types = new Set([kind, 'event/source_owner', ...(kind === 'event/skill_hit' ? trigger.types ?? [] : [])]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const relation of input.typeCatalog.relations) if (types.has(relation.child) && !types.has(relation.parent)) {
      types.add(relation.parent); changed = true;
    }
  }
  return matcher.all?.includes(kind) && matcher.all.includes('event/source_owner')
    && matcher.all.every(key => types.has(key)) && (!matcher.any?.length || matcher.any.some(key => types.has(key)))
    && !(matcher.none ?? []).some(key => types.has(key));
}
function cleanListener(ability: AbilityDefinition) {
  const listener = ability.listenerSpec;
  return ability.kind === 'passive_listener' && !!listener && listener.maxTriggersPerEvent === 1 && !listener.abilityRef
    && !listener.oncePerUse && !listener.perCastThrottleMs && listener.operations?.length === 1
    && !ability.operations?.length && !ability.cost && !ability.cooldown && !ability.castCondition && !ability.tickSpec && !ability.processControl;
}
function contractAt(input: CompileRequest, path: string): Contract | undefined {
  const match = /^(sharedProviders\[(\d+)\]\.abilities\[(\d+)\]\.listenerSpec\.operations\[0\])\.targetMark\.damage$/.exec(path);
  if (!match) return undefined;
  const provider = input.sharedProviders?.[Number(match[2])], ability = provider?.abilities?.[Number(match[3])];
  const operation = ability?.listenerSpec?.operations?.[0];
  if (!provider || !ability || !operation || !cleanListener(ability)) return undefined;
  let mark: TargetMarkDefinition | null;
  try { mark = compiledTargetMark(operation, match[1]!); } catch { return undefined; }
  if (!mark || provider.kind !== 'character' || !text(provider.stableId) || !text(provider.skillKey)
    || provider.lifecycle || ability.skillKey !== provider.skillKey) return undefined;
  const mounts = input.combatants.flatMap(actor => actor.providers.filter(mount => mount.definitionRef === provider.providerKey).map(mount => ({ actor, mount })));
  if (mounts.length !== 1 || mounts[0]!.actor.key !== 'source') return undefined;
  const mount = mounts[0]!.mount, abilityRef = `source.provider[${mount.providerRef}].ability[${ability.abilityKey}]`;
  if (mountedAbility(input, abilityRef)?.ability !== ability) return undefined;
  const field = provider.initialStateSchema?.[mark.stateKey];
  const scalar = (value: unknown) => typeof value === 'number' ? value : object(value) ? tryFoldConstant(value as { op: string }) : null;
  if (!object(field) || field.valueType !== 'integer' || scalar(field.defaultValue) !== 0 || scalar(field.maxValue) !== 1
    || !positive(scalar(field.durationMs)) || field.refreshPolicy !== 'refresh_on_write' || field.stateKind || field.ammoRecovery || field.onExpire?.length
    || provider.abilities?.some(candidate => candidate.tickSpec?.anchorStateKey === mark!.stateKey
      && candidate.tickSpec.anchorScope === 'state_scope/provider_target')) return undefined;
  const ownBinding = initialHit(input, mount.providerRef, provider.skillKey);
  const trigger = mountedAbility(input, mark.triggerAbilityRef), root = trigger?.ability.operations;
  if (!ownBinding || !trigger || trigger.ability.kind !== 'active' || root?.length !== 1 || root[0]!.operation !== 'resolve_skill_hit'
    || root[0]!.skillHit?.skillKey !== trigger.ability.skillKey || !eventMatches(input, ability, trigger.ability, mark.triggerKind)) return undefined;
  const basic = trigger.ability.types?.includes('ability/basic_attack');
  if (mark.triggerKind === 'event/basic_attack_hit' ? !basic : basic || trigger.ability.skillKey === provider.skillKey
    || !initialHit(input, trigger.mount.providerRef, trigger.ability.skillKey ?? '', mark.triggerAbilityRef)) return undefined;
  const ownAbility = mountedAbility(input, ownBinding.hit.hitAbilityRef)?.ability;
  if (!ownAbility || ownAbility.kind !== 'active' || ownAbility.skillKey !== provider.skillKey
    || ownAbility.operations?.length !== 1 || ownAbility.operations[0]!.operation !== 'resolve_skill_hit') return undefined;
  const ownCandidates = ownAbility.operations[0]!.skillHit?.candidates;
  if (ownCandidates?.length !== 1 || ownCandidates[0]!.spellShieldBlockScope !== 'SKILL'
    || ownCandidates[0]!.semantic.resultType !== 'DAMAGE' || ownCandidates[0]!.semantic.target !== 'TARGET'
    || ownCandidates[0]!.operations.length !== 1 || ownCandidates[0]!.operations[0]!.operation !== 'damage'
    || !ownCandidates[0]!.operations[0]!.amount || tryFoldConstant(ownCandidates[0]!.operations[0]!.amount!) !== 0) return undefined;
  const writers = (provider.abilities ?? []).flatMap(candidate => (candidate.listenerSpec?.operations ?? [])
    .filter(op => op.ref === mark!.stateKey && ['state_change', 'state_duration_change'].includes(op.operation)).map(op => ({ candidate, op })));
  if (writers.length !== 1 || !cleanListener(writers[0]!.candidate)
    || !eventMatches(input, writers[0]!.candidate, ownAbility, 'event/skill_hit') || !blockedGuard(writers[0]!.candidate.listenerSpec!.condition)
    || writers[0]!.op.operation !== 'state_change' || writers[0]!.op.target !== 'self' || writers[0]!.op.valuePolicy !== 'set'
    || !writers[0]!.op.amount || tryFoldConstant(writers[0]!.op.amount) !== 1
    || writers[0]!.op.types?.length !== 1 || writers[0]!.op.types[0] !== 'state_scope/provider_target'
    || writerEnabled(writers[0]!.candidate.listenerSpec!.condition) === null) return undefined;
  return { path: match[1]!, damagePath: path, operation, mark, abilityRef, ability, provider, providerRef: mount.providerRef,
    ownHit: ownBinding.hit.hitAbilityRef, duration: scalar(field.durationMs)!, writerEnabled: writerEnabled(writers[0]!.candidate.listenerSpec!.condition)!, trigger };
}

/** 仅授权同一真实父来源、单操作监听内的嵌套伤害叶，不开放任意恢复或伤害路径。 */
export function targetMarkDamageOriginMatches(input: CompileRequest, origin: OperationOrigin, path: string): boolean {
  const contract = contractAt(input, path);
  return !!contract && origin.compiledPaths.includes(path) && origin.abilityRef === contract.abilityRef
    && origin.operationRef === contract.mark.damage.ref && origin.skillKey === contract.provider.skillKey
    && (origin.providerDefinitionRef === undefined || origin.providerDefinitionRef === contract.provider.providerKey);
}

/** 消费统计、原接触、独立附伤及非生命恢复的窄核验；普通生命账仍由原有入口核验。 */
export function inspectTargetMarkResult(input: CompileRequest, request: RunRequest, done: DoneResult, origins: readonly OperationOrigin[]) {
  const issues: string[] = [], gaps = new Set<string>(), contracts: Contract[] = [];
  const check = (valid: unknown, message: string) => { if (!valid) issues.push(`targetMark: ${message}`); };
  const missing = (message: string, streamOmitted: boolean, retainedLater = false) => {
    if (streamOmitted && !retainedLater) gaps.add(`targetMark: ${message}；明细未完整保留，无法独立核定身份`);
    else check(false, message);
  };
  let found = 0;
  function visit(value: unknown, path: string) {
    if (Array.isArray(value)) { value.forEach((row, index) => visit(row, `${path}[${index}]`)); return; }
    if (!object(value)) return;
    if (value.operation === 'consume_target_mark') {
      found++;
      const contract = contractAt(input, `${path}.targetMark.damage`);
      check(!!contract, '消费操作缺少真实角色挂载、有限0/1字段、单操作监听或实际首次命中来源');
      if (contract) {
        const authors = origins.filter(origin => targetMarkDamageOriginMatches(input, origin, contract.damagePath));
        check(authors.length === 1, '嵌套伤害缺少唯一同一W作者与编译路径');
        if (contract.mark.restore) check(origins.filter(origin => origin.abilityRef === contract.abilityRef
          && origin.operationRef === contract.mark.restore!.ref && origin.skillKey === contract.provider.skillKey
          && (origin.providerDefinitionRef === undefined || origin.providerDefinitionRef === contract.provider.providerKey)
          && origin.compiledPaths.includes(`${contract.path}.targetMark.restore`)).length === 1, '嵌套恢复缺少唯一同一W作者与编译路径');
        contracts.push(contract);
      }
      return;
    }
    for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key}` : key);
  }
  visit(input, '');
  const evidence = done.evidence.items, consumed = evidence.filter(item => item.kind === 'target_mark_consumed');
  if (!found) {
    check(!own(done, 'targetMarkSummary') && consumed.length === 0 && !done.evidence.countsByKind.target_mark_consumed,
      '没有消费功能的旧场景不得新增消费统计或事实');
    return { issues, identityGaps: [] as string[] };
  }
  check(own(done, 'targetMarkSummary'), '功能会话必须明确返回消费统计，不得缺省补0');
  try { assertTargetMarkOutputShape(done); } catch (error) { check(false, String(error)); }
  const summary = done.targetMarkSummary;
  if (!summary || !contracts.length) return { issues, identityGaps: [...gaps] };
  const evidenceCount = done.evidence.countsByKind.target_mark_consumed;
  check(evidenceCount === undefined ? summary.consumedCount === 0 : integer(evidenceCount) && evidenceCount === summary.consumedCount,
    '全局消费事实计数与提交统计不一致');
  check(consumed.length <= summary.consumedCount, '保留消费事件超过提交统计');
  if (!done.evidence.truncated && request.outputMode !== 'summary') check(consumed.length === summary.consumedCount, '完整消费事件数与提交统计不一致');
  else if (consumed.length !== summary.consumedCount) gaps.add('targetMark: 消费事实已截断，不能独立核定全部原使用与阻挡身份');
  const rowsOmitted = request.outputMode === 'summary' || !!done.recording?.damageRecordsTruncated;
  const attacksOmitted = request.outputMode === 'summary' || !!done.recording?.attackRecordsTruncated;
  const usesOmitted = request.outputMode === 'summary' || !!done.recording?.skillUseRecordsTruncated;
  const events = evidence.map((item, index) => ({ item, index }));
  const damages = done.damageRecords ?? [], processes = done.finalSnapshot.processInstances ?? [];
  const keys = new Map<string, { target: string; deadline: number } | null>();
  const key = (contract: Contract) => `${contract.providerRef}/${contract.mark.stateKey}`;
  for (const contract of contracts) {
    keys.set(key(contract), null);
    check(request.initialSnapshot.timeMs === 0, '消费会话必须从真实零时刻开始');
    const actor = request.initialSnapshot.combatants.find(row => row.key === 'source');
    const mounts = actor?.providers.filter(mount => mount.providerRef === contract.providerRef && mount.definitionRef === contract.provider.providerKey
      && mount.owner === 'source' && mount.source === 'source' && mount.stacks === 1 && mount.expireAt === null) ?? [];
    const initial = actor?.providerState[contract.providerRef];
    const state = object(initial) && object(initial.targetState) ? initial.targetState : undefined;
    check(mounts.length === 1 && (!state || object(state.values) && (state.values[contract.mark.stateKey] === undefined || state.values[contract.mark.stateKey] === 0)
      && object(state.expireAt) && state.expireAt[contract.mark.stateKey] === undefined), '原W须真实永久挂载，初始不能夹带外部活动标记');
    const planned = (providerRef: string, skill: string) => {
      const binding = initialHit(input, providerRef, skill)?.binding;
      return !!binding && ((request.driverPlan.skillActions ?? []).some(action => action.action === 'INITIAL' && action.source === 'source'
        && action.skillKey === skill && action.bindingKey === binding.bindingKey && action.abilityRef === binding.controls[0]!.abilityRef)
        || request.driverPlan.automaticSkills?.rules.some(rule => rule.bindingKey === binding.bindingKey));
    };
    check(planned(contract.providerRef, contract.provider.skillKey!), '原W没有真实首次主动计划');
    if (contract.mark.triggerKind === 'event/basic_attack_hit') check(request.driverPlan.basicAttack?.hitAbilityRef === contract.mark.triggerAbilityRef
      && request.driverPlan.basicAttack.skillKey === contract.trigger.ability.skillKey, '普攻消费未绑定实际选定的普攻命中');
    else check(planned(contract.trigger.mount.providerRef, contract.trigger.ability.skillKey!), '技能消费未绑定真实驱动的兄弟技能');
  }
  const damageClaims = new Set<number>(), restoreClaims = new Set<number>(), shieldClaims = new Set<number>(), seen = new Set<string>();
  let attackCount = 0, skillCount = 0, blockedCount = 0;
  let sourceHp: number | undefined = request.initialSnapshot.combatants.find(actor => actor.key === 'source')?.attributes.hp?.current;
  const ownHits = new Map<string, Contract>();
  for (const contract of contracts) ownHits.set(`${contract.ownHit}/${key(contract)}`, contract);
  const applications = new Map<number, Array<{ contract: Contract; target: string; deadline: number }>>();
  for (const [index, item] of evidence.entries()) {
    const data = item.data;
    if (item.kind === 'damage' && positive(data?.damageId)) {
      const row = damages.find(damage => damage.damageId === data.damageId);
      if (!row && (data.source === 'source' || data.target === 'source')) sourceHp = undefined;
      if (row?.target === 'source') sourceHp = row.hpAfter;
      if (row?.source === 'source' && row.sourceHpAfter !== null) sourceHp = row.sourceHpAfter;
    } else if (item.kind === 'heal' && data?.target === 'source' && finite(data.hpAfter)) sourceHp = data.hpAfter;
    for (const application of applications.get(index) ?? []) keys.set(key(application.contract), { target: application.target, deadline: application.deadline });
    if (item.kind === 'skill_hit') for (const contract of ownHits.values()) if (item.ref === contract.ownHit && data?.source === 'source') {
      check(integer(item.timeMs) && data.target === 'target' && text(data.useRef) && data.skillKey === contract.provider.skillKey
        && positive(data.occurrenceId) && (data.blocked === 0 || data.blocked === 1), '挂标缺少本W真实命中身份');
      if (data.blocked === 0 && contract.writerEnabled) {
        const original = processes.filter(process => process.useKey === data.useRef && process.owner === 'source' && process.target === data.target
          && process.providerRef === contract.providerRef && process.skillKey === contract.provider.skillKey && process.startedAtMs <= item.timeMs
          && process.processKey === initialHit(input, contract.providerRef, contract.provider.skillKey!)?.binding.controls[0]!.processKey
          && (process.finishedAtMs === null || process.finishedAtMs >= item.timeMs));
        check(original.length === 1, '挂标未关联真实W原使用过程');
        const roots = damages.filter(row => row.abilityRef === contract.ownHit && row.useRef === data.useRef && row.timeMs === item.timeMs
          && row.source === 'source' && row.target === data.target && row.rawAmount === 0);
        const facts = events.filter(entry => entry.index > index && entry.item.kind === 'damage' && entry.item.timeMs === item.timeMs
          && entry.item.data?.abilityRef === contract.ownHit && entry.item.data.source === 'source' && entry.item.data.target === data.target
          && entry.item.data.rawAmount === 0);
        if (!roots.length) missing('挂标缺少本W真实零应用根伤害', rowsOmitted, facts[0] && damages.some(row =>
          events.some(entry => entry.index > facts[0]!.index && entry.item.kind === 'damage' && entry.item.data?.damageId === row.damageId)));
        else check(roots.length === 1 && facts.length === 1 && facts[0]!.item.data?.damageId === roots[0]!.damageId,
          'W零应用根与真实挂标接触不一致');
        if (facts[0]) {
          const applicationsAt = applications.get(facts[0].index) ?? [];
          applicationsAt.push({ contract, target: String(data.target), deadline: item.timeMs + contract.duration });
          applications.set(facts[0].index, applicationsAt);
        } else missing('W挂标缺少真实零应用根的提交顺序事实', done.evidence.truncated);
      }
    }
    if (item.kind !== 'target_mark_consumed') continue;
    const matches = contracts.filter(contract => contract.path === item.path && contract.operation.ref === item.ref), contract = matches[0];
    check(matches.length === 1 && !!data, '消费事实未指向唯一真实编译监听操作');
    if (!contract || !data) continue;
    const required = ['owner', 'providerRef', 'definitionRef', 'stateKey', 'target', 'triggerKind', 'triggerAbilityRef', 'useRef', 'useSource', 'useSkillKey',
      'castInstanceId', 'stateBefore', 'stateAfter', 'deadlineBefore', 'damageBlocked', 'damageId'];
    check(required.every(field => own(data, field)) && Object.keys(data).every(field => required.includes(field)), '消费事实字段缺失或含未支持字段');
    const identity = `${contract.path}/${String(data.useRef)}/${item.timeMs}/${String(data.target)}`;
    check(!seen.has(identity), '同一标记消费被重复提交'); seen.add(identity);
    check(integer(item.timeMs) && item.timeMs <= done.summary.durationMs && data.owner === 'source' && data.providerRef === contract.providerRef
      && data.definitionRef === contract.provider.providerKey && data.stateKey === contract.mark.stateKey && data.target === 'target'
      && data.triggerKind === contract.mark.triggerKind && data.triggerAbilityRef === contract.mark.triggerAbilityRef
      && text(data.useRef) && data.useSource === 'source' && data.useSkillKey === contract.trigger.ability.skillKey
      && integer(data.castInstanceId) && data.stateBefore === 1 && data.stateAfter === 0 && positive(data.deadlineBefore)
      && data.deadlineBefore > item.timeMs && typeof data.damageBlocked === 'boolean', '消费的拥有者、原使用、状态1→0或有效期限不一致');
    const active = keys.get(key(contract));
    check(!!active && active.target === data.target && active.deadline === data.deadlineBefore && active.deadline > item.timeMs,
      '消费没有同一目标尚未到期的真实W挂标，或旧截止被改写');
    keys.set(key(contract), null);
    if (contract.mark.triggerKind === 'event/basic_attack_hit') attackCount++; else skillCount++;
    if (data.damageBlocked === true) blockedCount++;
    const contacts = events.filter(entry => entry.index < index && entry.item.kind === 'skill_hit' && entry.item.ref === contract.mark.triggerAbilityRef
      && entry.item.timeMs === item.timeMs && entry.item.data?.useRef === data.useRef && entry.item.data?.source === data.useSource
      && entry.item.data?.target === data.target && entry.item.data?.skillKey === data.useSkillKey);
    check(contacts.length === 1 && positive(contacts[0]?.item.data?.occurrenceId), '消费缺少同一原技能/普攻真实接触');
    const contact = contacts[0];
    if (contract.mark.triggerKind === 'event/skill_hit') check(contact?.item.data?.blocked === 0, '技能被法盾挡住时不得消费标记');
    const emitted = events.filter(entry => entry.index < index && entry.item.kind === 'emitted_event' && entry.item.ref === contract.mark.triggerKind
      && entry.item.data?.eventType === contract.mark.triggerKind && entry.item.timeMs === item.timeMs && entry.item.data?.useRef === data.useRef
      && entry.item.data?.source === data.useSource && entry.item.data?.target === data.target && entry.item.data?.skillKey === data.useSkillKey
      && entry.item.data?.occurrenceId === contact?.item.data?.occurrenceId && entry.item.data?.blocked === contact?.item.data?.blocked);
    check(emitted.length === 1, '消费没有同一真实命中所发的原事件');
    const process = processes.filter(row => row.useKey === data.useRef), actual = process[0];
    const control = contract.mark.triggerKind === 'event/basic_attack_hit'
      ? request.driverPlan.basicAttack && mountedAbility(input, request.driverPlan.basicAttack.initialControlAbilityRef)?.ability.processControl
      : initialHit(input, contract.trigger.mount.providerRef, contract.trigger.ability.skillKey!, contract.mark.triggerAbilityRef)?.binding.controls[0];
    check(process.length === 1 && actual?.owner === 'source' && actual.target === data.target && actual.skillKey === data.useSkillKey
      && actual.providerRef === contract.trigger.mount.providerRef && !!control && actual.processKey === control.processKey && actual.startedAtMs <= item.timeMs
      && (actual.finishedAtMs === null || actual.finishedAtMs >= item.timeMs), '消费原使用与完整实际过程不一致');
    const rootRows = damages.filter(row => row.abilityRef === contract.mark.triggerAbilityRef && row.useRef === data.useRef && row.timeMs === item.timeMs);
    if (!rootRows.length) missing('消费缺少原生根命中伤害身份', rowsOmitted, damages.some(row => row.abilityRef === contract.abilityRef
      && row.useRef === data.useRef && row.timeMs === item.timeMs));
    else check(rootRows.every(row => row.source === data.useSource && row.target === data.target && row.castInstanceId === data.castInstanceId
      && row.damageId !== data.damageId), '消费改写了原生根命中的施放身份或复用了根伤害id');
    if (contract.mark.triggerKind === 'event/basic_attack_hit') {
      const attacks = done.attackRecords?.filter(row => row.useRef === data.useRef) ?? [];
      if (!attacks.length) missing('消费缺少原普攻明细', attacksOmitted);
      else check(attacks.length === 1 && attacks[0]!.source === data.useSource && attacks[0]!.target === data.target
        && attacks[0]!.skillKey === data.useSkillKey && attacks[0]!.hitAtMs === item.timeMs
        && attacks[0]!.planKey === request.driverPlan.basicAttack?.planKey && positive(attacks[0]!.attackIndex), '消费没有同一普攻的实际命中');
    } else {
      const hits = done.skillUseRecords?.filter(row => row.kind === 'HIT' && row.useRef === data.useRef && row.timeMs === item.timeMs) ?? [];
      if (!hits.length) missing('消费缺少原技能命中明细', usesOmitted);
      else check(hits.length === 1 && hits[0]!.source === data.useSource && hits[0]!.target === data.target
        && hits[0]!.skillKey === data.useSkillKey && hits[0]!.providerRef === contract.trigger.mount.providerRef
        && hits[0]!.processKey === control?.processKey && text(hits[0]!.hitRef), '原技能命中明细改写了使用身份');
    }
    const rows = damages.filter(row => row.abilityRef === contract.abilityRef && row.operationRef === contract.mark.damage.ref
      && row.useRef === data.useRef && row.timeMs === item.timeMs);
    let settlementIndex = contact?.index ?? -1;
    if (data.damageBlocked === true) {
      check(data.damageId === null && rows.length === 0, '独立附伤被阻挡时必须消费但不得制造伤害身份或0伤害行');
      const shields = events.filter(entry => entry.index < index && entry.index > (contact?.index ?? -1) && entry.item.kind === 'emitted_event'
        && entry.item.ref === 'event/spell_shield_blocked' && entry.item.timeMs === item.timeMs && entry.item.data?.source === 'source'
        && entry.item.data.target === data.target && entry.item.data.useRef === data.useRef && entry.item.data.skillKey === contract.provider.skillKey
        && entry.item.data.blocked === 1 && entry.item.data.blockScope === 'DAMAGE_INSTANCE' && entry.item.data.candidateKey === contract.operation.ref
        && entry.item.data.effectOccurrenceKey === contract.operation.ref && entry.item.data.resultKey === contract.mark.damage.ref);
      check(shields.length === 1 && !shieldClaims.has(shields[0]!.index) && text(shields[0]!.item.data?.shieldProviderRef)
        && text(shields[0]!.item.data?.shieldDefinitionRef) && shields[0]!.item.data?.shieldOwner === data.target, '独立阻挡缺少同一W负载的真实法盾事实');
      if (shields[0]) shieldClaims.add(shields[0].index);
      settlementIndex = shields[0]?.index ?? settlementIndex;
    } else {
      check(positive(data.damageId) && !damageClaims.has(data.damageId), '附伤缺少独立且未复用的真实伤害身份');
      if (positive(data.damageId)) damageClaims.add(data.damageId);
      const row = rows.find(damage => damage.damageId === data.damageId);
      if (!row) missing('消费缺少独立W伤害记录', rowsOmitted);
      else {
        check(rows.length === 1 && damages.filter(damage => damage.damageId === data.damageId).length === 1
          && row.owner === 'source' && row.source === 'source' && row.target === data.target
          && (!own(row, 'providerDefinitionRef') || row.providerDefinitionRef === contract.provider.providerKey)
          && row.operationPath === contract.damagePath && row.castInstanceId === data.castInstanceId && row.damageType === contract.mark.damage.damageType
          && nonnegative(row.rawAmount), '附伤必须保留W作者与路径、原使用/目标/施放身份及明确非负金额');
        const amount = contract.mark.damage.amount && tryFoldConstant(contract.mark.damage.amount);
        if (amount !== null && amount !== undefined) check(close(row.rawAmount, amount), '附伤金额与完整静态负载不一致');
      }
      const facts = events.filter(entry => entry.index < index && entry.item.kind === 'damage' && entry.item.data?.damageId === data.damageId);
      if (!facts.length) missing('W伤害缺少同一提交的顺序事实', done.evidence.truncated, true);
      else {
        const fact = facts[0]!;
        check(facts.length === 1 && fact.index > (contact?.index ?? -1) && fact.item.timeMs === item.timeMs
          && fact.item.ref === contract.abilityRef && fact.item.data?.abilityRef === contract.abilityRef && fact.item.data?.operationRef === contract.mark.damage.ref
          && fact.item.data?.source === data.useSource && fact.item.data?.target === data.target
          && fact.item.data?.castInstanceId === data.castInstanceId && nonnegative(fact.item.data?.rawAmount)
          && (!row || fact.item.data?.rawAmount === row.rawAmount), 'W附伤金额或顺序证据与实际记录不同');
        settlementIndex = fact.index;
      }
    }
    const restore = contract.mark.restore;
    const restores = events.filter(entry => entry.index < index && entry.item.kind === 'resource_restore'
      && entry.item.data?.abilityRef === contract.abilityRef && entry.item.data.operationPath === `${contract.path}.targetMark.restore`
      && entry.item.timeMs === item.timeMs && entry.item.data.useRef === data.useRef);
    const alive = finite(sourceHp) ? sourceHp > 0 : undefined;
    if (!restore || alive === false) check(restores.length === 0, '普攻消费或已死亡来源不得触发嵌套资源恢复');
    else {
      if (alive === undefined) {
        gaps.add('targetMark: 来源当时生命事实未保留，不能独立核定恢复存活资格');
        check(restores.length <= 1, '同组恢复事实被重复输出');
      } else check(restores.length === 1, '存活来源的技能消费缺少同组资源恢复事实');
      const fact = restores[0], value = fact?.item.data;
      if (fact && value) {
        check(!restoreClaims.has(fact.index), '同一资源恢复被多个消费重复认领'); restoreClaims.add(fact.index);
        const slot = request.initialSnapshot.combatants.find(actor => actor.key === 'source')?.resources[restore.resourceKey!];
        const amount = restore.amount!.value!;
        check(fact.index > settlementIndex && fact.item.ref === restore.ref && value.source === 'source' && value.target === 'source'
          && value.owner === 'source' && value.providerRef === contract.providerRef && value.providerDefinitionRef === contract.provider.providerKey
          && value.operationRef === restore.ref && value.resourceKey === restore.resourceKey && value.requestedAmount === amount
          && !!slot && capacity(slot.max) && nonnegative(value.currentBefore) && value.currentBefore <= slot.max
          && nonnegative(value.currentAfter) && value.currentAfter <= slot.max && nonnegative(value.actualDelta) && nonnegative(value.overflow)
          && close(value.currentAfter, Math.min(slot.max, value.currentBefore + amount))
          && close(value.actualDelta, value.currentAfter - value.currentBefore) && close(value.overflow, amount - value.actualDelta),
        '嵌套资源恢复的原使用、W挂载、金额、容量夹取或溢出不守恒');
      }
    }
  }
  if (!done.evidence.truncated && consumed.length === summary.consumedCount) check(attackCount === summary.attackCount && skillCount === summary.skillCount && blockedCount === summary.damageBlockedCount,
    '完整消费类型或独立阻挡计数与提交统计不一致');
  else check(attackCount <= summary.attackCount && skillCount <= summary.skillCount && blockedCount <= summary.damageBlockedCount,
    '保留消费类型或独立阻挡计数超过提交统计');
  for (const row of damages) if (contracts.some(contract => row.abilityRef === contract.abilityRef && row.operationRef === contract.mark.damage.ref)) {
    check(origins.some(origin => origin.abilityRef === row.abilityRef && origin.operationRef === row.operationRef
      && targetMarkDamageOriginMatches(input, origin, row.operationPath)),
    'W伤害绕过了唯一嵌套编译路径');
    if (!damageClaims.has(row.damageId)) missing('W附伤没有对应已提交的消费事实', done.evidence.truncated);
  }
  for (const { item, index } of events) if (item.kind === 'resource_restore' && String(item.data?.operationPath).includes('.targetMark.restore')) {
    if (!restoreClaims.has(index)) missing('嵌套资源恢复没有对应已提交的消费事实', done.evidence.truncated);
  }
  const timelineComplete = request.outputMode !== 'summary' && !done.evidence.truncated && consumed.length === summary.consumedCount;
  if (timelineComplete) for (const contract of new Map(contracts.map(value => [key(value), value])).values()) {
    const current = keys.get(key(contract)), active = current && current.deadline > done.finalSnapshot.timeMs ? current : null;
    const bag = done.finalSnapshot.combatants.find(actor => actor.key === 'source')?.providerState[contract.providerRef];
    const state = object(bag) && object(bag.targetState) ? bag.targetState : undefined;
    const values = state && object(state.values) ? state.values : undefined, expires = state && object(state.expireAt) ? state.expireAt : undefined;
    check(active ? state?.target === active.target && values?.[contract.mark.stateKey] === 1 && expires?.[contract.mark.stateKey] === active.deadline
      : (!values || values[contract.mark.stateKey] === undefined || values[contract.mark.stateKey] === 0)
        && (!expires || expires[contract.mark.stateKey] === undefined), '最终目标标记、清零或截止与完整真实消费时间线不符');
  } else gaps.add('targetMark: 完整挂标时间线已截断，不能独立还原最终目标状态');
  const resources = new Set(contracts.flatMap(contract => contract.mark.restore?.resourceKey ? [contract.mark.restore.resourceKey] : []));
  for (const resourceKey of resources) {
    const before = request.initialSnapshot.combatants.find(actor => actor.key === 'source')?.resources[resourceKey];
    const after = done.finalSnapshot.combatants.find(actor => actor.key === 'source')?.resources[resourceKey];
    check(!!before && !!after && nonnegative(before.current) && capacity(before.max) && before.current <= before.max
      && nonnegative(after.current) && capacity(after.max) && after.current <= after.max, '恢复资源缺少明确初末容量与当前值');
    if (!before || !after) continue;
    if (!timelineComplete) { gaps.add(`targetMark: ${resourceKey}恢复事实截断，无法独立闭合最终资源账`); continue; }
    let costs = 0, restored = 0, uncertain = false;
    for (const process of processes.filter(row => row.owner === 'source')) {
      const cost = process.actualCosts[resourceKey];
      if (cost !== undefined) { check(nonnegative(cost), '实际过程费用不是明确非负数'); if (nonnegative(cost)) costs += cost; }
    }
    for (const { item } of events) if (item.kind === 'resource_restore' && item.data?.target === 'source' && item.data.resourceKey === resourceKey) {
      check(nonnegative(item.data.actualDelta), '最终资源账含无效恢复差值'); if (nonnegative(item.data.actualDelta)) restored += item.data.actualDelta;
    }
    const inspect = (value: unknown) => {
      if (Array.isArray(value)) { value.forEach(inspect); return; }
      if (!object(value)) return;
      if (value.operation === 'resource_change' && value.resourceKey === resourceKey && object(value.amount)) {
        const amount = tryFoldConstant(value.amount as { op: string }); if (amount === null || amount < 0) uncertain = true;
      }
      if (object(value.cost) && value.cost.resourceKey === resourceKey || value.kind === 'resource_max' && value.attributeKey === resourceKey) uncertain = true;
      Object.values(value).forEach(inspect);
    };
    inspect(input);
    if (uncertain || before.max !== after.max) gaps.add(`targetMark: ${resourceKey}另有未逐笔运输的资源写入，不能仅由消费事实闭合资源账`);
    else check(close(after.current, before.current - costs + restored), '最终资源账与原实际费用及所有已提交恢复差值不一致');
  }
  return { issues, identityGaps: [...gaps] };
}
