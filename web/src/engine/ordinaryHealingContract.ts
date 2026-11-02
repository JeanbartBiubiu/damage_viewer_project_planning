import type { CompileRequest, DoneResult, RunRequest } from '../types/genericEngine';
import { simulationAbility } from './simulationAdapter';
import type { OperationOrigin } from './simulation/model';

export type HealingEvidenceOrder = { healing: Array<number | undefined>; damage: Array<number | undefined>; truncated?: boolean };
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const own = (row: object, key: string) => Object.prototype.hasOwnProperty.call(row, key);
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const events = ['event/damage_instance', 'event/damage_taken', 'event/basic_attack_start', 'event/basic_attack_hit', 'event/basic_attack_received',
  'event/attack_link_applied', 'event/hit_link_applied', 'event/ability_started', 'event/skill_hit', 'event/source_initialized'];
type Contract = { abilityRef: string; operationRef: string; path: string; owner: string; providerRef: string; definitionRef: string; event: string; receiver: boolean };

/** 纯连续中的普通自身治疗沿真实保留记录核定；证据只补来源与顺序，不补丢失治疗记录。 */
export function inspectOrdinaryHealing(compile: CompileRequest, request: RunRequest, done: DoneResult, origins: readonly OperationOrigin[]) {
  const issues: string[] = [], identityGaps: string[] = [], contracts: Contract[] = [];
  const check = (valid: unknown, message: string) => { if (!valid) issues.push(`ordinaryHealing: ${message}`); };
  for (const actor of compile.combatants) for (const mount of actor.providers) {
    const providers = compile.sharedProviders?.filter(provider => provider.providerKey === mount.definitionRef) ?? [];
    if (providers.length !== 1) continue;
    const provider = providers[0]!;
    for (const [abilityIndex, ability] of (provider.abilities ?? []).entries()) {
      const listener = ability.listenerSpec;
      for (const [index, operation] of (listener?.operations ?? []).entries()) {
        if (operation.operation !== 'heal') continue;
        const providerIndex = compile.sharedProviders!.indexOf(provider), abilityRef = `${actor.key}.provider[${mount.providerRef}].ability[${ability.abilityKey}]`;
        const path = `sharedProviders[${providerIndex}].abilities[${abilityIndex}].listenerSpec.operations[${index}]`;
        const matcher = listener!.eventMatcher.all ?? [], coreEvents = matcher.filter(event => events.includes(event));
        const receiver = matcher.includes('event/damage_taken') || matcher.includes('event/basic_attack_received');
        const author = origins.filter(origin => origin.abilityRef === abilityRef && origin.operationRef === operation.ref && origin.compiledPaths.includes(path)
          && (!own(origin, 'providerDefinitionRef') || origin.providerDefinitionRef === provider.providerKey));
        check(['character', 'build', 'item'].includes(provider.kind) && text(provider.stableId) && ability.kind === 'passive_listener'
          && !ability.processControl && !ability.tickSpec && !ability.cost && !ability.cooldown && !ability.castCondition
          && !listener!.abilityRef && listener!.maxTriggersPerEvent === 1 && matcher.includes(receiver ? 'event/target_owner' : 'event/source_owner')
          && coreEvents.length === 1
          && operation.target === 'self' && text(operation.ref) && author.length === 1 && ability.skillKey === author[0]?.skillKey,
        '治疗缺少完整实际挂载、普通自身监听及作者操作授权');
        contracts.push({ abilityRef, operationRef: operation.ref ?? '', path, owner: actor.key, providerRef: mount.providerRef,
          definitionRef: provider.providerKey, event: coreEvents[0] ?? '', receiver });
      }
    }
  }
  const authorized = contracts.length > 0;
  const records = done.healingRecords ?? [];
  const order: HealingEvidenceOrder = { healing: [], damage: [], truncated: done.evidence.truncated };
  for (const side of ['source', 'target'] as const) check(nonnegative(done.summary[`${side}DirectHealing`]), '缺少明确非负的直接治疗累计');
  if (!authorized) {
    check(records.length === 0 && done.summary.sourceDirectHealing === 0 && done.summary.targetDirectHealing === 0
      && done.recording?.healingRecordCount === 0 && done.recording.returnedHealingRecords === 0
      && done.recording.droppedHealingRecords === 0 && done.recording.healingRecordsTruncated === false,
    '没有实际普通治疗程序却出现恢复记录、累计或非零记录统计');
    return { authorized, issues, identityGaps, order };
  }
  check(Array.isArray(done.healingRecords), '缺少真实治疗记录数组');
  const recording = done.recording, summaryOnly = request.outputMode === 'summary';
  const count = recording?.healingRecordCount, returned = recording?.returnedHealingRecords, dropped = recording?.droppedHealingRecords;
  const maximum = request.recordBudget?.maxHealingRecords ?? 2000;
  check(Number.isSafeInteger(count) && count! >= 0 && Number.isSafeInteger(returned) && returned! >= 0 && Number.isSafeInteger(dropped) && dropped! >= 0
    && Number.isSafeInteger(maximum) && maximum >= 0 && returned === records.length
    && returned === (summaryOnly ? 0 : Math.min(count!, maximum)) && dropped === count! - Math.min(count!, maximum)
    && recording?.healingRecordsTruncated === (dropped! > 0), '治疗记录预算、返回、丢失或截断统计不一致');
  for (const side of ['source', 'target'] as const) {
    const total = done.summary[`${side}DirectHealing`];
    check(nonnegative(total), '缺少明确非负的直接治疗累计');
    const retained = records.filter(row => row.target === side).reduce((value, row) => value + row.actualHealing, 0);
    check(nonnegative(total) && (retained < total || close(retained, total)), '保留治疗超过真实累计');
    if (!summaryOnly && recording?.healingRecordsTruncated === false) check(nonnegative(total) && close(retained, total), '完整治疗列表与累计不相等');
  }
  const consumedEvidence = new Set<number>();
  const facts = done.evidence.items;
  records.forEach((row, index) => {
    const actual = simulationAbility(compile, row.abilityRef);
    const matching = contracts.filter(contract => contract.abilityRef === row.abilityRef && contract.operationRef === row.operationRef);
    const contract = matching[0];
    check(matching.length === 1 && !!actual && row.target === contract?.owner && row.abilityRef.startsWith(`${row.target}.provider[`) && row.source === row.target,
      '治疗记录不是同一普通自身恢复能力');
    check(Number.isSafeInteger(row.timeMs) && row.timeMs >= 0 && row.timeMs <= done.summary.durationMs
      && (index === 0 || row.timeMs >= records[index - 1]!.timeMs) && row.instructionKey === null,
    '普通治疗时刻、排序或首次指令身份不合法');
    for (const field of ['rawAmount', 'healingAfterDone', 'healingAfterModifiers', 'actualHealing', 'overheal', 'hpBefore', 'hpAfter'] as const) check(nonnegative(row[field]), `治疗${field}缺失或非法`);
    check(row.hpBefore > 0 && close(row.hpBefore + row.actualHealing, row.hpAfter)
      && close(row.actualHealing + row.overheal, row.healingAfterModifiers), '普通治疗存活、前后生命或溢出不守恒');
    check(row.useRef === null ? contract?.event === 'event/source_initialized' && row.timeMs === 0 : text(row.useRef) && (done.attackRecords?.some(attack => attack.useRef === row.useRef)
      || done.finalSnapshot.processInstances?.some(process => process.useKey === row.useRef)
      || request.skillUses?.some(use => use.useKey === row.useRef)), '治疗没有真实原使用，受伤方不得改写原攻击身份');
    if (contract && row.useRef !== null) {
      const damageEvent = ['event/damage_instance', 'event/damage_taken'].includes(contract.event);
      const startEvent = ['event/basic_attack_start', 'event/attack_link_applied'].includes(contract.event);
      const attackEvent = startEvent || ['event/basic_attack_hit', 'event/basic_attack_received', 'event/hit_link_applied'].includes(contract.event);
      const sameEvent = facts.some(item => item.kind === 'emitted_event' && item.ref === contract.event && item.timeMs === row.timeMs
        && item.data?.useRef === row.useRef && (contract.receiver ? item.data.target : item.data.source) === contract.owner);
      const retainedEvent = damageEvent ? (done.damageRecords ?? []).some(damage => damage.timeMs === row.timeMs && damage.useRef === row.useRef
        && (contract.receiver ? damage.target : damage.source) === contract.owner)
        : attackEvent ? (done.attackRecords ?? []).some(attack => (startEvent ? attack.startAtMs : attack.hitAtMs) === row.timeMs && attack.useRef === row.useRef
          && (contract.receiver ? attack.target : attack.source) === contract.owner)
          : contract.event === 'event/ability_started' && (done.finalSnapshot.processInstances ?? []).some(process => process.useKey === row.useRef
            && process.startedAtMs === row.timeMs && process.owner === contract.owner);
      if (!sameEvent && !retainedEvent) {
        const causalStreamTruncated = damageEvent ? recording?.damageRecordsTruncated : attackEvent ? recording?.attackRecordsTruncated : true;
        if (done.evidence.truncated && causalStreamTruncated) identityGaps.push(`普通治疗${index}的同刻原事件已被截断，不能独立交叉核对其使用关联`);
        else check(false, '治疗原使用不是同刻同方真实结算事件，不能借用另一真实刀或过程');
      }
    }
    const evidenceIndex = facts.findIndex((item, factIndex) => !consumedEvidence.has(factIndex) && item.kind === 'heal' && item.timeMs === row.timeMs
      && item.data?.abilityRef === row.abilityRef && item.data.operationRef === row.operationRef && item.data.useRef === row.useRef
      && item.data.hpBefore === row.hpBefore && item.data.hpAfter === row.hpAfter && item.data.actualHealing === row.actualHealing
      && item.data.healingBeforeModifiers === row.rawAmount && item.data.healingAfterDone === row.healingAfterDone
      && item.data.healingAfterModifiers === row.healingAfterModifiers && item.data.overheal === row.overheal);
    const evidence = evidenceIndex >= 0 ? facts[evidenceIndex] : undefined, data = evidence?.data;
    const unconsumedCandidate = facts.some((item, factIndex) => !consumedEvidence.has(factIndex) && item.kind === 'heal' && item.timeMs === row.timeMs
      && item.data?.abilityRef === row.abilityRef && item.data.operationRef === row.operationRef);
    if (!data && !unconsumedCandidate && done.evidence.truncated) identityGaps.push(`普通治疗${index}的完整来源证据已被截断，不能独立交叉核对挂载路径`);
    else check(!!contract && !!data && evidence?.ref === row.abilityRef && data.owner === contract.owner && data.source === row.source && data.target === row.target
      && data.providerRef === contract.providerRef && data.providerDefinitionRef === contract.definitionRef && data.operationPath === contract.path && own(data, 'useRef'),
    '普通治疗缺少同一真实拥有者、挂载、操作、原使用和金额的完整来源证据');
    if (evidenceIndex >= 0) { consumedEvidence.add(evidenceIndex); order.healing[index] = evidenceIndex; }
  });
  (done.damageRecords ?? []).forEach((row, index) => {
    const candidates = facts.map((item, factIndex) => ({ item, factIndex })).filter(({ item }) => item.kind === 'damage' && item.data?.damageId === row.damageId);
    const candidate = candidates[0];
    check(candidates.length <= 1, '同一伤害身份出现重复顺序证据');
    if (candidate) {
      const { item, factIndex } = candidate, data = item.data!;
      const matching = item.timeMs === row.timeMs && item.ref === row.abilityRef && data.abilityRef === row.abilityRef
        && data.operationRef === row.operationRef && data.source === row.source && data.target === row.target;
      check(matching, '伤害顺序证据不属于同一时刻、能力、操作和双方');
      if (matching && candidates.length === 1) order.damage[index] = factIndex;
    } else if (done.evidence.truncated) identityGaps.push(`普通治疗同期伤害${index}的顺序证据已被截断，不能反推同刻先后`);
  });
  return { authorized, issues, identityGaps, order };
}
