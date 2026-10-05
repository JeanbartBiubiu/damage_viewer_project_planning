import type { CompileRequest, DoneResult, RunRequest } from '../types/genericEngine';
import { simulationAbility } from './simulationAdapter';
import { inspectContinuousAttackSeries } from './continuousAttackSeries';
import { assessContinuousAttackResult } from './continuousAttackResult';
import { inspectSimulationHealthLedger } from './simulationHealthLedger';
import type { OperationOrigin } from './simulationAdapter';

export type SkillActionAssessment = { complete: boolean; factsValid: boolean; detailIdentityVerified: boolean; identityGaps: string[]; issues: string[] };
const close = (first: number, second: number) => Math.abs(first - second) <= 1e-9 * Math.max(1, Math.abs(first), Math.abs(second));

export function assessSkillActionResult(compile: CompileRequest, request: RunRequest, done: DoneResult, origins: OperationOrigin[] = []): SkillActionAssessment {
  const issues: string[] = [];
  const identityGaps: string[] = [];
  const check = (condition: boolean, path: string, message: string) => { if (!condition) issues.push(`${path}: ${message}`); };
  const amount = (value: unknown, path: string): number => {
    check(typeof value === 'number' && Number.isFinite(value) && value >= 0, path, '缺少明确非负有限值');
    return typeof value === 'number' ? value : NaN;
  };
  const count = (value: unknown, path: string): number => {
    const result = amount(value, path); check(Number.isSafeInteger(result), path, '需要整数累计'); return result;
  };
  try {
    const instructions = request.driverPlan.skillActions;
    if (!instructions?.length || instructions.length > 64 || request.driverPlan.entries.length
      || request.skillUses?.length || request.skillHitFacts?.length || request.attackStartFacts?.length || request.processCommandFacts?.length) throw new Error('driverPlan: 缺少1～64条独立首次指令');
    const contexts = new Map(instructions.map(instruction => {
      const binding = compile.rules.skillActionBindings?.find(row => row.bindingKey === instruction.bindingKey);
      if (!binding || binding.skillKey !== instruction.skillKey || instruction.action !== 'INITIAL'
        || binding.controls[0]?.abilityRef !== instruction.abilityRef || instruction.source !== binding.source) {
        throw new Error('skillActionBindings: 指令引用不属于真实编译来源');
      }
      return [instruction.instructionKey, { instruction, binding }] as const;
    }));
    check(contexts.size === instructions.length, 'skillActions.instructionKey', '指令标识重复');
    const summary = done.summary;
    const actions = summary.skillActions;
    const uses = summary.skillUses;
    const execution = summary.execution;
    if (!actions || !uses || !execution) throw new Error('summary: 缺少技能行动、使用或公共执行完整性');
    for (const key of ['plannedCount', 'reachedCount', 'acceptedCount', 'rejectedCount', 'abortedBeforeAcceptCount', 'unreachedCount'] as const) count(actions[key], `summary.skillActions.${key}`);
    for (const key of ['startedCount', 'releasedCount', 'hitCount', 'completedCount', 'failedCount', 'inFlightCount'] as const) count(uses[key], `summary.skillUses.${key}`);
    check(actions.plannedCount === instructions.length && actions.plannedCount === actions.reachedCount + actions.unreachedCount
      && actions.reachedCount === actions.acceptedCount + actions.rejectedCount + actions.abortedBeforeAcceptCount, 'summary.skillActions', '计划与到达累计不守恒');
    check(uses.startedCount === actions.acceptedCount && uses.startedCount === uses.completedCount + uses.failedCount + uses.inFlightCount
      && uses.releasedCount <= uses.startedCount && uses.hitCount <= uses.releasedCount, 'summary.skillUses', '成功、完成、失败、在途或命中累计不一致');
    if (instructions.every(instruction => instruction.hitBindings.every(row => row.preset === 'MISS'))) {
      check(uses.hitCount === 0, 'summary.skillUses.hitCount', '未命中或自身治疗不得产生真实命中');
    }
    check(execution.requestedDurationMs === request.stopPolicy.durationMs && typeof execution.complete === 'boolean'
      && (execution.complete ? execution.incompleteReason === null && execution.budgetCause === null : execution.incompleteReason !== null), 'summary.execution', '公共完整性字段不一致');
    const duration = amount(summary.durationMs, 'summary.durationMs');
    check(duration <= request.stopPolicy.durationMs, 'summary.durationMs', '超过观察终点');
    check(done.finalSnapshot.timeMs === duration, 'finalSnapshot.timeMs', '最终快照时刻与公共停止时刻不一致');
    for (const side of ['source', 'target'] as const) {
      const initial = request.initialSnapshot.combatants.find(actor => actor.key === side)?.attributes.hp?.current;
      const finalSlot = done.finalSnapshot.combatants.find(actor => actor.key === side)?.attributes.hp;
      const initialHp = amount(initial, `initialSnapshot.${side}.hp`);
      const hpLoss = amount(summary[`${side}HpLoss`], `summary.${side}HpLoss`);
      const vamp = amount(summary[`${side}VampHealing`], `summary.${side}VampHealing`);
      const direct = amount(summary[`${side}DirectHealing`], `summary.${side}DirectHealing`);
      const finalHp = amount(summary[`${side}FinalHp`], `summary.${side}FinalHp`);
      check(close(initialHp - hpLoss + vamp + direct, finalHp), `summary.${side}FinalHp`, '生命账不等于初态减实际扣血加有效吸血与直接治疗');
      check(!!finalSlot && close(finalSlot.current, finalHp) && finalHp <= finalSlot.max, `finalSnapshot.${side}.hp`, '生命槽、汇总或真实上限不一致');
    }
    const actionRecords = done.skillActionRecords;
    const useRecords = done.skillUseRecords;
    const healingRecords = done.healingRecords;
    const damageRecords = done.damageRecords;
    if (!Array.isArray(actionRecords) || !Array.isArray(useRecords) || !Array.isArray(healingRecords) || !Array.isArray(damageRecords) || !done.recording) throw new Error('done: 缺少独立有限记录及保留统计');
    const recording = done.recording as unknown as Record<string, unknown>;
    if (done.recording.skillActionRecordsTruncated) identityGaps.push('行动记录已截断，无法逐项核实所有保留明细与已接受指令的使用身份关联');
    if (done.recording.skillUseRecordsTruncated) identityGaps.push('使用记录已截断，无法逐项核实所有保留主动伤害的真实命中关联');
    const groups = [
      ['skillAction', actionRecords, request.recordBudget?.maxSkillActionRecords ?? 1000, actions.reachedCount],
      ['skillUse', useRecords, request.recordBudget?.maxSkillUseRecords ?? 2000, uses.startedCount + uses.releasedCount + uses.hitCount + uses.completedCount + uses.failedCount],
      ['healing', healingRecords, request.recordBudget?.maxHealingRecords ?? 2000, null],
      ['damage', damageRecords, request.recordBudget?.maxDamageRecords ?? 2000, null]
    ] as const;
    for (const [kind, records, maximum, expected] of groups) {
      const capital = kind[0]!.toUpperCase() + kind.slice(1);
      const total = count(recording[`${kind}RecordCount`], `recording.${kind}RecordCount`);
      const returned = count(recording[`returned${capital}Records`], `recording.returned${capital}Records`);
      const dropped = count(recording[`dropped${capital}Records`], `recording.dropped${capital}Records`);
      check(returned === records.length && total === returned + dropped && returned === Math.min(total, maximum)
        && recording[`${kind}RecordsTruncated`] === (dropped > 0) && (expected === null || expected === total), `recording.${kind}`, '有限记录预算或统计不守恒');
    }
    const useRefs = new Set<string>();
    const accepted = new Map<string, string>();
    const useInstructions = new Map<string, string>();
    const actionKeys = new Set<string>();
    const hitRefs = new Map<string, { useRef: string; instructionKey: string; timeMs: number }>();
    for (const row of actionRecords) {
      const context = contexts.get(row.instructionKey);
      if (!context) throw new Error('skillActionRecords: 未知指令身份');
      const { instruction, binding } = context;
      check(!actionKeys.has(row.instructionKey), 'skillActionRecords', '同一指令重复记录尝试');
      actionKeys.add(row.instructionKey);
      check(row.instructionKey === instruction.instructionKey && row.requestedAtMs === instruction.firstAtMs
        && row.actualAtMs === row.requestedAtMs && row.actualAtMs <= duration && row.action === instruction.action
        && row.source === instruction.source && row.target === instruction.target && row.skillKey === binding.skillKey
        && row.bindingKey === binding.bindingKey && row.providerRef === binding.providerRef
        && row.providerDefinitionRef === binding.providerDefinitionRef, 'skillActionRecords', '尝试身份、归属或时刻不一致，不能自动延期');
      check(['ACCEPTED', 'REJECTED', 'ABORTED_BEFORE_ACCEPT'].includes(row.outcome), 'skillActionRecords.outcome', '未知结果');
      check(row.outcome === 'ACCEPTED' ? typeof row.useRef === 'string' && !!row.useRef && row.reason === null
        : row.useRef === null && typeof row.reason === 'string' && !!row.reason, 'skillActionRecords.useRef', '拒绝不能产生成功使用身份');
      if (row.useRef) { useRefs.add(row.useRef); accepted.set(row.instructionKey, row.useRef); useInstructions.set(row.useRef, row.instructionKey); }
    }
    if (!done.recording.skillActionRecordsTruncated) {
      check(actionRecords.filter(row => row.outcome === 'ACCEPTED').length === actions.acceptedCount
        && actionRecords.filter(row => row.outcome === 'REJECTED').length === actions.rejectedCount
        && actionRecords.filter(row => row.outcome === 'ABORTED_BEFORE_ACCEPT').length === actions.abortedBeforeAcceptCount, 'skillActionRecords', '完整行动记录与接受／拒绝／中止累计不一致');
    }
    for (const row of useRecords) {
      const context = contexts.get(row.instructionKey);
      if (!context) throw new Error('skillUseRecords: 未知指令身份');
      const { instruction, binding } = context;
      check(row.instructionKey === instruction.instructionKey && row.source === instruction.source && row.target === instruction.target
        && row.skillKey === binding.skillKey && row.providerRef === binding.providerRef && row.processKey === binding.controls[0]!.processKey
        && row.timeMs >= instruction.firstAtMs && row.timeMs <= duration && typeof row.useRef === 'string' && !!row.useRef,
      'skillUseRecords', '实际使用、过程、归属或观察时刻不一致');
      check(['STARTED', 'RELEASED', 'HIT', 'COMPLETED', 'FAILED'].includes(row.kind)
        && (row.kind === 'HIT' ? typeof row.hitRef === 'string' && !!row.hitRef : row.hitRef === null), 'skillUseRecords.kind', '使用事实种类或命中身份不合法');
      if (!done.recording.skillActionRecordsTruncated) check(accepted.get(row.instructionKey) === row.useRef, 'skillUseRecords.useRef', '使用没有对应已接受指令');
      check(!useInstructions.has(row.useRef) || useInstructions.get(row.useRef) === row.instructionKey, 'skillUseRecords.useRef', '不同指令复用使用身份');
      useInstructions.set(row.useRef, row.instructionKey);
      if (row.kind === 'HIT') {
        check(binding.hitBindings.length > 0 && instruction.hitBindings.some(hit => hit.preset === 'TARGET_HIT')
          && !hitRefs.has(row.hitRef!), 'skillUseRecords.hitRef', '自身治疗、未命中或重复身份不能产生命中');
        hitRefs.set(row.hitRef!, { useRef: row.useRef, instructionKey: row.instructionKey, timeMs: row.timeMs });
      }
      useRefs.add(row.useRef);
    }
    check(useRefs.size <= actions.acceptedCount, 'skillUseRecords.useRef', '实际使用身份超过已接受首次指令');
    for (const key of contexts.keys()) {
      const rows = useRecords.filter(row => row.instructionKey === key);
      check(new Set(rows.map(row => row.useRef)).size <= 1 && new Set(rows.map(row => row.kind)).size === rows.length,
        'skillUseRecords', '同一首次不得产生多个使用或重复过程事实');
      check(!rows.some(row => row.kind === 'FAILED') || !rows.some(row => row.kind === 'COMPLETED'), 'skillUseRecords', '同一使用不能同时完成和失败');
    }
    if (!done.recording.skillUseRecordsTruncated) for (const [kind, field] of [
      ['STARTED', 'startedCount'], ['RELEASED', 'releasedCount'], ['HIT', 'hitCount'], ['COMPLETED', 'completedCount'], ['FAILED', 'failedCount']
    ] as const) check(useRecords.filter(row => row.kind === kind).length === uses[field], 'skillUseRecords', '完整使用事实与累计不一致');
    for (const row of healingRecords) {
      const healingAbility = simulationAbility(compile, row.abilityRef);
      check(['source', 'target'].includes(row.source) && ['source', 'target'].includes(row.target)
        && !!healingAbility && row.abilityRef.startsWith(`${row.source}.provider[`)
        && healingAbility.ability.listenerSpec?.operations?.some(operation => operation.operation === 'heal' && operation.ref === row.operationRef) === true
        && typeof row.operationRef === 'string' && !!row.operationRef
        && row.timeMs <= duration, 'healingRecords', '治疗来源或观察时刻不合法');
      for (const field of ['rawAmount', 'healingAfterDone', 'healingAfterModifiers', 'actualHealing', 'overheal', 'hpBefore', 'hpAfter'] as const) amount(row[field], `healingRecords.${field}`);
      check(close(row.hpBefore + row.actualHealing, row.hpAfter) && close(row.actualHealing + row.overheal, row.healingAfterModifiers), 'healingRecords', '有效治疗、溢出与生命变化不守恒');
      if (row.instructionKey !== null) check(contexts.has(row.instructionKey) && actions.acceptedCount > 0
        && typeof row.useRef === 'string' && !!row.useRef
        && (done.recording.skillActionRecordsTruncated || accepted.get(row.instructionKey) === row.useRef), 'healingRecords.instructionKey', '治疗没有对应成功指令身份');
      const ability = simulationAbility(compile, row.abilityRef);
      const initialBinding = compile.rules.skillActionBindings?.find(binding => ability?.ability.listenerSpec?.eventMatcher.all?.includes(`ability/initial_cast/source/${binding.providerRef}`));
      if (initialBinding) check(row.instructionKey !== null && contexts.get(row.instructionKey)?.binding === initialBinding
        && actions.acceptedCount > 0 && !!row.useRef,
        'healingRecords.useRef', '首次治疗必须保留实际指令与使用身份');
    }
    for (const side of ['source', 'target'] as const) {
      const retained = healingRecords.filter(row => row.target === side).reduce((sum, row) => sum + row.actualHealing, 0);
      const total = summary[`${side}DirectHealing`]!;
      check(retained <= total || close(retained, total), 'healingRecords', '保留治疗超过完整实际治疗');
      if (!done.recording.healingRecordsTruncated) check(close(retained, total), 'healingRecords', '完整治疗明细与实际治疗累计不一致');
    }
    for (const row of damageRecords) {
      const ability = simulationAbility(compile, row.abilityRef);
      check((request.driverPlan.basicAttack ? row.attackIndex === null || Number.isSafeInteger(row.attackIndex) && row.attackIndex >= 0 : row.attackIndex === null)
        && (!!ability || !!row.providerDefinitionRef) && row.timeMs <= duration
        && row.abilityRef.startsWith(`${row.owner}.provider[`), 'damageRecords', '伤害刀号、拥有者或来源不合法');
      if (row.instructionKey) check(contexts.has(row.instructionKey) && actions.acceptedCount > 0 && !!row.useRef
        && (done.recording.skillActionRecordsTruncated || accepted.get(row.instructionKey) === row.useRef), 'damageRecords.instructionKey', '伤害没有对应已接受使用');
      const hitBinding = compile.rules.skillActionBindings?.find(binding => binding.hitBindings.some(hit => hit.hitAbilityRef === row.abilityRef));
      if (hitBinding) {
        check(row.attackIndex === null && !!row.instructionKey && contexts.get(row.instructionKey)?.binding === hitBinding
          && actions.acceptedCount > 0 && uses.hitCount > 0 && !!row.useRef && !!row.hitRef,
        'damageRecords.useRef', '主动命中伤害必须保留实际指令、使用与命中身份，不能借用最近普攻刀号');
        if (!done.recording.skillUseRecordsTruncated) {
          const hit = hitRefs.get(row.hitRef!);
          check(hit?.useRef === row.useRef && hit.instructionKey === row.instructionKey && hit.timeMs === row.timeMs,
            'damageRecords.hitRef', '伤害命中身份与真实使用事实不一致');
        }
      }
      let operation: unknown = compile;
      for (const piece of row.operationPath.replace(/\[(\d+)\]/g, '.$1').split('.')) operation = operation && typeof operation === 'object'
        ? (operation as Record<string, unknown>)[piece] : undefined;
      const actual = operation as { operation?: string; ref?: string; damageType?: string } | undefined;
      check(actual?.operation === 'damage' && actual.ref === row.operationRef && actual.damageType === row.damageType,
        'damageRecords.operationPath', '伤害编译路径、作者引用与类型不一致');
      for (const field of ['postDefenseDamage', 'shieldAbsorbed', 'actualHpLoss', 'overkillDamage', 'hpBefore', 'hpAfter'] as const) amount(row[field], `damageRecords.${field}`);
      check(close(row.postDefenseDamage, row.shieldAbsorbed + row.actualHpLoss + row.overkillDamage)
        && close(row.hpBefore - row.actualHpLoss, row.hpAfter), 'damageRecords', '伤害分解与实际扣血不守恒');
    }
    const breakdown = summary.damageBreakdown;
    if (!Array.isArray(breakdown)) throw new Error('summary.damageBreakdown: 缺少完整伤害分类');
    for (const row of breakdown) {
      check(['source', 'target'].includes(row.source) && ['source', 'target'].includes(row.target)
        && !!simulationAbility(compile, row.abilityRef), 'summary.damageBreakdown', '伤害分类来源不合法');
      count(row.damageCount, 'summary.damageBreakdown.damageCount');
      for (const field of ['postDefenseDamage', 'shieldAbsorbed', 'actualHpLoss', 'overkillDamage'] as const) amount(row[field], `summary.damageBreakdown.${field}`);
      check(close(row.postDefenseDamage, row.shieldAbsorbed + row.actualHpLoss + row.overkillDamage), 'summary.damageBreakdown', '完整分类不守恒');
    }
    for (const side of ['source', 'target'] as const) {
      const dealt = amount(summary[`${side}DamageDealt`], `summary.${side}DamageDealt`);
      const lost = summary[`${side}HpLoss`]!;
      check(close(breakdown.filter(row => row.source === side).reduce((sum, row) => sum + row.postDefenseDamage, 0), dealt)
        && close(breakdown.filter(row => row.target === side).reduce((sum, row) => sum + row.actualHpLoss, 0), lost), 'summary.damageBreakdown', '完整分类与伤害／扣血汇总不一致');
      if (!done.recording.damageRecordsTruncated) check(close(damageRecords.filter(row => row.target === side).reduce((sum, row) => sum + row.actualHpLoss, 0), lost), 'damageRecords', '完整伤害记录与扣血累计不一致');
    }
    check(close(summary.sourceDamageDealt, summary.targetDamageTaken) && close(summary.targetDamageDealt, summary.sourceDamageTaken),
      'summary', '真实双方造成与承受伤害方向不一致');
    issues.push(...inspectContinuousAttackSeries(request, done).seriesIssues);
    if (request.driverPlan.basicAttack) {
      const continuous = assessContinuousAttackResult(compile, request, done, origins);
      issues.push(...continuous.issues);
    } else if (healingRecords.length || damageRecords.length) issues.push(...inspectSimulationHealthLedger(request, done));
    check(done.ok === true, 'done.ok', '原生执行未返回成功载荷');
  } catch (error) { issues.push(error instanceof Error ? error.message : String(error)); }
  return { factsValid: issues.length === 0, complete: issues.length === 0 && done.summary.execution?.complete === true,
    detailIdentityVerified: issues.length === 0 && identityGaps.length === 0, identityGaps, issues };
}
