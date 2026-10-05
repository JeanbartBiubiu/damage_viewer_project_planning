import type { CompileRequest, DoneResult, RunRequest } from '../types/genericEngine';
import { simulationAbility } from './simulationAdapter';
import { inspectContinuousAttackSeries } from './continuousAttackSeries';

export type SkillActionAssessment = { complete: boolean; factsValid: boolean; issues: string[] };
const close = (first: number, second: number) => Math.abs(first - second) <= 1e-9 * Math.max(1, Math.abs(first), Math.abs(second));

export function assessSkillActionResult(compile: CompileRequest, request: RunRequest, done: DoneResult): SkillActionAssessment {
  const issues: string[] = [];
  const check = (condition: boolean, path: string, message: string) => { if (!condition) issues.push(`${path}: ${message}`); };
  const amount = (value: unknown, path: string): number => {
    check(typeof value === 'number' && Number.isFinite(value) && value >= 0, path, '缺少明确非负有限值');
    return typeof value === 'number' ? value : NaN;
  };
  const count = (value: unknown, path: string): number => {
    const result = amount(value, path); check(Number.isSafeInteger(result), path, '需要整数累计'); return result;
  };
  try {
    const instruction = request.driverPlan.skillActions?.[0];
    if (!instruction || request.driverPlan.skillActions?.length !== 1 || request.driverPlan.basicAttack || request.driverPlan.entries.length
      || request.skillUses?.length || request.skillHitFacts?.length || request.attackStartFacts?.length || request.processCommandFacts?.length) throw new Error('driverPlan: 缺少独立6A指令');
    const binding = compile.rules.skillActionBindings?.find(row => row.bindingKey === instruction.bindingKey);
    if (!binding || binding.skillKey !== instruction.skillKey) throw new Error('skillActionBindings: 指令引用不属于编译来源');
    const summary = done.summary;
    const actions = summary.skillActions;
    const uses = summary.skillUses;
    const execution = summary.execution;
    if (!actions || !uses || !execution) throw new Error('summary: 缺少技能行动、使用或公共执行完整性');
    for (const key of ['plannedCount', 'reachedCount', 'acceptedCount', 'rejectedCount', 'abortedBeforeAcceptCount', 'unreachedCount'] as const) count(actions[key], `summary.skillActions.${key}`);
    for (const key of ['startedCount', 'releasedCount', 'hitCount', 'completedCount', 'failedCount', 'inFlightCount'] as const) count(uses[key], `summary.skillUses.${key}`);
    check(actions.plannedCount === 1 && actions.plannedCount === actions.reachedCount + actions.unreachedCount
      && actions.reachedCount === actions.acceptedCount + actions.rejectedCount + actions.abortedBeforeAcceptCount, 'summary.skillActions', '计划与到达累计不守恒');
    check(uses.startedCount === actions.acceptedCount && uses.startedCount === uses.completedCount + uses.failedCount + uses.inFlightCount
      && uses.releasedCount <= uses.startedCount && uses.hitCount <= uses.releasedCount, 'summary.skillUses', '成功、完成、失败、在途或命中累计不一致');
    check(binding.hitBindings.length > 0 || uses.hitCount === 0, 'summary.skillUses', '自身治疗不能伪造命中');
    if (instruction.hitBindings.every(row => row.preset === 'MISS')) check(uses.hitCount === 0, 'summary.skillUses.hitCount', '未命中预设不得产生真实命中');
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
      check(returned === records.length && total === returned + dropped && returned <= maximum
        && recording[`${kind}RecordsTruncated`] === (dropped > 0) && (expected === null || expected === total), `recording.${kind}`, '有限记录预算或统计不守恒');
    }
    const useRefs = new Set<string>();
    for (const row of actionRecords) {
      check(row.instructionKey === instruction.instructionKey && row.requestedAtMs === instruction.firstAtMs
        && row.actualAtMs === row.requestedAtMs && row.actualAtMs <= duration && row.action === instruction.action
        && row.source === instruction.source && row.target === instruction.target && row.skillKey === binding.skillKey
        && row.bindingKey === binding.bindingKey && row.providerRef === binding.providerRef
        && row.providerDefinitionRef === binding.providerDefinitionRef, 'skillActionRecords', '尝试身份、归属或时刻不一致，不能自动延期');
      check(['ACCEPTED', 'REJECTED', 'ABORTED_BEFORE_ACCEPT'].includes(row.outcome), 'skillActionRecords.outcome', '未知结果');
      check(row.outcome === 'ACCEPTED' ? typeof row.useRef === 'string' && !!row.useRef && row.reason === null
        : row.useRef === null && typeof row.reason === 'string' && !!row.reason, 'skillActionRecords.useRef', '拒绝不能产生成功使用身份');
      if (row.useRef) useRefs.add(row.useRef);
    }
    if (!done.recording.skillActionRecordsTruncated) {
      check(actionRecords.filter(row => row.outcome === 'ACCEPTED').length === actions.acceptedCount
        && actionRecords.filter(row => row.outcome === 'REJECTED').length === actions.rejectedCount
        && actionRecords.filter(row => row.outcome === 'ABORTED_BEFORE_ACCEPT').length === actions.abortedBeforeAcceptCount, 'skillActionRecords', '完整行动记录与接受／拒绝／中止累计不一致');
    }
    for (const row of useRecords) {
      check(row.instructionKey === instruction.instructionKey && row.source === instruction.source && row.target === instruction.target
        && row.skillKey === binding.skillKey && row.providerRef === binding.providerRef && row.processKey === binding.controls[0]!.processKey
        && row.timeMs >= instruction.firstAtMs && row.timeMs <= duration && typeof row.useRef === 'string' && !!row.useRef,
      'skillUseRecords', '实际使用、过程、归属或观察时刻不一致');
      check(['STARTED', 'RELEASED', 'HIT', 'COMPLETED', 'FAILED'].includes(row.kind)
        && (row.kind === 'HIT' ? typeof row.hitRef === 'string' && !!row.hitRef : row.hitRef === null), 'skillUseRecords.kind', '使用事实种类或命中身份不合法');
      if (!done.recording.skillActionRecordsTruncated) check(useRefs.has(row.useRef), 'skillUseRecords.useRef', '使用没有已接受指令');
      useRefs.add(row.useRef);
    }
    check(useRefs.size <= 1, 'skillUseRecords.useRef', '6A单条首次不得产生多个实际使用身份');
    if (!done.recording.skillUseRecordsTruncated) for (const [kind, field] of [
      ['STARTED', 'startedCount'], ['RELEASED', 'releasedCount'], ['HIT', 'hitCount'], ['COMPLETED', 'completedCount'], ['FAILED', 'failedCount']
    ] as const) check(useRecords.filter(row => row.kind === kind).length === uses[field], 'skillUseRecords', '完整使用事实与累计不一致');
    for (const row of healingRecords) {
      check(['source', 'target'].includes(row.source) && ['source', 'target'].includes(row.target)
        && !!simulationAbility(compile, row.abilityRef) && typeof row.operationRef === 'string' && !!row.operationRef
        && row.timeMs <= duration, 'healingRecords', '治疗来源或观察时刻不合法');
      for (const field of ['rawAmount', 'healingAfterDone', 'healingAfterModifiers', 'actualHealing', 'overheal', 'hpBefore', 'hpAfter'] as const) amount(row[field], `healingRecords.${field}`);
      check(close(row.hpBefore + row.actualHealing, row.hpAfter) && close(row.actualHealing + row.overheal, row.healingAfterModifiers), 'healingRecords', '有效治疗、溢出与生命变化不守恒');
      if (row.instructionKey !== null) check(row.instructionKey === instruction.instructionKey && actions.acceptedCount > 0
        && typeof row.useRef === 'string' && !!row.useRef, 'healingRecords.instructionKey', '治疗没有成功指令身份');
      const ability = simulationAbility(compile, row.abilityRef);
      const initialListener = ability?.ability.listenerSpec?.eventMatcher.all?.includes(`ability/initial_cast/source/${binding.providerRef}`);
      if (initialListener) check(row.instructionKey === instruction.instructionKey && actions.acceptedCount > 0 && !!row.useRef,
        'healingRecords.useRef', '首次治疗必须保留实际指令与使用身份');
    }
    for (const side of ['source', 'target'] as const) {
      const retained = healingRecords.filter(row => row.target === side).reduce((sum, row) => sum + row.actualHealing, 0);
      const total = summary[`${side}DirectHealing`]!;
      check(retained <= total || close(retained, total), 'healingRecords', '保留治疗超过完整实际治疗');
      if (!done.recording.healingRecordsTruncated) check(close(retained, total), 'healingRecords', '完整治疗明细与实际治疗累计不一致');
    }
    for (const row of damageRecords) {
      check(row.attackIndex === null && !!simulationAbility(compile, row.abilityRef) && row.timeMs <= duration, 'damageRecords', '非普攻伤害不能伪造刀号或来源');
      if (row.instructionKey) check(row.instructionKey === instruction.instructionKey && actions.acceptedCount > 0 && !!row.useRef, 'damageRecords.instructionKey', '伤害没有已接受使用');
      if (binding.hitBindings.some(hit => hit.hitAbilityRef === row.abilityRef)) check(row.instructionKey === instruction.instructionKey
        && actions.acceptedCount > 0 && uses.hitCount > 0 && !!row.useRef, 'damageRecords.useRef', '主动命中伤害必须保留实际指令、使用与命中累计');
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
    issues.push(...inspectContinuousAttackSeries(request, done).seriesIssues);
    check(done.ok === true, 'done.ok', '原生执行未返回成功载荷');
  } catch (error) { issues.push(error instanceof Error ? error.message : String(error)); }
  return { factsValid: issues.length === 0, complete: issues.length === 0 && done.summary.execution?.complete === true, issues };
}
