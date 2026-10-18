import type {
  AbilityDefinition, CompileRequest, DoneResult, OperationDefinition, ProcessDefinition, RunRequest, StopReason
} from '../types/genericEngine';
import { isAlwaysParticipatingContribution } from './basicAttackContributionContract';

export type SingleAttackAssessment = {
  complete: boolean;
  issues: string[];
  sourceInitialHp: number;
  targetInitialHp: number;
  sourceFinalHp: number;
  targetFinalHp: number;
  damageDealt: number;
  hpLoss: number;
  stopReason: StopReason;
  durationMs: number;
};

type Row = Record<string, unknown>;
type Evidence = { row: Row; data: Row; path: string };
type ExpectedOperation = { operation: OperationDefinition; path: string; abilityRef: string; providerRef: string; optional?: boolean };

function invalid(path: string, message: string): never {
  throw new Error(`${path}：${message}`);
}
function object(value: unknown, path: string): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path, '需要对象');
  return value as Row;
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path, '需要数组');
  return value;
}
function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) invalid(path, '需要非空字符串');
  return value;
}
function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path, '需要布尔值');
  return value;
}
function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(path, '需要明确的有限数值');
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
function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}
function combatants(snapshot: Row, path: string): Record<'source' | 'target', Row> {
  const rows = array(snapshot.combatants, `${path}.combatants`).map((value, index) => object(value, `${path}.combatants[${index}]`));
  if (rows.length !== 2 || rows.filter(row => row.key === 'source').length !== 1 || rows.filter(row => row.key === 'target').length !== 1) {
    invalid(`${path}.combatants`, '需要唯一的 source 与 target 运行角色');
  }
  return Object.fromEntries(rows.map(row => [row.key, row])) as Record<'source' | 'target', Row>;
}
function health(actor: Row, path: string): number {
  const attributes = object(actor.attributes, `${path}.attributes`);
  const hp = object(attributes.hp, `${path}.attributes.hp`);
  for (const field of ['base', 'current', 'max', 'resolved']) finite(hp[field], `${path}.attributes.hp.${field}`);
  const current = nonnegative(hp.current, `${path}.attributes.hp.current`);
  const max = nonnegative(hp.max, `${path}.attributes.hp.max`);
  if (current > max) invalid(`${path}.attributes.hp.current`, '当前生命不能超过上限');
  return current;
}
function ability(input: CompileRequest, ref: string) {
  const match = /^(source|target)\.provider\[([^\]]+)\]\.ability\[([^\]]+)\]$/.exec(ref);
  if (!match) return undefined;
  const mounts = input.combatants.find(row => row.key === match[1])?.providers.filter(row => row.providerRef === match[2]);
  if (mounts?.length !== 1) return undefined;
  const providers = input.sharedProviders?.map((provider, index) => ({ provider, index })).filter(row => row.provider.providerKey === mounts[0]!.definitionRef);
  if (providers?.length !== 1) return undefined;
  const { provider, index: providerIndex } = providers[0]!;
  const abilities = provider.abilities?.map((item, index) => ({ item, index })).filter(row => row.item.abilityKey === match[3]);
  if (abilities?.length !== 1) return undefined;
  const { item, index: abilityIndex } = abilities[0]!;
  return { definition: item, provider, providerRef: match[2]!, path: `sharedProviders[${providerIndex}].abilities[${abilityIndex}]`, providerIndex };
}

