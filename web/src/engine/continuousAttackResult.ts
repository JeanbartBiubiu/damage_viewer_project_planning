import { hasDynamicSpeedDependency } from './simulationCalculationRules';
import { tryFoldConstant } from './numericAdapter';
import { finiteImmediatePeriodicBinding, finiteImmediatePeriodicDamageSource } from './finiteImmediatePeriodicContract';
import { basicAttackContributionAuthorMatches } from './basicAttackContributionContract';
import type {
  AbilityDefinition, AttackRecord, BudgetCause, CompileRequest, DamageBreakdown, DamageRecord, DoneResult, GenericFormulaExpr,
  ExecutionSummary, MechanicRecord, OperationDefinition, ProcessInstanceSnapshot, ProviderStateFieldSchema, RecordingSummary, RunRequest, StopReason, SeriesPoint, SeriesSamplingEvidence
} from '../types/genericEngine';
import type { OperationOrigin } from './simulation/model';
import { inspectContinuousAttackSeries } from './continuousAttackSeries';
import { inspectSimulationHealthLedger } from './simulationHealthLedger';
import { inspectSimulationProcessFacts, simulationActionContribution } from './simulationProcessFacts';
import { empoweredDamageProcess } from './empoweredAttackContract';
import { inspectActiveAmmoMechanics } from './simulationAmmoMechanics';
import { basicAttackPrimaryBinding, inspectPrimaryReplacements } from './primaryAttackReplacementContract';
import { hasResourceMaxAuthorization, inspectResourceChangeContract } from './resourceChangeContract';
import { inspectPermanentHealthInitialization } from './permanentHealthInitialization';
import { inspectBasicAttackCooldownWake } from './basicAttackCooldownWakeResultFacts';
import { finiteTargetCounterExpiryOrigin } from './finiteTargetCounterResultContract';
import { inspectOrdinaryHealing } from './ordinaryHealingContract';
import { inspectSkillHitLinkEvidence, skillHitLinkListenerEvent } from './skillHitLinkEvidence';
import { inspectTargetMarkResult, targetMarkDamageOriginMatches } from './targetMarkResultContract';
import { inspectDamageStateBefore, targetTimingDamageOriginMatches } from './targetTimingResultContract';
import { inspectPermanentPeriodicResult } from './permanentPeriodicResultContract';

export type ContinuousAttackAssessment = {
  complete: boolean; issues: string[]; execution: ExecutionSummary;
  identityGaps: string[];
  factsValid: boolean; seriesIssues: string[]; series: SeriesPoint[];
  seriesSamplingEvidence: SeriesSamplingEvidence | null; damageBreakdown: DamageBreakdown[];
  startedCount: number; hitCount: number; completedCount: number;
  sourceInitialHp: number; targetInitialHp: number; sourceFinalHp: number; targetFinalHp: number;
  damageDealt: number; hpLoss: number; durationMs: number; stopReason: StopReason;
  attackRecords: AttackRecord[]; damageRecords: DamageRecord[]; mechanicRecords: MechanicRecord[]; recording: RecordingSummary;
};
type Row = Record<string, unknown>;
type DamageContract = { kind: 'attack' | 'periodic' | 'target_window' | 'target_mark' | 'reaction' | 'linked' | 'active'; required: boolean; allowed: boolean; origin: OperationOrigin;
  requiredContribution?: boolean;
  attackOnly?: boolean;
  permanent?: boolean;
  tick?: { intervalMs: number; startDelayMs: number } };
const budgetCauses: BudgetCause[] = ['max_events', 'max_commands_per_event', 'max_chain_depth', 'max_queue_events',
  'max_process_instances', 'max_skill_hits', 'max_basic_attacks', 'max_use_trigger_ledger'];
const amountFields = ['postDefenseDamage', 'shieldAbsorbed', 'actualHpLoss', 'overkillDamage'] as const;
const breakdownKey = (row: Row) => JSON.stringify(['owner', 'source', 'target', 'abilityRef', 'operationRef', 'damageType', 'providerDefinitionRef'].map(key => row[key]));
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
function invalid(path: string, message: string): never { throw new Error(`${path}：${message}`); }
function object(value: unknown, path: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path, '需要完整对象');
  return value as Row;
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path, '需要明确数组');
  return value;
}
function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) invalid(path, '需要非空身份');
  return value;
}
function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path, '需要布尔值');
  return value;
}
function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(path, '需要明确有限数值');
  return value;
}
function nonnegative(value: unknown, path: string): number {
  const number = finite(value, path);
  if (number < 0) invalid(path, '需要非负数值');
  return number;
}
function integer(value: unknown, path: string): number {
  const number = nonnegative(value, path);
  if (!Number.isSafeInteger(number)) invalid(path, '需要非负安全整数');
  return number;
}
function nullableTime(value: unknown, path: string): number | null { return value === null ? null : integer(value, path); }

