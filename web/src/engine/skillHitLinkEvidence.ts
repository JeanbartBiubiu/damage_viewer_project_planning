import type { AbilityDefinition, CompileRequest, DoneResult, EvidenceItem, OperationDefinition, RunRequest } from '../types/genericEngine';
import type { OperationOrigin } from './simulation/model';
import { tryFoldConstant } from './numericAdapter';

const eventOperations = {
  'event/attack_link_applied': 'apply_attack_link',
  'event/hit_link_applied': 'apply_hit_link'
} as const;
type LinkEvent = keyof typeof eventOperations;
type Contract = { origin: OperationOrigin; path: string; event: LinkEvent; ability: AbilityDefinition };
type Packet = { item: EvidenceItem; index: number; event: LinkEvent; source: string; target: string; use: string; skill: string; count: number; types: Set<string> };
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const time = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const positive = (value: unknown): value is number => time(value) && value > 0;
const linkEvent = (value: unknown): value is LinkEvent => typeof value === 'string' && Object.prototype.hasOwnProperty.call(eventOperations, value);
function at<T>(input: CompileRequest, path: string): T | undefined {
  return path.replace(/\[(\d+)\]/g, '.$1').split('.').reduce<unknown>((value, key) =>
    value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, input) as T | undefined;
}
function mountedAbility(input: CompileRequest, ref: string) {
  const match = /^(source|target)\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$/.exec(ref);
  const mounts = input.combatants.find(actor => actor.key === match?.[1])?.providers.filter(mount => mount.providerRef === match?.[2]) ?? [];
  const definitions = input.sharedProviders?.filter(provider => provider.providerKey === mounts[0]?.definitionRef) ?? [];
  const abilities = definitions[0]?.abilities?.filter(ability => ability.abilityKey === match?.[3]) ?? [];
  if (mounts.length !== 1 || definitions.length !== 1 || abilities.length !== 1) return undefined;
  return { owner: match![1]!, mount: mounts[0]!, definition: definitions[0]!, ability: abilities[0]! };
}
export function skillHitLinkListenerEvent(ability: AbilityDefinition): LinkEvent | undefined {
  const matcher = ability.listenerSpec?.eventMatcher;
  const events = matcher?.all?.filter(linkEvent) ?? [];
  return ability.kind === 'passive_listener' && matcher?.all?.includes('event/source_owner') && events.length === 1 ? events[0] : undefined;
}
function matches(ability: AbilityDefinition, types: ReadonlySet<string>): boolean {
  const matcher = ability.listenerSpec!.eventMatcher;
  return (matcher.all ?? []).every(key => types.has(key)) && (!matcher.any?.length || matcher.any.some(key => types.has(key)))
    && !(matcher.none ?? []).some(key => types.has(key));
}

