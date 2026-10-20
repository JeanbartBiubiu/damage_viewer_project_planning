import type { CompileRequest, DoneResult, ProcessActionOccupancy, ProcessInstanceSnapshot, RunRequest } from '../types/genericEngine';
import { tryFoldConstant } from './numericAdapter';
import { simulationAbility } from './simulationAdapter';

/** 仅解释同刻普攻命中之后减冷却唤醒的首步占用，不把后来的行动贡献倒用于本刀。 */
export function inspectBasicAttackCooldownWake(compile: CompileRequest, request: RunRequest, done: DoneResult,
  attack: ProcessInstanceSnapshot, consumer: ProcessInstanceSnapshot | undefined, occupancy: ProcessActionOccupancy) {
  const invalid = { valid: false, identityGap: null };
  const plan = request.driverPlan.basicAttack;
  const at = attack.startedAtMs;
  if (!plan || !consumer || at !== occupancy.startedAtMs || at !== consumer.startedAtMs || occupancy.stepVersion !== 1
    || attack.owner !== plan.source || attack.target !== plan.target || attack.skillKey !== plan.skillKey
    || attack.status !== 'complete' || attack.failureReason !== null || attack.finishedAtMs !== at
    || !attack.cooldownStarted || consumer.owner !== plan.source) return invalid;
  const bindings = compile.rules.skillActionBindings?.filter(binding => binding.source === consumer.owner
    && binding.providerRef === consumer.providerRef && binding.skillKey === consumer.skillKey) ?? [];
  const binding = bindings[0];
  const control = binding?.controls.find(control => control.action === 'INITIAL' && control.processKey === consumer.processKey);
  const ability = control && simulationAbility(compile, control.abilityRef);
  const rules = request.driverPlan.automaticSkills?.rules.filter(rule => rule.bindingKey === binding?.bindingKey) ?? [];
  const rule = rules[0];
  if (bindings.length !== 1 || !binding || !control || !ability || rules.length !== 1 || !rule
    || rule.target !== consumer.target || rule.releaseAfterRuleKey !== null || rule.waitForCooldowns.length !== 0
    || ability.mount.definitionRef !== binding.providerDefinitionRef || ability.ability.processControl?.action !== 'INITIAL'
    || !ability.provider.processes?.some(process => process.processKey === consumer.processKey && process.cooldown !== null)
    || !(done.finalSnapshot.processInstances ?? []).some(previous => previous.owner === consumer.owner
      && previous.providerRef === consumer.providerRef && previous.skillKey === consumer.skillKey && previous.processKey === consumer.processKey
      && previous.startedAtMs < at && previous.status === 'complete' && previous.finishedAtMs !== null && previous.finishedAtMs <= at
      && previous.cooldownStarted)) return invalid;
  const reductions = (ability.provider.abilities ?? []).flatMap(listener => {
    const spec = listener.listenerSpec, matcher = spec?.eventMatcher, operation = spec?.operations?.[0];
    if (listener.kind !== 'passive_listener' || listener.castCondition || !spec || spec.condition || spec.operations?.length !== 1
      || spec.maxTriggersPerEvent !== 1 || matcher?.all?.length !== 2 || !matcher.all.includes('event/basic_attack_hit')
      || !matcher.all.includes('event/source_owner') || matcher.any?.length || matcher.none?.length || !operation
      || operation.operation !== 'cooldown_change' || operation.target !== 'self' || operation.valuePolicy !== 'reduce'
      || operation.abilityRef !== control.abilityRef || operation.condition || !operation.amount) return [];
    const amount = tryFoldConstant(operation.amount);
    return amount !== null && Number.isSafeInteger(amount) && amount > 0 ? [amount] : [];
  });
  if (reductions.length !== 1) return invalid;

  const summaryOnly = request.outputMode === 'summary';
  const attacks = (done.attackRecords ?? []).filter(row => row.useRef === attack.useKey);
  if (attacks.length > 1 || attacks.some(row => row.source !== plan.source || row.target !== plan.target || row.skillKey !== plan.skillKey
    || row.startAtMs !== at || row.hitAtMs !== at || !row.completed)) return invalid;
  const attackMissing = attacks.length === 0;
  if (attackMissing && !summaryOnly && !done.recording?.attackRecordsTruncated) return invalid;

  const records = done.automaticSkillRecords ?? [];
  const starts = records.filter(row => row.kind === 'STARTED' && row.useRef === consumer.useKey);
  if (starts.length > 1 || starts.some(row => row.ruleKey !== rule.ruleKey || row.timeMs !== at)) return invalid;
  let automaticMissing = starts.length === 0;
  if (starts.length) {
    const before = records.filter(row => row.ruleKey === rule.ruleKey && row.sequence < starts[0]!.sequence);
    const cleared = before[before.length - 1];
    const previous = before[before.length - 2];
    if (!cleared || cleared.kind !== 'WAIT_CHANGED' || cleared.timeMs !== at || cleared.reason !== null || cleared.nextCheckAtMs !== null
      || !previous || previous.kind !== 'WAIT_CHANGED' || previous.reason !== 'OWN_COOLDOWN' || previous.timeMs >= at
      || previous.nextCheckAtMs === null || previous.nextCheckAtMs <= at || previous.nextCheckAtMs - reductions[0]! > at) return invalid;
    automaticMissing = false;
  }
  if (automaticMissing && !summaryOnly && !done.automaticSkillRecording?.truncated) return invalid;

  const evidence = done.evidence.items;
  const matching = [
    evidence.flatMap((item, index) => item.timeMs === at && item.kind === 'emitted_event' && item.ref === 'event/basic_attack_start'
      && item.data?.useRef === attack.useKey && item.data.source === plan.source && item.data.target === plan.target && item.data.skillKey === plan.skillKey ? [index] : []),
    evidence.flatMap((item, index) => item.timeMs === at && item.kind === 'emitted_event' && item.ref === 'event/basic_attack_hit'
      && item.data?.useRef === attack.useKey && item.data.source === plan.source && item.data.target === plan.target && item.data.skillKey === plan.skillKey ? [index] : []),
    evidence.flatMap((item, index) => item.timeMs === at && item.kind === 'process_moment' && item.data?.moment === 'PROCESS_START'
      && item.data.useKey === consumer.useKey && item.data.owner === consumer.owner && item.data.providerRef === binding.providerRef
      && item.data.processKey === consumer.processKey && item.data.skillKey === binding.skillKey ? [index] : []),
    evidence.flatMap((item, index) => item.timeMs === at && item.kind === 'emitted_event' && item.ref === 'event/ability_started'
      && item.data?.useRef === consumer.useKey && item.data.owner === consumer.owner && item.data.providerRef === binding.providerRef
      && item.data.providerDefinitionRef === binding.providerDefinitionRef && item.data.skillKey === binding.skillKey
      && item.data.phaseKind === 'INITIAL' ? [index] : []),
    evidence.flatMap((item, index) => item.timeMs === at && item.kind === 'process_moment' && item.data?.moment === 'STEP_START'
      && item.data.useKey === consumer.useKey && item.data.owner === consumer.owner && item.data.providerRef === binding.providerRef
      && item.data.processKey === consumer.processKey && item.data.skillKey === binding.skillKey
      && item.data.stepKey === occupancy.stepKey && item.data.stepVersion === occupancy.stepVersion ? [index] : [])
  ];
  if (matching.some(rows => rows.length > 1)) return invalid;
  let last = -1, missing = false;
  for (const rows of matching) {
    if (!rows.length) { missing = true; continue; }
    // 证据只允许保留前缀；缺少前面的必要事件后不能出现后面的因果节点。
    if (missing || rows[0]! <= last) return invalid;
    last = rows[0]!;
  }
  if (missing && !summaryOnly && !done.evidence.truncated) return invalid;
  return { valid: true, identityGap: attackMissing || automaticMissing || missing
    ? `processInstances.${consumer.useKey}.actionReady: 同刻普攻减冷却唤醒的明细因果未完整保留；只核对完整过程、真实绑定与累计` : null };
}
