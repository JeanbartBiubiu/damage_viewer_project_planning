import type {
  AttackRecord, BudgetCause, CompileRequest, DamageBreakdown, DamageRecord, DoneResult,
  ExecutionSummary, OperationDefinition, RecordingSummary, RunRequest, StopReason
} from '../types/genericEngine';
import type { OperationOrigin } from './simulationAdapter';

export type ContinuousAttackAssessment = {
  complete: boolean; issues: string[]; execution: ExecutionSummary;
  startedCount: number; hitCount: number; completedCount: number;
  sourceInitialHp: number; targetInitialHp: number; sourceFinalHp: number; targetFinalHp: number;
  damageDealt: number; hpLoss: number; durationMs: number; stopReason: StopReason;
  attackRecords: AttackRecord[]; damageRecords: DamageRecord[]; recording: RecordingSummary;
};
type Row = Record<string, unknown>;
const budgetCauses: BudgetCause[] = ['max_events', 'max_commands_per_event', 'max_chain_depth', 'max_queue_events',
  'max_process_instances', 'max_skill_hits', 'max_basic_attacks', 'max_use_trigger_ledger'];
const amountFields = ['postDefenseDamage', 'shieldAbsorbed', 'actualHpLoss', 'overkillDamage'] as const;
const breakdownKey = (row: Row) => JSON.stringify(['owner', 'source', 'target', 'abilityRef', 'operationRef', 'damageType'].map(key => row[key]));
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
  const check = (condition: boolean, path: string, message: string) => { if (!condition) issues.push(`${path}：${message}`); };
  check(bool(result.ok, 'runResult.ok'), 'runResult.ok', '运行返回未成功');
  for (const key of ['schemaHash', 'rulesHash'] as const) {
    check(text(final[key], `runResult.finalSnapshot.${key}`) === input[key] && final[key] === request[key] && final[key] === initial[key], key, '编译、运行和最终快照摘要不一致');
  }
  check(request.expectedRulesHash === input.rulesHash && Boolean(request.sessionId), 'runRequest', '缺少本次会话或规则摘要不一致');
  const durationMs = integer(summary.durationMs, 'runResult.summary.durationMs');
  const finalTime = integer(final.timeMs, 'runResult.finalSnapshot.timeMs');
  check(integer(initial.timeMs, 'initialSnapshot.timeMs') === 0 && finalTime === durationMs && durationMs <= request.stopPolicy.durationMs,
    'runResult.summary.durationMs', '实际停止时刻与快照或观察范围不一致');
  const stopReason = text(summary.stopReason, 'runResult.summary.stopReason') as StopReason;
  check(['duration_reached', 'target_dead', 'budget_exceeded'].includes(stopReason), 'runResult.summary.stopReason', '连续计划出现非预期停止原因');
  for (const key of ['sourceFinalHp', 'targetFinalHp', 'sourceDamageDealt', 'sourceDamageTaken', 'targetDamageDealt', 'targetDamageTaken', 'sourceHpLoss', 'targetHpLoss']) {
    nonnegative(summary[key], `runResult.summary.${key}`);
  }
  for (const key of ['abilityAttemptCount', 'abilityCastCount', 'attemptSkippedCount', 'warningCount']) integer(summary[key], `runResult.summary.${key}`);
  const sourceInitialHp = health(initial, 'source', 'initialSnapshot');
  const targetInitialHp = health(initial, 'target', 'initialSnapshot');
  const sourceFinalHp = health(final, 'source', 'finalSnapshot');
  const targetFinalHp = health(final, 'target', 'finalSnapshot');
  check(sourceInitialHp > 0 && targetInitialHp > 0 && sourceFinalHp > 0, 'finalSnapshot.combatants', '不符合双方初始存活与目标不反击范围');
  check(close(sourceFinalHp, summary.sourceFinalHp as number) && close(targetFinalHp, summary.targetFinalHp as number), 'runResult.summary', '双方生命与最终快照不一致');
  check(summary.targetDamageDealt === 0 && summary.sourceDamageTaken === 0 && summary.sourceHpLoss === 0, 'runResult.summary', '出现范围外的目标伤害或来源扣血');
  check(close(summary.sourceDamageDealt as number, summary.targetDamageTaken as number), 'runResult.summary', '造成伤害与目标承受伤害不一致');
  check(close(summary.targetHpLoss as number, targetInitialHp - targetFinalHp), 'runResult.summary.targetHpLoss', '目标实际扣血与生命差值不一致');

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
  check(stopReason !== 'target_dead' || killed, 'summary.stopReason', '死亡停止缺少击杀事实');
  check(stopReason !== 'budget_exceeded' || execution.budgetCause !== null, 'summary.execution.budgetCause', '预算停止缺少预算原因');
  if (computationComplete) {
    check(execution.incompleteReason === null && startedCount === hitCount && hitCount === completedCount && completedCount > 0,
      'summary.execution.complete', '完整计算含未完成尾部或无攻击');
    check(killed || finalTime === request.stopPolicy.durationMs, 'summary.execution.complete', '未击杀且没有观察到终点');
  } else check(execution.incompleteReason !== null && execution.budgetCause !== null, 'summary.execution', '部分结果缺少显式停止原因');

  const processUses = new Map<string, Row>();
  const controlMatch = /^source\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$/.exec(plan.initialControlAbilityRef);
  const provider = input.sharedProviders?.find(row => row.providerKey === input.combatants.find(row => row.key === 'source')?.providers
    .find(row => row.providerRef === controlMatch?.[1])?.definitionRef);
  const control = provider?.abilities?.find(row => row.abilityKey === controlMatch?.[2]);
  array(final.processInstances ?? [], 'finalSnapshot.processInstances').forEach((value, index) => {
    const path = `finalSnapshot.processInstances[${index}]`; const row = object(value, path);
    const use = text(row.useKey, `${path}.useKey`);
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
  for (const origin of origins) {
    const key = `${origin.abilityRef}|${origin.operationRef}`;
    check(!mapping.has(key) && origin.skillKey === plan.skillKey
      && origin.operationRef === `skills.${origin.skillKey}.effects.${origin.effectKey}.results.${origin.resultKey}`
      && origin.compiledPaths.length > 0 && new Set(origin.compiledPaths).size === origin.compiledPaths.length,
    'operationOrigins', '结果来源映射重复或不完整');
    for (const path of origin.compiledPaths) check(compiledOperation(input, path)?.ref === origin.operationRef, 'operationOrigins', '编译节点与作者路径不一致');
    mapping.set(key, origin);
  }
  const identity = (row: Row, path: string) => {
    for (const key of ['owner', 'source', 'target', 'abilityRef', 'operationRef', 'damageType']) text(row[key], `${path}.${key}`);
    const origin = mapping.get(`${row.abilityRef}|${row.operationRef}`);
    check(row.owner === plan.source && row.source === plan.source && row.target === plan.target
      && row.abilityRef === plan.hitAbilityRef && !!origin, path, '伤害来源、拥有者或完整作者引用无法关联');
    if (origin) check(origin.compiledPaths.some(path => {
      const operation = compiledOperation(input, path);
      return operation?.operation === 'damage' && operation.damageType === row.damageType;
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
  check(new Set(breakdown.map(breakdownKey)).size === breakdown.length, 'summary.damageBreakdown', '分类汇总键重复');
  check(close(sum(breakdown, 'postDefenseDamage'), summary.sourceDamageDealt as number)
    && close(sum(breakdown, 'actualHpLoss'), summary.targetHpLoss as number), 'summary.damageBreakdown', '完整分类金额与汇总不一致');

  const attacks = array(result.attackRecords, 'runResult.attackRecords').map((value, index) => {
    const path = `attackRecords[${index}]`; const row = object(value, path);
    for (const key of ['planKey', 'useRef', 'source', 'target', 'skillKey']) text(row[key], `${path}.${key}`);
    const attackIndex = integer(row.attackIndex, `${path}.attackIndex`);
    const startAt = integer(row.startAtMs, `${path}.startAtMs`);
    const hitAt = nullableTime(row.hitAtMs, `${path}.hitAtMs`);
    const readyAt = nullableTime(row.readyAtMs, `${path}.readyAtMs`);
    const nextAt = nullableTime(row.nextStartAtMs, `${path}.nextStartAtMs`);
    const completed = bool(row.completed, `${path}.completed`);
    const speed = finite(row.attackSpeed, `${path}.attackSpeed`);
    for (const key of ['postDefenseDamage', 'actualHpLoss', 'sourceHpAfter', 'targetHpAfter']) nonnegative(row[key], `${path}.${key}`);
    check(attackIndex === index + 1 && row.planKey === plan.planKey && row.source === plan.source && row.target === plan.target && row.skillKey === plan.skillKey,
      path, '攻击顺序或计划身份不一致');
    check(startAt <= finalTime && (index !== 0 || startAt === 0) && (hitAt === null || hitAt === startAt)
      && (readyAt === null || readyAt > startAt) && (nextAt === null || nextAt === readyAt && nextAt <= request.stopPolicy.durationMs), path, '攻击时刻或唯一冷却时刻不一致');
    check(speed > 0 && speed <= plan.attackSpeedInputMax
      && close(speed, request.initialSnapshot.combatants.find(actor => actor.key === plan.source)!.attributes[plan.attackSpeedAttributeKey]!.resolved), path, '静态攻速或准入上界不一致');
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
  const damages = array(result.damageRecords, 'runResult.damageRecords').map((value, index) => {
    const path = `damageRecords[${index}]`; const row = object(value, path);
    const origin = identity(row, path); amounts(row, path);
    for (const key of ['useRef', 'operationPath']) text(row[key], `${path}.${key}`);
    const damageId = integer(row.damageId, `${path}.damageId`);
    const attackIndex = integer(row.attackIndex, `${path}.attackIndex`);
    const timeMs = integer(row.timeMs, `${path}.timeMs`);
    check(damageId > 0 && !damageIds.has(damageId) && integer(row.castInstanceId, `${path}.castInstanceId`) > 0, path, '伤害或施放身份缺失、重复');
    damageIds.add(damageId);
    check(attackIndex >= 1 && attackIndex <= hitCount && timeMs <= finalTime && !!origin?.compiledPaths.includes(row.operationPath as string), path, '伤害无法关联本刀或真实编译路径');
    const retainedAttack = attacks[attackIndex - 1];
    if (retainedAttack) check(retainedAttack.useRef === row.useRef && retainedAttack.hitAtMs === timeMs, path, '伤害与逐刀使用身份或命中时刻不一致');
    checkProcess(row.useRef as string, timeMs, path);
    nonnegative(row.rawAmount, `${path}.rawAmount`);
    const hpBefore = nonnegative(row.hpBefore, `${path}.hpBefore`);
    const hpAfter = nonnegative(row.hpAfter, `${path}.hpAfter`);
    check(close(hpBefore - hpAfter, row.actualHpLoss as number), path, '逐笔生命变化与扣血不一致');
    for (const key of ['resistanceBeforePenetration', 'penetrationPercent', 'penetrationFlat', 'effectiveResistance', 'resistanceFactor', 'normalPartPostResistance', 'critPartPostResistance']) finite(row[key], `${path}.${key}`);
    const operation = compiledOperation(input, row.operationPath as string);
    if (operation?.critEligible) {
      check(bool(row.eligible, `${path}.eligible`), path, '原暴击资格未保留'); text(row.policy, `${path}.policy`);
      for (const key of ['baseRawAmount', 'originalCritChance', 'effectiveCritChance', 'multiplier', 'normalPart', 'critPart', 'critAdjustedRawAmount']) finite(row[key], `${path}.${key}`);
    }
    if (row.modifiers !== undefined) array(row.modifiers, `${path}.modifiers`).forEach((modifier, i) => object(modifier, `${path}.modifiers[${i}]`));
    return row as DamageRecord;
  });
  for (const [kind, rows, maximum] of [['attack', attacks, request.recordBudget?.maxAttackRecords ?? 1000], ['damage', damages, request.recordBudget?.maxDamageRecords ?? 2000]] as const) {
    const count = integer(recording[`${kind}RecordCount`], `recording.${kind}RecordCount`);
    const returned = integer(recording[`returned${kind === 'attack' ? 'Attack' : 'Damage'}Records`], 'recording.returned');
    const dropped = integer(recording[`dropped${kind === 'attack' ? 'Attack' : 'Damage'}Records`], 'recording.dropped');
    const truncated = bool(recording[`${kind}RecordsTruncated`], 'recording.truncated');
    check(count === returned + dropped && returned === rows.length && returned === Math.min(count, maximum) && truncated === (dropped > 0), 'recording', '记录预算、总数、返回数或截断说明矛盾');
  }
  check(recording.attackRecordCount === startedCount && recording.damageRecordCount === sum(breakdown, 'damageCount'), 'recording', '可靠总条数与攻击、分类汇总不一致');
  if (!recording.damageRecordsTruncated) {
    const lethal = damages.find(row => row.hpBefore > 0 && row.hpAfter === 0);
    check(killed ? lethal?.timeMs === killedAt : !lethal, 'summary.execution.targetKilledAtMs', '击杀时刻与首次已提交致死伤害不一致');
    let hp = targetInitialHp;
    let time = 0;
    let attackIndex = 0;
    for (const row of damages) {
      check(close(row.hpBefore, hp) && row.timeMs >= time && row.attackIndex >= attackIndex, 'damageRecords', '已提交伤害顺序或逐笔生命链不一致');
      hp = row.hpAfter; time = row.timeMs; attackIndex = row.attackIndex;
    }
    for (const group of breakdown) {
      const rows = damages.filter(row => breakdownKey(row) === breakdownKey(group));
      check(rows.length === group.damageCount && amountFields.every(field => close(sum(rows, field), group[field])), 'damageRecords', '完整伤害记录与分类汇总不一致');
    }
    check(damages.every(row => breakdown.some(group => breakdownKey(row) === breakdownKey(group))), 'damageRecords', '伤害缺少分类汇总');
    const expectedPaths = origins.filter(origin => origin.abilityRef === plan.hitAbilityRef).flatMap(origin => origin.compiledPaths)
      .filter(path => compiledOperation(input, path)?.operation === 'damage');
    for (let index = 1; index <= Math.min(completedCount, 4096); index++) {
      const rows = damages.filter(row => row.attackIndex === index);
      check(rows.length === expectedPaths.length && expectedPaths.every(path => rows.filter(row => row.operationPath === path).length === 1), 'damageRecords', `第${index}刀缺少完整作者伤害结果或重复结算`);
    }
    for (const attack of attacks) {
      const rows = damages.filter(row => row.attackIndex === attack.attackIndex);
      check(close(sum(rows, 'postDefenseDamage'), attack.postDefenseDamage) && close(sum(rows, 'actualHpLoss'), attack.actualHpLoss), 'attackRecords', '逐刀金额与真实伤害记录不一致');
    }
  }
  if (!recording.attackRecordsTruncated && attacks.length) {
    const last = attacks[attacks.length - 1]!;
    check(close(last.sourceHpAfter, sourceFinalHp) && close(last.targetHpAfter, targetFinalHp), 'attackRecords', '最后一刀生命与最终快照不一致');
  }
  const warnings = array(result.warnings, 'runResult.warnings');
  const evidence = object(result.evidence, 'runResult.evidence');
  bool(summary.evidenceTruncated, 'summary.evidenceTruncated');
  bool(summary.seriesDownsampled, 'summary.seriesDownsampled');
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
  const series = array(result.series, 'runResult.series');
  const sampling = object(result.seriesSamplingEvidence, 'seriesSamplingEvidence');
  for (const key of ['requestedSampleEveryMs', 'effectiveSampleEveryMs', 'requestedPointCount', 'finalPointCount', 'maxSeriesPoints']) integer(sampling[key], `seriesSamplingEvidence.${key}`);
  bool(sampling.downsampled, 'seriesSamplingEvidence.downsampled');
  check(sampling.finalPointCount === series.length && sampling.maxSeriesPoints === request.sampling.maxSeriesPoints
    && sampling.requestedSampleEveryMs === request.sampling.sampleEveryMs, 'seriesSamplingEvidence', '采样计数与请求不一致');
  if (request.sampling.disabled) check(series.length === 0 && sampling.method === 'disabled' && sampling.effectiveSampleEveryMs === 0
    && sampling.requestedPointCount === 0 && !sampling.downsampled, 'seriesSamplingEvidence', '关闭采样时仍输出采样结果');
  else check(sampling.method === 'uniform_time', 'seriesSamplingEvidence.method', '未知采样方式');
  return { complete: computationComplete && issues.length === 0, issues, execution: execution as ExecutionSummary,
    startedCount, hitCount, completedCount, sourceInitialHp, targetInitialHp, sourceFinalHp, targetFinalHp,
    damageDealt: summary.sourceDamageDealt as number, hpLoss: summary.targetHpLoss as number, durationMs, stopReason,
    attackRecords: attacks, damageRecords: damages, recording: recording as RecordingSummary };
}
