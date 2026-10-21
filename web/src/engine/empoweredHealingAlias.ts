import type { CompileRequest, DamageRecord, DoneResult, HealingRecord } from '../types/genericEngine';
import { simulationAbility } from './simulationAdapter';
import { empoweredDamageProcess } from './empoweredAttackContract';

/** 仅把真实伤害监听的恢复尾部接回已核定的配额消费；相同时刻本身不产生关联。 */
export function inspectEmpoweredHealingAliases(compile: CompileRequest, done: DoneResult) {
  const aliases = new Map<HealingRecord, string>(), issues: string[] = [], identityGaps: string[] = [];
  const windows = (done.finalSnapshot.processInstances ?? []).filter(process => process.empoweredAttackWindow);
  if (!windows.length) return { aliases, issues, identityGaps };
  for (const heal of done.healingRecords ?? []) {
    const windowsForUse = windows.filter(process => process.useKey === heal.useRef);
    if (!windowsForUse.length) continue;
    const actual = simulationAbility(compile, heal.abilityRef), listener = actual?.ability.listenerSpec;
    const all = listener?.eventMatcher.all ?? [], receiver = all.includes('event/damage_taken');
    const event = receiver ? 'event/damage_taken' : all.includes('event/damage_instance') ? 'event/damage_instance' : null;
    if (!event) continue; // 既有主动治疗或非伤害事件不借用配额命中。
    const operations = listener?.operations?.filter(operation => operation.operation === 'heal' && operation.ref === heal.operationRef && operation.target === 'self') ?? [];
    const valid = actual && actual.ability.kind === 'passive_listener' && operations.length === 1 && windowsForUse.length === 1
      && heal.source === heal.target && heal.abilityRef.startsWith(`${heal.source}.provider[`)
      && all.includes(receiver ? 'event/target_owner' : 'event/source_owner') && listener?.maxTriggersPerEvent === 1;
    if (!valid) { issues.push('配额治疗缺少实际自身伤害监听及唯一操作来源'); continue; }
    const damages = (done.damageRecords ?? []).filter(damage => damage.useRef === heal.useRef && damage.timeMs === heal.timeMs
      && (receiver ? damage.target : damage.source) === heal.source && empoweredDamageProcess(compile, done, damage));
    const uses = [...new Set(damages.map(damage => damage.empoweredAttack!.useRef))];
    if (uses.length !== 1) {
      if (done.recording?.damageRecordsTruncated) identityGaps.push('配额治疗原伤害已被截断或同刻消费含糊，不能独立关联原普攻尾');
      else issues.push('配额治疗没有唯一真实同使用伤害消费，不能借同毫秒关联其它刀');
      continue;
    }
    const providerIndex = compile.sharedProviders!.indexOf(actual!.provider), abilityIndex = actual!.provider.abilities!.indexOf(actual!.ability);
    const operationIndex = listener!.operations!.indexOf(operations[0]!);
    const path = `sharedProviders[${providerIndex}].abilities[${abilityIndex}].listenerSpec.operations[${operationIndex}]`;
    const matchesEvent = (damage: DamageRecord) => done.evidence.items.some(item => item.kind === 'emitted_event' && item.ref === event
      && item.timeMs === heal.timeMs && item.data?.useRef === heal.useRef && item.data.source === damage.source && item.data.target === damage.target
      && item.data.operationRef === damage.operationRef && (receiver ? item.data.postDefenseDamage === damage.postDefenseDamage
        : item.data.abilityRef === damage.abilityRef && item.data.damageType === damage.damageType && item.data.castInstanceId === damage.castInstanceId));
    const hasEvent = damages.some(matchesEvent);
    const eventCandidate = done.evidence.items.some(item => item.kind === 'emitted_event' && item.ref === event && item.timeMs === heal.timeMs
      && item.data?.useRef === heal.useRef && damages.some(damage => item.data?.operationRef === damage.operationRef
        || !receiver && item.data?.abilityRef === damage.abilityRef));
    const hasHeal = done.evidence.items.some(item => item.kind === 'heal' && item.ref === heal.abilityRef && item.timeMs === heal.timeMs
      && item.data?.abilityRef === heal.abilityRef && item.data.operationRef === heal.operationRef && item.data.operationPath === path
      && item.data.owner === heal.source && item.data.source === heal.source && item.data.target === heal.target
      && item.data.providerRef === actual!.mount.providerRef && item.data.providerDefinitionRef === actual!.provider.providerKey
      && item.data.useRef === heal.useRef && item.data.hpBefore === heal.hpBefore && item.data.hpAfter === heal.hpAfter
      && item.data.actualHealing === heal.actualHealing && item.data.healingBeforeModifiers === heal.rawAmount
      && item.data.healingAfterDone === heal.healingAfterDone && item.data.healingAfterModifiers === heal.healingAfterModifiers && item.data.overheal === heal.overheal);
    const healCandidate = done.evidence.items.some(item => item.kind === 'heal' && item.timeMs === heal.timeMs
      && (item.ref === heal.abilityRef || item.data?.abilityRef === heal.abilityRef)
      && (item.data?.operationRef === heal.operationRef || item.data?.operationPath === path));
    if (!hasEvent || !hasHeal) {
      if (done.evidence.truncated && (hasEvent || !eventCandidate) && (hasHeal || !healCandidate)) identityGaps.push('配额恢复的完整伤害事件或治疗来源证据未保留，原使用与唯一消费仍独立核对');
      else { issues.push('配额治疗缺少同一真实伤害事件、挂载、操作路径或恢复证据'); continue; }
    }
    aliases.set(heal, uses[0]!);
  }
  return { aliases, issues, identityGaps };
}