/** 只解释本次单次请求的原生事实；不重算伤害、暴击、防御或联动公式。 */
export function assessSingleAttackResult(compileRequest: CompileRequest, runRequest: RunRequest, done: DoneResult): SingleAttackAssessment {
  const result = object(done, 'runResult');
  const ok = boolean(result.ok, 'runResult.ok');
  const summary = object(result.summary, 'runResult.summary');
  const durationMs = integer(summary.durationMs, 'runResult.summary.durationMs');
  const stopReason = text(summary.stopReason, 'runResult.summary.stopReason') as StopReason;
  for (const key of ['sourceFinalHp', 'targetFinalHp', 'sourceDamageDealt', 'sourceDamageTaken', 'targetDamageDealt', 'targetDamageTaken']) {
    nonnegative(summary[key], `runResult.summary.${key}`);
  }
  for (const key of ['abilityAttemptCount', 'abilityCastCount', 'attemptSkippedCount', 'warningCount']) integer(summary[key], `runResult.summary.${key}`);
  const summaryTruncated = boolean(summary.evidenceTruncated, 'runResult.summary.evidenceTruncated');
  boolean(summary.seriesDownsampled, 'runResult.summary.seriesDownsampled');
  array(summary.abilityStats, 'runResult.summary.abilityStats').forEach((value, index) => {
    const path = `runResult.summary.abilityStats[${index}]`;
    const stat = object(value, path);
    text(stat.abilityRef, `${path}.abilityRef`);
    for (const key of ['attemptCount', 'castCount', 'skipCount']) integer(stat[key], `${path}.${key}`);
    for (const key of ['damageDealt', 'healingDone']) if (stat[key] !== undefined) nonnegative(stat[key], `${path}.${key}`);
  });

  const initial = object(runRequest.initialSnapshot, 'runRequest.initialSnapshot');
  const final = object(result.finalSnapshot, 'runResult.finalSnapshot');
  const initialActors = combatants(initial, 'runRequest.initialSnapshot');
  const finalActors = combatants(final, 'runResult.finalSnapshot');
  const sourceInitialHp = health(initialActors.source, 'runRequest.initialSnapshot.combatants.source');
  const targetInitialHp = health(initialActors.target, 'runRequest.initialSnapshot.combatants.target');
  const sourceSnapshotHp = health(finalActors.source, 'runResult.finalSnapshot.combatants.source');
  const targetSnapshotHp = health(finalActors.target, 'runResult.finalSnapshot.combatants.target');
  const initialTime = integer(initial.timeMs, 'runRequest.initialSnapshot.timeMs');
  const finalTime = integer(final.timeMs, 'runResult.finalSnapshot.timeMs');
  for (const key of ['schemaHash', 'rulesHash']) text(final[key], `runResult.finalSnapshot.${key}`);
  const sourceFinalHp = summary.sourceFinalHp as number;
  const targetFinalHp = summary.targetFinalHp as number;
  const damageDealt = summary.sourceDamageDealt as number;
  const hpLoss = targetInitialHp - targetFinalHp;
  const issues: string[] = [];
  const check = (condition: boolean, path: string, message: string) => {
    if (!condition) issues.push(`${path}：${message}`);
  };
  check(ok, 'runResult.ok', '运行未成功');
  for (const key of ['schemaHash', 'rulesHash'] as const) {
    check(final[key] === compileRequest[key] && final[key] === runRequest[key] && final[key] === initial[key], `runResult.finalSnapshot.${key}`, '摘要与本次编译、运行请求不一致');
  }
  check(runRequest.expectedRulesHash === compileRequest.rulesHash, 'runRequest.expectedRulesHash', '预期规则摘要不一致');
  check(!!runRequest.sessionId, 'runRequest.sessionId', '本次会话缺失');
  check(close(sourceFinalHp, sourceSnapshotHp), 'runResult.summary.sourceFinalHp', '与最终 source 快照不一致');
  check(close(targetFinalHp, targetSnapshotHp), 'runResult.summary.targetFinalHp', '与最终 target 快照不一致');
  check(finalTime - initialTime === durationMs, 'runResult.summary.durationMs', '与快照时间差不一致');
  check(sourceInitialHp > 0 && targetInitialHp > 0, 'runRequest.initialSnapshot.combatants', '单次入口要求双方初始生命为正');
  check(['no_events', 'duration_reached', 'target_dead'].includes(stopReason), 'runResult.summary.stopReason', `停止原因 ${stopReason} 不允许判为完整完成`);
  check(sourceFinalHp > 0, 'runResult.summary.sourceFinalHp', '来源已死亡');
  check(stopReason !== 'target_dead' || targetFinalHp === 0, 'runResult.summary.stopReason', '目标死亡停止与最终生命不一致');
  check(close(summary.targetDamageDealt as number, summary.sourceDamageTaken as number), 'runResult.summary.targetDamageDealt', '反向伤害与攻击方承受伤害不一致');
  check(close(damageDealt, summary.targetDamageTaken as number), 'runResult.summary.targetDamageTaken', '与来源造成伤害不一致');

  array(result.series, 'runResult.series').forEach((value, index) => {
    const path = `runResult.series[${index}]`;
    const point = object(value, path);
    for (const key of ['timeMs', 'sourceHp', 'targetHp', 'sourceDamageDealt', 'targetDamageDealt', 'sourceCumulativeDps', 'targetCumulativeDps', 'sourceWindowDps', 'targetWindowDps']) finite(point[key], `${path}.${key}`);
  });
  object(result.seriesSamplingEvidence, 'runResult.seriesSamplingEvidence');
  const warnings = array(result.warnings, 'runResult.warnings');
  warnings.forEach((value, index) => {
    const path = `runResult.warnings[${index}]`;
    const warning = object(value, path);
    const code = text(warning.code, `${path}.code`);
    text(warning.message, `${path}.message`);
    if (warning.severity !== 'warning') invalid(`${path}.severity`, '需要 warning');
    if (warning.count !== undefined) integer(warning.count, `${path}.count`);
    for (const key of ['refs', 'evidenceRefs']) if (warning[key] !== undefined) {
      array(warning[key], `${path}.${key}`).forEach((ref, refIndex) => text(ref, `${path}.${key}[${refIndex}]`));
    }
    check(code === 'series_downsampled', `${path}.code`, `警告 ${code} 影响完整性或尚未核定`);
  });
  check(summary.warningCount === warnings.length, 'runResult.summary.warningCount', '警告数量与明细不一致，可能已截断');

  const collection = object(result.evidence, 'runResult.evidence');
  const truncated = boolean(collection.truncated, 'runResult.evidence.truncated');
  const truncatedCount = integer(collection.truncatedEvidenceCount, 'runResult.evidence.truncatedEvidenceCount');
  const counts = object(collection.countsByKind, 'runResult.evidence.countsByKind');
  Object.entries(counts).forEach(([kind, count]) => integer(count, `runResult.evidence.countsByKind.${kind}`));
  const evidence: Evidence[] = array(collection.items, 'runResult.evidence.items').map((value, index) => {
    const path = `runResult.evidence.items[${index}]`;
    const row = object(value, path);
    integer(row.timeMs, `${path}.timeMs`);
    text(row.kind, `${path}.kind`);
    for (const key of ['ref', 'path', 'message']) if (row[key] !== undefined) text(row[key], `${path}.${key}`);
    return { row, path, data: row.data === undefined ? {} : object(row.data, `${path}.data`) };
  });
  check(!summaryTruncated && !truncated && truncatedCount === 0, 'runResult.evidence', '证据已截断，明细不完整');
  const retainedCounts = new Map<string, number>();
  for (const { row, path } of evidence) {
    const kind = row.kind as string;
    retainedCounts.set(kind, (retainedCounts.get(kind) ?? 0) + 1);
    check((row.timeMs as number) >= initialTime && (row.timeMs as number) <= finalTime, `${path}.timeMs`, '证据不属于本次运行时间范围');
    check(!['attempt_skipped', 'budget_exceeded', 'process_rejected', 'skill_hit_skip'].includes(kind), `${path}.kind`, `存在 ${kind} 未完成证据`);
  }
  if (!summaryTruncated && !truncated && truncatedCount === 0) {
    for (const kind of new Set([...Object.keys(counts), ...retainedCounts.keys()])) {
      check((counts[kind] ?? 0) === (retainedCounts.get(kind) ?? 0), `runResult.evidence.countsByKind.${kind}`, '与完整证据数量不一致');
    }
  }

  const uses = runRequest.skillUses ?? [];
  const startFacts = runRequest.attackStartFacts ?? [];
  const hitFacts = runRequest.skillHitFacts ?? [];
  const entries = runRequest.driverPlan.entries;
  const use = uses.length === 1 ? uses[0] : undefined;
  check(!!use && use.source === 'source' && use.historyState === 'complete', 'runRequest.skillUses', '需要唯一本次来源的完整使用身份');
  const start = startFacts.length === 1 ? entries.find(row => row.entryKey === startFacts[0]!.driverEntryKey) : undefined;
  const hit = hitFacts.length === 1 ? entries.find(row => row.entryKey === hitFacts[0]!.driverEntryKey) : undefined;
  check(!!start && !!hit && start.entryKey !== hit.entryKey && entries.length === 2
    && entries.every(row => row.source === 'source' && row.target === 'target' && row.repeat === undefined && row.whileReady === undefined)
    && startFacts[0]?.useRef === use?.useKey && hitFacts[0]?.useRef === use?.useKey && hitFacts[0]?.sequence === 1,
  'runRequest.driverPlan', '需要同次使用的一次开始和一次命中，目标不能自主驱动');
  const startAbility = start ? ability(compileRequest, start.abilityRef) : undefined;
  const hitAbility = hit ? ability(compileRequest, hit.abilityRef) : undefined;
  check(!!startAbility && !!hitAbility && startAbility.definition.skillKey === use?.skillKey && hitAbility.definition.skillKey === use?.skillKey,
    'runRequest.driverPlan.entries', '能力、挂载与所选技能身份不一致');
  const identity = (data: Row, path: string, useField = 'useRef') => {
    for (const key of ['source', 'target', useField, 'skillKey']) text(data[key], `${path}.${key}`);
    return data.source === 'source' && data.target === 'target' && data[useField] === use?.useKey && data.skillKey === use?.skillKey;
  };
  for (const eventType of ['event/basic_attack_start', 'event/basic_attack_hit']) {
    const events = evidence.filter(item => item.row.kind === 'emitted_event' && item.row.ref === eventType);
    check(events.length === 1, 'runResult.evidence.items', `${eventType} 原生事件应恰好一次`);
    for (const item of events) {
      check(identity(item.data, `${item.path}.data`) && item.data.eventType === eventType, item.path, '原生攻击事件与本次使用身份不一致');
    }
  }
  const hitRecords = evidence.filter(item => item.row.kind === 'skill_hit');
  check(hitRecords.length === 1, 'runResult.evidence.items', '需要唯一的原生命中判定证据');
  for (const item of hitRecords) {
    check(identity(item.data, `${item.path}.data`) && item.row.ref === hit?.abilityRef && item.row.path === `driverPlan.entries[${hit?.entryKey}]`, item.path, '命中判定与本次驱动身份不一致');
    check(finite(item.data.blocked, `${item.path}.data.blocked`) === 0, item.path, '本次命中被阻挡');
    check(boolean(item.data.reused, `${item.path}.data.reused`) === false, item.path, '本次命中复用了其他命中事实');
  }

  const expected: ExpectedOperation[] = [];
  let control: AbilityDefinition | undefined;
  let controlRef = '';
  let process: ProcessDefinition | undefined;
  if (startAbility) {
    const controls = (startAbility.provider.abilities ?? []).filter(row => row.processControl?.action === 'INITIAL' && row.processControl.useRefFromEvent);
    control = controls.length === 1 ? controls[0] : undefined;
    controlRef = control ? `source.provider[${startAbility.providerRef}].ability[${control.abilityKey}]` : '';
    const processes = startAbility.provider.processes?.filter(row => row.processKey === control?.processControl?.processKey) ?? [];
    process = processes.length === 1 ? processes[0] : undefined;
    check(!!process && process.skillKey === use?.skillKey && !!control && control.skillKey === use?.skillKey,
      'compileRequest.sharedProviders', '没有唯一的同次攻击过程');
    if (process) {
      const processIndex = startAbility.provider.processes!.indexOf(process);
      process.momentOperations.forEach((moment, index) => {
        if (moment.moment.momentType === 'PROCESS_FAILURE' || moment.moment.momentType === 'STEP_TIMEOUT') return;
        moment.operations.forEach((operation, operationIndex) => expected.push({ operation,
          path: `sharedProviders[${startAbility.providerIndex}].processes[${processIndex}].momentOperations[${index}].operations[${operationIndex}]`,
          abilityRef: controlRef, providerRef: startAbility.providerRef }));
      });
    }
  }
  if (hitAbility) {
    const plans = (hitAbility.definition.operations ?? []).filter(row => row.operation === 'resolve_skill_hit' && row.skillHit);
    check(plans.length === 1, 'compileRequest.sharedProviders', '没有唯一的完整命中计划');
    for (const plan of plans) {
      const operationIndex = hitAbility.definition.operations!.indexOf(plan);
      check(plan.skillHit!.skillKey === use?.skillKey, 'compileRequest.sharedProviders', '命中计划技能身份不一致');
      const conditionalRules = new Set(plan.skillHit!.candidates.filter(candidate => candidate.participationCondition != null
        && !isAlwaysParticipatingContribution(candidate))
        .map(candidate => candidate.candidateKey.split(':')[0]!));
      const observedRules = new Set<string>();
      for (const [index, candidate] of plan.skillHit!.candidates.entries()) {
        const prefix = `${hitAbility.path}.operations[${operationIndex}].skillHit.candidates[${index}].operations`;
        if (!isAlwaysParticipatingContribution(candidate) && candidate.operations.some((operation, operationIndexInCandidate) => evidence.some(item =>
          operation.operation === 'damage' ? item.row.kind === 'damage' && item.data.abilityRef === hit!.abilityRef && item.data.operationRef === operation.ref
            : item.row.kind === 'link_application' && item.row.path === `${prefix}[${operationIndexInCandidate}]`))) {
          observedRules.add(candidate.candidateKey.split(':')[0]!);
        }
      }
      if (conditionalRules.size) check([...observedRules].filter(rule => conditionalRules.has(rule)).length === 1,
        'runResult.evidence.items', '互斥主体必须有唯一真实命中分支，不能以汇总代替分支证明');
      plan.skillHit!.candidates.forEach((candidate, index) => {
        check(candidate.spellShieldBlockScope === null && !candidate.eventValueConditions?.length,
          `${hitAbility.path}.operations[${operationIndex}].skillHit.candidates[${index}]`, '所选结果包含未支持的阻挡或事件数值条件');
        if (candidate.participationCondition != null && !isAlwaysParticipatingContribution(candidate)
          && !observedRules.has(candidate.candidateKey.split(':')[0]!)) return;
        candidate.operations.forEach((operation, operationIndexInCandidate) => expected.push({ operation,
          path: `${hitAbility.path}.operations[${operationIndex}].skillHit.candidates[${index}].operations[${operationIndexInCandidate}]`,
          abilityRef: hit!.abilityRef, providerRef: hitAbility.providerRef }));
      });
    }
  }
  for (const actor of compileRequest.combatants) for (const mount of actor.providers) {
    const providerIndex = compileRequest.sharedProviders?.findIndex(provider => provider.providerKey === mount.definitionRef) ?? -1;
    const definition = compileRequest.sharedProviders?.[providerIndex];
    definition?.abilities?.forEach((passive, abilityIndex) => {
      const spec = passive.listenerSpec;
      const hitListener = actor.key === 'source' && spec?.eventMatcher.all?.includes('event/basic_attack_hit') && spec.eventMatcher.all.includes('event/source_owner');
      const linkedListener = actor.key === 'source' && spec?.eventMatcher.all?.includes('event/hit_link_applied') && spec.eventMatcher.all.includes('event/source_owner');
      const reaction = actor.key === 'target' && spec?.eventMatcher.all?.includes('event/target_owner')
        && (spec.eventMatcher.all.includes('event/basic_attack_received') || spec.eventMatcher.all.includes('event/damage_taken'));
      if (passive.kind !== 'passive_listener' || !spec || !hitListener && !linkedListener && !reaction) return;
      for (const [operationIndex, operation] of (spec.operations ?? []).entries()) expected.push({ operation,
        path: `sharedProviders[${providerIndex}].abilities[${abilityIndex}].listenerSpec.operations[${operationIndex}]`,
        abilityRef: `${actor.key}.provider[${mount.providerRef}].ability[${passive.abilityKey}]`, providerRef: mount.providerRef,
        optional: !!operation.condition || !!spec.condition || !!spec.oncePerUse || !!linkedListener });
    });
  }
  for (const item of expected) check(['damage', 'apply_hit_link', 'apply_attack_link', 'state_change', 'apply_provider'].includes(item.operation.operation), item.path, '所选结果尚未支持完整性核对');
  const processes = final.processInstances === undefined ? [] : array(final.processInstances, 'runResult.finalSnapshot.processInstances');
  check(processes.length === 1, 'runResult.finalSnapshot.processInstances', '需要唯一的最终攻击过程实例');
  processes.forEach((value, index) => {
    const path = `runResult.finalSnapshot.processInstances[${index}]`;
    const instance = object(value, path);
    for (const key of ['owner', 'target', 'providerRef', 'processKey', 'skillKey', 'useKey', 'status']) text(instance[key], `${path}.${key}`);
    for (const key of ['startedAtMs', 'stepStartedAtMs', 'advanceAtMs', 'stepVersion']) integer(instance[key], `${path}.${key}`);
    if (instance.finishedAtMs !== null) integer(instance.finishedAtMs, `${path}.finishedAtMs`);
    if (instance.expiresAtMs !== null) integer(instance.expiresAtMs, `${path}.expiresAtMs`);
    const costs = object(instance.actualCosts, `${path}.actualCosts`);
    Object.entries(costs).forEach(([key, value]) => nonnegative(value, `${path}.actualCosts.${key}`));
    const cooldownStarted = boolean(instance.cooldownStarted, `${path}.cooldownStarted`);
    check(instance.owner === 'source' && instance.target === 'target' && instance.providerRef === startAbility?.providerRef
      && instance.processKey === process?.processKey && instance.skillKey === use?.skillKey && instance.useKey === use?.useKey,
    path, '最终过程与本次攻击使用身份不一致');
    check(instance.status === 'complete' && instance.failureReason === null && instance.finishedAtMs !== null, path, '攻击过程未成功完成');
    check(!process?.cooldown || cooldownStarted, `${path}.cooldownStarted`, '原过程冷却没有启动');
    if (process?.cooldown && cooldownStarted) {
      const cooldowns = object(finalActors.source.cooldowns, 'runResult.finalSnapshot.combatants.source.cooldowns');
      const cooldown = object(cooldowns[controlRef], `runResult.finalSnapshot.combatants.source.cooldowns[${controlRef}]`);
      const readyAtMs = integer(cooldown.readyAtMs, `runResult.finalSnapshot.combatants.source.cooldowns[${controlRef}].readyAtMs`);
      const remainingMs = integer(cooldown.remainingMs, `runResult.finalSnapshot.combatants.source.cooldowns[${controlRef}].remainingMs`);
      check(remainingMs === Math.max(0, readyAtMs - finalTime), path, '冷却期限与剩余时间不一致');
    }
  });
  for (const moment of ['PROCESS_START', 'PROCESS_COMPLETE']) {
    const records = evidence.filter(item => item.row.kind === 'process_moment' && item.data.moment === moment);
    check(records.length === 1, 'runResult.evidence.items', `缺少唯一的 ${moment} 过程证据`);
    for (const item of records) {
      for (const key of ['owner', 'target', 'providerRef', 'processKey', 'skillKey', 'useKey', 'status']) text(item.data[key], `${item.path}.data.${key}`);
      check(item.row.ref === controlRef && item.data.owner === 'source' && item.data.target === 'target'
        && item.data.providerRef === startAbility?.providerRef && item.data.processKey === process?.processKey
        && item.data.skillKey === use?.skillKey && item.data.useKey === use?.useKey
        && item.data.status === (moment === 'PROCESS_COMPLETE' ? 'complete' : 'active') && item.data.failureReason === null,
      item.path, '过程时点与本次成功攻击不一致');
    }
  }
  for (const item of evidence.filter(item => item.row.kind === 'process_moment' || item.row.kind === 'process_use')) {
    check(item.data.useKey === use?.useKey && item.data.owner === 'source' && item.data.target === 'target'
      && item.data.providerRef === startAbility?.providerRef && item.data.processKey === process?.processKey
      && item.data.skillKey === use?.skillKey && item.data.status !== 'failed', item.path, '存在其他使用或失败过程证据');
  }

  const expectedLinks = expected.filter(item => item.operation.operation === 'apply_hit_link' || item.operation.operation === 'apply_attack_link');
  const linkApplications = evidence.filter(item => item.row.kind === 'link_application');
  const linkEvents = evidence.filter(item => item.row.kind === 'emitted_event' && ['event/hit_link_applied', 'event/attack_link_applied'].includes(item.row.ref as string));
  for (const item of linkApplications) {
    identity(item.data, `${item.path}.data`);
    integer(item.data.count, `${item.path}.data.count`);
    text(item.data.eventType, `${item.path}.data.eventType`);
    check(expectedLinks.some(expected => item.row.path === expected.path && item.row.ref === expected.operation.ref), item.path, '联动应用不属于所选结果');
  }
  for (const expectedLink of expectedLinks) {
    const applications = linkApplications.filter(item => item.row.path === expectedLink.path && item.row.ref === expectedLink.operation.ref);
    check(expectedLink.optional ? applications.length <= 1 : applications.length === 1, expectedLink.path, '需要唯一的联动应用证据，零次也须保留');
    const eventType = expectedLink.operation.operation === 'apply_hit_link' ? 'event/hit_link_applied' : 'event/attack_link_applied';
    const events = linkEvents.filter(item => item.row.path === expectedLink.path);
    for (const application of applications) {
      const count = application.data.count as number;
      check(identity(application.data, `${application.path}.data`) && application.data.eventType === eventType, application.path, '联动应用与本次使用或种类不一致');
      check(events.length === count, application.path, '联动事件数与原生 count 不一致');
      const indexes = new Set<number>();
      for (const event of events) {
        const index = integer(event.data.LINK_INDEX, `${event.path}.data.LINK_INDEX`);
        const eventCount = integer(event.data.LINK_COUNT, `${event.path}.data.LINK_COUNT`);
        check(identity(event.data, `${event.path}.data`) && event.row.ref === eventType && event.data.eventType === eventType
          && eventCount === count && index >= 1 && index <= count && !indexes.has(index), event.path, '联动事件身份、总数或序号不一致');
        indexes.add(index);
      }
    }
  }
  for (const item of linkEvents) check(expectedLinks.some(expected => expected.path === item.row.path), item.path, '存在未选结果的联动事件');

  const damageRows = evidence.filter(item => item.row.kind === 'damage');
  const remaining = expected.filter(item => item.operation.operation === 'damage');
  check(remaining.length > 0, 'compileRequest.sharedProviders', '本阶段需要所选普攻伤害结果');
  let actualHpLoss = 0;
  let postDefenseDamage = 0;
  let reverseDamage = 0;
  const damageIds = new Set<number>();
  const castIds = new Map<string, number>();
  for (const item of damageRows) {
    const { data, path, row } = item;
    for (const key of ['source', 'target', 'damageType', 'abilityRef', 'operationRef']) text(data[key], `${path}.data.${key}`);
    // 直接命中帧可不输出 providerRef；实际能力引用已经携带并绑定来源挂载。
    const providerRef = ability(compileRequest, data.abilityRef as string)?.providerRef;
    if (data.providerRef !== undefined) {
      text(data.providerRef, `${path}.data.providerRef`);
      check(data.providerRef === providerRef, `${path}.data.providerRef`, '与实际来源能力引用中的挂载不一致');
    }
    for (const key of ['rawAmount', 'mitigatedAmount', 'postDefenseDamage', 'shieldAbsorbed', 'actualHpLoss', 'overkillDamage']) nonnegative(data[key], `${path}.data.${key}`);
    for (const key of ['resistanceFactor', 'normalPartPostResistance', 'critPartPostResistance']) finite(data[key], `${path}.data.${key}`);
    const damageId = integer(data.damageId, `${path}.data.damageId`);
    const castId = integer(data.castInstanceId, `${path}.data.castInstanceId`);
    const phantom = boolean(data.phantom, `${path}.data.phantom`);
    const forward = data.source === 'source' && data.target === 'target';
    const reverse = data.source === 'target' && data.target === 'source';
    check((forward || reverse) && !phantom && data.phase === 'original', path, '伤害不属于本次配置的实际双方');
    check(damageId > 0 && !damageIds.has(damageId), `${path}.data.damageId`, '伤害标识缺失或重复');
    damageIds.add(damageId);
    check(castId > 0 && (!castIds.has(data.abilityRef as string) || castIds.get(data.abilityRef as string) === castId), `${path}.data.castInstanceId`, '同一能力含多个或无效施放实例');
    castIds.set(data.abilityRef as string, castId);
    const operationIndex = remaining.findIndex(expected => expected.operation.ref === data.operationRef && expected.abilityRef === data.abilityRef
      && expected.providerRef === providerRef && expected.operation.damageType === data.damageType && row.ref === expected.abilityRef);
    check(operationIndex >= 0, path, '伤害无法关联所选结果及唯一的本次使用场景');
    if (operationIndex >= 0) {
      const expectedDamage = remaining.splice(operationIndex, 1)[0]!;
      if (expectedDamage.operation.critEligible) {
        check(boolean(data.eligible, `${path}.data.eligible`), path, '原暴击资格未保留');
        text(data.policy, `${path}.data.policy`);
        for (const key of ['baseRawAmount', 'originalCritChance', 'effectiveCritChance', 'multiplier', 'normalPart', 'critPart', 'critAdjustedRawAmount']) finite(data[key], `${path}.data.${key}`);
      }
    }
    check(close(data.mitigatedAmount as number, data.postDefenseDamage as number), path, '防御后金额字段不一致');
    check(close(data.postDefenseDamage as number, (data.shieldAbsorbed as number) + (data.actualHpLoss as number) + (data.overkillDamage as number)), path, '护盾、实际扣血与过量伤害不能还原防御后金额');
    if (forward || reverse) {
      if (forward) {
        actualHpLoss += data.actualHpLoss as number;
        postDefenseDamage += data.postDefenseDamage as number;
      } else reverseDamage += data.postDefenseDamage as number;
    }
  }
  for (const missing of remaining) if (!missing.optional) check(false, missing.path, '缺少所选伤害结果的完整结算证据');
  check(close(reverseDamage, summary.targetDamageDealt as number), 'runResult.summary.targetDamageDealt', '与配置受击反应的累计金额不一致');
  check(close(postDefenseDamage, damageDealt), 'runResult.summary.sourceDamageDealt', '与所选伤害证据的防御后累计金额不一致');
  check(close(actualHpLoss, hpLoss), 'runResult.summary.targetFinalHp', '实际扣血累计与目标生命差值不一致');

  return { complete: issues.length === 0, issues, sourceInitialHp, targetInitialHp, sourceFinalHp, targetFinalHp,
    damageDealt, hpLoss, stopReason, durationMs };
}