/** 只在能排除其它普通冷却推迟来源时，断言完整观察里应当已有首刀。 */
function hasUnprovenFirstAttackCooldownWrite(value: unknown, abilityRef: string): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(row => hasUnprovenFirstAttackCooldownWrite(row, abilityRef));
  const row = value as Record<string, unknown>;
  if (row.operation === 'cooldown_change') {
    const ref = typeof row.abilityRef === 'string' ? row.abilityRef.replace(/^self\./, 'source.') : null;
    if ((ref === null || ref === abilityRef)
      && !(row.valuePolicy === 'set_remaining' && row.amount && tryFoldConstant(row.amount as GenericFormulaExpr) === 0)) return true;
  }
  return Object.values(row).some(child => hasUnprovenFirstAttackCooldownWrite(child, abilityRef));
}
function health(snapshot: Row, side: string, path: string): number {
  const actors = array(snapshot.combatants, `${path}.combatants`).map((row, index) => object(row, `${path}.combatants[${index}]`));
  if (actors.length !== 2 || actors.filter(row => row.key === 'source').length !== 1 || actors.filter(row => row.key === 'target').length !== 1) {
    invalid(`${path}.combatants`, '需要唯一攻击方与目标');
  }
  const actor = actors.find(row => row.key === side)!;
  const slot = object(object(actor.attributes, `${path}.${side}.attributes`).hp, `${path}.${side}.hp`);
  const current = nonnegative(slot.current, `${path}.${side}.hp.current`);
  const maximum = nonnegative(slot.max, `${path}.${side}.hp.max`);
  finite(slot.base, `${path}.${side}.hp.base`); finite(slot.resolved, `${path}.${side}.hp.resolved`);
  if (current > maximum) invalid(`${path}.${side}.hp`, '当前生命超过上限');
  return current;
}
function compiledOperation(input: CompileRequest, path: string): OperationDefinition | undefined {
  let cursor: unknown = input;
  for (const piece of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Row)[piece];
  }
  return cursor as OperationDefinition | undefined;
}
function passiveControlAuthorMatches(input: CompileRequest, origin: OperationOrigin, ability: AbilityDefinition,
  abilityPath: string, owner: string | undefined): boolean {
  const bindings = input.rules.skillActionBindings?.filter(binding => binding.source === owner && binding.skillKey === ability.skillKey
    && binding.hitBindings.some(hit => hit.hitAbilityRef === origin.abilityRef)) ?? [];
  if (bindings.length !== 1 || bindings[0]!.providerDefinitionRef !== origin.providerDefinitionRef
    || !origin.abilityRef.startsWith(`${owner}.provider[${bindings[0]!.providerRef}].ability[`)) return false;
  const actor = input.combatants.find(row => row.key === owner);
  return !!actor && origin.compiledPaths.every(path => {
    if (!path.startsWith(`${abilityPath}.`)) return false;
    const match = /^\.operations\[(\d+)\]\.skillHit\.candidates\[(\d+)\]\.operations\[(\d+)\]$/.exec(path.slice(abilityPath.length));
    if (!match) return false;
    const resolver = ability.operations?.[Number(match[1])];
    const candidate = resolver?.skillHit?.candidates[Number(match[2])];
    const operation = candidate?.operations[Number(match[3])];
    const mounts = actor.providers.filter(mount => mount.providerRef === candidate?.participationProviderRef);
    const participant = input.sharedProviders?.filter(provider => provider.providerKey === mounts[0]?.definitionRef) ?? [];
    const control = input.sharedProviders?.filter(provider => provider.providerKey === operation?.providerDefinitionRef) ?? [];
    return resolver?.operation === 'resolve_skill_hit' && !!candidate?.participationProviderRef && mounts.length === 1
      && participant.length === 1 && participant[0]!.skillKey === origin.skillKey
      && candidate.effectKey === origin.effectKey && candidate.resultKey === origin.resultKey
      && candidate.semantic.resultType === 'STATUS_OPERATION' && candidate.semantic.target === 'TARGET'
      && candidate.semantic.moment === 'PERSISTENT' && candidate.semantic.statusOperation === 'APPLY'
      && candidate.spellShieldBlockScope === 'RESULT' && candidate.operations.length === 1
      && operation?.operation === 'apply_provider' && operation.target === 'target'
      && operation.ref === origin.operationRef && control.length === 1 && control[0]!.kind === 'status' && control[0]!.skillKey === origin.skillKey
      && control[0]!.types?.includes(`provider/status_${candidate.semantic.statusKind}`) === true;
  });
}
function damageContract(ability: AbilityDefinition, suffix: string, origin: OperationOrigin, operation: OperationDefinition,
  hitAbilityRef: string, activeHit = false, requiredContribution = false, immediatePeriodic = false): DamageContract | undefined {
  const gated = !!operation.condition || !!ability.castCondition || !!ability.cooldown || !!ability.cost;
  if (origin.abilityRef === hitAbilityRef || activeHit) {
    const candidatePath = /^\.operations\[(\d+)\]\.skillHit\.candidates\[(\d+)\]\.operations\[\d+\]$/.exec(suffix);
    if (candidatePath) {
      const parent = ability.operations?.[Number(candidatePath[1])];
      const candidate = parent?.skillHit?.candidates[Number(candidatePath[2])];
      if (parent?.operation !== 'resolve_skill_hit' || !candidate) return undefined;
      return { kind: activeHit ? 'active' : 'attack', allowed: true, origin,
        requiredContribution,
        required: !activeHit && !gated && !parent.condition && (candidate.participationCondition == null || requiredContribution)
          && !candidate.eventValueConditions?.length && candidate.spellShieldBlockScope === null };
    }
    if (/^\.operations\[\d+\]$/.test(suffix)) return { kind: activeHit ? 'active' : 'attack', allowed: true, required: !activeHit && !gated, origin };
    return undefined;
  }
  if (ability.kind === 'passive_listener' && /^\.listenerSpec\.operations\[\d+\]$/.test(suffix)) {
    const listener = ability.listenerSpec;
    if (!listener || listener.abilityRef || listener.maxTriggersPerEvent !== 1
      || listener.perCastThrottleMs || ability.castCondition || ability.cost || ability.cooldown || ability.processControl || ability.tickSpec) return undefined;
    const matcher = listener.eventMatcher;
    const eventTypes = ['event/basic_attack_hit', 'event/source_owner'];
    if ([...(matcher.all ?? []), ...(matcher.any ?? []), ...(matcher.none ?? [])].some(key => key.startsWith('event/damage_dealt'))) return undefined;
    if (skillHitLinkListenerEvent(ability)) {
      return { kind: 'linked', allowed: origin.abilityRef.startsWith('source.provider['), required: false, origin };
    }
    if (matcher.all?.includes('event/target_owner') && (matcher.all.includes('event/damage_taken') || matcher.all.includes('event/basic_attack_received'))) {
      return { kind: 'reaction', allowed: true, required: false, origin, attackOnly: matcher.all.includes('event/basic_attack_received') };
    }
    if (matcher.all?.includes('event/damage_instance') && matcher.all.includes('event/source_owner')) {
      return { kind: 'reaction', allowed: true, required: false, origin };
    }
    if (matcher.all?.includes('event/ability_started') && matcher.all.includes('event/source_owner')) {
      return { kind: 'active', allowed: true, required: false, origin };
    }
    if (matcher.all?.includes('event/skill_hit') && matcher.all.includes('event/source_owner')) {
      return { kind: 'active', allowed: origin.abilityRef.startsWith('source.provider['), required: false, origin };
    }
    if (!matcher.all?.includes('event/basic_attack_hit') || !matcher.all.includes('event/source_owner')) return undefined;
    const allowed = origin.abilityRef.startsWith('source.provider[') && !matcher.none?.some(key => eventTypes.includes(key));
    const everyHit = matcher.all.every(key => eventTypes.includes(key))
      && (!matcher.any?.length || matcher.any.some(key => eventTypes.includes(key))) && !matcher.none?.length;
    return { kind: 'attack', origin, allowed,
      required: allowed && !!everyHit && !operation.condition && !listener.condition && !listener.oncePerUse };
  }
  if (ability.kind === 'tick' && /^\.tickSpec\.onTick\[\d+\]$/.test(suffix) && ability.tickSpec
    && !ability.castCondition && !ability.cost && !ability.cooldown && !ability.processControl && !ability.listenerSpec
    && !ability.operations?.length && !ability.tickSpec.anchorScope && !ability.tickSpec.anchorStateKey
    && Number.isSafeInteger(ability.tickSpec.intervalMs) && ability.tickSpec.intervalMs > 0
    && (ability.tickSpec.startDelayMs === undefined || Number.isSafeInteger(ability.tickSpec.startDelayMs) && ability.tickSpec.startDelayMs >= 0)) {
    if (ability.tickSpec.startDelayMs === 0 && !immediatePeriodic) return undefined;
    return { kind: 'periodic', required: false, allowed: true, origin,
      tick: { intervalMs: ability.tickSpec.intervalMs, startDelayMs: ability.tickSpec.startDelayMs ?? ability.tickSpec.intervalMs } };
  }
  return undefined;
}