/** 只补链接附伤的来源证据；不从调试事件重算伤害或补造被截断的明细。 */
export function inspectSkillHitLinkEvidence(input: CompileRequest, request: RunRequest, done: DoneResult, origins: readonly OperationOrigin[]) {
  const issues: string[] = [], gaps = new Set<string>(), contracts: Contract[] = [];
  const check = (valid: unknown, message: string) => { if (!valid) issues.push(`skillHitLinks: ${message}`); };
  const missing = (message: string, retainedLater = false) => {
    if (done.evidence.truncated && !retainedLater) gaps.add(`skillHitLinks: ${message}；证据已截断，无法独立核定链接身份`);
    else check(false, message);
  };
  for (const origin of origins) {
    const actual = mountedAbility(input, origin.abilityRef), event = actual && skillHitLinkListenerEvent(actual.ability);
    if (!actual || !event) continue;
    for (const path of origin.compiledPaths) {
      const operation = at<OperationDefinition>(input, path);
      if (operation?.operation === 'damage' && operation.ref === origin.operationRef) contracts.push({ origin, path, event, ability: actual.ability });
    }
  }
  if (!contracts.length) return { issues, identityGaps: [] as string[] };
  for (const row of done.damageRecords ?? []) if (contracts.some(contract => contract.origin.abilityRef === row.abilityRef && contract.origin.operationRef === row.operationRef)) {
    check(contracts.some(contract => contract.origin.abilityRef === row.abilityRef && contract.origin.operationRef === row.operationRef
      && contract.path === row.operationPath), '链接附伤记录缺少同一真实监听作者与编译伤害路径');
  }
  const evidence = done.evidence.items;
  const useFacts = (packet: Packet) => {
    const processes = done.finalSnapshot.processInstances?.filter(process => process.useKey === packet.use) ?? [];
    const process = processes[0];
    if (processes.length !== 1 || !process || process.owner !== packet.source || process.target !== packet.target || process.skillKey !== packet.skill
      || !time(process.startedAtMs) || packet.item.timeMs < process.startedAtMs || packet.item.timeMs > (process.finishedAtMs ?? done.summary.durationMs)) return false;
    const basic = request.driverPlan.basicAttack;
    if (basic && basic.source === packet.source && basic.target === packet.target && basic.skillKey === packet.skill) {
      const control = mountedAbility(input, basic.initialControlAbilityRef);
      if (control?.mount.providerRef !== process.providerRef || control.ability.processControl?.processKey !== process.processKey) return false;
      const attacks = done.attackRecords?.filter(attack => attack.useRef === packet.use) ?? [];
      if (!attacks.length && (request.outputMode === 'summary' || done.recording?.attackRecordsTruncated)) {
        gaps.add('skillHitLinks: 原普攻明细未完整保留，只能核定完整过程与真实计划，不能独立核定链接时点'); return true;
      }
      return attacks.length === 1 && attacks[0]!.source === packet.source && attacks[0]!.target === packet.target && attacks[0]!.skillKey === packet.skill
        && (attacks[0]!.startAtMs === packet.item.timeMs || attacks[0]!.hitAtMs === packet.item.timeMs);
    }
    const bindings = input.rules.skillActionBindings?.filter(binding => binding.source === packet.source && binding.providerRef === process.providerRef
      && binding.skillKey === packet.skill && binding.controls.some(control => control.action === 'INITIAL' && control.processKey === process.processKey)) ?? [];
    const binding = bindings[0];
    if (bindings.length !== 1 || !binding) return false;
    const initial = binding.controls.find(control => control.action === 'INITIAL')!;
    const control = mountedAbility(input, initial.abilityRef);
    if (control?.mount.definitionRef !== binding.providerDefinitionRef || control.ability.processControl?.action !== 'INITIAL') return false;
    const actions = request.driverPlan.skillActions?.filter(action => action.bindingKey === binding.bindingKey && action.action === 'INITIAL'
      && action.source === packet.source && action.target === packet.target) ?? [];
    const automatic = request.driverPlan.automaticSkills?.rules.filter(rule => rule.bindingKey === binding.bindingKey && rule.target === packet.target) ?? [];
    if (!actions.length && automatic.length !== 1) return false;
    const starts = automatic.length ? done.automaticSkillRecords?.filter(record => record.kind === 'STARTED' && record.useRef === packet.use
      && record.ruleKey === automatic[0]!.ruleKey && record.timeMs === process.startedAtMs)
      : done.skillActionRecords?.filter(record => record.outcome === 'ACCEPTED' && record.useRef === packet.use
        && record.source === packet.source && record.target === packet.target && record.skillKey === packet.skill
        && record.bindingKey === binding.bindingKey && record.providerRef === binding.providerRef
        && record.providerDefinitionRef === binding.providerDefinitionRef && record.actualAtMs === process.startedAtMs
        && actions.some(action => action.instructionKey === record.instructionKey));
    if (!starts?.length && (request.outputMode === 'summary' || (automatic.length ? done.automaticSkillRecording?.truncated : done.recording?.skillActionRecordsTruncated))) {
      gaps.add('skillHitLinks: 原主动使用明细未完整保留，不能独立核定链接的开始关联'); return true;
    }
    return starts?.length === 1;
  };
  const packets: Packet[] = [];
  const byApplication = new Map<number, Packet[]>();
  for (const [index, item] of evidence.entries()) {
    if (item.kind !== 'emitted_event' || !linkEvent(item.ref) && !linkEvent(item.data?.eventType)) continue;
    const data = item.data, event = item.ref;
    if (!linkEvent(event) || data?.eventType !== event || !time(item.timeMs) || !text(item.path) || !data
      || !['source', 'target'].includes(String(data.source)) || !['source', 'target'].includes(String(data.target))
      || !text(data.useRef) || !text(data.skillKey) || !positive(data.LINK_COUNT) || !positive(data.LINK_INDEX) || data.LINK_INDEX > data.LINK_COUNT) {
      check(false, '链接事件的类型、双方、原使用、时刻或LINK_INDEX/COUNT不完整'); continue;
    }
    const packet: Packet = { item, index, event, source: String(data.source), target: String(data.target), use: data.useRef, skill: data.skillKey,
      count: data.LINK_COUNT, types: new Set([event, 'event/source_owner']) };
    const operation = at<OperationDefinition>(input, item.path);
    const authors = origins.filter(origin => origin.compiledPaths.includes(item.path!) && origin.operationRef === operation?.ref);
    const author = authors[0], parent = author && mountedAbility(input, author.abilityRef);
    const providerIndex = input.sharedProviders?.findIndex(provider => provider === parent?.definition) ?? -1;
    const abilityIndex = parent?.definition.abilities?.findIndex(ability => ability === parent.ability) ?? -1;
    const abilityPrefix = `sharedProviders[${providerIndex}].abilities[${abilityIndex}]`;
    const processPath = /^sharedProviders\[(\d+)\]\.processes\[(\d+)\]\.momentOperations\[(\d+)\]\.operations\[\d+\]$/.exec(item.path);
    const process = processPath && parent?.definition.processes?.[Number(processPath[2])];
    const processOwnsPath = processPath && Number(processPath[1]) === providerIndex && process
      && parent?.ability.processControl?.processKey === process.processKey;
    const abilityOwnsPath = item.path.startsWith(`${abilityPrefix}.`) && (item.path.startsWith(`${abilityPrefix}.operations[`) || item.path.startsWith(`${abilityPrefix}.listenerSpec.operations[`));
    check(operation?.operation === eventOperations[event] && operation.target === 'target' && !!operation.amount && authors.length === 1
      && !!parent && parent.owner === packet.source && (author!.providerDefinitionRef === undefined || author!.providerDefinitionRef === parent.mount.definitionRef)
      && (abilityOwnsPath || processOwnsPath), '链接事件的生产路径不是同拥有者真实编译apply_link与作者操作');
    if (!operation || authors.length !== 1 || !parent || (!abilityOwnsPath && !processOwnsPath)) continue;
    for (const type of parent.ability.types ?? []) packet.types.add(type);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const relation of input.typeCatalog.relations) if (packet.types.has(relation.child) && !packet.types.has(relation.parent)) {
        packet.types.add(relation.parent); expanded = true;
      }
    }
    const folded = operation.amount && tryFoldConstant(operation.amount);
    check(folded === null || folded === undefined || folded === packet.count, '链接次数与完整静态编译金额不一致');
    check(useFacts(packet), '链接事件的原技能、目标或真实使用过程不匹配');
    if (abilityOwnsPath && parent.ability.kind === 'active') {
      const basic = request.driverPlan.basicAttack;
      const hit = basic?.hitAbilityRef === author!.abilityRef && basic.skillKey === packet.skill
        || input.rules.skillActionBindings?.some(binding => binding.source === packet.source && binding.providerRef === parent.mount.providerRef
          && binding.skillKey === packet.skill && binding.hitBindings.some(hit => hit.hitAbilityRef === author!.abilityRef));
      check(hit && parent.ability.skillKey === packet.skill, '主动链接生产者必须是原技能实际命中绑定');
      const basicHit = basic?.hitAbilityRef === author!.abilityRef;
      const contacts = basicHit ? done.attackRecords?.filter(attack => attack.useRef === packet.use && attack.hitAtMs === item.timeMs)
        : done.skillUseRecords?.filter(record => record.kind === 'HIT' && record.useRef === packet.use && record.timeMs === item.timeMs
          && record.source === packet.source && record.target === packet.target && record.skillKey === packet.skill);
      if (!contacts?.length && (request.outputMode === 'summary' || (basicHit ? done.recording?.attackRecordsTruncated : done.recording?.skillUseRecordsTruncated))) {
        gaps.add('skillHitLinks: 原命中明细未完整保留，不能独立核定链接的真实接触');
      } else check(contacts?.length === 1, '主动链接生产者缺少同一原使用的真实命中时点');
    }
    if (abilityOwnsPath && parent.ability.kind === 'passive_listener') {
      const spec = parent.ability.listenerSpec, matcher = spec?.eventMatcher;
      const roots = matcher?.all?.filter(key => key.startsWith('event/') && !['event/source_owner', 'event/target_owner'].includes(key)) ?? [];
      check(spec?.maxTriggersPerEvent === 1 && matcher?.all?.includes('event/source_owner') && roots.length === 1, '链接生产监听缺少唯一真实来源事件');
      const trigger = evidence.some((prior, priorIndex) => priorIndex < index && prior.timeMs === item.timeMs
        && prior.kind === 'emitted_event' && prior.ref === roots[0] && prior.data?.source === packet.source && prior.data.target === packet.target
        && prior.data.useRef === packet.use && prior.data.skillKey === packet.skill);
      check(trigger, '链接生产监听缺少更早的同方同目标同原使用事件');
    }
    if (processOwnsPath) {
      const actual = done.finalSnapshot.processInstances?.find(row => row.useKey === packet.use);
      const moment = process!.momentOperations[Number(processPath![3])]!.moment;
      check(actual?.providerRef === parent.mount.providerRef && actual.processKey === process!.processKey
        && actual.skillKey === packet.skill && (moment.momentType === 'PROCESS_START' ? actual.startedAtMs === item.timeMs
          : moment.momentType === 'PROCESS_COMPLETE' ? actual.status === 'complete' && actual.finishedAtMs === item.timeMs : actual.lastExecutionAtMs === item.timeMs),
      '过程链接路径不属于该次真实使用的实际时点');
    }
    let applicationIndex = -1;
    for (let prior = index - 1; prior >= 0; prior--) {
      const candidate = evidence[prior]!;
      if (candidate.kind === 'link_application' && candidate.path === item.path && candidate.timeMs === item.timeMs && candidate.data?.eventType === event
        && candidate.data.source === packet.source && candidate.data.target === packet.target && candidate.data.useRef === packet.use && candidate.data.skillKey === packet.skill) {
        applicationIndex = prior; break;
      }
    }
    const application = evidence[applicationIndex];
    check(!!application && application.ref === operation.ref && application.data?.count === packet.count, '链接事件缺少同路径、原使用和次数的真实施加证据');
    if (applicationIndex < 0) continue;
    const siblings = byApplication.get(applicationIndex) ?? [];
    check(!siblings.some(sibling => sibling.item.data!.LINK_INDEX === data.LINK_INDEX), '同一次链接施加出现重复LINK_INDEX');
    siblings.push(packet); byApplication.set(applicationIndex, siblings); packets.push(packet);
  }
  if (!done.evidence.truncated) for (const group of byApplication.values()) {
    check(group.length === group[0]!.count && group.every((packet, index) => packet.item.data!.LINK_INDEX === index + 1), '完整链接施加的事件次数或序号不连续');
  }
  const consumed = new Map<string, Set<number>>();
  for (const contract of contracts) {
    const rows = done.damageRecords?.filter(row => row.abilityRef === contract.origin.abilityRef && row.operationRef === contract.origin.operationRef && row.operationPath === contract.path) ?? [];
    const total = done.summary.damageBreakdown?.filter(row => row.abilityRef === contract.origin.abilityRef && row.operationRef === contract.origin.operationRef)
      .reduce((sum, row) => sum + row.damageCount, 0) ?? 0;
    if (rows.length < total && (request.outputMode === 'summary' || done.recording?.damageRecordsTruncated)) gaps.add('skillHitLinks: 链接附伤明细未完整保留，不能逐笔证明全部链接与附伤身份');
    for (const row of rows) {
      const damageEvidence = evidence.map((item, index) => ({ item, index })).filter(({ item }) => item.kind === 'damage' && item.data?.damageId === row.damageId);
      const actualDamage = damageEvidence[0];
      if (!actualDamage) missing('链接附伤缺少同一damageId的可靠来源证据');
      else check(damageEvidence.length === 1 && actualDamage.item.timeMs === row.timeMs && actualDamage.item.ref === row.abilityRef
        && actualDamage.item.data?.abilityRef === row.abilityRef && actualDamage.item.data.operationRef === row.operationRef
        && actualDamage.item.data.source === row.source && actualDamage.item.data.target === row.target && actualDamage.item.data.castInstanceId === row.castInstanceId,
      '链接附伤的伤害证据与记录来源、时刻或施放身份不一致');
      const used = consumed.get(contract.path) ?? new Set<number>();
      const eligible = packets.filter(packet => !used.has(packet.index) && packet.event === contract.event && packet.item.timeMs === row.timeMs
        && packet.source === row.source && packet.target === row.target && packet.use === row.useRef
        && matches(contract.ability, packet.types)
        && (!actualDamage || packet.index < actualDamage.index));
      if (!eligible.length) missing('链接附伤缺少同刻、同方同目标、同原使用且在伤害前的真实链接事件', !!actualDamage);
      else { used.add(eligible[0]!.index); consumed.set(contract.path, used); }
    }
  }
  return { issues, identityGaps: [...gaps] };
}