/** 只校验原生可靠汇总和记录，不从调试证据重建攻击数或伤害公式。 */
export function assessContinuousAttackResult(
  input: CompileRequest, request: RunRequest, done: DoneResult, origins: OperationOrigin[]
): ContinuousAttackAssessment {
  const plan = request.driverPlan.basicAttack;
  if (!plan || request.driverPlan.entries.length || request.skillUses?.length || request.skillHitFacts?.length
    || request.attackStartFacts?.length || request.processCommandFacts?.length) invalid('runRequest.driverPlan', '需要独立连续普攻计划');
  const result = object(done, 'runResult');
  const summary = object(result.summary, 'runResult.summary');
  const execution = object(summary.execution, 'runResult.summary.execution');
  const basic = object(summary.basicAttack, 'runResult.summary.basicAttack');
  const recording = object(result.recording, 'runResult.recording');
  const initial = object(request.initialSnapshot, 'runRequest.initialSnapshot');
  const final = object(result.finalSnapshot, 'runResult.finalSnapshot');
  const issues: string[] = [];
  const identityGaps: string[] = [];
  issues.push(...inspectResourceChangeContract(input, request, done));
  const initializedHealth = inspectPermanentHealthInitialization(input, request, done);
  issues.push(...initializedHealth.issues); identityGaps.push(...initializedHealth.identityGaps);
  const links = inspectSkillHitLinkEvidence(input, request, done, origins);
  issues.push(...links.issues); identityGaps.push(...links.identityGaps);
  const marks = inspectTargetMarkResult(input, request, done, origins);
  issues.push(...marks.issues); identityGaps.push(...marks.identityGaps);
  const before = inspectDamageStateBefore(input, request, done);
  issues.push(...before.issues); identityGaps.push(...before.identityGaps);
  const permanentPeriodic = inspectPermanentPeriodicResult(input, request, done, origins);
  identityGaps.push(...permanentPeriodic.identityGaps);
  const check = (condition: boolean, path: string, message: string) => { if (!condition) issues.push(`${path}：${message}`); };
  check(bool(result.ok, 'runResult.ok'), 'runResult.ok', '运行返回未成功');
  for (const actor of request.initialSnapshot.combatants) {
    const path = `initialSnapshot.combatants.${actor.key}.cooldowns`;
    check(Object.keys(object(actor.cooldowns, path)).length === 0, path, '连续普攻必须使用空初态冷却，不能以已有冷却证明零刀合法');
  }
  for (const key of ['schemaHash', 'rulesHash'] as const) {
    check(text(final[key], `runResult.finalSnapshot.${key}`) === input[key] && final[key] === request[key] && final[key] === initial[key], key, '编译、运行和最终快照摘要不一致');
  }
  check(request.expectedRulesHash === input.rulesHash && Boolean(request.sessionId), 'runRequest', '缺少本次会话或规则摘要不一致');
  const durationMs = integer(summary.durationMs, 'runResult.summary.durationMs');
  const finalTime = integer(final.timeMs, 'runResult.finalSnapshot.timeMs');
  check(integer(initial.timeMs, 'initialSnapshot.timeMs') === 0 && finalTime === durationMs && durationMs <= request.stopPolicy.durationMs,
    'runResult.summary.durationMs', '实际停止时刻与快照或观察范围不一致');
  const stopReason = text(summary.stopReason, 'runResult.summary.stopReason') as StopReason;
  check(['duration_reached', 'target_dead', 'source_dead', 'both_dead', 'budget_exceeded'].includes(stopReason), 'runResult.summary.stopReason', '连续计划出现非预期停止原因');
  for (const key of ['sourceFinalHp', 'targetFinalHp', 'sourceDamageDealt', 'sourceDamageTaken', 'targetDamageDealt', 'targetDamageTaken',
    'sourceHpLoss', 'targetHpLoss', 'sourceVampHealing', 'targetVampHealing']) {
    nonnegative(summary[key], `runResult.summary.${key}`);
  }
  for (const key of ['abilityAttemptCount', 'abilityCastCount', 'attemptSkippedCount', 'warningCount']) integer(summary[key], `runResult.summary.${key}`);
  const sourceInitialHp = health(initial, 'source', 'initialSnapshot');
  const targetInitialHp = health(initial, 'target', 'initialSnapshot');
  const sourceFinalHp = health(final, 'source', 'finalSnapshot');
  const targetFinalHp = health(final, 'target', 'finalSnapshot');
  const hpMaximum = { source: request.initialSnapshot.combatants.find(actor => actor.key === 'source')!.attributes.hp!.max,
    target: request.initialSnapshot.combatants.find(actor => actor.key === 'target')!.attributes.hp!.max };
  for (const side of ['source', 'target'] as const) hpMaximum[side] += done.resourceChangeSummary?.[side].maxIncrease ?? 0;
  check(sourceInitialHp > 0 && targetInitialHp > 0, 'finalSnapshot.combatants', '不符合双方初始存活范围');
  check(close(sourceFinalHp, summary.sourceFinalHp as number) && close(targetFinalHp, summary.targetFinalHp as number), 'runResult.summary', '双方生命与最终快照不一致');
  check(close(summary.targetDamageDealt as number, summary.sourceDamageTaken as number), 'runResult.summary', '反向造成伤害与来源承受伤害不一致');
  check(close(summary.sourceDamageDealt as number, summary.targetDamageTaken as number), 'runResult.summary', '造成伤害与目标承受伤害不一致');
  const mixed = !!request.driverPlan.skillActions?.length || !!request.driverPlan.automaticSkills;
  const ordinaryHealing = mixed ? undefined : inspectOrdinaryHealing(input, request, done, origins);
  if (ordinaryHealing) { issues.push(...ordinaryHealing.issues); identityGaps.push(...ordinaryHealing.identityGaps); }
  const usesHealthLedger = mixed || ordinaryHealing?.authorized === true || !!done.resourceChangeSummary;
  const directHealing = { source: nonnegative(summary.sourceDirectHealing, 'summary.sourceDirectHealing'),
    target: nonnegative(summary.targetDirectHealing, 'summary.targetDirectHealing') };
  check(close(sourceInitialHp - (summary.sourceHpLoss as number) + (summary.sourceVampHealing as number) + directHealing.source
    + (done.resourceChangeSummary?.source.currentIncrease ?? 0) - (done.resourceChangeSummary?.source.currentDecrease ?? 0), sourceFinalHp)
    && close(targetInitialHp - (summary.targetHpLoss as number) + (summary.targetVampHealing as number) + directHealing.target
      + (done.resourceChangeSummary?.target.currentIncrease ?? 0) - (done.resourceChangeSummary?.target.currentDecrease ?? 0), targetFinalHp),
  'runResult.summary', '双方初始生命、实际扣血、实际吸血入账与最终生命收支不一致');

  const startedCount = integer(basic.startedCount, 'summary.basicAttack.startedCount');
  const hitCount = integer(basic.hitCount, 'summary.basicAttack.hitCount');
  const completedCount = integer(basic.completedCount, 'summary.basicAttack.completedCount');
  check(text(basic.planKey, 'summary.basicAttack.planKey') === plan.planKey, 'summary.basicAttack.planKey', '不属于本次计划');
  check(completedCount <= hitCount && hitCount <= startedCount && startedCount <= (request.safetyBudget?.maxBasicAttacks ?? 4096), 'summary.basicAttack', '开始、命中与完整刀数矛盾');
  const computationComplete = bool(execution.complete, 'summary.execution.complete');
  const killed = bool(execution.targetKilled, 'summary.execution.targetKilled');
  const killedAt = nullableTime(execution.targetKilledAtMs, 'summary.execution.targetKilledAtMs');
  check(integer(execution.requestedDurationMs, 'summary.execution.requestedDurationMs') === request.stopPolicy.durationMs, 'summary.execution.requestedDurationMs', '与冻结观察时长不一致');
  check(execution.incompleteReason === null || ['budget_exceeded', 'unfinished_tail'].includes(execution.incompleteReason as string), 'summary.execution.incompleteReason', '未知未完成原因');
  check(execution.budgetCause === null || budgetCauses.includes(execution.budgetCause as BudgetCause), 'summary.execution.budgetCause', '未知预算原因');
  check(killed ? killedAt !== null && killedAt <= finalTime && targetFinalHp === 0 : killedAt === null && targetFinalHp > 0,
    'summary.execution.targetKilled', '击杀事实、时刻和最终生命不一致');
  check(stopReason !== 'target_dead' || killed && sourceFinalHp > 0, 'summary.stopReason', '目标死亡停止缺少击杀事实');
  check(stopReason !== 'source_dead' || sourceFinalHp === 0 && targetFinalHp > 0, 'summary.stopReason', '攻击方死亡停止与双方生命矛盾');
  check(stopReason !== 'both_dead' || sourceFinalHp === 0 && targetFinalHp === 0 && killed, 'summary.stopReason', '双方死亡停止与双方生命矛盾');
  check(stopReason !== 'duration_reached' || sourceFinalHp > 0 && targetFinalHp > 0 && finalTime === request.stopPolicy.durationMs,
    'summary.stopReason', '时长停止与真实死亡或观察终点矛盾');
  check(stopReason !== 'budget_exceeded' || execution.budgetCause !== null, 'summary.execution.budgetCause', '预算停止缺少预算原因');
  if (computationComplete) {
    check(execution.incompleteReason === null && startedCount === hitCount && hitCount === completedCount,
      'summary.execution.complete', '完整计算含未完成尾部');
    check(killed || sourceFinalHp === 0 || finalTime === request.stopPolicy.durationMs, 'summary.execution.complete', '未死亡且没有观察到终点');
  } else check(execution.incompleteReason !== null && execution.budgetCause !== null, 'summary.execution', '部分结果缺少显式停止原因');

  const processUses = new Map<string, Row>();
  const controlMatch = /^source\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$/.exec(plan.initialControlAbilityRef);
  const provider = input.sharedProviders?.find(row => row.providerKey === input.combatants.find(row => row.key === 'source')?.providers
    .find(row => row.providerRef === controlMatch?.[1])?.definitionRef);
  const control = provider?.abilities?.find(row => row.abilityKey === controlMatch?.[2]);
  array(final.processInstances ?? [], 'finalSnapshot.processInstances').forEach((value, index) => {
    const path = `finalSnapshot.processInstances[${index}]`; const row = object(value, path);
    const use = text(row.useKey, `${path}.useKey`);
    if (mixed && row.providerRef !== controlMatch?.[1]) {
      check(input.rules.skillActionBindings?.some(binding => row.owner === binding.source && row.skillKey === binding.skillKey
        && row.providerRef === binding.providerRef && binding.controls.some(control => control.processKey === row.processKey)) === true,
      path, '混合过程不属于真实计划来源');
      return;
    }
    check(!processUses.has(use) && row.owner === 'source' && row.target === 'target' && row.providerRef === controlMatch?.[1]
      && row.processKey === control?.processControl?.processKey && row.skillKey === plan.skillKey, path, '过程与来源挂载、技能或使用身份不一致');
    integer(row.startedAtMs, `${path}.startedAtMs`);
    processUses.set(use, row);
  });
  check(processUses.size >= hitCount && processUses.size <= startedCount, 'finalSnapshot.processInstances', '同次过程数量与原生命中、开始数矛盾');
  const checkProcess = (use: string, at: number, path: string) => {
    const process = processUses.get(use);
    check(!!process && process.status === 'complete' && process.failureReason === null && process.cooldownStarted === true
      && process.startedAtMs === at && process.finishedAtMs === at, path, '缺少同次使用的成功即时过程与已提交冷却');
  };

  const mapping = new Map<string, OperationOrigin>();
  const damageContracts = new Map<string, DamageContract>();
  for (const origin of origins) {
    const key = `${origin.abilityRef}|${origin.operationRef}`;
    const match = /^(source|target)\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$/.exec(origin.abilityRef);
    const mount = input.combatants.find(actor => actor.key === match?.[1])?.providers.find(provider => provider.providerRef === match?.[2]);
    const providerIndex = input.sharedProviders?.findIndex(provider => provider.providerKey === (origin.providerDefinitionRef ?? mount?.definitionRef)) ?? -1;
    const definition = input.sharedProviders?.[providerIndex];
    const abilityIndex = definition?.abilities?.findIndex(ability => ability.abilityKey === match?.[3]) ?? -1;
    const ability = definition?.abilities?.[abilityIndex];
    const abilityPath = `sharedProviders[${providerIndex}].abilities[${abilityIndex}]`;
    const attackContribution = !!ability && basicAttackContributionAuthorMatches(input, origin, ability, abilityPath,
      match?.[1], plan.hitAbilityRef);
    check(!mapping.has(key)
      && !!ability && (ability.skillKey === origin.skillKey || attackContribution
        || passiveControlAuthorMatches(input, origin, ability, abilityPath, match?.[1]))
      && (!origin.providerDefinitionRef || mount?.definitionRef === origin.providerDefinitionRef
        || !mount && definition?.kind === 'status' && definition.lifecycle?.instanceScope === 'source_target'
        && (!!ability && !!finiteImmediatePeriodicBinding(input, definition, ability)
        || !!input.combatants.find(actor => actor.key === match?.[1])?.providers.some(row => {
          const parent = input.sharedProviders?.find(candidate => candidate.providerKey === row.definitionRef);
          return !!parent && ['item', 'character', 'build'].includes(parent.kind) && parent.stableId === definition.stableId
            && parent.abilities?.some(ability => ability.skillKey === origin.skillKey
              && [...(ability.operations ?? []), ...(ability.listenerSpec?.operations ?? [])]
                .some(operation => operation.operation === 'apply_provider' && operation.providerDefinitionRef === definition.providerKey)) === true;
        })))
      && origin.operationRef === `skills.${origin.skillKey}.effects.${origin.effectKey}.results.${origin.resultKey}`
      && origin.compiledPaths.length > 0 && new Set(origin.compiledPaths).size === origin.compiledPaths.length,
    'operationOrigins', '结果来源映射重复或不完整');
    for (const path of origin.compiledPaths) {
      const operation = compiledOperation(input, path);
      check(operation?.ref === origin.operationRef || operation?.operation === 'state_change'
        && operation.ref === `effect_${origin.effectKey}` && !!operation.types?.includes('state_scope/provider')
        || operation?.operation === 'apply_provider' && operation.ref === `skills.${origin.skillKey}.effects.${origin.effectKey}`
        && input.sharedProviders?.some(provider => provider.providerKey === operation.providerDefinitionRef && provider.skillKey === origin.skillKey
          && provider.modifiers?.some(modifier => modifier.modifierKey === origin.resultKey && ['attribute', 'resource_max'].includes(modifier.kind))) === true,
      'operationOrigins', '编译节点与作者路径不一致');
      if (operation?.operation !== 'damage') continue;
      const processPath = /^sharedProviders\[(\d+)\]\.processes\[(\d+)\]\.momentOperations\[(\d+)\]\.operations\[\d+\]$/.exec(path);
      const process = processPath && definition?.processes?.[Number(processPath[2])];
      const moment = processPath && process && process.momentOperations[Number(processPath[3])]?.moment;
      const processStart = processPath && Number(processPath[1]) === providerIndex && process && moment
        && origin.abilityRef === plan.initialControlAbilityRef && ability?.processControl?.processKey === process.processKey
        && ability.processControl.action === 'INITIAL' && ability.processControl.useRefFromEvent === true
        && process.skillKey === plan.skillKey && moment.momentType === 'PROCESS_START' && moment.stepKey === null && moment.failureReason === null;
      const contract = targetMarkDamageOriginMatches(input, origin, path)
        ? { kind: 'target_mark' as const, allowed: true, required: false, origin }
        : ability && definition && targetTimingDamageOriginMatches(input, definition, ability, origin, operation)
          && (path.startsWith(`${abilityPath}.tickSpec.onTick[`) || path.startsWith(`${abilityPath}.targetExpirySpec.onExpire[`))
        ? { kind: 'target_window' as const, allowed: true, required: false, origin }
        : ability && definition && /^\.tickSpec\.onTick\[\d+\]$/.test(path.slice(abilityPath.length))
        && path.startsWith(`${abilityPath}.`) && finiteTargetCounterExpiryOrigin(input, definition, ability, origin, operation)
        ? { kind: 'target_window' as const, allowed: true, required: false, origin }
        : ability && path.startsWith(`${abilityPath}.`)
        ? damageContract(ability, path.slice(abilityPath.length), origin, operation, plan.hitAbilityRef,
          mixed && input.rules.skillActionBindings?.some(binding => binding.hitBindings.some(hit => hit.hitAbilityRef === origin.abilityRef)) === true,
          attackContribution, !!definition && !!finiteImmediatePeriodicBinding(input, definition, ability))
        : processStart ? { kind: 'attack' as const, required: !operation.condition, allowed: true, origin } : undefined;
      check(!!contract && operation.target === 'target' && !operation.repeatScope && (operation.repeatCount === undefined || operation.repeatCount === 1)
        && !operation.repeatDelayMs && !damageContracts.has(path), 'operationOrigins', '伤害节点的执行入口、重复或攻击关联尚未核定');
      if (contract?.kind === 'periodic' && definition?.kind === 'character' && !definition.lifecycle) contract.permanent = true;
      if (contract) damageContracts.set(path, contract);
    }
    mapping.set(key, origin);
  }
  const attackContracts = [...damageContracts].filter(([, contract]) => contract.kind === 'attack');
  check(attackContracts.some(([, contract]) => contract.origin.abilityRef === plan.hitAbilityRef),
    'operationOrigins', '缺少主体真实伤害结果');
  const identity = (row: Row, path: string) => {
    for (const key of ['owner', 'source', 'target', 'abilityRef', 'operationRef', 'damageType']) text(row[key], `${path}.${key}`);
    let origin = mapping.get(`${row.abilityRef}|${row.operationRef}`);
    if (!origin && row.providerDefinitionRef !== undefined) {
      const definition = text(row.providerDefinitionRef, `${path}.providerDefinitionRef`);
      const candidates = origins.filter(candidate => candidate.providerDefinitionRef === definition && candidate.operationRef === row.operationRef
        && candidate.abilityRef.startsWith(`${row.owner}.provider[`));
      const actual = /^(source|target)\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$/.exec(row.abilityRef as string);
      origin = candidates.length === 1 && actual?.[2]?.startsWith(`${definition}#`)
        && candidates[0]!.abilityRef.endsWith(`.ability[${actual[3]}]`) ? candidates[0] : undefined;
    }
    const forward = row.owner === plan.source && row.source === plan.source && row.target === plan.target;
    const reverse = row.owner === plan.target && row.source === plan.target && row.target === plan.source;
    check((forward || reverse) && !!origin && (origin?.providerDefinitionRef !== undefined || (row.abilityRef as string).startsWith(`${row.owner}.provider[`)), path, '伤害来源、拥有者或完整作者引用无法关联');
    if (origin) check(origin.compiledPaths.some(path => {
      const operation = compiledOperation(input, path);
      return operation?.operation === 'damage' && operation.damageType === row.damageType && !!damageContracts.get(path)?.allowed;
    }), path, '结果类型与实际编译伤害不一致');
    return origin;
  };
  const amounts = (row: Row, path: string) => {
    for (const key of amountFields) nonnegative(row[key], `${path}.${key}`);
    check(close(row.postDefenseDamage as number, (row.shieldAbsorbed as number) + (row.actualHpLoss as number) + (row.overkillDamage as number)), path, '护盾、扣血与过量不能还原造成伤害');
  };
  const breakdown = array(summary.damageBreakdown, 'summary.damageBreakdown').map((value, index) => {
    const path = `summary.damageBreakdown[${index}]`; const row = object(value, path);
    identity(row, path); amounts(row, path); integer(row.damageCount, `${path}.damageCount`);
    return row as DamageBreakdown;
  });
  const sum = (rows: Row[], field: string) => rows.reduce((total, row) => total + (row[field] as number), 0);
  // 分类汇总始终完整；明细截断时也核对每刀必需组成，重复动作不能因共用作者引用而少计。
  const requiredContributions = new Map<string, { origin: OperationOrigin; damageType: string; count: number }>();
  for (const [path, contract] of attackContracts) if (contract.required && contract.requiredContribution) {
    const damageType = compiledOperation(input, path)!.damageType!;
    const key = JSON.stringify([contract.origin.abilityRef, contract.origin.operationRef, damageType]);
    const group = requiredContributions.get(key);
    if (group) group.count++;
    else requiredContributions.set(key, { origin: contract.origin, damageType, count: 1 });
  }
  for (const { origin, damageType, count } of requiredContributions.values()) {
    const actual = sum(breakdown.filter(row => row.owner === plan.source && row.source === plan.source && row.target === plan.target
      && row.abilityRef === origin.abilityRef && row.operationRef === origin.operationRef && row.damageType === damageType), 'damageCount');
    check(actual >= completedCount * count && actual <= hitCount * count,
      'summary.damageBreakdown', '完整分类汇总缺少每刀必需组成或重复结算');
  }
  const primary = basicAttackPrimaryBinding(input, plan);
  const replacementIssues = inspectPrimaryReplacements(input, request, done);
  check(replacementIssues.length === 0, 'summary.basicAttack.primaryReplacements', replacementIssues.join('；'));
  const replacementCount = (done.summary.basicAttack?.primaryReplacements ?? []).reduce((count, row) => count + row.count, 0);
  const orderedPrimaryProcesses = [...processUses.entries()].sort((left, right) => (left[1].startedAtMs as number) - (right[1].startedAtMs as number));
  const primaryUseIndices = new Map(orderedPrimaryProcesses.map(([use], index) => [use, index + 1]));
  const primaryCount = sum(breakdown.filter(row => row.abilityRef === plan.hitAbilityRef && row.source === plan.source
    && row.target === plan.target && (!primary || row.operationRef === primary.operation.ref)), 'damageCount');
  check(primary ? primaryCount + replacementCount >= completedCount && primaryCount + replacementCount <= hitCount
    : primaryCount >= hitCount, 'summary.damageBreakdown', '每次真实主体命中只能提交原主体或合法替换之一');
  check(new Set(breakdown.map(breakdownKey)).size === breakdown.length, 'summary.damageBreakdown', '分类汇总键重复');
  for (const side of ['source', 'target'] as const) {
    check(close(sum(breakdown.filter(row => row.source === side), 'postDefenseDamage'), summary[`${side}DamageDealt`] as number)
      && close(sum(breakdown.filter(row => row.target === side), 'actualHpLoss'), summary[`${side}HpLoss`] as number), 'summary.damageBreakdown', '方向分类金额与汇总不一致');
  }

  const primaryRef = /^source\.provider\[([^\]]+)\]/.exec(plan.startAbilityRef)?.[1];
  const primaryMount = input.combatants.find(actor => actor.key === plan.source)?.providers.find(mount => mount.providerRef === primaryRef);
  const primaryProvider = input.sharedProviders?.find(provider => provider.providerKey === primaryMount?.definitionRef);
  const ammoDeclarations = Object.entries(primaryProvider?.initialStateSchema ?? {}).filter(([, field]) =>
    typeof field === 'object' && field.stateKind === 'ammo') as Array<[string, ProviderStateFieldSchema]>;
  const isPrimaryMechanic = (row: MechanicRecord) => row.owner === plan.source && row.providerRef === primaryRef
    && row.providerDefinitionRef === primaryProvider?.providerKey && row.skillKey === plan.skillKey
    && ammoDeclarations.some(([key]) => key === row.stateKey);
  const mechanics = array(result.mechanicRecords, 'runResult.mechanicRecords').map((value, index) => {
    const path = `mechanicRecords[${index}]`; const row = object(value, path);
    const at = integer(row.timeMs, `${path}.timeMs`);
    for (const key of ['owner', 'providerRef', 'providerDefinitionRef', 'skillKey', 'stateKey', 'operationRef']) text(row[key], `${path}.${key}`);
    const declaration = ammoDeclarations.find(([key]) => key === row.stateKey)?.[1];
    const maximum = typeof declaration?.maxValue === 'number' ? declaration.maxValue : declaration?.maxValue ? tryFoldConstant(declaration.maxValue) : null;
    const before = integer(row.beforeValue, `${path}.beforeValue`);
    const after = integer(row.afterValue, `${path}.afterValue`);
    const ready = nullableTime(row.readyAtMs, `${path}.readyAtMs`);
    if (row.useRef !== null) text(row.useRef, `${path}.useRef`);
    if (!isPrimaryMechanic(row as MechanicRecord)) return row as MechanicRecord;
    check(at <= finalTime && row.owner === plan.source && row.providerRef === primaryRef && row.providerDefinitionRef === primaryProvider?.providerKey
      && row.skillKey === plan.skillKey && !!declaration && maximum !== null && before <= maximum && after <= maximum, path, '机制记录身份、时刻或库存与主体声明不一致');
    check(['STATE_CHANGED', 'WAIT_STARTED', 'WAIT_ENDED'].includes(row.kind as string), path, '未知机制记录种类');
    if (row.kind === 'WAIT_STARTED') check(before === 0 && after === 0 && ready !== null && ready > at, path, '等待必须由耗尽启动并提供真实唤醒时点');
    if (row.kind === 'WAIT_ENDED') check(before === 0 && after === maximum && row.useRef === null && (ready === null || ready === at), path, '恢复结束必须一次补满且不能伪造攻击身份');
    if (row.kind === 'STATE_CHANGED') check(row.useRef === null ? before === 0 && after === maximum : before > 0 && after === before - 1,
      path, '库存变化必须是实际消费1或合法一次补满');
    return row as MechanicRecord;
  });
  const primaryMechanics = mechanics.filter(isPrimaryMechanic);
  mechanics.forEach((row, index) => check(index === 0 || mechanics[index - 1]!.timeMs <= row.timeMs, `mechanicRecords[${index}]`, '机制记录时刻逆序'));
  const initialAmmo = ammoDeclarations.length === 1 ? ammoDeclarations[0]![1].defaultValue : undefined;
  const initialMechanicReadyAt = nullableTime(basic.initialMechanicReadyAtMs ?? null, 'summary.basicAttack.initialMechanicReadyAtMs');
  const initialActionReadyAt = nullableTime(basic.initialActionReadyAtMs, 'summary.basicAttack.initialActionReadyAtMs');
  const processFacts = mixed ? inspectSimulationProcessFacts(input, request, done) : { issues: [], occupancies: [], processes: [], empoweredSuccessions: new Map() };
  issues.push(...processFacts.issues);
  issues.push(...inspectActiveAmmoMechanics(input, request, done, processFacts.processes, mechanics.filter(row => !isPrimaryMechanic(row))));
  const actualAttackStarts = [...processUses.values()].map(process => process.startedAtMs as number).sort((first, second) => first - second);
  const firstActualStart = actualAttackStarts[0] ?? Infinity;
  const expectedActionContribution = (start: number, end: number) => simulationActionContribution(processFacts.occupancies, start, end);
  for (const [useRef, process] of processUses) {
    const start = process.startedAtMs as number;
    check(!processFacts.occupancies.some(occupancy => {
      if (start < occupancy.startedAtMs || start >= (occupancy.finishedAtMs ?? occupancy.expectedEndAtMs)) return false;
      const successor = processFacts.empoweredSuccessions.get(occupancy.useRef);
      const consumer = processFacts.processes.find(row => row.useKey === occupancy.useRef);
      const wake = inspectBasicAttackCooldownWake(input, request, done, process as unknown as ProcessInstanceSnapshot, consumer, occupancy);
      if (wake.valid) {
        if (wake.identityGap) identityGaps.push(wake.identityGap);
        return false;
      }
      return !(successor && successor.attack.useRef === useRef && successor.timeMs === start && occupancy.stepVersion === 1
        && occupancy.startedAtMs === start && consumer?.startedAtMs === start);
    }), 'processInstances.actionReady', '真实普攻不能在既有占用内开始；同刻后项必须沿该刀真实消费因果证明');
  }
  check(initialActionReadyAt === expectedActionContribution(0, firstActualStart),
    'summary.basicAttack.initialActionReadyAtMs', '首刀贡献必须完整对应首刀前真实占用实例，不能省略或伪造');
  check(initialActionReadyAt === null || mixed && initialActionReadyAt > 0,
    'summary.basicAttack.initialActionReadyAtMs', '行动就绪必须是计划实际占用贡献，不能由记录推导');
  check(initialMechanicReadyAt === null || initialAmmo === 0 && initialMechanicReadyAt > 0,
    'summary.basicAttack.initialMechanicReadyAtMs', '初次就绪事实只能来自零弹初态的实际恢复');
  if (computationComplete) {
    check(initialAmmo !== 0 || initialMechanicReadyAt !== null,
      'summary.basicAttack.initialMechanicReadyAtMs', '完整零弹观察缺少实际恢复安排');
    check(completedCount > 0 || killed || sourceFinalHp === 0
      || Math.max(initialMechanicReadyAt ?? 0, initialActionReadyAt ?? 0) > finalTime,
    'summary.execution.complete', '无攻击的完整观察必须仍在实际初次机制等待或已死亡');
  }
  if (computationComplete && startedCount === 0 && sourceFinalHp > 0 && targetFinalHp > 0
    && !hasUnprovenFirstAttackCooldownWrite(input, plan.initialControlAbilityRef)) {
    let ready = initialMechanicReadyAt ?? 0;
    const occupancies = [...processFacts.occupancies].sort((left, right) => left.startedAtMs - right.startedAtMs);
    for (const occupancy of occupancies) {
      if (occupancy.startedAtMs > ready) break;
      ready = Math.max(ready, occupancy.finishedAtMs ?? occupancy.expectedEndAtMs);
    }
    check(ready > finalTime, 'summary.basicAttack.firstWait', '首刀实际就绪前的占用必须连续覆盖；不能用后来的占用掩盖中间可攻击空档');
  }
  const firstWaitExplained = (startAt: number) => startAt === Math.max(initialMechanicReadyAt ?? 0, initialActionReadyAt ?? 0);
  const dynamicSpeed = hasDynamicSpeedDependency(input, plan.source, plan.attackSpeedAttributeKey, request);
  const attacks = array(result.attackRecords, 'runResult.attackRecords').map((value, index) => {
    const path = `attackRecords[${index}]`; const row = object(value, path);
    for (const key of ['planKey', 'useRef', 'source', 'target', 'skillKey']) text(row[key], `${path}.${key}`);
    const attackIndex = integer(row.attackIndex, `${path}.attackIndex`);
    const startAt = integer(row.startAtMs, `${path}.startAtMs`);
    const hitAt = nullableTime(row.hitAtMs, `${path}.hitAtMs`);
    const readyAt = nullableTime(row.readyAtMs, `${path}.readyAtMs`);
    const finalReadyAt = nullableTime(row.finalReadyAtMs, `${path}.finalReadyAtMs`);
    const mechanicReadyAt = nullableTime(row.mechanicReadyAtMs, `${path}.mechanicReadyAtMs`);
    const actionReadyAt = nullableTime(row.actionReadyAtMs, `${path}.actionReadyAtMs`);
    const nextAt = nullableTime(row.nextStartAtMs, `${path}.nextStartAtMs`);
    const nextActualStart = actualAttackStarts.find(start => start > startAt) ?? finalTime + 1;
    check(actionReadyAt === expectedActionContribution(startAt, nextActualStart), `${path}.actionReadyAtMs`,
      '逐刀行动贡献必须完整对应本刀后真实占用实例，不能用空值省略或伪造就绪贡献');
    const completed = bool(row.completed, `${path}.completed`);
    const speed = finite(row.attackSpeed, `${path}.attackSpeed`);
    for (const key of ['postDefenseDamage', 'actualHpLoss', 'sourceHpAfter', 'targetHpAfter']) nonnegative(row[key], `${path}.${key}`);
    check((row.sourceHpAfter as number) <= hpMaximum.source && (row.targetHpAfter as number) <= hpMaximum.target,
      path, '攻击尾部生命超过初始生命上限');
    check(attackIndex === index + 1 && row.planKey === plan.planKey && row.source === plan.source && row.target === plan.target && row.skillKey === plan.skillKey,
      path, '攻击顺序或计划身份不一致');
    check(startAt <= finalTime && (index !== 0 || firstWaitExplained(startAt)) && (hitAt === null || hitAt === startAt)
      && (readyAt === null || readyAt > startAt) && (readyAt === null) === (finalReadyAt === null)
      && (finalReadyAt === null || finalReadyAt > startAt) && (mechanicReadyAt === null || ammoDeclarations.length === 1 && mechanicReadyAt >= startAt)
      && (actionReadyAt === null || mixed && actionReadyAt > startAt)
      && (nextAt === null || finalReadyAt !== null && nextAt === Math.max(finalReadyAt, mechanicReadyAt ?? 0, actionReadyAt ?? 0)
        && nextAt <= request.stopPolicy.durationMs), path, '攻击时刻或普通冷却与机制的共同就绪时刻不一致');
    const derived = input.rules.attributeDerivations?.some(derivation => derivation.combatantKey === plan.source && derivation.attributeKey === plan.attackSpeedAttributeKey);
    const initialized = input.typeCatalog.types.some(entry => entry.key === 'event/source_initialized');
    const speedSnapshot = derived || initialized ? final : initial;
    const speedActor = array(speedSnapshot.combatants, 'attackSpeedSnapshot.combatants').map(actor => object(actor, 'attackSpeedSnapshot.combatants')).find(actor => actor.key === plan.source);
    const resolvedSpeed = finite(object(object(speedActor?.attributes, 'attackSpeedSnapshot.attributes')[plan.attackSpeedAttributeKey], 'attackSpeedSnapshot.attribute').resolved, 'attackSpeedSnapshot.resolved');
    check(speed > 0 && speed <= plan.attackSpeedInputMax && (dynamicSpeed || close(speed, resolvedSpeed)), path, '静态原生攻速或准入上界不一致');
    check(completed === (attackIndex <= completedCount) && (hitAt !== null) === (attackIndex <= hitCount)
      && (!completed || readyAt !== null), path, '逐刀完成、命中事实与累计次数矛盾');
    if (hitAt !== null) checkProcess(row.useRef as string, hitAt, path);
    return row as AttackRecord;
  });
  check(new Set(attacks.map(row => row.useRef)).size === attacks.length, 'attackRecords', '不同攻击复用了使用身份');
  attacks.forEach((attack, index) => {
    if (index > 0) check(attacks[index - 1]!.nextStartAtMs === attack.startAtMs, `attackRecords[${index}]`, '未沿上刀已安排的冷却就绪时刻开始');
  });
  const damageIds = new Set<number>();
  if (replacementCount) check(attacks.every(attack => primaryUseIndices.get(attack.useRef) === attack.attackIndex),
    'attackRecords', '真实普攻刀号必须与完整过程顺序一致');
  const damages = array(result.damageRecords, 'runResult.damageRecords').map((value, index) => {
    const path = `damageRecords[${index}]`; const row = object(value, path);
    const origin = identity(row, path); amounts(row, path);
    text(row.operationPath, `${path}.operationPath`);
    const contract = damageContracts.get(row.operationPath as string);
    const independentWindow = contract?.kind === 'target_window' && row.attackIndex === null && row.useRef === ''
      && !row.instructionKey && !row.hitRef;
    const independentPeriodic = contract?.kind === 'periodic' && contract.tick?.startDelayMs === 0
      && finiteImmediatePeriodicDamageSource(input, row, done.finalSnapshot.processInstances);
    const independentPermanent = permanentPeriodic.accepts(row as unknown as DamageRecord);
    check(typeof row.useRef === 'string', path, '使用身份必须是明确字符串');
    const damageId = integer(row.damageId, `${path}.damageId`);
    const attackIndex = mixed && row.attackIndex === null ? null : integer(row.attackIndex, `${path}.attackIndex`);
    const timeMs = integer(row.timeMs, `${path}.timeMs`);
    check(damageId > 0 && !damageIds.has(damageId) && integer(row.castInstanceId, `${path}.castInstanceId`) > 0, path, '伤害或施放身份缺失、重复');
    damageIds.add(damageId);
    check((attackIndex === null || attackIndex <= hitCount) && timeMs <= finalTime
      && (attackIndex === null ? independentWindow || independentPeriodic || independentPermanent || !!row.useRef : attackIndex > 0 ? !!row.useRef : row.useRef === '')
      && !!origin?.compiledPaths.includes(row.operationPath as string), path, '伤害无法关联本刀或独立真实编译路径');
    const retainedAttack = attackIndex === null ? undefined : attacks[attackIndex - 1];
    const empowered = mixed ? empoweredDamageProcess(input, done, row as unknown as DamageRecord) : null;
    const originalUse = empowered ? (row as unknown as DamageRecord).empoweredAttack!.useRef : row.useRef as string;
    if (retainedAttack) check(retainedAttack.useRef === originalUse
      && retainedAttack.hitAtMs === timeMs, path, '伤害与逐刀使用身份或命中时刻不一致');
    if (attackIndex !== null && attackIndex > 0) checkProcess(originalUse,
      retainedAttack?.startAtMs ?? timeMs, path);
    nonnegative(row.rawAmount, `${path}.rawAmount`);
    const hpBefore = nonnegative(row.hpBefore, `${path}.hpBefore`);
    const hpAfter = nonnegative(row.hpAfter, `${path}.hpAfter`);
    const sourceHpBefore = nonnegative(row.sourceHpBefore, `${path}.sourceHpBefore`);
    const sourceHpAfter = nonnegative(row.sourceHpAfter, `${path}.sourceHpAfter`);
    check(close(hpBefore - hpAfter, row.actualHpLoss as number), path, '逐笔生命变化与扣血不一致');
    check(sourceHpAfter >= sourceHpBefore && sourceHpAfter <= hpMaximum[row.source as 'source' | 'target']
      && hpBefore <= hpMaximum[row.target as 'source' | 'target'] && hpAfter <= hpBefore,
    path, '伤害来源生命受量减少或逐笔生命超过初始上限');
    for (const key of ['resistanceFactor', 'normalPartPostResistance', 'critPartPostResistance']) finite(row[key], `${path}.${key}`);
    const operation = compiledOperation(input, row.operationPath as string);
    if (contract?.kind === 'reaction' && row.useRef === '' && permanentPeriodic.requiresProof(row as unknown as DamageRecord)) {
      check(independentPermanent, path, '空使用原额派生缺少真实永久周期父包与完整监听资格');
    }
    check(operation?.operation === 'damage' && operation.ref === row.operationRef && operation.damageType === row.damageType
      && !!contract && contract.origin === origin && contract.allowed && (contract.kind === 'target_window' ? independentWindow : contract.kind === 'periodic' ? contract.permanent ? independentPermanent : independentPeriodic || contract.tick?.startDelayMs !== 0 && attackIndex === 0
        : contract.kind === 'active' ? empowered ? attackIndex !== null && attackIndex > 0 : attackIndex === null : contract.kind === 'reaction' && !contract.attackOnly ? true
          : (contract.kind === 'linked' || contract.kind === 'target_mark') && attackIndex === null ? mixed && !!row.instructionKey : attackIndex !== null && attackIndex > 0),
    path, '伤害节点、类型或独立周期与攻击关联不一致');
    if (contract?.tick) {
      if (contract.tick.startDelayMs === 0) check(finiteImmediatePeriodicDamageSource(input, row, done.finalSnapshot.processInstances), path,
        '立即区域跳伤必须来自实际首次、原相位及未到期窗口，不能借其它动态实例');
      const activatedAt = contract.origin.providerDefinitionRef ? integer(row.providerActivatedAtMs, `${path}.providerActivatedAtMs`) : 0;
      check(timeMs >= activatedAt + contract.tick.startDelayMs && (timeMs - activatedAt - contract.tick.startDelayMs) % contract.tick.intervalMs === 0,
        path, '周期伤害不符合实际激活时点、编译后的正首间隔或静态周期');
    }
    if (operation?.critEligible) {
      check(bool(row.eligible, `${path}.eligible`), path, '原暴击资格未保留'); text(row.policy, `${path}.policy`);
      for (const key of ['baseRawAmount', 'originalCritChance', 'effectiveCritChance', 'multiplier', 'normalPart', 'critPart', 'critAdjustedRawAmount']) finite(row[key], `${path}.${key}`);
    }
    if (row.modifiers !== undefined) array(row.modifiers, `${path}.modifiers`).forEach((modifier, i) => object(modifier, `${path}.modifiers[${i}]`));
    return row as DamageRecord;
  });
  for (const [kind, rows, maximum] of [['attack', attacks, request.recordBudget?.maxAttackRecords ?? 1000], ['damage', damages, request.recordBudget?.maxDamageRecords ?? 2000],
    ['mechanic', mechanics, request.recordBudget?.maxMechanicRecords ?? 0]] as const) {
    const label = kind === 'attack' ? 'Attack' : kind === 'damage' ? 'Damage' : 'Mechanic';
    const count = integer(recording[`${kind}RecordCount`], `recording.${kind}RecordCount`);
    const returned = integer(recording[`returned${label}Records`], 'recording.returned');
    const dropped = integer(recording[`dropped${label}Records`], 'recording.dropped');
    const truncated = bool(recording[`${kind}RecordsTruncated`], 'recording.truncated');
    check(count === returned + dropped && returned === rows.length && returned === Math.min(count, maximum) && truncated === (dropped > 0), 'recording', '记录预算、总数、返回数或截断说明矛盾');
  }
  check(recording.attackRecordCount === startedCount && recording.damageRecordCount === sum(breakdown, 'damageCount'), 'recording', '可靠总条数与攻击、分类汇总不一致');
  for (const row of primaryMechanics) if (row.useRef !== null) check(attacks.some(attack => attack.useRef === row.useRef && attack.startAtMs === row.timeMs)
    || recording.attackRecordsTruncated === true, 'mechanicRecords.useRef', '机制使用身份必须来自同刻真实攻击');
  if (recording.mechanicRecordsTruncated === false) {
    if (initialMechanicReadyAt !== null) {
      check(primaryMechanics.some(row => row.kind === 'WAIT_STARTED' && row.timeMs === 0 && row.useRef === null
        && row.readyAtMs === initialMechanicReadyAt), 'summary.basicAttack.initialMechanicReadyAtMs', '完整机制记录缺少初始等待安排');
      if (initialMechanicReadyAt <= finalTime) check(primaryMechanics.some(row => row.kind === 'WAIT_ENDED'
        && row.timeMs === initialMechanicReadyAt && row.useRef === null),
      'summary.basicAttack.initialMechanicReadyAtMs', '完整机制记录缺少初始恢复完成');
    }
    for (const attack of attacks) if (attack.mechanicReadyAtMs !== null && attack.mechanicReadyAtMs > attack.startAtMs) check(primaryMechanics.some(row => row.kind === 'WAIT_STARTED'
      && row.owner === plan.source && row.providerRef === primaryRef && row.skillKey === plan.skillKey
      && row.timeMs === attack.startAtMs && (row.useRef === null || row.useRef === attack.useRef) && row.readyAtMs === attack.mechanicReadyAtMs),
    'attackRecords.mechanicReadyAtMs', '机制等待必须有实际提交记录解释');
  }
  const hp = { source: sourceInitialHp, target: targetInitialHp };
  const vampHealing = { source: 0, target: 0 };
  const hpLoss = { source: 0, target: 0 };
  const lastDamageByAttack = new Map<number, number>();
  damages.forEach((row, index) => { if (row.attackIndex !== null && row.attackIndex > 0) lastDamageByAttack.set(row.attackIndex, index); });
  let time = 0;
  let attackIndex = 0;
  damages.forEach((row, index) => {
    const source = row.source as 'source' | 'target';
    const target = row.target as 'source' | 'target';
    check(usesHealthLedger || close(row.sourceHpBefore as number, hp[source]) && close(row.hpBefore, hp[target]),
      'damageRecords', '来源受量或对手扣血缺少连续可靠生命链');
    const independentWindow = damageContracts.get(row.operationPath)?.kind === 'target_window' && row.attackIndex === null
      && row.useRef === '' && !row.instructionKey && !row.hitRef;
    const independentPeriodic = damageContracts.get(row.operationPath)?.kind === 'periodic'
      && damageContracts.get(row.operationPath)?.tick?.startDelayMs === 0 && finiteImmediatePeriodicDamageSource(input, row, done.finalSnapshot.processInstances)
      || permanentPeriodic.accepts(row);
    check((row.attackIndex !== null || independentWindow || independentPeriodic || mixed && !!row.instructionKey) && row.timeMs >= time
      && (row.attackIndex === null || row.attackIndex === 0 || row.attackIndex >= attackIndex), 'damageRecords', '连续普攻伤害刀号或已提交顺序不一致');
    hp[target] = row.hpAfter; hp[source] = row.sourceHpAfter as number;
    vampHealing[source] += (row.sourceHpAfter as number) - (row.sourceHpBefore as number);
    hpLoss[target] += row.actualHpLoss;
    time = row.timeMs; if (row.attackIndex !== null && row.attackIndex > 0) attackIndex = row.attackIndex;
    const attack = row.attackIndex === null ? undefined : attacks[row.attackIndex - 1];
    if (!usesHealthLedger && !recording.damageRecordsTruncated && attack && row.attackIndex !== null && lastDamageByAttack.get(row.attackIndex) === index) {
      check(close(attack.sourceHpAfter, hp.source) && close(attack.targetHpAfter, hp.target), 'attackRecords',
        '同步尾部检查点与逐笔来源受量、对手扣血不一致');
    }
  });
  for (const side of ['source', 'target'] as const) {
    check((vampHealing[side] <= (summary[`${side}VampHealing`] as number) || close(vampHealing[side], summary[`${side}VampHealing`] as number))
      && (hpLoss[side] <= (summary[`${side}HpLoss`] as number) || close(hpLoss[side], summary[`${side}HpLoss`] as number)),
    'damageRecords', '已保留逐笔吸血或扣血超过完整汇总');
  }
  if (!recording.damageRecordsTruncated) {
    check(usesHealthLedger || close(hp.source, sourceFinalHp) && close(hp.target, targetFinalHp), 'finalSnapshot', '完整逐笔生命链与最终快照不一致');
    check(close(vampHealing.source, summary.sourceVampHealing as number) && close(vampHealing.target, summary.targetVampHealing as number),
      'runResult.summary', '完整逐笔来源吸血增量与实际吸血汇总不一致');
    const lethal = damages.find(row => row.target === plan.target && row.hpBefore > 0 && row.hpAfter === 0);
    check(killed ? lethal?.timeMs === killedAt : !lethal, 'summary.execution.targetKilledAtMs', '击杀时刻与首次已提交致死伤害不一致');
    const firstDeathIndex = damages.findIndex(row => row.hpBefore > 0 && row.hpAfter === 0);
    if (firstDeathIndex >= 0) {
      const firstDeath = damages[firstDeathIndex]!;
      check(finalTime === firstDeath.timeMs && attacks.every(attack => attack.startAtMs <= firstDeath.timeMs),
        'summary.execution', '真实死亡以后仍推进观察时刻或启动攻击');
      check(damages.slice(firstDeathIndex + 1).every(row => row.timeMs === firstDeath.timeMs
        && (permanentPeriodic.sameCommit(firstDeath, row) || (firstDeath.attackIndex !== null && firstDeath.attackIndex > 0 ? row.attackIndex === firstDeath.attackIndex
          : row.attackIndex === null && firstDeath.attackIndex === null ? firstDeath.useRef !== '' ? row.useRef === firstDeath.useRef
            : row.useRef === '' && row.castInstanceId === firstDeath.castInstanceId
              && (damageContracts.get(row.operationPath)?.kind === 'target_window'
                && damageContracts.get(firstDeath.operationPath)?.kind === 'target_window'
                || damageContracts.get(row.operationPath)?.tick?.startDelayMs === 0 && damageContracts.get(firstDeath.operationPath)?.tick?.startDelayMs === 0
                  && finiteImmediatePeriodicDamageSource(input, row, done.finalSnapshot.processInstances)
                  && finiteImmediatePeriodicDamageSource(input, firstDeath, done.finalSnapshot.processInstances))
            : row.attackIndex === 0 && row.castInstanceId === firstDeath.castInstanceId))),
      'damageRecords', '真实死亡以后出现新的攻击或独立周期，而非原同步提交尾部');
    }
    for (const group of breakdown) {
      const rows = damages.filter(row => breakdownKey(row) === breakdownKey(group));
      check(rows.length === group.damageCount && amountFields.every(field => close(sum(rows, field), group[field])), 'damageRecords', '完整伤害记录与分类汇总不一致');
    }
    check(damages.every(row => breakdown.some(group => breakdownKey(row) === breakdownKey(group))), 'damageRecords', '伤害缺少分类汇总');
    for (let index = 1; index <= Math.min(hitCount, 4096); index++) {
      for (const [path, contract] of attackContracts) {
        const count = damages.filter(row => row.attackIndex === index && row.operationPath === path && row.abilityRef === contract.origin.abilityRef).length;
        const replaced = primary?.operationPath === path && (done.finalSnapshot.processInstances ?? []).some(process =>
          process.empoweredAttack?.replacedPrimary && primaryUseIndices.get(process.empoweredAttack.useRef) === index);
        check(replaced ? count === 0 : contract.required && index <= completedCount ? count === 1 : count <= 1,
          'damageRecords', `第${index}刀缺少完整作者伤害结果或重复结算`);
      }
    }
    for (const attack of attacks) {
      const rows = damages.filter(row => row.attackIndex === attack.attackIndex && row.source === plan.source && row.target === plan.target);
      check(close(sum(rows, 'postDefenseDamage'), attack.postDefenseDamage) && close(sum(rows, 'actualHpLoss'), attack.actualHpLoss), 'attackRecords', '逐刀金额与真实伤害记录不一致');
    }
  }
  if (!usesHealthLedger && !recording.damageRecordsTruncated && !recording.attackRecordsTruncated && attacks.length) {
    const last = attacks[attacks.length - 1]!;
    if (!lastDamageByAttack.has(last.attackIndex)) {
      check(last.startAtMs === finalTime && close(last.sourceHpAfter, hp.source) && close(last.targetHpAfter, hp.target),
        'attackRecords', '无伤害尾部检查点缺少同刻可靠生命事实');
    }
  }
  const warnings = array(result.warnings, 'runResult.warnings');
  if (usesHealthLedger || hasResourceMaxAuthorization(input)) issues.push(...inspectSimulationHealthLedger(input, request, done, ordinaryHealing?.order));
  const evidence = object(result.evidence, 'runResult.evidence');
  bool(summary.evidenceTruncated, 'summary.evidenceTruncated');

  const evidenceTruncated = bool(evidence.truncated, 'evidence.truncated');
  const evidenceDropped = integer(evidence.truncatedEvidenceCount, 'evidence.truncatedEvidenceCount');
  array(evidence.items, 'evidence.items'); object(evidence.countsByKind, 'evidence.countsByKind');
  check(summary.evidenceTruncated === evidenceTruncated && evidenceTruncated === (evidenceDropped > 0), 'evidence', '调试证据截断说明矛盾');
  warnings.forEach((value, index) => {
    const row = object(value, `warnings[${index}]`); const code = text(row.code, `warnings[${index}].code`);
    text(row.message, `warnings[${index}].message`);
    check(row.severity === 'warning' && ['evidence_truncated', 'series_downsampled', 'budget_exceeded'].includes(code), `warnings[${index}]`, `警告 ${code} 尚未核定`);
  });
  check(warnings.length === summary.warningCount, 'summary.warningCount', '警告明细缺失');
  const factsValid = issues.length === 0;
  const sampling = inspectContinuousAttackSeries(request, done);
  issues.push(...sampling.seriesIssues);
  return { complete: computationComplete && issues.length === 0, issues, identityGaps, factsValid, ...sampling,
    damageBreakdown: breakdown, execution: execution as ExecutionSummary,
    startedCount, hitCount, completedCount, sourceInitialHp, targetInitialHp, sourceFinalHp, targetFinalHp,
    damageDealt: summary.sourceDamageDealt as number, hpLoss: summary.targetHpLoss as number, durationMs, stopReason,
    attackRecords: attacks, damageRecords: damages, mechanicRecords: mechanics, recording: recording as RecordingSummary };
}
